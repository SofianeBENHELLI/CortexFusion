"""Failure boundaries for the disposable restore orchestrator; no Docker required."""

import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def load_protocol():
    sys.path.insert(0, str(SCRIPTS))
    try:
        spec = importlib.util.spec_from_file_location(
            "restore_qualification_test", SCRIPTS / "verify_coordinated_restore.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.pop(0)


def test_cli_timeout_keeps_owned_container_registered_for_cleanup(monkeypatch, tmp_path):
    module = load_protocol()
    containers = module.Containers(tmp_path)
    calls = []

    def command(args, **kwargs):
        calls.append(args)
        if args[:2] == ["docker", "wait"]:
            raise subprocess.TimeoutExpired(args, 180)
        return b"synthetic-container-id"

    monkeypatch.setattr(module, "process", command)
    with pytest.raises(subprocess.TimeoutExpired):
        containers.cli(tmp_path, tmp_path, "bundle", "admin/synthetic")
    assert len(containers.created) == 1
    name = containers.created[0]
    assert name in calls[0]
    monkeypatch.setattr(
        module.subprocess,
        "run",
        lambda *_args, **_kwargs: SimpleNamespace(
            returncode=0,
            stdout=json.dumps(
                [{"Config": {"Labels": {"cortex.qualification": containers.prefix}}}]
            ).encode(),
        ),
    )
    containers.cleanup()
    assert calls[-1] == ["docker", "rm", "--force", "--volumes", name]
    assert not containers.created


def test_cleanup_refuses_a_container_without_this_run_label(monkeypatch, tmp_path):
    module = load_protocol()
    containers = module.Containers(tmp_path)
    containers.created.append(containers.prefix + "-job")
    monkeypatch.setattr(
        module.subprocess,
        "run",
        lambda *_args, **_kwargs: SimpleNamespace(
            returncode=0, stdout=b'[{"Config":{"Labels":{"cortex.qualification":"another-run"}}}]'
        ),
    )
    calls = []
    monkeypatch.setattr(module, "process", lambda args, **_kwargs: calls.append(args))
    with pytest.raises(RuntimeError, match="outside this qualification"):
        containers.cleanup()
    assert calls == []


def test_corrupted_bundle_is_rejected_before_import(tmp_path):
    module = load_protocol()
    path = tmp_path / "synthetic.bundle"
    path.write_bytes(b"synthetic original")
    expected = module.file_hashes(tmp_path)[path.name]
    module.verify_bundle(path, expected)
    path.write_bytes(b"synthetic altered")
    with pytest.raises(ValueError, match="before engine import"):
        module.verify_bundle(path, expected)


def test_commit_comparison_sorts_documents_but_preserves_business_list_order():
    module = load_protocol()
    source = {
        "db": {
            "commit": "original",
            "instance": [{"@id": "b", "sources": ["second", "first"]}, {"@id": "a"}],
            "schema": [{"@id": "Z"}, {"@type": "@context"}],
        }
    }
    normalized = module.normalized_commits(source)
    assert normalized["db"]["commit"] == "original"
    assert [d["@id"] for d in normalized["db"]["instance"]] == ["a", "b"]
    assert normalized["db"]["instance"][1]["sources"] == ["second", "first"]
