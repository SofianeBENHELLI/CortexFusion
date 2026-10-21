import time
from contextlib import contextmanager

import pytest
from cortex_core.auth import CoreError
from cortex_core.readiness import SCHEMA_REVISION, ReadinessService, verify_schema
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

    class Unreachable:
        def begin(self):
            raise RuntimeError("PRIVATE_CONNECTION_STRING_AND_PASSWORD")

        def dispose(self):
            pass

    # The probe connection is bounded: one session and a short driver timeout.
    seen = {}
    monkeypatch.setattr(module, "create_engine", lambda *a, **k: seen.update(k) or Unreachable())
    module.ReadinessService(world.db)
    assert (seen["connect_args"]["timeout"], seen["pool_size"], seen["max_overflow"]) == (2, 1, 0)
    monkeypatch.setattr(world.app.state.readiness, "engine", Unreachable())
    response = world.client.get("/ready")
    assert response.status_code == 503
    assert response.json() == {
        "error": "NOT_READY",
        "message": "Backend database readiness checks failed",
    }
    assert "PRIVATE" not in response.text
    assert world.client.get("/health").status_code == 200


def test_readiness_uses_one_dedicated_connection_and_fails_fast_when_busy(world):
    readiness = ReadinessService(world.db)
    try:
        assert readiness.check()["status"] == "ready"
        assert readiness.check()["status"] == "ready"
        assert (readiness.engine.pool.size(), readiness.engine.pool.checkedin()) == (1, 1)
        with readiness.engine.connect():  # hold its only connection
            started = time.monotonic()
            with pytest.raises(CoreError) as raised:
                readiness.check()
            assert raised.value.status == 503
            assert time.monotonic() - started < 3
    finally:
        readiness.dispose()
