"""Typed contract source; exported JSON Schema is checked into packages/contracts."""

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)


class Maturity(StrEnum):
    EMERGING = "emerging"
    OBSERVED = "observed"
    ESTABLISHED = "established"
    REFERENCE = "reference"


class SourceRef(Contract):
    source_id: UUID
    start: int = Field(ge=0, description="Zero-based Unicode code point offset, inclusive")
    end: int = Field(gt=0, description="Unicode code point offset, exclusive; not UTF-16 units")

    @model_validator(mode="after")
    def ordered(self):
        if self.end <= self.start:
            raise ValueError("end must be greater than start")
        return self


class Link(Contract):
    target_id: UUID
    kind: Literal["structural", "associative"]
    primary: bool = False
    weight: float = Field(default=1.0, ge=0, le=1, allow_inf_nan=False)

    @model_validator(mode="after")
    def primary_is_structural(self):
        if self.primary and self.kind != "structural":
            raise ValueError("only structural parent links may be primary")
        return self


class Concept(Contract):
    concept_id: UUID
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=30000)
    maturity: Maturity = Maturity.EMERGING
    sources: list[SourceRef] = Field(min_length=1, max_length=30)
    links: list[Link] = Field(default_factory=list, max_length=100)


class PutConcept(Contract):
    kind: Literal["put_concept"] = "put_concept"
    concept: Concept


class RetireConcept(Contract):
    kind: Literal["retire_concept"] = "retire_concept"
    concept_id: UUID


Change = Annotated[PutConcept | RetireConcept, Field(discriminator="kind")]


class ProposalInput(Contract):
    base_version: int = Field(ge=0)
    changes: list[Change] = Field(min_length=1, max_length=50)
    reason: str = Field(min_length=1, max_length=2000)
    idempotency_key: str = Field(min_length=8, max_length=128)


class ApprovalInput(Contract):
    expected_review_revision: int = Field(default=0, ge=0)
    digest: str = Field(pattern=r"^[a-f0-9]{64}$")
    expected_version: int = Field(ge=0)
    reason: str = Field(min_length=1, max_length=2000)
    idempotency_key: str = Field(min_length=8, max_length=128)


class RollbackInput(Contract):
    expected_version: int = Field(ge=0)
    reason: str = Field(min_length=1, max_length=2000)
    idempotency_key: str = Field(min_length=8, max_length=128)


class SourceInput(Contract):
    title: str = Field(min_length=1, max_length=200)
    location: str = Field(min_length=1, max_length=1000)
    content: str = Field(min_length=1, max_length=200000)
    allowed_subjects: list[str] = Field(min_length=1, max_length=100)
    supersedes: UUID | None = None


class AccessInput(Contract):
    allowed_subjects: list[str] = Field(min_length=1, max_length=100)


class QueryInput(Contract):
    question: str = Field(min_length=1, max_length=2000)
    max_chars: int = Field(default=8000, ge=100, le=20000)
    limit: int = Field(default=5, ge=1, le=10)


class FeedbackInput(Contract):
    rating: Literal["helpful", "unhelpful"]
    explanation: str = Field(default="", max_length=2000)
    idempotency_key: str = Field(min_length=8, max_length=128)


class DomainVersion(Contract):
    domain_id: UUID
    accepted_version: int
    published_version: int


class Citation(Contract):
    source_id: UUID
    title: str
    location: str
    content_hash: str
    start: int
    end: int
    excerpt: str


class QueryResult(Contract):
    episode_id: UUID
    answer: str
    status: Literal["evidence_found", "knowledge_gap"]
    mode: Literal["extractive"] = "extractive"
    served_version: int
    concepts: list[Concept]
    citations: list[Citation]
    processing: Literal["local_no_model"] = "local_no_model"


CONTRACTS = [
    ProposalInput,
    ApprovalInput,
    RollbackInput,
    SourceInput,
    AccessInput,
    QueryInput,
    FeedbackInput,
    DomainVersion,
    QueryResult,
]


class CollectionInput(Contract):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    allowed_subjects: list[str] = Field(min_length=1, max_length=100)
    idempotency_key: str = Field(min_length=8, max_length=128)


class CollectionView(Contract):
    id: UUID
    name: str
    description: str
    allowed_subjects: list[str]


class CollectionPage(Contract):
    items: list[CollectionView]
    next_after: UUID | None


class SourceSummary(Contract):
    id: UUID
    title: str
    location: str
    content_hash: str
    allowed_subjects: list[str]
    supersedes: UUID | None


class SourcePage(Contract):
    items: list[SourceSummary]
    next_after: UUID | None


class TextImportItem(Contract):
    filename: str = Field(min_length=1, max_length=200, pattern=r"^[^/\\\x00-\x1f]+$")
    content: str = Field(min_length=1, max_length=30000, pattern=r"^[^\x00]+$")
    allowed_subjects: list[str] = Field(min_length=1, max_length=100)


class TextImportInput(Contract):
    items: list[TextImportItem] = Field(min_length=1, max_length=20)
    idempotency_key: str = Field(min_length=8, max_length=128)


class ImportItemView(Contract):
    position: int
    filename: str
    status: Literal["pending", "succeeded", "failed", "cancelled"]
    source_id: UUID | None
    error_code: str | None
    attempts: int


class ImportView(Contract):
    id: UUID
    collection_id: UUID
    status: Literal["pending", "partial", "succeeded", "failed", "cancelled"]
    processing: Literal["local_text_only"] = "local_text_only"
    items: list[ImportItemView]


class ImportPage(Contract):
    items: list[ImportView]
    next_after: UUID | None


CONTRACTS += [
    CollectionInput,
    CollectionView,
    CollectionPage,
    SourceSummary,
    SourcePage,
    TextImportInput,
    ImportItemView,
    ImportView,
    ImportPage,
]


class ReviewInput(Contract):
    action: Literal["reject", "defer", "request_changes", "reopen"]
    digest: str = Field(pattern=r"^[a-f0-9]{64}$")
    expected_review_revision: int = Field(ge=0)
    reason: str = Field(min_length=1, max_length=2000)
    idempotency_key: str = Field(min_length=8, max_length=128)


CONTRACTS += [ReviewInput]


ProposalStatus = Literal[
    "ready", "approved", "published", "rejected", "deferred", "changes_requested", "superseded"
]


class ProposalValidation(Contract):
    status: Literal["passed"]
    source_support: Literal["verbatim_v1"]
    graph: Literal["acyclic"]
    policy: Literal["owner_low_risk_v1"]
    risk: Literal["low"]
    source_ids: list[UUID]


class ProposalView(Contract):
    id: UUID
    base_version: int
    digest: str
    reason: str
    status: ProposalStatus
    validation: ProposalValidation
    payload: list[Change]
    review_revision: int
    replaces_id: UUID | None


class ProposalPage(Contract):
    items: list[ProposalView]
    next_after: UUID | None


class ReviewReceipt(Contract):
    id: UUID
    proposal_id: UUID
    author: str
    action: str
    reason: str
    proposal_digest: str
    review_revision: int
    resulting_status: ProposalStatus
    created_at: datetime


class ReviewPage(Contract):
    items: list[ReviewReceipt]
    next_after: UUID | None


class EpisodeHistoryItem(Contract):
    id: UUID
    question: str
    result: QueryResult
    served_version: int
    created_at: datetime


class EpisodePage(Contract):
    items: list[EpisodeHistoryItem]
    next_after: UUID | None


class AccessibleDomain(Contract):
    id: UUID
    name: str
    role: Literal["owner", "corpus_manager", "contributor", "agent", "viewer"]
    capabilities: list[str]


class IdentityView(Contract):
    subject: str
    tenant_id: UUID
    domains: list[AccessibleDomain]


CONTRACTS += [ProposalView, ProposalPage, ReviewReceipt, ReviewPage, EpisodePage, IdentityView]


class FileUploadInput(Contract):
    filename: str = Field(min_length=1, max_length=200, pattern=r"^[^/\\\x00-\x1f]+$")
    content_base64: str = Field(min_length=1, max_length=666668)
    allowed_subjects: list[str] = Field(min_length=1, max_length=100)
    idempotency_key: str = Field(min_length=8, max_length=128)


class FileView(Contract):
    id: UUID
    collection_id: UUID
    filename: str
    content_hash: str
    size_bytes: int
    status: Literal["pending", "processing", "succeeded", "failed", "cancelled"]
    source_id: UUID | None
    error_code: str | None
    attempts: int
    spans: list[dict[str, int]]


class FilePage(Contract):
    items: list[FileView]
    next_after: UUID | None


CONTRACTS += [FileUploadInput, FileView, FilePage]


class ConversationInput(Contract):
    title: str = Field(default="Nouvelle conversation", min_length=1, max_length=200)
    idempotency_key: str = Field(min_length=8, max_length=128)


class ConversationUpdate(Contract):
    title: str = Field(min_length=1, max_length=200)
    archived: bool
    expected_revision: int = Field(ge=0)


class ConversationView(Contract):
    id: UUID
    title: str
    archived: bool
    revision: int
    created_at: datetime


class ConversationPage(Contract):
    items: list[ConversationView]
    next_after: UUID | None


class ConversationQueryInput(QueryInput):
    idempotency_key: str = Field(min_length=8, max_length=128)


class ConversationMessage(Contract):
    sequence: int
    question: str
    result: QueryResult
    created_at: datetime


class ConversationMessages(Contract):
    items: list[ConversationMessage]
    next_after: int | None


CONTRACTS += [
    ConversationInput,
    ConversationUpdate,
    ConversationView,
    ConversationPage,
    ConversationQueryInput,
    ConversationMessages,
]


class MembershipInput(Contract):
    subject: str = Field(min_length=1, max_length=300)
    role: Literal["owner", "corpus_manager", "contributor", "agent", "viewer"] | None
    expected_revision: int | None = Field(default=None, ge=0)
    reason: str = Field(min_length=1, max_length=2000)
    idempotency_key: str = Field(min_length=8, max_length=128)


class MemberView(Contract):
    subject: str
    role: str
    revision: int


class MemberPage(Contract):
    items: list[MemberView]
    next_after: str | None


class MembershipReceipt(Contract):
    id: UUID
    author: str
    subject: str
    previous_role: str | None
    new_role: str | None
    resulting_revision: int | None
    reason: str
    created_at: datetime


class CommitSummary(Contract):
    sequence: int
    proposal_id: UUID
    author: str
    reason: str
    digest: str
    created_at: datetime


class CommitPage(Contract):
    items: list[CommitSummary]
    next_after: int | None


CONTRACTS += [MembershipInput, MemberPage, MembershipReceipt, CommitPage]
