import pytest
from cortex_core.contracts import AccessInput
from cortex_core.service import one
from test_governance import change
from test_http_confirmations import signed
from test_http_confirmations import strict_client as strict_fixture


@pytest.fixture
def strict_client(world, identity_keys):
    yield from strict_fixture.__wrapped__(world, identity_keys)


@pytest.mark.parametrize("transport", ["http", "mcp"])
def test_global_publication_cannot_bypass_revoked_proposal_access(
    world, identity_keys, strict_client, transport
):
    source = world.source()
    proposal = world.proposal(source)
    world.approve(proposal, publish=False)
    world.service.set_access(
        world.owner, world.domain, source["id"], AccessInput(allowed_subjects=["bob"])
    )
    args = {"path": {"domain": world.domain}}
    headers = {
        **world.headers(),
        "X-Cortex-Confirmation": signed(world, identity_keys, "domain.publish", args),
    }
    if transport == "http":
        result = strict_client.post(world.prefix + "/publish", headers=headers)
        assert result.status_code == 404, result.text
    else:
        result = strict_client.post(
            "/mcp/",
            headers={**headers, "Accept": "application/json, text/event-stream"},
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "api_domain_publish", "arguments": args},
            },
        ).json()["result"]
        assert result.get("isError"), result
    assert world.service.version(world.owner, world.domain)["published_version"] == 0
    with world.db.transaction(world.owner, world.domain) as conn:
        assert (
            one(
                conn, "SELECT count(*) AS n FROM cf_publications WHERE tenant_id=:t", t=world.tenant
            )["n"]
            == 0
        )
        row = one(conn, "SELECT status,attempts FROM cf_outbox WHERE tenant_id=:t", t=world.tenant)
        assert row["status"] == "pending" and row["attempts"] == 0
    # An owner retaining evidence access can complete the accepted publication.
    change(world, "bob", "owner", 0)
    assert world.client.post(world.prefix + "/publish", headers=world.headers("bob")).json()[
        "changed"
    ]
    assert world.service.version(world.owner, world.domain)["published_version"] == 1
