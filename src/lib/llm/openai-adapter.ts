import OpenAI from 'openai'
import { VERSION } from 'openai/version'
import { AiProviderError, type LlmAdapter, type LlmRequest, type LlmResult, type ProviderName } from './gateway'

// OpenAI Chat Completions adapter. Serves two providers:
//   'openai' — the OpenAI cloud API (approved alternate to the default Claude provider);
//   'local'  — any OpenAI-compatible on-prem endpoint (Ollama, vLLM, llama.cpp server, TGI).

function mapOpenAiError(provider: ProviderName, err: unknown): unknown {
  const who = provider === 'local' ? 'the on-prem AI endpoint' : 'the AI provider (OpenAI)'
  const Who = who[0].toUpperCase() + who.slice(1)
  if (err instanceof OpenAI.RateLimitError) return new AiProviderError(provider, 'rate_limit', 429, `${Who} is rate-limiting requests. Try again in a moment.`)
  if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError) return new AiProviderError(provider, 'auth', err.status ?? null, `${Who} rejected the API key.`)
  if (err instanceof OpenAI.BadRequestError) return new AiProviderError(provider, 'bad_request', 400, `${Who} rejected the request as invalid.`)
  if (err instanceof OpenAI.APIConnectionError) return new AiProviderError(provider, 'connection', null, `Could not reach ${who}.`)
  if (err instanceof OpenAI.APIError) return new AiProviderError(provider, 'upstream', typeof err.status === 'number' ? err.status : null, `${Who} returned an error${typeof err.status === 'number' ? ` (HTTP ${err.status})` : ''}.`)
  return err
}

export function createOpenAiCompatibleAdapter(opts: { provider: Extract<ProviderName, 'openai' | 'local'>; apiKey?: string; baseURL?: string }): LlmAdapter {
  const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL, timeout: opts.provider === 'local' ? 120_000 : 60_000, maxRetries: 1 })
  return {
    provider: opts.provider,
    sdk: `openai@${VERSION}`,
    async complete(req: LlmRequest): Promise<LlmResult> {
      let res: OpenAI.Chat.Completions.ChatCompletion
      try {
        res = await client.chat.completions.create({
          model: req.model,
          messages: req.messages,
          temperature: req.temperature ?? 0.3,
          max_tokens: req.maxTokens,
        })
      } catch (err) {
        throw mapOpenAiError(opts.provider, err)
      }
      const choice = res.choices[0]
      return {
        text: choice?.message?.content ?? null,
        usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 },
        model: res.model || req.model,
        provider: opts.provider,
        truncated: choice?.finish_reason === 'length',
      }
    },
  }
}
