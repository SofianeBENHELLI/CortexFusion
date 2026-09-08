from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from cortex_core.auth import CoreError
from cortex_core.contracts import AccessInput, LocalExtractionInput
from cortex_core.extraction import ExtractionService
from cortex_core.model_attempts import ModelAttemptService
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError


class Model:
    provider = "ollama"
    model = "synthetic-model"

    def __init__(self, error=None):
        self.calls, self.error = 0, error

    def select(self, source):
        self.calls += 1
        if self.error:
            raise self.error
        return {
            "quote": source,
            "start": 0,
            "end": len(source),
            "model": self.model,
            "model_digest": "a" * 64,
            "prompt_version": "fixture",
            "input_tokens": 10,
            "output_tokens": 5,
        }


def request(key=None):
    return LocalExtractionInput(allow_local_processing=True, idempotency_key=key or str(uuid4()))


def listing(w, subject="alice"):
    r = w.client.get(w.prefix + "/model-attempts", headers=w.headers(subject))
    assert r.status_code == 200, r.text
    return r.json()["items"]


def test_success_and_replay_share_one_reservation(world):
    source, model = world.source(), Model()
    service = ExtractionService(world.service, model, daily_limit=1)
    command = request()
    first = service.extract(world.owner, world.domain, source["id"], command)
    assert service.extract(world.owner, world.domain, source["id"], command) == first
    items = listing(world)
    assert model.calls == len(items) == 1
    assert items[0]["status"] == "succeeded" and items[0]["extraction_id"] == first["id"]
    assert items[0]["input_sha256"] == first["input_sha256"]
    assert "content" not in items[0] and "quote" not in items[0]
    usage = service.attempts.usage(world.owner, world.domain)
    assert usage["reserved_attempts"] == 1 and usage["remaining_attempts"] == 0
    with pytest.raises(CoreError) as error:
        service.extract(world.owner, world.domain, source["id"], request())
    assert error.value.code == "MODEL_DAILY_LIMIT" and error.value.status == 429
    assert model.calls == 1


@pytest.mark.parametrize(
    "error,code",
    [
        (CoreError("MODEL_UNAVAILABLE", "Sanitized provider error", 503), "MODEL_UNAVAILABLE"),
        (RuntimeError("private prompt and credential diagnostics"), "MODEL_OPERATION_FAILED"),
    ],
)
def test_failure_is_durable_and_same_key_never_reissues(world, error, code):
    source, model = world.source(), Model(error)
    service, command = ExtractionService(world.service, model), request()
    with pytest.raises(CoreError) as caught:
        service.extract(world.owner, world.domain, source["id"], command)
    assert caught.value.code == code
    assert "private prompt" not in str(caught.value)
    item = listing(world)[0]
    assert item["status"] == "failed" and item["error_code"] == code
    assert item["extraction_id"] is None and item["finished_at"]
    with pytest.raises(CoreError) as repeated:
        service.extract(world.owner, world.domain, source["id"], command)
    assert repeated.value.code == "MODEL_ATTEMPT_RECORDED" and model.calls == 1
    assert service.attempts.usage(world.owner, world.domain)["reserved_attempts"] == 1
    assert world.service.brief(world.owner, world.domain)["pending_proposals"] == []


def test_interrupted_attempt_remains_unresolved_and_is_not_replayed(world):
    class SimulatedTermination(BaseException):
        pass

    source, model = world.source(), Model(SimulatedTermination())
    service, command = ExtractionService(world.service, model), request()
    with pytest.raises(SimulatedTermination):
        service.extract(world.owner, world.domain, source["id"], command)
    item = listing(world)[0]
    assert item["status"] == "unresolved" and item["finished_at"] is None
    # A new service instance sees the durable reservation after the simulated process loss.
    with pytest.raises(CoreError) as caught:
        ExtractionService(world.service, Model()).extract(
            world.owner, world.domain, source["id"], command
        )
    assert caught.value.code == "MODEL_ATTEMPT_RECORDED"


def test_outcome_and_proposal_commit_are_atomic(world, monkeypatch):
    source, model = world.source(), Model()
    service = ExtractionService(world.service, model)

    def fail(*args):
        raise RuntimeError("Synthetic outcome storage failure")

    monkeypatch.setattr(service.attempts, "succeeded", fail)
    with pytest.raises(CoreError):
        service.extract(world.owner, world.domain, source["id"], request())
    assert listing(world)[0]["status"] == "failed"
    assert world.service.brief(world.owner, world.domain)["pending_proposals"] == []
    with world.admin.connect() as conn:
        assert (
            conn.execute(
                text("SELECT count(*) FROM cf_extractions WHERE tenant_id=:t AND domain_id=:d"),
                {"t": world.tenant, "d": world.domain},
            ).scalar_one()
            == 0
        )


def test_records_are_immutable_personal_and_source_authorized(world):
    source = world.source()
    service = ExtractionService(world.service, Model())
    service.extract(world.owner, world.domain, source["id"], request())
    item = listing(world)[0]
    for table, column in (("cf_model_attempts", "id"), ("cf_model_outcomes", "attempt_id")):
        with pytest.raises(DBAPIError), world.admin.begin() as conn:
            conn.execute(
                text(f"DELETE FROM {table} WHERE tenant_id=:t AND {column}=:id"),
                {"t": world.tenant, "id": item["id"]},
            )
    assert (
        world.client.get(world.prefix + "/model-attempts", headers=world.headers("bob")).status_code
        == 403
    )
    # Even another owner cannot inspect the first owner's personal attempts.
    with world.admin.begin() as conn:
        conn.execute(
            text(
                "UPDATE cf_memberships SET role='owner' WHERE tenant_id=:t AND domain_id=:d AND subject='bob'"
            ),
            {"t": world.tenant, "d": world.domain},
        )
    assert listing(world, "bob") == []
    assert (
        world.client.get(
            world.prefix + "/model-attempts/" + item["id"], headers=world.headers("bob")
        ).status_code
        == 404
    )
    world.service.set_access(
        world.owner, world.domain, source["id"], AccessInput(allowed_subjects=["bob"])
    )
    assert listing(world) == []
    assert (
        world.client.get(
            world.prefix + "/model-attempts/" + item["id"], headers=world.headers()
        ).status_code
        == 404
    )


@pytest.mark.parametrize("same_key", [True, False])
def test_shared_reservations_prevent_duplicate_calls_and_quota_overrun(world, same_key):
    source, model, barrier = world.source(), Model(), Barrier(2)
    keys = [str(uuid4()), str(uuid4())]
    if same_key:
        keys[1] = keys[0]

    def invoke(key):
        service = ExtractionService(world.service, model, daily_limit=1)
        barrier.wait(timeout=5)
        try:
            service.extract(world.owner, world.domain, source["id"], request(key))
            return "success"
        except (CoreError, DBAPIError):
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(invoke, keys))
    assert "success" in results and model.calls == 1
    assert len(listing(world)) == 1
    assert (
        ModelAttemptService(world.service, 1).usage(world.owner, world.domain)["remaining_attempts"]
        == 0
    )


def test_failed_attempt_does_not_allow_key_reuse_with_another_source(world):
    model = Model(CoreError("MODEL_UNAVAILABLE", "Synthetic", 503))
    service, command = ExtractionService(world.service, model), request()
    with pytest.raises(CoreError):
        service.extract(world.owner, world.domain, world.source()["id"], command)
    with pytest.raises(CoreError) as caught:
        service.extract(world.owner, world.domain, world.source()["id"], command)
    assert caught.value.code == "IDEMPOTENCY_CONFLICT" and model.calls == 1


def test_old_utc_day_reservations_do_not_consume_today_quota(world):
    source = world.source()
    service = ExtractionService(world.service, Model(), 2)
    service.extract(world.owner, world.domain, source["id"], request())
    with world.admin.begin() as conn:
        conn.execute(
            text("""INSERT INTO cf_model_attempts
            SELECT tenant_id,domain_id,:id,author,source_id,provider,requested_model,input_span,input_sha256,:key,request_hash,now()-interval '1 day'
            FROM cf_model_attempts WHERE tenant_id=:tenant AND domain_id=:domain LIMIT 1"""),
            {
                "id": str(uuid4()),
                "key": str(uuid4()),
                "tenant": world.tenant,
                "domain": world.domain,
            },
        )
    assert len(listing(world)) == 2
    assert service.attempts.usage(world.owner, world.domain)["remaining_attempts"] == 1


def test_mcp_model_usage_matches_owner_http(world):
    http = world.client.get(world.prefix + "/model-usage", headers=world.headers()).json()
    r = world.client.post(
        "/mcp/",
        headers={**world.headers(), "Accept": "application/json, text/event-stream"},
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "api_models_usage", "arguments": {"path": {"domain": world.domain}}},
        },
    )
    assert r.json()["result"]["structuredContent"] == {"http_status": 200, "data": http}


def test_outcome_storage_failure_leaves_inspectable_unresolved_attempt(world, monkeypatch, caplog):
    model = Model(CoreError("MODEL_UNAVAILABLE", "Synthetic provider failure", 503))
    service, command, source = ExtractionService(world.service, model), request(), world.source()

    def unavailable(*args):
        raise RuntimeError("private storage and credential diagnostics")

    monkeypatch.setattr(service.attempts, "failed", unavailable)
    with pytest.raises(CoreError) as failure:
        service.extract(world.owner, world.domain, source["id"], command)
    assert failure.value.code == "MODEL_UNAVAILABLE"
    assert listing(world)[0]["status"] == "unresolved"
    assert "private storage" not in caplog.text
    with pytest.raises(CoreError) as retry:
        service.extract(world.owner, world.domain, source["id"], command)
    assert retry.value.code == "MODEL_ATTEMPT_RECORDED" and model.calls == 1
