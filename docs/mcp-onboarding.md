# Connect a companion to Cortex Fusion

The server exposes Streamable HTTP at `/mcp/`, exhaustive application tools, read-only resources and user-selected prompts. It does not include a companion UI or an authorization server. The transport tests use an actual in-process MCP session with synthetic signed identities; no external companion or live enterprise identity provider has been validated yet.

## Discovery primitives

| Primitive | Purpose |
|---|---|
| `initialize` | Advertises tools/resources/prompts and returns the companion guide as server instructions |
| `cortex://guide` | Evidence, consent, provenance and confirmation protocol |
| `cortex://workspace` | Current subject, domain memberships and capabilities |
| `cortex://actions` | Action effects and decision policies; inventory is not authority |
| `cortex://domains/{domain_id}/context` | Authorized domain versions and personal feedback preferences |
| `ask_cortex(domain_id, question)` | Prepares a query with citations and an episode reference |
| `review_cortex_proposal(domain_id, proposal_id)` | Prepares inspection and a concrete review decision |
| `report_cortex_feedback(domain_id, episode_id)` | Prepares provenance-aware reporting for the caller's own episode |

Use `resources/list`, `resources/templates/list`, `resources/read`, `prompts/list` and `prompts/get` with their normal MCP request shapes. Inventory exports live in `packages/contracts/mcp-discovery.json`; CI checks them for drift. All discovery primitives require the same bearer identity and tenant transport headers as tools. Dynamic data is computed on every read; hosts must not reuse private context across users or tenant sessions.

Prompts validate the selected domain and, when applicable, proposal/episode permissions. Preparing a prompt never runs a query, records feedback, approves or publishes. Permission to inspect a proposal does not grant permission to approve it. A query prompt carries user-supplied text as data; JSON encoding does not make malicious text safe for an LLM. Hosts must continue to distinguish user intent, tool results and untrusted document/comment text.

## Bearer integration

For local development, supply a signed RS256 JWT accepted by the configured issuer/audience/public key or HTTPS JWKS, plus `X-Tenant-ID`. Use `api_identity_read` to discover actual memberships. Tenant selection is routing context, not permission. JWT role claims are not used as domain authority.

For public HTTPS discovery, explicitly configure:

```sh
CORTEX_MCP_PUBLIC_URL=https://cortex.example.com/mcp/
CORTEX_JWT_AUDIENCE=https://cortex.example.com/mcp/
CORTEX_JWT_ISSUER=https://identity.example.com/realms/cortex
CORTEX_JWKS_URL=https://identity.example.com/realms/cortex/protocol/openid-connect/certs
```

The issuer must issue an RS256 access token for this exact resource audience with `sub`, `iss`, `aud`, `iat` and `exp`. The resource URL must be canonical HTTPS with path `/mcp/`, no credentials, query or fragment. The configured issuer is advertised as the authorization server; configure a real issuer that provides its own OAuth/OIDC discovery and client registration policy. Key-file verification remains possible for deployments that manage keys explicitly.

When enabled, unauthenticated MCP requests return a `401` bearer challenge containing the configured `resource_metadata` URL. Public `GET /.well-known/oauth-protected-resource` returns the resource URI, issuer, header-only bearer method and resource name. This follows the protected-resource discovery and resource audience binding described by the [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization). When unconfigured, the metadata route returns `404 DISCOVERY_DISABLED` and the challenge is simply `Bearer`.

Metadata is built from server configuration, never from incoming Host or forwarded headers. The configured HTTPS host/origin is explicitly allowed in MCP transport protection; local loopback hosts remain available for operations. Other hosts/origins are rejected. A reverse proxy must terminate TLS and preserve the configured host or use an allowed loopback upstream host. This setting does not provision TLS, DNS or a public deployment.

## Host responsibilities and remaining validation

- Acquire and refresh tokens through the real issuer's client flow. This backend does not implement login, PKCE exchange, dynamic client registration, refresh tokens or token issuance.
- Supply the selected tenant in `X-Tenant-ID`. Clients without configurable transport headers need a host adapter. This remains a compatibility constraint even when OAuth metadata discovery works.
- Keep tokens and trusted-host confirmation signing keys outside model arguments. Follow [signed confirmation handling](mcp-exhaustive.md) for sensitive operations. A compatible host must collect the actual user decision before signing.
- Preserve idempotency keys, inspect state after uncertain outcomes, and display citations, served version and feedback origin faithfully.
- Re-read personal collection preferences and honor opt-out. See [feedback loop](feedback-loop.md).

No OAuth scope model is advertised by this increment; domain roles and object permissions remain enforced by the application. Deployment still requires an issuer and companion interoperability test, session/credential lifecycle policy and operational hardening. Exhaustive tool exposure and metadata discovery alone do not demonstrate compatibility with every LLM host.
