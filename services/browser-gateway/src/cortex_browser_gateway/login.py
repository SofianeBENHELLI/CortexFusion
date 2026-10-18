"""Single-use, browser-bound authorization attempts and validated return context."""

import asyncio
import hashlib
import hmac
import re
import secrets
import time
from dataclasses import dataclass, field

from .oidc import IdentityGrant, LoginError, OidcProvider
from .return_route import safe_return_route


@dataclass(frozen=True)
class LoginStart:
    authorization_url: str = field(repr=False)
    binding_cookie: str = field(repr=False)
    expires_in: int


@dataclass(frozen=True)
class _Attempt:
    binding_hash: bytes = field(repr=False)
    nonce: str = field(repr=False)
    verifier: str = field(repr=False)
    deadline: float
    return_to: str


@dataclass(frozen=True)
class LoginCompletion:
    grant: IdentityGrant = field(repr=False)
    return_to: str


class LoginAttempts:
    def __init__(self, provider: OidcProvider, *, capacity: int = 256, ttl_seconds: int = 300):
        if (
            type(capacity) is not int
            or not 1 <= capacity <= 4096
            or type(ttl_seconds) is not int
            or not 1 <= ttl_seconds <= 300
        ):
            raise LoginError("LOGIN_CONFIGURATION")
        self.provider, self.capacity, self.ttl_seconds = provider, capacity, ttl_seconds
        self._attempts: dict[str, _Attempt] = {}
        self._lock = asyncio.Lock()

    def _prune(self):
        now = time.monotonic()
        self._attempts = {k: v for k, v in self._attempts.items() if v.deadline > now}

    async def begin(self, *, return_to: str = "/") -> LoginStart:
        return_to = safe_return_route(return_to)
        state, nonce, verifier, binding = [secrets.token_urlsafe(32) for _ in range(4)]
        # Discovery does not hold a store slot; insertion is bounded and atomic.
        url = await self.provider.authorization_url(state, nonce, verifier)
        async with self._lock:
            self._prune()
            if len(self._attempts) >= self.capacity:
                raise LoginError("LOGIN_CAPACITY")
            self._attempts[state] = _Attempt(
                hashlib.sha256(binding.encode()).digest(),
                nonce,
                verifier,
                time.monotonic() + self.ttl_seconds,
                return_to,
            )
        return LoginStart(url, binding, self.ttl_seconds)

    async def _take(self, state: str, binding_cookie: str) -> _Attempt:
        if any(
            not isinstance(v, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43,128}", v)
            for v in (state, binding_cookie)
        ):
            raise LoginError()
        async with self._lock:
            self._prune()
            attempt = self._attempts.get(state)
            if attempt is None or not hmac.compare_digest(
                attempt.binding_hash, hashlib.sha256(binding_cookie.encode()).digest()
            ):
                raise LoginError()
            del self._attempts[state]
            return attempt

    async def cancel(self, *, state: str, binding_cookie: str):
        await self._take(state, binding_cookie)

    async def cancel_binding(self, binding_cookie: str | None):
        if not isinstance(binding_cookie, str) or not re.fullmatch(
            r"[A-Za-z0-9_-]{43}", binding_cookie
        ):
            return
        binding_hash = hashlib.sha256(binding_cookie.encode("ascii")).digest()
        async with self._lock:
            self._prune()
            self._attempts = {
                key: attempt
                for key, attempt in self._attempts.items()
                if not hmac.compare_digest(attempt.binding_hash, binding_hash)
            }

    async def clear(self):
        async with self._lock:
            self._attempts.clear()

    async def has_pending_binding(self, binding_cookie: str | None) -> bool:
        if not isinstance(binding_cookie, str) or not re.fullmatch(
            r"[A-Za-z0-9_-]{43}", binding_cookie
        ):
            return False
        binding_hash = hashlib.sha256(binding_cookie.encode("ascii")).digest()
        async with self._lock:
            self._prune()
            return any(
                hmac.compare_digest(a.binding_hash, binding_hash) for a in self._attempts.values()
            )

    async def complete_with_return(
        self, *, state: str, binding_cookie: str, code: str
    ) -> LoginCompletion:
        attempt = await self._take(state, binding_cookie)
        # Consume before exchange. Timeout/unknown outcome needs a new login;
        # neither a replay nor a second concurrent callback resubmits the code.
        grant = await self.provider.exchange(code, attempt.nonce, attempt.verifier)
        return LoginCompletion(grant, attempt.return_to)

    async def complete(self, *, state: str, binding_cookie: str, code: str) -> IdentityGrant:
        return (
            await self.complete_with_return(state=state, binding_cookie=binding_cookie, code=code)
        ).grant
