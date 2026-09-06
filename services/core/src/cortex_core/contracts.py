"""Typed contract source; exported JSON Schema is checked into packages/contracts."""

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
