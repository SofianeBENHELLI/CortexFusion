"""Application use cases. All stored knowledge is tenant-scoped and source-backed."""

import hashlib
import json
import re
from uuid import uuid4

from sqlalchemy import text

from .auth import CoreError, Principal
from .contracts import (
    ApprovalInput,
    Concept,
    ProposalInput,
    QueryResult,
    RollbackInput,
    SourceInput,
)
from .db import Database


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value):
    return hashlib.sha256(encoded(value).encode()).hexdigest()


def run(conn, sql, **params):
    return conn.execute(text(sql), params)


def one(conn, sql, **params):
    return run(conn, sql, **params).mappings().first()


class KnowledgeService:
    def __init__(self, db: Database):
        self.db = db

    @staticmethod
    def keys(p: Principal, domain: str):
        return {"tenant": p.tenant_id, "domain": domain}

    def _domain(self, conn, p, domain, lock=False):
        row = one(
            conn,
            "SELECT * FROM cf_domains WHERE tenant_id=:tenant AND id=:domain"
            + (" FOR UPDATE" if lock else ""),
            **self.keys(p, domain),
        )
        if not row:
            raise CoreError("NOT_FOUND", "Domain not found", 404)
        return row

    def _source(self, conn, p, domain, source_id):
        row = one(
            conn,
            "SELECT * FROM cf_sources WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id",
            **self.keys(p, domain),
            id=str(source_id),
        )
        if not row or p.subject not in row["allowed_subjects"]:
            raise CoreError("NOT_FOUND", "Source not found", 404)
        return row

    def _visible(self, conn, p, domain, concept):
        try:
            for ref in concept["sources"]:
                self._source(conn, p, domain, ref["source_id"])
            return True
        except CoreError:
            return False

    def _state(self, conn, p, domain):
        return {
            r["id"]: r["payload"]
            for r in run(
                conn,
                "SELECT id,payload FROM cf_concepts WHERE tenant_id=:tenant AND domain_id=:domain",
                **self.keys(p, domain),
            ).mappings()
        }

    def version(self, p, domain):
        with self.db.transaction(p, domain) as conn:
            d = self._domain(conn, p, domain)
            return {
                "domain_id": domain,
                "accepted_version": d["accepted_version"],
                "published_version": d["published_version"],
            }

    def create_source(self, p, domain, data: SourceInput):
        with self.db.transaction(p, domain, corpus=True) as conn:
            return self._create_source(conn, p, domain, data)

    def _create_source(self, conn, p, domain, data: SourceInput):
        payload = data.model_dump(mode="json")
        self._domain(conn, p, domain, lock=True)
        self._validate_subjects(conn, p, domain, payload["allowed_subjects"])
        if p.subject not in payload["allowed_subjects"]:
            raise CoreError("VALIDATION_FAILED", "Uploader must retain access", 422)
        if data.supersedes:
            self._source(conn, p, domain, data.supersedes)
        content_hash = hashlib.sha256(data.content.encode()).hexdigest()
        existing = one(
            conn,
            "SELECT * FROM cf_sources WHERE tenant_id=:tenant AND domain_id=:domain AND location=:location AND content_hash=:hash",
            **self.keys(p, domain),
            location=data.location,
            hash=content_hash,
        )
        if existing:
            self._source(conn, p, domain, existing["id"])
            if (
                existing["title"] != data.title
                or set(existing["allowed_subjects"]) != set(data.allowed_subjects)
                or existing["supersedes"] != payload["supersedes"]
            ):
                raise CoreError(
                    "IDEMPOTENCY_CONFLICT", "Source already exists with different metadata"
                )
            return self._source_view(existing)
        ident = str(uuid4())
        run(
            conn,
            """INSERT INTO cf_sources(tenant_id,domain_id,id,title,location,content,content_hash,allowed_subjects,supersedes)
                    VALUES(:tenant,:domain,:id,:title,:location,:content,:hash,CAST(:acl AS jsonb),:supersedes)""",
            **self.keys(p, domain),
            id=ident,
            title=data.title,
            location=data.location,
            content=data.content,
            hash=content_hash,
            acl=encoded(sorted(set(data.allowed_subjects))),
            supersedes=payload["supersedes"],
        )
        return self._source_view(self._source(conn, p, domain, ident))

    @staticmethod
    def _source_view(row):
        return {
            k: row[k]
            for k in ("id", "title", "location", "content_hash", "allowed_subjects", "supersedes")
        }

    def _validate_subjects(self, conn, p, domain, subjects):
        members = {
            r[0]
            for r in run(
                conn,
                "SELECT subject FROM cf_memberships WHERE tenant_id=:tenant AND domain_id=:domain",
                **self.keys(p, domain),
            )
        }
        if not set(subjects) <= members:
            raise CoreError("VALIDATION_FAILED", "Source readers must be domain members", 422)

    def source(self, p, domain, source_id):
        with self.db.transaction(p, domain) as conn:
            row = self._source(conn, p, domain, source_id)
            return {**self._source_view(row), "content": row["content"]}

    def set_access(self, p, domain, source_id, data):
        with self.db.transaction(p, domain, owner=True) as conn:
            self._domain(conn, p, domain, lock=True)
            self._source(conn, p, domain, source_id)
            self._validate_subjects(conn, p, domain, data.allowed_subjects)
            run(
                conn,
                "UPDATE cf_sources SET allowed_subjects=CAST(:acl AS jsonb) WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id",
                **self.keys(p, domain),
                id=source_id,
                acl=encoded(sorted(set(data.allowed_subjects))),
            )
            # Touch the domain row so concurrent approval snapshots cannot use an old access policy.
            run(
                conn,
                "UPDATE cf_domains SET accepted_version=accepted_version WHERE tenant_id=:tenant AND id=:domain",
                **self.keys(p, domain),
            )
            return {"source_id": source_id, "allowed_subjects": sorted(set(data.allowed_subjects))}

    def _validate_changes(self, conn, p, domain, changes, state):
        result = dict(state)
        touched = set()
        for change in changes:
            ident = (
                change["concept"]["concept_id"]
                if change["kind"] == "put_concept"
                else change["concept_id"]
            )
            if ident in touched:
                raise CoreError(
                    "VALIDATION_FAILED", "Each concept may be changed once per batch", 422
                )
            touched.add(ident)
            if ident in state and not self._visible(conn, p, domain, state[ident]):
                raise CoreError("NOT_FOUND", "Concept not found", 404)
            if change["kind"] == "retire_concept":
                if ident not in result:
                    raise CoreError("VALIDATION_FAILED", "Cannot retire a missing concept", 422)
                del result[ident]
                continue
            concept = change["concept"]
            spans = []
            for ref in concept["sources"]:
                source = self._source(conn, p, domain, ref["source_id"])
                if not 0 <= ref["start"] < ref["end"] <= len(source["content"]):
                    raise CoreError("VALIDATION_FAILED", "Invalid source span", 422)
                spans.append(source["content"][ref["start"] : ref["end"]])
            if concept["body"] != "\n\n".join(spans):
                raise CoreError(
                    "VALIDATION_FAILED", "This release accepts verbatim source excerpts only", 422
                )
            if concept["maturity"] == "reference":
                raise CoreError(
                    "REVIEW_POLICY_UNSUPPORTED",
                    "Reference maturity requires a later review policy",
                    422,
                )
            result[ident] = concept
        for ident, concept in result.items():
            parents = [link for link in concept["links"] if link["primary"]]
            if len(parents) > 1:
                raise CoreError("VALIDATION_FAILED", "One primary parent per concept", 422)
            if len({(link["target_id"], link["kind"]) for link in concept["links"]}) != len(
                concept["links"]
            ):
                raise CoreError("VALIDATION_FAILED", "Duplicate relationship", 422)
            for link in concept["links"]:
                if link["target_id"] not in result:
                    raise CoreError("VALIDATION_FAILED", "Relationship endpoint missing", 422)
                if ident in touched and not self._visible(
                    conn, p, domain, result[link["target_id"]]
                ):
                    raise CoreError("NOT_FOUND", "Relationship endpoint not found", 404)
        # Iterative topological check: no Python recursion limit on large domains.
        indegree = dict.fromkeys(result, 0)
        edges = {ident: [] for ident in result}
        for ident, concept in result.items():
            for link in concept["links"]:
                if link["kind"] == "structural":
                    edges[ident].append(link["target_id"])
                    indegree[link["target_id"]] += 1
        ready = [ident for ident, degree in indegree.items() if degree == 0]
        visited = 0
        while ready:
            ident = ready.pop()
            visited += 1
            for target in edges[ident]:
                indegree[target] -= 1
                if indegree[target] == 0:
                    ready.append(target)
        if visited != len(result):
            raise CoreError("VALIDATION_FAILED", "Structural relationship cycle", 422)
        return result

    def _proposal_view(self, row):
        return {
            k: row[k]
            for k in (
                "id",
                "base_version",
                "digest",
                "reason",
                "status",
                "validation",
                "payload",
                "review_revision",
                "replaces_id",
            )
        }

    def _propose(self, conn, p, domain, data: ProposalInput):
        payload = data.model_dump(mode="json")
        request_hash = digest(payload)
        existing = one(
            conn,
            "SELECT * FROM cf_proposals WHERE tenant_id=:tenant AND domain_id=:domain AND author=:author AND idempotency_key=:key",
            **self.keys(p, domain),
            author=p.subject,
            key=data.idempotency_key,
        )
        if existing:
            if existing["request_hash"] != request_hash:
                raise CoreError(
                    "IDEMPOTENCY_CONFLICT", "Idempotency key reused for different proposal"
                )
            self._check_proposal_access(conn, p, domain, existing)
            return self._proposal_view(existing)
        d = self._domain(conn, p, domain, lock=True)
        if data.base_version != d["published_version"]:
            raise CoreError("STALE_BASE", "Refresh the published knowledge version")
        state = self._state(conn, p, domain)
        validated_state = self._validate_changes(conn, p, domain, payload["changes"], state)
        evidence_sources = set()
        for change in payload["changes"]:
            concept = change.get("concept") or state.get(change["concept_id"])
            evidence_sources.update(ref["source_id"] for ref in concept["sources"])
            old = state.get(concept["concept_id"])
            if old:
                evidence_sources.update(ref["source_id"] for ref in old["sources"])
            # Proposal payloads also reveal relationship endpoints. Preserve their
            # evidence ACLs even if the linked concept is subsequently retired.
            for obj, snapshot in ((concept, validated_state), (old, state)):
                if obj:
                    for link in obj["links"]:
                        target = snapshot.get(link["target_id"])
                        if target:
                            evidence_sources.update(ref["source_id"] for ref in target["sources"])
        proposal_digest = digest(
            {
                "tenant": p.tenant_id,
                "domain": domain,
                "base": data.base_version,
                "changes": payload["changes"],
                "reason": data.reason,
            }
        )
        ident = str(uuid4())
        validation = {
            "status": "passed",
            "source_support": "verbatim_v1",
            "graph": "acyclic",
            "policy": "owner_low_risk_v1",
            "risk": "low",
            "source_ids": sorted(evidence_sources),
        }
        run(
            conn,
            """INSERT INTO cf_proposals(tenant_id,domain_id,id,author,base_version,payload,digest,reason,validation,idempotency_key,request_hash)
                    VALUES(:tenant,:domain,:id,:author,:base,CAST(:payload AS jsonb),:digest,:reason,CAST(:validation AS jsonb),:key,:hash)""",
            **self.keys(p, domain),
            id=ident,
            author=p.subject,
            base=data.base_version,
            payload=encoded(payload["changes"]),
            digest=proposal_digest,
            reason=data.reason,
            validation=encoded(validation),
            key=data.idempotency_key,
            hash=request_hash,
        )
        return self._proposal_view(
            one(
                conn,
                "SELECT * FROM cf_proposals WHERE tenant_id=:tenant AND id=:id",
                tenant=p.tenant_id,
                id=ident,
            )
        )

    def propose(self, p, domain, data):
        with self.db.transaction(p, domain, write=True) as conn:
            return self._propose(conn, p, domain, data)

    def _check_proposal_access(self, conn, p, domain, row):
        for source_id in row["validation"].get("source_ids", []):
            self._source(conn, p, domain, source_id)
        self._check_change_access(conn, p, domain, row["payload"])

    def _check_change_access(self, conn, p, domain, changes):
        state = None
        for change in changes:
            if change["kind"] == "put_concept":
                if not self._visible(conn, p, domain, change["concept"]):
                    raise CoreError("NOT_FOUND", "Proposal not found", 404)
            else:
                state = state or self._state(conn, p, domain)
                concept = state.get(change["concept_id"])
                if concept and not self._visible(conn, p, domain, concept):
                    raise CoreError("NOT_FOUND", "Proposal not found", 404)

    def proposal(self, p, domain, ident):
        with self.db.transaction(p, domain, write=True) as conn:
            row = one(
                conn,
                "SELECT * FROM cf_proposals WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id",
                **self.keys(p, domain),
                id=ident,
            )
            if not row:
                raise CoreError("NOT_FOUND", "Proposal not found", 404)
            self._check_proposal_access(conn, p, domain, row)
            return self._proposal_view(row)

    def approve(self, p, domain, ident, data: ApprovalInput):
        with self.db.transaction(p, domain, owner=True) as conn:
            d = self._domain(conn, p, domain, lock=True)
            request_hash = digest({"proposal": ident, **data.model_dump(mode="json")})
            existing = one(
                conn,
                "SELECT * FROM cf_commits WHERE tenant_id=:tenant AND domain_id=:domain AND author=:author AND decision_key=:key",
                **self.keys(p, domain),
                author=p.subject,
                key=data.idempotency_key,
            )
            if existing:
                if existing["decision_hash"] != request_hash:
                    raise CoreError("IDEMPOTENCY_CONFLICT", "Decision key reused")
                return {"sequence": existing["sequence"], "proposal_id": ident, "accepted": True}
            proposal = one(
                conn,
                "SELECT * FROM cf_proposals WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id",
                **self.keys(p, domain),
                id=ident,
            )
            if not proposal:
                raise CoreError("NOT_FOUND", "Proposal not found", 404)
            self._check_proposal_access(conn, p, domain, proposal)
            if (
                proposal["digest"] != data.digest
                or proposal["status"] != "ready"
                or proposal["review_revision"] != data.expected_review_revision
            ):
                raise CoreError("STALE_BASE", "Proposal changed or was already decided")
            if d["accepted_version"] != d["published_version"]:
                raise CoreError(
                    "PUBLICATION_PENDING", "Publish the accepted batch before another approval"
                )
            if (
                proposal["base_version"] != data.expected_version
                or data.expected_version != d["published_version"]
            ):
                raise CoreError("STALE_BASE", "Proposal base no longer current")
            state = self._state(conn, p, domain)
            self._validate_changes(conn, p, domain, proposal["payload"], state)
            touched = [
                c["concept"]["concept_id"] if c["kind"] == "put_concept" else c["concept_id"]
                for c in proposal["payload"]
            ]
            before = {ident: state.get(ident) for ident in touched}
            seq = d["accepted_version"] + 1
            run(
                conn,
                """INSERT INTO cf_commits(tenant_id,domain_id,sequence,proposal_id,author,reason,digest,changes,before_state,decision_key,decision_hash)
                        VALUES(:tenant,:domain,:seq,:proposal,:author,:reason,:digest,CAST(:changes AS jsonb),CAST(:before AS jsonb),:key,:hash)""",
                **self.keys(p, domain),
                seq=seq,
                proposal=ident,
                author=p.subject,
                reason=data.reason,
                digest=data.digest,
                changes=encoded(proposal["payload"]),
                before=encoded(before),
                key=data.idempotency_key,
                hash=request_hash,
            )
            run(
                conn,
                "INSERT INTO cf_outbox(tenant_id,domain_id,sequence) VALUES(:tenant,:domain,:seq)",
                **self.keys(p, domain),
                seq=seq,
            )
            run(
                conn,
                "UPDATE cf_domains SET accepted_version=:seq WHERE tenant_id=:tenant AND id=:domain",
                **self.keys(p, domain),
                seq=seq,
            )
            run(
                conn,
                "UPDATE cf_proposals SET status='approved' WHERE tenant_id=:tenant AND id=:id",
                tenant=p.tenant_id,
                id=ident,
            )
            return {"sequence": seq, "proposal_id": ident, "accepted": True}

    def _apply(self, conn, p, domain, sequence, changes):
        for change in changes:
            if change["kind"] == "put_concept":
                concept = change["concept"]
                run(
                    conn,
                    """INSERT INTO cf_concepts(tenant_id,domain_id,id,payload,version)
                    VALUES(:tenant,:domain,:id,CAST(:payload AS jsonb),:seq)
                    ON CONFLICT(tenant_id,domain_id,id) DO UPDATE SET payload=EXCLUDED.payload,version=EXCLUDED.version""",
                    **self.keys(p, domain),
                    id=concept["concept_id"],
                    payload=encoded(concept),
                    seq=sequence,
                )
            else:
                run(
                    conn,
                    "DELETE FROM cf_concepts WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id",
                    **self.keys(p, domain),
                    id=change["concept_id"],
                )

    def publish(self, p, domain):
        with self.db.transaction(p, domain, owner=True) as conn:
            d = self._domain(conn, p, domain, lock=True)
            return self._publish(conn, p, domain, d)

    def _publish(self, conn, p, domain, d):
        """Apply the next accepted commit inside the caller's locked transaction."""
        if d["published_version"] == d["accepted_version"]:
            return {"published_version": d["published_version"], "changed": False}
        seq = d["published_version"] + 1
        commit = one(
            conn,
            "SELECT * FROM cf_commits WHERE tenant_id=:tenant AND domain_id=:domain AND sequence=:seq",
            **self.keys(p, domain),
            seq=seq,
        )
        proposal = one(
            conn,
            "SELECT * FROM cf_proposals WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id",
            **self.keys(p, domain),
            id=commit["proposal_id"],
        )
        self._check_proposal_access(conn, p, domain, proposal)
        self._apply(conn, p, domain, seq, commit["changes"])
        run(
            conn,
            """INSERT INTO cf_publications(tenant_id,domain_id,sequence,publisher)
            VALUES(:tenant,:domain,:seq,:publisher)""",
            **self.keys(p, domain),
            seq=seq,
            publisher=p.subject,
        )
        run(
            conn,
            "UPDATE cf_outbox SET status='done',attempts=attempts+1 WHERE tenant_id=:tenant AND domain_id=:domain AND sequence=:seq",
            **self.keys(p, domain),
            seq=seq,
        )
        run(
            conn,
            "UPDATE cf_proposals SET status='published' WHERE tenant_id=:tenant AND id=:id",
            tenant=p.tenant_id,
            id=commit["proposal_id"],
        )
        run(
            conn,
            "UPDATE cf_domains SET published_version=:seq WHERE tenant_id=:tenant AND id=:domain",
            **self.keys(p, domain),
            seq=seq,
        )
        return {"published_version": seq, "changed": True}

    def publish_proposal(self, p, domain, ident, data):
        with self.db.transaction(p, domain, owner=True, isolation="READ COMMITTED") as conn:
            d = self._domain(conn, p, domain, lock=True)
            membership = one(
                conn,
                "SELECT role FROM cf_memberships WHERE tenant_id=:tenant AND domain_id=:domain AND subject=:subject",
                **self.keys(p, domain),
                subject=p.subject,
            )
            if not membership or membership["role"] != "owner":
                raise CoreError("NOT_AUTHORIZED", "Domain owner required", 403)
            proposal = one(
                conn,
                "SELECT * FROM cf_proposals WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id",
                **self.keys(p, domain),
                id=ident,
            )
            if not proposal:
                raise CoreError("NOT_FOUND", "Proposal not found", 404)
            self._check_proposal_access(conn, p, domain, proposal)
            commit = one(
                conn,
                "SELECT sequence FROM cf_commits WHERE tenant_id=:tenant AND domain_id=:domain AND proposal_id=:id",
                **self.keys(p, domain),
                id=ident,
            )
            if proposal["status"] not in ("approved", "published") or not commit:
                raise CoreError(
                    "PUBLICATION_NOT_ACCEPTED", "Accept the target proposal before publication"
                )
            sequence = commit["sequence"]
            if sequence != data.expected_published_version + 1:
                raise CoreError(
                    "STALE_PUBLICATION", "Expected version does not identify this accepted change"
                )
            if sequence <= d["published_version"]:
                result = {"published_version": d["published_version"], "changed": False}
            else:
                if d["published_version"] != data.expected_published_version:
                    raise CoreError("STALE_PUBLICATION", "Refresh the target and published version")
                result = self._publish(conn, p, domain, d)
            return {"proposal_id": ident, "target_version": sequence, **result}

    def replay(self, p, domain):
        with self.db.transaction(p, domain, owner=True) as conn:
            d = self._domain(conn, p, domain, lock=True)
            run(
                conn,
                "DELETE FROM cf_concepts WHERE tenant_id=:tenant AND domain_id=:domain",
                **self.keys(p, domain),
            )
            commits = (
                run(
                    conn,
                    "SELECT sequence,changes FROM cf_commits WHERE tenant_id=:tenant AND domain_id=:domain AND sequence<=:published ORDER BY sequence",
                    **self.keys(p, domain),
                    published=d["published_version"],
                )
                .mappings()
                .all()
            )
            for commit in commits:
                self._apply(conn, p, domain, commit["sequence"], commit["changes"])
            state = self._state(conn, p, domain)
            visible = {
                ident: value
                for ident, value in state.items()
                if self._visible(conn, p, domain, value)
            }
            visible = {
                ident: {
                    **value,
                    "links": [link for link in value["links"] if link["target_id"] in visible],
                }
                for ident, value in visible.items()
            }
            return {
                "published_version": d["published_version"],
                "concept_count": len(visible),
                "state_hash": digest(visible),
            }

    def rollback_proposal(self, p, domain, sequence, data: RollbackInput):
        with self.db.transaction(p, domain, owner=True) as conn:
            d = self._domain(conn, p, domain, lock=True)
            commit = one(
                conn,
                "SELECT * FROM cf_commits WHERE tenant_id=:tenant AND domain_id=:domain AND sequence=:seq",
                **self.keys(p, domain),
                seq=sequence,
            )
            if not commit or sequence > d["published_version"]:
                raise CoreError("NOT_FOUND", "Published change not found", 404)
            changes = [
                {"kind": "put_concept", "concept": value}
                if value
                else {"kind": "retire_concept", "concept_id": ident}
                for ident, value in commit["before_state"].items()
            ]
            request = ProposalInput(
                base_version=data.expected_version,
                changes=changes,
                reason=f"Compensate change {sequence}: {data.reason}",
                idempotency_key=data.idempotency_key,
            )
            existing = one(
                conn,
                "SELECT id FROM cf_proposals WHERE tenant_id=:tenant AND domain_id=:domain AND author=:author AND idempotency_key=:key",
                **self.keys(p, domain),
                author=p.subject,
                key=data.idempotency_key,
            )
            if existing:
                return self._propose(conn, p, domain, request)
            if d["accepted_version"] != d["published_version"]:
                raise CoreError(
                    "PUBLICATION_PENDING", "Publication must finish before compensation"
                )
            touched = set(commit["before_state"])
            later = run(
                conn,
                "SELECT changes FROM cf_commits WHERE tenant_id=:tenant AND domain_id=:domain AND sequence>:seq",
                **self.keys(p, domain),
                seq=sequence,
            ).scalars()
            for batch in later:
                for change in batch:
                    obj = change.get("concept")
                    ident = obj["concept_id"] if obj else change["concept_id"]
                    if ident in touched or (
                        obj and any(link["target_id"] in touched for link in obj["links"])
                    ):
                        raise CoreError(
                            "DEPENDENT_CHANGE",
                            "Later changes depend on this change; create a revised proposal",
                        )
            return self._propose(conn, p, domain, request)

    def concepts(self, p, domain):
        with self.db.transaction(p, domain) as conn:
            state = self._state(conn, p, domain)
            visible = {
                ident: value
                for ident, value in state.items()
                if self._visible(conn, p, domain, value)
            }
            return [
                Concept.model_validate(
                    {
                        **value,
                        "links": [link for link in value["links"] if link["target_id"] in visible],
                    }
                ).model_dump(mode="json")
                for value in sorted(visible.values(), key=lambda c: (c["title"], c["concept_id"]))
            ]

    def concept(self, p, domain, ident):
        for concept in self.concepts(p, domain):
            if concept["concept_id"] == ident:
                return concept
        raise CoreError("NOT_FOUND", "Concept not found", 404)

    def ingest_source(self, p, domain, source_id, key):
        """Deterministic Markdown/text seed: preserve entire source paragraphs verbatim."""
        with self.db.transaction(p, domain, write=True) as conn:
            source = self._source(conn, p, domain, source_id)
            d = self._domain(conn, p, domain)
            content = source["content"]
            if len(content) > 30000:
                raise CoreError(
                    "VALIDATION_FAILED",
                    "Split text into sources smaller than 30,000 characters",
                    422,
                )
            from uuid import NAMESPACE_URL, uuid5

            ident = str(uuid5(NAMESPACE_URL, f"cortex:{p.tenant_id}:{domain}:{source_id}"))
            changes = [
                {
                    "kind": "put_concept",
                    "concept": {
                        "concept_id": ident,
                        "title": source["title"],
                        "body": content,
                        "maturity": "emerging",
                        "sources": [{"source_id": source_id, "start": 0, "end": len(content)}],
                        "links": [],
                    },
                }
            ]
            existing = one(
                conn,
                "SELECT base_version FROM cf_proposals WHERE tenant_id=:tenant AND domain_id=:domain AND author=:author AND idempotency_key=:key",
                **self.keys(p, domain),
                author=p.subject,
                key=key,
            )
            return self._propose(
                conn,
                p,
                domain,
                ProposalInput(
                    base_version=existing["base_version"] if existing else d["published_version"],
                    changes=changes,
                    reason="Verbatim file import; owner review required",
                    idempotency_key=key,
                ),
            )

    def query(self, p, domain, data, conversation_id=None):
        with self.db.transaction(p, domain) as conn:
            if conversation_id:
                self._conversation(conn, p, domain, conversation_id, active=True)
                previous = self._conversation_retry(conn, p, domain, conversation_id, data)
                if previous:
                    return previous

            d = self._domain(conn, p, domain)
            state = self._state(conn, p, domain)
            visible = {ident: c for ident, c in state.items() if self._visible(conn, p, domain, c)}
            terms = set(re.findall(r"\w{3,}", data.question.casefold())) - {
                "the",
                "what",
                "how",
                "does",
                "are",
                "and",
                "les",
                "des",
                "une",
                "est",
                "quel",
                "pour",
            }
            ranked = []
            for concept in visible.values():
                words = set(
                    re.findall(r"\w{3,}", (concept["title"] + " " + concept["body"]).casefold())
                )
                score = len(terms & words)
                if score:
                    ranked.append((score, concept))
            ranked.sort(key=lambda pair: (-pair[0], pair[1]["concept_id"]))
            selected, citations, snippets, used = [], [], [], 0
            for _, concept in ranked:
                if len(selected) >= data.limit:
                    break
                if used + len(concept["body"]) > data.max_chars:
                    continue
                safe = {
                    **concept,
                    "links": [link for link in concept["links"] if link["target_id"] in visible],
                }
                selected.append(safe)
                used += len(concept["body"])
                snippets.append(concept["body"])
                for ref in concept["sources"]:
                    source = self._source(conn, p, domain, ref["source_id"])
                    citations.append(
                        {
                            "source_id": source["id"],
                            "title": source["title"],
                            "location": source["location"],
                            "content_hash": source["content_hash"],
                            "start": ref["start"],
                            "end": ref["end"],
                            "excerpt": source["content"][ref["start"] : ref["end"]],
                        }
                    )
            episode = str(uuid4())
            result = QueryResult(
                episode_id=episode,
                answer="\n\n".join(snippets)
                if snippets
                else "No matching approved evidence was found within the requested context budget.",
                status="evidence_found" if snippets else "knowledge_gap",
                served_version=d["published_version"],
                concepts=selected,
                citations=citations,
            ).model_dump(mode="json")
            source_ids = sorted({c["source_id"] for c in citations})
        # Context snapshot is closed before writing the episode. A publication can update
        # the domain while retrieval runs; its FK must be checked against current state.
        with self.db.transaction(p, domain, isolation="READ COMMITTED") as conn:
            run(
                conn,
                "SELECT id FROM cf_domains WHERE tenant_id=:tenant AND id=:domain FOR KEY SHARE",
                **self.keys(p, domain),
            )
            if not one(
                conn,
                "SELECT subject FROM cf_memberships WHERE tenant_id=:tenant AND domain_id=:domain AND subject=:subject",
                **self.keys(p, domain),
                subject=p.subject,
            ):
                raise CoreError("NOT_FOUND", "Domain not found", 404)
            if conversation_id:
                self._conversation(conn, p, domain, conversation_id, lock=True, active=True)
                previous = self._conversation_retry(conn, p, domain, conversation_id, data)
                if previous:
                    return previous
            # Access changes take the conflicting domain lock, establishing the answer's
            # authorization boundary before the episode is recorded and returned.
            for source_id in source_ids:
                self._source(conn, p, domain, source_id)
            run(
                conn,
                """INSERT INTO cf_episodes(tenant_id,domain_id,id,subject,question,result,source_ids,served_version)
                        VALUES(:tenant,:domain,:id,:subject,:question,CAST(:result AS jsonb),CAST(:sources AS jsonb),:version)""",
                **self.keys(p, domain),
                id=episode,
                subject=p.subject,
                question=data.question,
                result=encoded(result),
                sources=encoded(source_ids),
                version=d["published_version"],
            )
            if conversation_id:
                run(
                    conn,
                    """INSERT INTO cf_conversation_episodes
                    (tenant_id,domain_id,conversation_id,episode_id,sequence,idempotency_key,request_hash)
                    SELECT :tenant,:domain,:conversation,:episode,COALESCE(max(sequence),0)+1,:key,:hash
                    FROM cf_conversation_episodes WHERE tenant_id=:tenant AND domain_id=:domain AND conversation_id=:conversation""",
                    **self.keys(p, domain),
                    conversation=conversation_id,
                    episode=episode,
                    key=data.idempotency_key,
                    hash=digest(data.model_dump(mode="json")),
                )
            if not snippets:
                self._issue(conn, p, domain, episode, "knowledge_gap", data.question)
        return result

    def _episode(self, conn, p, domain, ident):
        row = one(
            conn,
            "SELECT * FROM cf_episodes WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id AND subject=:subject",
            **self.keys(p, domain),
            id=ident,
            subject=p.subject,
        )
        if not row:
            raise CoreError("NOT_FOUND", "Episode not found", 404)
        for source_id in row["source_ids"]:
            self._source(conn, p, domain, source_id)
        return row

    def episode(self, p, domain, ident):
        with self.db.transaction(p, domain) as conn:
            return self._episode(conn, p, domain, ident)["result"]

    def feedback(self, p, domain, ident, data):
        with self.db.transaction(p, domain) as conn:
            self._episode(conn, p, domain, ident)
            payload = data.model_dump(mode="json")
            h = digest({"episode": ident, **payload})
            existing = one(
                conn,
                "SELECT id,request_hash FROM cf_feedback WHERE tenant_id=:tenant AND domain_id=:domain AND subject=:subject AND idempotency_key=:key",
                **self.keys(p, domain),
                subject=p.subject,
                key=data.idempotency_key,
            )
            if existing:
                if existing["request_hash"] != h:
                    raise CoreError("IDEMPOTENCY_CONFLICT", "Feedback key reused")
                return {"feedback_id": existing["id"]}
            feedback_id = str(uuid4())
            run(
                conn,
                """INSERT INTO cf_feedback(tenant_id,domain_id,id,episode_id,subject,payload,idempotency_key,request_hash)
                        VALUES(:tenant,:domain,:id,:episode,:subject,CAST(:payload AS jsonb),:key,:hash)""",
                **self.keys(p, domain),
                id=feedback_id,
                episode=ident,
                subject=p.subject,
                payload=encoded(payload),
                key=data.idempotency_key,
                hash=h,
            )
            if data.rating == "unhelpful":
                self._issue(conn, p, domain, ident, "disputed_answer", data.explanation)
            return {"feedback_id": feedback_id}

    def _issue(self, conn, p, domain, episode, kind, reason):
        run(
            conn,
            "INSERT INTO cf_issues(tenant_id,domain_id,id,episode_id,kind,reason) VALUES(:tenant,:domain,:id,:episode,:kind,:reason)",
            **self.keys(p, domain),
            id=str(uuid4()),
            episode=episode,
            kind=kind,
            reason=reason,
        )

    def brief(self, p, domain):
        with self.db.transaction(p, domain, owner=True) as conn:
            d = self._domain(conn, p, domain)
            proposals = run(
                conn,
                "SELECT * FROM cf_proposals WHERE tenant_id=:tenant AND domain_id=:domain AND status='ready' ORDER BY created_at",
                **self.keys(p, domain),
            ).mappings()
            pending = []
            for row in proposals:
                try:
                    self._check_proposal_access(conn, p, domain, row)
                    pending.append(self._proposal_view(row))
                except CoreError:
                    pass
            # Only the owner's own authorized episodes: counts cannot reveal others' activity.
            issues = []
            for row in run(
                conn,
                "SELECT i.* FROM cf_issues i JOIN cf_episodes e USING(tenant_id,domain_id) WHERE i.tenant_id=:tenant AND i.domain_id=:domain AND e.id=i.episode_id AND e.subject=:subject AND i.status IN ('open','in_progress') ORDER BY i.created_at",
                **self.keys(p, domain),
                subject=p.subject,
            ).mappings():
                try:
                    self._episode(conn, p, domain, row["episode_id"])
                    issues.append({k: row[k] for k in ("id", "kind", "reason", "episode_id")})
                except CoreError:
                    pass
            return {
                "accepted_version": d["accepted_version"],
                "published_version": d["published_version"],
                "pending_proposals": pending,
                "issues": issues,
                "processing": "local_no_model",
                "model_calls": 0,
            }

    def _conversation(self, conn, p, domain, ident, lock=False, active=False):
        row = one(
            conn,
            "SELECT * FROM cf_conversations WHERE tenant_id=:tenant AND domain_id=:domain AND id=:id AND author=:author"
            + (" FOR UPDATE" if lock else ""),
            **self.keys(p, domain),
            id=ident,
            author=p.subject,
        )
        if not row:
            raise CoreError("NOT_FOUND", "Conversation not found", 404)
        if active and row["archived"]:
            raise CoreError(
                "CONVERSATION_ARCHIVED", "Restore the conversation before asking a question"
            )
        return row

    def _conversation_retry(self, conn, p, domain, ident, data):
        row = one(
            conn,
            "SELECT * FROM cf_conversation_episodes WHERE tenant_id=:tenant AND domain_id=:domain AND conversation_id=:id AND idempotency_key=:key",
            **self.keys(p, domain),
            id=ident,
            key=data.idempotency_key,
        )
        if row:
            if row["request_hash"] != digest(data.model_dump(mode="json")):
                raise CoreError("IDEMPOTENCY_CONFLICT", "Question key reused")
            return self._episode(conn, p, domain, row["episode_id"])["result"]
        return None
