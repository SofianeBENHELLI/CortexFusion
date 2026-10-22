"""Local, synthetic BrainMap browser fixture. Uses public APIs for every knowledge change.

Serve a fresh tenant in a dedicated *_test database, then stage/publish changes while
the browser observes them. Private fixture keys stay in the ignored .runtime tree.
This script does not automate the browser or approve enterprise knowledge.
"""

import argparse
import json
import os
import signal
import time
from copy import deepcopy
from pathlib import Path
from uuid import NAMESPACE_URL, uuid4, uuid5

import httpx
import jwt
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from verify_coordinated_restore import Fixture, fixture_keys
from verify_rust_configured import native_client

ROOT = Path(__file__).resolve().parents[1]


def write_state(directory, state):
    path = directory / "state.json"
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n")
    path.chmod(0o600)


def fixture_for(directory, state):
    return Fixture(
        state["tenant"],
        {
            name: (directory / f"{name}-private.pem").read_bytes()
            for name in ("identity", "confirmation")
        },
    )


def source_concept(client, fixture, domain, title, subjects):
    content = f"Preuve synthétique 🧠 : {title}. Cette fiche sert uniquement à la recette BrainMap."
    response = client.post(
        f"/v1/domains/{domain}/sources",
        headers=fixture.headers(),
        json={
            "title": f"Preuve de {title}",
            "location": "synthetic://atlas-browser",
            "content": content,
            "allowed_subjects": subjects,
        },
    )
    response.raise_for_status()
    return {
        "concept_id": str(uuid4()),
        "title": title,
        "body": content,
        "sources": [{"source_id": response.json()["id"], "start": 0, "end": len(content)}],
        "maturity": "observed",
        "links": [],
    }


def prepare(client, fixture, domain, version, concepts, key, *, retired_ids=()):
    response = client.post(
        f"/v1/domains/{domain}/proposals",
        headers=fixture.headers(),
        json={
            "base_version": version,
            "changes": [{"kind": "put_concept", "concept": c} for c in concepts]
            + [{"kind": "retire_concept", "concept_id": ident} for ident in retired_ids],
            "reason": "Recette BrainMap : changement synthétique sourcé",
            "idempotency_key": key,
        },
    )
    response.raise_for_status()
    proposal = response.json()
    # Exercise explicit review decisions before the separate approval/publication.
    for revision, action in enumerate(("defer", "reopen")):
        body = {
            "action": action,
            "digest": proposal["digest"],
            "expected_review_revision": revision,
            "reason": "Recette synthétique : preuve examinée",
            "idempotency_key": key + action,
        }
        args = {"path": {"domain": domain, "ident": proposal["id"]}, "body": body}
        reviewed = client.post(
            f"/v1/domains/{domain}/proposals/{proposal['id']}/reviews",
            headers=fixture.signed("proposals.review", args),
            json=body,
        )
        reviewed.raise_for_status()
    fixture.command(
        client,
        domain,
        f"proposals/{proposal['id']}/approve",
        "proposals.approve",
        {
            "digest": proposal["digest"],
            "expected_version": version,
            "expected_review_revision": 2,
            "reason": "Recette synthétique : contenu vérifié",
            "idempotency_key": key + "approve",
        },
        proposal["id"],
    )
    return proposal["id"]


def publish(client, fixture, domain, proposal, version):
    return fixture.command(
        client,
        domain,
        f"proposals/{proposal}/publish",
        "proposals.publish",
        {"expected_published_version": version},
        proposal,
    )


def scale_graph(client, fixture, domain, stopped):
    """1,000 sourced nodes: twenty 50-node rings with two outgoing links each.

    One additional link joins each later batch to the preceding one: 2,019
    associative relations in total. No concept exceeds the native 100-link
    limit and no proposal exceeds 50 changes. The existing caps stay intact.
    """
    started = time.monotonic()
    concepts = []
    publications = []
    for batch in range(20):
        if stopped() or time.monotonic() - started > 600:
            raise RuntimeError("Synthetic scale preparation stopped or exceeded ten minutes")
        batch_started = time.monotonic()
        offset = batch * 50
        chunk = []
        for index in range(offset, offset + 50):
            if stopped():
                raise RuntimeError("Synthetic scale preparation stopped")
            concept = source_concept(
                client, fixture, domain, f"Échelle {index:04}", ["alice", "bob"]
            )
            concept["concept_id"] = str(uuid5(NAMESPACE_URL, f"cortex-synthetic-scale/{index}"))
            chunk.append(concept)
        for index, concept in enumerate(chunk):
            targets = [chunk[(index + step) % 50]["concept_id"] for step in (1, 7)]
            if batch and index == 0:
                targets.append(concepts[offset - 50]["concept_id"])
            concept["links"] = [
                {"target_id": target, "kind": "associative", "weight": 0.5, "primary": False}
                for target in targets
            ]
        proposal = prepare(client, fixture, domain, batch, chunk, f"scale-batch-{batch}")
        publish(client, fixture, domain, proposal, batch)
        concepts.extend(chunk)
        report = {
            "version": batch + 1,
            "concepts": len(concepts),
            "relations": sum(len(c["links"]) for c in concepts),
            "batch_setup_seconds": round(time.monotonic() - batch_started, 3),
        }
        publications.append(report)
        print(json.dumps(report), flush=True)
    return concepts, {
        "name": "1000 nodes, two-link rings of 50, 19 backward bridges",
        "concepts": 1000,
        "sources": 1000,
        "relations": 2019,
        "initial_version": 20,
        "setup_seconds": round(time.monotonic() - started, 3),
        "publications": publications,
    }


def serve(directory, duration, graph_size=2, domain_count=1, port=8011):
    if (directory / "state.json").exists():
        raise ValueError("Choose a fresh .runtime directory; existing fixtures are preserved")
    if graph_size == 1000 and domain_count != 1:
        raise ValueError("The scale qualification uses one explicitly scoped domain")
    admin_url, rust_url = (
        os.environ["CORTEX_TEST_ADMIN_URL"],
        os.environ["CORTEX_RUST_DATABASE_URL"],
    )
    urls = [make_url(admin_url), make_url(rust_url)]
    if any(
        u.host not in {"127.0.0.1", "localhost"} or not (u.database or "").endswith("_test")
        for u in urls
    ):
        raise ValueError("Dedicated loopback *_test databases are required")
    if (urls[0].host, urls[0].port, urls[0].database) != (
        urls[1].host,
        urls[1].port,
        urls[1].database,
    ):
        raise ValueError("Both identities must use the same isolated test database")
    directory.mkdir(parents=True, mode=0o700, exist_ok=True)
    directory.chmod(0o700)
    keys = fixture_keys(directory)
    for name, value in keys.items():
        path = directory / f"{name}-private.pem"
        path.write_bytes(value)
        path.chmod(0o600)
    fixture = Fixture(str(uuid4()), keys)
    domain = str(uuid4())
    extra_domains = [
        {"id": str(uuid4()), "name": name, "concepts": []}
        for name in [
            "Recherche",
            "Produits",
            "Méthodes",
            "Support",
            "Formation",
            "Qualité",
            "Ingénierie",
        ][: domain_count - 1]
    ]
    with create_engine(admin_url).begin() as conn:
        conn.execute(
            text("INSERT INTO cf_tenants(id,name) VALUES(:t,'Recette BrainMap synthétique')"),
            {"t": fixture.tenant},
        )
        conn.execute(
            text("INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,'Recette BrainMap')"),
            {"t": fixture.tenant, "d": domain},
        )
        for extra in extra_domains:
            conn.execute(
                text("INSERT INTO cf_domains(tenant_id,id,name) VALUES(:t,:d,:name)"),
                {"t": fixture.tenant, "d": extra["id"], "name": extra["name"]},
            )
            conn.execute(
                text(
                    "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,'alice','owner'),(:t,:d,'bob','viewer')"
                ),
                {"t": fixture.tenant, "d": extra["id"]},
            )
        conn.execute(
            text(
                "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,'alice','owner'),(:t,:d,'bob','viewer')"
            ),
            {"t": fixture.tenant, "d": domain},
        )
    env = {k: v for k, v in os.environ.items() if not k.startswith("CORTEX_")}
    env.update(
        {
            key: os.environ[key]
            for key in [
                "CORTEX_RUST_DATABASE_URL",
                "CORTEX_TERMINUS_URL",
                "CORTEX_TERMINUS_USER",
                "CORTEX_TERMINUS_PASSWORD",
            ]
        }
    )
    env.update(
        {
            "CORTEX_JWT_PUBLIC_KEY_FILE": str(directory / "identity.pem"),
            "CORTEX_CONFIRMATION_PUBLIC_KEY_FILE": str(directory / "confirmation.pem"),
            "CORTEX_JWT_ISSUER": "https://identity.test",
            "CORTEX_JWT_AUDIENCE": "cortex-core",
            "CORTEX_CORS_ORIGINS": '["http://127.0.0.1:5174"]',
            "CORTEX_RUST_BIND": f"127.0.0.1:{port}",
        }
    )
    stop = False

    def shutdown(*_):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    with native_client(ROOT / "target/debug/cortex-rust-core", env) as client:
        workload = None
        if graph_size == 1000:
            concepts, workload = scale_graph(client, fixture, domain, lambda: stop)
        else:
            concepts = [
                source_concept(client, fixture, domain, title, ["alice", "bob"])
                for title in (
                    ["Repère BrainMap A", "Repère BrainMap B"]
                    if graph_size == 2
                    else [f"Repère BrainMap {i:02}" for i in range(graph_size)]
                )
            ]
            concepts[0]["links"] = [
                {
                    "target_id": concepts[1]["concept_id"],
                    "kind": "structural",
                    "primary": False,
                    "weight": 1.0,
                }
            ]
            if graph_size > 2:
                concepts[0]["links"] = [
                    {
                        "target_id": c["concept_id"],
                        "kind": "associative",
                        "weight": 0.5,
                        "primary": False,
                    }
                    for c in concepts[1:]
                ]
            proposal = prepare(client, fixture, domain, 0, concepts, "atlas-initial")
            publish(client, fixture, domain, proposal, 0)
        for extra in extra_domains:
            if extra["name"] == "Méthodes":
                continue  # An authorized unpublished domain must show verified zeros.
            item = source_concept(
                client,
                fixture,
                extra["id"],
                "Repère " + extra["name"],
                ["alice"] if extra["name"] == "Support" else ["alice", "bob"],
            )
            proposal = prepare(client, fixture, extra["id"], 0, [item], "overview-initial")
            publish(client, fixture, extra["id"], proposal, 0)
            if extra["name"] == "Produits":
                item["title"] += " · révisé"
                proposal = prepare(client, fixture, extra["id"], 1, [item], "overview-second")
                publish(client, fixture, extra["id"], proposal, 1)
            extra["concepts"] = [item]
        write_state(
            directory,
            {
                "synthetic_only": True,
                "tenant": fixture.tenant,
                "domain": domain,
                "base_url": str(client.base_url).rstrip("/"),
                "concepts": concepts,
                "extra_domains": extra_domains,
                "workload": workload,
                "expires_at": time.time() + duration,
            },
        )
        print(f"BrainMap fixture ready: {directory / 'state.json'}", flush=True)
        deadline = time.monotonic() + duration
        while not stop and time.monotonic() < deadline:
            time.sleep(0.5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "action",
        choices=[
            "serve",
            "session",
            "stage",
            "publish",
            "strengthen",
            "remove",
            "revoke",
            "seed-history",
            "seed-workspace",
            "seed-reviews",
            "retire-target",
            "retire-origin",
            "primary-on",
            "primary-off",
            "revoke-viewer-page",
        ],
    )
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--synthetic-only", action="store_true", required=True)
    parser.add_argument("--duration", type=int, default=3600)
    parser.add_argument("--graph-size", type=int, choices=[2, 30, 1000], default=2)
    parser.add_argument("--domain-count", type=int, choices=[1, 8], default=1)
    parser.add_argument("--port", type=int, choices=[8011, 8012], default=8011)
    args = parser.parse_args()
    directory = args.directory.resolve()
    if not directory.is_relative_to(ROOT / ".runtime"):
        raise ValueError("Fixture credentials must remain inside the ignored .runtime directory")
    if args.action == "serve":
        if not 60 <= args.duration <= 3600:
            raise ValueError("Duration must be between 60 and 3600 seconds")
        serve(directory, args.duration, args.graph_size, args.domain_count, args.port)
        return
    state = json.loads((directory / "state.json").read_text())
    if (
        state.get("synthetic_only") is not True
        or state["base_url"] not in {"http://127.0.0.1:8011", "http://127.0.0.1:8012"}
        or state["expires_at"] < time.time()
    ):
        raise ValueError("A live synthetic loopback fixture is required")
    if state.get("workload") and args.action != "session":
        raise ValueError("Scale fixture is reserved for read-only qualification after preparation")
    fixture = fixture_for(directory, state)
    if args.action == "session":
        now = int(time.time())
        tokens = {
            subject: jwt.encode(
                {
                    "iss": "https://identity.test",
                    "aud": "cortex-core",
                    "sub": subject,
                    "iat": now,
                    "exp": min(now + 1800, int(state["expires_at"])),
                },
                fixture.private["identity"],
                algorithm="RS256",
            )
            for subject in ["alice", "bob"]
        }
        print(json.dumps({"tenant": state["tenant"], "domain": state["domain"], "tokens": tokens}))
        return
    with httpx.Client(base_url=state["base_url"], timeout=30, trust_env=False) as client:
        domain = state["domain"]
        if args.action == "revoke-viewer-page":
            if len(state.get("extra_domains", [])) != 7 or state.get("viewer_page_revoked"):
                raise ValueError("Use this once on an eight-domain fixture")
            targets = sorted([domain] + [d["id"] for d in state["extra_domains"]])[6:]
            for target in targets:
                members = client.get(f"/v1/domains/{target}/members", headers=fixture.headers())
                members.raise_for_status()
                member = next(m for m in members.json()["items"] if m["subject"] == "bob")
                fixture.command(
                    client,
                    target,
                    "members",
                    "members.change",
                    {
                        "subject": "bob",
                        "role": None,
                        "expected_revision": member["revision"],
                        "reason": "Recette synthétique : retrait d’accès à la seconde page",
                        "idempotency_key": "overview-revoke-viewer",
                    },
                )
            state["viewer_page_revoked"] = True
            write_state(directory, state)
        elif args.action in {"primary-on", "primary-off"}:
            if len(state["concepts"]) != 2 or any(
                key in state for key in ["staged", "history_version", "retirement_step"]
            ):
                raise ValueError(
                    "Primary marker recipe requires an independent two-concept fixture"
                )
            step = state.get("primary_step", 0)
            expected = 0 if args.action == "primary-on" else 1
            if step != expected:
                raise ValueError("Run primary-on once, then primary-off once")
            changed = deepcopy(state["concepts"][0])
            changed["links"][0]["primary"] = step == 0
            proposal = prepare(
                client, fixture, domain, step + 1, [changed], "brainmap-" + args.action
            )
            publish(client, fixture, domain, proposal, step + 1)
            state["concepts"][0] = changed
            state["primary_step"] = step + 1
            write_state(directory, state)
        elif args.action in {"retire-target", "retire-origin"}:
            if (
                len(state["concepts"]) != 2
                or any(key in state for key in ["staged", "history_version"])
                or state.get("primary_step", 0) not in {0, 2}
            ):
                raise ValueError("Retirement requires two concepts and no unfinished marker recipe")
            step = state.get("retirement_step", 0)
            expected = 0 if args.action == "retire-target" else 1
            if step != expected:
                raise ValueError("Run retire-target once, then retire-origin once")
            changed = deepcopy(state["concepts"][0])
            changed["links"] = []
            retired = state["concepts"][1 if step == 0 else 0]["concept_id"]
            version = step + 1 + state.get("primary_step", 0)
            proposal = prepare(
                client,
                fixture,
                domain,
                version,
                [changed] if step == 0 else [],
                "brainmap-" + args.action,
                retired_ids=[retired],
            )
            publish(client, fixture, domain, proposal, version)
            state["concepts"][0] = changed
            state["retirement_step"] = step + 1
            write_state(directory, state)
        elif args.action == "seed-reviews":
            # Exercise the review-history UI independently of publication or ACLs.
            proposal_id = state.get("review_seed_proposal")
            if not proposal_id:
                version = client.get(f"/v1/domains/{domain}/version", headers=fixture.headers())
                version.raise_for_status()
                changed = deepcopy(state["concepts"][0])
                changed["title"] += " · revue de recette"
                created = client.post(
                    f"/v1/domains/{domain}/proposals",
                    headers=fixture.headers(),
                    json={
                        "base_version": version.json()["published_version"],
                        "changes": [{"kind": "put_concept", "concept": changed}],
                        "reason": "Recette synthétique : pagination des décisions",
                        "idempotency_key": "browser-review-pages",
                    },
                )
                created.raise_for_status()
                proposal_id = created.json()["id"]
                state["review_seed_proposal"] = proposal_id
                write_state(directory, state)
            current = client.get(
                f"/v1/domains/{domain}/proposals/{proposal_id}", headers=fixture.headers()
            )
            current.raise_for_status()
            proposal = current.json()
            if proposal["status"] not in {"ready", "deferred"} or proposal["review_revision"] > 25:
                raise ValueError("The synthetic review proposal has changed unexpectedly")
            for revision in range(proposal["review_revision"], 25):
                body = {
                    "action": "defer" if revision % 2 == 0 else "reopen",
                    "digest": proposal["digest"],
                    "expected_review_revision": revision,
                    "reason": f"Recette synthétique : décision paginée {revision + 1:02}",
                    "idempotency_key": f"browser-review-page-{revision}",
                }
                arguments = {"path": {"domain": domain, "ident": proposal_id}, "body": body}
                response = client.post(
                    f"/v1/domains/{domain}/proposals/{proposal_id}/reviews",
                    headers=fixture.signed("proposals.review", arguments),
                    json=body,
                )
                response.raise_for_status()
            print(json.dumps({"review_seed_proposal": proposal_id, "review_revision": 25}))
        elif args.action == "seed-workspace":
            # Public personal-conversation APIs only; this creates no publication
            # and changes no permissions. Keys allow interrupted fixture seeding.
            for index in range(21):
                response = client.post(
                    f"/v1/domains/{domain}/conversations",
                    headers=fixture.headers(),
                    json={
                        "title": f"Pagination synthétique {index:02}",
                        "idempotency_key": f"browser-workspace-conversation-{index}",
                    },
                )
                response.raise_for_status()
                if index == 20:
                    conversation = response.json()["id"]
            for index in range(21):
                response = client.post(
                    f"/v1/domains/{domain}/conversations/{conversation}/query",
                    headers=fixture.headers(),
                    json={
                        "question": f"xylophoneinconnu{chr(97 + index)}",
                        "idempotency_key": f"browser-workspace-question-{index}",
                    },
                )
                response.raise_for_status()
                if response.json()["status"] != "knowledge_gap":
                    raise ValueError("The pagination recipe must not match published knowledge")
            state["workspace_pagination_conversation"] = conversation
            write_state(directory, state)
        elif args.action == "seed-history":
            if "staged" in state:
                raise ValueError("Use a fresh fixture for the independent history recipe")
            for version in range(state.get("history_version", 1), 25):
                changed = deepcopy(state["concepts"][0])
                changed["title"] = f"Repère BrainMap A · étape {version + 1}"
                proposal = prepare(
                    client, fixture, domain, version, [changed], f"atlas-history-{version}"
                )
                publish(client, fixture, domain, proposal, version)
                state["concepts"][0] = changed
                state["history_version"] = version + 1
                write_state(directory, state)
        elif args.action == "revoke":
            source = state["concepts"][2]["sources"][0]["source_id"]
            body = {"allowed_subjects": ["bob"]}
            arguments = {"path": {"domain": domain, "source_id": source}, "body": body}
            result = client.put(
                f"/v1/domains/{domain}/sources/{source}/access",
                headers=fixture.signed("sources.access", arguments),
                json=body,
            )
            result.raise_for_status()
            print("Synthetic private evidence is no longer accessible to alice")
        elif args.action == "stage" and "staged" not in state:
            private = source_concept(client, fixture, domain, "Signal privé C", ["alice"])
            changed = deepcopy(state["concepts"][0])
            changed["links"].append(
                {
                    "target_id": private["concept_id"],
                    "kind": "associative",
                    "primary": False,
                    "weight": 0.4,
                }
            )
            state["staged"] = prepare(
                client, fixture, domain, 1, [changed, private], "atlas-second"
            )
            state["concepts"] = [changed, state["concepts"][1], private]
            write_state(directory, state)
        elif args.action == "publish":
            print(json.dumps(publish(client, fixture, domain, state["staged"], 1)))
        elif args.action in {"strengthen", "remove"}:
            version = 2 if args.action == "strengthen" else 3
            changed = deepcopy(state["concepts"][0])
            if args.action == "strengthen":
                changed["links"][1]["weight"] = 0.8
            else:
                changed["links"] = changed["links"][:1]
            proposal = prepare(client, fixture, domain, version, [changed], "atlas-" + args.action)
            publish(client, fixture, domain, proposal, version)
            state["concepts"][0] = changed
            write_state(directory, state)
        response = client.get(f"/v1/domains/{domain}/version", headers=fixture.headers())
        response.raise_for_status()
        print(json.dumps(response.json()))


if __name__ == "__main__":
    main()
