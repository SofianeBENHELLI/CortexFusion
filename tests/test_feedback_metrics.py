import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from cortex_core.contracts import (
    AccessInput,
    ConversationInput,
    ConversationQueryInput,
    FeedbackPreferencesInput,
    FeedbackSignalInput,
    QueryInput,
)
from cortex_core.conversations import ConversationService
from cortex_core.feedback_signals import FeedbackSignalService

SCENARIOS = json.loads(
    (Path(__file__).resolve().parents[1] / "evals/feedback-scenarios.json").read_text()
)["scenarios"]


def enable(w, p=None):
    FeedbackSignalService(w.service).set_preferences(
        p or w.owner,
        w.domain,
        FeedbackPreferencesInput(allow_observed=True, allow_inferred=True, expected_revision=0),
    )


def record(w, eid, signal, p=None, key=None):
    return FeedbackSignalService(w.service).record(
        p or w.owner,
        w.domain,
        eid,
        FeedbackSignalInput(
            **signal, companion="synthetic-eval", idempotency_key=key or str(uuid4())
        ),
    )


def summary(w, subject="alice", status=200, **params):
    response = w.client.get(
        w.prefix + "/feedback-summary", headers=w.headers(subject), params=params
    )
    assert response.status_code == status, response.text
    return response.json()


@pytest.mark.parametrize("scenario", SCENARIOS, ids=lambda s: s["name"])
def test_synthetic_feedback_scenarios(world, scenario, record_property):
    world.approve(world.proposal())
    eid = world.service.query(world.owner, world.domain, QueryInput(question="incident"))[
        "episode_id"
    ]
    enable(world)
    for signal in scenario["signals"]:
        key = str(uuid4())
        receipt = record(world, eid, signal, key=key)
        assert record(world, eid, signal, key=key) == receipt
    result = summary(world)
    record_property("scenario", scenario["name"])
    record_property("summary", result)
    for path, expected in scenario["expected"].items():
        value = result
        for part in path.split("."):
            value = value[part]
        assert value == expected, (path, result)
    assert result["legacy_feedback_included"] is False
    assert world.service.version(world.owner, world.domain)["published_version"] == 1


def test_summary_filters_personal_scope_and_revoked_evidence(world):
    source = world.source()
    world.approve(world.proposal(source))
    for p in (world.owner, world.viewer):
        eid = world.service.query(p, world.domain, QueryInput(question="incident"))["episode_id"]
        record(world, eid, {"origin": "explicit", "kind": "thumbs_up"}, p)
    assert summary(world)["signal_count"] == summary(world, "bob")["signal_count"] == 1
    world.service.set_access(
        world.owner, world.domain, source["id"], AccessInput(allowed_subjects=["alice"])
    )
    assert summary(world, "bob")["signal_count"] == 0
    assert summary(world)["signal_count"] == 1
    response = world.client.get(
        f"/v1/domains/{world.other_domain}/feedback-summary", headers=world.headers()
    )
    assert response.status_code == 404


def test_conversation_summary_is_personal_and_excludes_other_conversations(world):
    ids = []
    for title in ("A", "B"):
        cid = ConversationService(world.service).create(
            world.viewer, world.domain, ConversationInput(title=title, idempotency_key=str(uuid4()))
        )["id"]
        ids.append(cid)
        eid = world.service.query(
            world.viewer,
            world.domain,
            ConversationQueryInput(question=title, idempotency_key=str(uuid4())),
            conversation_id=cid,
        )["episode_id"]
        record(
            world, eid, {"origin": "explicit", "kind": "comment", "comment": title}, world.viewer
        )
    assert summary(world, "bob")["signal_count"] == 2
    assert summary(world, "bob", conversation_id=ids[0])["signal_count"] == 1
    summary(world, conversation_id=ids[0], status=404)


def test_window_uses_half_open_server_receipt_time(world):
    eid = world.service.query(world.owner, world.domain, QueryInput(question="Synthetic"))[
        "episode_id"
    ]
    receipt = record(world, eid, {"origin": "explicit", "kind": "thumbs_up"})
    point = receipt["created_at"]
    assert (
        summary(world, since=(point - timedelta(seconds=1)).isoformat(), until=point.isoformat())[
            "signal_count"
        ]
        == 0
    )
    assert (
        summary(world, since=point.isoformat(), until=(point + timedelta(seconds=1)).isoformat())[
            "signal_count"
        ]
        == 1
    )


@pytest.mark.parametrize(
    "params",
    [
        {"since": "2026-01-01T00:00:00", "until": "2026-01-02T00:00:00Z"},
        {"since": "2026-01-02T00:00:00Z", "until": "2026-01-01T00:00:00Z"},
        {"since": "2026-01-01T00:00:00Z", "until": "2026-03-01T00:00:00Z"},
    ],
)
def test_summary_rejects_ambiguous_or_unbounded_windows(world, params):
    summary(world, status=422, **params)


def test_summary_cap_never_returns_silent_partial_counts(world, monkeypatch):
    monkeypatch.setattr("cortex_core.feedback_metrics.MAX_SIGNALS", 1)
    source = world.source()
    world.approve(world.proposal(source))
    eid = world.service.query(world.viewer, world.domain, QueryInput(question="incident"))[
        "episode_id"
    ]
    for kind in ("thumbs_up", "resolved"):
        record(world, eid, {"origin": "explicit", "kind": kind}, world.viewer)
    assert summary(world, "bob", status=413)["error"] == "SUMMARY_TOO_LARGE"
    world.service.set_access(
        world.owner, world.domain, source["id"], AccessInput(allowed_subjects=["alice"])
    )
    assert summary(world, "bob")["signal_count"] == 0


def test_generated_mcp_summary_matches_http_and_is_read_only(world):
    now = datetime.now(UTC)
    params = {"since": (now - timedelta(days=1)).isoformat(), "until": now.isoformat()}
    http = summary(world, **params)
    result = world.client.post(
        "/mcp/",
        headers={**world.headers(), "Accept": "application/json, text/event-stream"},
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "api_feedback_summary",
                "arguments": {"path": {"domain": world.domain}, "query": params},
            },
        },
    ).json()["result"]["structuredContent"]
    assert result == {"http_status": 200, "data": http}
