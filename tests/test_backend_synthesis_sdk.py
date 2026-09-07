import asyncio
import importlib.util
import os
from pathlib import Path

import httpx
from cortex_core.api import create_app
from cortex_core.contracts import AccessInput
from cortex_core.settings import Settings
from pydantic import SecretStr

SPEC = importlib.util.spec_from_file_location(
    "demo_backend_synthesis",
    Path(__file__).resolve().parents[1] / "scripts/demo_backend_synthesis.py",
)
DEMO = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DEMO)


def test_official_sdk_backend_synthesis_feedback_and_revocation(world, identity_keys):
    source = world.source()
    world.approve(world.proposal(source))
    app = create_app(
        Settings(
            database_url=os.environ["CORTEX_TEST_DATABASE_URL"],
            jwt_issuer="https://identity.test",
            jwt_public_key_file=identity_keys[1],
            confirmation_public_key_file=identity_keys[1],
            synthesis_enabled=True,
            model_provider="ollama",
            openrouter_model="synthetic/backend-sdk",
            openrouter_api_key=SecretStr("synthetic-unused"),
        )
    )
    calls = []
    app.state.synthesis.factory = lambda: DEMO.SimulatedSynthesis(calls)

    async def run():
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://localhost:8000",
                headers=world.headers("bob"),
            ) as http:
                return await DEMO.workflow(
                    http,
                    "http://localhost:8000/mcp/",
                    world.tenant,
                    world.domain,
                    "bob",
                    identity_keys[0],
                    lambda: world.service.set_access(
                        world.owner,
                        world.domain,
                        source["id"],
                        AccessInput(allowed_subjects=["alice"]),
                    ),
                )

    report = asyncio.run(run())
    assert report["status"] == "passed" and len(calls) == 1
    assert report["confirmation_required"] and report["revocation_verified"]
