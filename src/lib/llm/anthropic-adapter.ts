import Anthropic from '@anthropic-ai/sdk'
import { VERSION } from '@anthropic-ai/sdk/version'
import { AiProviderError, AiRefusalError, type ChatMessage, type LlmAdapter, type LlmRequest, type LlmResult } from './gateway'

// Claude adapter (Anthropic Messages API).
//
// Request shape rules for current Claude models:
//   - system messages go in the top-level `system` field; `messages` holds only user/assistant turns
//     and must start with a user turn;
//   - thinking is always on — the `thinking` parameter is omitted and depth is set with
//     output_config.effort; sampling parameters (temperature/top_p/top_k), thinking budgets and
//     assistant prefill are rejected, so none are sent;
//   - max_tokens covers thinking plus the answer, so it is set well above the visible-output size.

/** Thinking + answer budget per call (non-streaming, so it stays under SDK HTTP timeouts). */
export const ANTHROPIC_MAX_TOKENS = 16_000
export const ANTHROPIC_EFFORT = 'medium' as const

export interface AnthropicPayload {
  system?: string
  messages: Anthropic.MessageParam[]
}

/** Hoist system messages into `system`, keep user/assistant turns in order, and make the first turn a user turn. */
export function toAnthropicPayload(messages: ChatMessage[]): AnthropicPayload {
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n')
  const turns: Anthropic.MessageParam[] = messages
    .filter((m): m is ChatMessage & { role: 'user' | 'assistant' } => m.role !== 'system')
    .map(m => ({ role: m.role, content: m.content }))
  if (!turns.length || turns[0].role !== 'user') turns.unshift({ role: 'user', content: 'Please respond according to the instructions.' })
  // A trailing assistant turn would be a prefill, which current models reject.
  if (turns[turns.length - 1].role === 'assistant') turns.push({ role: 'user', content: 'Continue.' })
  return { ...(system ? { system } : {}), messages: turns }
}

/** Map SDK errors to the gateway's provider error, most specific first. Never string-matches messages. */
export function mapAnthropicError(err: unknown): unknown {
  if (err instanceof Anthropic.RateLimitError) return new AiProviderError('anthropic', 'rate_limit', 429, 'The AI provider (Anthropic) is rate-limiting requests. Try again in a moment.')
  if (err instanceof Anthropic.AuthenticationError) return new AiProviderError('anthropic', 'auth', 401, 'The AI provider (Anthropic) rejected the API key. An administrator must check ANTHROPIC_API_KEY.')
  if (err instanceof Anthropic.PermissionDeniedError) return new AiProviderError('anthropic', 'auth', 403, 'The AI provider (Anthropic) denied access for this API key or model.')
  if (err instanceof Anthropic.BadRequestError) return new AiProviderError('anthropic', 'bad_request', 400, 'The AI provider (Anthropic) rejected the request as invalid.')
  if (err instanceof Anthropic.APIConnectionError) return new AiProviderError('anthropic', 'connection', null, 'Could not reach the AI provider (Anthropic).')
  if (err instanceof Anthropic.APIError) return new AiProviderError('anthropic', 'upstream', typeof err.status === 'number' ? err.status : null, `The AI provider (Anthropic) returned an error${typeof err.status === 'number' ? ` (HTTP ${err.status})` : ''}.`)
  return err
}

export function createAnthropicAdapter(opts: { apiKey: string; timeoutMs?: number }): LlmAdapter {
  const client = new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs ?? 120_000, maxRetries: 1 })
  return {
    provider: 'anthropic',
    sdk: `@anthropic-ai/sdk@${VERSION}`,
    async complete(req: LlmRequest): Promise<LlmResult> {
      const payload = toAnthropicPayload(req.messages)
      let res: Anthropic.Message
      try {
        res = await client.messages.create({
          model: req.model,
          max_tokens: Math.max(ANTHROPIC_MAX_TOKENS, req.maxTokens),
          ...payload,
          output_config: { effort: ANTHROPIC_EFFORT },
        })
      } catch (err) {
        throw mapAnthropicError(err)
      }
      // Check the stop reason before reading content: a refusal is not an answer.
      if (res.stop_reason === 'refusal') throw new AiRefusalError('anthropic', res.stop_details?.category ?? null)
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('')
      return {
        text: text || null,
        usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
        model: res.model || req.model,
        provider: 'anthropic',
        truncated: res.stop_reason === 'max_tokens',
      }
    },
  }
}
