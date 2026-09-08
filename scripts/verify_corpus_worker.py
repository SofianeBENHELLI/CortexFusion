"""Bounded native corpus client against the real Rust API and isolated SQL tenants."""

import base64
import concurrent.futures
import json
import os
import selectors
import signal
import subprocess
import tempfile
import time
from pathlib import Path
from uuid import uuid4

from sqlalchemy import text


def worker_environment(base_url, tenant, domain, token_file, **settings):
    return {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "CORTEX_WORKER_API_URL": str(base_url),
        "CORTEX_WORKER_TENANT": tenant,
        "CORTEX_WORKER_DOMAIN": domain,
        "CORTEX_WORKER_SUBJECT": "alice",
        "CORTEX_WORKER_BEARER_FILE": str(token_file),
        "CORTEX_WORKER_POLL_SECONDS": "1",
        "CORTEX_WORKER_PAGE_SIZE": "1",
        "CORTEX_WORKER_MAX_CYCLES": "6",
        "CORTEX_WORKER_MAX_RUN_SECONDS": "30",
        **settings,
    }


def run_worker(binary, env):
    result = subprocess.run(
        [str(binary.resolve())], env=env, capture_output=True, text=True, timeout=45
    )
    assert result.returncode == 0, (result.returncode, result.stderr)
    rows = [json.loads(line) for line in result.stdout.splitlines()]
    assert rows and rows[-1]["event"] == "stopped", rows
    return rows


def verify_corpus_worker(client, headers, admin, server_binary):
    binary = server_binary.with_name("cortex-corpus-worker")
    assert binary.exists(), "Build the native corpus worker with cargo build --workspace --locked"
    tenant, domain = str(uuid4()), str(uuid4())
    with admin.begin() as conn:
        conn.execute(
            text("INSERT INTO cf_tenants(id,name) VALUES(:t,'Worker synthetic')"), {"t": tenant}
        )
        conn.execute(
            text("INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'Worker synthetic')"),
            {"t": tenant, "d": domain},
        )
        conn.execute(
            text(
                "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,'alice','owner'),(:t,:d,'bob','corpus_manager'),(:t,:d,'viewer','viewer')"
            ),
            {"t": tenant, "d": domain},
        )

    def h(subject="alice"):
        return {**headers(sub=subject), "X-Tenant-ID": tenant}

    def collection(subject):
        response = client.post(
            f"/v1/domains/{domain}/collections",
            headers=h(subject),
            json={
                "name": "Worker " + subject,
                "allowed_subjects": [subject],
                "idempotency_key": str(uuid4()),
            },
        )
        assert response.status_code == 201, response.text
        return response.json()["id"]

    own, foreign = collection("alice"), collection("bob")

    def upload(filename, content, subject="alice", collection_id=own):
        response = client.post(
            f"/v1/domains/{domain}/collections/{collection_id}/files",
            headers=h(subject),
            json={
                "filename": filename,
                "content_base64": base64.b64encode(content).decode(),
                "allowed_subjects": [subject],
                "idempotency_key": str(uuid4()),
            },
        )
        assert response.status_code == 202, response.text
        return response.json()["id"]

    def receipt(kind, ident, subject="alice"):
        response = client.get(f"/v1/domains/{domain}/{kind}/{ident}", headers=h(subject))
        assert response.status_code == 200, response.text
        return response.json()

    with tempfile.TemporaryDirectory(prefix="cortex-worker-") as temporary:
        token_file = Path(temporary) / "bearer"
        token_file.write_text(h()["Authorization"].removeprefix("Bearer "))
        token_file.chmod(0o600)
        env = worker_environment(client.base_url, tenant, domain, token_file)
        files = [
            upload(f"worker-{i}.txt", f"Synthetic worker proof {i}.".encode()) for i in range(3)
        ]
        invalid = upload("broken.pdf", b"This is not a PDF")
        hidden = upload(
            "private.txt", b"Bob private worker proof", subject="bob", collection_id=foreign
        )
        imports = []
        for subject, cid in [("alice", own), ("bob", foreign)]:
            response = client.post(
                f"/v1/domains/{domain}/collections/{cid}/imports",
                headers=h(subject),
                json={
                    "idempotency_key": str(uuid4()),
                    "items": [
                        {
                            "filename": "good.txt",
                            "content": "Synthetic text worker proof.",
                            "allowed_subjects": [subject],
                        },
                        {
                            "filename": "invalid.bin",
                            "content": "Unsupported synthetic format.",
                            "allowed_subjects": [subject],
                        },
                    ],
                },
            )
            assert response.status_code == 202, response.text
            imports.append(response.json()["id"])
        events = run_worker(binary, env)
        assert all(receipt("files", ident)["status"] == "succeeded" for ident in files)
        assert receipt("files", invalid)["status"] == "failed"
        imported = receipt("imports", imports[0])
        assert imported["status"] == "partial" and {i["status"] for i in imported["items"]} == {
            "succeeded",
            "failed",
        }
        assert receipt("files", hidden, "bob")["status"] == "pending"
        assert receipt("imports", imports[1], "bob")["status"] == "pending"
        failed_attempts = receipt("files", invalid)["attempts"]
        assert events[-1]["actions"] == 5, events
        run_worker(binary, {**env, "CORTEX_WORKER_MAX_CYCLES": "2"})
        assert receipt("files", invalid)["attempts"] == failed_attempts
        assert [i["attempts"] for i in receipt("imports", imports[0])["items"]] == [1, 1]
        checks = ["worker_native_files_text_imports_private_scope_pagination_and_no_failed_retry"]
        limited = [upload(f"limit-{i}.txt", f"Limit proof {i}".encode()) for i in range(2)]
        events = run_worker(binary, {**env, "CORTEX_WORKER_MAX_ACTIONS": "1"})
        assert events[-1]["actions"] == 1
        assert sorted(receipt("files", ident)["status"] for ident in limited) == [
            "pending",
            "succeeded",
        ]
        checks.append("worker_total_action_limit_stops_before_second_post")
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futures = [
                pool.submit(run_worker, binary, {**env, "CORTEX_WORKER_MAX_CYCLES": "2"})
                for _ in range(2)
            ]
            for future in futures:
                future.result()
        assert all(
            receipt("files", ident)["status"] == "succeeded"
            and receipt("files", ident)["attempts"] == 1
            for ident in limited
        )
        checks.append("worker_concurrent_clients_preserve_completed_file_receipts")
        # Credential replacement can renew only the expected subject.
        token_file.write_text(h("bob")["Authorization"].removeprefix("Bearer "))
        result = subprocess.run(
            [str(binary.resolve())], env=env, capture_output=True, text=True, timeout=10
        )
        assert result.returncode != 0 and "identity or corpus scope changed" in result.stderr
        assert receipt("files", hidden, "bob")["status"] == "pending"
        token_file.write_text(h()["Authorization"].removeprefix("Bearer "))
        token_file.chmod(0o644)
        result = subprocess.run(
            [str(binary.resolve())], env=env, capture_output=True, text=True, timeout=10
        )
        assert result.returncode != 0 and "private permissions" in result.stderr
        token_file.chmod(0o600)
        checks.append("worker_subject_pin_and_private_credential_file")
        idle = {k: v for k, v in env.items() if k != "CORTEX_WORKER_MAX_CYCLES"}
        idle["CORTEX_WORKER_POLL_SECONDS"] = "20"
        process = subprocess.Popen(
            [str(binary.resolve())],
            env=idle,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                assert selector.select(10), "Worker did not start"
                assert json.loads(process.stdout.readline())["event"] == "started"
            started = time.monotonic()
            process.send_signal(signal.SIGTERM)
            output, error = process.communicate(timeout=5)
            assert process.returncode == 0, error
            assert time.monotonic() - started < 3
            assert json.loads(output.splitlines()[-1])["event"] == "stopped"
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
        checks.append("worker_sigterm_stops_idle_or_current_read_without_more_processing")
    return checks
