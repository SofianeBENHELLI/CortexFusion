# Corpus API: first text ingestion increment

This API supplies persistent collection, source listing and import receipts for a future corpus-manager interface. For the subsequent binary file/parser worker and optional model extraction increments, see [workspace backend](backend-workspace.md) and [OpenRouter](openrouter.md). Managed workflow orchestration remains separate. Only synthetic fixtures have been exercised; no enterprise corpus has been imported.

Run `make migrate` to apply migration 0002 to an existing installation. New installations apply both migrations. The nonprivileged application role remains unchanged. A domain membership may now use `corpus_manager`; the bootstrap CLI accepts `--member SUBJECT:corpus_manager`. This role can register sources, create collections/imports and propose knowledge. It cannot approve, publish, compensate, replay or change source ACLs. Existing owners retain corpus management rights.

## Authorization

Collections have explicit, immutable reader lists in this increment. Their readers must be domain members and include the creator. Sources have separate reader lists; an import item must include its submitter and cannot initially exceed the collection's readers. Collection membership organizes sources; it does not dynamically override their ACLs. Changes to collection metadata, readers, membership and inheritance policies are not yet exposed.

A registered source remains governed by its current source ACL everywhere, including old import receipts. An owner may restrict a source using the existing access endpoint. Imports are private to their submitter, intersected with collection access, original item readers and all registered sources' current ACLs. If any registered item is no longer readable, the whole job receipt is hidden, including its counts and filenames. A separate team triage capability would need a deliberate policy.

All four new tables use forced tenant RLS, composite domain foreign keys and restricted grants. Search and pagination filter permissions before limiting results. Unknown and inaccessible collections/imports return 404; being an owner is not a content-read bypass.

## Endpoints

Prefix: `/v1/domains/{domain}`. Use the same bearer and tenant headers as the existing core API.

| Method/path | Result |
|---|---|
| `POST /collections` | Create a private collection, idempotent by caller/key and exact request |
| `GET /collections` | Readable collection metadata, keyset pagination and literal name search |
| `GET /collections/{id}` | One readable collection |
| `GET /sources` | Readable source summaries, keyset pagination, literal title search, optional collection filter |
| `POST /collections/{id}/imports` | Persist a batch of supplied text and pending item receipts; returns 202 |
| `GET /imports` | Paginated receipts visible to their submitter |
| `GET /imports/{id}` | Current receipt, reconstructible after reopening the client |
| `POST /imports/{id}/process?limit=1` | Register up to 1–20 pending items atomically with their receipts |
| `POST /imports/{id}/retry` | Reset failed items to pending; successful items remain unchanged |
| `POST /imports/{id}/cancel` | Cancel pending items only; preserve completed sources |

Lists take `limit` (1–100, default 20) and optional `after` UUID. Use the returned `next_after`, which is null at the last page. Collections/sources accept `q` (literal case-insensitive substring, maximum 200 characters). Sources accept `collection_id`. Returned pages contain `items` and `next_after`, with no unfiltered total count. Ordering is ascending immutable UUID, not chronology. Pagination is not a cross-request snapshot; refresh from the first page to include concurrently inserted IDs preceding the cursor.

## Example requests

Create a collection (replace the illustrative subjects with real domain members):

```json
{
  "name": "Operations procedures",
  "description": "Synthetic development corpus",
  "allowed_subjects": ["demo-manager", "demo-owner"],
  "idempotency_key": "collection-example-001"
}
```

Submit text to its `/imports` endpoint:

```json
{
  "idempotency_key": "import-example-001",
  "items": [
    {
      "filename": "incident.md",
      "content": "For a critical incident, page the operations team.",
      "allowed_subjects": ["demo-manager", "demo-owner"]
    },
    {
      "filename": "unparsed.pdf",
      "content": "This synthetic item demonstrates unsupported format handling.",
      "allowed_subjects": ["demo-manager"]
    }
  ]
}
```

This is a JSON text-content transport, not a binary/multipart upload API. A future browser can explicitly read selected text files and submit their strings. The server never opens a supplied filename, local path or URL. Filenames cannot contain path separators or control characters. A request contains up to 20 items, each with at most 30,000 Unicode code points and no NUL character. The existing total HTTP request limit remains 1,000,000 bytes; UTF-8 byte size may exceed character count. Invalid shapes/ACLs reject the batch; validly shaped items with unsupported extensions fail individually during processing.

Call `/process` repeatedly until no items are pending. Supported filename extensions are `.md`, `.markdown` and `.txt`, case-insensitive. In the example, Markdown succeeds and PDF receives `UNSUPPORTED_FORMAT`. The response lists each item's position, filename, state, source ID, error code and attempt count; it does not echo source text. A job is `partial` when item states differ, including when some work is still pending. Inspect item states rather than treating `partial` as a terminal state.

A repeated process call on a completed job has no new effect. Registration and item success are one PostgreSQL transaction. Unexpected failures roll back that process request, leaving those items pending; earlier process requests remain committed. Calls are serialized with the domain lock; a concurrent database conflict returns the existing safe 409 response and can be retried. No `running` state or background execution is claimed: the caller drives bounded processing, and closing the browser leaves pending items available for later processing. This seam can be replaced by a durable worker later.

Cancel is idempotent and has no effect on a fully completed job. A cancelled job cannot be resumed. Retry does not modify content or fix an unsupported format: it resets failed receipts only; corrected input needs a new import key. Successful sources are never duplicated by retry.

Sources use an `upload://COLLECTION_ID/FILENAME` provenance locator, not a download URL. Identical filename/content/metadata in the same collection reuses the source. This is origin-scoped exact deduplication: identical content under different filenames is not automatically merged. Changed content is a separate immutable source; inferred supersession/version linking is not implemented. A conflicting metadata or ACL attempt does not overwrite an existing version.

## From source to published knowledge

Successful import means **source registered**, not knowledge approved or even proposed. Use the returned source ID with `POST /sources/{id}/propose` and an `Idempotency-Key` to prepare the existing verbatim proposal. An owner then reviews, approves and publishes through the established flow. No model or parser is run by these import endpoints.

## Validation

The new integration tests exercise the actual PostgreSQL roles: manager import/proposal with approval refusal, source listing, hidden collection/job metadata, ACL revocation, item failures, selective retry, cancellation, exact duplicates, idempotency conflicts, filtered pagination, cross-domain foreign keys, tenant RLS, loss of manager role, concurrent process calls, and rollback of source plus receipt after an injected failure. Existing core and contract suites continue to run.
