"""Bounded single-process sessions. Restart revokes all sessions; no refresh yet."""

import asyncio
import hashlib
import hmac
import math
import re
import secrets
import time
from dataclasses import dataclass, field, replace

from .oidc import IdentityGrant, LoginError


@dataclass(frozen=True)
class Session:
    grant: IdentityGrant = field(repr=False)
    csrf_token: str = field(repr=False)
    expires_at: float
    deadline: float
    idle_deadline: float


@dataclass(frozen=True)
class SessionStart:
    cookie: str = field(repr=False)
    session: Session = field(repr=False)
    max_age: int


def _key(cookie: str | None) -> bytes | None:
    if not isinstance(cookie, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", cookie):
        return None
    return hashlib.sha256(cookie.encode("ascii")).digest()


class SessionStore:
    def __init__(
        self, *, capacity: int = 256, idle_seconds: int = 1800, absolute_seconds: int = 28800
    ):
        if (
            type(capacity) is not int
            or not 1 <= capacity <= 4096
            or type(idle_seconds) is not int
            or type(absolute_seconds) is not int
            or not 1 <= idle_seconds <= absolute_seconds <= 86400
        ):
            raise LoginError("LOGIN_CONFIGURATION")
        self.capacity, self.idle_seconds, self.absolute_seconds = (
            capacity,
            idle_seconds,
            absolute_seconds,
        )
        self._sessions: dict[bytes, Session] = {}
        self._lock = asyncio.Lock()

    def _prune(self):
        now, wall = time.monotonic(), time.time()
        self._sessions = {
            key: session
            for key, session in self._sessions.items()
            if now < min(session.deadline, session.idle_deadline) and wall < session.expires_at
        }

    async def create(
        self, grant: IdentityGrant, *, previous: str | None = None, require_previous: bool = False
    ) -> SessionStart:
        async with self._lock:
            self._prune()
            wall, now = time.time(), time.monotonic()
            lifetime = min(grant.expires_at - wall, self.absolute_seconds)
            if not math.isfinite(lifetime) or lifetime < 1:
                raise LoginError("SESSION_EXPIRED")
            prior_key = _key(previous)
            if require_previous and prior_key not in self._sessions:
                raise LoginError("SESSION_EXPIRED")
            if len(self._sessions) >= self.capacity and prior_key not in self._sessions:
                raise LoginError("SESSION_CAPACITY")
            cookie = secrets.token_urlsafe(32)
            # Refresh credentials are intentionally discarded until renewal is implemented.
            session = Session(
                replace(grant, refresh_token=None),
                secrets.token_urlsafe(32),
                wall + lifetime,
                now + lifetime,
                now + min(lifetime, self.idle_seconds),
            )
            self._sessions.pop(prior_key, None)
            self._sessions[_key(cookie)] = session
            return SessionStart(cookie, session, math.floor(lifetime))

    async def get(self, cookie: str | None, *, touch: bool = False) -> Session:
        async with self._lock:
            self._prune()
            key = _key(cookie)
            session = self._sessions.get(key)
            if session is None:
                raise LoginError("SESSION_EXPIRED")
            if touch:
                session = replace(
                    session,
                    idle_deadline=min(session.deadline, time.monotonic() + self.idle_seconds),
                )
                self._sessions[key] = session
            return session

    async def remove(self, cookie: str | None):
        async with self._lock:
            self._sessions.pop(_key(cookie), None)

    async def clear(self):
        async with self._lock:
            self._sessions.clear()

    @staticmethod
    def check_csrf(session: Session, token: str | None):
        if (
            not isinstance(token, str)
            or not re.fullmatch(r"[A-Za-z0-9_-]{43}", token)
            or not hmac.compare_digest(session.csrf_token, token)
        ):
            raise LoginError("REQUEST_REJECTED")
