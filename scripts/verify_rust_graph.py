"""Synthetic graph migration checks executed inside the native HTTP fixture."""

import hashlib
import json
import subprocess
from uuid import uuid4

from sqlalchemy import text


def verify_graph(binary, env, client, headers, token, admin, tenant, domain):
    public_source, private_source, public_concept, private_concept, proposal = [
        str(uuid4()) for _ in range(5)
    ]
    concepts = [
        {
            "concept_id": public_concept,
            "title": "A public",
            "body": "Public synthetic proof",
            "maturity": "observed",
            "sources": [{"source_id": public_source, "start": 0, "end": 22}],
            "links": [
                {
                    "target_id": private_concept,
                    "kind": "associative",
                    "primary": False,
                    "weight": 0.5,
                }
            ],
        },
        {
            "concept_id": private_concept,
            "title": "B private",
            "body": "Private synthetic proof",
            "maturity": "observed",
            "sources": [{"source_id": private_source, "start": 0, "end": 23}],
            "links": [],
        },
    ]
    with admin.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:t,:d,'bob','viewer')"
            ),
            {"t": tenant, "d": domain},
        )
        for sid, subjects in [(public_source, ["alice", "bob"]), (private_source, ["alice"])]:
            conn.execute(
                text(
                    "INSERT INTO cf_sources(tenant_id,domain_id,id,title,location,content,content_hash,allowed_subjects) VALUES(:t,:d,:id,'Synthetic',:id,:content,:hash,CAST(:acl AS jsonb))"
                ),
                {
                    "t": tenant,
                    "d": domain,
                    "id": sid,
                    "acl": json.dumps(subjects),
                    "content": concepts[0 if sid == public_source else 1]["body"],
                    "hash": hashlib.sha256(
                        concepts[0 if sid == public_source else 1]["body"].encode()
                    ).hexdigest(),
                },
            )
        conn.execute(
            text(
                "INSERT INTO cf_proposals(tenant_id,domain_id,id,author,base_version,payload,digest,reason,validation,status,idempotency_key,request_hash) VALUES(:t,:d,:id,'alice',0,'{}',:h,'Synthetic migration fixture','{}','published','synthetic-key',:h)"
            ),
            {"t": tenant, "d": domain, "id": proposal, "h": "a" * 64},
        )
        conn.execute(
            text(
                "INSERT INTO cf_commits(tenant_id,domain_id,sequence,proposal_id,author,reason,digest,changes,before_state,decision_key,decision_hash) VALUES(:t,:d,1,:id,'alice','Synthetic fixture',:h,'[]','{}','synthetic-key',:h)"
            ),
            {"t": tenant, "d": domain, "id": proposal, "h": "a" * 64},
        )
        for concept in concepts:
            conn.execute(
                text(
                    "INSERT INTO cf_concepts(tenant_id,domain_id,id,payload,version) VALUES(:t,:d,:id,CAST(:p AS jsonb),1)"
                ),
                {"t": tenant, "d": domain, "id": concept["concept_id"], "p": json.dumps(concept)},
            )
        conn.execute(
            text(
                "UPDATE cf_domains SET accepted_version=1,published_version=1 WHERE tenant_id=:t AND id=:d"
            ),
            {"t": tenant, "d": domain},
        )
    url = f"/v1/domains/{domain}/concepts"
    assert client.get(url, headers=headers()).status_code == 503
    migration_env = {**env, "CORTEX_MIGRATION_BEARER": token(), "CORTEX_MIGRATION_TENANT": tenant}
    for _ in range(2):
        result = subprocess.run(
            [str(binary.resolve()), "--import-published", domain],
            env=migration_env,
            capture_output=True,
            text=True,
            timeout=90,
        )
        assert result.returncode == 0, "Native graph import failed"
        assert json.loads(result.stdout) == {"status": "prepared", "concepts": 2}
    owner = client.get(url, headers=headers())
    assert owner.status_code == 200 and owner.json() == concepts
    viewer = client.get(url, headers=headers(sub="bob"))
    assert viewer.status_code == 200 and viewer.json() == [{**concepts[0], "links": []}]
    assert client.get(url + "/" + private_concept, headers=headers(sub="bob")).status_code == 404
    assert client.get(url + "/" + public_concept, headers=headers(sub="bob")).json() == {
        **concepts[0],
        "links": [],
    }
    with admin.begin() as conn:
        conn.execute(
            text(
                "UPDATE cf_sources SET allowed_subjects='[\"alice\"]' WHERE tenant_id=:t AND id=:s"
            ),
            {"t": tenant, "s": public_source},
        )
    assert client.get(url, headers=headers(sub="bob")).json() == []
    with admin.begin() as conn:
        conn.execute(
            text("UPDATE cf_sources SET allowed_subjects='[\"bob\"]' WHERE tenant_id=:t AND id=:s"),
            {"t": tenant, "s": private_source},
        )
    replay = subprocess.run(
        [str(binary.resolve()), "--import-published", domain],
        env=migration_env,
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert replay.returncode != 0, "Replay must recheck current proofs"
    with admin.begin() as conn:
        count = conn.execute(
            text(
                "SELECT count(*) FROM cf_graph_preparations WHERE tenant_id=:t AND domain_id=:d AND status='ready'"
            ),
            {"t": tenant, "d": domain},
        ).scalar_one()
        assert count == 1
        conn.execute(
            text(
                "UPDATE cf_domains SET accepted_version=2,published_version=2 WHERE tenant_id=:t AND id=:d"
            ),
            {"t": tenant, "d": domain},
        )
    assert client.get(url, headers=headers()).status_code == 503
    return [
        "real_terminus_native_http",
        "manifest_replay_no_duplicate",
        "current_source_acl_and_hidden_links",
        "version_without_manifest_fails_closed",
    ]
