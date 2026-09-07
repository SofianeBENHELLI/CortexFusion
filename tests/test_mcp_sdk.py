"""Full companion workflow using the installed MCP Python SDK over in-process HTTP."""

import asyncio
import json
import os
from datetime import timedelta
from uuid import uuid4

import httpx
from cortex_core.api import create_app
from cortex_core.contracts import AccessInput
from cortex_core.settings import Settings
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client


def test_python_mcp_client_completes_evidence_response_feedback_workflow(world, identity_keys):
    source = world.source()
    world.approve(world.proposal(source))
    app = create_app(
        Settings(
            database_url=os.environ["CORTEX_TEST_DATABASE_URL"],
            jwt_issuer="https://identity.test",
            jwt_public_key_file=identity_keys[1],
            model_provider="ollama",
            local_model=None,
            mcp_public_url=None,
        )
    )

    async def workflow():
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://localhost:8000",
                headers=world.headers("bob"),
            ) as http:
                async with streamable_http_client(
                    "http://localhost:8000/mcp/", http_client=http
                ) as (read, write, _):
                    async with ClientSession(
                        read, write, read_timeout_seconds=timedelta(seconds=20)
                    ) as session:
                        initialized = await session.initialize()
                        assert initialized.capabilities.tools and initialized.capabilities.resources
                        assert len((await session.list_tools()).tools) >= 89
                        workspace = await session.read_resource("cortex://workspace")
                        assert json.loads(workspace.contents[0].text)["subject"] == "bob"
                        prompt = await session.get_prompt(
                            "ask_cortex", {"domain_id": world.domain, "question": "incident"}
                        )
                        assert prompt.messages
                        path = {"domain": world.domain}
                        answer = await session.call_tool(
                            "api_knowledge_query", {"path": path, "body": {"question": "incident"}}
                        )
                        assert not answer.isError
                        episode = answer.structuredContent["data"]
                        response = await session.call_tool(
                            "api_responses_create",
                            {
                                "path": {**path, "episode_id": episode["episode_id"]},
                                "body": {
                                    "answer_text": "The cited procedure says to escalate to the operations team.",
                                    "answer_kind": "answer",
                                    "citations": [
                                        {k: c[k] for k in ("source_id", "start", "end")}
                                        for c in episode["citations"]
                                    ],
                                    "companion": "synthetic-python-sdk",
                                    "idempotency_key": str(uuid4()),
                                },
                            },
                        )
                        assert not response.isError
                        response_id = response.structuredContent["data"]["id"]
                        feedback = await session.call_tool(
                            "api_feedback_record_signal",
                            {
                                "path": {**path, "episode_id": episode["episode_id"]},
                                "body": {
                                    "origin": "explicit",
                                    "kind": "thumbs_up",
                                    "companion": "synthetic-python-sdk",
                                    "companion_response_id": response_id,
                                    "idempotency_key": str(uuid4()),
                                },
                            },
                        )
                        assert not feedback.isError
                        summary = await session.call_tool(
                            "api_feedback_summary",
                            {"path": path, "query": {"companion_response_id": response_id}},
                        )
                        assert summary.structuredContent["data"]["explicit"]["thumbs_up"] == 1
                        denied = await session.call_tool("api_domain_publish", {"path": path})
                        assert denied.isError and denied.structuredContent["http_status"] == 403
                        world.service.set_access(
                            world.owner,
                            world.domain,
                            source["id"],
                            AccessInput(allowed_subjects=["alice"]),
                        )
                        revoked = await session.call_tool(
                            "api_responses_read", {"path": {**path, "response_id": response_id}}
                        )
                        assert revoked.isError and revoked.structuredContent["http_status"] == 404

    asyncio.run(workflow())
