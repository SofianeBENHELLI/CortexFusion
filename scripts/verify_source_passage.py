"""Bounded source reads: Unicode pagination, current rights and exact evidence hashes."""

import hashlib
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from verify_coordinated_restore import Fixture
from verify_rust_configured import native_client
from verify_workspace_tasks import KEYS, OUT, ROOT, task_fixture


def main():
    state = {**task_fixture(), "domain": str(uuid4())}
    url = make_url(os.environ["CORTEX_TEST_ADMIN_URL"])
    assert (
        url.host == "127.0.0.1"
        and url.port == int(os.environ.get("CORTEX_QUALIFICATION_PORT", "55432"))
        and url.database.endswith("_test")
    )
    db = create_engine(url)
    with db.begin() as c:
        c.execute(
            text(
                "INSERT INTO cf_domains(tenant_id,id,name) VALUES(:tenant,:domain,'Lecture progressive des preuves')"
            ),
            state,
        )
        for subject, role in [
            ("alice", "owner"),
            ("reader", "contributor"),
            ("task-viewer", "viewer"),
            ("task-agent", "agent"),
        ]:
            c.execute(
                text(
                    "INSERT INTO cf_memberships(tenant_id,domain_id,subject,role) VALUES(:tenant,:domain,:subject,:role)"
                ),
                {**state, "subject": subject, "role": role},
            )
    fixture = Fixture(state["tenant"], {"identity": (KEYS / "identity-private.pem").read_bytes()})
    env = {k: v for k, v in os.environ.items() if not k.startswith(("CORTEX_", "OPENROUTER_"))}
    env.update(
        CORTEX_RUST_DATABASE_URL=os.environ["CORTEX_RUST_DATABASE_URL"],
        CORTEX_JWT_PUBLIC_KEY_FILE=str(KEYS / "identity.pem"),
        CORTEX_JWT_ISSUER="https://identity.test",
        CORTEX_JWT_AUDIENCE="cortex-core",
        CORTEX_RUST_BIND="127.0.0.1:0",
    )
    checks = []
    content = "Début synthétique.\n" + "a🧠é\n" * 35000 + "Fin : la revue dure cinq jours."
    digest = hashlib.sha256(content.encode()).hexdigest()
    with native_client(ROOT / "target/debug/cortex-rust-core", env) as client:
        base = f"/v1/domains/{state['domain']}"
        r = client.post(
            base + "/sources",
            headers=fixture.headers(),
            json={
                "title": "Source longue Unicode",
                "location": f"synthetic://source-passage/{uuid4()}",
                "content": content,
                "allowed_subjects": ["alice", "reader", "task-viewer"],
            },
        )
        assert r.status_code == 201
        state["source"] = r.json()["id"]
        path = base + f"/sources/{state['source']}/passage"
        before = client.get(base + "/version", headers=fixture.headers()).json()

        def read(params=None, actor="task-viewer", status=200):
            r = client.get(path, headers=fixture.headers(actor), params=params)
            assert r.status_code == status, (r.status_code, r.text[:200])
            if status == 200:
                assert len(r.content) < 65536
            return r.json()

        offset = 0
        parts = []
        pages = 0
        while offset < len(content):
            p = read({"offset": offset, "limit": 8192, "expected_hash": digest})
            assert p["start"] == offset and p["end"] == min(offset + 8192, len(content))
            assert p["excerpt"] == content[p["start"] : p["end"]]
            assert p["total_characters"] == len(content) and p["content_hash"] == digest
            assert p["offset_unit"] == "unicode_code_point" and p["next_offset"] == (
                p["end"] if p["end"] < len(content) else None
            )
            parts.append(p["excerpt"])
            offset = p["end"]
            pages += 1
        assert "".join(parts) == content
        checks.append(
            f"all {pages} pages reconstruct {len(content)} Unicode characters exactly; each response below65536bytes without full body transport"
        )
        end = read({"offset": len(content), "limit": 1})
        assert end["excerpt"] == "" and end["next_offset"] is None
        arbitrary = read({"offset": 20, "limit": 3, "expected_hash": digest})
        assert arbitrary["excerpt"] == content[20:23]
        tail = read({"offset": len(content) - 30, "limit": 30, "expected_hash": digest})
        assert tail["excerpt"] == content[-30:]
        checks.append(
            "arbitrary exact range, non-BMP/accent offsets, explicit EOF and final evidence beyond140000characters"
        )
        for params in [
            {"offset": -1},
            {"offset": len(content) + 1},
            {"offset": 2147483647},
            {"limit": 0},
            {"limit": 8193},
            {"limit": "bad"},
            {"expected_hash": "bad"},
            {"unexpected": "x"},
        ]:
            read(params, status=422)
        read({"expected_hash": "0" * 64}, status=409)
        assert client.get(path).status_code == 401
        read(actor="task-agent", status=404)
        denied = client.get(
            path.replace(state["domain"], str(uuid4())), headers=fixture.headers("task-viewer")
        )
        assert denied.status_code == 404
        checks.append(
            "invalid ranges/bounds/query/hash refused; mismatch409, no identity401, no source or domain access404"
        )
        with db.begin() as c:
            old = c.execute(
                text(
                    "SELECT allowed_subjects FROM cf_sources WHERE tenant_id=:tenant AND domain_id=:domain AND id=:source"
                ),
                state,
            ).scalar_one()
            c.execute(
                text(
                    'UPDATE cf_sources SET allowed_subjects=\'["alice","reader"]\'::jsonb WHERE tenant_id=:tenant AND domain_id=:domain AND id=:source'
                ),
                state,
            )
        try:
            read({"offset": 8192, "expected_hash": digest}, status=404)
        finally:
            with db.begin() as c:
                c.execute(
                    text(
                        "UPDATE cf_sources SET allowed_subjects=CAST(:acl AS jsonb) WHERE tenant_id=:tenant AND domain_id=:domain AND id=:source"
                    ),
                    {**state, "acl": json.dumps(old)},
                )
        assert read({"offset": 8192, "limit": 1})["excerpt"] == content[8192]
        checks.append(
            "next-page read rechecks revoked viewer ACL; exact prior ACL restored and fresh read succeeds"
        )
        with ThreadPoolExecutor(max_workers=1) as pool:
            try:
                with db.begin() as c:
                    c.execute(
                        text(
                            'UPDATE cf_sources SET allowed_subjects=\'["alice","reader"]\'::jsonb WHERE tenant_id=:tenant AND domain_id=:domain AND id=:source'
                        ),
                        state,
                    )
                    waiting = pool.submit(
                        client.get,
                        path,
                        headers=fixture.headers("task-viewer"),
                        params={"offset": 8192, "expected_hash": digest},
                    )
                    deadline = time.monotonic() + 5
                    blocked = False
                    while time.monotonic() < deadline:
                        with db.connect() as observer:
                            blocked = observer.execute(
                                text(
                                    "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE state='active' AND wait_event_type='Lock' AND query LIKE 'SELECT title,location,content_hash,char_length(content)%')"
                                )
                            ).scalar_one()
                        if blocked:
                            break
                        time.sleep(0.01)
                    assert blocked, "Source read did not reach the locked row"
                raced = waiting.result(timeout=5)
                assert raced.status_code == 409 and "excerpt" not in raced.json()
            finally:
                with db.begin() as c:
                    c.execute(
                        text(
                            "UPDATE cf_sources SET allowed_subjects=CAST(:acl AS jsonb) WHERE tenant_id=:tenant AND domain_id=:domain AND id=:source"
                        ),
                        {**state, "acl": json.dumps(old)},
                    )
        checks.append(
            "concurrent ACL revocation blocks the source read then fails closed409, with no passage returned; exact ACL restored"
        )
        r = client.post(
            "/mcp",
            headers={
                **fixture.headers("task-viewer"),
                "Accept": "application/json, text/event-stream",
            },
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "api_sources_passage",
                    "arguments": {
                        "path": {"domain": state["domain"], "source_id": state["source"]},
                        "query": {"offset": 20, "limit": 3, "expected_hash": digest},
                    },
                },
            },
        ).json()
        assert r["result"]["structuredContent"] == {"http_status": 200, "data": arbitrary}
        assert client.get(base + "/version", headers=fixture.headers()).json() == before
        checks.append(
            "MCP exact parity and accepted/published versions unchanged; no approval or model request"
        )
    (OUT / "source-passage-state.json").write_text(
        json.dumps({**state, "content_hash": digest, "characters": len(content)}, indent=2)
    )
    (OUT / "source-passage-native-report.json").write_text(
        json.dumps({"synthetic_only": True, "passed": len(checks), "checks": checks}, indent=2)
    )
    print(json.dumps({"passed": len(checks), "checks": checks}, indent=2))


if __name__ == "__main__":
    main()
