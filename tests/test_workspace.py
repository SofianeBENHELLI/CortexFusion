from uuid import uuid4

import pytest
from cortex_core.contracts import AccessInput, QueryInput
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError


def request(w, method, path, data=None, subject="alice", expected=200):
    r = w.client.request(method, w.prefix + path, json=data, headers=w.headers(subject))
    assert r.status_code == expected, r.text
    return r.json()


def review(w, p, action, revision=0, key=None, expected=201):
    return request(
        w,
        "POST",
        f"/proposals/{p['id']}/reviews",
        {
            "action": action,
            "digest": p["digest"],
            "expected_review_revision": revision,
            "reason": "Synthetic review",
            "idempotency_key": key or str(uuid4()),
        },
        expected=expected,
    )


def test_identity_only_own_memberships_and_role_derived_capabilities(world):
    r = world.client.get("/v1/me", headers=world.headers("bob", role="owner"))
    assert r.status_code == 200
    me = r.json()
    assert [d["id"] for d in me["domains"]] == [world.domain]
    assert me["domains"][0]["role"] == "viewer"
    assert "approve" not in me["domains"][0]["capabilities"]
    assert world.client.get("/v1/me", headers=world.headers("unknown")).json()["domains"] == []


def test_review_idempotence_conflicts_and_stale_approval(world):
    p = world.proposal()
    key = str(uuid4())
    receipt = review(world, p, "defer", key=key)
    assert review(world, p, "defer", key=key) == receipt
    review(world, p, "reject", key=key, expected=409)
    review(world, p, "reopen", revision=0, expected=409)
    review(world, p, "reopen", revision=1)
    data = {
        "digest": p["digest"],
        "expected_version": 0,
        "reason": "Approve",
        "idempotency_key": str(uuid4()),
    }
    request(world, "POST", f"/proposals/{p['id']}/approve", data, expected=409)
    request(world, "POST", f"/proposals/{p['id']}/approve", {**data, "expected_review_revision": 2})
    request(world, "POST", "/publish")
    assert len(world.service.concepts(world.owner, world.domain)) == 1


def test_revision_preserves_original_and_prevents_old_approval(world):
    p = world.proposal()
    review(world, p, "request_changes")
    data = {
        "base_version": 0,
        "changes": p["payload"],
        "reason": "Revised explanation",
        "idempotency_key": str(uuid4()),
    }
    revised = request(world, "POST", f"/proposals/{p['id']}/revise", data, expected=201)
    assert revised["id"] != p["id"] and revised["replaces_id"] == p["id"]
    assert request(world, "POST", f"/proposals/{p['id']}/revise", data, expected=201) == revised
    old = request(world, "GET", f"/proposals/{p['id']}")
    assert old["status"] == "superseded" and old["reason"] == p["reason"]
    with pytest.raises(Exception, match="changed"):
        world.approve(p)
    world.approve(revised)
    review(world, revised, "reject", expected=409)


def test_rejected_proposal_is_not_reopened(world):
    p = world.proposal()
    review(world, p, "reject")
    review(world, p, "reopen", revision=1, expected=409)
    assert request(world, "GET", "/proposals?status=rejected")["items"][0]["id"] == p["id"]


def test_review_permissions_and_immutable_receipts(world):
    p = world.proposal()
    data = {
        "action": "reject",
        "digest": p["digest"],
        "expected_review_revision": 0,
        "reason": "No",
        "idempotency_key": str(uuid4()),
    }
    request(world, "POST", f"/proposals/{p['id']}/reviews", data, subject="agent", expected=403)
    receipt = request(world, "POST", f"/proposals/{p['id']}/reviews", data, expected=201)
    with pytest.raises(DBAPIError), world.admin.begin() as conn:
        conn.execute(
            text("DELETE FROM cf_reviews WHERE tenant_id=:t AND id=:id"),
            {"t": world.tenant, "id": receipt["id"]},
        )
    assert request(world, "GET", f"/proposals/{p['id']}/reviews")["items"] == [receipt]


def test_proposal_pages_hide_restricted_entries_and_cursor(world):
    visible = [world.proposal(), world.proposal()]
    private = world.proposal(world.source(subjects=["alice"]))
    page = request(world, "GET", "/proposals?limit=1", subject="agent")
    rest = request(world, "GET", f"/proposals?limit=1&after={page['next_after']}", subject="agent")
    assert [page["items"][0]["id"], rest["items"][0]["id"]] == sorted(p["id"] for p in visible)
    assert rest["next_after"] is None
    assert private["id"] not in str(page) + str(rest)
    request(world, "GET", "/proposals", subject="bob", expected=403)


def test_personal_episode_history_applies_current_acl(world):
    source = world.source()
    world.approve(world.proposal(source))
    result = world.service.query(world.viewer, world.domain, QueryInput(question="incident"))
    assert request(world, "GET", "/episodes")["items"] == []
    assert (
        request(world, "GET", "/episodes", subject="bob")["items"][0]["id"] == result["episode_id"]
    )
    world.service.set_access(
        world.owner, world.domain, source["id"], AccessInput(allowed_subjects=["alice"])
    )
    assert request(world, "GET", "/episodes", subject="bob") == {"items": [], "next_after": None}


def test_revocation_hides_review_and_revision_lineage(world):
    source = world.source()
    old = world.proposal(source)
    review(world, old, "request_changes")
    alternative = world.proposal()
    revised = request(
        world,
        "POST",
        f"/proposals/{old['id']}/revise",
        {
            "base_version": 0,
            "changes": alternative["payload"],
            "reason": "Replacement",
            "idempotency_key": str(uuid4()),
        },
        expected=201,
    )
    world.service.set_access(
        world.owner, world.domain, source["id"], AccessInput(allowed_subjects=["bob"])
    )
    request(world, "GET", f"/proposals/{old['id']}/reviews", expected=404)
    request(world, "GET", f"/proposals/{revised['id']}", expected=404)
    assert revised["id"] not in str(request(world, "GET", "/proposals"))
