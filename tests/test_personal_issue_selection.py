from uuid import uuid4

from cortex_core.contracts import AccessInput, FeedbackInput, QueryInput
from cortex_core.issues import IssueService


def test_other_users_issues_are_not_materialized_for_personal_pages(world, monkeypatch):
    for i in range(12):
        world.service.query(
            world.owner, world.domain, QueryInput(question=f"Synthetic owner gap {i}")
        )
    own = {
        world.service.query(
            world.viewer, world.domain, QueryInput(question=f"Synthetic personal gap {i}")
        )["episode_id"]
        for i in range(3)
    }
    checked = []
    original = world.service._episode

    def verify(conn, p, domain, ident):
        assert ident in own, "An unrelated personal episode reached application filtering"
        checked.append(ident)
        return original(conn, p, domain, ident)

    monkeypatch.setattr(world.service, "_episode", verify)
    service = IssueService(world.service)
    page = service.list(world.viewer, world.domain, 1, None, "open")
    found = []
    while True:
        found.extend(item["episode_id"] for item in page["items"])
        if page["next_after"] is None:
            break
        page = service.list(world.viewer, world.domain, 1, page["next_after"], "open")
    assert set(found) == own and len(found) == 3
    assert set(checked) == own


def test_no_personal_issue_performs_no_foreign_episode_checks(world, monkeypatch):
    for i in range(5):
        world.service.query(
            world.owner, world.domain, QueryInput(question=f"Synthetic other gap {i}")
        )

    def forbidden(*args):
        raise AssertionError("Other subjects must be filtered by SQL")

    monkeypatch.setattr(world.service, "_episode", forbidden)
    assert IssueService(world.service).list(world.viewer, world.domain, 20, None, None) == {
        "items": [],
        "next_after": None,
    }


def test_sql_personal_filter_keeps_evidence_and_episode_checks(world):
    source = world.source()
    world.approve(world.proposal(source))
    episode = world.service.query(world.viewer, world.domain, QueryInput(question="incident"))
    world.service.feedback(
        world.viewer,
        world.domain,
        episode["episode_id"],
        FeedbackInput(
            rating="unhelpful", explanation="Synthetic negative", idempotency_key=str(uuid4())
        ),
    )
    path = world.prefix + "/issues"
    assert (
        len(
            world.client.get(
                path,
                headers=world.headers("bob"),
                params={"episode_id": episode["episode_id"], "status": "open"},
            ).json()["items"]
        )
        == 1
    )
    world.service.set_access(
        world.owner, world.domain, source["id"], AccessInput(allowed_subjects=["alice"])
    )
    assert world.client.get(path, headers=world.headers("bob")).json()["items"] == []
    assert (
        world.client.get(
            path, headers=world.headers("bob"), params={"episode_id": episode["episode_id"]}
        ).status_code
        == 404
    )
    assert (
        world.client.get(
            path, headers=world.headers("alice"), params={"episode_id": episode["episode_id"]}
        ).status_code
        == 404
    )
