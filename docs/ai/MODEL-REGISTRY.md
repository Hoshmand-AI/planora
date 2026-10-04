# Approved model registry

Planora only calls models on this list. In code, `PLANORA_APPROVED_MODELS` overrides the default list. Any other `LLM_MODEL` is refused, and Planora runs rules-only.

| Model | Mode | Pinned version | Approved for | Evaluated | Notes |
|---|---|---|---|---|---|
| `gpt-4o-2024-11-20` | Cloud (OpenAI API) | Dated snapshot | Ask AI, reports, follow-up questions | 10/04/2026 | **Default cloud model** |
| `gpt-4o-2024-08-06` | Cloud | Dated snapshot | Same | 10/2026 | Fallback snapshot |
| `gpt-4o` | Cloud | Floating alias | Same | — | Kept for existing deployments; prefer a dated snapshot |
| `llama3.1:8b` | On-prem | Ollama tag | Follow-up questions, short answers | 10/2026 | **Default on-prem model**; "small model" prompts |
| `llama3.1:70b`, `qwen2.5:14b`, `qwen2.5:32b`, `mistral-small` | On-prem | Tag | Same | 10/2026 | |

## Adding or changing a model
1. **Risk assessment:** data location (cloud vs on-prem), the provider's data-use terms, cost.
2. **Evaluation:** run the AI checks (`npm test`, which includes the structured-output validator tests) plus the golden prompts in AI-GOVERNANCE.md. Record pass rates here.
3. **Pull request:** add the model to `DEFAULT_APPROVED_MODELS` in `src/lib/llm/provider.ts` or to the `PLANORA_APPROVED_MODELS` environment variable, then update this table.
4. **Rollout:** switch `LLM_MODEL` and watch the `ai.request` audit events (`ok:false` rate, latency) for a week.
