"""Reversible personal-machine console access. No ingestion or permission changes.

The native API must already be running. Local mode keeps short-lived identity
tokens on the server, reusing the existing private workspace identity. It never
loads the confirmation signing key or exposes MCP through the browser gateway.
"""

import argparse
import os
import signal
import socket
import subprocess
import time

import httpx
import jwt
import uvicorn
from cortex_browser_gateway.app import GatewayConfig, create_app
from cortex_browser_gateway.identity import NativeIdentity
from cortex_browser_gateway.oidc import IdentityGrant
from cortex_browser_gateway.proxy import ApiProxy

from scripts.okf_workspace import BASE_URL, DIRECTORY, ROOT, configuration, headers

ORIGIN = "http://127.0.0.1:5175"
GATEWAY = "http://127.0.0.1:8015"


def workspace_grant(cfg):
    token = headers(cfg, lifetime=1800)["Authorization"].removeprefix("Bearer ")
    # This is our own freshly signed token, never browser-supplied input.
    expires = jwt.decode(token, options={"verify_signature": False})["exp"]
    return IdentityGrant(cfg["subject"], cfg["tenant"], expires, token)


def browser_environment(access, domain):
    env = {
        k: v for k, v in os.environ.items() if not k.startswith(("VITE_", "CORTEX_", "OPENROUTER_"))
    }
    env.update(VITE_DATA_MODE="api", VITE_AUTH_MODE="manual", VITE_LOCAL_ACCESS="0")
    if access == "local":
        env.update(
            VITE_AUTH_MODE="session",
            VITE_LOCAL_ACCESS="1",
            VITE_LOCAL_DOMAIN=domain,
            CORTEX_BROWSER_GATEWAY_TARGET=GATEWAY,
        )
    else:
        env["CORTEX_API_TARGET"] = BASE_URL
    return env


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--access", choices=["local", "manual"], required=True)
    args = parser.parse_args()
    cfg = configuration()
    # Fail before starting a second console or replacing an existing service.
    for port in [5175, 8015] if args.access == "local" else [5175]:
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind(("127.0.0.1", port))
            probe.listen(1)
    with httpx.Client(trust_env=False, timeout=10) as client:
        response = client.get(BASE_URL + "/v1/me", headers=headers(cfg))
        if response.status_code != 200:
            raise RuntimeError("Start the existing private API first")
    log_path = DIRECTORY / f"browser-{int(time.time())}.log"
    with os.fdopen(os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as log:
        frontend = subprocess.Popen(
            [
                "npm",
                "run",
                "dev",
                "--prefix",
                "apps/console",
                "--",
                "--host",
                "127.0.0.1",
                "--port",
                "5175",
            ],
            cwd=ROOT,
            env=browser_environment(args.access, cfg["domain"]),
            stdout=log,
            stderr=log,
            start_new_session=True,
        )
        try:
            if args.access == "manual":

                def stop(*_):
                    raise KeyboardInterrupt

                signal.signal(signal.SIGTERM, stop)
                frontend.wait()
            else:
                app = create_app(
                    GatewayConfig(ORIGIN, allow_loopback_http=True),
                    None,
                    NativeIdentity(BASE_URL, allow_loopback_http=True),
                    api_proxy=ApiProxy(BASE_URL, allow_loopback_http=True),
                    local_grant=lambda: workspace_grant(cfg),
                )
                uvicorn.run(
                    app,
                    host="127.0.0.1",
                    port=8015,
                    workers=1,
                    proxy_headers=False,
                    access_log=False,
                    log_level="warning",
                    limit_concurrency=64,
                    backlog=128,
                    timeout_keep_alive=5,
                    h11_max_incomplete_event_size=16384,
                )
        finally:
            if frontend.poll() is None:
                os.killpg(frontend.pid, signal.SIGTERM)
                try:
                    frontend.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(frontend.pid, signal.SIGKILL)
                    frontend.wait(timeout=5)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        raise SystemExit(f"Local console failed ({type(exc).__name__}); data preserved.") from None
