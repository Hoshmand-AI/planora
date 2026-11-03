// Network egress guard for the no-egress check (scripts/e2e-no-egress.mjs). Preload it into a Node
// process with  NODE_OPTIONS="--require /abs/path/scripts/egress-guard.cjs"  and every outbound TCP
// connection (plain sockets, TLS, fetch/undici, database drivers) is checked before it opens:
// loopback and private-network destinations are allowed, anything else is refused and recorded as
// one JSON line in $EGRESS_LOG. The record holds only the destination host and port.
'use strict'
const net = require('node:net')
const fs = require('node:fs')

const LOG = process.env.EGRESS_LOG || ''
const PRIVATE = /^(localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|::1|::ffff:127(?:\.\d{1,3}){3}|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:local|internal|lan))$/i
// Independent of RunF9's own RUNF9_ALLOWED_HOSTS on purpose: the guard never takes the app's word for what is inside.
const extra = (process.env.EGRESS_GUARD_ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

function target(args) {
  const a = args[0]
  if (Array.isArray(a)) return target(a) // internal normalized form: [options, cb]
  if (a && typeof a === 'object') return { host: a.host ?? a.hostname ?? 'localhost', port: a.port, path: a.path }
  if (typeof a === 'string' && !/^\d+$/.test(a)) return { path: a } // unix socket path
  return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: a }
}

const original = net.Socket.prototype.connect
net.Socket.prototype.connect = function guardedConnect(...args) {
  const t = target(args)
  if (!t.path) {
    const host = String(t.host).replace(/^\[|\]$/g, '').toLowerCase()
    if (!PRIVATE.test(host) && !extra.includes(host)) {
      const line = JSON.stringify({ at: new Date().toISOString(), host, port: Number(t.port) || null, pid: process.pid })
      if (LOG) { try { fs.appendFileSync(LOG, line + '\n') } catch { /* the check still fails below */ } }
      process.stderr.write(`[egress-guard] blocked outbound connection to ${host}:${t.port}\n`)
      const err = Object.assign(new Error(`egress-guard: outbound connection to ${host}:${t.port} blocked`), { code: 'EGRESS_BLOCKED' })
      process.nextTick(() => this.destroy(err))
      return this
    }
  }
  return original.apply(this, args)
}
