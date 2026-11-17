#!/usr/bin/env node
// A stand-in aerial picture source for scripts/e2e-site-map.mjs: a picture for most map squares, a web page for
// zoom 5, nothing for zoom 6. It writes the square each request asked for, and whether it carried anything beyond
// a plain fetch, to the file named in LOG, one JSON line per request, so the test can show the source is told the square and nothing else.
//   PORT=4599 LOG=/tmp/tiles.jsonl node scripts/mock-tiles.mjs

import fs from 'node:fs'
import http from 'node:http'
import zlib from 'node:zlib'

/** A real PNG of one colour. */
export function png(width, height, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = buf => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]) }
  const head = Buffer.alloc(13); head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())])
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))), chunk('IEND', Buffer.alloc(0))])
}
export const TILE = png(256, 256, [90, 110, 80])

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const LOG = process.env.LOG
  http.createServer((req, res) => {
    const m = /^\/(\d{1,2})\/(\d{1,8})\/(\d{1,8})\.png$/.exec(req.url || '')
    // Only what the test needs, in a fixed shape: the square asked for and whether anything about a member came with it.
    const h = req.headers
    // Every header the request carried is checked here against what a plain fetch sends plus the two the tile
    // route sets, and only the verdict is written: nothing a caller chose reaches the file.
    const plain = new Set(['host', 'connection', 'accept', 'user-agent', 'accept-language', 'accept-encoding', 'sec-fetch-mode'])
    const extra = Object.keys(h).filter(n => !plain.has(n)).length
    if (LOG) fs.appendFileSync(LOG, JSON.stringify({ square: m ? `${Number(m[1])}/${Number(m[2])}/${Number(m[3])}` : null, extra, fixed: h['user-agent'] === 'RunF9' && h.accept === 'image/*' }) + '\n')
    if (!m) { res.writeHead(404); res.end(); return }
    if (m[1] === '5') { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end('<!doctype html><html><script>alert(1)</script></html>'); return }
    if (m[1] === '6') { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(TILE)
  }).listen(Number(process.env.PORT || 4599), '127.0.0.1', () => { if (LOG) fs.appendFileSync(LOG, JSON.stringify({ ready: true }) + '\n') })
}
