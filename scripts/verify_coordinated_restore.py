"""Disposable-container qualification; never operates on caller-supplied stores or databases."""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tarfile
import tempfile
import time
from pathlib import Path
from uuid import uuid4

import httpx
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import create_engine, text
from verify_rust_configured import native_client
from verify_rust_publication_recovery import start_graph

ROOT = Path(__file__).resolve().parents[1]
ENGINE_IMAGE = "terminusdb/terminusdb-server@sha256:385faf298ad77aaf2d4d6df5e84a4cbe3596d01dab2e3b991af905639ae56388"
PG_IMAGE = "postgres:17.11-bookworm"
CLI = "/app/terminusdb/terminusdb"
STORE = "/app/terminusdb/storage"
PASSWORD = "synthetic-restore-password"
DATABASE = "cortex_restore_test"


def process(args, *, env=None, timeout=120, input=None):
    result = subprocess.run(
        args, cwd=ROOT, env=env, input=input, capture_output=True, timeout=timeout
    )
    if result.returncode:
        # All inputs are synthetic, but report only a bounded diagnostic on unexpected failures.
        diagnostic = result.stderr.decode(errors="replace")[-3000:].replace(
            PASSWORD, "[synthetic credential]"
        )
        raise RuntimeError(
            f"Qualification command {args[0]} failed ({result.returncode}): {diagnostic}"
        )
    return result.stdout


class Containers:
    def __init__(self, directory):
        self.directory = directory
        self.prefix = "cf-restore-" + uuid4().hex[:12]
        self.created = []

    def start(self, suffix, image, port=None, mounts=(), variables=(), command=()):
        name = self.prefix + "-" + suffix
        args = [
            "docker",
            "run",
            "--detach",
            "--name",
            name,
            "--label",
            "cortex.qualification=" + self.prefix,
        ]
        if port:
            args += ["--publish", f"127.0.0.1::{port}"]
        for source, target in mounts:
            args += ["--mount", f"type=bind,src={source},dst={target}"]
        for variable in variables:
            args += ["--env", variable]
        args += [image, *command]
        self.created.append(name)
        process(args)
        if not port:
            return name, None
        address = process(["docker", "port", name, str(port)]).decode().strip()
        assert address.startswith("127.0.0.1:"), "Qualification port must bind loopback"
        return name, int(address.rsplit(":", 1)[1])

    def one_shot(self, image, mounts, command):
        name, _ = self.start("job-" + uuid4().hex, image, mounts=mounts, command=command)
        result = process(["docker", "wait", name], timeout=180).strip()
        if result != b"0":
            logs = subprocess.run(
                ["docker", "logs", name], capture_output=True, timeout=30, check=False
            )
            diagnostic = (logs.stdout + logs.stderr).decode(errors="replace")[-6000:]
            raise RuntimeError(
                "Qualification container failed: "
                + diagnostic.replace(PASSWORD, "[synthetic credential]")
            )
        output = process(["docker", "logs", name])
        process(["docker", "rm", "--volumes", name])
        self.created.remove(name)
        return output

    def cli(self, store, bundles, *arguments):
        return self.one_shot(
            ENGINE_IMAGE, [(store, STORE), (bundles, "/backup")], [CLI, *arguments]
        )

    def cleanup(self):
        for name in reversed(self.created.copy()):
            inspection = subprocess.run(
                ["docker", "inspect", name], capture_output=True, timeout=30, check=False
            )
            if inspection.returncode:
                continue
            data = json.loads(inspection.stdout)[0]
            if data.get("Config", {}).get("Labels", {}).get("cortex.qualification") != self.prefix:
                raise RuntimeError("Refusing cleanup of a container outside this qualification run")
            process(["docker", "rm", "--force", "--volumes", name], timeout=30)
            self.created.remove(name)


def wait_postgres(port):
    url = f"postgresql+pg8000://postgres:{PASSWORD}@127.0.0.1:{port}/{DATABASE}"
    database = create_engine(url)
    for _ in range(60):
        try:
            with database.connect() as conn:
                conn.execute(text("SELECT 1"))
            return database
        except Exception:
            time.sleep(0.5)
    raise RuntimeError("Synthetic PostgreSQL did not start")


def wait_engine(port):
    url = f"http://127.0.0.1:{port}"
    with httpx.Client(auth=("admin", PASSWORD), trust_env=False, timeout=2) as client:
        for _ in range(90):
            try:
                r = client.get(url + "/api/info")
                if r.status_code == 200:
                    return url, r.json()
            except httpx.HTTPError:
                pass
            time.sleep(0.5)
    raise RuntimeError("Synthetic TerminusDB did not start")


def sql_state(admin):
    result = {}
    with admin.connect() as conn:
        conn.execute(text("SET TIME ZONE 'UTC'"))
        names = (
            conn.execute(
                text(
                    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'cf_%' ORDER BY tablename"
                )
            )
            .scalars()
            .all()
        )
        for name in names:
            assert name.startswith("cf_") and name.replace("_", "").isalnum()
            result[name] = (
                conn.execute(text(f'SELECT to_jsonb(r) FROM "{name}" r ORDER BY to_jsonb(r)::text'))
                .scalars()
                .all()
            )
    return result


def read_commits(base, manifests):
    result = {}
    with httpx.Client(
        auth=("admin", PASSWORD), trust_env=False, follow_redirects=False, timeout=20
    ) as client:
        for manifest in manifests:
            s = manifest["snapshot"]
            path = f"/api/document/admin/{s['database']}/local/commit/{s['commit']}"
            instance = client.get(base + path, params={"as_list": "true", "unfold": "true"})
            schema = client.get(base + path, params={"as_list": "true", "graph_type": "schema"})
            assert instance.status_code == schema.status_code == 200, (
                "Original immutable commit is unavailable"
            )
            result[s["database"]] = {
                "commit": s["commit"],
                "instance": instance.json(),
                "schema": schema.json(),
            }
    return result


def fixture_keys(directory):
    private = {}
    for name in ["identity", "confirmation"]:
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        private[name] = key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        (directory / (name + ".pem")).write_bytes(
            key.public_key().public_bytes(
                serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
            )
        )
    return private


class Fixture:
    def __init__(self, tenant, private):
        self.tenant = tenant
        self.private = private

    def headers(self, subject="alice"):
        now = int(time.time())
        token = jwt.encode(
            {
                "iss": "https://identity.test",
                "aud": "cortex-core",
                "sub": subject,
                "tenant": self.tenant,
                "iat": now,
                "exp": now + 300,
            },
            self.private["identity"],
            algorithm="RS256",
        )
        return {"Authorization": "Bearer " + token, "X-Tenant-ID": self.tenant}

    def signed(self, action, args):
        now = int(time.time())
        digest = hashlib.sha256(
            json.dumps(
                {"action": action, "arguments": args},
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
        ).hexdigest()
        proof = jwt.encode(
            {
                "iss": "cortex-trusted-host",
                "aud": "cortex-mcp-confirmation",
                "sub": "alice",
                "tenant": self.tenant,
                "action": action,
                "command_hash": digest,
                "jti": str(uuid4()),
                "iat": now,
                "exp": now + 120,
            },
            self.private["confirmation"],
            algorithm="RS256",
        )
        return {**self.headers(), "X-Cortex-Confirmation": proof}

    def command(self, client, domain, suffix, action, body, proposal=None):
        path = {"domain": domain}
        if proposal:
            path["proposal_id"] = proposal
        response = client.post(
            f"/v1/domains/{domain}/{suffix}",
            headers=self.signed(action, {"path": path, "body": body}),
            json=body,
        )
        assert response.status_code < 300, (action, response.status_code, response.text)
        return response.json()

    def publish(self, client, domain, version, concepts, activate=True):
        response = client.post(
            f"/v1/domains/{domain}/proposals",
            headers=self.headers(),
            json={
                "base_version": version,
                "changes": [{"kind": "put_concept", "concept": c} for c in concepts],
                "reason": "Synthetic coordinated restore",
                "idempotency_key": str(uuid4()),
            },
        )
        assert response.status_code == 201, response.text
        proposal = response.json()
        body = {
            "digest": proposal["digest"],
            "expected_version": version,
            "expected_review_revision": 0,
            "reason": "Synthetic validation",
            "idempotency_key": str(uuid4()),
        }
        self.command(
            client,
            domain,
            f"proposals/{proposal['id']}/approve",
            "proposals.approve",
            body,
            proposal["id"],
        )
        if activate:
            self.command(
                client,
                domain,
                f"proposals/{proposal['id']}/publish",
                "proposals.publish",
                {"expected_published_version": version},
                proposal["id"],
            )
        return proposal["id"]

    def seed(self, client, admin, gateway):
        domains = [str(uuid4()), str(uuid4())]
        with admin.begin() as conn:
            conn.execute(
                text("INSERT INTO cf_tenants(id,name) VALUES(:t,'Synthetic restore')"),
                {"t": self.tenant},
            )
            for d in domains:
                conn.execute(
                    text(
                        "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'Synthetic restore')"
                    ),
                    {"t": self.tenant, "d": d},
                )
                conn.execute(
                    text(
                        "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,'alice','owner'),(:t,:d,'bob','viewer')"
                    ),
                    {"t": self.tenant, "d": d},
                )
        concepts = []
        for title, subjects in [("Public", ["alice", "bob"]), ("Private", ["alice"])]:
            content = title + " synthetic restore proof 🧠."
            response = client.post(
                f"/v1/domains/{domains[0]}/sources",
                headers=self.headers(),
                json={
                    "title": title,
                    "location": "synthetic://restore/" + title,
                    "content": content,
                    "allowed_subjects": subjects,
                },
            )
            assert response.status_code == 201, response.text
            concepts.append(
                {
                    "concept_id": str(uuid4()),
                    "title": title,
                    "body": content,
                    "sources": [
                        {"source_id": response.json()["id"], "start": 0, "end": len(content)}
                    ],
                    "maturity": "observed",
                    "links": [],
                }
            )
        concepts[0]["links"] = [
            {
                "target_id": concepts[1]["concept_id"],
                "kind": "associative",
                "primary": False,
                "weight": 0.5,
            }
        ]
        self.publish(client, domains[0], 0, concepts)
        concepts[0]["title"] = "Public version two"
        self.publish(client, domains[0], 1, [concepts[0]])
        # A legacy already-published domain has SQL/journal state but no engine manifest.
        content = "Synthetic legacy import restore proof."
        response = client.post(
            f"/v1/domains/{domains[1]}/sources",
            headers=self.headers(),
            json={
                "title": "Import proof",
                "location": "synthetic://restore/import",
                "content": content,
                "allowed_subjects": ["alice"],
            },
        )
        assert response.status_code == 201, response.text
        concept = {
            "concept_id": str(uuid4()),
            "title": "Imported",
            "body": content,
            "sources": [{"source_id": response.json()["id"], "start": 0, "end": len(content)}],
            "maturity": "observed",
            "links": [],
        }
        proposal = self.publish(client, domains[1], 0, [concept], activate=False)
        with admin.begin() as conn:
            params = {
                "t": self.tenant,
                "d": domains[1],
                "id": concept["concept_id"],
                "payload": json.dumps(concept),
                "p": proposal,
            }
            conn.execute(
                text(
                    "INSERT INTO cf_concepts(tenant_id,domain_id,id,payload,version) VALUES(:t,:d,:id,CAST(:payload AS jsonb),1)"
                ),
                params,
            )
            conn.execute(
                text("UPDATE cf_domains SET published_version=1 WHERE tenant_id=:t AND id=:d"),
                params,
            )
            conn.execute(
                text(
                    "UPDATE cf_proposals SET status='published' WHERE tenant_id=:t AND domain_id=:d AND id=:p"
                ),
                params,
            )
        diagnostic = client.get(
            f"/v1/domains/{domains[1]}/graph-import-attempts", headers=self.headers()
        ).json()
        body = {"expected_published_version": 1, "expected_projection_digest": diagnostic["digest"]}
        gateway["mode"] = "incomplete"
        initial = self.command(client, domains[1], "graph-import", "graph.import_published", body)
        assert initial["outcome"] == "unresolved", initial
        retry = {
            **body,
            "expected_attempt_id": initial["attempt"]["id"],
            "expected_generation": 1,
            "idempotency_key": str(uuid4()),
            "reason": "Synthetic restore of durable retry",
        }
        gateway["mode"] = "healthy"
        registered = self.command(
            client, domains[1], "graph-import-attempts", "graph.retry_import", retry
        )
        assert registered["outcome"] == "registered" and registered["attempt"]["generation"] == 2
        return {"domain": domains[0], "import_domain": domains[1], "retry": retry}

    def verify_runtime(self, client, seeded, gateway):
        assert client.get("/ready").status_code == 200
        d = seeded["domain"]
        owner = client.get(f"/v1/domains/{d}/concepts", headers=self.headers())
        viewer = client.get(f"/v1/domains/{d}/concepts", headers=self.headers("bob"))
        assert owner.status_code == viewer.status_code == 200
        assert len(owner.json()) == 2 and len(viewer.json()) == 1
        assert viewer.json()[0]["title"] == "Public version two" and viewer.json()[0]["links"] == []
        version = client.get(f"/v1/domains/{d}/version", headers=self.headers()).json()
        assert version["published_version"] == 2
        response = client.post(
            f"/v1/domains/{d}/query",
            headers=self.headers("bob"),
            json={"question": "Public synthetic restore proof", "max_chars": 4000, "limit": 5},
        )
        assert response.status_code == 200, response.text
        answer = response.json()
        assert answer["citations"] and "Private" not in answer["answer"]
        count = len(gateway["posts"])
        receipt = self.command(
            client,
            seeded["import_domain"],
            "graph-import-attempts",
            "graph.retry_import",
            seeded["retry"],
        )
        assert receipt["outcome"] == "registered" and receipt["attempt"]["generation"] == 2
        assert len(gateway["posts"]) == count
        history = client.get(
            f"/v1/domains/{seeded['import_domain']}/graph-import-attempts", headers=self.headers()
        ).json()
        assert len(history["items"]) == 2 and history["items"][0]["status"] == "superseded"
        return {
            "owner_concepts": len(owner.json()),
            "viewer_concepts": len(viewer.json()),
            "citations": len(answer["citations"]),
            "import_generation": 2,
        }


def file_hashes(directory):
    return {
        str(p.relative_to(directory)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(directory.rglob("*"))
        if p.is_file()
    }


def normalized_commits(value):
    result = {}
    for database, entry in value.items():
        result[database] = {
            **entry,
            "instance": sorted(entry["instance"], key=lambda x: x["@id"]),
            "schema": sorted(entry["schema"], key=lambda x: x.get("@id", "")),
        }
    return result


def verify_bundle(path, expected):
    if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        raise ValueError("Backup integrity check failed before engine import")


def archive_store(source, archive):
    for path in source.rglob("*"):
        if path.is_symlink() or not (path.is_file() or path.is_dir()):
            raise ValueError("Store backup only accepts regular files and directories")
    with tarfile.open(archive, "w:gz") as package:
        package.add(source, arcname=".")


def extract_store(archive, target):
    if any(target.iterdir()):
        raise ValueError("Restore target must be a newly created empty directory")
    with tarfile.open(archive, "r:gz") as package:
        package.extractall(target, filter="data")


def qualify(binary, report, strategy="cold_store"):
    report.update(
        {
            "status": "running",
            "strategy": strategy,
            "model_calls": 0,
            "checks": [],
            "limitations": [
                "Synthetic cold backup only; no production RPO/RTO or scale claim",
                (
                    "Application ACL and receipts come from PostgreSQL; the full store includes Terminus identities and orphan databases"
                    if strategy == "cold_store"
                    else "Application ACL come from PostgreSQL; bundle target identities are recreated and orphan databases excluded"
                ),
                "No SQL COMMIT acknowledgement-loss simulation",
                "Bundle integrity rejection is a protocol check, not an intrinsic engine guarantee",
            ],
        }
    )
    with tempfile.TemporaryDirectory(prefix="cortex-restore-qualification-") as temporary:
        directory = Path(temporary)
        containers = Containers(directory)
        admin = target_admin = None
        gateways = []
        try:
            report["phase"] = "create_synthetic_sources"
            source_store = directory / "source-store"
            source_store.mkdir()
            bundles = directory / "bundles"
            bundles.mkdir()
            source_pg, pg_port = containers.start(
                "source-pg",
                PG_IMAGE,
                5432,
                variables=["POSTGRES_PASSWORD=" + PASSWORD, "POSTGRES_DB=" + DATABASE],
            )
            admin = wait_postgres(pg_port)
            with admin.begin() as conn:
                conn.execute(
                    text(
                        "CREATE ROLE cortex_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'synthetic-restore-password'"
                    )
                )
            process(
                [str(ROOT / ".venv/bin/alembic"), "upgrade", "head"],
                env={
                    **os.environ,
                    "CORTEX_MIGRATION_DATABASE_URL": admin.url.render_as_string(
                        hide_password=False
                    ),
                },
            )
            source_engine, engine_port = containers.start(
                "source-engine",
                ENGINE_IMAGE,
                6363,
                mounts=[(source_store, STORE)],
                variables=["TERMINUSDB_ADMIN_PASS=" + PASSWORD],
            )
            source_url, info = wait_engine(engine_port)
            report["engine_info"] = info
            assert "12.0.7" in json.dumps(info), "Unexpected engine release"
            with admin.connect() as conn:
                report["postgres_version"] = conn.execute(text("SHOW server_version")).scalar_one()
            assert report["postgres_version"].startswith("17.11"), "Unexpected PostgreSQL release"
            report["images"] = {
                image: json.loads(process(["docker", "image", "inspect", image]))[0]["Id"]
                for image in [ENGINE_IMAGE, PG_IMAGE]
            }
            private = fixture_keys(directory)
            fixture = Fixture(str(uuid4()), private)

            def environment(database_port, gateway_port):
                env = {
                    key: value for key, value in os.environ.items() if not key.startswith("CORTEX_")
                }
                env.update(
                    {
                        "CORTEX_RUST_DATABASE_URL": f"postgresql://cortex_app:{PASSWORD}@127.0.0.1:{database_port}/{DATABASE}",
                        "CORTEX_JWT_PUBLIC_KEY_FILE": str(directory / "identity.pem"),
                        "CORTEX_JWT_ISSUER": "https://identity.test",
                        "CORTEX_JWT_AUDIENCE": "cortex-core",
                        "CORTEX_CONFIRMATION_PUBLIC_KEY_FILE": str(directory / "confirmation.pem"),
                        "CORTEX_RUST_BIND": "127.0.0.1:0",
                        "CORTEX_TERMINUS_URL": f"http://127.0.0.1:{gateway_port}",
                        "CORTEX_TERMINUS_USER": "admin",
                        "CORTEX_TERMINUS_PASSWORD": PASSWORD,
                        "CORTEX_SYNTHESIS_ENABLED": "false",
                    }
                )
                return env

            gateway, gateway_state = start_graph(source_url)
            gateways.append(gateway)
            with native_client(binary, environment(pg_port, gateway.server_port)) as client:
                seeded = fixture.seed(client, admin, gateway_state)
                report["source_runtime"] = fixture.verify_runtime(client, seeded, gateway_state)
            gateway.shutdown()
            gateway.server_close()
            gateways.remove(gateway)
            report["phase"] = "capture_quiescent_sources"
            source_state = sql_state(admin)
            manifests = source_state["cf_graph_manifests"]
            assert len(manifests) == 3, manifests
            original_commits = normalized_commits(read_commits(source_url, manifests))
            report["manifest_count"] = len(manifests)
            report["manifests"] = manifests
            # All application producers have exited; source SQL and engine are quiescent.
            dump = directory / "postgres.dump"
            dump.write_bytes(
                process(
                    [
                        "docker",
                        "exec",
                        source_pg,
                        "pg_dump",
                        "-U",
                        "postgres",
                        "--format=custom",
                        DATABASE,
                    ]
                )
            )
            report["sql_dump_sha256"] = hashlib.sha256(dump.read_bytes()).hexdigest()
            process(["docker", "stop", "--time", "30", source_engine])
            stopped = json.loads(process(["docker", "inspect", source_engine]))[0]["State"]
            assert (
                not stopped["Running"]
                and stopped["ExitCode"] in (0, 143)
                and not stopped["OOMKilled"]
                and not stopped["Error"]
            ), "Engine did not stop cleanly"
            report["source_stop"] = {
                key: stopped[key] for key in ("Running", "ExitCode", "OOMKilled", "Error")
            }
            before_source = file_hashes(source_store)
            report["phase"] = "export_copied_offline_store"
            export_store = directory / "export-store"
            shutil.copytree(source_store, export_store)
            assert source_store.resolve() != export_store.resolve()
            if strategy == "bundle_experiment":
                for manifest in manifests:
                    database = manifest["snapshot"]["database"]
                    assert database.startswith("cf_snapshot_") and len(database) == 44
                    containers.cli(
                        export_store,
                        bundles,
                        "bundle",
                        "admin/" + database,
                        "--output",
                        "/backup/" + database + ".bundle",
                    )
            else:
                archive_store(export_store, bundles / "terminus-store.tar.gz")
                report["store_file_count"] = len(before_source)
                report["includes_system_and_orphan_databases"] = True
            report["backup_sha256"] = file_hashes(bundles)
            assert len(report["backup_sha256"]) == (3 if strategy == "bundle_experiment" else 1)
            assert file_hashes(source_store) == before_source, (
                "Export touched original source store"
            )
            assert sql_state(admin) == source_state, "Source SQL changed during export"
            report["checks"].append(
                "quiescent_sql_dump_and_independent_full_store_archive"
                if strategy == "cold_store"
                else "experimental_cli_bundles_from_independent_store_copy"
            )

            report["phase"] = "restore_postgres"
            target_pg, target_port = containers.start(
                "target-pg",
                PG_IMAGE,
                5432,
                variables=["POSTGRES_PASSWORD=" + PASSWORD, "POSTGRES_DB=" + DATABASE],
            )
            target_admin = wait_postgres(target_port)
            with target_admin.begin() as conn:
                conn.execute(
                    text(
                        "CREATE ROLE cortex_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'synthetic-restore-password'"
                    )
                )
            process(["docker", "cp", str(dump), target_pg + ":/tmp/restore.dump"])
            process(
                [
                    "docker",
                    "exec",
                    target_pg,
                    "pg_restore",
                    "--exit-on-error",
                    "-U",
                    "postgres",
                    "--dbname",
                    DATABASE,
                    "/tmp/restore.dump",
                ]
            )
            assert sql_state(target_admin) == source_state, (
                "SQL identity or content changed during restore"
            )
            with target_admin.connect() as conn:
                role = conn.execute(
                    text("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='cortex_app'")
                ).one()
                assert tuple(role) == (False, False)
                assert (
                    conn.execute(
                        text(
                            "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tableowner='cortex_app'"
                        )
                    ).scalar_one()
                    == 0
                )
                assert (
                    conn.execute(
                        text(
                            "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'cf_%' AND c.relkind='r' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)"
                        )
                    ).scalar_one()
                    == 0
                )
            report["checks"].append(
                "new_postgres_restores_all_rows_immutable_ids_rls_and_restricted_role"
            )

            def restore_store(name, included):
                store = directory / name
                store.mkdir()
                if strategy == "cold_store":
                    filename = "terminus-store.tar.gz"
                    verify_bundle(bundles / filename, report["backup_sha256"][filename])
                    extract_store(bundles / filename, store)
                    assert file_hashes(store) == before_source, (
                        "Restored physical files differ before startup"
                    )
                    # Remove only a known synthetic database from an independent negative-test copy.
                    # Never infer which shared physical layers belong to one database.
                    for manifest in manifests:
                        if manifest not in included:
                            containers.cli(
                                store,
                                bundles,
                                "db",
                                "delete",
                                "admin/" + manifest["snapshot"]["database"],
                            )
                else:
                    containers.cli(store, bundles, "store", "init", "--key", PASSWORD)
                    for manifest in included:
                        database = manifest["snapshot"]["database"]
                        filename = database + ".bundle"
                        verify_bundle(bundles / filename, report["backup_sha256"][filename])
                        containers.cli(
                            store,
                            bundles,
                            "db",
                            "create",
                            "admin/" + database,
                            "--label",
                            "Synthetic restore",
                        )
                        containers.cli(
                            store, bundles, "unbundle", "admin/" + database, "/backup/" + filename
                        )
                return store

            report["phase"] = "restore_terminus_offline"
            target_store = restore_store("target-store", manifests)
            _, target_engine_port = containers.start(
                "target-engine",
                ENGINE_IMAGE,
                6363,
                mounts=[(target_store, STORE)],
                variables=["TERMINUSDB_ADMIN_PASS=synthetic-new-env-not-a-rotation"],
            )
            target_url, _ = wait_engine(target_engine_port)
            with httpx.Client(
                auth=("admin", "synthetic-new-env-not-a-rotation"), trust_env=False, timeout=5
            ) as invalid_identity:
                assert invalid_identity.get(target_url + "/api/info").status_code == 401
            report["checks"].append(
                "restored_store_keeps_original_admin_identity_despite_new_environment_value"
            )
            report["phase"] = "verify_original_commits_and_runtime"
            assert normalized_commits(read_commits(target_url, manifests)) == original_commits
            report["checks"].append(
                "all_original_commit_ids_instance_and_schema_survive_fresh_engine_restore"
            )
            gateway, target_requests = start_graph(target_url)
            gateways.append(gateway)
            with native_client(binary, environment(target_port, gateway.server_port)) as client:
                report["target_runtime"] = fixture.verify_runtime(client, seeded, target_requests)
            gateway.shutdown()
            gateway.server_close()
            gateways.remove(gateway)
            assert report["target_runtime"] == report["source_runtime"]
            report["checks"].append(
                "restored_rust_readiness_acl_hidden_links_citations_and_idempotent_retry_without_post"
            )
            # Database triggers remain effective after logical restoration.
            from sqlalchemy.exc import DBAPIError

            try:
                with target_admin.begin() as conn:
                    conn.execute(
                        text("UPDATE cf_domains SET graph_protocol=1 WHERE tenant_id=:t AND id=:d"),
                        {"t": fixture.tenant, "d": seeded["domain"]},
                    )
            except DBAPIError as error:
                assert error.orig.args[0]["C"] == "23514"
            else:
                raise AssertionError("Restored graph protocol could be downgraded")
            report["checks"].append("restored_sql_graph_protocol_trigger_rejects_downgrade")

            report["phase"] = "negative_restore_checks"
            missing = next(
                m for m in manifests if m["domain_id"] == seeded["domain"] and m["version"] == 2
            )
            partial_store = restore_store("partial-store", [m for m in manifests if m != missing])
            _, partial_port = containers.start(
                "partial-engine",
                ENGINE_IMAGE,
                6363,
                mounts=[(partial_store, STORE)],
                variables=["TERMINUSDB_ADMIN_PASS=" + PASSWORD],
            )
            partial_url, _ = wait_engine(partial_port)
            gateway, partial_requests = start_graph(partial_url)
            gateways.append(gateway)
            with native_client(binary, environment(target_port, gateway.server_port)) as client:
                assert client.get("/ready").status_code == 200
                response = client.get(
                    f"/v1/domains/{seeded['domain']}/concepts", headers=fixture.headers()
                )
                assert response.status_code == 503, response.text
                assert (
                    client.get(
                        f"/v1/domains/{seeded['import_domain']}/concepts", headers=fixture.headers()
                    ).status_code
                    == 200
                )
                assert not partial_requests["posts"]
            report["checks"].append(
                "missing_current_graph_fails_closed_without_sql_projection_fallback"
            )
            filename, expected = next(iter(report["backup_sha256"].items()))
            corrupted = directory / "corrupted.bundle"
            corrupted.write_bytes((bundles / filename).read_bytes() + b"synthetic corruption")
            try:
                verify_bundle(corrupted, expected)
            except ValueError:
                pass
            else:
                raise AssertionError("Corrupted bundle passed the backup integrity check")
            report["checks"].append("corrupted_backup_rejected_by_checksum_before_import")
            report["status"] = "passed"
            report["phase"] = "complete"
        finally:
            for gateway in gateways:
                gateway.shutdown()
                gateway.server_close()
            if admin is not None:
                admin.dispose()
            if target_admin is not None:
                target_admin.dispose()
            containers.cleanup()
            # Container-created nested files are confined to this process's temporary directory.
            try:
                containers.one_shot(
                    PG_IMAGE,
                    [(directory, "/cleanup")],
                    ["chown", "-R", f"{os.getuid()}:{os.getgid()}", "/cleanup"],
                )
            finally:
                containers.cleanup()

    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--synthetic-only", action="store_true", required=True)
    parser.add_argument(
        "--strategy", choices=["cold_store", "bundle_experiment"], default="cold_store"
    )
    parser.add_argument("--binary", type=Path, default=ROOT / "target/debug/cortex-rust-core")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = {}
    try:
        qualify(args.binary, result, args.strategy)
    except Exception as error:
        result.update(
            {"status": "failed", "error": str(error).replace(PASSWORD, "[synthetic credential]")}
        )
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
        raise
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print("Synthetic coordinated restore qualification passed")


if __name__ == "__main__":
    main()
