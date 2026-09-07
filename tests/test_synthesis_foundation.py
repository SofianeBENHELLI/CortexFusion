import pytest
from cortex_core.auth import CoreError
from cortex_core.companion import OpenRouterSynthesis as LegacySynthesis
from cortex_core.companion_responses import CompanionResponseService
from cortex_core.contracts import CompanionResponseInput
from cortex_core.synthesis_model import OpenRouterSynthesis
from pydantic import SecretStr
from test_companion import episode as model_episode
from test_companion import provider_reply
from test_companion_responses import episode, response_body


def test_response_and_callers_outcome_share_rollback_boundary(world):
    world.approve(world.proposal())
    answer = episode(world)
    data = CompanionResponseInput(**response_body(answer))
    service = CompanionResponseService(world.service)
    with pytest.raises(RuntimeError, match="outcome failed"):
        with world.db.transaction(world.viewer, world.domain) as conn:
            world.service._domain(conn, world.viewer, world.domain, lock=True)
            result = service._create(conn, world.viewer, world.domain, answer["episode_id"], data)
            assert result["response"]["idempotency_key"] == data.idempotency_key
            raise RuntimeError("outcome failed")
    assert service.listing(world.viewer, world.domain, 20, None)["items"] == []
    receipt = service.create(world.viewer, world.domain, answer["episode_id"], data)
    assert service.create(world.viewer, world.domain, answer["episode_id"], data) == receipt


def test_atomic_receipt_helper_still_checks_personal_ownership(world):
    world.approve(world.proposal())
    answer = episode(world)
    service = CompanionResponseService(world.service)
    with pytest.raises(CoreError) as error:
        with world.db.transaction(world.owner, world.domain) as conn:
            world.service._domain(conn, world.owner, world.domain, lock=True)
            service._create(
                conn,
                world.owner,
                world.domain,
                answer["episode_id"],
                CompanionResponseInput(**response_body(answer)),
            )
    assert error.value.status == 404


def test_adapter_import_compatibility_and_attempt_diagnostic_isolation(monkeypatch):
    assert LegacySynthesis is OpenRouterSynthesis
    first = OpenRouterSynthesis("synthetic/model", SecretStr("synthetic"))
    second = OpenRouterSynthesis("synthetic/model", SecretStr("synthetic"))
    monkeypatch.setattr(first, "_request", lambda payload: provider_reply())
    monkeypatch.setattr(second, "_request", lambda payload: {"invalid": "synthetic"})
    first.synthesize("incident", model_episode())
    first_usage = dict(first.last_usage)
    with pytest.raises(CoreError):
        second.synthesize("incident", model_episode())
    assert first.last_usage == first_usage
    assert first.last_diagnostic == {"stage": "validated"}
    assert second.last_usage is None
    assert second.last_diagnostic == {"stage": "usage"}
