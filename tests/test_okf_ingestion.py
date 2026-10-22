import copy
import hashlib
import json
import stat
from uuid import UUID, uuid4

import pytest

from scripts.prepare_okf_ingestion import (
    CONCEPT_LIMIT,
    SOURCE_LIMIT,
    build_manifest,
    concept_payload,
    write_manifest,
)


def record(ident="offer/a", text="Evidence é🙂.", *, start=0, targets=(), status="draft"):
    return {
        "id": ident,
        "title": ident,
        "text": text,
        "body_start": start,
        "body_end": len(text),
        "source_path": f"okf/{ident}.md",
        "source_sha256": hashlib.sha256(text.encode()).hexdigest(),
        "declared_status": status,
        "linked_concept_ids": list(targets),
        "layer": ident.split("/")[0],
    }


def catalog(*records):
    return {
        "report": {"archive_sha256": "a" * 64, "unresolved_local_links": []},
        "concepts": list(records),
    }


def receipts(manifest):
    return {
        s["key"]: {"id": str(uuid4()), "content_hash": s["content_sha256"]}
        for s in manifest["sources"]
    }


def test_stable_mapping_across_order_revision_and_distinct_scopes():
    a, b = record(targets=["market/b"]), record("market/b")
    first = build_manifest(catalog(a, b), "private-okf")
    assert first == build_manifest(catalog(b, a), "private-okf")
    changed = build_manifest(catalog(record(text="New evidence"), b), "private-okf")
    assert first["concepts"][1]["concept_id"] == changed["concepts"][1]["concept_id"]
    assert first["sources"][1]["key"] != changed["sources"][1]["key"]
    other = build_manifest(catalog(a, b), "another-workspace")
    assert first["concepts"][0]["concept_id"] != other["concepts"][0]["concept_id"]
    assert all(UUID(c["concept_id"]) for c in first["concepts"])


def test_raw_hash_and_decoded_source_hash_stay_distinct_for_bom():
    item = record()
    item["source_sha256"] = hashlib.sha256(b"\xef\xbb\xbf" + item["text"].encode()).hexdigest()
    manifest = build_manifest(catalog(item), "private")
    source = manifest["sources"][0]
    assert source["archive_file_sha256"] == item["source_sha256"]
    assert source["decoded_file_sha256"] != source["archive_file_sha256"]
    assert source["content"] == item["text"]


def test_exact_unicode_body_and_current_source_receipts_required():
    text = "Header\n\nEvidence é🙂."
    manifest = build_manifest(catalog(record(text=text, start=8)), "private")
    registered = receipts(manifest)
    payload = concept_payload(manifest, "offer/a", registered)
    assert payload["body"] == "Evidence é🙂."
    assert payload["sources"][0]["start"] == 8
    assert payload["sources"][0]["end"] == len(text)
    assert payload["maturity"] == "emerging"
    with pytest.raises(ValueError, match="receipt"):
        concept_payload(manifest, "offer/a", {})
    next(iter(registered.values()))["content_hash"] = "b" * 64
    with pytest.raises(ValueError, match="receipt"):
        concept_payload(manifest, "offer/a", registered)


def test_source_segmentation_preserves_every_character_and_offsets():
    prefix = "é" * (SOURCE_LIMIT - 5)
    body = "🙂body across the source boundary"
    manifest = build_manifest(catalog(record(text=prefix + body, start=len(prefix))), "private")
    assert len(manifest["concepts"]) == 1
    assert len(manifest["sources"]) == 2
    assert "".join(s["content"] for s in manifest["sources"]) == prefix + body
    assert manifest["sources"][1]["file_start"] == SOURCE_LIMIT
    assert manifest["concepts"][0]["issues"] == ["evidence_join_requires_resolution"]
    assert manifest["concepts"][0]["sources"][1]["start"] == 0
    with pytest.raises(ValueError, match="Resolve"):
        concept_payload(manifest, "offer/a", receipts(manifest))


@pytest.mark.parametrize("status", ["draft", "stable", "deprecated"])
def test_source_status_and_link_do_not_infer_maturity_archive_or_relation(status):
    manifest = build_manifest(
        catalog(record(status=status, targets=["market/b", "market/b"]), record("market/b")),
        "private",
    )
    item = next(c for c in manifest["concepts"] if c["okf_id"] == "offer/a")
    assert item["source_metadata"]["declared_status"] == status
    assert item["review_state"] == "pending"
    assert len(manifest["references"]) == 1
    reference = manifest["references"][0]
    assert reference["disposition"] == "pending_review"
    assert not {"kind", "weight", "primary", "archived"}.intersection(reference)
    payload = concept_payload(manifest, "offer/a", receipts(manifest))
    assert payload["maturity"] == "emerging" and payload["links"] == []


def test_long_body_and_dense_references_block_without_dropping_evidence():
    targets = [f"offer/target-{i}" for i in range(101)]
    long = record(text="é" * (CONCEPT_LIMIT + 1), targets=targets)
    manifest = build_manifest(catalog(long, *(record(i) for i in targets)), "private")
    blocked = next(c for c in manifest["concepts"] if c["okf_id"] == "offer/a")
    assert blocked["issues"] == [
        "concept_body_outside_contract",
        "evidence_join_requires_resolution",
        "reference_count_requires_policy",
    ]
    assert (
        "".join(s["content"] for s in manifest["sources"] if s["okf_id"] == "offer/a")
        == long["text"]
    )
    assert len(manifest["references"]) == 101
    assert manifest["summary"]["records_requiring_resolution"] == 1
    with pytest.raises(ValueError, match="Resolve"):
        concept_payload(manifest, "offer/a", receipts(manifest))


def test_reference_identity_has_no_path_separator_collision():
    manifest = build_manifest(
        catalog(
            record("a/b", targets=["c"]),
            record("a", targets=["b/c"]),
            record("b/c"),
            record("c"),
        ),
        "private",
    )
    assert len({r["id"] for r in manifest["references"]}) == 2


def test_invalid_catalog_fails_closed_and_nul_remains_review_issue():
    with pytest.raises(ValueError, match="Duplicate"):
        build_manifest(catalog(record(), record()), "private")
    with pytest.raises(ValueError, match="target absent"):
        build_manifest(catalog(record(targets=["missing"])), "private")
    with pytest.raises(ValueError, match="workspace scope"):
        build_manifest(catalog(record()), "../outside")
    with pytest.raises(ValueError, match="Unicode"):
        build_manifest(catalog(record(start=999)), "private")
    manifest = build_manifest(catalog(record(text="abc\x00")), "private")
    with pytest.raises(ValueError, match="Resolve"):
        concept_payload(manifest, "offer/a", receipts(manifest))


def test_private_artifacts_are_repeatable_and_never_replace_a_different_revision(tmp_path):
    manifest = build_manifest(catalog(record()), "private")
    directory = tmp_path / "ingestion"
    write_manifest(manifest, directory)
    first = (directory / "manifest.json").read_bytes()
    write_manifest(manifest, directory)
    assert stat.S_IMODE(directory.stat().st_mode) == 0o700
    assert stat.S_IMODE((directory / "manifest.json").stat().st_mode) == 0o600
    assert json.loads(first)["manifest_sha256"] == manifest["manifest_sha256"]
    changed = copy.deepcopy(manifest)
    changed["scope"] = "another"
    with pytest.raises(ValueError, match="differs"):
        write_manifest(changed, directory)
    assert (directory / "manifest.json").read_bytes() == first
    assert len(list(directory.iterdir())) == 2


def test_long_body_retains_single_identity_and_exact_unicode_with_pending_references():
    targets = [f"offer/target-{i}" for i in range(101)]
    text = "🧠" * CONCEPT_LIMIT
    manifest = build_manifest(
        catalog(record(text=text, targets=targets), *(record(i) for i in targets)), "private"
    )
    item = next(c for c in manifest["concepts"] if c["okf_id"] == "offer/a")
    assert item["issues"] == ["reference_count_requires_policy"]
    payload = concept_payload(
        manifest, "offer/a", receipts(manifest), allow_pending_references=True
    )
    assert payload["body"] == text and payload["concept_id"] == item["concept_id"]
    assert len(payload["sources"]) == 1 and payload["sources"][0]["end"] == CONCEPT_LIMIT
    assert payload["links"] == [] and len(manifest["references"]) == 101
    assert all(r["disposition"] == "pending_review" for r in manifest["references"])


def test_review_batches_respect_utf8_and_json_escape_bytes_without_splitting_concepts():
    from scripts.ingest_okf import REVIEW_BYTES, plan_record_batches, review_size, reviewed_payloads

    records = [record(f"offer/{i}", text="\x01" * CONCEPT_LIMIT) for i in range(3)]
    manifest = build_manifest(catalog(*records), "private")
    ids = [r["id"] for r in records]
    batches = plan_record_batches(manifest, ids, "Reviewed exact source; references pending")
    assert batches == [[ident] for ident in ids]
    state = {"sources": receipts(manifest)}
    review = {
        "manifest_sha256": manifest["manifest_sha256"],
        "decision": "publish_verbatim_emerging_without_relations",
        "reason": "Exact",
        "record_ids": ids,
    }
    with pytest.raises(ValueError, match="encoded request budget"):
        reviewed_payloads(manifest, review, state)
    for batch in batches:
        review["record_ids"] = batch
        concepts = reviewed_payloads(manifest, review, state)
        assert review_size(concepts, "Exact") <= REVIEW_BYTES
        assert len(concepts[0]["body"]) == CONCEPT_LIMIT
