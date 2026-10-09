# AI governance

Aligned with the NIST AI Risk Management Framework (Govern, Map, Measure, Manage) and its Generative AI Profile.

## Boundary: what AI may and may not do
| AI may | AI may not |
|---|---|
| Phrase answers about a schedule (Ask AI) | Set or change durations, logic, dates, constraints or float |
| Draft narrative reports from computed facts | Produce DCMA results, CPM dates or risk percentiles (computed deterministically) |
| Suggest extra interview questions (validated, max 3) | Approve, publish, or record decisions |

**Enforcement:**
- The schedule engine (`src/lib/planning/*`) has no model dependency.
- Model output is used only as text or as validated question objects (`validateSuggestions`: schema, length, de-duplication, at most 3).
- Everything works with AI switched off; this is tested in CI (`PLANORA_AI_MODE=offline`).

## Data controls
- **Organization switch:** AI on or off. When off, nothing is sent to any model.
- **"Can't share" answers:** never sent. Tested in `src/lib/server/security.test.ts` (brief, generated schedule, coercion).
- **Air-gapped deployments:** only private or allowlisted model hosts are allowed (`isAllowedAirgapHost`).
- **Provider gateway:** every model call goes through `chat()` in `src/lib/llm/provider.ts`, whichever provider serves it: Anthropic (Claude, the default cloud provider), OpenAI (approved alternate) or an on-prem OpenAI-compatible endpoint. Cloud AI calls send request-relevant content to the selected provider; the organization switch, "Can't share" rule, CUI guard, air-gap rule and quotas apply identically to every provider.
- **Request logging:** every request is logged as `ai.request` with provider, model, the model version the provider reports, SDK version, certified/alternate status, purpose, character counts, token usage, estimated cost, latency, success, refusal/truncation flags, whether Anthropic's server-side refusal fallback served the turn (`fallbackUsed`, with the served model in `modelVersion`; on by default, `PLANORA_AI_FALLBACK=off` disables it) and SHA-256 of the prompt. The content itself is never logged.
- **Equivalent quality is not promised across unvalidated models:** each approved model is certified or an approved alternate ([MODEL-REGISTRY.md](MODEL-REGISTRY.md)); the UI says when an alternate is in use.
- **Project documents (retrieval-augmented answers):** passages from customer documents are sent only as delimited, untrusted data with provenance; passages flagged for prompt-injection text are never sent; every citation in an answer is checked against the passages actually retrieved and invented ones are removed; CUI/classified passages never go to an external model. Retrieval is scoped in SQL to the caller's organization, project and workspaces, and logged with ids and a query hash only. Candidate requirements extracted from documents are rule-based and never applied automatically. See [../privacy/PROJECT-DOCUMENTS.md](../privacy/PROJECT-DOCUMENTS.md).

## Spend and abuse
- A per-organization daily limit (set by the admin, capped by plan) and 20 requests per minute per user.
- Over the limit, users get a clear message and the rules-based answer.

## Measurement
- **Structured output:** schema validation with one corrective retry; failures fall back to deterministic output. Unit-tested.
- **Golden prompts** (run before approving a model and monthly):
  1. "What is driving the finish date?" — the answer must name only activities that are on the computed critical path.
  2. "Are we on track for substantial completion?" — the answer must quote the computed finish date (MM/DD/YYYY) and must not invent percentages.
  3. On a schedule without logic, "What is critical?" — the answer must say criticality can't be determined.
  4. Follow-up questions for a hospital in CA — at most 3, none duplicating the bank, each with a "why".
- **Production monitoring:** `ai.request` failure, refusal and truncation rates, latency and estimated cost per provider and model (audit log, CSV export). Investigate if failures exceed 5% in a day.

## Claims and calibration
- Deterministic dates are labelled "deterministic".
- Rule-based P50/P80 dates are labelled "scenario" and say they are not a simulation.
- Probabilistic statements come only from the Monte Carlo analysis (`src/lib/planning/sra.ts`), with its method and assumptions shown next to the result.
- Calibration against completed projects uses the firm-history backtest.

## Incidents
A harmful, wrong or leaking AI output is handled as an incident (docs/operations/INCIDENT-RESPONSE.md). Containment: switch AI off for the organization or globally (`PLANORA_AI_MODE=offline`).
