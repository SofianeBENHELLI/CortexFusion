from threading import BoundedSemaphore
from uuid import NAMESPACE_URL, uuid4, uuid5

from .auth import CoreError
from .contracts import ProposalInput
from .service import digest, encoded, one, run
from .workspace import WorkspaceService


class ExtractionService:
    def __init__(self, knowledge, model):
        self.k, self.db, self.model = knowledge, knowledge.db, model
        self.slot = BoundedSemaphore(1)

    def _existing(self, conn, p, domain, key, fingerprint):
        row = one(
            conn,
            "SELECT * FROM cf_extractions WHERE tenant_id=:tenant AND domain_id=:domain AND author=:author AND idempotency_key=:key",
            **self.k.keys(p, domain),
            author=p.subject,
            key=key,
        )
        if row:
            self.k._source(conn, p, domain, row["source_id"])
            if row["request_hash"] != fingerprint:
                raise CoreError("IDEMPOTENCY_CONFLICT", "Extraction key reused")
            proposal = WorkspaceService(self.k)._proposal(conn, p, domain, row["proposal_id"])
            return {
                "id": row["id"],
                "proposal": self.k._proposal_view(proposal),
                **row["model_metadata"],
                "processing": "openrouter_passage_selection"
                if row["model_metadata"].get("provider") == "openrouter"
                else "local_model_passage_selection",
            }
        return None

    def extract(self, p, domain, source_id, data, expected_provider="ollama"):
        if self.model is None:
            raise CoreError("MODEL_DISABLED", "Model extraction is not configured", 503)
        if getattr(self.model, "provider", "ollama") != expected_provider:
            raise CoreError(
                "DESTINATION_MISMATCH",
                "Requested destination differs from the configured model provider",
                422,
            )
        fingerprint = digest({"source": source_id, **data.model_dump(mode="json")})
        with self.db.transaction(p, domain, owner=True) as conn:
            source = self.k._source(conn, p, domain, source_id)
            old = self._existing(conn, p, domain, data.idempotency_key, fingerprint)
            if old:
                return old
        if not self.slot.acquire(blocking=False):
            raise CoreError("MODEL_BUSY", "A model extraction is already running", 503)
        try:
            selection = self.model.select(source["content"])
            # Independent boundary check, even when a model adapter is replaced.
            start, end = selection["start"], selection["end"]
            if (
                type(start) is not int
                or type(end) is not int
                or not (0 <= start < end <= len(source["content"]))
                or source["content"][start:end] != selection["quote"]
            ):
                raise CoreError(
                    "UNSUPPORTED_MODEL_OUTPUT", "Selected passage is not supported", 422
                )
            with self.db.transaction(p, domain, owner=True) as conn:
                domain_row = self.k._domain(conn, p, domain, lock=True)
                self.k._source(conn, p, domain, source_id)
                old = self._existing(conn, p, domain, data.idempotency_key, fingerprint)
                if old:
                    return old
                proposal = self.k._propose(
                    conn,
                    p,
                    domain,
                    ProposalInput(
                        base_version=domain_row["published_version"],
                        changes=[
                            {
                                "kind": "put_concept",
                                "concept": {
                                    "concept_id": str(
                                        uuid5(
                                            NAMESPACE_URL,
                                            f"{p.tenant_id}:{domain}:{source_id}:{digest(selection['quote'])}",
                                        )
                                    ),
                                    "title": source["title"],
                                    "body": selection["quote"],
                                    "sources": [
                                        {"source_id": source_id, "start": start, "end": end}
                                    ],
                                },
                            }
                        ],
                        reason="Configured model selected an exact source passage; owner review required.",
                        idempotency_key="extract:" + digest(data.idempotency_key),
                    ),
                )
                metadata = {
                    k: selection[k]
                    for k in (
                        "model",
                        "model_digest",
                        "prompt_version",
                        "input_tokens",
                        "output_tokens",
                    )
                }
                metadata.update(
                    provider=getattr(self.model, "provider", "ollama"),
                    request_id=selection.get("request_id"),
                    cost_usd=selection.get("cost_usd"),
                )
                ident = str(uuid4())
                run(
                    conn,
                    """INSERT INTO cf_extractions(tenant_id,domain_id,id,author,source_id,proposal_id,model_metadata,idempotency_key,request_hash)
                    VALUES(:tenant,:domain,:id,:author,:source,:proposal,CAST(:metadata AS jsonb),:key,:hash)""",
                    **self.k.keys(p, domain),
                    id=ident,
                    author=p.subject,
                    source=source_id,
                    proposal=proposal["id"],
                    metadata=encoded(metadata),
                    key=data.idempotency_key,
                    hash=fingerprint,
                )
                return {
                    "id": ident,
                    "proposal": proposal,
                    **metadata,
                    "processing": "openrouter_passage_selection"
                    if metadata["provider"] == "openrouter"
                    else "local_model_passage_selection",
                }
        finally:
            self.slot.release()

    def receipt(self, p, domain, ident):
        with self.db.transaction(p, domain, owner=True) as conn:
            row = one(
                conn,
                "SELECT * FROM cf_extractions WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id AND author=:author",
                **self.k.keys(p, domain),
                id=ident,
                author=p.subject,
            )
            if not row:
                raise CoreError("NOT_FOUND", "Extraction receipt not found", 404)
            return self._existing(conn, p, domain, row["idempotency_key"], row["request_hash"])
