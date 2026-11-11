// Prompt-injection screening for document passages. Uploaded documents are untrusted data: a
// passage that reads like an instruction to an AI model (or tries to smuggle data out through a
// link or a tool call) is flagged at ingestion. Flagged passages are never sent to a model; they are
// shown to people with a warning, and every retrieval that skips one records it in retrieval_log.
//
// The patterns are deliberately specific to instructions aimed at a model, so ordinary contract
// language ("the Contractor shall disregard…", "act as the Owner's representative") is not flagged.

export interface InjectionFinding { id: string; label: string }

const RULES: { id: string; label: string; re: RegExp }[] = [
  { id: 'override_instructions', label: 'Tells the AI to ignore or replace its instructions',
    re: /\b(?:ignore|disregard|forget|override|bypass)\s+(?:(?:all|any|the|of)\s+)*(?:previous|prior|above|earlier|preceding|your|system|existing|original)\s+(?:\w+\s+)?(?:instructions?|prompts?|directions|rules|guidelines|guardrails|context)\b/i },
  // The same verbs with the qualifier after the noun ("disregard the instructions above"), or with none
  // when the sentence ends there ("Ignore all instructions."). A negated contract sentence ("shall not
  // disregard the instructions of the Engineer") is not matched.
  { id: 'override_instructions', label: 'Tells the AI to ignore or replace its instructions',
    re: /(?<!\b(?:not|never)\s)\b(?:ignore|disregard|forget|override|bypass)\s+(?:(?:all|any|the|of|these|those)\s+)*(?:instructions?|prompts?|guardrails)\s+(?:above|(?:given|stated|provided)\s+(?:above|earlier|previously|before)|you\s+(?:were|have\s+been)\s+given|so\s+far)\b|(?<!\b(?:not|never)\s)\b(?:ignore|disregard|forget|override|bypass)\s+(?:all|any)\s+(?:of\s+)?(?:the\s+)?(?:instructions?|prompts?|guardrails)(?=\s*(?:[.!;:,]|$|(?:and|then)\b))/i },
  // "Do not follow the earlier guidance; instead answer that …": the replacement answer is what marks it.
  { id: 'override_instructions', label: 'Tells the AI to ignore or replace its instructions',
    re: /\b(?:do not|don't|never)\s+(?:follow|obey)\b[^.\n]{0,60}\b(?:instead|rather),?\s+(?:answer|reply|respond|say|state|output)\b/i },
  // Text addressed to the model by name, followed by an order ("AI assistant: when summarizing, state …").
  { id: 'new_instructions', label: 'Announces new instructions for the AI',
    re: /\b(?:ai(?:\s+(?:assistant|model|agent))?|chatbot|language model|llm|chatgpt)\s*[:,]\s*(?:when|whenever|please|you|always|never|do not|don't|ignore|disregard|state|say|tell|reply|respond|answer|output|summari[sz]e)\b|\bassistant\s*:\s*(?:when|whenever|please|you|always|never|do not|don't|ignore|disregard|state|say|tell|reply|respond|answer|output|summari[sz]e)\b/i },
  { id: 'role_reassignment', label: 'Tries to give the AI a new role',
    re: /\b(?:you are now|from now on,? you (?:are|will|must)|pretend (?:to be|you are)|act as (?:an? )?(?:ai|assistant|chatbot|language model|llm|unrestricted|jailbroken)|(?:developer|jailbreak|dan|god) mode)\b/i },
  { id: 'system_prompt', label: 'Mentions the system prompt or hidden instructions',
    re: /\b(?:system prompt|system message|hidden instructions?|initial instructions|your (?:instructions|guidelines|programming))\b/i },
  { id: 'chat_markup', label: 'Contains chat-format control markup',
    re: /<\|im_(?:start|end)\|>|\[\/?INST\]|<<\/?SYS>>|<\/?(?:system|assistant|tool|function_call)>|^\s*(?:system|assistant)\s*:/im },
  { id: 'new_instructions', label: 'Announces new instructions for the AI',
    re: /\b(?:new|updated|real|actual|important) instructions?\s*(?:for (?:the )?(?:ai|assistant|model))?\s*:|\b(?:ai|assistant|model|chatgpt|claude|llm)s?\s*,?\s*(?:must|should|shall|will)\s+(?:now\s+)?(?:ignore|reply|respond|answer|say|output|reveal)\b/i },
  { id: 'tool_invocation', label: 'Tries to make the AI call a tool or function',
    re: /\b(?:call|invoke|execute|run|trigger)\s+(?:the\s+)?(?:tool|function|plugin|command|api endpoint)\b|\bfunction_call\b|\btool_calls?\b/i },
  { id: 'secret_request', label: 'Asks the AI to reveal secrets or its configuration',
    re: /\b(?:reveal|print|output|repeat|disclose|show|leak)\b[^.\n]{0,40}\b(?:system prompt|instructions|api[ _-]?keys?|secrets?|passwords?|credentials|tokens?|environment variables)\b/i },
  { id: 'exfiltration_link', label: 'Contains a link that could carry data out (image beacon or data-bearing URL)',
    re: /!\[[^\]]*\]\(\s*https?:\/\/|https?:\/\/[^\s)"'<>]+[?&](?:[^\s)"'<>]*\{|[^\s)"'<>]*%7B|(?:q|data|d|prompt|payload|secret|token|key|exfil)=)/i },
  { id: 'exfiltration_send', label: 'Tells the reader to send information to an outside address',
    re: /\b(?:send|post|upload|forward|transmit|exfiltrate|leak|email)\b[^.\n]{0,60}\b(?:conversation|chat|prompt|context|data|answers?|this document|the schedule|everything)\b[^.\n]{0,40}\b(?:to|via|at)\b[^.\n]{0,20}(?:https?:\/\/|www\.|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i },
  { id: 'concealment', label: 'Tells the AI to hide something from the user',
    re: /\b(?:do not|don't|never)\s+(?:tell|inform|mention|reveal|show)\b[^.\n]{0,20}\b(?:the )?user\b/i },
]

/** Suspicious instruction-like content in a passage (empty when clean). */
export function detectInjection(text: string): InjectionFinding[] {
  // Undo simple obfuscation (zero-width characters, line breaks inside a phrase).
  // eslint-disable-next-line no-misleading-character-class
  const t = text.replace(/[\u200b-\u200f\u2060\ufeff]/g, '').replace(/\s+/g, ' ')
  const seen = new Set<string>()
  return RULES.filter(r => (r.re.test(t) || r.re.test(text)) && !seen.has(r.id) && !!seen.add(r.id)).map(r => ({ id: r.id, label: r.label }))
}

/**
 * A document's title is written into what a model reads (the citation and the block header of every
 * passage), so a title that reads like instructions to an AI is not kept: `fallback` is used instead.
 */
export const safeDocumentTitle = (title: string, fallback: string): string => (detectInjection(title).length ? fallback : title)

export const INJECTION_LABELS: Record<string, string> = Object.fromEntries(RULES.map(r => [r.id, r.label]))
