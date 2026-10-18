"""Explicit local launcher. No automatic issuer, tenant, identity or credential provision."""

import argparse
import os
import stat
from dataclasses import dataclass
from urllib.parse import urlsplit

import uvicorn

from .app import GatewayConfig, create_app
from .identity import NativeIdentity
from .oidc import LoginError, OidcConfig, OidcProvider, _endpoint
from .proxy import ApiProxy


@dataclass(frozen=True)
class Settings:
    gateway: GatewayConfig
    oidc: OidcConfig
    api_origin: str
    bind: str
    port: int


def private_secret(path: str) -> str:
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            info = os.fstat(descriptor)
            if (
                not stat.S_ISREG(info.st_mode)
                or info.st_uid != os.geteuid()
                or info.st_mode & 0o077
                or not 1 <= info.st_size <= 4096
            ):
                raise LoginError("LOGIN_CONFIGURATION")
            raw = os.read(descriptor, 4097)
            if len(raw) != info.st_size:
                raise LoginError("LOGIN_CONFIGURATION")
        finally:
            os.close(descriptor)
        value = raw.decode("utf-8").removesuffix("\n")
        if not value or any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise LoginError("LOGIN_CONFIGURATION")
        return value
    except (OSError, UnicodeError, ValueError):
        raise LoginError("LOGIN_CONFIGURATION") from None


def load_settings(env=None) -> Settings:
    env = os.environ if env is None else env
    prefix = "CORTEX_BROWSER_"
    try:
        switch = env.get(prefix + "ALLOW_LOOPBACK_HTTP", "0")
        if switch not in {"0", "1"}:
            raise ValueError
        allow_http = switch == "1"
        gateway = GatewayConfig(env[prefix + "ORIGIN"], allow_loopback_http=allow_http)
        # The executable is a local launcher. A trusted HTTPS production topology
        # must be designed/validated separately; forwarded headers are not trusted.
        if urlsplit(gateway.origin).scheme != "http":
            raise ValueError
        api_origin = env[prefix + "API_ORIGIN"]
        _endpoint(api_origin, allow_http)
        if urlsplit(api_origin).path not in {"", "/"}:
            raise ValueError
        bind = env.get(prefix + "BIND", "127.0.0.1")
        port = int(env.get(prefix + "PORT", "8015"))
        if bind not in {"127.0.0.1", "::1"} or not 1 <= port <= 65535:
            raise ValueError
        path = env.get(prefix + "CLIENT_SECRET_FILE")
        oidc = OidcConfig(
            issuer=env[prefix + "ISSUER"],
            client_id=env[prefix + "CLIENT_ID"],
            api_audience=env[prefix + "API_AUDIENCE"],
            redirect_uri=gateway.origin + "/auth/callback",
            scope=env.get(prefix + "SCOPE", "openid"),
            client_secret=private_secret(path) if path else None,
            allow_loopback_http=allow_http,
        )
        return Settings(gateway, oidc, api_origin, bind, port)
    except (KeyError, TypeError, ValueError):
        raise LoginError("LOGIN_CONFIGURATION") from None


def build_app(settings: Settings):
    allow = settings.gateway.allow_loopback_http
    return create_app(
        settings.gateway,
        OidcProvider(settings.oidc),
        NativeIdentity(settings.api_origin, allow_loopback_http=allow),
        api_proxy=ApiProxy(settings.api_origin, allow_loopback_http=allow),
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description="Local Cortex browser session gateway")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Validate configuration without network requests or listening",
    )
    args = parser.parse_args(argv)
    try:
        settings = load_settings()
    except LoginError:
        raise SystemExit(
            "LOGIN_CONFIGURATION: check the documented CORTEX_BROWSER_* settings"
        ) from None
    if args.check:
        print("Local browser gateway configuration is valid; connectivity is not verified.")
        return
    uvicorn.run(
        build_app(settings),
        host=settings.bind,
        port=settings.port,
        workers=1,
        proxy_headers=False,
        access_log=False,
        log_level="warning",
        limit_concurrency=64,
        backlog=128,
        timeout_keep_alive=5,
        h11_max_incomplete_event_size=16384,
    )


if __name__ == "__main__":
    main()
