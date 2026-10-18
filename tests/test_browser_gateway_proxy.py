"""Synthetic API gateway regressions, independent of Chrome and private datasets."""

import asyncio
import json
import re
from pathlib import Path

import httpx
import pytest
from cortex_browser_gateway.proxy import OPERATIONS, ProxyError, operation
from test_browser_gateway_oidc import TENANT, response
from test_browser_gateway_session import CONCEPT, DOMAIN, ORIGIN, SESSION_COOKIE, gateway, login

BASE = f"/api/v1/domains/{DOMAIN}"


def test_reviewed_proxy_exactly_covers_current_console_methods_and_paths():
    source = (
        Path("apps/console/src/api/operations.ts")
        .read_text()
        .split("export const operations = ")[1]
    )
    descriptors = re.findall(r'method: "(GET|POST)",\s*path: "([^"]+)"', source)
    assert len(descriptors) == 94
    selected = []
    for method, template in descriptors:
        path = re.sub(r"\{([^}]+)\}", lambda m: "1" if m[1] == "index" else DOMAIN, template)
        selected.append(operation(method, path))
    assert len(set(selected)) == len(OPERATIONS) == 94


def test_proxy_uses_grant_headers_and_filters_upstream_cookies_headers():
    async def scenario():
        calls = []

        async def upstream(request):
            calls.append(request)
            return response(
                {"fixture": "published"},
                **{
                    "set-cookie": "upstream=secret; Path=/",
                    "location": "https://untrusted.test/",
                    "x-private": "never-relayed",
                    "cache-control": "public, max-age=600",
                },
            )

        async with gateway(api_handler=upstream) as g:
            await login(g)
            for _ in range(2):
                current = await g.client.get(
                    BASE + "/version",
                    headers={
                        "Authorization": "Bearer attacker",
                        "x-tenant-id": "wrong",
                        "x-human-confirmation": "fake-signature",
                        "connection": "x-tenant-id",
                        "x-forwarded-for": "attacker",
                        "range": "bytes=1-2",
                    },
                )
                assert current.status_code == 200 and current.json() == {"fixture": "published"}
                assert current.headers["cache-control"] == "no-store"
                for name in ("set-cookie", "location", "x-private"):
                    assert name not in current.headers
            for req in calls:
                assert str(req.url) == f"https://core.test/v1/domains/{DOMAIN}/version"
                assert req.headers["x-tenant-id"] == TENANT
                assert req.headers["authorization"].startswith("Bearer ey")
                for name in ("cookie", "x-human-confirmation", "x-forwarded-for", "range"):
                    assert name not in req.headers
                assert req.headers.get("connection") != "x-tenant-id"

    asyncio.run(scenario())


def test_me_uses_fresh_identity_validator_instead_of_a_raw_proxy_body():
    async def scenario():
        async def unexpected(request):
            raise AssertionError("raw identity must not be proxied")

        async with gateway(api_handler=unexpected) as g:
            await login(g)
            g.core.value["access_token"] = "NEVER_EXPOSE"
            result = await g.client.get("/api/v1/me")
            assert result.status_code == 200 and "NEVER_EXPOSE" not in result.text
            assert len(g.core.calls) == 2

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "method,path,status",
    [
        ("POST", BASE + f"/proposals/{CONCEPT}/publish", 404),
        ("POST", BASE + f"/proposals/{CONCEPT}/approve", 404),
        ("POST", BASE + "/imports", 405),
        ("POST", BASE + f"/imports/{CONCEPT}/process", 404),
        ("POST", BASE + f"/imports/{CONCEPT}/retry", 404),
        ("POST", BASE + f"/imports/{CONCEPT}/cancel", 404),
        ("GET", "/api/health", 404),
        ("GET", "/api/https://untrusted.test", 404),
        ("GET", "/api/v1/domains/not-an-id/version", 404),
        ("POST", BASE + "/version", 405),
        ("DELETE", BASE + "/concepts", 405),
        ("HEAD", BASE + "/concepts", 405),
        ("GET", BASE + "/concepts/" + CONCEPT + "%2f..%2fversion", 404),
    ],
)
def test_unreviewed_routes_methods_and_encoded_paths_never_reach_api(method, path, status):
    async def scenario():
        calls = []

        async def upstream(request):
            calls.append(request)
            return response({})

        async with gateway(api_handler=upstream) as g:
            await login(g)
            result = await g.client.request(method, path)
            assert result.status_code == status and not calls

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "query",
    [
        "next=https://evil.test",
        "limit=1&limit=2",
        "search=%FF",
        "search=%0d%0aPRIVATE",
        "search=%xx",
        "search=" + "x" * 2001,
    ],
)
def test_query_fields_duplicates_encoding_and_lengths_are_bounded(query):
    async def scenario():
        calls = []

        async def upstream(request):
            calls.append(request)
            return response({})

        async with gateway(api_handler=upstream) as g:
            await login(g)
            result = await g.client.get(BASE + "/graph/window?" + query)
            assert result.status_code == 422 and not calls

    asyncio.run(scenario())


def test_graph_pagination_and_scene_target_pass_through_without_changes():
    async def scenario():
        calls = []

        async def upstream(request):
            calls.append(request)
            return response({"nodes": []})

        async with gateway(api_handler=upstream) as g:
            await login(g)
            query = {
                "limit": "24",
                "before": CONCEPT,
                "at_version": "22",
                "visibility": "a" * 64,
                "search": "Étoile + relation 🧠",
            }
            assert (await g.client.get(BASE + "/graph/window", params=query)).status_code == 200
            assert dict(calls[-1].url.params) == query
            query = {
                "layout": "circular",
                "focus": DOMAIN,
                "target": CONCEPT,
                "x": "-1.5",
                "w": "900",
            }
            assert (await g.client.get(BASE + "/graph/scene", params=query)).status_code == 200
            assert dict(calls[-1].url.params) == query

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"origin": ORIGIN},
        {"origin": "https://other.test", "x-cortex-csrf": "valid"},
        {"origin": ORIGIN, "x-cortex-csrf": "wrong"},
        {"origin": ORIGIN, "x-cortex-csrf": "valid", "sec-fetch-site": "same-site"},
    ],
)
def test_all_mutations_require_same_origin_and_session_csrf(headers):
    async def scenario():
        calls = []

        async def upstream(request):
            calls.append(request)
            return response({})

        async with gateway(api_handler=upstream) as g:
            await login(g)
            csrf = (await g.client.get("/auth/session")).json()["csrf_token"]
            supplied = {k: csrf if v == "valid" else v for k, v in headers.items()}
            for route in (
                "/proposals",
                "/conversations",
                f"/issues/{CONCEPT}/decisions",
                f"/conversations/{CONCEPT}/query",
                f"/episodes/{CONCEPT}/feedback",
            ):
                assert (
                    await g.client.post(BASE + route, json={}, headers=supplied)
                ).status_code == 403
            assert not calls

    asyncio.run(scenario())


async def mutation_headers(g):
    csrf = (await g.client.get("/auth/session")).json()["csrf_token"]
    return {"Origin": ORIGIN, "X-Cortex-CSRF": csrf, "Content-Type": "application/json"}


@pytest.mark.parametrize(
    "body,status,headers",
    [
        (b"{", 422, {}),
        (b"[]", 422, {}),
        (b'{"key":1,"key":2}', 422, {}),
        (b'{"value":NaN}', 422, {}),
        (b'{"value":Infinity}', 422, {}),
        (b"{}", 415, {"content-type": "text/plain"}),
        (b"{}", 415, {"content-encoding": "gzip"}),
        (b'{"x":"' + b"x" * 17000 + b'"}', 413, {}),
    ],
)
def test_invalid_or_oversized_mutation_bodies_never_reach_core(body, status, headers):
    async def scenario():
        calls = []

        async def upstream(request):
            calls.append(request)
            return response({})

        async with gateway(api_handler=upstream) as g:
            await login(g)
            values = httpx.Headers(await mutation_headers(g))
            values.update(headers)
            result = await g.client.post(BASE + "/conversations", content=body, headers=values)
            assert result.status_code == status and not calls

    asyncio.run(scenario())


def test_long_proposal_is_unchanged_and_a_lost_mutation_response_is_not_replayed():
    async def scenario():
        calls, receipts = [], {}

        async def upstream(request):
            body = await request.aread()
            calls.append(body)
            key = json.loads(body)["idempotency_key"]
            receipts.setdefault(key, {"receipt": "synthetic-once"})
            if len(calls) == 1:
                raise httpx.ReadError("PRIVATE upstream diagnostic")
            return response(receipts[key])

        async with gateway(api_handler=upstream) as g:
            await login(g)
            body = json.dumps(
                {"idempotency_key": "synthetic-idempotency", "body": "🧠" * 200_000},
                ensure_ascii=False,
            ).encode()
            headers = await mutation_headers(g)
            failed = await g.client.post(BASE + "/proposals", content=body, headers=headers)
            assert failed.status_code == 502 and "PRIVATE" not in failed.text
            assert len(calls) == 1 and calls[0] == body
            # Explicit client retry, same payload/key. The gateway does not generate one.
            retried = await g.client.post(BASE + "/proposals", content=body, headers=headers)
            assert retried.status_code == 200 and retried.json() == {"receipt": "synthetic-once"}
            assert calls == [body, body] and len(receipts) == 1

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "status,code",
    [
        (403, "ORIGIN_NOT_ALLOWED"),
        (409, "CORRECTION_NOT_PUBLISHED"),
        (422, "SCENE_CAPACITY_EXCEEDED"),
        (422, "AMBIGUOUS_EXCERPT"),
        (422, "MAP_CAPACITY_EXCEEDED"),
        (409, "CORRECTION_NOT_ACTIVE"),
        (500, "PRIVATE_error"),
        (409, "ORIGIN_NOT_ALLOWED"),
    ],
)
def test_error_bodies_only_expose_reviewed_codes_with_matching_status(status, code):
    async def scenario():
        async def upstream(request):
            return response({"error": code, "message": "PRIVATE source or secret"}, status)

        async with gateway(api_handler=upstream) as g:
            await login(g)
            result = await g.client.get(BASE + "/version")
            assert result.status_code == status and "PRIVATE" not in result.text
            expected = (
                "CORE_REQUEST_REJECTED"
                if code == "PRIVATE_error" or (status == 409 and code == "ORIGIN_NOT_ALLOWED")
                else code
            )
            assert result.json() == {"error": expected}

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "make,code",
    [
        (lambda: response({}, 302, location="https://elsewhere.test"), "CORE_UNAVAILABLE"),
        (lambda: response({}, **{"content-encoding": "gzip"}), "CORE_UNAVAILABLE"),
        (lambda: response(b"x" * 65537), "RESPONSE_TOO_LARGE"),
        (lambda: response({}, **{"content-length": "65537"}), "RESPONSE_TOO_LARGE"),
        (lambda: response({}, **{"content-length": "invalid"}), "CORE_UNAVAILABLE"),
    ],
)
def test_responses_are_bounded_and_redirects_compression_invalid_lengths_fail(make, code):
    async def scenario():
        calls = []

        async def upstream(request):
            calls.append(request)
            return make()

        async with gateway(api_handler=upstream) as g:
            await login(g)
            result = await g.client.get(BASE + "/graph/scene")
            assert result.status_code == 502 and result.json() == {"error": code}
            assert len(calls) == 1

    asyncio.run(scenario())


def test_native_401_revokes_the_session_without_replaying_or_returning_private_body():
    async def scenario():
        calls = []

        async def upstream(request):
            calls.append(request)
            return response({"private": "never-show"}, 401)

        async with gateway(api_handler=upstream) as g:
            await login(g)
            cookie = g.client.cookies.get(SESSION_COOKIE)
            result = await g.client.get(BASE + "/version")
            assert result.status_code == 401 and "never-show" not in result.text
            assert "set-cookie" not in result.headers
            assert not g.sessions._sessions
            assert (await g.client.get(BASE + "/version")).status_code == 401 and len(calls) == 1
            assert g.client.cookies.get(SESSION_COOKIE) == cookie

    asyncio.run(scenario())


def test_logout_while_read_pending_suppresses_late_body():
    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()

        async def upstream(request):
            entered.set()
            await release.wait()
            return response({"private": "no-late-source"})

        async with gateway(api_handler=upstream) as g:
            await login(g)
            headers = await mutation_headers(g)
            pending = asyncio.create_task(g.client.get(BASE + "/version"))
            await entered.wait()
            assert (await g.client.post("/auth/logout", headers=headers)).status_code == 204
            release.set()
            result = await pending
            assert result.status_code == 401 and "no-late-source" not in result.text

    asyncio.run(scenario())


def test_logout_during_streamed_body_prevents_forwarding_and_chunked_body_is_bounded():
    async def scenario():
        calls, body_started, release = [], asyncio.Event(), asyncio.Event()

        async def upstream(request):
            calls.append(request)
            return response({})

        async def body():
            yield b'{"x":'
            body_started.set()
            await release.wait()
            yield b"1}"

        async with gateway(api_handler=upstream) as g:
            await login(g)
            headers = await mutation_headers(g)
            pending = asyncio.create_task(
                g.client.post(BASE + "/conversations", headers=headers, content=body())
            )
            await body_started.wait()
            assert (await g.client.post("/auth/logout", headers=headers)).status_code == 204
            release.set()
            assert (await pending).status_code == 401 and not calls
            await login(g)

            async def oversized():
                yield b'{"x":"'
                yield b"x" * 16385
                yield b'"}'

            assert (
                await g.client.post(
                    BASE + "/conversations", headers=await mutation_headers(g), content=oversized()
                )
            ).status_code == 413
            assert not calls

    asyncio.run(scenario())


def test_cancelled_proxy_call_is_closed_and_never_replayed():
    async def scenario():
        entered, cancelled, calls = asyncio.Event(), asyncio.Event(), []

        async def upstream(request):
            calls.append(request)
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        async with gateway(api_handler=upstream) as g:
            await login(g)
            pending = asyncio.create_task(
                g.client.post(BASE + "/conversations", json={}, headers=await mutation_headers(g))
            )
            await entered.wait()
            pending.cancel()
            with pytest.raises(asyncio.CancelledError):
                await pending
            assert cancelled.is_set() and len(calls) == 1 and g.app.inflight == 0

    asyncio.run(scenario())


def test_unknown_operation_cannot_be_replaced_by_a_caller_supplied_policy():
    with pytest.raises(ProxyError):
        operation("POST", f"/v1/domains/{DOMAIN}/proposals/{CONCEPT}/publish")


def test_asgi_disconnect_cancels_native_work_and_never_delivers_late_content():
    async def scenario():
        entered, cancelled, calls = asyncio.Event(), asyncio.Event(), []

        async def upstream(request):
            calls.append(request)
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        async with gateway(api_handler=upstream) as g:
            await login(g)
            cookie = g.client.cookies.get(SESSION_COOKIE)
            path = BASE + "/version"
            scope = {
                "type": "http",
                "http_version": "1.1",
                "asgi": {"version": "3.0"},
                "scheme": "https",
                "method": "GET",
                "path": path,
                "raw_path": path.encode(),
                "query_string": b"",
                "root_path": "",
                "server": ("console.test", 443),
                "client": ("127.0.0.1", 12345),
                "headers": [
                    (b"host", b"console.test"),
                    (b"cookie", f"{SESSION_COOKIE}={cookie}".encode()),
                ],
            }
            count, messages = 0, []

            async def receive():
                nonlocal count
                count += 1
                if count == 1:
                    return {"type": "http.request", "body": b"", "more_body": False}
                await entered.wait()
                return {"type": "http.disconnect"}

            async def send(message):
                messages.append(message)

            await asyncio.wait_for(g.app(scope, receive, send), 2)
            assert len(calls) == 1 and cancelled.is_set() and g.app.inflight == 0
            assert next(m["status"] for m in messages if m["type"] == "http.response.start") == 499
            assert not any(m.get("body") for m in messages)

    asyncio.run(scenario())


def test_proxy_deadline_cancels_one_inflight_mutation_without_retry():
    async def scenario():
        calls, cancelled = [], asyncio.Event()

        async def upstream(request):
            calls.append(request)
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        async with gateway(api_handler=upstream, request_timeout=0.1) as g:
            await login(g)
            result = await g.client.post(
                BASE + "/conversations", json={}, headers=await mutation_headers(g)
            )
            assert result.status_code == 504 and len(calls) == 1 and cancelled.is_set()

    asyncio.run(scenario())


def test_get_body_and_declared_request_lengths_do_not_bypass_limits():
    async def scenario():
        calls = []

        async def upstream(request):
            calls.append(request)
            return response({})

        async with gateway(api_handler=upstream) as g:
            await login(g)
            assert (
                await g.client.request("GET", BASE + "/version", content=b"{}")
            ).status_code == 413
            headers = httpx.Headers(await mutation_headers(g))
            headers["content-length"] = "2000001"
            assert (
                await g.client.post(BASE + "/proposals", content=b"{}", headers=headers)
            ).status_code == 413
            headers["content-length"] = "bad"
            assert (
                await g.client.post(BASE + "/proposals", content=b"{}", headers=headers)
            ).status_code == 400
            assert not calls

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "suffix,budget",
    [("/imports", 262144), (f"/imports/{CONCEPT}", 32768), (f"/collections/{CONCEPT}", 65536)],
)
def test_import_receipt_reads_are_explicit_bounded_and_keep_native_denials(suffix, budget):
    async def scenario():
        status = 200
        oversized = False
        calls = []

        async def upstream(request):
            calls.append(request)
            return response(b" " * (budget + 1) if oversized else {"fixture": "receipt"}, status)

        async with gateway(api_handler=upstream) as g:
            await login(g)
            path = BASE + suffix
            op = operation("GET", path.removeprefix("/api"))
            assert op.response_bytes == budget and op.request_bytes == 0
            assert (await g.client.get(path)).status_code == 200
            status = 404
            assert (await g.client.get(path)).status_code == 404
            status, oversized = 200, True
            assert (await g.client.get(path)).status_code == 502
            assert all(r.method == "GET" for r in calls)
            assert (await g.client.get(path, params={"token": "private"})).status_code == 422
            assert len(calls) == 3

    asyncio.run(scenario())


def test_private_drafts_allow_only_reviewed_keys_and_preserve_csrf():
    async def scenario():
        calls = []

        async def upstream(request):
            calls.append(request)
            return response(
                {"draft_key": "new", "text": "synthetic", "revision": 1, "updated_at": None}
            )

        async with gateway(api_handler=upstream) as g:
            await login(g)
            path = BASE + "/conversation-drafts/new"
            assert (await g.client.get(path)).status_code == 200
            assert (await g.client.post(path, json={})).status_code == 403
            headers = await mutation_headers(g)
            body = {"text": "synthetic", "expected_revision": 1, "idempotency_key": CONCEPT}
            assert (await g.client.post(path, headers=headers, json=body)).status_code == 200
            assert json.loads(calls[-1].content) == body
            count = len(calls)
            assert (await g.client.get(BASE + "/conversation-drafts/arbitrary")).status_code == 404
            assert (await g.client.get(path + "?author=other")).status_code == 422
            assert len(calls) == count

    asyncio.run(scenario())


def test_contribution_draft_routes_keep_personal_scope_csrf_and_budgets():
    async def scenario():
        calls = []

        async def upstream(request):
            calls.append(request)
            return response({"receipt_id": CONCEPT, "revision": 1})

        async with gateway(api_handler=upstream) as g:
            await login(g)
            path = BASE + "/contribution-draft"
            assert (await g.client.get(path)).status_code == 200
            assert (await g.client.post(path, json={})).status_code == 403
            headers = await mutation_headers(g)
            body = {"content": None, "expected_revision": 0, "idempotency_key": CONCEPT}
            assert (await g.client.post(path, headers=headers, json=body)).status_code == 200
            assert json.loads(calls[-1].content) == body
            count = len(calls)
            assert (await g.client.get(path, params={"author": "other"})).status_code == 422
            assert (
                await g.client.post(path, headers=headers, content=b" " * 2_000_001)
            ).status_code == 413
            assert len(calls) == count
            assert operation("GET", path.removeprefix("/api")).response_bytes == 2_000_000
            assert operation("POST", path.removeprefix("/api")).request_bytes == 2_000_000

    asyncio.run(scenario())


def test_case_task_routes_keep_explicit_scope_csrf_and_small_command_budget():
    async def scenario():
        calls = []

        async def upstream(request):
            calls.append(request)
            return response({"case_id": CONCEPT, "revision": 2})

        async with gateway(api_handler=upstream) as g:
            await login(g)
            path = BASE + f"/shared-cases/{CONCEPT}/tasks"
            assert (await g.client.get(path)).status_code == 200
            assert (await g.client.post(path, json={})).status_code == 403
            headers = await mutation_headers(g)
            body = {
                "action": "link",
                "task_id": CONCEPT,
                "expected_case_revision": 1,
                "expected_task_revision": 1,
                "idempotency_key": CONCEPT,
            }
            assert (await g.client.post(path, headers=headers, json=body)).status_code == 200
            assert json.loads(calls[-1].content) == body
            count = len(calls)
            assert (await g.client.get(path, params={"author": "other"})).status_code == 422
            assert (
                await g.client.post(path, headers=headers, content=b" " * 4097)
            ).status_code == 413
            assert len(calls) == count

    asyncio.run(scenario())


def test_operational_home_route_is_read_only_and_rejects_scope_injection():
    from cortex_browser_gateway.proxy import query_string

    path = BASE.removeprefix("/api") + "/work-overview"
    overview = operation("GET", path)
    assert overview.query == frozenset({"scope"})
    assert overview.response_bytes == 262144
    assert query_string(b"scope=assigned", overview) == "scope=assigned"
    for query in [b"author=alice", b"scope=assigned&scope=domain"]:
        with pytest.raises(ProxyError):
            query_string(query, overview)
    with pytest.raises(ProxyError):
        operation("POST", path)


def test_task_receipts_are_read_only_and_do_not_accept_actor_selection():
    from cortex_browser_gateway.proxy import query_string

    path = BASE.removeprefix("/api") + "/task-command-receipts"
    collection = operation("GET", path)
    assert collection.query == frozenset({"limit", "after"})
    assert query_string(b"limit=20", collection) == "limit=20"
    for raw in [b"actor=alice", b"limit=1&limit=2"]:
        with pytest.raises(ProxyError):
            query_string(raw, collection)
    single = operation("GET", path + "/" + CONCEPT)
    assert not single.query
    for candidate in [path, path + "/" + CONCEPT]:
        with pytest.raises(ProxyError):
            operation("POST", candidate)


def test_source_catalogue_is_read_only_filtered_and_preserves_current_denials():
    async def scenario():
        calls = []
        status = 200

        async def upstream(request):
            calls.append(request)
            return response({"items": [], "next_after": None}, status)

        async with gateway(api_handler=upstream) as g:
            await login(g)
            path = BASE + "/sources"
            result = await g.client.get(
                path, params={"q": "Règle 🧠", "limit": 20, "after": CONCEPT}
            )
            assert result.status_code == 200
            assert calls[-1].url.params["q"] == "Règle 🧠"
            assert calls[-1].url.params["after"] == CONCEPT
            assert (await g.client.get(path, params={"subject": "other"})).status_code == 422
            assert len(calls) == 1
            status = 403
            assert (await g.client.get(path)).status_code == 403
            headers = await mutation_headers(g)
            assert (await g.client.post(path, headers=headers, json={})).status_code == 405
            assert all(call.method == "GET" for call in calls)

    asyncio.run(scenario())


def test_reference_receipt_is_a_bounded_get_only():
    op = operation("GET", f"/v1/domains/{DOMAIN}/reference-draft-receipts/{CONCEPT}")
    assert op.response_bytes == 4096
    with pytest.raises(ProxyError):
        operation("POST", f"/v1/domains/{DOMAIN}/reference-draft-receipts/{CONCEPT}")


def test_reference_review_events_are_bounded_read_only_without_actor_injection():
    from cortex_browser_gateway.proxy import query_string

    path = BASE.removeprefix("/api") + "/reference-reviews/" + CONCEPT + "/events"
    op = operation("GET", path)
    assert op.query == frozenset({"limit", "after", "expected_revision"})
    assert op.response_bytes == 131072
    assert query_string(b"limit=20&after=1&expected_revision=3", op)
    with pytest.raises(ProxyError):
        query_string(b"actor=alice", op)
    with pytest.raises(ProxyError):
        operation("POST", path)


def test_mission_evidence_path_does_not_widen_numeric_identifiers():
    path = f"/v1/domains/{DOMAIN}/agent-missions/{DOMAIN}/evidence/"
    assert operation("GET", path + "1").query == frozenset({"expected_revision"})
    assert operation("GET", path + "10").response_bytes == 65536
    for value in ("0", "11", "01", "../1", DOMAIN):
        with pytest.raises(ProxyError):
            operation("GET", path + value)
