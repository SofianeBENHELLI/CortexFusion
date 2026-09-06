# Workspace backend: review, files, conversations and membership

This increment extends the corpus API with the browser-facing operations below. It is an authenticated API, not a delivered product interface or a complete enterprise deployment. Apply `make migrate` through revision 0006 before starting the updated application.

## Discover the current identity

`GET /v1/me` returns the authenticated subject, selected tenant and only that subject's domain memberships, names, roles and capabilities. Capabilities are derived from database membership, not JWT role claims. This does not implement an OIDC login/session, create an organization or discover all organizations for a user. Initial tenant/domain and identity configuration still use the documented bootstrap procedure.

## Review knowledge

- `GET /v1/domains/{domain}/proposals`: permission-filtered keyset page, optional status filter.
- `GET /proposals/{id}/diff`: before/after concept objects. Unaccepted proposals compare against the current published state and explicitly flag a stale base. Accepted proposals use the original commit's before-state, not today's state.
- `POST /proposals/{id}/reviews`: owner-only `reject`, `defer`, `request_changes` or `reopen`; supply digest, expected review revision, reason and idempotency key.
- `GET /proposals/{id}/reviews`: immutable, paginated decision receipts, subject to the proposal's current evidence access.
- `POST /proposals/{id}/revise`: author/owner creates a new proposal using `ProposalInput`; old content is retained with status `superseded`. The new proposal points to its predecessor and retains lineage evidence permissions.
- `GET /commits`: owner-only, permission-filtered chronological summaries for navigating accepted changes and compensation.

Reopen applies only to deferred proposals. Rejected and superseded proposals cannot be reopened; a published correction uses a fresh proposal or the existing compensation flow. Revisions need validation and fresh approval. The approval request now includes `expected_review_revision` (default 0 for existing untouched proposals). After any review action, the browser must submit the revision it actually reviewed. Replaying a lost decision response returns its original receipt without repeating the mutation.

No reviewer quorum or automatic approval is implemented. Proposal/history scans use bounded batches but may inspect multiple batches to fill an authorized page; benchmark larger domains before treating these endpoints as scale-tested.

## Upload and parse private files

`POST /collections/{id}/files` accepts `FileUploadInput`: filename, base64 bytes, explicit source readers and an idempotency key. Limit: 500,000 decoded bytes; the overall request still obeys the 1,000,000-byte middleware cap. Bytes are retained in PostgreSQL under tenant RLS and immutable application grants, not placed in the public checkout or served through a public URL.

`GET /files`, `GET /files/{id}` and `GET /files/{id}/download` expose authorized metadata, parse receipts and an attachment download. The download uses a generic safe filename, `nosniff` and `no-store`. Listing is permission-filtered; once a source has been registered, its current ACL also governs the original file. There is no anonymous sharing or file deletion/purge API.

`POST /files/{id}/process` parses text/Markdown, text PDF or DOCX. `retry` resets failed jobs and `cancel` prevents an active result from being applied. A 60-second lease guards ownership; abandoned work becomes eligible for recovery. Another worker cannot apply a result after its lease has been replaced or cancelled. Registration and final receipt commit together.

Parsing runs in a subprocess with a 15-second wall timeout, a 10-second CPU limit, and a 512 MiB virtual-memory cap on Linux. The parser environment excludes application secrets. This is process isolation/resource bounding, not a full OS security sandbox. macOS does not receive the Linux virtual-memory cap. DOCX archive expansion is bounded and files are not extracted onto the filesystem. External links and macros are not executed.

The parser returns page or paragraph locators mapped to Unicode character spans in the extracted source. PDF uses pinned pypdf 6.17.0 (BSD-3-Clause); DOCX uses bounded ZIP/XML parsing. These are explicit baseline adapters, not Docling integration. Text extraction can lose reading order, tables, fields, headers, footers and layout; review is still required. Scanned/image-only PDFs receive `NO_EXTRACTABLE_TEXT`; encrypted, malformed or oversized documents produce specific/generic failure receipts. No OCR or password handling is implemented. Extraction above 30,000 characters requires splitting; automatic document chunking is not implemented.

[pypdf documents the extraction limits and lack of OCR](https://pypdf.readthedocs.io/en/6.12.0/user/extract-text.html). The bounded subprocess addresses resource exposure without claiming layout fidelity.

A successful parse registers a source only. Call the existing source-to-proposal endpoint and complete owner review/publication separately. Repeated uploads with the same key return the existing file; a separate upload of identical bytes may retain another binary receipt while reusing the source for the same collection/name/hash. Logical document-version management is still deferred.

## Run the file worker

With the restricted application database URL in `CORTEX_DATABASE_URL`:

```sh
uv run cortex worker --tenant TENANT_UUID --domain DOMAIN_UUID --subject WORKER_SUBJECT --once
```

Without `--once`, the worker polls until stopped. `--max-jobs` bounds work per poll and `--poll-seconds` sets the interval. It processes pending or expired-lease files visible to its configured identity. Failed files require an explicit retry. No worker is automatically installed as a system service.

This is a trusted-host process with application database credentials. Its subject is deployment configuration, not an externally authenticated login. Configure a dedicated domain `corpus_manager`, include it explicitly in collection/file readers, and keep database credentials off clients. Permission checks run again before applying results. The worker cannot approve knowledge. Temporal integration, fair multi-tenant scheduling and managed service-identity provisioning remain future work.

## Personal conversations

Create/list/read conversations at `/conversations`, rename/archive/restore using `PUT /conversations/{id}` with an expected metadata revision, and paginate chronological messages at `/conversations/{id}/messages`. Conversations belong to their author; being a domain owner does not reveal another person's history. Archived conversations retain messages but reject new questions until restored. Archiving is not data deletion.

`POST /conversations/{id}/query` accepts the usual question plus an idempotency key. Concurrent/repeated requests with the same content/key return the same authorized episode; a changed request with the same key conflicts. Message association and episode recording are atomic. Every answer records its own published knowledge version. Revoked sources hide old messages and prevent retry from returning a cached answer.

`GET /episodes` supplies a separate permission-filtered personal interaction history. Current answering remains extractive and treats each question independently: conversation storage does not implement model-based interpretation of follow-up references or semantic conversational memory. Message sequence values are historical ordering positions, not a count of currently visible content.

## Domain membership administration

Owners can list `/members` and submit `MembershipInput` to `POST /members`: subject, target role (null removes membership), expected membership revision (null for a new member), reason and idempotency key. The subject must match the configured identity issuer; this endpoint does not create an IdP account or send an invitation. Removing the last owner is refused. Membership generations remain monotonic across removal/re-addition to reject stale decisions.

Membership events are immutable and available to authorized owners at `/membership-events`. A role in one domain grants nothing in another. Removing a member blocks future calls and in-flight answer delivery; persisted source reader lists are not rewritten, so deliberately re-adding the same issuer subject restores access according to those lists. Organization administrators, group sync, invitations and timed delegation are not yet implemented.

## Remaining enterprise work

Product UI and browser login/session handling; real enterprise corpus evaluation; structured model extraction/synthesis; semantic/vector retrieval and integrated AGE projections; logical source revisions and chunking; team issue triage; organization administration; retention/purge and recovery tooling; managed worker deployment and operational budgets. Local API tests and synthetic parsing evidence do not establish enterprise readiness.
