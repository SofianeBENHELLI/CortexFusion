import threading
import time
from dataclasses import dataclass
from uuid import UUID

import jwt

from .settings import Settings


class CoreError(Exception):
    def __init__(self, code: str, message: str, status: int = 409):
        self.code, self.message, self.status = code, message, status
        super().__init__(message)


@dataclass(frozen=True)
class Principal:
    subject: str
    tenant_id: str


class ThrottledJWKClient(jwt.PyJWKClient):
    """JWKS client whose unknown-kid refetches are rate limited and time bounded.

    PyJWKClient refetches the key set for every token carrying an unknown kid, so any
    caller could otherwise force one blocking fetch per request. As in the browser
    gateway, at most one such refresh starts per interval; other misses fail at once.
    """

    def __init__(self, uri: str, refresh_interval: float = 5, timeout: float = 5):
        super().__init__(uri, timeout=timeout)
        self.refresh_interval = refresh_interval
        self._refresh_lock = threading.Lock()
        self._next_refresh = 0.0

    def get_signing_key(self, kid: str) -> jwt.PyJWK:
        signing_key = self.match_kid(self.get_signing_keys(), kid)
        if signing_key:
            return signing_key
        with self._refresh_lock:
            now = time.monotonic()
            refresh = now >= self._next_refresh
            if refresh:
                self._next_refresh = now + self.refresh_interval
        if refresh:
            signing_key = self.match_kid(self.get_signing_keys(refresh=True), kid)
        if not signing_key:
            raise jwt.PyJWKClientError("No signing key matches the token")
        return signing_key


class Authenticator:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.public_key = (
            settings.jwt_public_key_file.read_text() if settings.jwt_public_key_file else None
        )
        self.jwks = ThrottledJWKClient(settings.jwks_url) if settings.jwks_url else None

    def authenticate(self, authorization: str | None, tenant: str | None) -> Principal:
        try:
            if not authorization or not authorization.startswith("Bearer "):
                raise ValueError("missing bearer")
            tenant_id = str(UUID(tenant or ""))
            token = authorization.removeprefix("Bearer ")
            key = self.jwks.get_signing_key_from_jwt(token).key if self.jwks else self.public_key
            claims = jwt.decode(
                token,
                key,
                algorithms=["RS256"],
                audience=self.settings.jwt_audience,
                issuer=self.settings.jwt_issuer,
                options={"require": ["exp", "iat", "iss", "aud", "sub"]},
            )
            subject = claims["sub"]
            if not isinstance(subject, str) or not subject or len(subject) > 300:
                raise ValueError("invalid subject")
            return Principal(subject, tenant_id)
        except (jwt.PyJWTError, ValueError, TypeError) as exc:
            raise CoreError(
                "NOT_AUTHORIZED", "Valid identity and tenant are required", 401
            ) from exc
