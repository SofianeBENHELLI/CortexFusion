"""Drop exactly one successful feedback response from a live synthetic fixture.

The browser still uses origin 5174 and the fixture's normal signed identity/CORS.
This loopback-only proxy does not grant access or change permissions. It forwards
only reads and the conversation/feedback writes needed by this acceptance case.
No tokens, questions, source bodies or feedback comments are logged.
"""

import argparse
import hashlib
import json
import re
import signal
import socket
import threading
import time
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "content-length",
    "content-encoding",
}


def emit(event, **values):
    print(json.dumps({"at": datetime.now(UTC).isoformat(), "event": event, **values}), flush=True)


def serve(directory):
    state = json.loads((directory / "state.json").read_text())
    if (
        state.get("synthetic_only") is not True
        or state.get("base_url") != "http://127.0.0.1:8012"
        or state.get("workload")
        or state.get("expires_at", 0) <= time.time()
    ):
        raise ValueError("A live synthetic fixture on loopback port 8012 is required")
    deadline = min(state["expires_at"], time.time() + 1800)
    prefix = f"/v1/domains/{state['domain']}"
    ident = r"[0-9a-f-]{36}"
    feedback_path = re.compile(rf"{re.escape(prefix)}/episodes/{ident}/feedback\Z")
    writes = re.compile(rf"{re.escape(prefix)}/conversations(?:/{ident}/query)?\Z")
    lock = threading.Lock()
    dropped = None
    stopping = False

    def stop(*_):
        nonlocal stopping
        stopping = True

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_):
            pass

        def reply(self, status, body, headers=None):
            self.send_response(status)
            for key, value in (headers or {"content-type": "application/json"}).items():
                if key.lower() not in HOP_HEADERS:
                    self.send_header(key, value)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass
            self.close_connection = True

        def handle_request(self):
            nonlocal dropped
            path = self.path.split("?", 1)[0]
            readable = path == "/v1/me" or path.startswith(prefix + "/")
            is_feedback = bool(feedback_path.fullmatch(path))
            writable = is_feedback or bool(writes.fullmatch(path))
            if (
                stopping
                or time.time() >= deadline
                or self.headers.get("x-tenant-id") != state["tenant"]
                or not self.headers.get("authorization", "").startswith("Bearer ")
                or not (
                    (self.command == "GET" and readable) or (self.command == "POST" and writable)
                )
                or ".." in path
                or "%" in path
            ):
                self.reply(403, b'{"error":"fixture_scope"}')
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 <= size <= 65536 or self.headers.get("Transfer-Encoding"):
                    raise ValueError("Invalid length")
                body = self.rfile.read(size)
                headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP_HEADERS}
                with httpx.Client(
                    base_url=state["base_url"], trust_env=False, timeout=15
                ) as client:
                    response = client.request(
                        self.command, self.path, content=body, headers=headers
                    )
            except (ValueError, httpx.HTTPError):
                self.reply(502, b'{"error":"fixture_upstream"}')
                return
            if is_feedback and response.status_code == 200:
                receipt = response.json()["feedback_id"]
                digest = hashlib.sha256(body).hexdigest()
                with lock:
                    first = dropped is None
                    if first:
                        dropped = {"path": path, "request_sha256": digest, "feedback_id": receipt}
                    emit(
                        "committed_response_dropped" if first else "feedback_response_delivered",
                        path=path,
                        request_sha256=digest,
                        feedback_id=receipt,
                        same_request_as_dropped=path == dropped["path"]
                        and digest == dropped["request_sha256"],
                        same_receipt_as_dropped=receipt == dropped["feedback_id"],
                        upstream_status=response.status_code,
                    )
                if first:
                    # Upstream has completed and returned its committed receipt.
                    # Closing without a response produces a real transport failure
                    # in Vite's existing proxy; the browser must retry explicitly.
                    self.close_connection = True
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.connection.close()
                    return
            self.reply(response.status_code, response.content, response.headers)

        do_GET = handle_request
        do_POST = handle_request

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    with ThreadingHTTPServer(("127.0.0.1", 8011), Handler) as server:
        server.timeout = 0.5
        emit("ready", listen="127.0.0.1:8011", expires_at=deadline, domain=state["domain"])
        while not stopping and time.time() < deadline:
            server.handle_request()
    emit("stopped", response_was_dropped=dropped is not None)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--synthetic-only", action="store_true", required=True)
    directory = parser.parse_args().directory.resolve()
    if not directory.is_relative_to(ROOT / ".runtime"):
        raise ValueError("Use an existing fixture in the ignored .runtime directory")
    serve(directory)
