"""Configured protected-resource discovery; the external issuer owns login and token issuance."""

from urllib.parse import urlsplit

from fastapi import APIRouter
from mcp.server.transport_security import TransportSecuritySettings

from .auth import CoreError
from .contracts import ProtectedResourceMetadata


def metadata_url(settings):
    if not settings.mcp_public_url:
        return None
    parsed = urlsplit(settings.mcp_public_url)
    return f"{parsed.scheme}://{parsed.netloc}/.well-known/oauth-protected-resource"


def challenge(settings):
    url = metadata_url(settings)
    return f'Bearer resource_metadata="{url}"' if url else "Bearer"


def transport_security(settings):
    if not settings.mcp_public_url:
        return None
    parsed = urlsplit(settings.mcp_public_url)
    return TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=["127.0.0.1:*", "localhost:*", "[::1]:*", parsed.netloc],
        allowed_origins=[
            "http://127.0.0.1:*",
            "http://localhost:*",
            "http://[::1]:*",
            f"{parsed.scheme}://{parsed.netloc}",
        ],
    )


def discovery_router(settings):
    router = APIRouter(tags=["mcp-discovery"])

    @router.get(
        "/.well-known/oauth-protected-resource",
        response_model=ProtectedResourceMetadata,
        responses={404: {"description": "Public MCP resource discovery is not configured."}},
    )
    def protected_resource():
        if not settings.mcp_public_url:
            raise CoreError(
                "DISCOVERY_DISABLED", "Public MCP resource discovery is not configured", 404
            )
        return {
            "resource": settings.mcp_public_url,
            "authorization_servers": [settings.jwt_issuer],
            "bearer_methods_supported": ["header"],
            "resource_name": "Cortex Fusion",
        }

    return router
