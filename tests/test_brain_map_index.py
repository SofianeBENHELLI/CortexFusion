import json

import pytest

from scripts.prepare_brain_map_index import build
from scripts.prepare_okf_ingestion import build_manifest


def manifest():
    records = [
        dict(
            id=f"group/{i}",
            title=f"Title {i}",
            text="Private synthetic evidence",
            body_start=0,
            body_end=26,
            source_path=f"group/{i}.md",
            source_sha256="a" * 64,
            linked_concept_ids=["group/1"] if i == 0 else [],
            layer="Group",
            type="Note",
        )
        for i in range(2)
    ]
    return build_manifest(
        {"concepts": records, "report": {"archive_sha256": "b" * 64, "unresolved_local_links": []}},
        "synthetic",
    )


def test_index_retains_identity_and_revision_without_source_text():
    m = manifest()
    out = build(m, "tenant", "domain")
    assert len(out["nodes"]) == 2 and len(out["references"]) == 1
    assert {n["id"] for n in out["nodes"]} == {n["concept_id"] for n in m["concepts"]}
    assert "Private synthetic evidence" not in json.dumps(out)
    assert all(len(n["body_hash"]) == 64 and len(n["source_hashes"]) == 1 for n in out["nodes"])


def test_modified_manifest_is_rejected():
    m = manifest()
    m["concepts"][0]["source_metadata"]["layer"] = "Changed"
    with pytest.raises(ValueError, match="fingerprint"):
        build(m, "tenant", "domain")
