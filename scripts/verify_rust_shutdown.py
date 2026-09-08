"""Native SIGTERM/SIGINT drain, deadline and durable import recovery on synthetic state."""

import concurrent.futures
import hashlib
import json
import os
import selectors
import signal
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from uuid import uuid4

import httpx
from sqlalchemy import text
from verify_coordinated_restore import Fixture, fixture_keys
from verify_rust_configured import native_client
from verify_rust_publication_recovery import start_graph


def verify_shutdown(binary, env, admin):
    if os.name != "posix":
        return ["native_shutdown_unix_signal_checks_not_applicable"]
    checks = []
    server, engine = start_graph(env.get("CORTEX_TERMINUS_URL"))
    try:
        with tempfile.TemporaryDirectory(prefix="cortex-shutdown-") as temporary:
            directory = Path(temporary)
            fixture = Fixture(str(uuid4()), fixture_keys(directory))
            with admin.begin() as conn:
                conn.execute(
                    text("INSERT INTO cf_tenants(id,name) VALUES(:t,'Shutdown synthetic')"),
                    {"t": fixture.tenant},
                )
            configured = {
                **env,
                "CORTEX_JWT_PUBLIC_KEY_FILE": str(directory / "identity.pem"),
                "CORTEX_CONFIRMATION_PUBLIC_KEY_FILE": str(directory / "confirmation.pem"),
                "CORTEX_JWT_ISSUER": "https://identity.test",
                "CORTEX_JWT_AUDIENCE": "cortex-core",
                "CORTEX_TERMINUS_URL": f"http://127.0.0.1:{server.server_port}",
                "CORTEX_TERMINUS_USER": env.get("CORTEX_TERMINUS_USER", "admin"),
                "CORTEX_TERMINUS_PASSWORD": env.get("CORTEX_TERMINUS_PASSWORD", "synthetic-test"),
            }
            for scenario in [
                "sigterm_http",
                "sigint_mcp",
                "deadline",
                "revoked_evidence",
                "second_signal",
            ]:
                domain, source, concept_id, proposal = [str(uuid4()) for _ in range(4)]
                content = "Synthetic drain proof 🧠."
                concept = {
                    "concept_id": concept_id,
                    "title": "Drain",
                    "body": content,
                    "maturity": "observed",
                    "sources": [{"source_id": source, "start": 0, "end": len(content)}],
                    "links": [],
                }
                with admin.begin() as conn:
                    params = {
                        "t": fixture.tenant,
                        "d": domain,
                        "s": source,
                        "c": concept_id,
                        "p": proposal,
                        "body": content,
                        "hash": hashlib.sha256(content.encode()).hexdigest(),
                        "payload": json.dumps(concept),
                        "changes": json.dumps([{"kind": "put_concept", "concept": concept}]),
                    }
                    conn.execute(
                        text(
                            "INSERT INTO cf_domains(tenant_id,id,name,accepted_version,published_version) VALUES(:t,:d,'Drain',1,1)"
                        ),
                        params,
                    )
                    conn.execute(
                        text(
                            "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,'alice','owner'),(:t,:d,'bob','viewer')"
                        ),
                        params,
                    )
                    conn.execute(
                        text(
                            "INSERT INTO cf_sources(tenant_id,domain_id,id,title,location,content,content_hash,allowed_subjects) VALUES(:t,:d,:s,'Drain','synthetic://drain',:body,:hash,'[\"alice\"]')"
                        ),
                        params,
                    )
                    conn.execute(
                        text(
                            "INSERT INTO cf_proposals(tenant_id,domain_id,id,author,base_version,payload,digest,reason,validation,status,idempotency_key,request_hash) VALUES(:t,:d,:p,'alice',0,'{}',:hash,'Synthetic drain','{}','published',:p,:hash)"
                        ),
                        params,
                    )
                    conn.execute(
                        text(
                            "INSERT INTO cf_commits(tenant_id,domain_id,sequence,proposal_id,author,reason,digest,changes,before_state,decision_key,decision_hash) VALUES(:t,:d,1,:p,'alice','Synthetic',:hash,CAST(:changes AS jsonb),'{}',:p,:hash)"
                        ),
                        params,
                    )
                    conn.execute(
                        text(
                            "INSERT INTO cf_concepts(tenant_id,domain_id,id,payload,version) VALUES(:t,:d,:c,CAST(:payload AS jsonb),1)"
                        ),
                        params,
                    )
                entered, release = threading.Event(), threading.Event()

                def pause(entered=entered, release=release):
                    entered.set()
                    assert release.wait(10), "Synthetic drain gate was not released"

                engine["after_instance"] = pause
                process = subprocess.Popen(
                    [str(binary.resolve())],
                    env={
                        **configured,
                        "CORTEX_SHUTDOWN_GRACE_SECONDS": "1" if scenario == "deadline" else "5",
                    },
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )
                try:
                    with selectors.DefaultSelector() as selector:
                        selector.register(process.stdout, selectors.EVENT_READ)
                        assert selector.select(15), "Native drain server did not start"
                        line = process.stdout.readline().strip()
                    prefix = "CortexFusion Rust migration candidate listening on "
                    assert line.startswith(prefix), line
                    base = "http://" + line.removeprefix(prefix)
                    with httpx.Client(base_url=base, trust_env=False, timeout=15) as client:
                        diagnostic = client.get(
                            f"/v1/domains/{domain}/graph-import-attempts", headers=fixture.headers()
                        ).json()
                        body = {
                            "expected_published_version": 1,
                            "expected_projection_digest": diagnostic["digest"],
                        }
                        args = {"path": {"domain": domain}, "body": body}
                        headers = fixture.signed("graph.import_published", args)

                        def request(
                            scenario=scenario, headers=headers, args=args, domain=domain, body=body
                        ):
                            if scenario == "sigint_mcp":
                                response = client.post(
                                    "/mcp/",
                                    headers={
                                        **headers,
                                        "Accept": "application/json, text/event-stream",
                                    },
                                    json={
                                        "jsonrpc": "2.0",
                                        "id": 1,
                                        "method": "tools/call",
                                        "params": {
                                            "name": "api_graph_import_published",
                                            "arguments": args,
                                        },
                                    },
                                )
                                assert response.status_code == 200, response.text
                                result = response.json()["result"]["structuredContent"]
                                return result["http_status"], result["data"]
                            response = client.post(
                                f"/v1/domains/{domain}/graph-import", headers=headers, json=body
                            )
                            return response.status_code, response.json()

                        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                            future = pool.submit(request)
                            assert entered.wait(10), "Import did not reach engine"
                            started = time.monotonic()
                            process.send_signal(
                                signal.SIGINT if scenario == "sigint_mcp" else signal.SIGTERM
                            )
                            time.sleep(0.15)
                            assert process.poll() is None, (
                                "Signal terminated an accepted request immediately"
                            )
                            try:
                                response = httpx.get(base + "/ready", trust_env=False, timeout=0.5)
                            except httpx.HTTPError:
                                pass
                            else:
                                raise AssertionError(
                                    f"Draining server still admitted a connection: {response.status_code}"
                                )
                            if scenario == "revoked_evidence":
                                with admin.begin() as conn:
                                    conn.execute(
                                        text(
                                            "UPDATE cf_sources SET allowed_subjects='[\"bob\"]' WHERE tenant_id=:t AND domain_id=:d AND id=:s"
                                        ),
                                        {"t": fixture.tenant, "d": domain, "s": source},
                                    )
                            if scenario in ("deadline", "second_signal"):
                                if scenario == "second_signal":
                                    process.send_signal(signal.SIGTERM)
                                process.wait(4)
                                assert process.returncode != 0 and time.monotonic() - started < 4
                                try:
                                    future.result(2)
                                except httpx.HTTPError:
                                    pass
                                else:
                                    raise AssertionError(
                                        "Interrupted drain returned a successful command"
                                    )
                                release.set()
                            else:
                                release.set()
                                status, result = future.result(5)
                                assert status == (404 if scenario == "revoked_evidence" else 200), (
                                    result
                                )
                                if status == 200:
                                    assert result["outcome"] == "registered", result
                                process.wait(5)
                                assert process.returncode == 0, process.stderr.read()
                    with admin.connect() as conn:
                        state = (
                            conn.execute(
                                text(
                                    "SELECT p.id,p.generation,(SELECT count(*) FROM cf_graph_manifests m WHERE m.tenant_id=p.tenant_id AND m.domain_id=p.domain_id) AS manifests FROM cf_graph_preparations p WHERE p.tenant_id=:t AND p.domain_id=:d"
                                ),
                                {"t": fixture.tenant, "d": domain},
                            )
                            .mappings()
                            .one()
                        )
                        assert state["generation"] == 1
                        assert state["manifests"] == (
                            1 if scenario in ("sigterm_http", "sigint_mcp") else 0
                        )
                    if scenario in ("deadline", "second_signal"):
                        posts = len(engine["posts"])
                        with native_client(binary, configured) as restarted:
                            receipt = fixture.command(
                                restarted, domain, "graph-import", "graph.import_published", body
                            )
                            assert (
                                receipt["outcome"] == "registered"
                                and receipt["attempt"]["id"] == state["id"]
                            )
                        assert len(engine["posts"]) == posts, (
                            "Restart created another engine staging"
                        )
                    checks.append("native_shutdown_" + scenario)
                finally:
                    release.set()
                    if process.poll() is None:
                        process.kill()
                    process.wait(5)
    finally:
        server.shutdown()
        server.server_close()
    return checks
