"""Typed contract source; exported JSON Schema is checked into packages/contracts."""

from datetime import date, datetime
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


class QueryStreamStarted(Contract):
    event: Literal["started"] = "started"
    protocol_version: Literal["1"] = "1"
    operation_id: Literal["conversations.query"] = "conversations.query"
    idempotency_key: str = Field(min_length=8, max_length=128)


class QueryStreamResult(Contract):
    event: Literal["result"] = "result"
    protocol_version: Literal["1"] = "1"
    result: QueryResult


class QueryStreamError(Contract):
    event: Literal["error"] = "error"
    protocol_version: Literal["1"] = "1"
    error: str
    http_status: int = Field(ge=400, le=599)
    message: str = "La réponse n'a pas pu être livrée. Relire l'état ou reprendre la même clé."
    recovery: Literal["inspect_or_retry_same_key"] = "inspect_or_retry_same_key"


STREAM_CONTRACTS = [QueryStreamStarted, QueryStreamResult, QueryStreamError]


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
CONTRACTS += STREAM_CONTRACTS


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
    extraction_provider: Literal["ollama", "openrouter"] | None = None
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


class LocalExtractionInput(Contract):
    allow_local_processing: Literal[True]
    idempotency_key: str = Field(min_length=8, max_length=128)


class LocalExtractionView(Contract):
    input_span: SourceRef | None = None
    input_sha256: str | None = None
    provider: Literal["ollama", "openrouter"] = "ollama"
    request_id: str | None = None
    cost_usd: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    id: UUID
    proposal: ProposalView
    model: str
    model_digest: str | None
    prompt_version: str
    input_tokens: int | None
    output_tokens: int | None
    processing: Literal["local_model_passage_selection", "openrouter_passage_selection"] = (
        "local_model_passage_selection"
    )


CONTRACTS += [LocalExtractionInput, LocalExtractionView]


class MembershipEventPage(Contract):
    items: list[MembershipReceipt]
    next_after: UUID | None


class ConceptDifference(Contract):
    concept_id: UUID
    before: Concept | None
    after: Concept | None


class ProposalDifference(Contract):
    proposal_id: UUID
    base_version: int
    published_version: int
    comparison: Literal["accepted_before_state", "current_published_state"]
    stale_base: bool
    items: list[ConceptDifference]


CONTRACTS += [MembershipEventPage, ProposalDifference]


class ExtractionInput(Contract):
    processing_destination: Literal["ollama", "openrouter"]
    idempotency_key: str = Field(min_length=8, max_length=128)
    span: SourceRef | None = None


CONTRACTS += [ExtractionInput]


class SourceChunk(Contract):
    start: int = Field(ge=0)
    end: int = Field(gt=0)
    content: str
    sha256: str


class SourceChunkPage(Contract):
    source_id: UUID
    algorithm: Literal["unicode-2000-6000-v1"]
    items: list[SourceChunk]
    next_offset: int | None


CONTRACTS += [SourceChunkPage]

IssueStatus = Literal["open", "in_progress", "resolved", "dismissed"]


class IssueView(Contract):
    id: UUID
    episode_id: UUID
    kind: Literal["knowledge_gap", "disputed_answer"]
    reason: str
    status: IssueStatus
    revision: int
    created_at: datetime


class IssuePage(Contract):
    items: list[IssueView]
    next_after: UUID | None


class IssueDecisionInput(Contract):
    action: Literal["start", "resolve", "dismiss", "reopen"]
    expected_revision: int = Field(ge=0)
    reason: str = Field(min_length=1, max_length=2000)
    idempotency_key: str = Field(min_length=8, max_length=128)
    correction_proposal_id: UUID | None = None

    @model_validator(mode="after")
    def correction_action(self):
        if self.correction_proposal_id is not None and self.action not in ("start", "resolve"):
            raise ValueError("A correction can only accompany start or resolve")
        return self


class IssueEvent(Contract):
    id: UUID
    issue_id: UUID
    author: str
    previous_status: IssueStatus
    status: IssueStatus
    revision: int
    reason: str
    created_at: datetime
    correction_proposal_id: UUID | None = None
    correction_digest: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    correction_published_version: int | None = Field(default=None, ge=1)


class IssueEventPage(Contract):
    items: list[IssueEvent]
    next_after: UUID | None


CONTRACTS += [IssueView, IssuePage, IssueDecisionInput, IssueEvent, IssueEventPage]


class SourceDetail(SourceSummary):
    content: str


class VersionView(Contract):
    domain_id: UUID
    accepted_version: int
    published_version: int


class AccessReceipt(Contract):
    source_id: UUID
    allowed_subjects: list[str]


class ApprovalReceipt(Contract):
    sequence: int
    proposal_id: UUID
    accepted: Literal[True]


class PublicationReceipt(Contract):
    published_version: int
    changed: bool


class ReplayReceipt(Contract):
    published_version: int
    concept_count: int
    state_hash: str


class FeedbackReceipt(Contract):
    feedback_id: UUID


class BriefIssue(Contract):
    id: UUID
    kind: Literal["knowledge_gap", "disputed_answer"]
    reason: str
    episode_id: UUID


class BriefView(Contract):
    accepted_version: int
    published_version: int
    pending_proposals: list[ProposalView]
    issues: list[BriefIssue]
    processing: Literal["local_no_model"]
    model_calls: Literal[0]


class HealthView(Contract):
    status: Literal["ok"]
    version: str
    mode: Literal["extractive"]


CONTRACTS += [
    SourceDetail,
    VersionView,
    AccessReceipt,
    ApprovalReceipt,
    PublicationReceipt,
    ReplayReceipt,
    FeedbackReceipt,
    BriefView,
    HealthView,
]


class InteractionView(Contract):
    action_id: str
    operation_id: str
    method: str
    path: str
    roles: list[str]
    effect: str
    effect_description: str
    intent_example: str
    confirmation_policy: str
    object_authorization: str


class InteractionCatalog(Contract):
    version: str
    openapi_url: str
    authorization_notice: str
    items: list[InteractionView]


CONTRACTS += [InteractionCatalog]


class FeedbackPreferences(Contract):
    allow_observed: bool = False
    allow_inferred: bool = False
    revision: int = Field(ge=0)


class FeedbackPreferencesInput(Contract):
    allow_observed: bool
    allow_inferred: bool
    expected_revision: int = Field(ge=0)


class FeedbackSignalInput(Contract):
    companion_response_id: UUID | None = None
    origin: Literal["explicit", "observed", "inferred"]
    kind: Literal[
        "thumbs_up",
        "thumbs_down",
        "comment",
        "reformulation",
        "correction",
        "abandon",
        "resolved",
        "satisfaction",
    ]
    comment: str = Field(default="", max_length=2000)
    companion: str = Field(min_length=1, max_length=100)
    confidence: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    sentiment: Literal["positive", "negative", "neutral"] | None = None
    iteration_index: int | None = Field(default=None, ge=1, le=10000)
    idempotency_key: str = Field(min_length=8, max_length=128)

    @model_validator(mode="after")
    def provenance(self):
        allowed = {
            "explicit": {"thumbs_up", "thumbs_down", "comment", "resolved"},
            "observed": {"reformulation", "correction", "abandon", "resolved"},
            "inferred": {"satisfaction"},
        }
        if self.kind not in allowed[self.origin]:
            raise ValueError("Signal kind does not match its origin")
        if self.origin == "inferred":
            if self.confidence is None or self.sentiment is None or not self.comment.strip():
                raise ValueError(
                    "Inferred satisfaction requires confidence, sentiment and explanation"
                )
        elif self.confidence is not None or self.sentiment is not None:
            raise ValueError("Confidence and sentiment belong only to inferred satisfaction")
        if self.iteration_index is not None and self.origin != "observed":
            raise ValueError("Iteration index belongs only to observed signals")
        if self.kind == "comment" and not self.comment.strip():
            raise ValueError("An explicit comment cannot be empty")
        return self


class FeedbackSignalView(Contract):
    id: UUID
    episode_id: UUID
    served_version: int
    source_ids: list[UUID]
    signal: FeedbackSignalInput
    created_at: datetime


class FeedbackSignalPage(Contract):
    items: list[FeedbackSignalView]
    next_after: UUID | None


CONTRACTS += [
    FeedbackPreferences,
    FeedbackPreferencesInput,
    FeedbackSignalInput,
    FeedbackSignalView,
    FeedbackSignalPage,
]


class ProtectedResourceMetadata(Contract):
    resource: str
    authorization_servers: list[str]
    bearer_methods_supported: list[Literal["header"]]
    resource_name: str


CONTRACTS += [ProtectedResourceMetadata]


class ExplicitFeedbackCounts(Contract):
    thumbs_up: int = Field(ge=0)
    thumbs_down: int = Field(ge=0)
    comment: int = Field(ge=0)
    resolved: int = Field(ge=0)


class ObservedFeedbackCounts(Contract):
    reformulation: int = Field(ge=0)
    correction: int = Field(ge=0)
    abandon: int = Field(ge=0)
    resolved: int = Field(ge=0)
    iteration_index_samples: int = Field(ge=0)
    maximum_declared_iteration: int | None


class InferredFeedbackCounts(Contract):
    positive: int = Field(ge=0)
    negative: int = Field(ge=0)
    neutral: int = Field(ge=0)


class FeedbackSummary(Contract):
    window_start: datetime
    window_end: datetime
    conversation_id: UUID | None
    companion_response_id: UUID | None = None
    signal_count: int = Field(ge=0)
    episode_count: int = Field(ge=0)
    conflicting_explicit_episodes: int = Field(ge=0)
    explicit: ExplicitFeedbackCounts
    observed: ObservedFeedbackCounts
    inferred: InferredFeedbackCounts
    legacy_feedback_included: Literal[False] = False
    interpretation: str


CONTRACTS += [FeedbackSummary]


class ModelAttemptView(Contract):
    id: UUID
    source_id: UUID
    provider: Literal["openrouter", "ollama"]
    requested_model: str
    input_span: SourceRef
    input_sha256: str
    idempotency_key: str
    created_at: datetime
    status: Literal["unresolved", "succeeded", "failed"]
    finished_at: datetime | None
    error_code: str | None
    extraction_id: UUID | None


class ModelAttemptPage(Contract):
    items: list[ModelAttemptView]
    next_after: UUID | None


class ModelUsageView(Contract):
    utc_day: date
    daily_limit: int = Field(ge=1)
    reserved_attempts: int = Field(ge=0)
    remaining_attempts: int = Field(ge=0)
    scope: str


CONTRACTS += [ModelAttemptView, ModelAttemptPage, ModelUsageView]


class CompanionResponseInput(Contract):
    answer_text: str = Field(min_length=1, max_length=12000)
    answer_kind: Literal["answer", "abstention", "clarification"]
    citations: list[SourceRef] = Field(default_factory=list, max_length=50)
    companion: str = Field(min_length=1, max_length=100)
    model: str | None = Field(default=None, min_length=1, max_length=200)
    idempotency_key: str = Field(min_length=8, max_length=128)

    @model_validator(mode="after")
    def evidence_declaration(self):
        if not self.answer_text.strip():
            raise ValueError("Response text cannot be blank")
        if self.answer_kind == "answer" and not self.citations:
            raise ValueError("A corpus answer requires at least one episode citation")
        refs = [(str(r.source_id), r.start, r.end) for r in self.citations]
        if len(refs) != len(set(refs)):
            raise ValueError("Response citations must be unique")
        return self


class CompanionResponseView(Contract):
    id: UUID
    episode_id: UUID
    served_version: int
    response: CompanionResponseInput
    citations: list[Citation]
    reference_validation: Literal["episode_references_checked", "no_references"]
    semantic_validation: Literal["not_performed"] = "not_performed"
    created_at: datetime


class CompanionResponsePage(Contract):
    items: list[CompanionResponseView]
    next_after: UUID | None


CONTRACTS += [CompanionResponseInput, CompanionResponseView, CompanionResponsePage]


class TimelineResponse(Contract):
    id: UUID
    response: CompanionResponseInput
    reference_validation: Literal["episode_references_checked", "no_references"]
    semantic_validation: Literal["not_performed"] = "not_performed"
    created_at: datetime


class TimelineResponsePage(Contract):
    items: list[TimelineResponse]
    next_after: UUID | None


class ConversationTurn(ConversationMessage):
    responses: TimelineResponsePage
    signals: FeedbackSignalPage
    issues: IssuePage


class ConversationTimeline(Contract):
    conversation: ConversationView
    items: list[ConversationTurn]
    next_after: int | None
    direction: Literal["forward", "backward"] = "forward"
    scan_limited: bool = False
    payload_limit_bytes: Literal[500000] = 500000


CONTRACTS += [TimelineResponse, TimelineResponsePage, ConversationTurn, ConversationTimeline]


class SynthesisInput(Contract):
    processing_destination: Literal["openrouter"]
    idempotency_key: str = Field(min_length=8, max_length=128)


class SynthesisUsage(Contract):
    request_id: str = Field(pattern=r"^[A-Za-z0-9._:/-]{1,200}$")
    cost_usd: float = Field(ge=0, allow_inf_nan=False)
    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)


class SynthesisView(Contract):
    id: UUID
    episode_id: UUID
    provider: Literal["openrouter", "none"]
    requested_model: str | None
    prompt_version: str
    budget_reserved: bool
    idempotency_key: str
    created_at: datetime
    status: Literal["unresolved", "succeeded", "failed"]
    response_id: UUID | None
    error_code: str | None
    usage: SynthesisUsage | None
    finished_at: datetime | None


class SynthesisPage(Contract):
    items: list[SynthesisView]
    next_after: UUID | None


CONTRACTS += [SynthesisInput, SynthesisUsage, SynthesisView, SynthesisPage]
