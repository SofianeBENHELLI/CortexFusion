"""SQL audit survives legacy writers and cannot outlive a rolled-back ACL change."""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError


def events(conn, tenant, source):
    return (
        conn.execute(
            text(
                "SELECT actor,actor_source,previous_allowed_subjects,allowed_subjects FROM cf_source_access_events WHERE tenant_id=:t AND source_id=:s ORDER BY ordinal"
            ),
            {"t": tenant, "s": source},
        )
        .mappings()
        .all()
    )


def scope(conn, tenant):
    conn.execute(text("SELECT set_config('cortex.tenant',:t,true)"), {"t": tenant})


def change(conn, tenant, source, acl):
    conn.execute(
        text(
            "UPDATE cf_sources SET allowed_subjects=CAST(:acl AS jsonb) WHERE tenant_id=:t AND id=:s"
        ),
        {"t": tenant, "s": source, "acl": acl},
    )


def test_atomic_audit_legacy_writer_noop_and_transaction_local_actor(world):
    source = world.source()["id"]
    with world.db.engine.connect() as conn:
        with conn.begin():
            scope(conn, world.tenant)
            conn.execute(text("SELECT set_config('cortex.source_access_actor','alice',true)"))
            change(conn, world.tenant, source, '["alice"]')
            assert events(conn, world.tenant, source)[0]["actor"] == "alice"
        with conn.begin():
            scope(conn, world.tenant)
            assert not conn.execute(
                text("SELECT current_setting('cortex.source_access_actor',true)")
            ).scalar_one()
            change(conn, world.tenant, source, '["alice","bob"]')
            rows = events(conn, world.tenant, source)
            assert (
                len(rows) == 2
                and rows[-1]["actor"] is None
                and rows[-1]["actor_source"] == "unattributed"
            )
            change(conn, world.tenant, source, '["bob","alice","alice"]')
            assert len(events(conn, world.tenant, source)) == 2
        tx = conn.begin()
        scope(conn, world.tenant)
        change(conn, world.tenant, source, '["alice"]')
        assert len(events(conn, world.tenant, source)) == 3
        tx.rollback()
        with conn.begin():
            scope(conn, world.tenant)
            assert len(events(conn, world.tenant, source)) == 2
            assert conn.execute(
                text("SELECT allowed_subjects FROM cf_sources WHERE tenant_id=:t AND id=:s"),
                {"t": world.tenant, "s": source},
            ).scalar_one() == ["bob", "alice", "alice"]


def test_audit_failure_rolls_back_access_change_and_events_are_not_forgeable(world):
    source = world.source()["id"]
    with pytest.raises(DBAPIError):
        with world.db.engine.begin() as conn:
            scope(conn, world.tenant)
            conn.execute(
                text("SELECT set_config('cortex.source_access_actor',:a,true)"), {"a": "a" * 301}
            )
            change(conn, world.tenant, source, '["alice"]')
    with world.db.engine.begin() as conn:
        scope(conn, world.tenant)
        assert events(conn, world.tenant, source) == []
        assert conn.execute(
            text("SELECT allowed_subjects FROM cf_sources WHERE tenant_id=:t AND id=:s"),
            {"t": world.tenant, "s": source},
        ).scalar_one() == ["agent", "alice", "bob"]
        change(conn, world.tenant, source, '["alice"]')
    for statement in [
        "DELETE FROM cf_source_access_events WHERE tenant_id=:t",
        "UPDATE cf_source_access_events SET actor='forged' WHERE tenant_id=:t",
        "INSERT INTO cf_source_access_events(tenant_id,domain_id,source_id,actor_source,previous_allowed_subjects,allowed_subjects) VALUES(:t,:d,:s,'unattributed','[\"alice\"]','[\"bob\"]')",
    ]:
        with pytest.raises(DBAPIError):
            with world.db.engine.begin() as conn:
                scope(conn, world.tenant)
                conn.execute(text(statement), {"t": world.tenant, "d": world.domain, "s": source})
    with world.db.engine.begin() as conn:
        scope(conn, world.other_tenant)
        assert events(conn, world.tenant, source) == []
    with pytest.raises(DBAPIError):
        with world.admin.begin() as conn:
            conn.execute(
                text("UPDATE cf_source_access_events SET actor='forged' WHERE tenant_id=:t"),
                {"t": world.tenant},
            )
