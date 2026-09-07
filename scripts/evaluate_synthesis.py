"""Bounded synthetic synthesis evaluation; simulated MCP evidence, optional live model.

This isolates answer generation from retrieval and authorization. Use demo_companion
and the SDK tests for the real HTTP/MCP boundary. Never report this as a live corpus.
"""

import argparse
import asyncio
import hashlib
import json
import os
import subprocess
import time
import unicodedata
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from uuid import NAMESPACE_URL, uuid5

from cortex_core.companion import REQUIRED_TOOLS, Journal, OpenRouterSynthesis, ask, safe_error_code
from pydantic import SecretStr

ROOT = Path(__file__).resolve().parents[1]


def ident(value):
    return str(uuid5(NAMESPACE_URL, "cortex-synthetic-evaluation-v1/" + value))


class FixtureSession:
    """Explicit simulation of the five tools needed by the reference client."""

    def __init__(self, scenario):
        self.scenario, self.receipt = scenario, None
        self.result = {
            "episode_id": ident(scenario["id"] + "/episode"),
            "answer": "Synthetic retrieval fixture",
            "status": "evidence_found" if scenario["excerpts"] else "knowledge_gap",
            "served_version": 1,
            "concepts": [],
            "citations": [
                {
                    "source_id": ident(scenario["id"] + f"/source/{i}"),
                    "start": 0,
                    "end": len(excerpt),
                    "excerpt": excerpt,
                    "title": "Synthetic fixture",
                    "location": "fixture://evaluation",
                    "content_hash": hashlib.sha256(excerpt.encode()).hexdigest(),
                }
                for i, excerpt in enumerate(scenario["excerpts"])
            ],
        }

    async def list_tools(self):
        return SimpleNamespace(tools=[SimpleNamespace(name=n) for n in REQUIRED_TOOLS])

    async def call_tool(self, name, args):
        if name == "api_identity_read":
            data = {"subject": "synthetic-evaluation", "tenant_id": ident("tenant")}
        elif name in {"api_knowledge_query", "api_episodes_read"}:
            data = self.result
        elif name == "api_responses_create":
            data = {
                "id": ident(self.scenario["id"] + "/response"),
                "response": args["body"],
                "semantic_validation": "not_performed",
            }
            self.receipt = data
        elif name == "api_responses_read" and self.receipt:
            data = self.receipt
        else:
            raise ValueError("Unexpected simulated tool")
        return SimpleNamespace(isError=False, structuredContent={"http_status": 200, "data": data})


def normalized(value):
    return "".join(
        c for c in unicodedata.normalize("NFKD", value.casefold()) if not unicodedata.combining(c)
    )


def score(scenario, draft):
    """Transparent lexical checks, deliberately not a claim of general truth."""
    expected, content = scenario["expected"], normalized(draft["answer_text"])
    return {
        "answer_kind": draft["answer_kind"] in expected["kinds"],
        "citation_count": "citation_count" not in expected
        or len(draft["citations"]) == expected["citation_count"],
        "required_terms": all(
            any(normalized(term) in content for term in group)
            for group in expected["required_groups"]
        ),
        "forbidden_terms_absent": not any(
            normalized(term) in content for term in expected["forbidden"]
        ),
    }


async def evaluate(scenarios, model, journal):
    rows = []
    for scenario in scenarios:
        # Content digest changes the command ID when a fixture changes. Re-running
        # an unchanged fixture/model reuses its saved result, not a new generation.
        digest = hashlib.sha256(
            json.dumps({k: scenario[k] for k in ("question", "excerpts")}, sort_keys=True).encode()
        ).hexdigest()
        version = getattr(model, "PROMPT_VERSION", None)
        request_id = ident(
            scenario["id"] + "/" + digest + "/" + model.model + ("/" + version if version else "")
        )
        row = {
            "scenario": scenario["id"],
            "request_id": request_id,
            "fixture_sha256": digest,
            "configured_prompt_version": version,
        }
        started = time.monotonic()
        with journal.locked() as locked:
            existing = locked.conn.execute(
                "SELECT state,payload FROM runs WHERE id=?", (request_id,)
            ).fetchone()
            session = FixtureSession(scenario)
            if existing and existing[0] == "complete":
                saved = json.loads(existing[1])
                session.receipt = {
                    "id": saved["response_id"],
                    "response": saved["draft"],
                    "semantic_validation": "not_performed",
                }
            try:
                receipt = await ask(
                    session,
                    endpoint="fixture://synthetic-mcp",
                    domain=ident("domain"),
                    question=scenario["question"],
                    request_id=request_id,
                    journal=locked,
                    model=model,
                )
                payload = json.loads(
                    locked.conn.execute(
                        "SELECT payload FROM runs WHERE id=?", (request_id,)
                    ).fetchone()[0]
                )
                checks = score(scenario, receipt["response"])
                row.update(
                    status="passed" if all(checks.values()) else "failed_checks",
                    checks=checks,
                    response=receipt["response"],
                    usage=payload["draft"]["usage"],
                    generated_prompt_version=payload["draft"].get("prompt_version"),
                    reused=bool(existing),
                )
            except Exception as exc:
                saved = locked.conn.execute(
                    "SELECT payload FROM runs WHERE id=?", (request_id,)
                ).fetchone()
                saved_payload = json.loads(saved[0]) if saved else {}
                error = saved_payload.get("error")
                row.update(
                    status="failed_generation",
                    error=error or safe_error_code(exc),
                    diagnostic=saved_payload.get("diagnostic"),
                    usage=saved_payload.get("failed_usage"),
                    reused=bool(existing),
                )
        row["elapsed_ms"] = round((time.monotonic() - started) * 1000)
        rows.append(row)
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--live", action="store_true", help="Authorize up to five synthetic OpenRouter generations"
    )
    parser.add_argument(
        "--journal", type=Path, default=ROOT / "artifacts/synthesis-evaluation.sqlite"
    )
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts/synthesis-evaluation.json")
    args = parser.parse_args()
    fixtures = ROOT / "evals/synthesis-scenarios.json"
    scenarios = json.loads(fixtures.read_text())
    if len(scenarios) > 6 or sum(bool(s["excerpts"]) for s in scenarios) > 5:
        raise SystemExit("This evaluation is limited to six scenarios and five model generations")
    if not args.live:
        print(
            json.dumps(
                {
                    "status": "preflight",
                    "scenario_count": len(scenarios),
                    "max_generation_calls": sum(bool(s["excerpts"]) for s in scenarios),
                    "network_attempted": False,
                }
            )
        )
        return
    model = OpenRouterSynthesis(
        os.environ["CORTEX_OPENROUTER_MODEL"],
        SecretStr(os.environ.get("CORTEX_OPENROUTER_API_KEY") or os.environ["OPENROUTER_API_KEY"]),
    )
    rows = asyncio.run(evaluate(scenarios, model, Journal(args.journal, "0.50")))
    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout.strip()
    dirty = subprocess.run(
        ["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout.strip()
    report = {
        "generated_at": datetime.now(UTC).isoformat(),
        "scope": "Synthetic synthesis with simulated MCP evidence. Lexical assertions only; not retrieval, identity, enterprise quality or general semantic certification.",
        "git_commit": commit,
        "working_tree_dirty": bool(dirty),
        "model": model.model,
        "fixture_sha256": hashlib.sha256(fixtures.read_bytes()).hexdigest(),
        "automatic_retries": 0,
        "results": rows,
        "passed": sum(r["status"] == "passed" for r in rows),
        "total": len(rows),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(
        json.dumps(
            {"passed": report["passed"], "total": report["total"], "output": str(args.output)}
        )
    )
    raise SystemExit(0 if report["passed"] == report["total"] else 1)


if __name__ == "__main__":
    main()
