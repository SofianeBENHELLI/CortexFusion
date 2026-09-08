from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import uuid4

import pytest
from cortex_core.auth import Principal
from cortex_core.contracts import AccessInput
from cortex_core.conversation_timeline import ConversationTimelineService
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError


def create(world, subject="bob"):
    response = world.client.post(
        world.prefix + "/conversations",
        headers=world.headers(subject),
        json={"title": "Timeline", "idempotency_key": str(uuid4())},
    )
    response.raise_for_status()
    return response.json()["id"]


def ask(world, ident, question="unknown", subject="bob"):
    response = world.client.post(
        world.prefix + "/conversations/" + ident + "/query",
        headers=world.headers(subject),
        json={"question": question, "idempotency_key": str(uuid4())},
    )
    response.raise_for_status()
    return response.json()


def timeline(world, ident, **params):
    return world.client.get(
        world.prefix + "/conversations/" + ident + "/timeline",
        headers=world.headers("bob"),
        params=params,
    )


def attach(world, episode, count=3):
    for i in range(count):
        response = world.client.post(
            world.prefix + "/episodes/" + episode["episode_id"] + "/companion-responses",
            headers=world.headers("bob"),
            json={
                "answer_text": f"No evidence {i}",
                "answer_kind": "abstention",
                "citations": [],
                "companion": "synthetic",
                "idempotency_key": str(uuid4()),
            },
        )
        response.raise_for_status()
        signal = world.client.post(
            world.prefix + "/episodes/" + episode["episode_id"] + "/signals",
            headers=world.headers("bob"),
            json={
                "origin": "explicit",
                "kind": "thumbs_down",
                "comment": f"Not useful {i}",
                "companion": "synthetic",
                "companion_response_id": response.json()["id"],
                "idempotency_key": str(uuid4()),
            },
        )
        signal.raise_for_status()


def test_timeline_joins_exact_personal_objects_with_independent_child_cursors(world):
    ident = create(world)
    episode = ask(world, ident)
    attach(world, episode)
    other = create(world)
    ask(world, other, "Other conversation")
    response = timeline(world, ident, responses_limit=1, signals_limit=1, issues_limit=1)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["conversation"]["id"] == ident and len(data["items"]) == 1
    turn = data["items"][0]
    assert turn["result"] == episode and turn["sequence"] == 1
    for field in ["responses", "signals", "issues"]:
        assert len(turn[field]["items"]) == 1 and turn[field]["next_after"]
    assert (
        "citations" not in turn["responses"]["items"][0]
    )  # Exact references remain in response.citations.
    assert turn["responses"]["items"][0]["semantic_validation"] == "not_performed"
    assert turn["signals"]["items"][0]["signal"]["origin"] == "explicit"
    for field, endpoint in [
        ("responses", "companion-responses"),
        ("signals", "feedback-signals"),
        ("issues", "issues"),
    ]:
        remaining = world.client.get(
            world.prefix + "/" + endpoint,
            headers=world.headers("bob"),
            params={"episode_id": episode["episode_id"], "after": turn[field]["next_after"]},
        )
        assert remaining.status_code == 200
        assert turn[field]["items"][0]["id"] not in {r["id"] for r in remaining.json()["items"]}
        assert all(r["episode_id"] == episode["episode_id"] for r in remaining.json()["items"])
    before = timeline(world, ident).json()
    assert timeline(world, ident).json() == before  # Read model creates no events.
    assert data["next_after"] is None and data["payload_limit_bytes"] == 500000


def test_timeline_top_level_pages_preserve_sequence_and_metadata(world):
    ident = create(world)
    for i in range(3):
        ask(world, ident, f"Unmatched question {i}")
    first = timeline(world, ident, limit=1).json()
    assert [t["sequence"] for t in first["items"]] == [1]
    assert first["next_after"] == 1
    second = timeline(world, ident, limit=1, after=first["next_after"]).json()
    assert [t["sequence"] for t in second["items"]] == [2]
    third = timeline(world, ident, after=second["next_after"]).json()
    assert [t["sequence"] for t in third["items"]] == [3] and third["next_after"] is None
    recent = timeline(world, ident, limit=1, direction="backward").json()
    assert recent["direction"] == "backward"
    assert [t["sequence"] for t in recent["items"]] == [3] and recent["next_after"] == 3
    older = timeline(world, ident, direction="backward", after=recent["next_after"]).json()
    assert [t["sequence"] for t in older["items"]] == [2, 1] and older["next_after"] is None


def test_timeline_and_issue_filter_hide_other_owners_and_revoked_evidence(world, monkeypatch):
    import cortex_core.conversation_timeline as module

    source = world.source(content="Private synthetic incident instructions.")
    world.approve(world.proposal(source))
    world.service.publish(world.owner, world.domain)
    ident = create(world)
    hidden = ask(world, ident, "incident")
    ask(world, ident, "incident")
    visible = ask(world, ident, "zzzzunknown")
    path = world.prefix + "/conversations/" + ident + "/timeline"
    assert world.client.get(path, headers=world.headers()).status_code == 404
    assert (
        world.client.get(
            path, headers=world.headers("bob", target_tenant=world.other_tenant)
        ).status_code
        == 404
    )
    world.service.set_access(
        world.owner, world.domain, source["id"], AccessInput(allowed_subjects=["alice"])
    )
    monkeypatch.setattr(module, "SCAN_LIMIT", 2)
    page = timeline(world, ident).json()
    assert page["items"] == [] and page["scan_limited"] is True and page["next_after"] == 2
    next_page = timeline(world, ident, after=2).json()
    assert len(next_page["items"]) == 1 and next_page["items"][0]["result"] == visible
    assert next_page["next_after"] is None
    assert (
        world.client.get(
            world.prefix + "/issues",
            headers=world.headers("bob"),
            params={"episode_id": hidden["episode_id"]},
        ).status_code
        == 404
    )
    assert "Private synthetic incident instructions." not in str(page) + str(next_page)


def test_timeline_budget_never_silently_drops_a_turn(world, monkeypatch):
    import cortex_core.conversation_timeline as module

    ident = create(world)
    ask(world, ident, "small")
    ask(world, ident, "q" * 1900)
    monkeypatch.setattr(module, "PAYLOAD_LIMIT", 11000)
    first = timeline(world, ident)
    assert first.status_code == 200
    assert len(first.json()["items"]) == 1 and first.json()["next_after"] == 1
    oversized = timeline(world, ident, after=1)
    assert oversized.status_code == 422
    assert oversized.json()["error"] == "TIMELINE_ITEM_TOO_LARGE"
    fallback = world.client.get(
        world.prefix + "/conversations/" + ident + "/messages",
        headers=world.headers("bob"),
        params={"after": 1},
    )
    assert len(fallback.json()["items"]) == 1


@pytest.mark.parametrize(
    "params",
    [
        {"limit": 21},
        {"responses_limit": 6},
        {"signals_limit": 21},
        {"issues_limit": 11},
        {"after": -1},
    ],
)
def test_timeline_rejects_unbounded_page_requests(world, params):
    assert timeline(world, create(world), **params).status_code == 422


def test_timeline_generated_mcp_returns_same_typed_view(world):
    ident = create(world)
    ask(world, ident)
    expected = timeline(world, ident).json()
    response = world.client.post(
        "/mcp/",
        headers={**world.headers("bob"), "Accept": "application/json, text/event-stream"},
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "api_conversations_timeline",
                "arguments": {"path": {"domain": world.domain, "ident": ident}},
            },
        },
    )
    result = response.json()["result"]
    assert not result.get("isError")
    assert result["structuredContent"]["data"] == expected


def test_timeline_holds_access_boundary_while_assembling_children(world, monkeypatch):
    ident = create(world)
    ask(world, ident)
    service = ConversationTimelineService(world.service)
    entered, release = Event(), Event()
    original = service._related

    def paused(*args, **kwargs):
        if not entered.is_set():
            entered.set()
            assert release.wait(5)
        return original(*args, **kwargs)

    monkeypatch.setattr(service, "_related", paused)
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(
            service.read, Principal("bob", world.tenant), world.domain, ident, 10, 0, 3, 5, 3
        )
        try:
            assert entered.wait(5)
            with pytest.raises(DBAPIError) as error:
                with world.service.db.transaction(world.owner, world.domain) as conn:
                    conn.execute(text("SET LOCAL lock_timeout='100ms'"))
                    world.service._domain(conn, world.owner, world.domain, lock=True)
            assert error.value.orig.args[0]["C"] == "55P03"
        finally:
            release.set()
        assert len(future.result(timeout=5).items) == 1
