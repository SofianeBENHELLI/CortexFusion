"""Synthetic service acceptance of long passages; no membership changes."""

from cortex_core.contracts import QueryInput
from sqlalchemy import text


def test_long_evidence_is_bounded_exact_and_does_not_replace_the_concept(world):
    body = (
        "Bruit.\n" * 5000
        + "La constellation violette contient sept étoiles 🧠.\n"
        + "Suite.\n" * 5000
    )
    source = world.source(content=body)
    proposal = world.proposal(source)
    world.approve(proposal)
    result = world.service.query(
        world.owner, world.domain, QueryInput(question="constellation violette", max_chars=100)
    )
    assert result["status"] == "evidence_found"
    assert len(result["answer"]) <= 100 and "sept étoiles" in result["answer"]
    assert result["concepts"] == []  # A partial body is never a replacement Concept.
    p = result["context_passages"][0]
    assert p["body_total_chars"] == len(body)
    assert body[p["body_start"] : p["body_end"]] == result["answer"]
    c = result["citations"][0]
    assert body[c["start"] : c["end"]] == c["excerpt"] == result["answer"]
    assert world.service.episode(world.owner, world.domain, result["episode_id"]) == result
    with world.db.transaction(world.owner, world.domain) as conn:
        current = world.service._state(conn, world.owner, world.domain)
        assert current[p["concept_id"]]["body"] == body


def test_budget_limit_does_not_open_a_knowledge_gap_ticket(world):
    source = world.source(content="quartz " * 2000)
    world.approve(world.proposal(source))
    limited = world.service.query(
        world.owner, world.domain, QueryInput(question="quartz", max_chars=100)
    )
    missing = world.service.query(world.owner, world.domain, QueryInput(question="absentxyz"))
    assert limited["status"] == "context_limited" and not limited["citations"]
    assert missing["status"] == "knowledge_gap"
    with world.db.transaction(world.owner, world.domain) as conn:
        assert conn.execute(
            text(
                "SELECT source_ids FROM cf_episodes WHERE tenant_id=:t AND domain_id=:d AND id=:e"
            ),
            {"t": world.owner.tenant_id, "d": world.domain, "e": limited["episode_id"]},
        ).scalar_one() == [str(source["id"])]
        for result, count in [(limited, 0), (missing, 1)]:
            assert (
                conn.execute(
                    text(
                        "SELECT count(*) FROM cf_issues WHERE tenant_id=:t AND domain_id=:d AND episode_id=:e AND kind='knowledge_gap'"
                    ),
                    {"t": world.owner.tenant_id, "d": world.domain, "e": result["episode_id"]},
                ).scalar_one()
                == count
            )
