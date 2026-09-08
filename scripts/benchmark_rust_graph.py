"""Synthetic graph-volume measurement. No model, production data, or latency SLO."""

import argparse
import concurrent.futures
import hashlib
import json
import math
import os
import platform
import selectors
import subprocess
import tempfile
import threading
import time
from collections import Counter
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID, uuid4, uuid5

import httpx
from cortex_core.service import digest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from verify_coordinated_restore import Fixture, fixture_keys
from verify_rust_publication_recovery import start_graph

ROOT = Path(__file__).resolve().parents[1]


def fixture_data(size, tenant, source_profile="short_distinct"):
    assert source_profile in {"short_distinct", "shared_long"}
    namespace = UUID(tenant)
    concepts, sources = [], []
    for index in range(size):
        content = (
            f"Signal{index:05d} is a synthetic approved observation 🧠. "
            + "This exact excerpt is recorded for the graph-volume qualification and contains no enterprise knowledge."
        )
        sid = str(uuid5(namespace, f"source-{index}"))
        cid = str(uuid5(namespace, f"concept-{index}"))
        sources.append(
            {
                "id": sid,
                "content": content,
                "hash": hashlib.sha256(content.encode()).hexdigest(),
                "readers": ["alice", "bob"] if index % 2 == 0 else ["alice"],
            }
        )
        concepts.append(
            {
                "concept_id": cid,
                "title": f"Signal{index:05d}",
                "body": content,
                "maturity": "observed",
                "sources": [{"source_id": sid, "start": 0, "end": len(content)}],
                "links": []
                if index % 2 or index + 1 == size
                else [
                    {
                        "target_id": str(uuid5(namespace, f"concept-{index + 1}")),
                        "kind": "associative",
                        "primary": False,
                        "weight": 1.0,
                    }
                ],
            }
        )
    if source_profile == "shared_long":
        # Two independently protected documents, each at the source codepoint limit.
        # Padding distributes proof spans through the document, including its end.
        sources = []
        for parity in (0, 1):
            group = concepts[parity::2]
            padding = 200_000 - sum(len(c["body"]) + 1 for c in group)
            assert group and padding >= 0
            quotient, remainder = divmod(padding, len(group))
            sid = str(uuid5(namespace, f"shared-source-{parity}"))
            parts, cursor = [], 0
            for index, concept in enumerate(group):
                count = quotient + (index < remainder)
                filler = ("e🧠\u0301" * math.ceil(count / 3))[:count]
                parts.extend([filler, concept["body"], "\n"])
                start = cursor + count
                end = start + len(concept["body"])
                concept["sources"] = [{"source_id": sid, "start": start, "end": end}]
                cursor = end + 1
            content = "".join(parts)
            assert len(content) == cursor == 200_000
            sources.append(
                {
                    "id": sid,
                    "content": content,
                    "hash": hashlib.sha256(content.encode()).hexdigest(),
                    "readers": ["alice", "bob"] if parity == 0 else ["alice"],
                }
            )
    return concepts, sources


def seed(admin, fixture, size, source_profile="short_distinct"):
    domain = str(uuid4())
    concepts, sources = fixture_data(size, fixture.tenant, source_profile)
    version = math.ceil(size / 50)
    with admin.begin() as conn:
        conn.execute(
            text("INSERT INTO cf_tenants(id,name) VALUES(:t,'Synthetic graph benchmark')"),
            {"t": fixture.tenant},
        )
        conn.execute(
            text(
                "INSERT INTO cf_domains(tenant_id,id,name,accepted_version,published_version) VALUES(:t,:d,'Synthetic graph benchmark',:v,:v)"
            ),
            {"t": fixture.tenant, "d": domain, "v": version},
        )
        conn.execute(
            text(
                "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,'alice','owner'),(:t,:d,'bob','viewer')"
            ),
            {"t": fixture.tenant, "d": domain},
        )
        conn.execute(
            text(
                "INSERT INTO cf_sources(tenant_id,domain_id,id,title,location,content,content_hash,allowed_subjects) VALUES(:t,:d,:id,'Benchmark proof','synthetic://graph-benchmark',:content,:hash,CAST(:readers AS jsonb))"
            ),
            [
                {
                    "t": fixture.tenant,
                    "d": domain,
                    **source,
                    "readers": json.dumps(source["readers"]),
                }
                for source in sources
            ],
        )
        for offset in range(0, size, 50):
            sequence = offset // 50 + 1
            proposal = str(uuid5(UUID(fixture.tenant), f"proposal-{sequence}"))
            changes = [
                {"kind": "put_concept", "concept": c} for c in concepts[offset : offset + 50]
            ]
            params = {
                "t": fixture.tenant,
                "d": domain,
                "p": proposal,
                "sequence": sequence,
                "hash": digest(changes),
                "changes": json.dumps(changes),
                "base": sequence - 1,
            }
            conn.execute(
                text(
                    "INSERT INTO cf_proposals(tenant_id,domain_id,id,author,base_version,payload,digest,reason,validation,status,idempotency_key,request_hash) VALUES(:t,:d,:p,'alice',:base,'{}',:hash,'Synthetic benchmark history','{}','published',:p,:hash)"
                ),
                params,
            )
            conn.execute(
                text(
                    "INSERT INTO cf_commits(tenant_id,domain_id,sequence,proposal_id,author,reason,digest,changes,before_state,decision_key,decision_hash) VALUES(:t,:d,:sequence,:p,'alice','Synthetic benchmark history',:hash,CAST(:changes AS jsonb),'{}',:p,:hash)"
                ),
                params,
            )
        conn.execute(
            text(
                "INSERT INTO cf_concepts(tenant_id,domain_id,id,payload,version) VALUES(:t,:d,:id,CAST(:payload AS jsonb),:v)"
            ),
            [
                {
                    "t": fixture.tenant,
                    "d": domain,
                    "id": c["concept_id"],
                    "payload": json.dumps(c),
                    "v": i // 50 + 1,
                }
                for i, c in enumerate(concepts)
            ],
        )
    return domain, version, concepts, sources


@contextmanager
def native(binary, env):
    process = subprocess.Popen([str(binary.resolve())], env=env, stdout=subprocess.PIPE, text=True)
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            assert selector.select(20), "Native benchmark server did not start"
            line = process.stdout.readline().strip()
        prefix = "CortexFusion Rust migration candidate listening on "
        assert line.startswith(prefix), "Unexpected native startup response"
        with httpx.Client(
            base_url="http://" + line.removeprefix(prefix),
            timeout=30,
            trust_env=False,
            follow_redirects=False,
            limits=httpx.Limits(max_connections=32, max_keepalive_connections=32),
        ) as client:
            yield client, process
    finally:
        process.terminate()
        try:
            process.wait(10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(5)


def rss_kib(process):
    try:
        return int(
            subprocess.check_output(
                ["ps", "-o", "rss=", "-p", str(process.pid)], text=True, timeout=2
            ).strip()
        )
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def percentile(samples, percentile):
    values = sorted(samples)
    return values[max(0, math.ceil(len(values) * percentile) - 1)] if values else None


def classify_import(status, body):
    if status == 200:
        assert body.get("outcome") in {"registered", "unresolved"}, "Unexpected import outcome"
        return body["outcome"]
    assert status == 503 and body.get("error") == "STORAGE_ERROR", (
        "Unexpected import authentication or contract failure"
    )
    return "service_unavailable"


def mcp_result(data):
    assert data.get("jsonrpc") == "2.0" and data.get("id") == 1
    assert "result" in data and "structuredContent" in data["result"], "Invalid MCP result envelope"
    result = data["result"]
    structured = result["structuredContent"]
    status = structured["http_status"]
    assert isinstance(status, int) and not isinstance(status, bool)
    assert result.get("isError", False) is (status >= 400), "Contradictory MCP error flag"
    return status, structured["data"]


def measurement_summary(report):
    cells = [cell for volume in report["volumes"] for cell in volume["measurements"]]
    requests = sum(cell["requests"] for cell in cells)
    return {
        "measured_cells": len(cells),
        "measured_requests": requests,
        "availability": "not_measured"
        if not requests
        else "degraded"
        if any(any(status != "200" for status in cell["statuses"]) for cell in cells)
        else "all_measured_requests_succeeded",
    }


def measure(client, fixture, domain, version, concepts, sources, operation, concurrency):
    subject = "alice" if operation == "list_http_owner" else "bob"
    mcp = "mcp" in operation
    query = operation.startswith("query")
    single = operation.startswith("concept")
    rpc = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "api_knowledge_query"
            if query
            else "api_concepts_read"
            if single
            else "api_concepts_list",
        },
    }
    expected = concepts if subject == "alice" else [{**c, "links": []} for c in concepts[::2]]

    targets = [concepts[i] for i in sorted({0, 2 * (len(concepts) // 4), len(concepts) - 2})]

    def oracle(data, target):
        if query:
            assert data["status"] == "evidence_found" and data["served_version"] == version
            assert data["answer"] == target["body"] and data["concepts"] == [
                {**target, "links": []}
            ]
            assert len(data["citations"]) == 1
            citation = data["citations"][0]
            reference = target["sources"][0]
            source = next(s for s in sources if s["id"] == reference["source_id"])
            assert (
                citation["source_id"] == source["id"] and citation["content_hash"] == source["hash"]
            )
            assert (
                citation["start"] == reference["start"]
                and citation["end"] == reference["end"]
                and citation["excerpt"] == source["content"][reference["start"] : reference["end"]]
            )
            return data["episode_id"]
        assert data == ({**target, "links": []} if single else expected), (
            "Concept payload differs from oracle"
        )
        return None

    count = max(12, concurrency * 2)
    barrier = threading.Barrier(concurrency)

    def request(index):
        target = targets[index % len(targets)]
        request_arguments = {"path": {"domain": domain}}
        if query:
            request_arguments["body"] = {"question": target["title"], "limit": 1, "max_chars": 8000}
        if single:
            request_arguments["path"]["concept_id"] = target["concept_id"]
        if index < concurrency:
            barrier.wait(timeout=10)
        headers = fixture.headers(subject)
        started = time.monotonic()
        try:
            if mcp:
                response = client.post(
                    "/mcp/",
                    headers={**headers, "Accept": "application/json, text/event-stream"},
                    json={**rpc, "params": {**rpc["params"], "arguments": request_arguments}},
                )
            elif query:
                response = client.post(
                    f"/v1/domains/{domain}/query", headers=headers, json=request_arguments["body"]
                )
            else:
                response = client.get(
                    f"/v1/domains/{domain}/concepts"
                    + ("/" + target["concept_id"] if single else ""),
                    headers=headers,
                )
        except httpx.HTTPError:
            return {
                "latency_ms": (time.monotonic() - started) * 1000,
                "status": "transport_error",
                "bytes": 0,
            }
        elapsed = (time.monotonic() - started) * 1000
        status, data = response.status_code, response.json()
        if mcp and status == 200:
            status, data = mcp_result(data)
        episode = oracle(data, target) if status == 200 else None
        assert status in {200, 503}, f"Unexpected benchmark HTTP status {status}"
        return {
            "latency_ms": elapsed,
            "status": str(status),
            "bytes": len(response.content),
            "episode_id": episode,
        }

    started = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool:
        samples = list(pool.map(request, range(count)))
    duration = time.monotonic() - started
    statuses = Counter(sample["status"] for sample in samples)
    latencies = [sample["latency_ms"] for sample in samples]
    episodes = [sample["episode_id"] for sample in samples if sample.get("episode_id")]
    assert len(episodes) == len(set(episodes)), "Queries reused a private episode"
    return {
        "operation": operation,
        "subject": subject,
        "concurrency": concurrency,
        "requests": count,
        "duration_seconds": duration,
        "statuses": dict(statuses),
        "completed_per_second": count / duration,
        "successful_per_second": statuses["200"] / duration,
        "latency_ms": {
            "median": percentile(latencies, 0.5),
            "p95": percentile(latencies, 0.95),
            "max": max(latencies),
        },
        "response_bytes_max": max(sample["bytes"] for sample in samples),
        "query_episodes": len(episodes),
        "target_titles": [c["title"] for c in targets] if query or single else [],
        "samples": [{k: v for k, v in sample.items() if k != "episode_id"} for sample in samples],
    }


def run(args, report):
    admin_url, rust_url = (
        os.environ["CORTEX_TEST_ADMIN_URL"],
        os.environ["CORTEX_RUST_DATABASE_URL"],
    )
    assert make_url(admin_url).database.endswith("_test") and make_url(rust_url).database.endswith(
        "_test"
    ), "Dedicated *_test databases required"
    admin = create_engine(admin_url)
    report.update(
        {
            "status": "running",
            "model_calls": 0,
            "source_profile": args.source_profile,
            "profile": (
                "one short source per concept"
                if args.source_profile == "short_distinct"
                else "two shared 200000-codepoint documents; proof spans distributed through each document"
            )
            + "; public/private pairs; one public-to-private link per pair",
            "pool": {"sql_connections": 10, "acquire_timeout_seconds": 3, "http_connections": 32},
            "quantile": "nearest rank, all attempts including errors; small diagnostic samples only",
            "runtime": {
                "platform": platform.platform(),
                "cpu_count": os.cpu_count(),
                "binary_sha256": hashlib.sha256(args.binary.read_bytes()).hexdigest(),
                "build_profile": args.build_profile,
                "tested_merge": os.getenv("GITHUB_SHA"),
                "candidate_commit": os.getenv("CORTEX_BENCHMARK_COMMIT"),
            },
            "volumes": [],
        }
    )
    with admin.connect() as conn:
        report["postgres_version"] = conn.execute(text("SHOW server_version")).scalar_one()
    engine_server = None
    if args.simulate_engine:
        engine_server, _ = start_graph(None)
        engine_url, user, password = (
            f"http://127.0.0.1:{engine_server.server_port}",
            "admin",
            "synthetic-test",
        )
        report["engine"] = "synthetic HTTP fixture; timings are not engine performance"
    else:
        engine_url = os.environ["CORTEX_TERMINUS_URL"]
        parsed = urlsplit(engine_url)
        assert (
            parsed.scheme == "http"
            and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
            and parsed.path in {"", "/"}
            and not parsed.query
            and not parsed.fragment
            and not parsed.username
        ), "Isolated loopback engine required"
        user, password = os.environ["CORTEX_TERMINUS_USER"], os.environ["CORTEX_TERMINUS_PASSWORD"]
        with httpx.Client(
            base_url=engine_url, auth=(user, password), trust_env=False, timeout=20
        ) as engine:
            info = engine.get("/api/info")
            assert info.status_code == 200, "Engine information unavailable"
            report["engine"] = info.json()
    try:
        with tempfile.TemporaryDirectory(prefix="cortex-graph-volume-") as temporary:
            directory = Path(temporary)
            keys = fixture_keys(directory)
            env = {
                "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
                "CORTEX_RUST_DATABASE_URL": rust_url,
                "CORTEX_JWT_PUBLIC_KEY_FILE": str(directory / "identity.pem"),
                "CORTEX_JWT_ISSUER": "https://identity.test",
                "CORTEX_JWT_AUDIENCE": "cortex-core",
                "CORTEX_CONFIRMATION_PUBLIC_KEY_FILE": str(directory / "confirmation.pem"),
                "CORTEX_RUST_BIND": "127.0.0.1:0",
                "CORTEX_TERMINUS_URL": engine_url,
                "CORTEX_TERMINUS_USER": user,
                "CORTEX_TERMINUS_PASSWORD": password,
            }
            with native(args.binary, env) as (client, process):
                for size in args.sizes:
                    fixture = Fixture(str(uuid4()), keys)
                    volume = {
                        "concepts": size,
                        "tenant": fixture.tenant,
                        "phase": "seeding",
                        "measurements": [],
                    }
                    report["volumes"].append(volume)
                    save(args.output, report)
                    started = time.monotonic()
                    domain, version, concepts, sources = seed(
                        admin, fixture, size, args.source_profile
                    )
                    volume.update(
                        {
                            "seed_seconds": time.monotonic() - started,
                            "domain": domain,
                            "published_version": version,
                            "sources": len(sources),
                            "links": size // 2,
                            "source_codepoints_max": max(len(s["content"]) for s in sources),
                            "source_utf8_bytes_max": max(
                                len(s["content"].encode()) for s in sources
                            ),
                            "proof_start_min": min(c["sources"][0]["start"] for c in concepts),
                            "proof_end_max": max(c["sources"][0]["end"] for c in concepts),
                            "concept_json_bytes": len(
                                json.dumps(concepts, ensure_ascii=False).encode()
                            ),
                            "phase": "import",
                        }
                    )
                    expected_digest = digest(sorted(concepts, key=lambda c: c["concept_id"]))
                    started = time.monotonic()
                    diagnostic = client.get(
                        f"/v1/domains/{domain}/graph-import-attempts", headers=fixture.headers()
                    )
                    assert (
                        diagnostic.status_code == 200
                        and diagnostic.json()["digest"] == expected_digest
                        and diagnostic.json()["projection_matches_journal"] is True
                    )
                    volume["diagnostic_seconds"] = time.monotonic() - started
                    body = {
                        "expected_published_version": version,
                        "expected_projection_digest": expected_digest,
                    }
                    started = time.monotonic()
                    response = client.post(
                        f"/v1/domains/{domain}/graph-import",
                        headers=fixture.signed(
                            "graph.import_published", {"path": {"domain": domain}, "body": body}
                        ),
                        json=body,
                    )
                    volume["import_seconds"] = time.monotonic() - started
                    volume["import_http_status"] = response.status_code
                    import_result = classify_import(response.status_code, response.json())
                    if import_result != "registered":
                        volume["phase"] = "import_" + import_result
                        report["status"] = "limited"
                        save(args.output, report)
                        continue
                    with admin.connect() as conn:
                        snapshot = conn.execute(
                            text(
                                "SELECT snapshot FROM cf_graph_manifests WHERE tenant_id=:t AND domain_id=:d AND version=:v"
                            ),
                            {"t": fixture.tenant, "d": domain, "v": version},
                        ).scalar_one()
                        assert snapshot["digest"] == expected_digest and snapshot["count"] == size
                        assert (
                            conn.execute(
                                text(
                                    "SELECT count(*) FROM cf_publications WHERE tenant_id=:t AND domain_id=:d"
                                ),
                                {"t": fixture.tenant, "d": domain},
                            ).scalar_one()
                            == 0
                        )
                    if not args.simulate_engine:
                        with httpx.Client(
                            base_url=engine_url, auth=(user, password), trust_env=False, timeout=30
                        ) as engine:
                            raw = engine.get(
                                f"/api/document/admin/{snapshot['database']}/local/commit/{snapshot['commit']}",
                                params={
                                    "as_list": "true",
                                    "compress_ids": "true",
                                    "type": "CortexConcept",
                                },
                            )
                            assert raw.status_code == 200 and len(raw.json()) == size
                            volume["engine_response_bytes"] = len(raw.content)
                            assert len(raw.content) <= 4_000_000
                    started = time.monotonic()
                    first = client.get(f"/v1/domains/{domain}/concepts", headers=fixture.headers())
                    volume["first_list_seconds"] = time.monotonic() - started
                    assert first.status_code == 200 and first.json() == concepts
                    assert (
                        client.get(
                            f"/v1/domains/{domain}/concepts/{concepts[1]['concept_id']}",
                            headers=fixture.headers("bob"),
                        ).status_code
                        == 404
                    )
                    for question, budget in [("Signal00001", 8000), ("Signal00000", 100)]:
                        gap = client.post(
                            f"/v1/domains/{domain}/query",
                            headers=fixture.headers("bob"),
                            json={"question": question, "max_chars": budget, "limit": 1},
                        )
                        assert (
                            gap.status_code == 200
                            and gap.json()["status"] == "knowledge_gap"
                            and gap.json()["citations"] == []
                        )
                    volume["phase"] = "measurement"
                    for operation in [
                        "list_http_owner",
                        "list_http_viewer",
                        "list_mcp_viewer",
                        "concept_http_viewer",
                        "query_http_viewer",
                        "query_mcp_viewer",
                    ]:
                        for concurrency in args.concurrency:
                            volume["active_cell"] = {
                                "operation": operation,
                                "concurrency": concurrency,
                            }
                            save(args.output, report)
                            measurement = measure(
                                client,
                                fixture,
                                domain,
                                version,
                                concepts,
                                sources,
                                operation,
                                concurrency,
                            )
                            measurement["rust_rss_after_cell_kib"] = rss_kib(process)
                            volume["measurements"].append(measurement)
                            volume.pop("active_cell", None)
                            save(args.output, report)
                    assert client.get("/ready").status_code == 200
                    assert (
                        client.get(
                            f"/v1/domains/{domain}/concepts", headers=fixture.headers()
                        ).json()
                        == concepts
                    )
                    with admin.connect() as conn:
                        episodes = conn.execute(
                            text(
                                "SELECT count(*) FROM cf_episodes WHERE tenant_id=:t AND domain_id=:d AND subject='bob'"
                            ),
                            {"t": fixture.tenant, "d": domain},
                        ).scalar_one()
                    returned = 2 + sum(cell["query_episodes"] for cell in volume["measurements"])
                    assert episodes >= returned
                    volume.update(
                        {
                            "phase": "complete",
                            "episodes_stored": episodes,
                            "episodes_returned": returned,
                        }
                    )
                    save(args.output, report)
    finally:
        if engine_server:
            engine_server.shutdown()
            engine_server.server_close()
    if report["status"] != "limited":
        report["status"] = "completed"
    report.update(measurement_summary(report))


def save(path, report):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--synthetic-only", action="store_true", required=True)
    parser.add_argument("--simulate-engine", action="store_true")
    parser.add_argument("--binary", type=Path, default=ROOT / "target/release/cortex-rust-core")
    parser.add_argument("--build-profile", choices=["debug", "release"], default="release")
    parser.add_argument(
        "--source-profile", choices=["short_distinct", "shared_long"], default="short_distinct"
    )
    parser.add_argument("--sizes", type=int, nargs="+", default=[100, 500, 2000])
    parser.add_argument("--concurrency", type=int, nargs="+", default=[1, 4, 12])
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    assert all(n in {100, 500, 2000} for n in args.sizes) and len(set(args.sizes)) == len(
        args.sizes
    )
    assert all(n in {1, 4, 12} for n in args.concurrency) and len(set(args.concurrency)) == len(
        args.concurrency
    )
    report = {
        "status": "starting",
        "limitations": [
            "Synthetic explicit source profile, not production capacity or a latency SLO",
            "Query includes durable history writes and domain-lock contention",
            "Each graph read loads and validates the whole immutable snapshot",
            "Small diagnostic samples; no hidden retries; no inference to other document shapes",
        ],
    }
    try:
        run(args, report)
    except Exception as error:
        report["status"] = "failed"
        report["failure_type"] = type(error).__name__
        raise
    finally:
        save(args.output, report)
    print(
        json.dumps(
            {
                "status": report["status"],
                "availability": report["availability"],
                "volumes": len(report["volumes"]),
            }
        )
    )


if __name__ == "__main__":
    main()
