"""Local persistent OKF workspace, isolated from disposable test databases.

Secrets and data stay under .runtime or dedicated Docker volumes. No model call,
external deployment, volume removal, test identity or automatic knowledge approval.
"""

import argparse
import hashlib
import json
import os
import secrets
import signal
import subprocess
import time
from pathlib import Path
from uuid import uuid4

import httpx
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import create_engine, text

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / ".runtime/brain/okf-workspace"
PG_IMAGE = "postgres:17.11-bookworm"
GRAPH_IMAGE = "terminusdb/terminusdb-server@sha256:385faf298ad77aaf2d4d6df5e84a4cbe3596d01dab2e3b991af905639ae56388"
ISSUER = "https://identity.cortex.local/okf"
BASE_URL = "http://127.0.0.1:8013"


def private_file(path, content):
    path = Path(path)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write(content)


def configuration(create=False):
    path = DIRECTORY / "workspace.json"
    if not path.exists():
        if not create:
            raise ValueError("Initialize the private workspace first")
        DIRECTORY.mkdir(parents=True, mode=0o700, exist_ok=True)
        DIRECTORY.chmod(0o700)
        cfg = {
            "workspace_id": str(uuid4()),
            "tenant": str(uuid4()),
            "domain": str(uuid4()),
            "subject": "sofiane-local",
            "scope": "cortex-okf-private",
            "postgres_password": secrets.token_hex(32),
            "app_password": secrets.token_hex(32),
            "graph_password": secrets.token_hex(32),
        }
        for name in ("identity", "confirmation"):
            key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
            private_file(
                DIRECTORY / f"{name}-private.pem",
                key.private_bytes(
                    serialization.Encoding.PEM,
                    serialization.PrivateFormat.PKCS8,
                    serialization.NoEncryption(),
                ).decode(),
            )
            private_file(
                DIRECTORY / f"{name}.pem",
                key.public_key()
                .public_bytes(
                    serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
                )
                .decode(),
            )
        private_file(path, json.dumps(cfg, indent=2) + "\n")
    cfg = json.loads(path.read_text())
    for name in ("identity", "confirmation"):
        if not (DIRECTORY / f"{name}-private.pem").is_file():
            raise ValueError("Existing workspace key is missing; never rotate it implicitly")
    return cfg


def run(args, *, env=None, timeout=120, allow_missing=False):
    result = subprocess.run(args, cwd=ROOT, env=env, capture_output=True, timeout=timeout)
    if result.returncode:
        if allow_missing:
            return None
        # Command arguments and captured errors may contain credentials. Keep them private.
        raise RuntimeError(f"Local workspace command failed: {args[0]} (exit {result.returncode})")
    return result.stdout.decode()


def ensure_container(cfg, name, image, port, container_port, mount, env_content):
    label = cfg["workspace_id"]
    existing = run(["docker", "inspect", name], allow_missing=True)
    if existing:
        state = json.loads(existing)[0]
        if state["Config"].get("Labels", {}).get("cortex.private-workspace") != label:
            raise ValueError("Container name is already owned by another workspace")
        bindings = state["HostConfig"]["PortBindings"].get(f"{container_port}/tcp")
        if bindings != [{"HostIp": "127.0.0.1", "HostPort": str(port)}]:
            raise ValueError("Private container binding has changed")
        if not state["State"]["Running"]:
            run(["docker", "start", name])
        return
    volume = name + "-data"
    data = run(["docker", "volume", "inspect", volume], allow_missing=True)
    if data:
        if json.loads(data)[0].get("Labels", {}).get("cortex.private-workspace") != label:
            raise ValueError("Data volume belongs to another workspace")
    else:
        run(["docker", "volume", "create", "--label", f"cortex.private-workspace={label}", volume])
    env_path = DIRECTORY / (name + ".env")
    if env_path.exists():
        if env_path.read_text() != env_content:
            raise ValueError("Existing container environment differs")
    else:
        private_file(env_path, env_content)
    run(
        [
            "docker",
            "run",
            "--detach",
            "--pull=never",
            "--name",
            name,
            "--label",
            f"cortex.private-workspace={label}",
            "--publish",
            f"127.0.0.1:{port}:{container_port}",
            "--mount",
            f"type=volume,src={volume},dst={mount}",
            "--env-file",
            str(env_path),
            image,
        ]
    )


def environment(cfg):
    # Never inherit a provider, test fixture override or alternate identity configuration.
    env = {k: v for k, v in os.environ.items() if not k.startswith(("CORTEX_", "OPENROUTER_"))}
    env.update(
        {
            "CORTEX_MIGRATION_DATABASE_URL": f"postgresql+pg8000://postgres:{cfg['postgres_password']}@127.0.0.1:55433/cortex_okf",
            "CORTEX_RUST_DATABASE_URL": f"postgresql://cortex_app:{cfg['app_password']}@127.0.0.1:55433/cortex_okf",
            "CORTEX_TERMINUS_URL": "http://127.0.0.1:6364",
            "CORTEX_TERMINUS_USER": "admin",
            "CORTEX_TERMINUS_PASSWORD": cfg["graph_password"],
            "CORTEX_JWT_ISSUER": ISSUER,
            "CORTEX_JWT_AUDIENCE": "cortex-core",
            "CORTEX_JWT_PUBLIC_KEY_FILE": str(DIRECTORY / "identity.pem"),
            "CORTEX_CONFIRMATION_PUBLIC_KEY_FILE": str(DIRECTORY / "confirmation.pem"),
            "CORTEX_CORS_ORIGINS": '["http://127.0.0.1:5175"]',
            "CORTEX_RUST_BIND": "127.0.0.1:8013",
        }
    )
    if (DIRECTORY / "map-index.json").is_file():
        env["CORTEX_DOCUMENTARY_MAP_INDEX"] = str(DIRECTORY / "map-index.json")
    return env


def initialize(cfg):
    ensure_container(
        cfg,
        "cortex-okf-postgres",
        PG_IMAGE,
        55433,
        5432,
        "/var/lib/postgresql/data",
        f"POSTGRES_PASSWORD={cfg['postgres_password']}\nPOSTGRES_DB=cortex_okf\n",
    )
    ensure_container(
        cfg,
        "cortex-okf-terminus",
        GRAPH_IMAGE,
        6364,
        6363,
        "/app/terminusdb/storage",
        f"TERMINUSDB_ADMIN_PASS={cfg['graph_password']}\n",
    )
    env = environment(cfg)
    db = create_engine(env["CORTEX_MIGRATION_DATABASE_URL"], connect_args={"timeout": 3})
    try:
        for attempt in range(60):
            try:
                with db.connect() as conn:
                    conn.execute(text("SELECT 1"))
                break
            except Exception:
                if attempt == 59:
                    raise RuntimeError("Private PostgreSQL did not become available") from None
                time.sleep(0.5)
        with db.begin() as conn:
            exists = conn.execute(
                text("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='cortex_app')")
            ).scalar_one()
            if not exists:
                password = cfg["app_password"]
                if len(password) != 64 or any(c not in "0123456789abcdef" for c in password):
                    raise ValueError("Unexpected generated application credential format")
                conn.execute(
                    text(
                        f"CREATE ROLE cortex_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '{password}'"
                    )
                )
        run([str(ROOT / ".venv/bin/alembic"), "upgrade", "head"], env=env)
        run(
            [
                str(ROOT / ".venv/bin/cortex"),
                "bootstrap",
                "--tenant",
                cfg["tenant"],
                "--domain",
                cfg["domain"],
                "--owner",
                cfg["subject"],
                "--name",
                "Savoir OKF privé",
            ],
            env=env,
        )
    finally:
        db.dispose()
    with httpx.Client(auth=("admin", cfg["graph_password"]), trust_env=False, timeout=3) as client:
        for attempt in range(60):
            try:
                response = client.get("http://127.0.0.1:6364/api/info")
                if response.status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            if attempt == 59:
                raise RuntimeError("Private TerminusDB did not become available")
            time.sleep(0.5)
    print(
        json.dumps(
            {
                "workspace": str(DIRECTORY),
                "tenant": cfg["tenant"],
                "domain": cfg["domain"],
                "published_by_initialization": 0,
            }
        )
    )


def headers(cfg, *, lifetime=300):
    if not 30 <= lifetime <= 1800:
        raise ValueError("Local session lifetime must be between 30 and 1800 seconds")
    now = int(time.time())
    token = jwt.encode(
        {
            "iss": ISSUER,
            "aud": "cortex-core",
            "sub": cfg["subject"],
            "tenant": cfg["tenant"],
            "iat": now,
            "exp": now + lifetime,
        },
        (DIRECTORY / "identity-private.pem").read_bytes(),
        algorithm="RS256",
    )
    return {"Authorization": "Bearer " + token, "X-Tenant-ID": cfg["tenant"]}


def signed(cfg, action, arguments):
    now = int(time.time())
    canonical = json.dumps(
        {"action": action, "arguments": arguments},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    proof = jwt.encode(
        {
            "iss": "cortex-trusted-host",
            "aud": "cortex-mcp-confirmation",
            "sub": cfg["subject"],
            "tenant": cfg["tenant"],
            "action": action,
            "command_hash": hashlib.sha256(canonical.encode()).hexdigest(),
            "jti": str(uuid4()),
            "iat": now,
            "exp": now + 120,
        },
        (DIRECTORY / "confirmation-private.pem").read_bytes(),
        algorithm="RS256",
    )
    return {**headers(cfg), "X-Cortex-Confirmation": proof}


def serve(cfg, duration):
    from scripts.qualification_clock import Deadline

    if not 60 <= duration <= 43200:
        raise ValueError("Runtime duration must be between 60 seconds and 12 hours")
    stop = False

    def shutdown(*_):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    log_path = DIRECTORY / f"server-{int(time.time())}.log"
    with os.fdopen(os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as log:
        process = subprocess.Popen(
            [str(ROOT / "target/debug/cortex-rust-core")],
            env=environment(cfg),
            stdout=log,
            stderr=log,
        )
        try:
            with httpx.Client(base_url=BASE_URL, trust_env=False, timeout=3) as client:
                for attempt in range(60):
                    if process.poll() is not None:
                        raise RuntimeError("Private runtime stopped; inspect its private log")
                    try:
                        response = client.get("/ready")
                        if response.status_code == 200:
                            identity = client.get("/v1/me", headers=headers(cfg))
                            if identity.status_code != 200:
                                raise RuntimeError("Private runtime identity check failed")
                            break
                    except httpx.HTTPError:
                        pass
                    if attempt == 59:
                        raise RuntimeError("Private runtime did not become ready")
                    time.sleep(0.5)
            print(
                json.dumps(
                    {
                        "ready": True,
                        "base_url": BASE_URL,
                        "domain": cfg["domain"],
                        "runtime_pid": process.pid,
                    }
                ),
                flush=True,
            )
            deadline = Deadline(duration)
            while not stop and not deadline.expired():
                time.sleep(0.5)
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["init", "serve", "session"])
    parser.add_argument("--duration", type=int, default=3600)
    args = parser.parse_args()
    cfg = configuration(create=args.action == "init")
    if args.action == "init":
        initialize(cfg)
    elif args.action == "serve":
        serve(cfg, args.duration)
    else:
        path = DIRECTORY / f"session-{int(time.time())}.json"
        private_file(
            path,
            json.dumps(
                {
                    "tenant": cfg["tenant"],
                    "domain": cfg["domain"],
                    "token": headers(cfg, lifetime=1800)["Authorization"].removeprefix("Bearer "),
                }
            ),
        )
        print(json.dumps({"private_session_file": str(path), "expires_in_seconds": 1800}))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # A DB exception can echo a SQL statement containing a generated password.
        raise SystemExit(
            f"Private workspace failed ({type(exc).__name__}); data preserved."
        ) from None
