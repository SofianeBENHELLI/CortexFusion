import json
from copy import deepcopy
from uuid import uuid4

import httpx
import pytest

from scripts.brain_scale_fixture import REASON, concept, plan, publish_batch
from scripts.brain_scale_workload import workload
from scripts.ingest_okf import REVIEW_BYTES, review_size


def test_frozen_json_round_trip_and_modified_input_rejected(tmp_path, monkeypatch):
    from scripts import brain_scale_fixture as fixture

    monkeypatch.setattr(fixture, "private_path", lambda path: path)
    value = workload("S20")
    path = tmp_path / "synthetic.json"
    path.write_text(json.dumps(value))
    loaded, manifest_hash = fixture.read_manifest(path)
    assert loaded["summary"]["concepts"] == 10000 and len(manifest_hash) == 64
    value["records"][0]["body"] = "unexpected content"
    path.write_text(json.dumps(value))
    with pytest.raises(ValueError, match="exact frozen"):
        fixture.read_manifest(path)


@pytest.mark.parametrize("case", ["S20", "S100", "M20", "M100"])
def test_frozen_workload_is_publishable_under_both_budgets(case):
    records = workload(case)["records"]
    batches = plan(records)
    assert [r for b in batches for r in b] == records
    for batch in batches:
        assert 1 <= len(batch) <= 50
        assert review_size([concept(r, str(uuid4())) for r in batch], REASON) <= REVIEW_BYTES


def test_unknown_dependency_and_duplicate_stop_before_publication():
    records = workload("S20")["records"][:50]
    bad = deepcopy(records)
    bad[0]["links"][0]["target_id"] = str(uuid4())
    with pytest.raises(ValueError, match="unpublished"):
        plan(bad)
    with pytest.raises(ValueError, match="Duplicate"):
        plan([*records, records[0]])


class FakeSigner:
    def headers(self):
        return {}

    def signed(self, *args):
        return {}


@pytest.mark.parametrize("lost", ["sources", "proposals", "approve", "publish"])
def test_recovery_after_committed_but_lost_response(lost):
    records = workload("S20")["records"][:2]
    sources, proposals, commands = {}, {}, {}
    version = {"accepted_version": 0, "published_version": 0}
    state = {"sources": {}, "batches": {}, "manifest_sha256": "a" * 64}
    disk = deepcopy(state)
    failed = False

    def checkpoint():
        nonlocal disk
        disk = deepcopy(state)

    def handler(req):
        nonlocal failed
        operation = req.url.path.rsplit("/", 1)[-1]
        payload = json.loads(req.content) if req.content else None
        if operation == "sources":
            record = next(r for r in records if r["location"] == payload["location"])
            result = sources.setdefault(
                record["source_key"],
                {
                    "id": str(uuid4()),
                    "location": record["location"],
                    "content_hash": record["body_sha256"],
                    "allowed_subjects": ["alice", "reader"],
                },
            )
        elif operation == "version":
            result = version
        elif operation == "proposals":
            result = proposals.setdefault(
                payload["idempotency_key"], {"id": str(uuid4()), "digest": "b" * 64}
            )
            assert payload["base_version"] == 0
        elif operation == "approve":
            version["accepted_version"] = 1
            result = commands.setdefault("approve", {"status": "accepted"})
        elif operation == "publish":
            assert payload["expected_published_version"] == 0
            version["published_version"] = 1
            result = commands.setdefault("publish", {"published_version": 1})
        else:
            pytest.fail(operation)
        if operation == lost and not failed:
            failed = True
            raise httpx.ReadError("Synthetic lost response", request=req)
        return httpx.Response(200, json=result)

    with httpx.Client(
        base_url="http://synthetic.test", transport=httpx.MockTransport(handler)
    ) as client:
        with pytest.raises(httpx.ReadError):
            publish_batch(client, FakeSigner(), state, 0, records, checkpoint, lambda: None)
        state = deepcopy(disk)  # Restart from durable state, discard in-memory receipts.
        result = publish_batch(client, FakeSigner(), state, 0, records, checkpoint, lambda: None)
        assert result["status"] == "published"
        publish_batch(client, FakeSigner(), state, 0, records, checkpoint, lambda: None)
    assert len(sources) == 2 and len(proposals) == 1 and len(commands) == 2
    assert len(state["sources"]) == 2
    assert version == {"accepted_version": 1, "published_version": 1}


def test_unexpected_history_never_creates_proposal():
    records = workload("S20")["records"][:1]
    state = {"sources": {records[0]["source_key"]: str(uuid4())}, "batches": {}}

    def handler(req):
        assert req.method == "GET" and req.url.path.endswith("/version")
        return httpx.Response(200, json={"accepted_version": 1, "published_version": 1})

    with httpx.Client(
        base_url="http://synthetic.test", transport=httpx.MockTransport(handler)
    ) as client:
        with pytest.raises(ValueError, match="Unexpected domain history"):
            publish_batch(client, FakeSigner(), state, 0, records, lambda: None, lambda: None)
