# Approved model registry

Planora only calls models on this list. In code, the list is `MODEL_REGISTRY` in `src/lib/llm/gateway.ts`; `PLANORA_APPROVED_MODELS` overrides it. Any other `LLM_MODEL` is refused, and Planora runs rules-only. A model that belongs to a different provider than the selected one (`PLANORA_AI_PROVIDER`) is also refused.

Every model is either **certified** (evaluated with the golden prompts in [AI-GOVERNANCE.md](AI-GOVERNANCE.md)) or an **approved alternate** (allowed, but Planora does not promise equivalent quality on it). Models approved only through `PLANORA_APPROVED_MODELS` are approved alternates. The AI status (`/api/system`) and the settings panel show the provider, the model and whether it is certified.

| Model | Provider | Status | Approved for | Evaluated | Price (per 1M tokens, in / out) | Notes |
|---|---|---|---|---|---|---|
| `claude-opus-5-5` | Anthropic (cloud) | Certified | Ask AI, reports, follow-up questions | Record golden-prompt results before production rollout | $4 / $20 | **Default cloud model** (provider `anthropic`) |
| `claude-sonnet-5-5` | Anthropic (cloud) | Certified | Same | Record before use | $2 / $10 | |
| `claude-haiku-5-5` | Anthropic (cloud) | Certified | Same | Record before use | $0.10 / $0.50 | |
| `gpt-4o-2024-11-20` | OpenAI (cloud) | Certified | Same | 10/04/2026 | — | Default model when `PLANORA_AI_PROVIDER=openai` |
| `gpt-4o-2024-08-06` | OpenAI (cloud) | Approved alternate | Same | 10/2026 | — | Fallback snapshot |
| `gpt-4o` | OpenAI (cloud) | Approved alternate | Same | — | — | Floating alias kept for existing deployments; prefer a dated snapshot |
| `llama3.1:8b` | On-prem (OpenAI-compatible) | Certified | Follow-up questions, short answers | 10/2026 | — | **Default on-prem model**; "small model" prompts |
| `llama3.1:70b`, `qwen2.5:14b`, `qwen2.5:32b`, `mistral-small` | On-prem | Approved alternate | Same | 10/2026 | — | |

Model ids are exact strings (no date suffixes are added to the Claude ids). Prices feed the `estimatedCostUsd` field of each `ai.request` audit event; they are estimates, and the provider invoice is authoritative.

### Provider notes
- **Anthropic (Claude):** system instructions are sent in the top-level `system` field; thinking is always on and depth is set with `output_config.effort` (`medium`); no sampling parameters are sent. A response with `stop_reason: "refusal"` is shown as a refusal (never as an answer) and audited with `refused: true`; `stop_reason: "max_tokens"` is audited as `truncated: true`.
- **OpenAI / on-prem:** Chat Completions API (`openai` SDK); the on-prem endpoint is any OpenAI-compatible server.

## Adding or changing a model
1. **Risk assessment:** data location (cloud vs on-prem), the provider's data-use terms, cost.
2. **Evaluation:** run the AI checks (`npm test`, which includes the structured-output validator tests) plus the golden prompts in AI-GOVERNANCE.md. Record pass rates here.
3. **Pull request:** add the model to `MODEL_REGISTRY` in `src/lib/llm/gateway.ts` (with its provider, `certified` flag and price) or to the `PLANORA_APPROVED_MODELS` environment variable, then update this table. A new provider needs an adapter implementing `LlmAdapter` and a subprocessor review ([SUBPROCESSORS.md](../privacy/SUBPROCESSORS.md)).
4. **Rollout:** switch `PLANORA_AI_PROVIDER` / `LLM_MODEL` and watch the `ai.request` audit events (`ok:false` and `refused` rate, latency, `truncated`, token usage) for a week.
