# Browser identity boundary

Status, 6 October 2026: **session gateway, reviewed API proxy and optional console adapter** for AUD-01. `create_app` builds an ASGI application with login, callback, session, logout and optional console API routes. An explicit local launcher is available. The console has an opt-in session transport and dev/preview relay; manual login remains the default. Tests cover the layers separately; a complete synthetic provider/gateway/Vite/native HTTP chain also passed eight grouped checks on 6 October. Chrome and a real provider remain unqualified. This package contains no knowledge authority, database writer or confirmation signer. See [ADR 0016](../../docs/architecture/decisions/0016-browser-session-and-human-confirmation.md).

## Implemented profile

`OidcProvider` uses the existing locked HTTPX/PyJWT dependencies. It supports discovery from an explicitly configured issuer, Authorization Code with PKCE S256, public clients or `client_secret_basic`, and RS256 ID/access tokens. Issuer, audiences and callback are configuration, never callback parameters. The ID audience must differ from the Cortex API audience. The access token must have the same subject as the ID token and a signed `tenant` UUID claim. This is an integration profile to configure with a real provider; opaque access tokens, external-origin discovery endpoints and other signing algorithms are currently rejected.

`LoginAttempts` binds a random state/nonce/verifier to a random browser-binding value. The HTTP boundary sets that value in a protected transient cookie; it never accepts it from the callback query. Attempts are bounded (256 by default), expire after five minutes at most, and are consumed before token exchange. A failed, cancelled or ambiguous exchange requires a new login. Concurrent/replayed callbacks do not resubmit the code. Only `LoginAttempts` should orchestrate an interactive flow; low-level `exchange` does not itself establish browser binding.

The adapter fixes RS256 verification rather than selecting algorithms from token input, distinguishes ID and API audiences, validates nonce/authorized party/expiry and optional access-token hash, and rejects remote key URLs in JOSE headers. It uses PyJWT for signature verification; no cryptographic verification is implemented here. [PyJWT API guidance](https://pyjwt.readthedocs.io/en/stable/api.html#jwt.decode), [OIDC ID Token validation](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation).

Discovery is bounded to 32 KiB; JWKS and token responses to 64 KiB. HTTP redirects, compressed responses, duplicate JSON fields and provider cookies across requests are rejected or excluded. Requests have an overall deadline (10 seconds by default), no environment proxy inheritance and a bounded connection pool. JWKS has a bounded lease (60 seconds by default, at most 300), serialized refresh and an unknown-key refresh throttle. Removed keys disappear after refresh; expired cache entries cannot rescue a failed refresh. Provider metadata is pinned until restart. A real provider should overlap old/new keys during rotation; an unknown key inside the throttle interval fails closed and requires a fresh login attempt.

Grant objects contain server-side tokens with their representations suppressed. No tokens are logged or written by this package. Do not serialize a grant to the browser or expose exception-local variables through diagnostics. No automatic refresh is implemented yet; retaining a refresh token in a grant is not a working renewal flow.

## HTTP session boundary

The configured origin must be canonical (scheme/host, optional non-default port, no path). HTTPS is required except for explicit loopback development. Production cookies use the `__Host-` prefix, HttpOnly, Secure, SameSite=Lax and Path=/ without Domain. HTTP loopback uses separate `cortex-dev-*` cookie names. Requests to a different Host/scheme are refused; this ASGI app does not trust forwarded headers. The local launcher disables Uvicorn access logs and proxy-header trust. Any future reverse proxy must preserve Host/scheme and exclude callback/query strings from its own logs; a production HTTPS topology has not been implemented or qualified.

| Endpoint | Behavior |
|---|---|
| `GET /auth/login?return_to=…` | Starts a bound attempt and redirects to the fixed issuer. The return route remains server-side. Only `/` with reviewed navigation parameters is allowed; no text query, source text, token, arbitrary route or external return URL. |
| `GET /auth/callback` | Exchanges one bound code, verifies identity, reads native `/v1/me`, then rotates an opaque session cookie. Denial/replay never installs a session. |
| `GET /auth/session` | Returns fresh native identity/membership, CSRF value and expiry; never API/refresh tokens. Cross-origin requests are refused. A failed native read returns no cached identity. |
| `POST /auth/logout` | Requires exact Origin and the session's CSRF value, accepts no body; removes the session and pending login, clears cookies. |

`SessionStore` is single-process and bounded to 256 sessions by default. Opaque handles are hashed in the store; idle (30 min), absolute (8 h), wall-clock token expiry and monotonic deadlines apply. Actual lifetime never exceeds the verified grant. Restart/shutdown revokes all sessions and attempts. Successful same-browser reauthentication rotates handle and CSRF atomically, including when capacity is reached. There is no silent eviction of active sessions. Refresh tokens are discarded until a separate renewal mechanism is implemented; expiry requires a fresh login.

Logout during an in-flight identity read masks the late data. Logout during reauthentication prevents the former session from being resurrected. A late 401 from an old session does not delete a newer cookie: the invalid handle is rejected server-side and expires by Max-Age or is replaced at login. The optional console adapter purges private cache on 401/expiry/logout; this is component-tested, with Chrome acceptance pending. Native identity reads are bounded to 64 KiB/512 domains, use only the verified grant's bearer/tenant, and do not relay browser headers or upstream cookies. Gateway work is bounded to 32 concurrent requests and 30 seconds overall, with bounded headers/query strings and no response caching. These are defensive limits, not a measured load capacity.

Return context supports domain, conversation, node, current publication-event tuple, supported view/mode flags and ISO time bounds. It does not yet restore camera/layout state outside those existing URL parameters. Unsupported parameters fail explicitly.

## Reviewed API proxy

Supplying `api_proxy` to `create_app` enables `/api/v1/*` for the 94 explicit method/route pairs (65 reads, 29 writes) currently used by `apps/console/src/api/operations.ts`. A contract test compares the two inventories. Unknown routes/methods, encoded path tricks, duplicate/unknown query keys, oversized bodies and non-object/duplicate-key/nonfinite JSON are rejected. The native API remains authoritative for request schemas, current permissions, idempotency and business decisions.

Only the server-side verified grant supplies Authorization and tenant headers. No browser Authorization, tenant, cookie, confirmation signature or arbitrary upstream header is relayed. POST operations require exact Origin and the current CSRF value. `/api/v1/me` uses the validated native identity reader. Personal import lists and details, collection reads, personal text import creation (`collections/{id}/imports`) and import commands (`imports/{id}/commands`) are allowed, as are the workspace writes for drafts, tasks, shared cases, reference reviews and agent missions. Approval, publication, ACL mutation and generic MCP routes are deliberately absent until their own reviewed user journeys exist; no implicit human confirmation is generated.

Bounds: 16 KiB for ordinary mutation requests, 2 MB for proposal bodies; 32 KiB for import details, 256 KiB for personal import pages, 64 KiB for collections/identity/version/scene/node responses, 1 MB for publication windows/difference summaries, and 8 MB for other reviewed responses. Errors are limited to 8 KiB and only reviewed status/code combinations are exposed. Requests exceeding limits fail explicitly; bodies are never truncated. Successful JSON payload bytes and idempotency keys pass through unchanged. No redirects, compressed upstream responses, upstream cookies or response headers are forwarded. The proxy has a 25-second total deadline and a bounded connection pool; these limits are not a load qualification.

Client disconnect or timeout cancels upstream work without retry. A mutation may already have committed, so a lost response remains uncertain. Logout/expiry during request-body reception prevents forwarding; logout/rotation/expiry during an upstream read suppresses its late result. A native 401 revokes the server session. The optional console adapter clears private caches and offers explicit recovery; its Chrome acceptance remains pending.

## Explicit local launch

Install the workspace with `uv sync --locked`. Configure the following environment variables in the local process, outside version control:

| Variable | Meaning |
|---|---|
| `CORTEX_BROWSER_ORIGIN` | Canonical browser origin, for example `http://127.0.0.1:5174`; callback is exactly `/auth/callback` on this origin |
| `CORTEX_BROWSER_ALLOW_LOOPBACK_HTTP` | `1` for explicit HTTP loopback development; default `0` |
| `CORTEX_BROWSER_ISSUER` | Exact configured OIDC issuer, with an existing client registration |
| `CORTEX_BROWSER_CLIENT_ID` | That registration's client ID |
| `CORTEX_BROWSER_API_AUDIENCE` | Audience expected by the native API, distinct from the client ID |
| `CORTEX_BROWSER_API_ORIGIN` | Fixed native API origin; no arbitrary path or query |
| `CORTEX_BROWSER_BIND`, `CORTEX_BROWSER_PORT` | Loopback listener, defaults `127.0.0.1:8015`; only `127.0.0.1` or `::1` is accepted |
| `CORTEX_BROWSER_SCOPE` | Optional requested scope, default `openid` |
| `CORTEX_BROWSER_CLIENT_SECRET_FILE` | Optional secret for `client_secret_basic`; omit for a public client |

The secret file must be an owned regular file with no group/other access, no symlink, at most 4096 bytes and one UTF-8 line. Keep it outside Git/public assets and do not echo it. No issuer, tenant, identity, secret or membership is automatically provisioned.

```sh
.venv/bin/cortex-browser-gateway --check
.venv/bin/cortex-browser-gateway
```

`--check` validates configuration without a network request or listener; it does not prove connectivity. The executable intentionally supports only local HTTP loopback development, one worker, no access log and no forwarded-header trust. The factory's HTTPS cookie support does not make this launcher production-ready. The console relay forwards `/auth` and `/api` unchanged while preserving browser Host/Origin when `VITE_DATA_MODE=api`, `VITE_AUTH_MODE=session` and an explicit `CORTEX_BROWSER_GATEWAY_TARGET` are configured. See the [console guide](../../apps/console/API-INTEGRATION.md#session-serveur-optionnelle--développement-local). The default manual Vite proxy still strips `/api` and targets the native API; changing only its target does not connect the session flow.

## Verification

From the repository root:

```sh
uv sync --locked
.venv/bin/python -m pytest -q tests/test_browser_gateway_oidc.py tests/test_browser_gateway_session.py tests/test_browser_gateway_proxy.py tests/test_browser_gateway_cli.py
.venv/bin/ruff check services/browser-gateway tests/test_browser_gateway_*.py
```

Evidence: **238 tests across protocol, session/HTTP, proxy and CLI passed together** on 5 October. Protocol coverage includes real RSA signatures, PKCE/claims, replay/concurrency, expiry, rotation/outage and response bounds. Session/proxy coverage includes cookies, Origin/CSRF, grant-only headers, safe returns, request/response bounds, cancellation/disconnect, uncertain mutation recovery and logout/reauthentication races. One protocol case uses an ephemeral issuer over real loopback HTTP; another case uses a real loopback ASGI server for login/callback/session, a proxied GET/POST and logout, with synthetic issuer/core transports. Both servers are shut down by their tests. Other cases use ASGI/HTTPX transports. None is Chrome, native business authorization or production-provider acceptance; no corpus or ACL mutation occurs.

### Complete synthetic native HTTP acceptance

`scripts/verify_browser_session.py` reuses an existing private synthetic AUD-02 fixture; it does not import/publish sources or change ACLs. The `synthetic_only` state marker, local test database and private runtime paths are required. It starts an automatic synthetic issuer, the actual gateway CLI, Vite in session mode and the existing native binary on ephemeral loopback ports. It closes its processes on success or failure. This issuer is a test fixture, never a user login service; use only the synthetic fixture keys.

```sh
# Load the existing local test environment without printing its credentials first.
.venv/bin/python scripts/verify_browser_session.py \
  --fixture .runtime/brain/aud02-native-20261005 \
  --output .runtime/brain/session-chain-new-run
```

On 6 October01:39 UTC, **8 grouped checks out of8 passed** through real HTTP: PKCE/native identity/session return context, callback replay, native source permissions and 200,000-character integrity, Origin/CSRF and idempotent conversation/proof, cookie restoration/rotation/logout, empty memberships, real expiry/relogin/readback, and absence of API/ID tokens in frontend response bodies/process logs. A run creates one synthetic conversation and one episode; repeated requests with the same key leave a single message. The two initial failures were incorrect test expectations (403 instead of the native anti-enumeration404); application code did not change. Final report: `.runtime/brain/aud01-chain-20261006-final/report.json`. The persistent corpus stayed at version5.

This is an HTTPX transport acceptance, not a React/browser test, load test or real provider deployment. Cookie attributes are asserted as headers; Chrome enforcement, refresh rendering, focus, mobile, keyboard and user interaction remain unverified. The earlier unit/component totals are not added to this denominator.

### Read-only native proposal review acceptance

`api_proposal` is now an allowed opaque return identifier only with a domain, with duplicate/malformed context refused. No business route was added (inventory remains29). `scripts/verify_browser_reviews.py --fixture .runtime/brain/aud02-native-20261005 --output .runtime/brain/review-chain-new-run` reuses the existing five synthetic proposals, decisions and sources without mutation. On6 October03:47 UTC, four grouped HTTP checks passed: owner listing/login context; proposal→comparison→proposal with intact200,000-character source and defer/reopen history; static reader permissions; unchanged versions. This is HTTPX, not React/Chrome or a real decision-race test. The report stores only labels/counts; process tokens stay in memory, logs are checked, processes stop in all cases. The local API HTTP workflow now calls this script on its same synthetic fixture; that GitHub job has not been executed.

## Next increment

Follow-up 6 October02:54 UTC: three read-only import/collection routes are integrated with the console. **155 session/proxy tests passed** after this change; the earlier 238-test full gateway result remains historical. `scripts/verify_browser_imports.py --fixture .runtime/brain/aud02-native-20261005 --output .runtime/brain/import-chain-new-run` adds or reuses one synthetic collection, two idempotent import lots/four files and one source through native APIs. It does not publish knowledge or change ACLs. Five grouped native HTTP checks passed: mixed real statuses, exact source/collection, pagination, personal permissions and unchanged publication version5. Its issuer/gateway/native processes stop afterward. No Vite/React/Chrome execution is part of this import harness. Report: `.runtime/brain/aud05-import-native-20261006/report.json`. Four import browser scenarios remain unqualified, as do the five session scenarios.

Exercise the session flow in Chrome once the reported extension blockage is cleared. The complete synthetic issuer/gateway/Vite/native HTTP transport now passes; it does not execute React or prove an authenticated browser journey. Preserve the manual setup until the new flow is qualified. Add atomic renewal as a separate capability; until then expiration requires login. The core remains responsible for current authorization; a session must not replace native permission checks.

The native confirmation verifier and owner workflow remain unchanged. Actual browser login, refresh, expiry/recovery, mobile, keyboard and a real provider must pass before AUD-01 can close. The Chrome extension blockage recorded in the delivery journal has not been bypassed.
