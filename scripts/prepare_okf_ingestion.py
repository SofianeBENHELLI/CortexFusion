"""Build a private, deterministic OKF ingestion manifest without publishing knowledge.

Run as ``python -m scripts.prepare_okf_ingestion`` from the repository root.
Source text is preserved in full. Concept and relation decisions remain reviewable.
"""

import argparse
import hashlib
import json
import os
import re
import tempfile
from collections import Counter
from pathlib import Path
from urllib.parse import quote
from uuid import NAMESPACE_URL, uuid5

from scripts.prepare_okf_bundle import prepare

ROOT = Path(__file__).resolve().parents[1]
SOURCE_LIMIT = 200_000
CONCEPT_LIMIT = 200_000
RELATION_LIMIT = 100


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def concept_id(scope, okf_id):
    return str(uuid5(NAMESPACE_URL, f"cortex/okf/{scope}/concept/{okf_id}"))


def build_manifest(catalog, scope):
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}", scope):
        raise ValueError("Use an immutable workspace scope of 1–80 safe characters")
    records = catalog["concepts"]
    by_id = {r["id"]: r for r in records}
    if len(by_id) != len(records):
        raise ValueError("Duplicate OKF identity")
    sources, concepts, references = [], [], []
    for item in sorted(records, key=lambda r: r["id"]):
        ident, content = item["id"], item["text"]
        start, end = item["body_start"], item["body_end"]
        if not isinstance(content, str) or not 0 <= start <= end <= len(content):
            raise ValueError("Invalid source text or Unicode evidence span")
        issues = []
        if "\x00" in content:
            issues.append("source_contains_nul")
        if not 1 <= len(item["title"]) <= 200:
            issues.append("title_outside_contract")
        if not content:
            issues.append("empty_source")
        if not 1 <= end - start <= CONCEPT_LIMIT:
            issues.append("concept_body_outside_contract")
        if len(item["linked_concept_ids"]) > RELATION_LIMIT:
            issues.append("reference_count_requires_policy")
        spans = []
        for offset in range(0, len(content), SOURCE_LIMIT):
            part = content[offset : offset + SOURCE_LIMIT]
            part_end = offset + len(part)
            key = digest(canonical([scope, ident, offset, digest(part)]))
            location = f"okf://{scope}/{quote(ident, safe='/')}#unicode={offset}-{part_end}"
            if len(location) > 1000:
                issues.append("source_location_outside_contract")
            sources.append(
                {
                    "key": key,
                    "okf_id": ident,
                    "source_path": item["source_path"],
                    "archive_file_sha256": item["source_sha256"],
                    "decoded_file_sha256": digest(content),
                    "file_start": offset,
                    "file_end": part_end,
                    "title": item["title"],
                    "location": location,
                    "content": part,
                    "content_sha256": digest(part),
                }
            )
            lo, hi = max(start, offset), min(end, part_end)
            if lo < hi:
                spans.append({"source_key": key, "start": lo - offset, "end": hi - offset})
        if len(spans) > 30:
            issues.append("evidence_count_outside_contract")
        if len(spans) > 1:
            # Native verbatim concepts join multiple excerpts with two newlines.
            # Technical chunks must not insert separators into the original body.
            issues.append("evidence_join_requires_resolution")
        target_ids = sorted(set(item["linked_concept_ids"]))
        for target in target_ids:
            if target not in by_id:
                raise ValueError("Reference target absent from the manifest")
            references.append(
                {
                    "id": str(
                        uuid5(NAMESPACE_URL, canonical(["okf-reference", scope, ident, target]))
                    ),
                    "origin_okf_id": ident,
                    "target_okf_id": target,
                    "origin_concept_id": concept_id(scope, ident),
                    "target_concept_id": concept_id(scope, target),
                    "disposition": "pending_review",
                    "reason": "Explicit source reference; Cortex relation semantics not inferred",
                }
            )
        concepts.append(
            {
                "okf_id": ident,
                "concept_id": concept_id(scope, ident),
                "source_revision": item["source_sha256"],
                "title": item["title"],
                "body_start": start,
                "body_end": end,
                "body_sha256": digest(content[start:end]),
                "sources": spans,
                "source_metadata": {
                    k: v
                    for k, v in item.items()
                    if k not in {"text", "body_start", "body_end", "linked_concept_ids"}
                },
                "review_state": "pending",
                "issues": sorted(set(issues)),
            }
        )
    issues = Counter(i for c in concepts for i in c["issues"])
    result = {
        "schema_version": 1,
        "scope": scope,
        "archive_sha256": catalog["report"]["archive_sha256"],
        "policy": {
            "identity": "workspace-and-okf-id-v1",
            "sources": "exact-decoded-unicode-with-raw-file-hash-v1",
            "body": "verbatim-body-200000-chars-exact-source-join-v2",
            "references": "pending-no-kind-weight-or-primary-inferred-v1",
            "publication": "explicit-governed-review-required",
        },
        "sources": sources,
        "concepts": concepts,
        "references": references,
        "unresolved_source_links": catalog["report"]["unresolved_local_links"],
        "summary": {
            "records": len(concepts),
            "source_parts": len(sources),
            "source_characters": sum(len(s["content"]) for s in sources),
            "reference_candidates": len(references),
            "records_without_contract_issues": sum(not c["issues"] for c in concepts),
            "records_requiring_resolution": sum(bool(c["issues"]) for c in concepts),
            "issues": dict(sorted(issues.items())),
            "unresolved_source_links": len(catalog["report"]["unresolved_local_links"]),
            "published_records": 0,
        },
    }
    result["manifest_sha256"] = digest(canonical(result))
    return result


def concept_payload(manifest, okf_id, source_receipts, *, allow_pending_references=False):
    """Materialize a proposal candidate only; never approve it or invent source IDs."""
    item = next(c for c in manifest["concepts"] if c["okf_id"] == okf_id)
    issues = set(item["issues"])
    if allow_pending_references:
        issues.discard("reference_count_requires_policy")
    if issues:
        raise ValueError("Resolve the record's review issues before creating a proposal")
    parts = {s["key"]: s for s in manifest["sources"]}
    sources, fragments = [], []
    for span in item["sources"]:
        receipt = source_receipts.get(span["source_key"])
        part = parts[span["source_key"]]
        if not receipt or receipt.get("content_hash") != part["content_sha256"]:
            raise ValueError("Missing or mismatched Cortex source receipt")
        sources.append({"source_id": receipt["id"], "start": span["start"], "end": span["end"]})
        fragments.append(part["content"][span["start"] : span["end"]])
    body = "\n\n".join(fragments)
    if digest(body) != item["body_sha256"]:
        raise ValueError("Evidence body hash mismatch")
    return {
        "concept_id": item["concept_id"],
        "title": item["title"],
        "body": body,
        "sources": sources,
        "maturity": "emerging",
        "links": [],
    }


def write_manifest(manifest, directory):
    """Refuse replacement of another manifest; create private artifacts atomically."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    directory.chmod(0o700)
    artifacts = (
        ("manifest.json", manifest),
        ("summary.json", {**manifest["summary"], "manifest_sha256": manifest["manifest_sha256"]}),
    )
    for name, data in artifacts:
        path = directory / name
        content = canonical(data) + "\n"
        if path.exists():
            if path.read_text() != content:
                raise ValueError(
                    "Existing ingestion artifact differs; use a new revision directory"
                )
    for name, data in artifacts:
        path = directory / name
        content = canonical(data) + "\n"
        if path.exists():
            continue
        with tempfile.NamedTemporaryFile(mode="w", dir=directory, delete=False) as output:
            temporary = Path(output.name)
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            if path.read_text() != content:
                raise ValueError("Concurrent ingestion artifact differs") from None
        finally:
            temporary.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--scope", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not args.output.resolve().is_relative_to((ROOT / ".runtime/brain").resolve()):
        parser.error("Private ingestion artifacts must stay under .runtime/brain")
    manifest = build_manifest(prepare(args.archive), args.scope)
    write_manifest(manifest, args.output)
    print(json.dumps({**manifest["summary"], "manifest_sha256": manifest["manifest_sha256"]}))


if __name__ == "__main__":
    main()
