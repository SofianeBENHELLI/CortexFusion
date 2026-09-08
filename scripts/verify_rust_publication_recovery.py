"""Native recovery with injected graph ACK loss; real TerminusDB when CI configures it."""

import hashlib
import json
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import httpx
import jsonschema
import jwt
from sqlalchemy import text
from verify_rust_configured import native_client


def start_graph(upstream):
    if upstream:
        assert urlsplit(upstream).hostname in {"localhost", "127.0.0.1"}, (
            "Synthetic loopback engine required"
        )
    state = {"mode": "healthy", "posts": [], "requests": [], "documents": {}}

    class Gateway(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def respond(self, status, body, version=None):
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            if version:
                self.send_header("TerminusDB-Data-Version", version)
            self.end_headers()
            self.wfile.write(body)

        def dispatch(self):
            parts = urlsplit(self.path).path.split("/")
            instance = (
                self.command == "POST"
                and parts[2] == "document"
                and parse_qs(urlsplit(self.path).query).get("graph_type") != ["schema"]
            )
            state["requests"].append((self.command, self.path))
            raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            if self.command == "POST":
                state["posts"].append(self.path)
            if instance and state["mode"] == "incomplete":
                self.respond(503, b"{}")
                return
            if upstream:
                with httpx.Client(timeout=10, trust_env=False, follow_redirects=False) as forward:
                    response = forward.request(
                        self.command,
                        upstream.rstrip("/") + self.path,
                        content=raw or None,
                        headers={
                            "Authorization": self.headers.get("Authorization", ""),
                            "Content-Type": "application/json",
                        },
                    )
                status, body, version = (
                    response.status_code,
                    response.content,
                    response.headers.get("terminusdb-data-version"),
                )
            else:
                database = parts[4]
                status, body, version = 200, b"[]", "branch:synthetic_commit"
                if self.command == "POST" and parts[2] == "db":
                    if database in state["documents"]:
                        status = 409
                    else:
                        state["documents"][database] = []
                elif instance:
                    state["documents"][database] = json.loads(raw)
                elif self.command == "GET":
                    if database not in state["documents"]:
                        status = 404
                    else:
                        body = json.dumps(state["documents"][database]).encode()
            if instance and (callback := state.pop("after_instance", None)):
                callback()
            if instance and state["mode"] == "complete" and status < 300:
                self.respond(503, b"{}")
            else:
                self.respond(status, body, version)

        do_POST = dispatch
        do_GET = dispatch

    server = ThreadingHTTPServer(("127.0.0.1", 0), Gateway)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, state


def verify_publication_recovery(binary, env, headers, admin, tenant, private):
    server, engine = start_graph(env.get("CORTEX_TERMINUS_URL"))
    try:
        with native_client(
            binary,
            {
                **env,
                "CORTEX_TERMINUS_URL": f"http://127.0.0.1:{server.server_port}",
                "CORTEX_TERMINUS_USER": env.get("CORTEX_TERMINUS_USER", "admin"),
                "CORTEX_TERMINUS_PASSWORD": env.get("CORTEX_TERMINUS_PASSWORD", "synthetic-test"),
            },
        ) as client:
            spec = client.get("/openapi.json").json()

            def validate(name, value):
                schema = {"$ref": "#/components/schemas/" + name, "components": spec["components"]}
                jsonschema.Draft202012Validator(
                    schema, format_checker=jsonschema.FormatChecker()
                ).validate(value)
                return value

            def signed(action, args):
                now = int(time.time())
                digest = hashlib.sha256(
                    json.dumps(
                        {"action": action, "arguments": args},
                        sort_keys=True,
                        separators=(",", ":"),
                        ensure_ascii=False,
                    ).encode()
                ).hexdigest()
                return jwt.encode(
                    {
                        "iss": "cortex-trusted-host",
                        "aud": "cortex-mcp-confirmation",
                        "sub": "alice",
                        "tenant": tenant,
                        "action": action,
                        "command_hash": digest,
                        "jti": str(uuid4()),
                        "iat": now,
                        "exp": now + 120,
                    },
                    private,
                    algorithm="RS256",
                )

            def command(d, p, body, retry=False, mcp=False, confirm=True):
                action = "proposals.retry_publication" if retry else "proposals.publish"
                args = {"path": {"domain": d, "proposal_id": p}, "body": body}
                h = headers()
                if confirm:
                    h["X-Cortex-Confirmation"] = signed(action, args)
                if mcp:
                    r = client.post(
                        "/mcp/",
                        headers={**h, "Accept": "application/json, text/event-stream"},
                        json={
                            "jsonrpc": "2.0",
                            "id": 1,
                            "method": "tools/call",
                            "params": {
                                "name": "api_" + action.replace(".", "_"),
                                "arguments": args,
                            },
                        },
                    )
                    assert r.status_code == 200, r.text
                    result = r.json()["result"]["structuredContent"]
                    return result["http_status"], result["data"]
                r = client.post(
                    f"/v1/domains/{d}/proposals/{p}/"
                    + ("publication-attempts" if retry else "publish"),
                    headers=h,
                    json=body,
                )
                return r.status_code, r.json()

            def seed():
                d = str(uuid4())
                with admin.begin() as conn:
                    conn.execute(
                        text(
                            "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'Recovery fixture')"
                        ),
                        {"t": tenant, "d": d},
                    )
                    conn.execute(
                        text(
                            "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,'alice','owner'),(:t,:d,'bob','viewer')"
                        ),
                        {"t": tenant, "d": d},
                    )
                root = f"/v1/domains/{d}"
                content = "Preuve synthétique de reprise 🧠."
                r = client.post(
                    root + "/sources",
                    headers=headers(),
                    json={
                        "title": "Reprise",
                        "location": "synthetic://recovery",
                        "content": content,
                        "allowed_subjects": ["alice", "bob"],
                    },
                )
                assert r.status_code == 201, r.text
                source = r.json()["id"]
                r = client.post(
                    root + "/proposals",
                    headers=headers(),
                    json={
                        "base_version": 0,
                        "changes": [
                            {
                                "kind": "put_concept",
                                "concept": {
                                    "concept_id": str(uuid4()),
                                    "title": "Reprise",
                                    "body": content,
                                    "sources": [
                                        {"source_id": source, "start": 0, "end": len(content)}
                                    ],
                                },
                            }
                        ],
                        "reason": "Fixture synthétique",
                        "idempotency_key": str(uuid4()),
                    },
                )
                assert r.status_code == 201, r.text
                proposal = r.json()
                body = {
                    "digest": proposal["digest"],
                    "expected_version": 0,
                    "expected_review_revision": 0,
                    "reason": "Validation synthétique",
                    "idempotency_key": str(uuid4()),
                }
                args = {"path": {"domain": d, "proposal_id": proposal["id"]}, "body": body}
                r = client.post(
                    root + f"/proposals/{proposal['id']}/approve",
                    headers={
                        **headers(),
                        "X-Cortex-Confirmation": signed("proposals.approve", args),
                    },
                    json=body,
                )
                assert r.status_code == 200, r.text
                return d, proposal["id"], source

            def history(d, p, **params):
                r = client.get(
                    f"/v1/domains/{d}/proposals/{p}/publication-attempts",
                    headers=headers(),
                    params=params,
                )
                assert r.status_code == 200, r.text
                return validate("GraphPublicationAttemptPage", r.json())

            def decision(d, p):
                current = history(d, p)
                a = current["active_attempt"]
                return {
                    "expected_published_version": current["published_version"],
                    "expected_attempt_id": a["id"],
                    "expected_generation": a["generation"],
                    "idempotency_key": str(uuid4()),
                    "reason": "Remplacer cette préparation incomplète",
                }

            publish = {"expected_published_version": 0}
            d, p, source = seed()
            assert history(d, p)["items"] == []
            none = {
                "expected_published_version": 0,
                "expected_attempt_id": str(uuid4()),
                "expected_generation": 1,
                "idempotency_key": str(uuid4()),
                "reason": "Initialisation refusée",
            }
            assert command(d, p, none, retry=True)[1]["error"] == "PUBLICATION_NOT_PREPARED"
            engine["mode"] = "incomplete"
            assert command(d, p, publish)[0] == 503
            first = history(d, p)["active_attempt"]
            assert first["generation"] == 1 and first["status"] == "uncertain"
            body = decision(d, p)
            body["expected_published_version"] = 0.0
            body["expected_generation"] = 1.0
            assert command(d, p, body, retry=True, confirm=False)[0] == 428
            engine["mode"] = "healthy"
            status, receipt = command(d, p, body, retry=True, mcp=True)
            assert status == 201, receipt
            validate("GraphPublicationRetryReceipt", receipt)
            assert (
                receipt["outcome"] == "published"
                and receipt["attempt"]["generation"] == 2
                and receipt["attempt"]["predecessor_id"] == first["id"]
            )
            assert receipt["attempt"]["id"] != first["id"]
            posts = len(engine["posts"])
            assert command(d, p, body, retry=True) == (201, receipt)
            assert (
                command(d, p, {**body, "reason": "Différent"}, retry=True)[1]["error"]
                == "IDEMPOTENCY_CONFLICT"
            )
            assert len(engine["posts"]) == posts
            page = history(d, p, limit=1)
            assert page["items"][0]["status"] == "superseded" and page["next_after"] == 1
            assert history(d, p, after=1)["items"] == [receipt["attempt"]]
            root = f"/v1/domains/{d}/proposals/{p}"
            seen = []
            cursor = None
            while True:
                params = {"limit": 1, **({"after": cursor} if cursor else {})}
                r = client.get(root + "/publication-events", headers=headers(), params=params)
                assert r.status_code == 200, r.text
                page = validate("GraphPublicationEventPage", r.json())
                seen.extend(page["items"])
                cursor = page["next_after"]
                if not cursor:
                    break
            assert [e["kind"] for e in seen] == [
                "reserved",
                "uncertain",
                "superseded",
                "reserved",
                "ready",
            ]
            assert len({e["id"] for e in seen}) == 5
            for suffix in ["publication-attempts", "publication-events"]:
                assert (
                    client.get(root + "/" + suffix, headers=headers(sub="bob")).status_code == 403
                )
                assert (
                    client.get(
                        root + "/" + suffix, headers=headers(), params={"limit": 101}
                    ).status_code
                    == 422
                )
                assert (
                    client.get(
                        root + "/" + suffix, headers=headers(), params={"unknown": 1}
                    ).status_code
                    == 422
                )
            for suffix in ["publication_attempts", "publication_events"]:
                result = client.post(
                    "/mcp/",
                    headers={**headers(), "Accept": "application/json, text/event-stream"},
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "tools/call",
                        "params": {
                            "name": "api_proposals_" + suffix,
                            "arguments": {
                                "path": {"domain": d, "proposal_id": p},
                                "query": {"limit": 50.0},
                            },
                        },
                    },
                ).json()["result"]["structuredContent"]
                assert result == {
                    "http_status": 200,
                    "data": client.get(
                        root + "/" + suffix.replace("_", "-"), headers=headers()
                    ).json(),
                }
            with admin.begin() as conn:
                conn.execute(
                    text(
                        "UPDATE cf_sources SET allowed_subjects='[\"bob\"]' WHERE tenant_id=:t AND id=:s"
                    ),
                    {"t": tenant, "s": source},
                )
            assert client.get(root + "/publication-attempts", headers=headers()).status_code == 404
            assert client.get(root + "/publication-events", headers=headers()).status_code == 404
            assert command(d, p, body, retry=True)[0] == 404
            assert len(engine["posts"]) == posts

            # A complete graph whose acknowledgement was lost needs GET reconciliation only.
            d, p, _ = seed()
            engine["mode"] = "complete"
            assert command(d, p, publish)[0] == 503
            body = decision(d, p)
            posts = len(engine["posts"])
            engine["mode"] = "healthy"
            assert command(d, p, body, retry=True)[1]["error"] == "PUBLICATION_READY_TO_RECONCILE"
            assert len(history(d, p)["items"]) == 1
            assert command(d, p, publish)[1]["changed"]
            assert len(engine["posts"]) == posts

            # An incomplete new attempt must remain unresolved on replay; a new decision replaces it.
            d, p, _ = seed()
            engine["mode"] = "incomplete"
            assert command(d, p, publish)[0] == 503
            old = decision(d, p)
            status, receipt = command(d, p, old, retry=True)
            assert status == 201 and receipt["outcome"] == "unresolved", receipt
            posts = len(engine["posts"])
            assert (
                command(d, p, old, retry=True, mcp=True)[1]["attempt"]["id"]
                == receipt["attempt"]["id"]
            )
            assert len(engine["posts"]) == posts
            fresh = decision(d, p)
            engine["mode"] = "healthy"
            status, receipt = command(d, p, fresh, retry=True)
            assert (
                status == 201
                and receipt["outcome"] == "published"
                and receipt["attempt"]["generation"] == 3
            ), receipt
            requests = len(engine["requests"])
            superseded = command(d, p, old, retry=True)
            assert superseded[0] == 201 and superseded[1]["outcome"] == "superseded", superseded
            assert len(engine["requests"]) == requests
            assert (
                command(d, p, {**fresh, "idempotency_key": str(uuid4())}, retry=True)[1]["error"]
                == "PUBLICATION_ALREADY_PUBLISHED"
            )
            # An old projection repair can change SQL content without changing its version.
            d, p, _ = seed()
            with admin.begin() as conn:
                canonical = conn.execute(
                    text(
                        "SELECT changes->0->'concept' FROM cf_commits WHERE tenant_id=:t AND domain_id=:d AND sequence=1"
                    ),
                    {"t": tenant, "d": d},
                ).scalar_one()
                obsolete = {**canonical, "title": "Ancienne projection à réparer"}
                conn.execute(
                    text(
                        "INSERT INTO cf_concepts(tenant_id,domain_id,id,payload,version) VALUES(:t,:d,:id,CAST(:payload AS jsonb),1)"
                    ),
                    {
                        "t": tenant,
                        "d": d,
                        "id": canonical["concept_id"],
                        "payload": json.dumps(obsolete),
                    },
                )
                conn.execute(
                    text("UPDATE cf_proposals SET status='published' WHERE tenant_id=:t AND id=:p"),
                    {"t": tenant, "p": p},
                )
                conn.execute(
                    text("UPDATE cf_domains SET published_version=1 WHERE tenant_id=:t AND id=:d"),
                    {"t": tenant, "d": d},
                )

            def repair_projection():
                with admin.begin() as conn:
                    conn.execute(
                        text(
                            "UPDATE cf_concepts SET payload=CAST(:payload AS jsonb) WHERE tenant_id=:t AND domain_id=:d AND id=:id"
                        ),
                        {
                            "t": tenant,
                            "d": d,
                            "id": canonical["concept_id"],
                            "payload": json.dumps(canonical),
                        },
                    )

            engine["after_instance"] = repair_projection
            cli_env = {
                **env,
                "CORTEX_TERMINUS_URL": f"http://127.0.0.1:{server.server_port}",
                "CORTEX_TERMINUS_USER": env.get("CORTEX_TERMINUS_USER", "admin"),
                "CORTEX_TERMINUS_PASSWORD": env.get("CORTEX_TERMINUS_PASSWORD", "synthetic-test"),
                "CORTEX_MIGRATION_BEARER": headers()["Authorization"].removeprefix("Bearer "),
                "CORTEX_MIGRATION_TENANT": tenant,
            }
            result = subprocess.run(
                [str(binary.resolve()), "--import-published", d],
                env=cli_env,
                capture_output=True,
                text=True,
                timeout=15,
            )
            assert result.returncode != 0 and "GRAPH_IMPORT_STATE_CHANGED" in result.stderr
            with admin.begin() as conn:
                assert (
                    conn.execute(
                        text(
                            "SELECT count(*) FROM cf_graph_manifests WHERE tenant_id=:t AND domain_id=:d"
                        ),
                        {"t": tenant, "d": d},
                    ).scalar_one()
                    == 0
                )
                assert (
                    conn.execute(
                        text(
                            "SELECT status FROM cf_graph_preparations WHERE tenant_id=:t AND domain_id=:d"
                        ),
                        {"t": tenant, "d": d},
                    ).scalar_one()
                    == "stale"
                )
                assert (
                    conn.execute(
                        text("SELECT payload FROM cf_concepts WHERE tenant_id=:t AND domain_id=:d"),
                        {"t": tenant, "d": d},
                    ).scalar_one()
                    == canonical
                )
                assert (
                    conn.execute(
                        text(
                            "SELECT published_version FROM cf_domains WHERE tenant_id=:t AND id=:d"
                        ),
                        {"t": tenant, "d": d},
                    ).scalar_one()
                    == 1
                )
            return [
                "native_import_rechecks_projection_digest_after_engine_IO",
                "native_recovery_signed_MCP_new_generation_publication",
                "native_recovery_idempotency_conflict_and_replay_no_POST",
                "native_recovery_attempt_event_pagination_schema_HTTP_MCP_parity",
                "native_recovery_current_owner_and_source_ACL",
                "native_recovery_complete_lost_ACK_requires_normal_GET_reconciliation",
                "native_recovery_incomplete_replay_unresolved_and_superseded_receipt",
            ]
    finally:
        server.shutdown()
        server.server_close()
