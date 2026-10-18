"""Resumable governed publication of the frozen, synthetic-only Step 1 workloads.

Run with python -m scripts.brain_scale_fixture and the dedicated test environment.
No private corpus, provider call, direct knowledge insert, or container deletion.
"""

import argparse
import fcntl
import hashlib
import json
import os
import selectors
import shutil
import signal
import subprocess
import time
from contextlib import contextmanager
from pathlib import Path
from uuid import UUID, uuid4

import httpx
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from scripts.brain_scale_workload import ROOT, SEED, workload
from scripts.ingest_okf import REVIEW_BYTES, private_path, review_size, save
from scripts.prepare_okf_ingestion import canonical, digest

REASON = "Qualification Step 1 : jeu synthétique déterministe, preuves exactes et liens explicites"
SUBJECTS = ["alice", "reader"]


def concept(record, source_id):
    UUID(source_id)
    return {
        **{key: record[key] for key in ("concept_id", "title", "body", "maturity", "links")},
        "sources": [{"source_id": source_id, "start": 0, "end": len(record["body"])}],
    }


def plan(records):
    """Keep the first cohort together, and reject any unsatisfied dependency."""
    batches, current, payloads = [], [], []
    for record in records:
        candidate = concept(record, str(UUID(int=0)))
        if review_size([candidate], REASON) > REVIEW_BYTES:
            raise ValueError("Single record exceeds the frozen request budget")
        if current and (
            record["domain_id"] != current[0]["domain_id"]
            or len(current) == 50
            or review_size([*payloads, candidate], REASON) > REVIEW_BYTES
        ):
            batches.append(current)
            current, payloads = [], []
        current.append(record)
        payloads.append(candidate)
    if current:
        batches.append(current)
    published, seen = {}, set()
    for batch in batches:
        domain = batch[0]["domain_id"]
        ids = {r["concept_id"] for r in batch}
        if len(ids) != len(batch) or ids & seen:
            raise ValueError("Duplicate concept identity")
        available = published.setdefault(domain, set()) | ids
        if any(link["target_id"] not in available for r in batch for link in r["links"]):
            raise ValueError("Batch requires an unpublished or cross-domain target")
        published[domain].update(ids)
        seen.update(ids)
    return batches


def read_manifest(path):
    raw = private_path(path).read_bytes()
    manifest = json.loads(raw)
    # Validation against the frozen generator prevents a private/arbitrary
    # manifest being passed to the synthetic automatic reviewer.
    if manifest.get("seed") != SEED or manifest != json.loads(
        json.dumps(workload(manifest.get("case")))
    ):
        raise ValueError("Only an exact frozen synthetic workload can be published")
    return manifest, hashlib.sha256(raw).hexdigest()


class Signer:
    def __init__(self, directory, state):
        self.tenant = state["tenant"]
        self.keys = {
            name: serialization.load_pem_private_key(
                (directory / f"{name}-private.pem").read_bytes(), password=None
            )
            for name in ("identity", "confirmation")
        }

    def headers(self, subject="alice", lifetime=300):
        now = int(time.time())
        token = jwt.encode(
            {
                "iss": "https://identity.test",
                "aud": "cortex-core",
                "sub": subject,
                "tenant": self.tenant,
                "iat": now,
                "exp": now + lifetime,
            },
            self.keys["identity"],
            algorithm="RS256",
        )
        return {"Authorization": "Bearer " + token, "X-Tenant-ID": self.tenant}

    def signed(self, action, arguments):
        now = int(time.time())
        proof = jwt.encode(
            {
                "iss": "cortex-trusted-host",
                "aud": "cortex-mcp-confirmation",
                "sub": "alice",
                "tenant": self.tenant,
                "action": action,
                "command_hash": digest(canonical({"action": action, "arguments": arguments})),
                "jti": str(uuid4()),
                "iat": now,
                "exp": now + 120,
            },
            self.keys["confirmation"],
            algorithm="RS256",
        )
        return {**self.headers(), "X-Cortex-Confirmation": proof}


def request(client, signer, method, path, body=None, *, action=None, arguments=None):
    headers = signer.signed(action, arguments) if action else signer.headers()
    response = client.request(method, path, headers=headers, json=body)
    if response.is_error:
        # No response body or token in logs, even if this script is misconfigured.
        raise RuntimeError(f"Synthetic {method} {path}: HTTP {response.status_code}")
    return response.json()


def publish_batch(client, signer, state, index, records, checkpoint, check_stop):
    domain = records[0]["domain_id"]
    root = f"/v1/domains/{domain}"
    key = str(index)
    batch = state["batches"].get(key)
    if batch and batch["status"] == "published":
        return batch
    for record in records:
        check_stop()
        if record["source_key"] in state["sources"]:
            continue
        receipt = request(
            client,
            signer,
            "POST",
            root + "/sources",
            {
                "title": record["title"],
                "location": record["location"],
                "content": record["body"],
                "allowed_subjects": SUBJECTS,
            },
        )
        if (
            receipt["content_hash"] != record["body_sha256"]
            or receipt["location"] != record["location"]
            or set(receipt["allowed_subjects"]) != set(SUBJECTS)
        ):
            raise ValueError("Synthetic source receipt differs")
        UUID(receipt["id"])
        state["sources"][record["source_key"]] = receipt["id"]
    # A lost source response/checkpoint is replayed through native content+URI
    # idempotency. Store the actual source IDs before creating any proposal.
    checkpoint()
    concepts = [concept(r, state["sources"][r["source_key"]]) for r in records]
    payload_hash = digest(canonical(concepts))
    if review_size(concepts, REASON) > REVIEW_BYTES:
        raise ValueError("Actual source identities exceeded the request budget")
    if batch is None:
        version = request(client, signer, "GET", root + "/version")
        expected = sum(
            b["domain"] == domain and b["status"] == "published" for b in state["batches"].values()
        )
        if version["accepted_version"] != expected or version["published_version"] != expected:
            raise ValueError("Unexpected domain history; reconcile without overwriting")
        batch = {
            "domain": domain,
            "base_version": expected,
            "payload_sha256": payload_hash,
            "status": "prepared",
            "concepts": len(records),
        }
        state["batches"][key] = batch
        checkpoint()
    if batch["payload_sha256"] != payload_hash:
        raise ValueError("A prepared batch changed")
    base = batch["base_version"]
    idempotency = "scale-" + digest(state["manifest_sha256"] + ":" + key)
    if batch["status"] == "prepared":
        check_stop()
        proposal = request(
            client,
            signer,
            "POST",
            root + "/proposals",
            {
                "base_version": base,
                "changes": [{"kind": "put_concept", "concept": c} for c in concepts],
                "reason": REASON,
                "idempotency_key": idempotency,
            },
        )
        batch.update(status="proposed", proposal_id=proposal["id"], digest=proposal["digest"])
        checkpoint()
    proposal_id = batch["proposal_id"]
    if batch["status"] == "proposed":
        check_stop()
        body = {
            "digest": batch["digest"],
            "expected_version": base,
            "expected_review_revision": 0,
            "reason": REASON,
            "idempotency_key": idempotency + "-approve",
        }
        request(
            client,
            signer,
            "POST",
            f"{root}/proposals/{proposal_id}/approve",
            body,
            action="proposals.approve",
            arguments={"path": {"domain": domain, "proposal_id": proposal_id}, "body": body},
        )
        batch["status"] = "approved"
        checkpoint()
    if batch["status"] == "approved":
        check_stop()
        body = {"expected_published_version": base}
        receipt = request(
            client,
            signer,
            "POST",
            f"{root}/proposals/{proposal_id}/publish",
            body,
            action="proposals.publish",
            arguments={"path": {"domain": domain, "proposal_id": proposal_id}, "body": body},
        )
        version = request(client, signer, "GET", root + "/version")
        if version["accepted_version"] != base + 1 or version["published_version"] != base + 1:
            raise ValueError("Published version differs")
        batch.update(status="published", receipt=receipt, published_version=base + 1)
        checkpoint()
    return batch


def test_environment():
    urls = [make_url(os.environ[k]) for k in ("CORTEX_TEST_ADMIN_URL", "CORTEX_RUST_DATABASE_URL")]
    if (
        not all(u.host == "127.0.0.1" and (u.database or "").endswith("_test") for u in urls)
        or (urls[0].port, urls[0].database) != (urls[1].port, urls[1].database)
        or os.environ["CORTEX_TERMINUS_URL"] != "http://127.0.0.1:6363"
    ):
        raise ValueError("Dedicated synthetic loopback stores are required")


def initialize(directory, manifest, manifest_hash):
    path = directory / "state.json"
    if path.exists():
        state = json.loads(path.read_text())
        if not state.get("synthetic_only") or state["manifest_sha256"] != manifest_hash:
            raise ValueError("Existing fixture does not match the frozen manifest")
        return state
    for name in ("identity", "confirmation"):
        if (directory / f"{name}-private.pem").exists():
            raise ValueError("Partial key setup: preserve and inspect before retry")
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        for suffix, content in [
            (
                "-private",
                key.private_bytes(
                    serialization.Encoding.PEM,
                    serialization.PrivateFormat.PKCS8,
                    serialization.NoEncryption(),
                ),
            ),
            (
                "",
                key.public_key().public_bytes(
                    serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
                ),
            ),
        ]:
            target = directory / f"{name}{suffix}.pem"
            with target.open("xb") as stream:
                target.chmod(0o600)
                stream.write(content)
    state = {
        "synthetic_only": True,
        "tenant": str(uuid4()),
        "case": manifest["case"],
        "manifest_sha256": manifest_hash,
        "domains": manifest["domains"],
        "sources": {},
        "batches": {},
        "provisioned": False,
    }
    save(path, state)
    return state


def provision(directory, state):
    if state["provisioned"]:
        return
    db = create_engine(os.environ["CORTEX_TEST_ADMIN_URL"])
    with db.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO cf_tenants(id,name) VALUES(:t,'Synthetic Step 1') ON CONFLICT DO NOTHING"
            ),
            {"t": state["tenant"]},
        )
        for domain in state["domains"]:
            values = {"t": state["tenant"], "d": domain["id"], "n": domain["name"]}
            conn.execute(
                text(
                    "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,:n) ON CONFLICT DO NOTHING"
                ),
                values,
            )
            conn.execute(
                text(
                    "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,'alice','owner'),(:t,:d,'reader','viewer') ON CONFLICT DO NOTHING"
                ),
                values,
            )
    db.dispose()
    state["provisioned"] = True
    save(directory / "state.json", state)


@contextmanager
def server(directory, port, profile="debug"):
    if profile not in {"debug", "release"}:
        raise ValueError("Unknown local build profile")
    env = {k: v for k, v in os.environ.items() if not k.startswith(("CORTEX_", "OPENROUTER_"))}
    env.update(
        {
            k: os.environ[k]
            for k in (
                "CORTEX_RUST_DATABASE_URL",
                "CORTEX_TERMINUS_URL",
                "CORTEX_TERMINUS_USER",
                "CORTEX_TERMINUS_PASSWORD",
            )
        }
    )
    env.update(
        {
            "CORTEX_JWT_PUBLIC_KEY_FILE": str(directory / "identity.pem"),
            "CORTEX_CONFIRMATION_PUBLIC_KEY_FILE": str(directory / "confirmation.pem"),
            "CORTEX_JWT_ISSUER": "https://identity.test",
            "CORTEX_JWT_AUDIENCE": "cortex-core",
            "CORTEX_RUST_BIND": f"127.0.0.1:{port}",
            "CORTEX_CORS_ORIGINS": '["http://127.0.0.1:5174","http://127.0.0.1:5181"]',
        }
    )
    process = subprocess.Popen(
        [str(ROOT / f"target/{profile}/cortex-rust-core")],
        env=env,
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            if not selector.select(15):
                raise RuntimeError("Synthetic server failed to start")
            if "listening on 127.0.0.1:" not in process.stdout.readline():
                raise RuntimeError("Synthetic server readiness missing")
        yield process
    finally:
        process.terminate()
        try:
            process.wait(5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--port", type=int, default=8011, choices=[8011, 8012])
    parser.add_argument("--max-batches", type=int, default=1000)
    parser.add_argument("--duration", type=int, default=1800)
    parser.add_argument("--serve-only", action="store_true")
    parser.add_argument("--profile", choices=["debug", "release"], default="debug")
    args = parser.parse_args()
    if args.duration <= 0 or args.duration > 6 * 3600 or args.max_batches < 0:
        raise ValueError("Choose a bounded positive duration and batch budget")
    test_environment()
    manifest, manifest_hash = read_manifest(args.manifest)
    batches = plan(manifest["records"])
    directory = private_path(args.directory)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    stopped = False
    from scripts.qualification_clock import Deadline

    deadline = Deadline(args.duration)

    def shutdown(*_):
        nonlocal stopped
        stopped = True

    def check_stop():
        if stopped or deadline.expired():
            raise InterruptedError("Synthetic preparation stopped with receipts preserved")
        if shutil.disk_usage(directory).free < 10 * 1024**3:
            raise InterruptedError("Frozen free-disk floor reached; receipts preserved")

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    with (directory / "writer.lock").open("a") as lock:
        (directory / "writer.lock").chmod(0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = initialize(directory, manifest, manifest_hash)
        provision(directory, state)
        signer = Signer(directory, state)
        state.update(base_url=f"http://127.0.0.1:{args.port}", expires_at=deadline.wall_end)

        def checkpoint():
            save(directory / "state.json", state)

        state["binary_profile"] = args.profile
        state["binary_sha256"] = hashlib.sha256(
            (ROOT / f"target/{args.profile}/cortex-rust-core").read_bytes()
        ).hexdigest()
        checkpoint()
        with (
            server(directory, args.port, args.profile) as process,
            httpx.Client(base_url=state["base_url"], timeout=120, trust_env=False) as client,
        ):
            state["server_pid"] = process.pid
            checkpoint()
            print(
                json.dumps(
                    {
                        "ready": True,
                        "case": state["case"],
                        "batches": len(batches),
                        "pid": process.pid,
                    }
                ),
                flush=True,
            )
            try:
                remaining = args.max_batches
                if not args.serve_only:
                    for index, records in enumerate(batches):
                        if state["batches"].get(str(index), {}).get("status") == "published":
                            continue
                        if remaining == 0:
                            break
                        check_stop()
                        started = time.monotonic()
                        batch = publish_batch(
                            client, signer, state, index, records, checkpoint, check_stop
                        )
                        remaining -= 1
                        print(
                            json.dumps(
                                {
                                    "case": state["case"],
                                    "batch": index + 1,
                                    "version": batch["published_version"],
                                    "published_concepts": sum(
                                        b["concepts"]
                                        for b in state["batches"].values()
                                        if b["status"] == "published"
                                    ),
                                    "setup_seconds": round(time.monotonic() - started, 3),
                                }
                            ),
                            flush=True,
                        )
                while not stopped and not deadline.expired():
                    time.sleep(0.25)
            except InterruptedError as error:
                print(str(error), flush=True)
            finally:
                state["expires_at"] = time.time()
                checkpoint()


if __name__ == "__main__":
    main()
