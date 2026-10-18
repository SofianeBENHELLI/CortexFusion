"""Fresh native identity check; no role inference or cached membership fallback."""

import asyncio
import json
from urllib.parse import urlsplit
from uuid import UUID

import httpx

from .oidc import IdentityGrant, LoginError, _endpoint, _unique_object


class NativeIdentity:
    def __init__(
        self,
        api_origin: str,
        *,
        allow_loopback_http: bool = False,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        _endpoint(api_origin, allow_loopback_http)
        if urlsplit(api_origin).path not in {"", "/"}:
            raise LoginError("LOGIN_CONFIGURATION")
        self.url = api_origin.rstrip("/") + "/v1/me"
        self._client = httpx.AsyncClient(
            transport=transport,
            follow_redirects=False,
            trust_env=False,
            timeout=10,
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )

    async def aclose(self):
        await self._client.aclose()

    async def read(self, grant: IdentityGrant) -> dict:
        try:
            async with asyncio.timeout(10):
                request = self._client.build_request(
                    "GET",
                    self.url,
                    headers={
                        "Authorization": "Bearer " + grant.access_token,
                        "X-Tenant-Id": grant.tenant,
                        "Accept": "application/json",
                        "Accept-Encoding": "identity",
                    },
                )
                request.headers.pop("cookie", None)
                response = await self._client.send(request, stream=True)
                self._client.cookies.clear()
                try:
                    if response.status_code in {401, 403}:
                        raise LoginError("SESSION_EXPIRED")
                    if (
                        response.status_code != 200
                        or response.headers.get("content-type", "").split(";")[0]
                        != "application/json"
                        or response.headers.get("content-encoding", "identity") != "identity"
                        or int(response.headers.get("content-length", "0")) > 65536
                    ):
                        raise LoginError("CORE_UNAVAILABLE")
                    body = bytearray()
                    async for chunk in response.aiter_raw():
                        if len(body) + len(chunk) > 65536:
                            raise LoginError("CORE_UNAVAILABLE")
                        body.extend(chunk)
                    return public_identity(
                        json.loads(body, object_pairs_hook=_unique_object), grant
                    )
                finally:
                    await response.aclose()
        except (
            httpx.HTTPError,
            TimeoutError,
            ValueError,
            UnicodeError,
            TypeError,
            KeyError,
            RecursionError,
        ):
            raise LoginError("CORE_UNAVAILABLE") from None


def public_identity(value: dict, grant: IdentityGrant) -> dict:
    if (
        not isinstance(value, dict)
        or value.get("subject") != grant.subject
        or value.get("tenant_id") != grant.tenant
        or not isinstance(value.get("domains"), list)
        or len(value["domains"]) > 512
        or value.get("extraction_provider") not in {None, "ollama", "openrouter"}
    ):
        raise LoginError("CORE_UNAVAILABLE")
    domains, ids = [], set()
    for domain in value["domains"]:
        ident, name, role, capabilities = (
            domain["id"],
            domain["name"],
            domain["role"],
            domain["capabilities"],
        )
        if (
            not isinstance(ident, str)
            or str(UUID(ident)) != ident
            or ident in ids
            or not isinstance(name, str)
            or not 1 <= len(name) <= 1000
            or not isinstance(role, str)
            or role not in {"owner", "corpus_manager", "contributor", "agent", "viewer"}
            or not isinstance(capabilities, list)
            or len(capabilities) > 64
            or any(not isinstance(c, str) or not 1 <= len(c) <= 128 for c in capabilities)
        ):
            raise LoginError("CORE_UNAVAILABLE")
        item = {"id": ident, "name": name, "role": role, "capabilities": capabilities}
        roles = domain.get("roles")
        revision = domain.get("membership_revision")
        if roles is not None:
            order = ["owner", "corpus_manager", "contributor", "viewer", "agent"]
            if (
                not isinstance(roles, list)
                or not 1 <= len(roles) <= 4
                or any(not isinstance(r, str) or r not in order for r in roles)
                or len(set(roles)) != len(roles)
                or ("agent" in roles and len(roles) != 1)
                or next(r for r in order if r in roles) != role
            ):
                raise LoginError("CORE_UNAVAILABLE")
            item["roles"] = roles
        if revision is not None:
            if type(revision) is not int or revision < 0:
                raise LoginError("CORE_UNAVAILABLE")
            item["membership_revision"] = revision
        ids.add(ident)
        domains.append(item)
    # Only wire-contract public fields. Ignore any unexpected upstream credential field.
    return {
        "subject": grant.subject,
        "tenant_id": grant.tenant,
        "domains": domains,
        "extraction_provider": value.get("extraction_provider"),
    }
