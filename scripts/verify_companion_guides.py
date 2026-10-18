"""Read-only native MCP/HTTP workflow qualification on persistent synthetic fixtures."""

import json
import os
from uuid import uuid4

from verify_coordinated_restore import Fixture
from verify_rust_configured import native_client
from verify_workspace_tasks import KEYS, OUT, ROOT, task_fixture


def main():
    state = task_fixture()
    fixture = Fixture(state["tenant"], {"identity": (KEYS / "identity-private.pem").read_bytes()})
    env = {k: v for k, v in os.environ.items() if not k.startswith(("CORTEX_", "OPENROUTER_"))}
    env.update(
        CORTEX_RUST_DATABASE_URL=os.environ["CORTEX_RUST_DATABASE_URL"],
        CORTEX_JWT_PUBLIC_KEY_FILE=str(KEYS / "identity.pem"),
        CORTEX_JWT_ISSUER="https://identity.test",
        CORTEX_JWT_AUDIENCE="cortex-core",
        CORTEX_RUST_BIND="127.0.0.1:0",
    )
    checks = []
    with native_client(ROOT / "target/debug/cortex-rust-core", env) as client:

        def rpc(method, params=None, actor="task-viewer"):
            r = client.post(
                "/mcp",
                headers={**fixture.headers(actor), "Accept": "application/json, text/event-stream"},
                json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}},
            )
            assert r.status_code == 200, r.status_code
            return r.json()

        def context():
            return {
                p: client.get(
                    f"/v1/domains/{state['domain']}/{p}", headers=fixture.headers("alice")
                ).json()
                for p in ["version", "episodes", "tasks", "shared-cases"]
            }

        before = context()
        assert client.get("/v1/companion-guides").status_code == 401
        catalog = client.get("/v1/companion-guides", headers=fixture.headers("task-viewer")).json()
        assert catalog["documentation_only"] and catalog["client_compatibility"] == "not_qualified"
        ids = [g["id"] for g in catalog["guides"]]
        assert ids == ["consult", "feedback", "follow-up", "task", "correction", "domain"]
        assert len(json.dumps(catalog).encode()) < 65536
        resource = rpc("resources/read", {"uri": "cortex://guides"})["result"]
        assert json.loads(resource["contents"][0]["text"]) == catalog
        tool = rpc("tools/call", {"name": "api_companion_guides_list", "arguments": {}})["result"][
            "structuredContent"
        ]
        assert tool == {"http_status": 200, "data": catalog}
        checks.append(
            "authenticated bounded catalog identical through HTTP, MCP resource and MCP tool; unauthenticated HTTP rejected"
        )
        initialized = rpc(
            "initialize",
            {
                "protocolVersion": "2025-11-25",
                "capabilities": {},
                "clientInfo": {"name": "synthetic-guides", "version": "1"},
            },
        )["result"]
        assert {"tools", "resources", "prompts"} <= set(initialized["capabilities"])
        assert len(rpc("resources/list")["result"]["resources"]) == 4
        assert len(rpc("resources/templates/list")["result"]["resourceTemplates"]) == 2
        assert len(rpc("prompts/list")["result"]["prompts"]) == 4
        names = {t["name"] for t in rpc("tools/list")["result"]["tools"]}
        for guide in catalog["guides"]:
            result = rpc("resources/read", {"uri": "cortex://guides/" + guide["id"]})["result"]
            assert json.loads(result["contents"][0]["text"]) == guide
            assert set(guide["tools"]) <= names
        checks.append(
            "4 resources, 2 templates, 4 prompts; six exact guides with actually discoverable tool references"
        )

        def prompt(guide, actor="task-viewer", domain=None, **extra):
            return rpc(
                "prompts/get",
                {
                    "name": "openbrain_workflow",
                    "arguments": {
                        "domain_id": domain or state["domain"],
                        "guide_id": guide,
                        **extra,
                    },
                },
                actor,
            )

        for guide in ids:
            result = prompt(guide, "alice")
            assert "error" not in result, (guide, result)
            message = result["result"]["messages"][0]["content"]["text"]
            assert "no authority granted" in message and len(message) < 8000
        for guide in ids[:3]:
            assert "error" not in prompt(guide)
        for guide in ids[3:]:
            assert "error" in prompt(guide)
        checks.append(
            "owner prepares all six workflows; viewer prepares consultation, feedback and follow-up but cannot prepare task, correction or coordination"
        )
        for args in [
            ("unknown", {}),
            ("consult", {"domain": str(uuid4())}),
            ("consult", {"domain": "invalid"}),
            ("consult", {"instruction": "publish automatically"}),
        ]:
            assert "error" in prompt(args[0], **args[1])
        for uri in ["cortex://guides/unknown", "cortex://guides/consult/../../private"]:
            assert "error" in rpc("resources/read", {"uri": uri})
        checks.append(
            "unknown guide, inaccessible/invalid domain, extra prompt arguments and arbitrary resource path rejected"
        )
        after = context()
        for snapshot in (before, after):
            for page in snapshot.values():
                page.pop("as_of", None)
                page.pop("next_after", None)
        assert after == before, "Business state changed during guide-only reads"
        checks.append(
            "domain version, episodes, tasks and shared cases unchanged by all guide reads and prompt preparations"
        )
    (OUT / "companion-guides-native-results.json").write_text(
        json.dumps(
            {"synthetic_only": True, "checks": checks, "external_client_qualified": False}, indent=2
        )
    )
    print(json.dumps({"passed": len(checks), "checks": checks}, indent=2))


if __name__ == "__main__":
    main()
