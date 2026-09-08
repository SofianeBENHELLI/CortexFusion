"""Durable text import steps use synthetic content and no external fetching."""

from uuid import uuid4


def verify_imports(client, headers, domain):
    root = f"/v1/domains/{domain}"
    h = headers()
    collection = client.post(
        root + "/collections",
        headers=h,
        json={
            "name": "Imports",
            "allowed_subjects": ["alice", "bob"],
            "idempotency_key": str(uuid4()),
        },
    ).json()["id"]
    url = root + f"/collections/{collection}/imports"
    data = {
        "items": [
            {
                "filename": "preuve.MD",
                "content": "Preuve textuelle synthétique 🧠",
                "allowed_subjects": ["alice", "bob"],
            },
            {
                "filename": "image.pdf",
                "content": "Contenu inexploitable",
                "allowed_subjects": ["alice"],
            },
        ],
        "idempotency_key": str(uuid4()),
    }
    assert client.post(url, headers=headers(sub="bob"), json=data).status_code == 403
    created = client.post(url, headers=h, json=data)
    assert created.status_code == 202, created.text
    job = created.json()
    ident = job["id"]
    job_url = root + "/imports/" + ident
    assert job["status"] == "pending" and job["processing"] == "local_text_only"
    assert client.post(url, headers=h, json=data).json() == job
    assert client.post(url, headers=h, json={**data, "items": data["items"][:1]}).status_code == 409
    assert client.get(job_url, headers=headers(sub="bob")).status_code == 404
    partial = client.post(job_url + "/process", headers=h, params={"limit": 1})
    assert partial.status_code == 200, partial.text
    partial = partial.json()
    assert partial["status"] == "partial" and partial["items"][0]["status"] == "succeeded"
    source = partial["items"][0]["source_id"]
    assert (
        client.get(root + "/sources/" + source, headers=headers(sub="bob")).json()["content"]
        == data["items"][0]["content"]
    )
    assert (
        client.get(root + "/sources", headers=h, params={"collection_id": collection}).json()[
            "items"
        ][0]["id"]
        == source
    )
    failed = client.post(job_url + "/process", headers=h).json()
    assert (
        failed["items"][1]["status"] == "failed"
        and failed["items"][1]["error_code"] == "UNSUPPORTED_FORMAT"
    )
    assert client.post(job_url + "/process", headers=h).json() == failed
    retry = client.post(job_url + "/retry", headers=h).json()
    assert retry["items"][0] == failed["items"][0] and retry["items"][1]["status"] == "pending"
    cancelled = client.post(job_url + "/cancel", headers=h).json()
    assert cancelled["status"] == "cancelled" and cancelled["items"][0]["source_id"] == source
    for action in ["retry", "process"]:
        result = client.post(job_url + "/" + action, headers=h)
        assert result.status_code == 409 and result.json()["error"] == "IMPORT_CANCELLED"
    assert client.post(url, headers=h, json=data).json() == cancelled
    second = client.post(
        url, headers=h, json={**data, "items": data["items"][:1], "idempotency_key": str(uuid4())}
    ).json()
    second_url = root + "/imports/" + second["id"]
    done = client.post(second_url + "/process", headers=h).json()
    assert done["status"] == "succeeded" and done["items"][0]["source_id"] == source
    assert client.post(second_url + "/cancel", headers=h).json() == done
    assert client.post(second_url + "/retry", headers=h).json() == done
    page = client.get(root + "/imports", headers=h, params={"limit": 1}).json()
    assert len(page["items"]) == 1 and page["next_after"]
    assert client.get(root + "/imports", headers=headers(sub="bob")).json()["items"] == []
    bad = {
        **data,
        "items": [{**data["items"][0], "filename": "../secret.md"}],
        "idempotency_key": str(uuid4()),
    }
    assert client.post(url, headers=h, json=bad).status_code == 422
    rpc = client.post(
        "/mcp",
        headers={**h, "Accept": "application/json, text/event-stream"},
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "api_imports_process",
                "arguments": {"path": {"domain": domain, "import_id": second["id"]}},
            },
        },
    )
    assert rpc.json()["result"]["structuredContent"] == {"http_status": 200, "data": done}
    return [
        "native_text_import_private_receipts_and_idempotence",
        "native_import_bounded_process_source_dedup_and_collection",
        "native_import_failure_retry_cancellation_preserves_sources",
        "native_import_http_mcp_and_filename_validation",
    ]
