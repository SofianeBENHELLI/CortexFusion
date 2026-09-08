from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import uuid4

import pytest
from cortex_core.auth import CoreError
from cortex_core.contracts import AccessInput, QueryInput
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError


def call(w, method, path, data=None, expected=200, subject="alice"):
    r = w.client.request(method, w.prefix + path, json=data, headers=w.headers(subject))
    assert r.status_code == expected, r.text
    return r.json()


def change(w, subject, role, revision, expected=201):
    return call(
        w,
        "POST",
        "/members",
        {
            "subject": subject,
            "role": role,
            "expected_revision": revision,
            "reason": "Synthetic access decision",
            "idempotency_key": str(uuid4()),
        },
        expected,
    )


def test_owner_guard_and_member_scope(world):
    change(world, "alice", "viewer", 0, 409)
    call(world, "GET", "/members", subject="bob", expected=403)
    changed = change(world, "bob", "owner", 0)
    assert changed["resulting_revision"] == 1
    assert (
        world.client.get("/v1/me", headers=world.headers("bob")).json()["domains"][0]["role"]
        == "owner"
    )
    change(world, "alice", "viewer", 0)
    call(world, "GET", "/members", expected=403)


def test_membership_revision_does_not_reset_after_removal(world):
    change(world, "bob", None, 0)
    assert world.client.get("/v1/me", headers=world.headers("bob")).json()["domains"] == []
    receipt = change(world, "bob", "viewer", None)
    assert receipt["resulting_revision"] == 2
    change(world, "bob", "owner", 0, 409)
    change(world, "bob", "corpus_manager", 2)


def test_membership_receipts_idempotent_and_immutable(world):
    data = {
        "subject": "new-subject",
        "role": "viewer",
        "expected_revision": None,
        "reason": "Synthetic",
        "idempotency_key": str(uuid4()),
    }
    first = call(world, "POST", "/members", data, 201)
    assert call(world, "POST", "/members", data, 201) == first
    call(world, "POST", "/members", {**data, "role": "owner"}, 409)
    with pytest.raises(DBAPIError), world.admin.begin() as conn:
        conn.execute(
            text("DELETE FROM cf_membership_events WHERE tenant_id=:t AND id=:id"),
            {"t": world.tenant, "id": first["id"]},
        )
    assert call(world, "GET", "/membership-events")["items"] == [first]


def test_membership_revocation_blocks_inflight_answer(world, monkeypatch):
    world.approve(world.proposal())
    ready, resume = Event(), Event()
    original = world.service._state

    def paused(*args):
        ready.set()
        assert resume.wait(5)
        return original(*args)

    monkeypatch.setattr(world.service, "_state", paused)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(
            world.service.query, world.viewer, world.domain, QueryInput(question="incident")
        )
        assert ready.wait(5)
        change(world, "bob", None, 0)
        resume.set()
        with pytest.raises(CoreError, match="Domain"):
            pending.result(5)


def test_commit_journal_and_diff_use_original_before_state(world):
    p = world.proposal()
    before = call(world, "GET", f"/proposals/{p['id']}/diff")
    assert before["items"][0]["before"] is None
    world.approve(p)
    first = call(world, "GET", "/commits")["items"][0]
    assert first["sequence"] == 1
    world.approve(world.proposal(concept_id=p["payload"][0]["concept"]["concept_id"]))
    historical = call(world, "GET", f"/proposals/{p['id']}/diff")
    assert historical["comparison"] == "accepted_before_state"
    assert historical["items"][0]["before"] is None


def test_commit_listing_hides_revoked_evidence(world):
    source = world.source()
    world.approve(world.proposal(source))
    world.service.set_access(
        world.owner, world.domain, source["id"], AccessInput(allowed_subjects=["bob"])
    )
    assert call(world, "GET", "/commits") == {"items": [], "next_after": None}
