// Text encoding for P6 XER files. P6 writes and reads XER in the Windows client code page, which is
// Windows-1252 for US/Western installs (not ISO-8859-1: bytes 0x80–0x9F are € ‚ ƒ „ … † ‡ ˆ ‰ Š ‹ Œ Ž
// ‘ ’ “ ” • – — ˜ ™ š › œ ž Ÿ). Newer P6 releases can also write UTF-8. The importer and the exporter
// share this module so a file written by Planora reads back byte-for-byte the same way.

export type XerEncoding = 'utf-8' | 'windows-1252'

/** Windows-1252 code points for bytes 0x80..0x9F (0 = undefined byte, decoded as the C1 control). */
const CP1252_HIGH = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0,
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178,
]
const TO_CP1252 = new Map<number, number>()
CP1252_HIGH.forEach((cp, i) => { if (cp) TO_CP1252.set(cp, 0x80 + i) })

/** True when the character can be written to a Windows-1252 XER. */
export function isCp1252(ch: string): boolean {
  const c = ch.codePointAt(0)!
  return c < 0x80 || (c >= 0xa0 && c <= 0xff) || TO_CP1252.has(c)
}

export function decodeCp1252(data: Uint8Array): string {
  let out = ''
  for (let i = 0; i < data.length; i++) {
    const b = data[i]
    out += String.fromCharCode(b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] || b : b)
  }
  return out
}

/** Encode to Windows-1252; characters outside the code page become '?'. */
export function encodeCp1252(text: string): Buffer {
  const out = Buffer.alloc(text.length)
  let n = 0
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    out[n++] = c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : TO_CP1252.get(c) ?? 0x3f
  }
  return out.subarray(0, n)
}

/** Decode an XER: UTF-8 when the bytes are valid UTF-8 (BOM optional), otherwise Windows-1252. */
export function decodeXer(data: Uint8Array): { text: string; encoding: XerEncoding; bom: boolean } {
  const bom = data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bom ? data.subarray(3) : data)
    return { text, encoding: 'utf-8', bom }
  } catch {
    return { text: decodeCp1252(data), encoding: 'windows-1252', bom: false }
  }
}

export function encodeXer(text: string, encoding: XerEncoding = 'windows-1252', bom = false): Buffer {
  if (encoding === 'utf-8') return Buffer.concat([bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(text, 'utf8')])
  return encodeCp1252(text)
}
