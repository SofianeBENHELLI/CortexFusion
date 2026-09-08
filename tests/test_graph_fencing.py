"""SQL barriers must survive legacy publishers and obsolete attempt identities."""

import json
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError


def execute(connection, statement, world, **parameters):
    return connection.execute(text(statement), {"t": world.tenant, "d": world.domain, **parameters})


def sqlstate(error):
    return error.orig.args[0]["C"]


def enroll(connection, world):
    execute(
        connection,
        "INSERT INTO cf_graph_protocols(tenant_id,domain_id,protocol,subject) "
        "VALUES(:t,:d,2,'alice')",
        world,
    )


def proof(connection, world, attempt, generation):
    execute(
        connection,
        "SELECT set_config('cortex.graph_attempt_id',:a,true),"
        "set_config('cortex.graph_generation',:g,true),set_config('cortex.graph_actor','alice',true)",
        world,
        a=attempt,
        g=str(generation),
    )


def initial(connection, world, attempt, intent, *, divergent=False):
    proof(connection, world, attempt, 1)
    execute(
        connection,
        "INSERT INTO cf_graph_preparations(tenant_id,domain_id,version,id,generation,subject,status,intent) "
        "VALUES(:t,:d,1,:a,1,'alice','preparing',CAST(:intent AS jsonb))",
        world,
        a=attempt,
        intent=json.dumps(intent),
    )
    execute(
        connection,
        "INSERT INTO cf_graph_attempts(tenant_id,domain_id,version,id,generation,subject,reason,intent) "
        "VALUES(:t,:d,1,:a,1,'alice','Synthetic fencing fixture',CAST(:intent AS jsonb))",
        world,
        a=attempt,
        intent=json.dumps({**intent, "count": 1} if divergent else intent),
    )


def test_initial_attempt_identity_is_checked_at_commit_and_rolls_back_enrollment(world):
    attempt = str(uuid4())
    intent = {"kind": "publish", "base_version": 0, "digest": "a" * 64, "count": 0}
    with pytest.raises(DBAPIError) as caught:
        with world.db.transaction(world.owner, world.domain, owner=True) as connection:
            initial(connection, world, attempt, intent, divergent=True)
    assert sqlstate(caught.value) == "23514"
    with world.admin.connect() as connection:
        for table in (
            "cf_graph_protocols",
            "cf_graph_attempts",
            "cf_graph_preparations",
            "cf_graph_attempt_events",
        ):
            assert (
                execute(
                    connection, f"SELECT count(*) FROM {table} WHERE tenant_id=:t", world
                ).scalar_one()
                == 0
            )
        assert (
            execute(
                connection,
                "SELECT graph_protocol FROM cf_domains WHERE tenant_id=:t AND id=:d",
                world,
            ).scalar_one()
            == 1
        )


def test_legacy_repeatable_read_publisher_is_fenced_after_concurrent_enrollment(world):
    proposal = world.proposal()
    world.approve(proposal, publish=False)
    with pytest.raises(DBAPIError) as caught:
        with world.db.transaction(world.owner, world.domain, owner=True) as old:
            assert (
                execute(
                    old, "SELECT graph_protocol FROM cf_domains WHERE tenant_id=:t AND id=:d", world
                ).scalar_one()
                == 1
            )
            with world.db.transaction(
                world.owner, world.domain, owner=True, isolation="READ COMMITTED"
            ) as new:
                enroll(new, world)
            domain = world.service._domain(old, world.owner, world.domain, lock=True)
            world.service._publish(old, world.owner, world.domain, domain)
    assert sqlstate(caught.value) == "40001"
    with pytest.raises(DBAPIError) as fresh:
        world.service.publish(world.owner, world.domain)
    assert sqlstate(fresh.value) == "23514"
    with world.admin.connect() as connection:
        assert (
            execute(
                connection,
                "SELECT published_version FROM cf_domains WHERE tenant_id=:t AND id=:d",
                world,
            ).scalar_one()
            == 0
        )
        for table in ("cf_concepts", "cf_publications", "cf_graph_manifests"):
            assert (
                execute(
                    connection, f"SELECT count(*) FROM {table} WHERE tenant_id=:t", world
                ).scalar_one()
                == 0
            )
    with pytest.raises(DBAPIError) as downgrade:
        with world.db.transaction(world.owner, world.domain, owner=True) as connection:
            execute(
                connection,
                "UPDATE cf_domains SET graph_protocol=1 WHERE tenant_id=:t AND id=:d",
                world,
            )
    assert sqlstate(downgrade.value) == "23514"


def test_superseded_attempt_cannot_activate_a_manifest_or_change_new_status(world):
    old_id, new_id = str(uuid4()), str(uuid4())
    intent = {"kind": "publish", "base_version": 0, "digest": "a" * 64, "count": 0}
    with world.db.transaction(world.owner, world.domain, owner=True) as connection:
        initial(connection, world, old_id, intent)
    with world.db.transaction(world.owner, world.domain, owner=True) as connection:
        proof(connection, world, new_id, 2)
        execute(
            connection,
            "INSERT INTO cf_graph_attempts(tenant_id,domain_id,version,id,generation,predecessor_id,subject,reason,idempotency_key,fingerprint,intent) "
            "VALUES(:t,:d,1,:new,2,:old,'alice','Explicit replacement','replacement-one',:fingerprint,CAST(:intent AS jsonb))",
            world,
            new=new_id,
            old=old_id,
            fingerprint="b" * 64,
            intent=json.dumps(intent),
        )
        assert (
            execute(
                connection,
                "UPDATE cf_graph_preparations SET id=:new,generation=2,status='preparing' "
                "WHERE tenant_id=:t AND domain_id=:d AND id=:old AND generation=1",
                world,
                new=new_id,
                old=old_id,
            ).rowcount
            == 1
        )
    with pytest.raises(DBAPIError) as caught:
        with world.db.transaction(world.owner, world.domain, owner=True) as connection:
            execute(
                connection,
                "INSERT INTO cf_graph_manifests(tenant_id,domain_id,version,attempt_id,generation,snapshot) "
                "VALUES(:t,:d,1,:old,1,CAST(:snapshot AS jsonb))",
                world,
                old=old_id,
                snapshot=json.dumps(
                    {
                        "database": "cf_snapshot_" + old_id.replace("-", ""),
                        "commit": "old",
                        "digest": "a" * 64,
                        "count": 0,
                    }
                ),
            )
    assert sqlstate(caught.value) == "23514"
    with world.db.transaction(world.owner, world.domain, owner=True) as connection:
        assert (
            execute(
                connection,
                "UPDATE cf_graph_preparations SET status='uncertain' WHERE tenant_id=:t AND domain_id=:d AND id=:old",
                world,
                old=old_id,
            ).rowcount
            == 0
        )
        assert (
            execute(
                connection,
                "SELECT status FROM cf_graph_preparations WHERE tenant_id=:t AND domain_id=:d",
                world,
            ).scalar_one()
            == "preparing"
        )
        assert (
            execute(
                connection,
                "SELECT count(*) FROM cf_graph_attempt_events WHERE tenant_id=:t AND kind='superseded'",
                world,
            ).scalar_one()
            == 1
        )
