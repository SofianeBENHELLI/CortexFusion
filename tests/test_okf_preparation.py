import json
from zipfile import ZipFile

import pytest

from scripts.prepare_okf_bundle import prepare


def bundle(tmp_path, *, entries=None, count=2, extra=None):
    path = tmp_path / "knowledge.zip"
    concepts = entries or [
        {"id": "offer/a", "type": "Brand", "title": "Alpha"},
        {"id": "market/b", "type": "Industry", "title": "Beta"},
    ]
    with ZipFile(path, "w") as archive:
        archive.writestr(
            "okf/MANIFEST.json", json.dumps({"concept_count": count, "concepts": concepts})
        )
        archive.writestr(
            "okf/offer/a.md",
            "---\nstatus: draft\n---\n\nPreuve é🙂. [Beta](../market/b.md#preuve)\n[Beta encore](../market/b.md)",
        )
        archive.writestr("okf/market/b.md", "---\nstatus: stable\n---\n\nSource intacte.")
        for name, content in (extra or {}).items():
            archive.writestr(name, content)
    return path


def test_preserves_unicode_provenance_and_deduplicates_candidate_links(tmp_path):
    path = bundle(tmp_path)
    result = prepare(path)
    alpha = next(c for c in result["concepts"] if c["id"] == "offer/a")
    assert alpha["text"][alpha["body_start"] : alpha["body_end"]].startswith("\nPreuve é🙂.")
    assert alpha["declared_status"] == "draft"
    assert alpha["linked_concept_ids"] == ["market/b"]
    assert result["report"]["directed_link_candidates"] == 1
    assert result["report"]["declared_statuses"] == {"draft": 1, "stable": 1}
    assert prepare(path) == result
    assert not any(k in alpha for k in ["published_version", "maturity", "weight"])


@pytest.mark.parametrize(
    "extra", [{"../outside.md": "unsafe"}, {"/absolute.md": "unsafe"}, {"okf\\bad.md": "unsafe"}]
)
def test_refuses_unsafe_archive_paths_without_extracting(tmp_path, extra):
    with pytest.raises(ValueError, match="Unsafe archive path"):
        prepare(bundle(tmp_path, extra=extra))
    assert not (tmp_path.parent / "outside.md").exists()


def test_refuses_manifest_count_and_identity_drift(tmp_path):
    with pytest.raises(ValueError, match="Manifest count"):
        prepare(bundle(tmp_path, count=9))
    with pytest.raises(ValueError, match="duplicate concept identity"):
        prepare(bundle(tmp_path, entries=[{"id": "offer/a", "title": "A"}] * 2))
    with pytest.raises(ValueError, match="no matching safe document"):
        prepare(bundle(tmp_path, entries=[{"id": "missing", "title": "Missing"}], count=1))


def test_reports_limits_and_unresolved_links_without_silent_truncation(tmp_path):
    path = tmp_path / "large.zip"
    text = "Evidence. " * 20001 + "[Missing](missing.md)"
    with ZipFile(path, "w") as archive:
        archive.writestr(
            "okf/MANIFEST.json",
            json.dumps({"concept_count": 1, "concepts": [{"id": "large", "title": "Large"}]}),
        )
        archive.writestr("okf/large.md", text)
    result = prepare(path)
    assert result["concepts"][0]["text"] == text
    assert result["report"]["over_concept_body_limit"] == ["large"]
    assert result["report"]["unresolved_local_links"] == [
        {"source": "okf/large.md", "target": "missing.md"}
    ]
