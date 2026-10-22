import hashlib
import json
import stat

import jwt
import pytest

from scripts import okf_workspace as workspace


@pytest.fixture
def private_workspace(tmp_path, monkeypatch):
    directory = tmp_path / "synthetic-private-workspace"
    monkeypatch.setattr(workspace, "DIRECTORY", directory)
    return directory, workspace.configuration(create=True)


def test_workspace_configuration_is_private_stable_and_never_rotates_missing_keys(
    private_workspace,
):
    directory, cfg = private_workspace
    before = {p.name: p.read_bytes() for p in directory.iterdir()}
    assert stat.S_IMODE(directory.stat().st_mode) == 0o700
    assert all(stat.S_IMODE(p.stat().st_mode) == 0o600 for p in directory.iterdir())
    assert workspace.configuration(create=True) == cfg
    assert before == {p.name: p.read_bytes() for p in directory.iterdir()}
    (directory / "identity-private.pem").unlink()
    with pytest.raises(ValueError, match="never rotate"):
        workspace.configuration(create=True)
    assert not (directory / "identity-private.pem").exists()


def test_environment_drops_fixture_and_provider_settings_and_binds_loopback(
    private_workspace, monkeypatch
):
    _, cfg = private_workspace
    for key in (
        "CORTEX_OPENROUTER_MODEL",
        "CORTEX_OPENROUTER_API_KEY",
        "OPENROUTER_API_KEY",
        "CORTEX_SYNTHETIC_OPENROUTER_URL",
    ):
        monkeypatch.setenv(key, "synthetic-value")
    monkeypatch.setenv("CORTEX_RUST_BIND", "0.0.0.0:8011")
    monkeypatch.setenv("CORTEX_CORS_ORIGINS", "*")
    env = workspace.environment(cfg)
    assert not any("OPENROUTER" in key for key in env)
    assert env["CORTEX_RUST_BIND"] == "127.0.0.1:8013"
    assert json.loads(env["CORTEX_CORS_ORIGINS"]) == ["http://127.0.0.1:5175"]
    assert "@127.0.0.1:55433/cortex_okf" in env["CORTEX_RUST_DATABASE_URL"]


def test_local_identity_and_confirmation_are_separately_signed_and_bounded(private_workspace):
    directory, cfg = private_workspace
    identity = workspace.headers(cfg, lifetime=60)
    claims = jwt.decode(
        identity["Authorization"].removeprefix("Bearer "),
        (directory / "identity.pem").read_bytes(),
        algorithms=["RS256"],
        audience="cortex-core",
        issuer=workspace.ISSUER,
    )
    assert claims["exp"] - claims["iat"] == 60
    assert claims["tenant"] == identity["X-Tenant-ID"] == cfg["tenant"]
    args = {"path": {"domain": cfg["domain"]}, "body": {"reason": "Synthetic é🙂"}}
    proof = workspace.signed(cfg, "synthetic.action", args)["X-Cortex-Confirmation"]
    decision = jwt.decode(
        proof,
        (directory / "confirmation.pem").read_bytes(),
        algorithms=["RS256"],
        audience="cortex-mcp-confirmation",
        issuer="cortex-trusted-host",
    )
    expected = json.dumps(
        {"action": "synthetic.action", "arguments": args},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    assert decision["command_hash"] == hashlib.sha256(expected.encode()).hexdigest()
    assert decision["sub"] == claims["sub"] and decision["exp"] - decision["iat"] == 120
    with pytest.raises(jwt.InvalidSignatureError):
        jwt.decode(
            proof,
            (directory / "identity.pem").read_bytes(),
            algorithms=["RS256"],
            audience="cortex-mcp-confirmation",
        )
    for lifetime in (29, 1801):
        with pytest.raises(ValueError, match="lifetime"):
            workspace.headers(cfg, lifetime=lifetime)


@pytest.mark.parametrize("fault", ["owner", "binding"])
def test_existing_foreign_or_exposed_container_is_never_started(monkeypatch, fault):
    state = {
        "Config": {"Labels": {"cortex.private-workspace": "ours"}},
        "HostConfig": {
            "PortBindings": {"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "55433"}]}
        },
        "State": {"Running": False},
    }
    if fault == "owner":
        state["Config"]["Labels"]["cortex.private-workspace"] = "another-workspace"
    else:
        state["HostConfig"]["PortBindings"]["5432/tcp"][0]["HostIp"] = "0.0.0.0"
    calls = []

    def run(args, **_):
        calls.append(args)
        assert args == ["docker", "inspect", "synthetic-container"]
        return json.dumps([state])

    monkeypatch.setattr(workspace, "run", run)
    with pytest.raises(ValueError):
        workspace.ensure_container(
            {"workspace_id": "ours"},
            "synthetic-container",
            "synthetic-image",
            55433,
            5432,
            "/synthetic",
            "",
        )
    assert len(calls) == 1


def test_foreign_volume_is_never_mounted(monkeypatch):
    calls = []

    def run(args, **_):
        calls.append(args)
        if args == ["docker", "inspect", "synthetic-container"]:
            return None
        assert args == ["docker", "volume", "inspect", "synthetic-container-data"]
        return json.dumps([{"Labels": {"cortex.private-workspace": "another-workspace"}}])

    monkeypatch.setattr(workspace, "run", run)
    with pytest.raises(ValueError, match="volume"):
        workspace.ensure_container(
            {"workspace_id": "ours"},
            "synthetic-container",
            "synthetic-image",
            55433,
            5432,
            "/synthetic",
            "",
        )
    assert len(calls) == 2
