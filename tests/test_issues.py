from uuid import uuid4

import pytest
from cortex_core.contracts import AccessInput, FeedbackInput, QueryInput
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError


def call(w, method, path, data=None, subject="alice", expected=200):
    response = w.client.request(method, w.prefix + path, json=data, headers=w.headers(subject))
    assert response.status_code == expected, response.text
    return response.json()


def gap(w, principal=None):
    w.service.query(principal or w.owner, w.domain, QueryInput(question="Question sans réponse"))
    subject = (principal or w.owner).subject
    return call(w, "GET", "/issues", subject=subject)["items"][0]


def decision(action, revision):
    return {
        "action": action,
        "expected_revision": revision,
        "reason": "Décision synthétique",
        "idempotency_key": str(uuid4()),
    }


def test_issue_lifecycle_and_immutable_receipts(world):
    issue = gap(world)
    path = f"/issues/{issue['id']}"
    start = decision("start", 0)
    receipt = call(world, "POST", path + "/decisions", start, expected=201)
    assert receipt["status"] == "in_progress" and receipt["revision"] == 1
    assert call(world, "POST", path + "/decisions", start, expected=201) == receipt
    call(world, "POST", path + "/decisions", decision("resolve", 0), expected=409)
    call(world, "POST", path + "/decisions", {**start, "reason": "changed"}, expected=409)
    call(world, "POST", path + "/decisions", decision("resolve", 1), expected=201)
    assert world.service.brief(world.owner, world.domain)["issues"] == []
    call(world, "POST", path + "/decisions", decision("start", 2), expected=409)
    call(world, "POST", path + "/decisions", decision("reopen", 2), expected=201)
    assert call(world, "GET", path)["revision"] == 3
    assert len(call(world, "GET", path + "/events")["items"]) == 3
    with pytest.raises(DBAPIError), world.admin.begin() as conn:
        conn.execute(
            text("DELETE FROM cf_issue_events WHERE tenant_id=:tenant AND id=:id"),
            {"tenant": world.tenant, "id": receipt["id"]},
        )


def test_personal_issues_do_not_expose_other_users_to_owner(world):
    issue = gap(world, world.viewer)
    path = f"/issues/{issue['id']}"
    assert call(world, "GET", "/issues")["items"] == []
    call(world, "GET", path, expected=404)
    call(world, "GET", path + "/events", expected=404)
    call(world, "POST", path + "/decisions", decision("dismiss", 0), expected=404)
    result = call(
        world, "POST", path + "/decisions", decision("dismiss", 0), subject="bob", expected=201
    )
    assert result["status"] == "dismissed"


def test_revoked_evidence_hides_issue_and_history(world):
    source = world.source()
    world.approve(world.proposal(source))
    answer = world.service.query(world.owner, world.domain, QueryInput(question="incident"))
    world.service.feedback(
        world.owner,
        world.domain,
        answer["episode_id"],
        FeedbackInput(rating="unhelpful", explanation="À revoir", idempotency_key=str(uuid4())),
    )
    issue = call(world, "GET", "/issues")["items"][0]
    path = f"/issues/{issue['id']}"
    data = decision("resolve", 0)
    call(world, "POST", path + "/decisions", data, expected=201)
    world.service.set_access(
        world.owner, world.domain, source["id"], AccessInput(allowed_subjects=["bob"])
    )
    assert call(world, "GET", "/issues")["items"] == []
    call(world, "GET", path + "/events", expected=404)
    call(world, "POST", path + "/decisions", data, expected=404)


def test_issue_event_failure_rolls_back_state(world):
    from unittest.mock import patch

    from cortex_core.contracts import IssueDecisionInput
    from cortex_core.issues import IssueService
    from cortex_core.service import one

    issue = gap(world)

    def fail_insert(conn, sql, **params):
        if "INSERT INTO cf_issue_events" in sql:
            raise RuntimeError("simulated persistence failure")
        return one(conn, sql, **params)

    with patch("cortex_core.issues.one", fail_insert), pytest.raises(RuntimeError):
        IssueService(world.service).decide(
            world.owner, world.domain, issue["id"], IssueDecisionInput(**decision("resolve", 0))
        )
    assert call(world, "GET", f"/issues/{issue['id']}")["status"] == "open"


def test_concurrent_decisions_accept_only_one_revision(world):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    issue = gap(world)
    barrier = Barrier(2)

    def decide(action):
        barrier.wait(timeout=5)
        return world.client.post(
            world.prefix + f"/issues/{issue['id']}/decisions",
            headers=world.headers(),
            json=decision(action, 0),
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = list(executor.map(decide, ["resolve", "dismiss"]))
    assert sorted(statuses) == [201, 409]
    assert len(call(world, "GET", f"/issues/{issue['id']}/events")["items"]) == 1
