"""Launcher configuration only; no external provider or service is provisioned."""

from pathlib import Path

import pytest
from cortex_browser_gateway import cli
from cortex_browser_gateway.oidc import LoginError


def config():
    return {
        "CORTEX_BROWSER_ORIGIN": "http://127.0.0.1:5174",
        "CORTEX_BROWSER_ISSUER": "http://127.0.0.1:8900",
        "CORTEX_BROWSER_CLIENT_ID": "synthetic-console",
        "CORTEX_BROWSER_API_AUDIENCE": "synthetic-cortex",
        "CORTEX_BROWSER_API_ORIGIN": "http://127.0.0.1:8011",
        "CORTEX_BROWSER_ALLOW_LOOPBACK_HTTP": "1",
    }


@pytest.mark.parametrize(
    "change",
    [
        {"CORTEX_BROWSER_ALLOW_LOOPBACK_HTTP": "0"},
        {"CORTEX_BROWSER_ALLOW_LOOPBACK_HTTP": "yes"},
        {"CORTEX_BROWSER_ORIGIN": "https://console.test"},
        {"CORTEX_BROWSER_ORIGIN": "http://localhost:5174"},
        {"CORTEX_BROWSER_BIND": "0.0.0.0"},
        {"CORTEX_BROWSER_PORT": "0"},
        {"CORTEX_BROWSER_PORT": "65536"},
        {"CORTEX_BROWSER_PORT": "unknown"},
        {"CORTEX_BROWSER_API_ORIGIN": "http://127.0.0.1:8011/private"},
        {"CORTEX_BROWSER_API_ORIGIN": "http://127.0.0.1:8011?token=not-allowed"},
        {"CORTEX_BROWSER_API_AUDIENCE": "synthetic-console"},
        {"CORTEX_BROWSER_ISSUER": "http://external.test"},
    ],
)
def test_unsafe_or_inconsistent_local_configuration_fails_closed(change):
    with pytest.raises(LoginError, match="LOGIN_CONFIGURATION"):
        cli.load_settings({**config(), **change})


@pytest.mark.parametrize("missing", ["ORIGIN", "ISSUER", "CLIENT_ID", "API_AUDIENCE", "API_ORIGIN"])
def test_no_implicit_identity_or_api_defaults(missing):
    values = config()
    del values["CORTEX_BROWSER_" + missing]
    with pytest.raises(LoginError):
        cli.load_settings(values)


def test_private_confidential_client_secret_is_loaded_without_repr_or_environment_copy(tmp_path):
    path = tmp_path / "client-secret"
    path.write_text("synthetic-confidential-secret\n")
    path.chmod(0o600)
    values = {**config(), "CORTEX_BROWSER_CLIENT_SECRET_FILE": str(path)}
    settings = cli.load_settings(values)
    assert settings.oidc.client_secret == "synthetic-confidential-secret"
    assert "synthetic-confidential-secret" not in repr(settings)
    assert settings.oidc.redirect_uri == "http://127.0.0.1:5174/auth/callback"
    assert settings.bind == "127.0.0.1" and settings.port == 8015


@pytest.mark.parametrize(
    "kind", ["world-readable", "symlink", "directory", "oversized", "empty", "multiline", "missing"]
)
def test_secret_file_must_be_owned_private_regular_and_bounded(tmp_path, kind):
    path = tmp_path / "private-secret"
    if kind == "directory":
        path.mkdir()
    elif kind == "symlink":
        target = tmp_path / "target"
        target.write_text("private-value")
        target.chmod(0o600)
        path.symlink_to(target)
    elif kind != "missing":
        body = (
            "x" * 4097
            if kind == "oversized"
            else ""
            if kind == "empty"
            else "secret\nsecond"
            if kind == "multiline"
            else "secret"
        )
        path.write_text(body)
        path.chmod(0o644 if kind == "world-readable" else 0o600)
    with pytest.raises(LoginError) as failure:
        cli.private_secret(str(path))
    assert "secret" not in str(failure.value) and str(path) not in str(failure.value)


def test_check_validates_without_creating_http_clients_or_listeners(monkeypatch, capsys):
    for key, value in config().items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(
        cli, "build_app", lambda _: pytest.fail("no app construction in check mode")
    )
    monkeypatch.setattr(
        cli.uvicorn, "run", lambda *a, **kw: pytest.fail("no listener in check mode")
    )
    cli.main(["--check"])
    assert "connectivity is not verified" in capsys.readouterr().out


def test_launcher_disables_sensitive_access_logs_and_forwarded_header_trust(monkeypatch):
    for key, value in config().items():
        monkeypatch.setenv(key, value)
    calls = []
    sentinel = object()
    monkeypatch.setattr(cli, "build_app", lambda _: sentinel)
    monkeypatch.setattr(cli.uvicorn, "run", lambda *args, **kwargs: calls.append((args, kwargs)))
    cli.main([])
    args, kwargs = calls[0]
    assert args == (sentinel,)
    assert kwargs["access_log"] is False and kwargs["proxy_headers"] is False
    assert kwargs["workers"] == 1 and kwargs["host"] == "127.0.0.1"
    assert kwargs["limit_concurrency"] == 64 and kwargs["h11_max_incomplete_event_size"] == 16384


def test_configuration_errors_do_not_dump_credentials_or_paths(monkeypatch, capsys):
    monkeypatch.setenv("CORTEX_BROWSER_ORIGIN", "bad-origin-with-PRIVATE-value")
    with pytest.raises(SystemExit) as failure:
        cli.main(["--check"])
    assert "PRIVATE" not in str(failure.value)
    assert not capsys.readouterr().out


def test_script_entry_point_is_in_package_metadata():
    import tomllib

    package = tomllib.loads(Path("services/browser-gateway/pyproject.toml").read_text())
    assert (
        package["project"]["scripts"]["cortex-browser-gateway"] == "cortex_browser_gateway.cli:main"
    )
