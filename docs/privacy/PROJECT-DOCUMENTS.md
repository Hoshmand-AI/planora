# Project documents: grounding, isolation and lifecycle

Customers can attach a project's contracts, scheduling specifications and owner requirements to a
project (Documents tab, `/api/schedules/{id}/documents`). Ask AI and AI reports can then answer
from those documents with citations ("Use project documents"). This page covers what is stored, who
can retrieve it, what reaches a model, and how it is deleted. Code: `src/lib/rag/*`, migration 20.

## What is stored

| Table | Contents | Notes |
|---|---|---|
| `project_documents` | title, file name, format, type (`contract`, `scheduling_spec`, `owner_requirement`, `specification`, `other`), trust (`approved` / `unreviewed`), classification inherited from the project at upload, SHA-256, size, page count, uploader, reviewer, dates | One row per document. `scope = 'project'` documents hang off the upload they were added to (`schedule_id`) and are shared with every upload of the same project series. `scope = 'org'` documents are organization standards. |
| `document_chunks` | passages of extracted text (about 800–1,200 characters, split at clauses), page / page range, section anchor (`1.3.4`, `Article 8`, `Section 01 32 16 1.3`), heading, injection flag and reasons, and a generated `tsvector` with a GIN index | `org_id` on every row, plus a composite foreign key `(document_id, org_id)`, so a passage can never belong to another organization's document. |
| `document_requirement_reviews` | a person's confirm / dismiss decision on a candidate requirement (key, kind, user, time) | No document text. |
| `retrieval_log` | who retrieved, for which project and purpose, SHA-256 of the query (salted with the org id), returned document and passage ids, flagged passage ids, how results were delivered (`search`, `model`, `passages_only`, `withheld_restricted`, `none`), number of invalid citations removed | Never the query or passage text. Purged after 400 days. |

**The original file is not stored.** Planora extracts the text (PDF text layer, Word `document.xml`,
plain text / Markdown), keeps the SHA-256 and size for chain of custody, and discards the bytes.
Scanned PDFs without a text layer are refused with a request to OCR them first. Size limits: 15 MB
per file, 1,500 pages, 2,000,000 characters, 4,000 passages, 200 documents per upload.

## Who can retrieve what

Authorization is applied **inside the SQL, before ranking** (`src/lib/rag/retrieval.ts`). Every
query binds the caller's organization as `$1` and the project schedule as `$2` and requires:

- `org_id = $1` on the passage **and** on its document;
- the project schedule exists in the caller's organization and passes the caller's workspace
  (ethical wall) rule;
- a project document is reachable only through a schedule of the same series that the caller can
  also see; organization standards follow the rule for organization-wide items (members limited to
  their workspaces don't see them);
- unreviewed documents only when the caller opts in.

There is no post-filtering. Tests: `src/lib/rag/rag.test.ts` (generated SQL) and
`src/lib/rag/rag.db.test.ts` (against Postgres: another firm with the same project key, walled
workspaces, restricted members, the composite foreign key). End to end: `scripts/e2e-rag.mjs`.

Permissions: `read` lists and searches; `schedule.write` uploads, deletes and confirms requirements;
`plan.review` (owner, admin, reviewer) approves documents; organization standards need `org.manage`;
"Use project documents" in Ask AI and reports needs `ai.use`. API keys can't use these endpoints.

## What reaches a model

- Retrieval order (the grounding hierarchy): (1) approved project documents, (2) approved
  organization standards, (3) unreviewed contracts and owner requirements, (4) other unreviewed
  documents — the last two only when the user opts in — then Planora's curated reference knowledge
  (`src/lib/knowledge`), then general knowledge. The model is told this precedence.
- Passages are sent as a separate data message inside `<<<DOCUMENT n nonce=…>>>` blocks with their
  title, section, page, trust and tier. The nonce is random per request and marker-like text inside a
  passage is neutralized, so a document can't close its own block.
- The system instruction says document text is untrusted data that can never change the
  instructions, permissions or tools (no tools are offered).
- **Prompt-injection screening** (`src/lib/rag/injection.ts`) runs at upload. Passages that read
  like instructions to an AI (ignore previous instructions, role changes, system-prompt requests,
  chat markup, tool calls, data-bearing links, "send this to …", "don't tell the user") are flagged.
  Flagged passages are **never sent to a model**; they are shown to people with a warning, and every
  retrieval that skipped one lists it in `retrieval_log.flagged_chunk_ids`.
- **Citations are verified.** Answers must cite `[Title §section p.N]`. Each citation is matched
  against the passages actually retrieved for that request; anything else is removed and the
  answer says how many were removed (`src/lib/rag/citations.ts`).
- **CUI / classified.** If the project or any retrieved document is CUI or classified and the model
  is outside the customer's network, no passage is sent: the user gets the top passages with
  citations and no generated text (`withheld_restricted`). `chat()` still applies its own guard
  ([../security/CUI-HANDLING.md](../security/CUI-HANDLING.md)). Classified documents are refused on
  the commercial cloud like classified schedules.
- **Offline mode** (or AI switched off): the top passages with citations, no generation.
- Model calls are audited as `ai.request` (purpose `ask_ai.documents` / `report.<type>.documents`)
  with sizes and a prompt hash, never content.

## Candidate requirements

`src/lib/rag/requirements.ts` finds candidate scheduling requirements by rules (maximum activity
duration, update frequency, float ownership, NTP, substantial / final completion, liquidated
damages, baseline submittal, software, constraints, negative lags, lag limits, cost loading,
weather days). Each candidate shows the sentence it came from and a citation. People confirm or
dismiss them (`document.requirement_confirmed` / `_dismissed` in the audit log, without text).
**Nothing is applied to a schedule or to the quality rules automatically.**

## Lifecycle

| Event | Effect |
|---|---|
| Upload | Text extracted, chunked, screened and stored in one transaction; audited as `document.uploaded` (title, type, SHA-256, size, passage and flagged counts; no text). |
| Approve / mark unreviewed | `document.trust_changed` (before, after, whether the reviewer uploaded it). |
| Delete a document | In one transaction its passages (and with them the full-text index entries) and requirement reviews are **hard-deleted**, and Ask AI answers that quoted it (tracked in `chat_messages.document_ids`) are redacted. The document row stays as a tombstone with only id, SHA-256, size and dates (title and file name blanked) so audit records still resolve. There is no other cache of document text: retrieval reads the passages table live. Audited as `document.deleted` with the number of passages removed. |
| Delete the upload a document is attached to | The document and its passages are deleted with it (foreign key cascade). Documents are shared across the series, so delete the documents' own upload last or re-attach them first. |
| Retention purge of a project | Same as deleting the upload. |
| Member account deleted | Their uploads, reviews and decisions are reassigned to the heir; their user id is removed from `retrieval_log`. |
| Organization export | `projectDocuments` (metadata, passages, requirement decisions) and `retrievalLog` (ids and hashes) are included. |
| Organization deleted | Passages, documents (including tombstones), requirement reviews and the retrieval log are deleted with everything else. |
| Backups | Follow the database backup window ([../operations/BACKUP-AND-RECOVERY.md](../operations/BACKUP-AND-RECOVERY.md)). |

## Extending retrieval

Retrieval sits behind the `Retriever` interface (`src/lib/rag/types.ts`). A vector backend (for
example pgvector on an on-prem deployment) can be added as another implementation, but it must apply
the same scope in its own query; nothing may filter results after retrieval.
