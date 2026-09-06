from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from cortex_core.contracts import AccessInput
from sqlalchemy import text


def call(w, method, path, data=None, expected=200, subject="bob"):
    r = w.client.request(
        method, w.prefix + "/conversations" + path, json=data, headers=w.headers(subject)
    )
    assert r.status_code == expected, r.text
    return r.json()


def create(w):
    data = {"title": "Incidents", "idempotency_key": str(uuid4())}
    c = call(w, "POST", "", data, 201)
    assert call(w, "POST", "", data, 201) == c
    return c


def test_conversation_question_idempotence_and_chronology(world):
    world.approve(world.proposal())
    c = create(world)
    data = {"question": "incident", "idempotency_key": str(uuid4())}
    first = call(world, "POST", f"/{c['id']}/query", data)
    assert call(world, "POST", f"/{c['id']}/query", data) == first
    call(world, "POST", f"/{c['id']}/query", {**data, "question": "changed"}, 409)
    call(world, "POST", f"/{c['id']}/query", {**data, "idempotency_key": str(uuid4())})
    page = call(world, "GET", f"/{c['id']}/messages?limit=1")
    rest = call(world, "GET", f"/{c['id']}/messages?after={page['next_after']}")
    assert [page["items"][0]["sequence"], rest["items"][0]["sequence"]] == [1, 2]
    assert rest["next_after"] is None
    assert page["items"][0]["result"] == first


def test_conversation_is_personal_even_to_owner(world):
    c = create(world)
    call(world, "GET", f"/{c['id']}", subject="alice", expected=404)
    call(world, "GET", f"/{c['id']}/messages", subject="alice", expected=404)
    assert call(world, "GET", "", subject="alice")["items"] == []


def test_archive_restore_and_metadata_conflicts(world):
    c = create(world)
    updated = call(
        world, "PUT", f"/{c['id']}", {"title": "Archived", "archived": True, "expected_revision": 0}
    )
    assert updated["revision"] == 1
    assert call(world, "GET", "")["items"] == []
    assert call(world, "GET", "?archived=true")["items"][0]["id"] == c["id"]
    call(
        world,
        "POST",
        f"/{c['id']}/query",
        {"question": "incident", "idempotency_key": str(uuid4())},
        409,
    )
    call(
        world,
        "PUT",
        f"/{c['id']}",
        {"title": "Restored", "archived": False, "expected_revision": 0},
        409,
    )
    call(
        world,
        "PUT",
        f"/{c['id']}",
        {"title": "Restored", "archived": False, "expected_revision": 1},
    )
    assert (
        call(
            world,
            "POST",
            f"/{c['id']}/query",
            {"question": "incident", "idempotency_key": str(uuid4())},
        )["status"]
        == "knowledge_gap"
    )


def test_revocation_hides_messages_and_retry_receipt(world):
    s = world.source()
    world.approve(world.proposal(s))
    c = create(world)
    data = {"question": "incident", "idempotency_key": str(uuid4())}
    call(world, "POST", f"/{c['id']}/query", data)
    world.service.set_access(
        world.owner, world.domain, s["id"], AccessInput(allowed_subjects=["alice"])
    )
    assert call(world, "GET", f"/{c['id']}/messages")["items"] == []
    call(world, "POST", f"/{c['id']}/query", data, 404)


def test_concurrent_same_question_creates_one_episode(world):
    c = create(world)
    data = {"question": "incident", "idempotency_key": str(uuid4())}

    def ask(_):
        return world.client.post(
            world.prefix + f"/conversations/{c['id']}/query",
            json=data,
            headers=world.headers("bob"),
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(ask, range(2)))
    assert all(r.status_code == 200 for r in results)
    assert results[0].json() == results[1].json()
    with world.admin.begin() as conn:
        count = conn.execute(
            text("SELECT count(*) FROM cf_episodes WHERE tenant_id=:t AND domain_id=:d"),
            {"t": world.tenant, "d": world.domain},
        ).scalar_one()
        assert count == 1
