from copy import deepcopy
from uuid import NAMESPACE_URL, uuid5

import httpx
import pytest

from scripts import reconcile_okf
from scripts.prepare_okf_ingestion import build_manifest, concept_payload, digest


def fixture():
    records = []
    for name in ("a", "b"):
        content = f"Synthetic proof {name} 🧠"
        records.append(
            {
                "id": name,
                "title": f"Synthetic {name}",
                "text": content,
                "source_path": f"synthetic/{name}.md",
                "source_sha256": digest(content),
                "body_start": 0,
                "body_end": len(content),
                "linked_concept_ids": ["b"] if name == "a" else [],
            }
        )
    manifest = build_manifest(
        {"report": {"archive_sha256": "a" * 64, "unresolved_local_links": []}, "concepts": records},
        "synthetic",
    )
    receipts = {
        s["key"]: {"id": str(uuid5(NAMESPACE_URL, s["key"])), "content_hash": s["content_sha256"]}
        for s in manifest["sources"]
    }
    cfg = {
        "tenant": "synthetic-tenant",
        "domain": "synthetic-domain",
        "subject": "owner",
        "scope": "synthetic",
    }
    return cfg, manifest, receipts


@pytest.mark.parametrize(
    "fault",
    [None, "body", "source_privacy", "source_content", "duplicate_page", "version", "reference"],
)
def test_complete_reconciliation_and_fail_closed_evidence(monkeypatch, fault):
    cfg, manifest, receipts = fixture()
    concepts = [concept_payload(manifest, c["okf_id"], receipts) for c in manifest["concepts"]]
    version_reads = 0

    def request(_client, _cfg, method, path):
        nonlocal version_reads
        assert method == "GET"
        url = httpx.URL("http://local.test" + path)
        if url.path.endswith("/version"):
            version_reads += 1
            n = 2 if fault == "version" and version_reads > 1 else 1
            return {"accepted_version": n, "published_version": n}
        if url.path.endswith("/graph/window"):
            ids = [c["concept_id"] for c in concepts]
            if fault == "duplicate_page":
                ids[1] = ids[0]
            return {
                "domain_totals": {"concepts": 2, "relations": 0},
                "visibility": "a" * 64,
                "nodes": [{"concept_id": i} for i in ids],
                "next_after": None,
            }
        if url.path.endswith("/sources"):
            return {"items": [{"id": r["id"]} for r in receipts.values()], "next_after": None}
        if "/sources/" in url.path:
            source = next(
                s
                for s in manifest["sources"]
                if receipts[s["key"]]["id"] == url.path.rsplit("/", 1)[1]
            )
            return {
                "id": receipts[source["key"]]["id"],
                "title": source["title"],
                "location": source["location"],
                "content": "altered" if fault == "source_content" else source["content"],
                "content_hash": source["content_sha256"],
                "allowed_subjects": ["owner", "unexpected"]
                if fault == "source_privacy"
                else ["owner"],
            }
        result = deepcopy(
            next(c for c in concepts if c["concept_id"] == url.path.rsplit("/", 1)[1])
        )
        if fault == "body":
            result["body"] += "altered"
        return result

    monkeypatch.setattr(reconcile_okf, "request", request)
    if fault == "reference":
        manifest["references"][0]["target_concept_id"] = "missing"
    if fault:
        with pytest.raises(ValueError):
            reconcile_okf.reconcile(None, cfg, manifest, receipts)
    else:
        result = reconcile_okf.reconcile(None, cfg, manifest, receipts)
        assert result["status"] == "passed"
        assert result["concepts_exact"] == result["sources_exact_and_private"] == 2
        assert result["candidate_references_preserved"] == 1


def test_receipts_preserve_identity_across_manifest_versions():
    cfg, manifest, receipts = fixture()
    entries = list(receipts.items())
    checkpoints = [
        {"tenant": cfg["tenant"], "domain": cfg["domain"], "sources": dict([entry])}
        for entry in entries
    ]
    assert reconcile_okf.merge_receipts(manifest, checkpoints, cfg) == receipts
    assert reconcile_okf.merge_receipts(manifest, [*checkpoints, checkpoints[0]], cfg) == receipts
    with pytest.raises(ValueError, match="Incomplete"):
        reconcile_okf.merge_receipts(manifest, checkpoints[:1], cfg)
    conflict = deepcopy(checkpoints[0])
    conflict["sources"][entries[0][0]]["id"] = "different"
    with pytest.raises(ValueError, match="differs"):
        reconcile_okf.merge_receipts(manifest, [*checkpoints, conflict], cfg)
    with pytest.raises(ValueError, match="another workspace"):
        reconcile_okf.merge_receipts(manifest, [{**checkpoints[0], "tenant": "another"}], cfg)
