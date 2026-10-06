# CUI and classified project data

_Last updated 10/06/2026._

Planora's commercial cloud service (Vercel + Neon, optional OpenAI) is **not** authorized for Controlled Unclassified Information (CUI) or classified information. CUI belongs in an on-premises or air-gapped Planora deployment inside the customer's assessed boundary (see the NIST SP 800-171 section of [CONTROL-MATRIX.md](CONTROL-MATRIX.md), the requirement-by-requirement [NIST-800-171-MAPPING.md](NIST-800-171-MAPPING.md), and the install guide [../operations/ON-PREM-INSTALL.md](../operations/ON-PREM-INSTALL.md)).

## How a deployment is identified

| Setting | Deployment | CUI warning shown |
|---|---|---|
| `PLANORA_AIRGAPPED=true` | Air-gapped | No |
| `PLANORA_DEPLOYMENT=onprem` (also `on-prem`, `on-premises`, `self-hosted`) | On-premises | No |
| Neither (default, including the hosted service) | Commercial cloud | Yes |

Detection lives in `deploymentKind()` in `src/lib/llm/provider.ts`. The default is "commercial cloud", so an instance that is not configured explicitly warns rather than stays silent.

## What the commercial cloud does

1. **Warning.** Sign-up (`/auth`), Organization → Policies, `GET /api/auth` (`service.cuiWarning`), `GET /api/system` and every plan view (`llm.cuiWarning`) carry this notice: CUI must not be stored in the commercial cloud. Use an on-premises or air-gapped deployment for CUI and classified projects.
2. **Server-side AI guard.** The interview records `security.classification` as `unclassified`, `cui` or `classified`. A withheld answer is treated as `classified`. Before any model call, `chat()` in `src/lib/llm/provider.ts` (the single path for every model call) checks the classification of the project the request touches. If it is `cui` or `classified` and the model is outside the customer's network, the call is refused with `RestrictedDataError` before anything is sent. "Outside the network" means cloud mode (OpenAI), or an OpenAI-compatible `LLM_BASE_URL` on a host that isn't private or listed in `PLANORA_ALLOWED_HOSTS`. The refusal is recorded in the audit log as `ai.blocked_restricted_data`, with the purpose, classification and model host but no content.
   - The project is resolved per request in `src/lib/server/classification.ts`. Routes under `/api/plans/{id}/…` resolve it from the plan. Routes under `/api/schedules/{id}/…` and `POST /api/ask` / `POST /api/reports` (which take `scheduleId`) resolve it from the schedule's own classification (set on upload or with `PATCH /api/schedules { classification }`, audited as `schedule.classification`) and the plan it was published from, whichever is more restrictive.
   - If the lookup itself fails, the project is treated as classified (fail closed).
   - Results: AI follow-up questions return an error that explains the refusal. Ask AI and reports fall back to the deterministic readout. Schedule generation, CPM, quality checks, risk analysis and exports never use a model and keep working.
3. **Export markings.** Every export of a CUI or classified plan or upload carries the banner (`CUI` / `CLASSIFIED`) and the designation indicator (controlled by, category, dissemination, POC) where a reader sees it (`src/lib/export/markings.ts`): PDF and report text at the top and bottom with the designation on the first page; Excel in the first rows of every sheet and the print header/footer; MS Project XML in the Title, Subject and project summary task notes; P6 XER as a project notebook topic (the P6 project name is not prefixed). CSV cannot carry markings, so CSV exports of CUI data are refused (`409 cui_csv_excluded`). The export audit record names the marking and the file's SHA-256.
4. **Organizations can switch AI off entirely.** New organizations start with AI off (see [SUBPROCESSORS.md](../privacy/SUBPROCESSORS.md)).

## Limits

- The guard covers model calls. It does not stop a user from **typing** CUI into the commercial cloud: the interview stores the answers they enter. The warning and the contract terms are the control for storage. Use an on-prem deployment for CUI.
- Uploaded schedules (XER/XML/Excel) are covered by the AI guard only when they are marked CUI or classified (on upload or afterwards). An organization that handles CUI must still not upload such schedules to the cloud service, and should keep AI off.
- On an on-premises deployment that is not air-gapped, the guard still blocks the cloud model and public endpoints for CUI and classified projects. Only a private, on-prem model can receive them.
