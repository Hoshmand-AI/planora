// Emails saved from a mail program (.eml) and meeting transcripts exported from Teams, Zoom or Meet
// (.vtt, .srt), turned into plain text for the same pipeline as every other document. Pure.

const decodeQp = (s: string) => Buffer.from(s.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8')
const decodeB64 = (s: string) => Buffer.from(s.replace(/\s+/g, ''), 'base64').toString('utf8')
const decodeBody = (body: string, encoding: string) => (/quoted-printable/i.test(encoding) ? decodeQp(body) : /base64/i.test(encoding) ? decodeB64(body) : body)
/** RFC 2047 encoded words in headers: =?utf-8?B?...?= and =?utf-8?Q?...?= */
const decodeWords = (s: string) => s.replace(/=\?[^?]+\?([BbQq])\?([^?]*)\?=/g, (_, kind: string, data: string) => (kind.toUpperCase() === 'B' ? decodeB64(data) : decodeQp(data.replace(/_/g, ' '))))
/**
 * The words of an HTML message as plain text. The result is stored and shown as text (never as markup);
 * tags are still removed until none is left, so text such as "<scr<script>ipt>" cannot rebuild one, and
 * "&amp;" is decoded last, so "&amp;lt;" stays the literal "&lt;" the sender wrote.
 */
function stripHtml(html: string): string {
  let s = html
  for (let prev = ''; prev !== s;) {
    prev = s
    s = s.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1\b[^>]*>/gi, ' ').replace(/<br\s*\/?>|<\/(?:p|div|tr|li|h\d)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ' ')
  }
  return s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
}

function splitHeaders(raw: string): { headers: Map<string, string>; body: string } {
  const at = raw.search(/\r?\n\r?\n/)
  const head = at < 0 ? raw : raw.slice(0, at)
  const body = at < 0 ? '' : raw.slice(at).replace(/^\r?\n\r?\n/, '')
  const headers = new Map<string, string>()
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const m = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line)
    if (m && !headers.has(m[1].toLowerCase())) headers.set(m[1].toLowerCase(), m[2])
  }
  return { headers, body }
}

/** The readable text of one MIME entity: its text/plain part, else its HTML part without the markup. */
function entityText(headers: Map<string, string>, body: string, depth = 0): string {
  const type = headers.get('content-type') || 'text/plain'
  const boundary = /boundary="?([^";]+)"?/i.exec(type)?.[1]
  if (/^multipart\//i.test(type) && boundary && depth < 5) {
    const parts = body.split(`--${boundary}`).slice(1).filter(p => !p.startsWith('--')).map(p => splitHeaders(p.replace(/^\r?\n/, '')))
    const kind = (p: (typeof parts)[number]) => p.headers.get('content-type') || 'text/plain'
    const isAttachment = (p: (typeof parts)[number]) => /attachment/i.test(p.headers.get('content-disposition') || '')
    const pick = parts.find(p => /^text\/plain/i.test(kind(p)) && !isAttachment(p)) ?? parts.find(p => /^multipart\//i.test(kind(p))) ?? parts.find(p => /^text\/html/i.test(kind(p)) && !isAttachment(p))
    return pick ? entityText(pick.headers, pick.body, depth + 1) : ''
  }
  if (!/^text\//i.test(type)) return ''
  const text = decodeBody(body, headers.get('content-transfer-encoding') || '')
  return /^text\/html/i.test(type) ? stripHtml(text) : text
}

/** A saved email as text: who, when, subject, then the message. Attachments are left out. */
export function emailToText(raw: string): string {
  const { headers, body } = splitHeaders(raw)
  const h = (k: string, label: string) => (headers.get(k) ? `${label}: ${decodeWords(headers.get(k)!)}` : null)
  const top = [h('from', 'From'), h('to', 'To'), h('cc', 'Cc'), h('date', 'Date'), h('subject', 'Subject')].filter(Boolean)
  const text = entityText(headers, body).replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return [...top, '', text].join('\n')
}

/** A WebVTT or SubRip transcript as "Speaker: what they said" lines, without cue numbers and timestamps. */
export function transcriptToText(raw: string): string {
  const out: string[] = []
  let last = ''
  for (const line of raw.replace(/\r/g, '').split('\n')) {
    const t = line.trim()
    if (!t || /^WEBVTT/i.test(t) || /^NOTE\b/.test(t) || /^\d+$/.test(t) || t.includes('-->') /* a cue's timing line */ || /^[0-9a-f-]{8,}(\/\d+-\d+)?$/i.test(t)) continue
    const voice = /^<v\s+([^>]+)>/.exec(t)?.[1]
    // Cue tags (<v Name>, <c>, <i>) are dropped until none is left; a transcript is stored and shown as text.
    let said = t
    for (let prev = ''; prev !== said;) { prev = said; said = said.replace(/<[^>]*>/g, '') }
    said = said.trim()
    if (!said) continue
    const entry = voice ? `${voice}: ${said}` : said
    // The same speaker carrying on: one line, so a sentence split across cues reads as a sentence.
    if (voice && last.startsWith(`${voice}: `)) { out[out.length - 1] += ` ${said}`; last = out[out.length - 1] }
    else if (!voice && out.length && !/[.!?:]$/.test(last) && !/^[^:]{1,40}:\s/.test(said)) { out[out.length - 1] += ` ${said}`; last = out[out.length - 1] }
    else { out.push(entry); last = entry }
  }
  return out.join('\n')
}
