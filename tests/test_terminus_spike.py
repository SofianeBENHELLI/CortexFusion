import importlib.util
from pathlib import Path

import httpx
import pytest

spec = importlib.util.spec_from_file_location(
    "terminus_spike", Path(__file__).resolve().parents[1] / "experiments/terminusdb/probe.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_semantic_conflict_requires_same_scope_and_opposed_predicates():
    atom = {"subject": "X", "object": "Y", "context": "A", "predicate": "SUPPORTS"}
    opposed = {**atom, "predicate": "INCOMPATIBLE_WITH"}
    assert len(module.semantic_conflicts([atom, opposed])) == 1
    assert module.semantic_conflicts([atom, atom]) == []
    assert module.semantic_conflicts([atom, {**opposed, "context": "B"}]) == []
    assert module.semantic_conflicts([atom, {**opposed, "object": "Z"}]) == []


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com",
        "http://127.0.0.1/other",
        "http://user:secret@localhost",
        "http://localhost?next=x",
    ],
)
def test_probe_cannot_send_fixture_or_admin_credentials_to_remote_url(url):
    with pytest.raises(ValueError):
        module.TerminusProbe(url, "synthetic")


def test_probe_refuses_redirect_without_replaying_mutation():
    seen = []

    def respond(request):
        seen.append(request)
        return httpx.Response(307, headers={"Location": "https://example.com"})

    probe = module.TerminusProbe(
        "http://127.0.0.1:6363", "synthetic", transport=httpx.MockTransport(respond)
    )
    try:
        with pytest.raises(module.SpikeFailure, match="HTTP 307"):
            probe.request("POST", "db/" + probe.root, json={})
        assert len(seen) == 1
    finally:
        probe.close()


def test_probe_transport_failure_is_not_retried_or_logged_with_credentials():
    seen = []

    def respond(request):
        seen.append(request)
        raise httpx.ReadTimeout("PRIVATE_CREDENTIAL", request=request)

    probe = module.TerminusProbe(
        "http://localhost:6363", "synthetic", transport=httpx.MockTransport(respond)
    )
    try:
        with pytest.raises(module.SpikeFailure) as error:
            probe.request("POST", "db/" + probe.root, json={})
        assert "PRIVATE_CREDENTIAL" not in str(error.value)
        assert len(seen) == 1
    finally:
        probe.close()
