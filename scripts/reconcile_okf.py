"""Read-only reconciliation of a complete private OKF publication.

Only aggregate evidence is written or printed. Source texts and authentication
remain inside the explicitly configured private workspace and manifest.
"""

import argparse
import json
from pathlib import Path

import httpx

from scripts.ingest_okf import CONCEPT_FIELDS, private_path, read_manifest, request, save
from scripts.okf_workspace import BASE_URL, DIRECTORY, configuration
from scripts.prepare_okf_ingestion import concept_payload, digest


def merge_receipts(manifest, checkpoints, cfg):
    wanted = {s["key"] for s in manifest["sources"]}
    receipts = {}
    for checkpoint in checkpoints:
        if (checkpoint["tenant"], checkpoint["domain"]) != (cfg["tenant"], cfg["domain"]):
            raise ValueError("Checkpoint belongs to another workspace")
        for key, receipt in checkpoint["sources"].items():
            if key not in wanted:
                continue
            if key in receipts and receipts[key] != receipt:
                raise ValueError("Source identity differs between checkpoints")
            receipts[key] = receipt
    if set(receipts) != wanted or len({r["id"] for r in receipts.values()}) != len(wanted):
        raise ValueError("Incomplete or duplicate source identities")
    return receipts


def reconcile(client, cfg, manifest, receipts):
    if manifest["scope"] != cfg["scope"]:
        raise ValueError("Manifest belongs to another workspace")
    root = f"/v1/domains/{cfg['domain']}"

    def get(path, params=None):
        # Query parameters are non-secret counts/cursors, never source bodies.
        if params:
            path += "?" + str(httpx.QueryParams(params))
        return request(client, cfg, "GET", root + path)

    version = get("/version")
    if version["accepted_version"] != version["published_version"]:
        raise ValueError("Unpublished accepted work prevents stable reconciliation")
    expected_ids = {c["concept_id"] for c in manifest["concepts"]}
    seen, after, visibility, pages = set(), None, None, 0
    while True:
        params = {"limit": 50, "at_version": version["published_version"]}
        if after:
            params.update(after=after, visibility=visibility)
        page = get("/graph/window", params)
        if page["domain_totals"] != {"concepts": len(expected_ids), "relations": 0}:
            raise ValueError("Published totals differ from the no-relations import decision")
        if visibility is not None and page["visibility"] != visibility:
            raise ValueError("Visibility changed during reconciliation")
        visibility = page["visibility"]
        ids = [n["concept_id"] for n in page["nodes"]]
        if not ids or len(ids) > 50 or len(set(ids)) != len(ids) or seen.intersection(ids):
            raise ValueError("Invalid, duplicate or non-progressing graph page")
        seen.update(ids)
        pages += 1
        if not seen.issubset(expected_ids):
            raise ValueError("Unexpected published identity")
        after = page["next_after"]
        if not after:
            break
        if after != ids[-1] or len(seen) >= len(expected_ids):
            raise ValueError("Invalid graph continuation")
    if seen != expected_ids:
        raise ValueError("Missing published identities")

    expected_source_ids = {r["id"] for r in receipts.values()}
    seen_sources, after = set(), None
    while True:
        page = get("/sources", {"limit": 100, **({"after": after} if after else {})})
        ids = [r["id"] for r in page["items"]]
        if not ids or len(ids) > 100 or len(set(ids)) != len(ids) or seen_sources.intersection(ids):
            raise ValueError("Invalid or duplicate source page")
        seen_sources.update(ids)
        if not seen_sources.issubset(expected_source_ids):
            raise ValueError("Unexpected source identity")
        after = page["next_after"]
        if not after:
            break
        if after != ids[-1] or len(seen_sources) >= len(expected_source_ids):
            raise ValueError("Invalid source continuation")
    if seen_sources != expected_source_ids:
        raise ValueError("Missing source identities")

    for source in manifest["sources"]:
        receipt = receipts[source["key"]]
        actual = get("/sources/" + receipt["id"])
        if (
            actual["id"] != receipt["id"]
            or actual["title"] != source["title"]
            or actual["location"] != source["location"]
            or actual["content"] != source["content"]
            or actual["content_hash"] != source["content_sha256"]
            or digest(actual["content"]) != source["content_sha256"]
            or actual["allowed_subjects"] != [cfg["subject"]]
        ):
            raise ValueError("Source content, provenance or privacy differs")
    for record in manifest["concepts"]:
        expected = concept_payload(
            manifest, record["okf_id"], receipts, allow_pending_references=True
        )
        actual = get("/concepts/" + expected["concept_id"])
        if any(actual.get(key) != expected[key] for key in CONCEPT_FIELDS):
            raise ValueError("Concept identity, body, proof or publication decision differs")
    if get("/version") != version:
        raise ValueError("Version changed during reconciliation")
    final = get("/graph/window", {"limit": 1, "at_version": version["published_version"]})
    if final["visibility"] != visibility:
        raise ValueError("Visibility changed during reconciliation")
    refs = manifest["references"]
    if len({r["id"] for r in refs}) != len(refs) or any(
        r["origin_concept_id"] not in seen
        or r["target_concept_id"] not in seen
        or r["disposition"] != "pending_review"
        for r in refs
    ):
        raise ValueError("Candidate reference identities or endpoints differ")
    return {
        "status": "passed",
        "manifest_sha256": manifest["manifest_sha256"],
        "published_version": version["published_version"],
        "concepts_exact": len(seen),
        "sources_exact_and_private": len(seen_sources),
        "graph_pages": pages,
        "published_relations": 0,
        "candidate_references_preserved": len(refs),
        "missing_reference_endpoints": 0,
        "limits": "Read-only native reconciliation; semantic relation review, browser and volume qualification remain separate",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    cfg, manifest = configuration(), read_manifest(args.manifest)
    checkpoints = [json.loads(p.read_text()) for p in DIRECTORY.glob("ingestion-*.json")]
    receipts = merge_receipts(manifest, checkpoints, cfg)
    with httpx.Client(base_url=BASE_URL, trust_env=False, timeout=60) as client:
        report = reconcile(client, cfg, manifest, receipts)
    save(private_path(args.report), report)
    print(json.dumps(report))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        message = str(exc) if isinstance(exc, ValueError | RuntimeError) else type(exc).__name__
        raise SystemExit(f"Private reconciliation stopped: {message}") from None
