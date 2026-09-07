import base64
import os
from uuid import uuid4

import pytest
from cortex_core.api import create_app
from cortex_core.settings import Settings
from fastapi.testclient import TestClient
from pydantic import ValidationError

ORIGIN = "https://front.example"


def settings(identity_keys, **overrides):
    return Settings(
        database_url=os.environ.get("CORTEX_TEST_DATABASE_URL", "postgresql+pg8000://unused"),
        jwt_issuer="https://identity.test",
        jwt_public_key_file=identity_keys[1],
        **overrides,
    )


@pytest.mark.parametrize(
    "origin",
    [
        "https://front.example",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://[::1]:5173",
    ],
)
def test_cors_accepts_exact_canonical_origins(identity_keys, origin):
    assert settings(identity_keys, cors_origins=[origin]).cors_origins == [origin]


@pytest.mark.parametrize(
    "origins",
    [
        ["*"],
        ["null"],
        ["https://*.example"],
        ["http://front.example"],
        ["https://front.example/"],
        ["https://front.example/path"],
        ["https://user:secret@front.example"],
        ["https://front.example?token=value"],
        ["https://front.example#fragment"],
        [" https://front.example"],
        ["https://FRONT.example"],
        ["https://front.example:443"],
        [ORIGIN, ORIGIN],
    ],
)
def test_cors_rejects_ambiguous_or_unsafe_configuration(identity_keys, origins):
    with pytest.raises(ValidationError):
        settings(identity_keys, cors_origins=origins)


@pytest.fixture
def browser(world, identity_keys):
    with TestClient(
        create_app(settings(identity_keys, cors_origins=[ORIGIN, "http://localhost:5173"])),
        base_url="http://localhost:8000",
    ) as client:
        yield client


def test_preflight_is_unauthenticated_but_actual_requests_keep_auth_and_confirmation(
    world, browser
):
    headers = {
        "Origin": ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,x-tenant-id,content-type,x-cortex-confirmation",
    }
    for path in [world.prefix + "/publish", "/mcp/"]:
        preflight = browser.options(path, headers=headers)
        assert preflight.status_code == 200
        assert preflight.headers["access-control-allow-origin"] == ORIGIN
        assert "access-control-allow-credentials" not in preflight.headers
        response = browser.post(path, headers={"Origin": ORIGIN})
        assert response.status_code == 401
        assert response.headers["access-control-allow-origin"] == ORIGIN
        assert "www-authenticate" in response.headers["access-control-expose-headers"].lower()
    protected = browser.post(
        world.prefix + "/publish", headers={**world.headers(), "Origin": ORIGIN}
    )
    assert protected.status_code == 428
    assert protected.headers["access-control-allow-origin"] == ORIGIN


def test_disallowed_origin_cannot_mutate_even_with_valid_identity(world, browser):
    source = {
        "title": "Blocked",
        "location": "synthetic://blocked",
        "content": "Do not store this.",
        "allowed_subjects": ["alice"],
    }
    response = browser.post(
        world.prefix + "/sources",
        headers={**world.headers(), "Origin": "https://untrusted.example"},
        json=source,
    )
    assert response.status_code == 403
    assert response.json()["error"] == "ORIGIN_NOT_ALLOWED"
    assert "untrusted" not in response.text
    assert "access-control-allow-origin" not in response.headers
    assert (
        world.client.get(world.prefix + "/sources", headers=world.headers()).json()["items"] == []
    )
    duplicate = browser.get("/health", headers=[("Origin", ORIGIN), ("Origin", ORIGIN)])
    assert duplicate.status_code == 403


def test_preflight_rejects_undeclared_methods_and_headers(browser):
    common = {"Origin": ORIGIN, "Access-Control-Request-Method": "PATCH"}
    assert browser.options("/v1/me", headers=common).status_code == 400
    common.update(
        {
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "x-arbitrary-control",
        }
    )
    assert browser.options("/v1/me", headers=common).status_code == 400


def test_allowed_origin_can_use_mcp_but_cannot_change_allowed_hosts(world, browser):
    rpc = {"jsonrpc": "2.0", "id": 1, "method": "resources/list", "params": {}}
    headers = {**world.headers(), "Origin": ORIGIN, "Accept": "application/json, text/event-stream"}
    response = browser.post("/mcp/", headers=headers, json=rpc)
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ORIGIN
    response = browser.post("/mcp/", headers={**headers, "Host": "untrusted.example"}, json=rpc)
    assert response.status_code == 421


def test_binary_download_exposes_metadata_and_keeps_current_permissions(world, browser):
    collection = world.client.post(
        world.prefix + "/collections",
        headers=world.headers(),
        json={
            "name": "Browser downloads",
            "allowed_subjects": ["alice", "bob"],
            "idempotency_key": str(uuid4()),
        },
    ).json()
    raw = b"Synthetic file."
    receipt = world.client.post(
        world.prefix + "/collections/" + collection["id"] + "/files",
        headers=world.headers(),
        json={
            "filename": "example.txt",
            "content_base64": base64.b64encode(raw).decode(),
            "allowed_subjects": ["alice"],
            "idempotency_key": str(uuid4()),
        },
    ).json()
    path = world.prefix + "/files/" + receipt["id"] + "/download"
    allowed = browser.get(path, headers={**world.headers(), "Origin": ORIGIN})
    assert allowed.status_code == 200 and allowed.content == raw
    assert "content-disposition" in allowed.headers["access-control-expose-headers"].lower()
    assert allowed.headers["cache-control"] == "no-store"
    assert browser.get(path, headers={**world.headers("bob"), "Origin": ORIGIN}).status_code == 404


def test_no_origin_server_client_works_and_cors_is_disabled_by_default(world, browser):
    assert browser.get("/v1/me", headers=world.headers()).status_code == 200
    response = world.client.get("/v1/me", headers={**world.headers(), "Origin": ORIGIN})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers
