"""Loopback-only, synthetic OIDC issuer for the explicit native session acceptance.

This is not a login service. It automatically authenticates a fixed synthetic subject,
has no external endpoints, and must never be used with a production identity key.
"""

import base64
import hashlib
import json
import secrets
import threading
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlsplit

import jwt
from cryptography.hazmat.primitives.serialization import load_pem_private_key


class SyntheticIssuer:
    def __init__(self, key, tenant, callback):
        self.key = load_pem_private_key(key, password=None)
        self.tenant, self.callback = tenant, callback
        self.subject, self.lifetime = "reader", 120
        self.codes, self.tokens = {}, []
        self.exchanges = 0
        self.origin = ""
        self.lock = threading.Lock()

    def public_key(self):
        return {
            **json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self.key.public_key())),
            "kid": "synthetic-session-only",
            "alg": "RS256",
            "use": "sig",
        }

    def handle(self, handler):
        def reply(status, value=None, location=None):
            raw = json.dumps(value).encode() if value is not None else b""
            handler.send_response(status)
            handler.send_header("Content-Type", "application/json")
            handler.send_header("Content-Length", str(len(raw)))
            handler.send_header("Cache-Control", "no-store")
            if location:
                handler.send_header("Location", location)
            handler.end_headers()
            handler.wfile.write(raw)

        parsed = urlsplit(handler.path)
        if len(handler.path) > 4096:
            return reply(400)
        if handler.command == "GET" and parsed.path == "/.well-known/openid-configuration":
            return reply(
                200,
                {
                    "issuer": self.origin,
                    "authorization_endpoint": self.origin + "/authorize",
                    "token_endpoint": self.origin + "/token",
                    "jwks_uri": self.origin + "/keys",
                    "code_challenge_methods_supported": ["S256"],
                    "response_types_supported": ["code"],
                    "id_token_signing_alg_values_supported": ["RS256"],
                    "token_endpoint_auth_methods_supported": ["none"],
                },
            )
        if handler.command == "GET" and parsed.path == "/keys":
            return reply(200, {"keys": [self.public_key()]})
        if handler.command == "GET" and parsed.path == "/authorize":
            params = parse_qs(parsed.query, keep_blank_values=True, max_num_fields=12)
            fixed = {
                "client_id": ["synthetic-console"],
                "response_type": ["code"],
                "redirect_uri": [self.callback],
                "code_challenge_method": ["S256"],
                "scope": ["openid"],
            }
            if any(params.get(k) != v for k, v in fixed.items()) or any(
                len(params.get(k, [])) != 1 or not params[k][0]
                for k in ("state", "nonce", "code_challenge")
            ):
                return reply(400)
            code = secrets.token_urlsafe(32)
            with self.lock:
                self.codes[code] = (params, self.subject, self.lifetime, time.monotonic())
            return reply(
                303,
                location=self.callback
                + "?"
                + urlencode(
                    {
                        "code": code,
                        "state": params["state"][0],
                        "iss": self.origin,
                    }
                ),
            )
        if handler.command == "POST" and parsed.path == "/token":
            size = int(handler.headers.get("Content-Length", "0"))
            if not 0 < size <= 4096:
                return reply(400)
            body = parse_qs(handler.rfile.read(size).decode(), max_num_fields=8)
            with self.lock:
                entry = self.codes.pop(body.get("code", [None])[0], None)
                self.exchanges += 1
            if not entry:
                return reply(400, {"error": "invalid_grant"})
            params, subject, lifetime, started = entry
            verifier = body.get("code_verifier", [""])[0]
            challenge = (
                base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
                .rstrip(b"=")
                .decode()
            )
            if (
                body.get("grant_type") != ["authorization_code"]
                or body.get("client_id") != ["synthetic-console"]
                or body.get("redirect_uri") != [self.callback]
                or challenge != params["code_challenge"][0]
                or time.monotonic() - started > 60
            ):
                return reply(400, {"error": "invalid_grant"})
            now = int(time.time())
            common = {"iss": self.origin, "sub": subject, "iat": now, "exp": now + lifetime}
            access = jwt.encode(
                {**common, "aud": "cortex-core", "tenant": self.tenant},
                self.key,
                algorithm="RS256",
                headers={"kid": "synthetic-session-only"},
            )
            identity = jwt.encode(
                {**common, "aud": "synthetic-console", "nonce": params["nonce"][0]},
                self.key,
                algorithm="RS256",
                headers={"kid": "synthetic-session-only"},
            )
            self.tokens.extend([access, identity])  # In-memory leak assertions, never persisted.
            return reply(
                200,
                {
                    "access_token": access,
                    "id_token": identity,
                    "token_type": "Bearer",
                    "expires_in": lifetime,
                },
            )
        return reply(404)


@contextmanager
def serve_issuer(issuer):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # Callback/code/query/token data must not be logged.

        def do_GET(self):
            issuer.handle(self)

        def do_POST(self):
            issuer.handle(self)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    issuer.origin = f"http://127.0.0.1:{server.server_port}"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield issuer
    finally:
        server.shutdown()
        server.server_close()
        thread.join(5)
        assert not thread.is_alive(), "Synthetic issuer did not stop"
