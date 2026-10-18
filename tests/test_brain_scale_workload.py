from collections import Counter

import pytest

from scripts.brain_scale_workload import identity, workload


@pytest.mark.parametrize("case", ["S20", "S100", "M20", "M100"])
def test_frozen_volume_shapes_and_references(case):
    value = workload(case)
    records = value["records"]
    by_id = {r["concept_id"]: r for r in records}
    assert len(by_id) == len({r["source_key"] for r in records}) == 10000
    assert Counter(len(r["body"]) for r in records) == {
        600: 9000,
        6000: 890,
        30000: 100,
        200000: 10,
    }
    dense = case.endswith("100")
    assert sum(len(r["links"]) for r in records) == (100000 if dense else 20000)
    assert Counter(len(r["links"]) for r in records) == (
        {100: 50, 10: 5450, 9: 4500} if dense else {100: 50, 2: 5050, 1: 4900}
    )
    assert records[0]["concept_id"] == identity(case, "concept/0/0")
    seen = set()
    for domain in value["domains"]:
        scoped = [r for r in records if r["domain_id"] == domain["id"]]
        assert len(scoped) == domain["concepts"]
        # First cohort must be jointly publishable; all later targets already
        # exist, so byte-limited batches may shrink without breaking links.
        seen.update(r["concept_id"] for r in scoped[:20])
        for r in scoped:
            links = r["links"]
            assert len({link["target_id"] for link in links}) == len(links) <= 100
            for link in links:
                assert link["target_id"] != r["concept_id"]
                assert by_id[link["target_id"]]["domain_id"] == domain["id"]
                assert link["target_id"] in seen
            seen.add(r["concept_id"])
    assert len(seen) == 10000


def test_unknown_workload_is_not_silently_substituted():
    with pytest.raises(ValueError):
        workload("custom")
