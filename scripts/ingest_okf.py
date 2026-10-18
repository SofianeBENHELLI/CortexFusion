"""Resume private OKF source registration and explicitly reviewed publication batches.

No fixture identities, provider calls or external publication. Inputs, state and
receipts stay in .runtime/brain; stdout contains counts and opaque identifiers only.
"""

import argparse
import fcntl
import json
import os
import tempfile
from pathlib import Path

import httpx

from scripts.okf_workspace import BASE_URL, DIRECTORY, ROOT, configuration, headers, signed
from scripts.prepare_okf_ingestion import canonical, concept_payload, digest

REVIEW_BYTES = 1_500_000

CONCEPT_FIELDS = ("concept_id", "title", "body", "maturity", "sources", "links")


def private_path(path):
    result = Path(path).resolve()
    if not result.is_relative_to((ROOT / ".runtime/brain").resolve()):
        raise ValueError("Ingestion data must stay under .runtime/brain")
    return result


def read_manifest(path):
    manifest = json.loads(private_path(path).read_text())
    claimed = manifest.pop("manifest_sha256")
    if manifest.get("schema_version") != 1 or digest(canonical(manifest)) != claimed:
        raise ValueError("Manifest integrity check failed")
    manifest["manifest_sha256"] = claimed
    return manifest


def save(path, value):
    path = private_path(path)
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        stream.write(canonical(value) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def request(client, cfg, method, path, payload=None, *, operation=None, arguments=None):
    auth = signed(cfg, operation, arguments) if operation else headers(cfg)
    response = client.request(method, path, headers=auth, json=payload)
    if response.is_error:
        raise RuntimeError(
            f"Cortex {method} returned HTTP {response.status_code}; receipt retained"
        )
    return response.json()


def register_sources(client, cfg, manifest, selected, state, checkpoint):
    by_id = {c["okf_id"]: c for c in manifest["concepts"]}
    if not selected or len(selected) != len(set(selected)) or set(selected) - set(by_id):
        raise ValueError("Select unique existing OKF records")
    wanted = {span["source_key"] for ident in selected for span in by_id[ident]["sources"]}
    # Register complete source files, including source parts outside a concept's body span.
    wanted.update(s["key"] for s in manifest["sources"] if s["okf_id"] in selected)
    for source in manifest["sources"]:
        if source["key"] not in wanted:
            continue
        if "\x00" in source["content"] or not 1 <= len(source["content"]) <= 200_000:
            raise ValueError("Source content outside the native contract")
        existing = state["sources"].get(source["key"])
        if existing:
            receipt = request(
                client, cfg, "GET", f"/v1/domains/{cfg['domain']}/sources/{existing['id']}"
            )
        else:
            receipt = request(
                client,
                cfg,
                "POST",
                f"/v1/domains/{cfg['domain']}/sources",
                {
                    "title": source["title"],
                    "location": source["location"],
                    "content": source["content"],
                    "allowed_subjects": [cfg["subject"]],
                },
            )
        if receipt["content_hash"] != source["content_sha256"] or receipt["allowed_subjects"] != [
            cfg["subject"]
        ]:
            raise ValueError("Registered source content or privacy differs")
        if receipt["location"] != source["location"]:
            raise ValueError("Registered source origin differs")
        state["sources"][source["key"]] = {
            "id": receipt["id"],
            "content_hash": receipt["content_hash"],
        }
        checkpoint()


def reviewed_payloads(manifest, selection, state):
    if selection.get("manifest_sha256") != manifest["manifest_sha256"]:
        raise ValueError("Review does not identify the current manifest")
    if selection.get("decision") != "publish_verbatim_emerging_without_relations":
        raise ValueError("This increment only supports explicit verbatim concept approval")
    reason = selection.get("reason", "")
    if not isinstance(reason, str) or not 1 <= len(reason) <= 2000:
        raise ValueError("An explicit bounded review reason is required")
    selected = selection["record_ids"]
    if not 1 <= len(selected) <= 50 or len(set(selected)) != len(selected):
        raise ValueError("A review batch must have 1–50 distinct records")
    concepts = [
        concept_payload(manifest, ident, state["sources"], allow_pending_references=True)
        for ident in selected
    ]
    if review_size(concepts, reason) > REVIEW_BYTES:
        raise ValueError("Review batch exceeds the encoded request budget; split the review batch")
    return concepts


def review_size(concepts, reason):
    # Conservative envelope; real base/key fields are shorter. HTTP's existing
    # 2 MiB body guard is unchanged. Do not assume character count equals bytes.
    return len(
        canonical(
            {
                "base_version": 9223372036854775807,
                "changes": [{"kind": "put_concept", "concept": c} for c in concepts],
                "reason": reason,
                "idempotency_key": "x" * 128,
            }
        ).encode("utf-8")
    )


def plan_record_batches(manifest, record_ids, reason):
    if not isinstance(reason, str) or not 1 <= len(reason) <= 2000:
        raise ValueError("An explicit bounded review reason is required")
    if len(record_ids) != len(set(record_ids)):
        raise ValueError("Duplicate planned record")
    receipts = {
        s["key"]: {
            "id": "00000000-0000-0000-0000-000000000000",
            "content_hash": s["content_sha256"],
        }
        for s in manifest["sources"]
    }
    batches, ids, concepts = [], [], []
    for ident in record_ids:
        concept = concept_payload(manifest, ident, receipts, allow_pending_references=True)
        if review_size([concept], reason) > REVIEW_BYTES:
            raise ValueError("Single concept exceeds the encoded request budget")
        if ids and (len(ids) == 50 or review_size([*concepts, concept], reason) > REVIEW_BYTES):
            batches.append(ids)
            ids, concepts = [], []
        ids.append(ident)
        concepts.append(concept)
    if ids:
        batches.append(ids)
    return batches


def initial_changes(client, cfg, concepts, version):
    """Import only absent records; a newer review never overwrites curated knowledge."""
    domain = cfg["domain"]
    changes = []
    for concept in concepts:
        response = client.get(
            f"/v1/domains/{domain}/concepts/{concept['concept_id']}", headers=headers(cfg)
        )
        if response.status_code == 404:
            changes.append(concept["concept_id"])
            continue
        if response.is_error:
            raise RuntimeError(
                f"Cortex concept preflight returned HTTP {response.status_code}; no proposal created"
            )
        actual = response.json()
        if any(actual.get(key) != concept[key] for key in CONCEPT_FIELDS):
            raise ValueError(
                "Existing concept differs; explicit reconciliation is required before replacement"
            )
    latest = request(client, cfg, "GET", f"/v1/domains/{domain}/version")
    if any(latest[key] != version[key] for key in ("accepted_version", "published_version")):
        raise ValueError("Version changed during reconciliation; retry on a stable version")
    return changes


def publish_reviewed(client, cfg, manifest, selection, state, checkpoint):
    concepts = reviewed_payloads(manifest, selection, state)
    batch_key = digest(canonical([manifest["manifest_sha256"], selection]))
    batch = state["batches"].get(batch_key)
    domain = cfg["domain"]
    if batch is None:
        version = request(client, cfg, "GET", f"/v1/domains/{domain}/version")
        if version["accepted_version"] != version["published_version"]:
            raise ValueError("Resolve the existing accepted/unpublished version first")
        change_ids = initial_changes(client, cfg, concepts, version)
        batch = {
            "base_version": version["published_version"],
            "record_ids": selection["record_ids"],
            "payload_sha256": digest(canonical(concepts)),
            "change_ids": change_ids,
            "status": "prepared",
        }
        if not change_ids:
            batch.update(
                status="verified",
                disposition="already_published",
                published_version=version["published_version"],
            )
        state["batches"][batch_key] = batch
        checkpoint()  # Preserve the exact base/version before an uncertain request.
    if batch["payload_sha256"] != digest(canonical(concepts)):
        raise ValueError("Prepared batch payload changed")
    if batch["status"] == "verified":
        return batch
    if "proposal_id" not in batch:
        # Older checkpoints contain all original candidates; their base is preserved.
        change_ids = set(batch.get("change_ids", [c["concept_id"] for c in concepts]))
        proposal = request(
            client,
            cfg,
            "POST",
            f"/v1/domains/{domain}/proposals",
            {
                "base_version": batch["base_version"],
                "changes": [
                    {"kind": "put_concept", "concept": c}
                    for c in concepts
                    if c["concept_id"] in change_ids
                ],
                "reason": selection["reason"],
                "idempotency_key": "okf-" + batch_key,
            },
        )
        batch.update(
            proposal_id=proposal["id"], proposal_digest=proposal["digest"], status="proposed"
        )
        checkpoint()
    proposal_id = batch["proposal_id"]
    body = {
        "digest": batch["proposal_digest"],
        "expected_version": batch["base_version"],
        "expected_review_revision": 0,
        "reason": selection["reason"],
        "idempotency_key": "okf-approve-" + batch_key,
    }
    if batch["status"] == "proposed":
        request(
            client,
            cfg,
            "POST",
            f"/v1/domains/{domain}/proposals/{proposal_id}/approve",
            body,
            operation="proposals.approve",
            arguments={"path": {"domain": domain, "proposal_id": proposal_id}, "body": body},
        )
        batch["status"] = "approved"
        checkpoint()
    if batch["status"] == "approved":
        body = {"expected_published_version": batch["base_version"]}
        receipt = request(
            client,
            cfg,
            "POST",
            f"/v1/domains/{domain}/proposals/{proposal_id}/publish",
            body,
            operation="proposals.publish",
            arguments={"path": {"domain": domain, "proposal_id": proposal_id}, "body": body},
        )
        batch.update(status="published", publication=receipt)
        checkpoint()
    version = request(client, cfg, "GET", f"/v1/domains/{domain}/version")
    if version["published_version"] != batch["base_version"] + 1:
        raise ValueError("Published version differs; reconcile before continuing")
    for concept in concepts:
        actual = request(
            client, cfg, "GET", f"/v1/domains/{domain}/concepts/{concept['concept_id']}"
        )
        # Native read contains the concept fields plus published-version context.
        for key in CONCEPT_FIELDS:
            if actual.get(key) != concept[key]:
                raise ValueError("Published concept differs from its reviewed candidate")
    batch.update(status="verified", published_version=version["published_version"])
    checkpoint()
    return batch


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["stage", "publish-reviewed"])
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--selection", type=Path, required=True)
    args = parser.parse_args()
    cfg, manifest = configuration(), read_manifest(args.manifest)
    if manifest["scope"] != cfg["scope"]:
        raise ValueError("Manifest belongs to another private workspace")
    selection = json.loads(private_path(args.selection).read_text())
    if selection.get("manifest_sha256") != manifest["manifest_sha256"]:
        raise ValueError("Selection does not identify the current manifest")
    state_path = DIRECTORY / ("ingestion-" + manifest["manifest_sha256"] + ".json")
    lock_fd = os.open(DIRECTORY / "ingestion.lock", os.O_RDWR | os.O_CREAT, 0o600)
    with os.fdopen(lock_fd, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = (
            json.loads(state_path.read_text())
            if state_path.exists()
            else {
                "tenant": cfg["tenant"],
                "domain": cfg["domain"],
                "manifest_sha256": manifest["manifest_sha256"],
                "sources": {},
                "batches": {},
            }
        )
        if (state["tenant"], state["domain"], state["manifest_sha256"]) != (
            cfg["tenant"],
            cfg["domain"],
            manifest["manifest_sha256"],
        ):
            raise ValueError("Checkpoint scope differs")

        def checkpoint():
            save(state_path, state)

        with httpx.Client(base_url=BASE_URL, trust_env=False, timeout=60) as client:
            register_sources(client, cfg, manifest, selection["record_ids"], state, checkpoint)
            batch = (
                publish_reviewed(client, cfg, manifest, selection, state, checkpoint)
                if args.action == "publish-reviewed"
                else None
            )
        print(
            json.dumps(
                {
                    "registered_sources": len(state["sources"]),
                    "batch_status": batch["status"] if batch else "sources_only",
                    "batch_records": len(selection["record_ids"]),
                    "published_version": batch.get("published_version") if batch else None,
                }
            )
        )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Source/proposal bodies and auth headers must never appear in console errors.
        message = str(exc) if isinstance(exc, ValueError | RuntimeError) else type(exc).__name__
        raise SystemExit(f"Private ingestion stopped: {message}") from None
