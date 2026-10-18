"""Read-only native reconciliation and HTTP measurement of a frozen Step 1 fixture.

Browser acceptance is separate. Reports retain errors and partial progress, never
private bodies/tokens. This tool cannot turn an incomplete fixture into a pass.
"""

import argparse
import json
import math
import re
import subprocess
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

import httpx

from scripts.brain_scale_fixture import SUBJECTS, Signer, concept, plan, read_manifest
from scripts.ingest_okf import CONCEPT_FIELDS, private_path, save
from scripts.prepare_okf_ingestion import digest
from scripts.qualification_clock import ClockDiscontinuity, Continuity, Deadline


def percentile(values, fraction):
    if not values or not 0 < fraction <= 1:
        raise ValueError("Nonempty samples and a valid fraction are required")
    return sorted(values)[math.ceil(len(values) * fraction) - 1]


class Reader:
    def __init__(self, client, signer, deadline=None, continuity=None):
        self.client, self.signer = client, signer
        self.deadline = deadline
        self.continuity = continuity

    def get(self, path, params=None):
        if self.continuity:
            self.continuity.check()
        if self.deadline is not None and self.deadline.expired():
            raise TimeoutError("Bounded qualification duration reached")
        headers = self.signer.headers()
        started = time.perf_counter()
        response = self.client.get(path, params=params, headers=headers)
        elapsed = (time.perf_counter() - started) * 1000
        if self.continuity:
            self.continuity.check()
        if self.deadline is not None and self.deadline.expired():
            raise TimeoutError("Bounded qualification duration reached during read")
        sample = {
            "http_ms": round(elapsed, 3),
            "status": response.status_code,
            "decoded_bytes": len(response.content),
        }
        if response.status_code != 200:
            raise ObservationError("HTTP response rejected", sample)
        return response.json(), sample


class ObservationError(RuntimeError):
    def __init__(self, message, sample=None):
        super().__init__(message)
        self.sample = sample


def require(condition, message):
    if not condition:
        raise ObservationError(message)


class Expected:
    def __init__(self, domain, records, sources, batches):
        self.domain = domain
        self.records = {r["concept_id"]: r for r in records}
        self.concepts = {r["concept_id"]: concept(r, sources[r["source_key"]]) for r in records}
        self.sources = {sources[r["source_key"]]: r for r in records}
        require(
            len(self.records) == len(self.sources) == len(records), "Duplicate expected identity"
        )
        self.batches = sorted(batches, key=lambda b: b["published_version"])
        self.version = len(batches)
        require(
            [b["published_version"] for b in self.batches] == list(range(1, self.version + 1)),
            "Incomplete checkpoint versions",
        )
        self.edges = {
            ident: {
                (link["target_id"], link["kind"], link["weight"], link["primary"])
                for link in r["links"]
            }
            for ident, r in self.records.items()
        }
        self.incoming = Counter(link[0] for links in self.edges.values() for link in links)
        self.totals = {
            "concepts": len(records),
            "relations": sum(len(v) for v in self.edges.values()),
        }
        self.root = f"/v1/domains/{domain}"

    def graph(self, value, params, *, max_bytes=None):
        require(
            value["domain_id"] == self.domain and value["at_version"] == self.version,
            "Graph version/domain changed",
        )
        require(value["domain_totals"] == self.totals, "Graph totals differ")
        nodes = value["nodes"]
        ids = {n["concept_id"] for n in nodes}
        require(len(ids) == len(nodes) <= params.get("limit", 24), "Invalid node page")
        require(ids <= self.records.keys(), "Unexpected node identity")
        require(len(value["edges"]) <= 120, "Relation response exceeds rendering bound")
        for n in nodes:
            r = self.records[n["concept_id"]]
            require(
                n["title"] == r["title"]
                and n["maturity"] == r["maturity"]
                and n["source_count"] == 1
                and "body" not in n
                and "sources" not in n,
                "Summary differs or includes full body/evidence",
            )
            require(
                n["outgoing_relations"] == len(r["links"])
                and n["incoming_relations"] == self.incoming[n["concept_id"]],
                "Degree differs",
            )
        internal = {(i, *link) for i in ids for link in self.edges[i] if link[0] in ids}
        actual = {
            (e["from"], e["to"], e["kind"], e["weight"], e["primary"]) for e in value["edges"]
        }
        boundary = sum(link[0] not in ids for i in ids for link in self.edges[i])
        require(
            actual <= internal and len(actual) == min(120, len(internal)),
            "Internal relations differ",
        )
        require(
            value["internal_relations"] == len(internal)
            and value["boundary_outgoing_relations"] == boundary
            and value["edges_truncated"] == (len(internal) > 120),
            "Relation accounting differs",
        )
        if params.get("focus"):
            scope = {params["focus"], *(link[0] for link in self.edges[params["focus"]])}
            require(
                set(value["scope_ids"]) == scope and ids <= scope, "Outgoing neighborhood differs"
            )
        if params.get("search") == "no-such-frozen-concept":
            require(not nodes and value["scope_totals"]["concepts"] == 0, "Empty search differs")
        if params.get("search") in {r["title"] for r in self.records.values()}:
            require(nodes and nodes[0]["title"] == params["search"], "Exact title not ranked first")
        if max_bytes is not None:
            require(max_bytes <= 64 * 1024, "Window exceeds frozen 64 KiB budget")
        return ids

    def detail(self, value, ident):
        require(
            all(value.get(k) == self.concepts[ident][k] for k in CONCEPT_FIELDS),
            "Concept body, evidence or links differ",
        )

    def source(self, value, ident):
        r = self.sources[ident]
        require(
            value["id"] == ident
            and value["title"] == r["title"]
            and value["content"] == r["body"]
            and value["content_hash"] == r["body_sha256"]
            and digest(value["content"]) == r["body_sha256"]
            and value["location"] == r["location"]
            and set(value["allowed_subjects"]) == set(SUBJECTS),
            "Source/provenance/ACL differs",
        )

    def difference(self, value, batch):
        require(
            value["proposal_id"] == batch["proposal_id"]
            and value["comparison"] == "accepted_before_state"
            and value["base_version"] == batch["base_version"],
            "Difference context differs",
        )
        found = set()
        for item in value["items"]:
            ident, after = item["concept_id"], item["after"]
            require(
                ident not in found
                and ident in self.records
                and item["before"] is None
                and after is not None,
                "Unexpected birth event",
            )
            expected = self.concepts[ident]
            require(
                all(
                    after[k] == expected[k]
                    for k in ("concept_id", "title", "maturity", "sources", "links")
                )
                and after["body_sha256"] == digest(expected["body"]),
                "Compact birth differs",
            )
            found.add(ident)
        require(len(found) == batch["concepts"], "Birth count differs")
        return found


def reconcile(reader, expected, progress):
    root = expected.root
    version, _ = reader.get(root + "/version")
    require(
        version["accepted_version"] == version["published_version"] == expected.version,
        "Domain has unfinished or unexpected history",
    )
    seen, after, visibility, pages = set(), None, None, 0
    while True:
        params = {"limit": 50, "direction": "outgoing", "at_version": expected.version}
        if after:
            params.update(after=after, visibility=visibility)
        value, _ = reader.get(root + "/graph/window", params)
        ids = expected.graph(value, params)
        require(ids and not seen & ids, "Repeated or empty graph page")
        require(visibility is None or visibility == value["visibility"], "Visibility changed")
        visibility = value["visibility"]
        seen.update(ids)
        pages += 1
        after = value["next_after"]
        if after is None:
            break
        require(
            after == value["nodes"][-1]["concept_id"]
            and pages <= math.ceil(len(expected.records) / 50),
            "Invalid graph continuation",
        )
    require(seen == expected.records.keys(), "Incomplete graph identity set")
    source_ids, after, source_pages = set(), None, 0
    while True:
        params = {"limit": 100, **({"after": after} if after else {})}
        value, _ = reader.get(root + "/sources", params)
        ids = [s["id"] for s in value["items"]]
        require(
            ids
            and len(ids) <= 100
            and len(set(ids)) == len(ids)
            and not source_ids.intersection(ids),
            "Invalid source page",
        )
        source_ids.update(ids)
        require(source_ids <= expected.sources.keys(), "Unexpected source identity")
        source_pages += 1
        after = value["next_after"]
        if after is None:
            break
        require(
            after == ids[-1] and source_pages <= math.ceil(len(expected.sources) / 100),
            "Invalid source continuation",
        )
    require(source_ids == expected.sources.keys(), "Incomplete source identity set")
    for index, (ident, value) in enumerate(expected.concepts.items()):
        detail, _ = reader.get(root + "/concepts/" + ident)
        expected.detail(detail, ident)
        source_id = value["sources"][0]["source_id"]
        source, _ = reader.get(root + "/sources/" + source_id)
        expected.source(source, source_id)
        if (index + 1) % 200 == 0:
            progress({"domain": expected.domain, "exact_concepts_and_sources": index + 1})
    publications, before, journal_pages = [], None, 0
    while True:
        params = {
            "limit": 50,
            "at_version": expected.version,
            **({"before": before} if before else {}),
        }
        value, _ = reader.get(root + "/publications", params)
        require(value["at_version"] == expected.version, "Journal fence differs")
        publications.extend(value["items"])
        before = value["next_before"]
        journal_pages += 1
        if before is None:
            break
        require(journal_pages <= math.ceil(expected.version / 50), "Journal failed to progress")
    require(
        [p["sequence"] for p in publications] == list(range(expected.version, 0, -1)),
        "Publication identities incomplete or duplicated",
    )
    batches = {b["proposal_id"]: b for b in expected.batches}
    births = set()
    for publication in publications:
        ident = publication["proposal_id"]
        require(ident in batches, "Unexpected publication")
        difference, _ = reader.get(root + f"/proposals/{ident}/diff/summary")
        ids = expected.difference(difference, batches[ident])
        require(not births & ids, "Duplicate birth event")
        births.update(ids)
    require(births == expected.records.keys(), "Incomplete birth event set")
    final, _ = reader.get(root + "/version")
    page, _ = reader.get(root + "/graph/window", {"limit": 1, "at_version": expected.version})
    require(
        final == version and page["visibility"] == visibility,
        "Version/visibility changed during reconciliation",
    )
    return {
        "status": "passed",
        "concepts_exact": len(seen),
        "sources_exact": len(source_ids),
        "relations_exact": expected.totals["relations"],
        "births_exact": len(births),
        "publications": len(publications),
        "graph_pages": pages,
        "source_pages": source_pages,
        "journal_pages": journal_pages,
        "version": expected.version,
    }


def cases(reader, expected):
    first, _ = reader.get(expected.root + "/graph/window", {"limit": 24, "direction": "outgoing"})
    second, _ = reader.get(
        expected.root + "/graph/window",
        {
            "limit": 24,
            "direction": "outgoing",
            "after": first["next_after"],
            "at_version": expected.version,
            "visibility": first["visibility"],
        },
    )
    short = next(
        r
        for r in expected.records.values()
        if len(r["body"]) == min(len(x["body"]) for x in expected.records.values())
    )
    long = max(expected.records.values(), key=lambda r: len(r["body"]))
    hub = max(expected.records.values(), key=lambda r: len(r["links"]))
    last = list(expected.records.values())[-1]
    root = expected.root
    common = {"limit": 24, "direction": "outgoing", "at_version": expected.version}
    graph = {
        "window": {},
        "next": {"after": first["next_after"], "visibility": first["visibility"]},
        "previous": {"before": second["previous_before"], "visibility": first["visibility"]},
        "neighborhood": {"focus": short["concept_id"]},
        "hub": {"focus": hub["concept_id"]},
        "exact_search": {"search": last["title"], "limit": 8},
        "empty_search": {"search": "no-such-frozen-concept", "limit": 8},
    }
    result = {
        name: {"path": root + "/graph/window", "params": {**common, **params}, "kind": "graph"}
        for name, params in graph.items()
    }
    for name, r in [("detail_short", short), ("detail_long", long)]:
        result[name] = {
            "path": root + "/concepts/" + r["concept_id"],
            "kind": "detail",
            "ident": r["concept_id"],
        }
    result["journal"] = {
        "path": root + "/publications",
        "params": {"limit": 20, "at_version": expected.version},
        "kind": "journal",
    }
    batch = expected.batches[-1]
    result["difference"] = {
        "path": root + f"/proposals/{batch['proposal_id']}/diff/summary",
        "kind": "difference",
        "batch": batch,
    }
    return result


def observe(reader, expected, case):
    value, sample = reader.get(case["path"], case.get("params"))
    if case["kind"] == "graph":
        expected.graph(value, case["params"], max_bytes=sample["decoded_bytes"])
    elif case["kind"] == "detail":
        expected.detail(value, case["ident"])
    elif case["kind"] == "difference":
        expected.difference(value, case["batch"])
    else:
        require(
            value["at_version"] == expected.version
            and len(value["items"]) <= 20
            and sample["decoded_bytes"] <= 1_000_000,
            "Journal response bound/fence differs",
        )
    return sample


def summarize(samples, failures):
    values = [s["http_ms"] for s in samples]
    return {
        "successes": len(samples),
        "errors": len(failures),
        "p50_http_ms": percentile(values, 0.5) if values else None,
        "p95_http_ms": percentile(values, 0.95) if values else None,
        "max_decoded_bytes": max((s["decoded_bytes"] for s in samples), default=None),
        "under_1000ms": sum(v <= 1000 for v in values),
        "samples": samples,
        "failures": failures,
    }


def measure(reader, expected):
    scenarios = cases(reader, expected)
    samples, failures = {k: [] for k in scenarios}, {k: [] for k in scenarios}
    warmup_errors = []
    for iteration in range(55):
        for name, case in scenarios.items():
            try:
                sample = observe(reader, expected, case)
                if iteration >= 5:
                    samples[name].append(sample)
            except (ObservationError, httpx.HTTPError) as error:
                failure = {
                    "iteration": iteration,
                    "type": type(error).__name__,
                    "sample": getattr(error, "sample", None),
                }
                (warmup_errors if iteration < 5 else failures[name]).append(failure)
    return {
        "warmups": 5,
        "warmup_errors": warmup_errors,
        "requested_samples_per_route": 50,
        "routes": {name: summarize(samples[name], failures[name]) for name in scenarios},
    }


def concurrent(base_url, directory, state, expected, deadline=None, continuity=None):
    with httpx.Client(base_url=base_url, timeout=30, trust_env=False) as client:
        scenarios = cases(Reader(client, Signer(directory, state), deadline, continuity), expected)
    names = ["window", "exact_search", "detail_short", "journal"]

    def session(index):
        samples, failures = {k: [] for k in names}, {k: [] for k in names}
        with httpx.Client(base_url=base_url, timeout=30, trust_env=False) as client:
            reader = Reader(client, Signer(directory, state), deadline, continuity)
            for _ in range(20):
                for name in names:
                    try:
                        samples[name].append(observe(reader, expected, scenarios[name]))
                    except (ObservationError, httpx.HTTPError) as error:
                        failures[name].append(
                            {
                                "session": index,
                                "type": type(error).__name__,
                                "sample": getattr(error, "sample", None),
                            }
                        )
        return samples, failures

    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(session, range(5)))
    return {
        "sessions": 5,
        "sequences_per_session": 20,
        "mix": names,
        "elapsed_seconds": round(time.perf_counter() - started, 3),
        "routes": {
            n: summarize(
                [s for a, _ in results for s in a[n]], [f for _, b in results for f in b[n]]
            )
            for n in names
        },
    }


class ProcessMemory:
    """Sample only the known native child; Python/browser/container memory is separate."""

    def __init__(self, pid):
        self.pid, self.samples, self.failures = pid, [], 0
        self.stopped = threading.Event()

    def run(self):
        while not self.stopped.is_set():
            started = time.monotonic()
            try:
                result = subprocess.run(
                    ["ps", "-p", str(self.pid), "-o", "rss="],
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=2,
                )
                self.samples.append(
                    {"at": time.time(), "rss_bytes": int(result.stdout.strip()) * 1024}
                )
            except (subprocess.SubprocessError, ValueError):
                self.failures += 1
            self.stopped.wait(max(0, 0.25 - (time.monotonic() - started)))

    def report(self):
        peak = max((s["rss_bytes"] for s in self.samples), default=None)
        return {
            "pid": self.pid,
            "target_interval_ms": 250,
            "samples": len(self.samples),
            "sampling_errors": self.failures,
            "sampled_peak_rss_bytes": peak,
            "within_1GiB": peak <= 1024**3 if peak is not None else None,
            "observations": self.samples,
            "container_peak": "not measured by this sampler",
            "browser_peak": "not measured",
        }


class ContainerMemory:
    """Read only the two named synthetic containers; retain CLI rounding and cadence."""

    names = ("cortex-brain-postgres", "cortex-brain-terminus")

    def __init__(self):
        self.samples, self.failures = [], 0
        self.stopped = threading.Event()

    @staticmethod
    def parse(output):
        rows = [json.loads(line) for line in output.splitlines() if line.strip()]
        require(
            len(rows) == 2 and {r["Name"] for r in rows} == set(ContainerMemory.names),
            "Missing or unexpected synthetic container",
        )
        readings = {}
        for row in rows:
            raw = row["MemUsage"].split(" / ")[0]
            match = re.fullmatch(r"(\d+(?:\.\d+)?)(B|KiB|MiB|GiB|TiB)", raw)
            require(match is not None, "Unknown Docker memory format")
            number, unit = match.groups()
            factor = 1024 ** ("B", "KiB", "MiB", "GiB", "TiB").index(unit)
            precision = len(number.partition(".")[2])
            # Docker's display is rounded; use a conservative upper bound, not
            # false byte precision or a pass inferred from a rounded-down value.
            readings[row["Name"]] = {
                "display": raw,
                "estimated_bytes": float(number) * factor,
                "upper_rounding_bound_bytes": (float(number) + 0.5 * 10**-precision) * factor,
            }
        return readings

    def run(self):
        while not self.stopped.is_set():
            started = time.monotonic()
            try:
                result = subprocess.run(
                    ["docker", "stats", "--no-stream", "--format", "{{json .}}", *self.names],
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                readings = self.parse(result.stdout)
                self.samples.append(
                    {
                        "at": time.time(),
                        "collection_seconds": time.monotonic() - started,
                        "containers": readings,
                        "sum_upper_rounding_bound_bytes": sum(
                            v["upper_rounding_bound_bytes"] for v in readings.values()
                        ),
                    }
                )
            except (OSError, subprocess.SubprocessError, ValueError, KeyError, ObservationError):
                self.failures += 1
            self.stopped.wait(0.25)

    def report(self):
        peak = max((s["sum_upper_rounding_bound_bytes"] for s in self.samples), default=None)
        return {
            "method": "docker stats --no-stream; displayed working-set estimate including CLI rounding; actual timestamps retained, not 250 ms sampling",
            "names": self.names,
            "samples": len(self.samples),
            "sampling_errors": self.failures,
            "sampled_peak_sum_upper_rounding_bound_bytes": peak,
            "within_4GiB_upper_estimate": peak <= 4 * 1024**3
            if peak is not None and not self.failures
            else None,
            "observations": self.samples,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["reconcile", "measure", "concurrent", "first-read"])
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--background-load", required=True)
    parser.add_argument("--duration", type=int, default=1800)
    parser.add_argument("--container-memory", action="store_true")
    args = parser.parse_args()
    manifest, manifest_hash = read_manifest(args.manifest)
    directory, report_path = private_path(args.directory), private_path(args.report)
    if report_path.exists():
        raise ValueError("Keep earlier evidence; choose a new report path")
    state = json.loads((directory / "state.json").read_text())
    require(
        0 < args.duration <= 3600 and state.get("expires_at", 0) > time.time(),
        "Choose a bounded duration and an active fixture",
    )
    deadline = Deadline(min(args.duration, state["expires_at"] - time.time()))
    continuity = Continuity()
    clock_worker = threading.Thread(target=continuity.run, daemon=True)
    require(
        state.get("synthetic_only") and state["manifest_sha256"] == manifest_hash,
        "Fixture/manifest mismatch",
    )
    require(
        state["base_url"] in {"http://127.0.0.1:8011", "http://127.0.0.1:8012"}, "Unexpected origin"
    )
    batches = list(state["batches"].values())
    require(
        len(batches) == len(plan(manifest["records"]))
        and all(b["status"] == "published" for b in batches)
        and sum(b["concepts"] for b in batches) == 10000,
        "Fixture publication incomplete",
    )
    memory = ProcessMemory(state["server_pid"])
    worker = threading.Thread(target=memory.run, daemon=True)
    containers = ContainerMemory() if args.container_memory else None
    container_worker = threading.Thread(target=containers.run, daemon=True) if containers else None
    report = {
        "started_at": datetime.now(UTC).isoformat(),
        "status": "running",
        "mode": args.mode,
        "case": manifest["case"],
        "manifest_sha256": manifest_hash,
        "binary_profile": state.get("binary_profile", "debug"),
        "binary_sha256": state.get("binary_sha256"),
        "background_load": args.background_load,
        "domains": {},
        "limits": "Native read-only evidence; no browser, update-publication or overall Step 1 pass inferred; container sampling optional",
    }

    def progress(value):
        report["progress"] = value
        save(report_path, report)
        print(json.dumps(value), flush=True)

    worker.start()
    clock_worker.start()
    if container_worker:
        container_worker.start()
    try:
        save(report_path, report)
        with httpx.Client(base_url=state["base_url"], timeout=60, trust_env=False) as client:
            reader = Reader(client, Signer(directory, state), deadline, continuity)
            for domain in manifest["domains"]:
                scoped = [r for r in manifest["records"] if r["domain_id"] == domain["id"]]
                expected = Expected(
                    domain["id"],
                    scoped,
                    state["sources"],
                    [b for b in batches if b["domain"] == domain["id"]],
                )
                if args.mode == "reconcile":
                    value = reconcile(reader, expected, progress)
                elif args.mode == "measure":
                    value = measure(reader, expected)
                elif args.mode == "concurrent":
                    value = concurrent(state["base_url"], directory, state, expected, deadline, continuity)
                else:
                    params = {"limit": 24, "direction": "outgoing", "at_version": expected.version}
                    page, value = reader.get(expected.root + "/graph/window", params)
                    expected.graph(page, params, max_bytes=value["decoded_bytes"])
                    value["under_2000ms"] = value["http_ms"] <= 2000
                    value["cold_state"] = (
                        "First observation; separately prove process/projection state, no OS cache purge"
                    )
                report["domains"][domain["id"]] = value
                save(report_path, report)
        continuity.check()
        report["status"] = (
            "completed"  # Measurements may still contain failures or exceeded budgets.
        )
    except Exception as error:
        report["status"] = "invalid_interrupted" if isinstance(error, ClockDiscontinuity) else "failed"
        report["failure"] = {"type": type(error).__name__, "sample": getattr(error, "sample", None)}
        raise
    finally:
        continuity.stopped.set()
        clock_worker.join(timeout=1)
        report["clock_continuity"] = continuity.report()
        memory.stopped.set()
        if containers:
            containers.stopped.set()
        worker.join(timeout=3)
        if container_worker:
            container_worker.join(timeout=6)
        report["memory"] = memory.report()
        report["container_memory"] = containers.report() if containers else "not measured"
        report["finished_at"] = datetime.now(UTC).isoformat()
        save(report_path, report)
        print(
            json.dumps({"case": manifest["case"], "mode": args.mode, "status": report["status"]}),
            flush=True,
        )


if __name__ == "__main__":
    main()
