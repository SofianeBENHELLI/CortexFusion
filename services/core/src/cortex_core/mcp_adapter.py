"""MCP read/propose/feedback boundary. Owner commands are deliberately not agent tools."""

from uuid import UUID

from mcp.server.fastmcp import Context, FastMCP

from .contracts import FeedbackInput, ProposalInput, QueryInput


def create_mcp(service, auth):
    server = FastMCP(
        "Cortex Fusion", stateless_http=True, json_response=True, streamable_http_path="/"
    )

    def caller(ctx):
        request = ctx.request_context.request
        headers = request.headers if request else {}
        return auth.authenticate(headers.get("authorization"), headers.get("x-tenant-id"))

    @server.tool()
    def query(domain_id: UUID, question: str, ctx: Context, max_chars: int = 8000):
        """Return exact approved excerpts with source citations; no model synthesis."""
        return service.query(
            caller(ctx), str(domain_id), QueryInput(question=question, max_chars=max_chars)
        )

    @server.tool()
    def inspect_concept(domain_id: UUID, concept_id: UUID, ctx: Context):
        """Inspect a concept and only its authorized relationships."""
        return service.concept(caller(ctx), str(domain_id), str(concept_id))

    @server.tool()
    def propose(domain_id: UUID, proposal: ProposalInput, ctx: Context):
        """Submit a source-backed proposal; this cannot change trusted knowledge."""
        return service.propose(caller(ctx), str(domain_id), proposal)

    @server.tool()
    def feedback(domain_id: UUID, episode_id: UUID, feedback: FeedbackInput, ctx: Context):
        """Append feedback on your own authorized episode without rewriting knowledge."""
        return service.feedback(caller(ctx), str(domain_id), str(episode_id), feedback)

    return server
