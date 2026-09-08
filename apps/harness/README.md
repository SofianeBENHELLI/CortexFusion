# Harness adapter

`src/core-client.ts` is a typed, cancellable HTTP client for query, concept inspection, proposal submission, and feedback. It has no approval/publication methods. It binds tenant and domain in application configuration and gets a fresh access token through a per-identity callback.

`src/cordis-plugin.ts` exposes that client as the `cortexKnowledge` service in Cordis. The actual published framework is tested for mounting and disposal-driven cancellation. It is a service integration seam, not the complete DeepSeek tool/model loop or a generic agent framework.

From the repository root, run `pnpm build && pnpm test`. Full authenticated HTTP/MCP behavior is tested by the Python/PostgreSQL suite. See the [development guide](../../docs/development.md).
