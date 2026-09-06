from uuid import uuid4

import pytest
from cortex_core.auth import CoreError
from cortex_core.contracts import AccessInput, LocalExtractionInput
from cortex_core.extraction import ExtractionService
from cortex_core.local_model import LocalPassageModel


class FakeModel:
    calls = 0

    def select(self, source):
        self.calls += 1
        return {
            "quote": source,
            "start": 0,
            "end": len(source),
            "model": "synthetic",
            "model_digest": "a" * 64,
            "prompt_version": "fixture-v1",
            "input_tokens": 12,
            "output_tokens": 8,
        }


def test_model_selection_creates_only_proposal_and_retry_avoids_model(world):
    source = world.source()
    model = FakeModel()
    service = ExtractionService(world.service, model)
    data = LocalExtractionInput(allow_local_processing=True, idempotency_key=str(uuid4()))
    first = service.extract(world.owner, world.domain, source["id"], data)
    assert service.extract(world.owner, world.domain, source["id"], data) == first
    assert model.calls == 1
    assert service.receipt(world.owner, world.domain, first["id"]) == first
    assert world.service.concepts(world.owner, world.domain) == []
    world.approve(first["proposal"])
    assert len(world.service.concepts(world.owner, world.domain)) == 1


def test_model_cannot_invent_unsupported_passage(world):
    class Invented(FakeModel):
        def select(self, source):
            return {**super().select(source), "quote": "Invented unsupported text"}

    service = ExtractionService(world.service, Invented())
    with pytest.raises(CoreError, match="supported"):
        service.extract(
            world.owner,
            world.domain,
            world.source()["id"],
            LocalExtractionInput(allow_local_processing=True, idempotency_key=str(uuid4())),
        )
    assert world.service.brief(world.owner, world.domain)["pending_proposals"] == []


def test_source_revoked_during_model_call_does_not_propose(world):
    source = world.source()

    class Revoking(FakeModel):
        def select(self, content):
            world.service.set_access(
                world.owner, world.domain, source["id"], AccessInput(allowed_subjects=["bob"])
            )
            return super().select(content)

    with pytest.raises(CoreError, match="Source"):
        ExtractionService(world.service, Revoking()).extract(
            world.owner,
            world.domain,
            source["id"],
            LocalExtractionInput(allow_local_processing=True, idempotency_key=str(uuid4())),
        )
    assert world.service.brief(world.owner, world.domain)["pending_proposals"] == []


def test_disabled_default_and_no_agent_extraction(world):
    source = world.source()
    response = world.client.post(
        world.prefix + f"/sources/{source['id']}/extract-local",
        headers=world.headers(),
        json={"allow_local_processing": True, "idempotency_key": str(uuid4())},
    )
    assert response.status_code == 503 and response.json()["error"] == "MODEL_DISABLED"
    model = FakeModel()
    with pytest.raises(CoreError, match="owner"):
        ExtractionService(world.service, model).extract(
            world.agent,
            world.domain,
            source["id"],
            LocalExtractionInput(allow_local_processing=True, idempotency_key=str(uuid4())),
        )
    assert model.calls == 0


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com",
        "http://localhost:11434",
        "http://127.0.0.1/path",
        "http://user:password@127.0.0.1",
        "http://127.0.0.1/?q=1",
    ],
)
def test_model_destination_is_fixed_loopback_origin(url):
    with pytest.raises(ValueError):
        LocalPassageModel("fixture", url)


def test_adapter_validates_model_output_independently(monkeypatch):
    model = LocalPassageModel("fixture")

    def response(path, data=None):
        if path == "/api/tags":
            return {"models": [{"name": "fixture", "digest": "a" * 64}]}
        return {"done": True, "message": {"content": '{"quote":"not in the source"}'}}

    monkeypatch.setattr(model, "_request", response)
    with pytest.raises(CoreError, match="exact"):
        model.select("An actual source passage.")
