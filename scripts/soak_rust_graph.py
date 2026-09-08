"""Bounded synthetic repetition, ACL changes and restart; no production capacity claim."""

import argparse
import hashlib
import json
import os
import platform
import tempfile
import time
from collections import Counter
from contextlib import ExitStack
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

import httpx
from benchmark_rust_graph import mcp_result, native, rss_kib, seed
from cortex_core.service import digest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from verify_coordinated_restore import Fixture, fixture_keys
from verify_rust_publication_recovery import start_graph

ROOT = Path(__file__).resolve().parents[1]


def save(path, report):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".partial")
    temporary.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    temporary.replace(path)


def durable_state(admin, tenant, domain):
    params = {"t": tenant, "d": domain}
    with admin.connect() as conn:
        version = dict(
            conn.execute(
                text(
                    "SELECT accepted_version,published_version FROM cf_domains WHERE tenant_id=:t AND id=:d"
                ),
                params,
            )
            .mappings()
            .one()
        )
        manifests = list(
            conn.execute(
                text(
                    "SELECT version,snapshot,attempt_id,generation FROM cf_graph_manifests WHERE tenant_id=:t AND domain_id=:d ORDER BY version"
                ),
                params,
            ).mappings()
        )
        publications = conn.execute(
            text("SELECT count(*) FROM cf_publications WHERE tenant_id=:t AND domain_id=:d"), params
        ).scalar_one()
    return {
        "version": version,
        "manifests": [dict(row) for row in manifests],
        "publications": publications,
    }


def receipts(admin, tenant, domain):
    with admin.connect() as conn:
        return dict(
            conn.execute(
                text(
                    "SELECT id,result FROM cf_episodes WHERE tenant_id=:t AND domain_id=:d AND subject='bob'"
                ),
                {"t": tenant, "d": domain},
            ).all()
        )


def resource_sample(admin, application, process, epoch, elapsed):
    with admin.connect() as conn:
        states = Counter(
            conn.execute(
                text("SELECT state FROM pg_stat_activity WHERE application_name=:app"),
                {"app": application},
            )
            .scalars()
            .all()
        )
    assert 1 <= sum(states.values()) <= 10, (
        "Native pool observation is missing or exceeds its bound"
    )
    assert states["idle in transaction"] == states["idle in transaction (aborted)"] == 0
    descriptors = Path(f"/proc/{process.pid}/fd")
    return {
        "elapsed_seconds": elapsed,
        "epoch": epoch,
        "pid": process.pid,
        "rss_kib": rss_kib(process),
        "file_descriptors": len(list(descriptors.iterdir())) if descriptors.is_dir() else None,
        "sql_connection_states": dict(states),
    }


class Workload:
    def __init__(
        self, client, fixture, domain, version, concepts, sources, report, started, deadline
    ):
        self.client, self.fixture, self.domain, self.version = client, fixture, domain, version
        self.concepts, self.sources, self.report = concepts, sources, report
        self.started, self.deadline, self.epoch = started, deadline, 0
        self.episodes = {}

    def call(
        self, method, suffix, tool, arguments, *, subject="bob", mcp=False, status=200, signed=None
    ):
        remaining = self.deadline - time.monotonic()
        assert remaining > 0, "No new call is admitted after the measured deadline"
        headers = (
            self.fixture.signed(signed, arguments) if signed else self.fixture.headers(subject)
        )
        remaining = self.deadline - time.monotonic()
        assert remaining > 0, "No new call is admitted after signing at the measured deadline"
        sample = {
            "elapsed_seconds": time.monotonic() - self.started,
            "epoch": self.epoch,
            "operation": tool,
            "transport": "mcp" if mcp else "http",
            "expected_status": status,
        }
        self.report["calls"].append(sample)
        started = time.monotonic()
        try:
            if mcp:
                response = self.client.post(
                    "/mcp/",
                    headers={**headers, "Accept": "application/json, text/event-stream"},
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "tools/call",
                        "params": {"name": tool, "arguments": arguments},
                    },
                    timeout=min(20, remaining),
                )
                assert response.status_code == 200, "Unexpected MCP transport status"
                actual, data = mcp_result(response.json())
            else:
                response = self.client.request(
                    method,
                    f"/v1/domains/{self.domain}" + suffix,
                    headers=headers,
                    json=arguments.get("body"),
                    params=arguments.get("query"),
                    timeout=min(20, remaining),
                )
                actual, data = response.status_code, response.json()
            sample.update(
                {
                    "status": actual,
                    "bytes": len(response.content),
                    "duration_ms": (time.monotonic() - started) * 1000,
                }
            )
            assert actual == status, "Unexpected application status"
            return data
        except Exception as error:
            sample.update(
                {
                    "failure_type": type(error).__name__,
                    "duration_ms": (time.monotonic() - started) * 1000,
                }
            )
            raise

    def listing(self, mcp, visible=True, owner=False):
        data = self.call(
            "GET",
            "/concepts",
            "api_concepts_list",
            {"path": {"domain": self.domain}},
            subject="alice" if owner else "bob",
            mcp=mcp,
        )
        expected = (
            self.concepts
            if owner
            else [{**c, "links": []} for c in self.concepts[::2]]
            if visible
            else []
        )
        assert data == expected

    def query(self, index, mcp, visible=True):
        target = self.concepts[index]
        args = {
            "path": {"domain": self.domain},
            "body": {"question": target["title"], "limit": 1, "max_chars": 8000},
        }
        data = self.call("POST", "/query", "api_knowledge_query", args, mcp=mcp)
        assert data["served_version"] == self.version and data["processing"] == "local_no_model"
        assert data["episode_id"] not in self.episodes
        if visible:
            ref = target["sources"][0]
            source = next(s for s in self.sources if s["id"] == ref["source_id"])
            assert data["status"] == "evidence_found" and data["answer"] == target["body"]
            assert data["concepts"] == [{**target, "links": []}] and len(data["citations"]) == 1
            citation = data["citations"][0]
            assert {k: citation[k] for k in ("source_id", "start", "end")} == ref
            assert citation["content_hash"] == source["hash"]
            assert citation["excerpt"] == source["content"][ref["start"] : ref["end"]]
        else:
            assert data["status"] == "knowledge_gap" and data["concepts"] == data["citations"] == []
            assert (
                data["answer"]
                == "No matching approved evidence was found within the requested context budget."
            )
        self.episodes[data["episode_id"]] = data
        return data

    def episode(self, data, mcp, visible=True, subject="bob"):
        ident = data["episode_id"]
        value = self.call(
            "GET",
            f"/episodes/{ident}",
            "api_episodes_read",
            {"path": {"domain": self.domain, "episode_id": ident}},
            subject=subject,
            mcp=mcp,
            status=200 if visible else 404,
        )
        if visible:
            assert value == data

    def access(self, visible, mcp):
        sid = self.sources[0]["id"]
        readers = ["alice", "bob"] if visible else ["alice"]
        args = {
            "path": {"domain": self.domain, "source_id": sid},
            "body": {"allowed_subjects": readers},
        }
        value = self.call(
            "PUT",
            f"/sources/{sid}/access",
            "api_sources_access",
            args,
            subject="alice",
            mcp=mcp,
            signed="sources.access",
        )
        assert value == {"source_id": sid, "allowed_subjects": readers}

    def signal(self, data, mcp):
        ident = data["episode_id"]
        args = {
            "path": {"domain": self.domain, "episode_id": ident},
            "body": {
                "origin": "explicit",
                "kind": "thumbs_down",
                "comment": "Synthetic soak signal; not a real satisfaction rating",
                "companion": "synthetic-soak",
                "idempotency_key": "soak-" + ident,
            },
        }
        first = self.call(
            "POST",
            f"/episodes/{ident}/signals",
            "api_feedback_record_signal",
            args,
            mcp=mcp,
            status=201,
        )
        replay = self.call(
            "POST",
            f"/episodes/{ident}/signals",
            "api_feedback_record_signal",
            args,
            mcp=not mcp,
            status=201,
        )
        assert replay == first and first["signal"]["origin"] == "explicit"
        return first["id"]


def validate_completion(report, expected_duration):
    assert report["measured_seconds"] >= expected_duration
    assert report["cycles"] >= 3 and report["restarts"] == 1 and report["acl_roundtrips"] == 2
    assert len(report["epochs"]) == 2 and len({e["pid"] for e in report["epochs"]}) == 2
    assert all(e["exit_code"] == 0 for e in report["epochs"])
    assert all(
        "failure_type" not in c and c["status"] == c["expected_status"] for c in report["calls"]
    )
    assert all(c["elapsed_seconds"] < expected_duration for c in report["calls"])
    classes = {(c["operation"], c["transport"]) for c in report["calls"]}
    assert {
        ("api_concepts_list", "http"),
        ("api_concepts_list", "mcp"),
        ("api_knowledge_query", "http"),
        ("api_knowledge_query", "mcp"),
    } <= classes
    assert report["episodes_verified"] > 0 and report["signals_verified"] > 0


def run(args, report):
    total_started = time.monotonic()
    admin_url, rust_url = (
        os.environ["CORTEX_TEST_ADMIN_URL"],
        os.environ["CORTEX_RUST_DATABASE_URL"],
    )
    assert make_url(admin_url).database.endswith("_test") and make_url(rust_url).database.endswith(
        "_test"
    )
    admin = create_engine(admin_url)
    application = "cortex-soak-" + uuid4().hex
    parts = urlsplit(rust_url)
    query = [(k, v) for k, v in parse_qsl(parts.query) if k != "application_name"]
    rust_url = urlunsplit(
        parts._replace(query=urlencode([*query, ("application_name", application)]))
    )
    report.update(
        {
            "status": "preparing",
            "calls": [],
            "events": [],
            "samples": [],
            "epochs": [],
            "cycles": 0,
            "overrun_cycles": 0,
            "max_cycle_seconds": 0,
            "acl_roundtrips": 0,
            "restarts": 0,
            "model_calls": 0,
            "requested_seconds": args.duration_seconds,
            "interval_seconds": args.interval_seconds,
            "candidate_commit": os.getenv("CORTEX_BENCHMARK_COMMIT"),
            "tested_merge": os.getenv("GITHUB_SHA"),
            "binary_sha256": hashlib.sha256(args.binary.read_bytes()).hexdigest(),
            "platform": platform.platform(),
            "profile": "2000 concepts; two shared 200000-codepoint sources; no model",
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
        report["engine"] = "controlled HTTP simulator; not a real engine soak"
    else:
        engine_url = os.environ["CORTEX_TERMINUS_URL"]
        parsed = urlsplit(engine_url)
        assert parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        assert (
            parsed.path in {"", "/"}
            and not parsed.query
            and not parsed.fragment
            and not parsed.username
        )
        user, password = os.environ["CORTEX_TERMINUS_USER"], os.environ["CORTEX_TERMINUS_PASSWORD"]
        with httpx.Client(
            base_url=engine_url, auth=(user, password), trust_env=False, timeout=20
        ) as engine:
            info = engine.get("/api/info")
            assert info.status_code == 200
            report["engine"] = info.json()
    save(args.output, report)
    try:
        with (
            tempfile.TemporaryDirectory(prefix="cortex-soak-") as directory_name,
            ExitStack() as stack,
        ):
            directory = Path(directory_name)
            fixture = Fixture(str(uuid4()), fixture_keys(directory))
            domain, version, concepts, sources = seed(admin, fixture, 2000, "shared_long")
            report.update({"tenant": fixture.tenant, "domain": domain})
            env = {
                "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
                "CORTEX_RUST_DATABASE_URL": rust_url,
                "CORTEX_JWT_PUBLIC_KEY_FILE": str(directory / "identity.pem"),
                "CORTEX_JWT_ISSUER": "https://identity.test",
                "CORTEX_JWT_AUDIENCE": "cortex-core",
                "CORTEX_CONFIRMATION_PUBLIC_KEY_FILE": str(directory / "confirmation.pem"),
                "CORTEX_RUST_BIND": "127.0.0.1:0",
                "CORTEX_SHUTDOWN_GRACE_SECONDS": "8",
                "CORTEX_TERMINUS_URL": engine_url,
                "CORTEX_TERMINUS_USER": user,
                "CORTEX_TERMINUS_PASSWORD": password,
            }
            client, process = stack.enter_context(native(args.binary, env))
            body = {
                "expected_published_version": version,
                "expected_projection_digest": digest(
                    sorted(concepts, key=lambda c: c["concept_id"])
                ),
            }
            imported = client.post(
                f"/v1/domains/{domain}/graph-import",
                headers=fixture.signed(
                    "graph.import_published", {"path": {"domain": domain}, "body": body}
                ),
                json=body,
            )
            assert imported.status_code == 200 and imported.json()["outcome"] == "registered"
            pinned = durable_state(admin, fixture.tenant, domain)
            assert len(pinned["manifests"]) == 1 and pinned["publications"] == 0
            assert (
                pinned["manifests"][0]["snapshot"]["digest"] == body["expected_projection_digest"]
            )
            report["pinned_state"] = pinned
            report["setup_seconds"] = time.monotonic() - total_started
            started = time.monotonic()
            deadline = started + args.duration_seconds
            workload = Workload(
                client, fixture, domain, version, concepts, sources, report, started, deadline
            )
            report["status"] = "running"
            report["epochs"].append({"epoch": 0, "pid": process.pid, "started_seconds": 0})
            signals = set()
            original = workload.query(0, False)
            last_saved = -10.0
            while time.monotonic() < deadline:
                elapsed = time.monotonic() - started
                # Leave a small admission margin; never catch up a delayed cycle.
                if deadline - time.monotonic() < min(3, args.interval_seconds):
                    time.sleep(min(0.25, max(0, deadline - time.monotonic())))
                    continue
                cycle_started = time.monotonic()
                if report["restarts"] == 0 and elapsed >= args.duration_seconds / 2:
                    before = receipts(admin, fixture.tenant, domain)
                    assert (
                        before == workload.episodes
                        and durable_state(admin, fixture.tenant, domain) == pinned
                    )
                    stack.close()
                    assert process.returncode == 0
                    report["epochs"][-1].update(
                        {
                            "exit_code": process.returncode,
                            "ended_seconds": time.monotonic() - started,
                        }
                    )
                    client, process = stack.enter_context(native(args.binary, env))
                    workload.client, workload.epoch = client, 1
                    report["epochs"].append(
                        {
                            "epoch": 1,
                            "pid": process.pid,
                            "started_seconds": time.monotonic() - started,
                        }
                    )
                    assert (
                        receipts(admin, fixture.tenant, domain) == before
                        and durable_state(admin, fixture.tenant, domain) == pinned
                    )
                    workload.episode(original, True)
                    report["restarts"] = 1
                    report["events"].append(
                        {"kind": "native_restart", "elapsed_seconds": time.monotonic() - started}
                    )
                    save(args.output, report)
                threshold = args.duration_seconds * (
                    0.25 if report["acl_roundtrips"] == 0 else 0.75
                )
                if report["acl_roundtrips"] < 2 and elapsed >= threshold:
                    report["phase"] = "revoking_source"
                    workload.access(False, report["acl_roundtrips"] == 1)
                    for mcp in (False, True):
                        workload.listing(mcp, False)
                        workload.query(0, mcp, False)
                        workload.episode(original, mcp, False)
                    assert durable_state(admin, fixture.tenant, domain) == pinned
                    workload.access(True, report["acl_roundtrips"] == 0)
                    for mcp in (False, True):
                        workload.listing(mcp)
                        workload.episode(original, mcp)
                        workload.query(1998, mcp)
                    report["acl_roundtrips"] += 1
                    report["phase"] = "repetition"
                    report["events"].append(
                        {
                            "kind": "source_acl_roundtrip",
                            "elapsed_seconds": time.monotonic() - started,
                        }
                    )
                    save(args.output, report)
                mcp = report["cycles"] % 2 == 1
                workload.listing(mcp)
                result = workload.query((0, 1000, 1998)[report["cycles"] % 3], not mcp)
                workload.episode(result, mcp)
                if report["cycles"] % 10 == 0:
                    workload.listing(not mcp, owner=True)
                    workload.episode(original, mcp, visible=False, subject="alice")
                    signal = workload.signal(result, mcp)
                    assert signal not in signals
                    signals.add(signal)
                report["cycles"] += 1
                report["last_cycle_seconds"] = time.monotonic() - cycle_started
                report["max_cycle_seconds"] = max(
                    report["max_cycle_seconds"], report["last_cycle_seconds"]
                )
                report["overrun_cycles"] += int(
                    report["last_cycle_seconds"] > args.interval_seconds
                )
                elapsed = time.monotonic() - started
                if elapsed - last_saved >= 10:
                    report["samples"].append(
                        resource_sample(admin, application, process, workload.epoch, elapsed)
                    )
                    report["measured_seconds"] = elapsed
                    save(args.output, report)
                    last_saved = elapsed
                wait = max(0, args.interval_seconds - (time.monotonic() - cycle_started))
                until = min(deadline, time.monotonic() + wait)
                while time.monotonic() < until:
                    time.sleep(max(0, min(0.5, until - time.monotonic())))
            report["measured_seconds"] = time.monotonic() - started
            assert durable_state(admin, fixture.tenant, domain) == pinned
            persisted = receipts(admin, fixture.tenant, domain)
            assert persisted == workload.episodes
            report["episodes_verified"] = len(persisted)
            report["episodes_digest"] = digest(persisted)
            with admin.connect() as conn:
                actual_signals = set(
                    conn.execute(
                        text(
                            "SELECT id FROM cf_feedback_signals WHERE tenant_id=:t AND domain_id=:d AND subject='bob'"
                        ),
                        {"t": fixture.tenant, "d": domain},
                    ).scalars()
                )
                readers = conn.execute(
                    text(
                        "SELECT allowed_subjects FROM cf_sources WHERE tenant_id=:t AND domain_id=:d AND id=:s"
                    ),
                    {"t": fixture.tenant, "d": domain, "s": sources[0]["id"]},
                ).scalar_one()
            assert actual_signals == signals and readers == ["alice", "bob"]
            report["signals_verified"] = len(signals)
            report["signals_digest"] = digest(sorted(signals))
            report["samples"].append(
                resource_sample(
                    admin, application, process, workload.epoch, report["measured_seconds"]
                )
            )
            shutdown_started = time.monotonic()
            stack.close()
            report["shutdown_seconds"] = time.monotonic() - shutdown_started
            report["epochs"][-1].update(
                {"exit_code": process.returncode, "ended_seconds": time.monotonic() - started}
            )
            validate_completion(report, args.duration_seconds)
            report["status"] = "completed"
    finally:
        if engine_server:
            engine_server.shutdown()
            engine_server.server_close()
        admin.dispose()
        report["total_seconds"] = time.monotonic() - total_started


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--synthetic-only", action="store_true", required=True)
    parser.add_argument("--simulate-engine", action="store_true")
    parser.add_argument("--binary", type=Path, default=ROOT / "target/release/cortex-rust-core")
    parser.add_argument("--duration-seconds", type=int, default=1800)
    parser.add_argument("--interval-seconds", type=float, default=2)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    assert 30 <= args.duration_seconds <= 1800 and 0.5 <= args.interval_seconds <= 10
    report = {
        "status": "starting",
        "limitations": [
            "Synthetic repetition, not production capacity, latency SLO or proof of absence of memory leaks",
            "RSS/FD/SQL snapshots after cycles; two process epochs separated by a planned restart",
            "No request is admitted after the measured deadline; cleanup and verification are separate",
        ],
    }
    try:
        run(args, report)
    except Exception as error:
        report.update({"status": "failed", "failure_type": type(error).__name__})
        raise
    finally:
        save(args.output, report)
    print(
        json.dumps(
            {
                "status": report["status"],
                "cycles": report["cycles"],
                "measured_seconds": report["measured_seconds"],
            }
        )
    )


if __name__ == "__main__":
    main()
