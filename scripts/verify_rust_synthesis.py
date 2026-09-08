"""Synthetic loopback provider only: durable native synthesis, no paid/model inference."""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from uuid import uuid4

import jwt
from sqlalchemy import text
from verify_rust_proposals import canonical_hash


def start_provider():
    state = {
        "requests": [],
        "response": {
            "id": "synthetic-request",
            "model": "synthetic/model",
            "usage": {"cost": 0, "prompt_tokens": 2, "completion_tokens": 3},
            "choices": [
                {
                    "finish_reason": "stop",
                    "message": {
                        "content": json.dumps(
                            {
                                "answer_text": "Preuve [1]",
                                "answer_kind": "answer",
                                "citation_indices": [1],
                            }
                        )
                    },
                }
            ],
        },
    }

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            assert self.path == "/api/tags"
            raw = json.dumps({"models": [{"name": "synthetic/model", "digest": "a" * 64}]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_POST(self):
            assert (
                self.path == "/api/chat"
                or self.headers.get("Authorization") == "Bearer synthetic-test-key"
            )
            state["requests"].append(
                json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            )
            raw = json.dumps(state["response"]).encode()
            self.send_response(state.get("status", 200))
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, state


def verify_synthesis(client, headers, admin, tenant, domain, state, private):
    root = f"/v1/domains/{domain}"

    def signed(eid, body):
        args = {"path": {"domain": domain, "episode_id": eid}, "body": body}
        now = int(time.time())
        token = jwt.encode(
            {
                "iss": "cortex-trusted-host",
                "aud": "cortex-mcp-confirmation",
                "sub": "bob",
                "tenant": tenant,
                "iat": now,
                "exp": now + 120,
                "jti": str(uuid4()),
                "action": "syntheses.create",
                "command_hash": canonical_hash({"action": "syntheses.create", "arguments": args}),
            },
            private,
            algorithm="RS256",
        )
        return {**headers(sub="bob"), "X-Cortex-Confirmation": token}

    def post(url, body):
        return client.post(url, headers=signed(url.split("/")[-2], body), json=body)

    body = {"processing_destination": "openrouter", "idempotency_key": str(uuid4())}
    gap = client.post(
        root + "/query", headers=headers(sub="bob"), json={"question": "absent-evidence"}
    ).json()["episode_id"]
    url = root + f"/episodes/{gap}/syntheses"
    assert client.post(url, headers=headers(sub="bob"), json=body).status_code == 428
    r = post(url, body)
    assert r.status_code == 200, r.text
    free = r.json()
    assert (
        free["status"] == "succeeded" and free["provider"] == "none" and not free["budget_reserved"]
    )
    assert not state["requests"]
    response = client.get(
        root + "/companion-responses/" + free["response_id"], headers=headers(sub="bob")
    ).json()
    assert response["response"]["answer_kind"] == "abstention"
    assert post(url, body).json() == free
    assert client.get(root + "/syntheses/" + free["id"], headers=headers()).status_code == 404
    source = client.post(
        root + "/sources",
        headers=headers(),
        json={
            "title": "Synthesis evidence",
            "location": "synthetic://synthesis-evidence",
            "content": "Preuve 🧠",
            "allowed_subjects": ["alice", "bob"],
        },
    ).json()
    eid = str(uuid4())
    citation = {
        **{k: source[k] for k in ("title", "location", "content_hash")},
        "source_id": source["id"],
        "start": 0,
        "end": 8,
        "excerpt": "Preuve 🧠",
    }
    episode = {
        "episode_id": eid,
        "answer": "Preuve 🧠",
        "status": "evidence_found",
        "mode": "extractive",
        "served_version": 0,
        "concepts": [],
        "citations": [citation],
        "processing": "local_no_model",
    }
    with admin.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO cf_episodes(tenant_id,domain_id,id,subject,question,result,source_ids,served_version) VALUES(:t,:d,:e,'bob','Question 🧠',CAST(:r AS jsonb),CAST(:sources AS jsonb),0)"
            ),
            {
                "t": tenant,
                "d": domain,
                "e": eid,
                "r": json.dumps(episode),
                "sources": json.dumps([source["id"]]),
            },
        )
    url = root + f"/episodes/{eid}/syntheses"
    body["idempotency_key"] = str(uuid4())
    r = post(url, body)
    assert r.status_code == 200, r.text
    paid = r.json()
    assert (
        paid["status"] == "succeeded"
        and paid["provider"] == "openrouter"
        and paid["budget_reserved"]
    ), paid
    assert len(state["requests"]) == 1
    assert post(url, body).json() == paid and len(state["requests"]) == 1
    requested = state["requests"][0]
    from cortex_core.synthesis_model import OpenRouterSynthesis
    from pydantic import SecretStr

    oracle = OpenRouterSynthesis("synthetic/model", SecretStr("synthetic-test-key")).prepare(
        "Question 🧠", episode
    )
    assert requested == oracle
    response = client.get(
        root + "/companion-responses/" + paid["response_id"], headers=headers(sub="bob")
    ).json()
    assert (
        response["citations"] == [citation] and response["semantic_validation"] == "not_performed"
    )
    assert post(root + f"/episodes/{gap}/syntheses", body).status_code == 409
    state["response"]["choices"][0]["message"]["content"] = json.dumps(
        {"answer_text": "inventé [9]", "answer_kind": "answer", "citation_indices": [9]}
    )
    body["idempotency_key"] = str(uuid4())
    bad = post(url, body).json()
    assert (
        bad["status"] == "failed"
        and bad["error_code"] == "UNSUPPORTED_SYNTHESIS"
        and bad["response_id"] is None
    ), bad
    assert bad["usage"]["cost_usd"] == 0
    assert post(url, body).json() == bad and len(state["requests"]) == 2
    state["status"] = 402
    body["idempotency_key"] = str(uuid4())
    failed = post(url, body).json()
    assert failed["status"] == "failed" and failed["error_code"] == "MODEL_BUDGET_EXHAUSTED", failed
    assert post(url, body).json() == failed and len(state["requests"]) == 3
    rpc = client.post(
        "/mcp",
        headers={**signed(eid, body), "Accept": "application/json, text/event-stream"},
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "api_syntheses_create",
                "arguments": {"path": {"domain": domain, "episode_id": eid}, "body": body},
            },
        },
    )
    assert rpc.json()["result"]["structuredContent"] == {"http_status": 200, "data": failed}, (
        rpc.text
    )
    return [
        "native_synthesis_durable_no_repeat_personal_free_abstention",
        "native_synthetic_provider_exact_prompt_citations_usage_failed_receipts_http_mcp",
    ]
