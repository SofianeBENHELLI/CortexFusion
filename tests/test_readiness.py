from contextlib import contextmanager

import pytest
from cortex_core.readiness import SCHEMA_REVISION, verify_schema
from sqlalchemy import text


@contextmanager
def temporary_schema(world, statement):
    with world.admin.connect() as conn:
        transaction = conn.begin()
        try:
            conn.execute(text(statement))
            conn.execute(text("SET LOCAL ROLE cortex_app"))
            yield conn
        finally:
            transaction.rollback()


def test_ready_is_public_and_mcp_equivalent(world):
    response = world.client.get("/ready")
    assert response.status_code == 200, response.text
    assert response.json() == {"status": "ready", "schema_revision": SCHEMA_REVISION}
    result = world.client.post(
        "/mcp/",
        headers={**world.headers("bob"), "Accept": "application/json, text/event-stream"},
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "api_system_ready", "arguments": {}},
        },
    ).json()["result"]
    assert not result.get("isError") and result["structuredContent"]["data"] == response.json()


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE alembic_version SET version_num='outdated'",
        "ALTER TABLE cf_synthesis_attempts DISABLE ROW LEVEL SECURITY",
        "ALTER TABLE cf_synthesis_outcomes NO FORCE ROW LEVEL SECURITY",
        "ALTER TABLE cf_synthesis_attempts RENAME TO synthetic_missing_table",
        "REVOKE SELECT ON cf_sources FROM cortex_app",
    ],
)
def test_readiness_rejects_incompatible_database_without_persisting_changes(world, statement):
    with temporary_schema(world, statement) as conn:
        assert not verify_schema(conn)
    assert world.client.get("/ready").status_code == 200


def test_readiness_rejects_privileged_role(world):
    with world.admin.connect() as conn:
        assert not verify_schema(conn)


def test_unreachable_database_returns_safe_503_while_liveness_stays_ok(world, monkeypatch):
    import cortex_core.readiness as module

    def failure(*args, **kwargs):
        assert kwargs["connect_args"]["timeout"] == 2
        raise RuntimeError("PRIVATE_CONNECTION_STRING_AND_PASSWORD")

    monkeypatch.setattr(module, "create_engine", failure)
    response = world.client.get("/ready")
    assert response.status_code == 503
    assert response.json() == {
        "error": "NOT_READY",
        "message": "Backend database readiness checks failed",
    }
    assert "PRIVATE" not in response.text
    assert world.client.get("/health").status_code == 200
