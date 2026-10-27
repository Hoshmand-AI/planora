// One email design for everything RunF9 sends (password reset, email confirmation, invitations),
// built from the same tokens as the app: navy-950 headings, warm text, the accent-600 pill button,
// the RunF9 logo, generous white space. Table layout and inline styles so it holds up in Gmail,
// Outlook and Apple Mail; a <style> block adds hover states and dark mode where the client
// supports them. Every message also has a plain-text part with the same words and the full link.

export interface EmailContent {
  /** Short line most inboxes show next to the subject */
  preheader: string
  /** Big heading at the top of the card */
  title: string
  /** Greeting and body paragraphs (plain text; escaped) */
  paragraphs: string[]
  /** The one thing to do */
  action: { label: string; url: string }
  /** Small print under the button: expiry, single use, who it is for */
  note?: string
  /** Why they got it / what to do if it wasn't them */
  footnote?: string
}

const T = {
  page: '#F5F5F7',
  card: '#FFFFFF',
  line: '#E8E8ED',
  heading: '#0A1628',
  text: '#433D36',
  muted: '#575047',
  accent: '#2563eb',
  accentHover: '#1d4ed8',
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const SANS = `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'DM Sans', Helvetica, Arial, sans-serif`
const DISPLAY = `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', 'DM Sans', Helvetica, Arial, sans-serif`

export function renderEmail(c: EmailContent, origin: string): { html: string; text: string } {
  const base = origin.replace(/\/$/, '')
  const logoLight = `${base}/brand/runf9-email-logo-light.png`
  const logoDark = `${base}/brand/runf9-email-logo-dark.png`
  const url = esc(c.action.url)

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(c.title)}</title>
<style>
  body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; }
  a { color: ${T.accent}; }
  .btn:hover { background: ${T.accentHover} !important; }
  .link:hover { text-decoration: underline !important; }
  .logo-dark { display: none; }
  @media (max-width: 600px) {
    .card { padding: 32px 24px !important; border-radius: 20px !important; }
    .title { font-size: 26px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .page { background: #000000 !important; }
    .card { background: #1C1C1E !important; border-color: #2C2C2E !important; }
    .title { color: #F5F5F7 !important; }
    .body { color: #D1D1D6 !important; }
    .muted { color: #A1A1A6 !important; }
    .rule { border-color: #2C2C2E !important; }
    .logo-light { display: none !important; }
    .logo-dark { display: block !important; }
  }
</style>
</head>
<body class="page" style="margin:0;padding:0;background:${T.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(c.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="page" style="background:${T.page};">
  <tr><td align="center" style="padding:48px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
      <tr><td style="padding:0 8px 28px 8px;">
        <a href="${esc(base)}" style="text-decoration:none;">
          <img class="logo-light" src="${esc(logoLight)}" width="124" height="44" alt="RunF9" style="display:block;border:0;width:124px;height:auto;">
          <img class="logo-dark" src="${esc(logoDark)}" width="124" height="44" alt="RunF9" style="border:0;width:124px;height:auto;">
        </a>
      </td></tr>
      <tr><td class="card" style="background:${T.card};border:1px solid ${T.line};border-radius:24px;padding:44px 44px 40px 44px;">
        <h1 class="title" style="margin:0 0 20px 0;font-family:${DISPLAY};font-size:30px;line-height:1.15;font-weight:600;letter-spacing:-0.02em;color:${T.heading};">${esc(c.title)}</h1>
        ${c.paragraphs.map(p => `<p class="body" style="margin:0 0 16px 0;font-family:${SANS};font-size:16px;line-height:1.6;color:${T.text};">${esc(p)}</p>`).join('\n        ')}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 24px 0;">
          <tr><td class="btn" align="center" style="border-radius:999px;background:${T.accent};">
            <a class="btn" href="${url}" style="display:inline-block;padding:15px 30px;border-radius:999px;background:${T.accent};font-family:${SANS};font-size:16px;font-weight:600;line-height:1;color:#FFFFFF;text-decoration:none;">${esc(c.action.label)}</a>
          </td></tr>
        </table>
        ${c.note ? `<p class="muted" style="margin:0 0 20px 0;font-family:${SANS};font-size:14px;line-height:1.55;color:${T.muted};">${esc(c.note)}</p>` : ''}
        <div class="rule" style="border-top:1px solid ${T.line};margin:8px 0 18px 0;"></div>
        <p class="muted" style="margin:0;font-family:${SANS};font-size:13px;line-height:1.55;color:${T.muted};">Button not working? Paste this link into your browser:<br><a class="link" href="${url}" style="color:${T.accent};text-decoration:none;word-break:break-all;">${url}</a></p>
      </td></tr>
      <tr><td style="padding:24px 8px 0 8px;">
        ${c.footnote ? `<p class="muted" style="margin:0 0 10px 0;font-family:${SANS};font-size:13px;line-height:1.55;color:${T.muted};">${esc(c.footnote)}</p>` : ''}
        <p class="muted" style="margin:0;font-family:${SANS};font-size:13px;line-height:1.55;color:${T.muted};">RunF9 by Hoshmand AI · Construction scheduling, explained.<br><a class="link muted" href="${esc(base)}" style="color:${T.muted};text-decoration:none;">${esc(base.replace(/^https?:\/\//, ''))}</a> · <a class="link muted" href="mailto:support@hoshmand.ai" style="color:${T.muted};text-decoration:none;">support@hoshmand.ai</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`

  const text = [
    c.title, '',
    ...c.paragraphs.flatMap(p => [p, '']),
    `${c.action.label}:`, c.action.url, '',
    ...(c.note ? [c.note, ''] : []),
    ...(c.footnote ? [c.footnote, ''] : []),
    '— RunF9 by Hoshmand AI',
  ].join('\n')

  return { html, text }
}
