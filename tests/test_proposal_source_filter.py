from uuid import uuid4

import pytest
from cortex_core.contracts import AccessInput, ProposalInput
from test_workspace import request


def listing(w, source, **params):
    return w.client.get(
        w.prefix + "/proposals",
        headers=w.headers(params.pop("subject", "alice")),
        params={"source_id": source["id"], **params},
    )


def test_source_filter_paginates_and_combines_publication_state(world):
    source = world.source()
    first = world.proposal(source)
    second = world.proposal(source)
    unrelated = world.proposal()
    page = listing(world, source, limit=1).json()
    rest = listing(world, source, limit=1, after=page["next_after"]).json()
    assert {page["items"][0]["id"], rest["items"][0]["id"]} == {first["id"], second["id"]}
    assert rest["next_after"] is None
    assert unrelated["id"] not in str(page) + str(rest)
    assert listing(world, source, status="published").json()["items"] == []
    world.approve(first)
    published = listing(world, source, status="published").json()["items"]
    assert [p["id"] for p in published] == [first["id"]]
    assert [p["id"] for p in listing(world, source, status="ready").json()["items"]] == [
        second["id"]
    ]
    assert len(request(world, "GET", "/proposals")["items"]) == 3


def test_source_filter_does_not_bypass_additional_private_evidence(world):
    public = world.source()
    private = world.source(subjects=["alice"])
    visible = world.proposal(public)
    hidden = world.proposal(private)
    combined = world.service.propose(
        world.owner,
        world.domain,
        ProposalInput(
            base_version=0,
            changes=visible["payload"] + hidden["payload"],
            reason="Synthetic combined evidence",
            idempotency_key=str(uuid4()),
        ),
    )
    page = listing(world, public, subject="agent", limit=1).json()
    assert [p["id"] for p in page["items"]] == [visible["id"]]
    assert page["next_after"] is None
    assert combined["id"] not in str(page)
    assert listing(world, private, subject="agent").status_code == 404
    assert listing(world, public, subject="bob").status_code == 403
    assert len(listing(world, public).json()["items"]) == 2


def test_source_filter_revocation_and_tenant_scope(world):
    source = world.source()
    world.proposal(source)
    world.service.set_access(
        world.owner, world.domain, source["id"], AccessInput(allowed_subjects=["bob"])
    )
    assert listing(world, source).status_code == 404
    response = world.client.get(
        f"/v1/domains/{world.other_domain}/proposals",
        headers=world.headers(target_tenant=world.other_tenant),
        params={"source_id": source["id"]},
    )
    assert response.status_code == 404
    assert listing(world, {"id": str(uuid4())}).status_code == 404


@pytest.mark.parametrize("value", ["not-a-uuid", "x' OR true"])
def test_source_filter_validates_uuid(world, value):
    assert listing(world, {"id": value}).status_code == 422


def test_source_filter_generated_mcp_matches_http(world):
    source = world.source()
    world.proposal(source)
    result = world.client.post(
        "/mcp/",
        headers={**world.headers(), "Accept": "application/json, text/event-stream"},
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "api_proposals_list",
                "arguments": {
                    "path": {"domain": world.domain},
                    "query": {"source_id": source["id"], "limit": 1},
                },
            },
        },
    ).json()["result"]
    assert not result.get("isError")
    assert result["structuredContent"]["data"] == listing(world, source, limit=1).json()


def test_import_source_can_be_followed_to_ready_then_published_proposal(world):
    collection = request(
        world,
        "POST",
        "/collections",
        {
            "name": "Synthetic import",
            "description": "Frontend lifecycle test",
            "allowed_subjects": ["alice"],
            "idempotency_key": str(uuid4()),
        },
        expected=201,
    )
    job = request(
        world,
        "POST",
        f"/collections/{collection['id']}/imports",
        {
            "items": [
                {
                    "filename": "procedure.md",
                    "content": "Synthetic procedure for the operations team.",
                    "allowed_subjects": ["alice"],
                }
            ],
            "idempotency_key": str(uuid4()),
        },
        expected=202,
    )
    done = request(world, "POST", f"/imports/{job['id']}/process")
    assert done["status"] == "succeeded"
    source = request(world, "GET", f"/sources/{done['items'][0]['source_id']}")
    assert listing(world, source).json()["items"] == []
    proposal = world.proposal(source)
    assert listing(world, source).json()["items"][0]["status"] == "ready"
    assert world.service.version(world.owner, world.domain)["published_version"] == 0
    world.approve(proposal, publish=False)
    assert listing(world, source).json()["items"][0]["status"] == "approved"
    assert world.service.version(world.owner, world.domain)["published_version"] == 0
    world.service.publish(world.owner, world.domain)
    assert listing(world, source).json()["items"][0]["status"] == "published"
    assert request(world, "GET", f"/imports/{job['id']}") == done
