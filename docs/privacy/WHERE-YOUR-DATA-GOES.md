# Where your data goes

One page per question a security reviewer asks: what leaves RunF9, to whom, and how to make sure
nothing leaves at all. It covers the three ways to run RunF9. Details: [DATA-MAP.md](DATA-MAP.md),
[SUBPROCESSORS.md](SUBPROCESSORS.md), [PROJECT-DOCUMENTS.md](PROJECT-DOCUMENTS.md),
[ON-PREM-INSTALL.md](../operations/ON-PREM-INSTALL.md).

## The three ways to run RunF9

| | **RunF9 cloud** (runf9.ai) | **Your cloud** (your AWS / Azure / Google account) | **Air-gapped** (your servers, no internet) |
|---|---|---|---|
| Where the database lives | Neon (managed Postgres, US) | Your managed Postgres, in your account | Your Postgres, on your network |
| Who runs the servers | Hoshmand AI (Vercel) | You (or Hoshmand AI under your account's access rules) | You |
| AI model | Anthropic Claude (or OpenAI) through RunF9's account, **only if your admin turns AI on** | Your model: Azure OpenAI, AWS Bedrock or Google Vertex in your account, or a self-hosted model | A model on your own hardware (Ollama, vLLM, llama.cpp, TGI), or none |
| Data that leaves your control | Everything you store is held by RunF9's providers ([SUBPROCESSORS.md](SUBPROCESSORS.md)) | None outside your cloud account | **None** (proved by the egress check below) |
| CUI / classified projects | Not allowed | Allowed if your account is authorized for it (e.g. GovCloud, Azure Government) | Allowed |

"Your cloud" is the container image and Compose/Postgres setup from [ON-PREM-INSTALL.md](../operations/ON-PREM-INSTALL.md)
run in your own account. See [DEPLOYMENT-OPTIONS.md](../strategy/DEPLOYMENT-OPTIONS.md) for the plan.

## Every path data can take out of RunF9

RunF9 opens a connection on its own in only these places. In an air-gapped install
(`RUNF9_AIRGAPPED=true`) each one is limited to hosts inside your network by one rule
(`src/lib/server/egress.ts`): loopback, private addresses, `*.internal` / `*.local` / `*.lan` names,
or hosts you list in `RUNF9_ALLOWED_HOSTS`. Anything else is refused **before** connecting.

| Path | What would be sent | RunF9 cloud | Air-gapped |
|---|---|---|---|
| AI answers, reports, interview suggestions | Relevant schedule content and, with "Use project documents", approved passages. Never CUI/classified projects, never flagged passages, never answers marked "Can't share" | To the cloud AI provider, only after your admin turns AI on | Only to your in-network model; a public model address is refused |
| Document search (keyword + construction vocabulary) | Nothing: runs inside Postgres | Inside the database | Inside the database |
| Document search (meaning-based) | Passages and the question, turned into vectors | **Not used** (no cloud embedding service is supported) | Only by an embedding model inside your network (`RUNF9_EMBEDDINGS_MODEL`); a public address is refused in every deployment |
| Cloud storage you connect (Organization > Cloud storage) | Original schedule and document files you choose to keep there; RunF9 lists and reads files you pick to import | Your own S3 bucket, Azure Blob container or Cloud Storage bucket, with the key or SAS token you gave, or after you sign in: Microsoft (login.microsoftonline.com) or Google (oauth2.googleapis.com) issue RunF9 a token for that storage only; for AWS, RunF9 asks AWS STS for one-hour credentials for the role you created (encrypted; disconnect wipes it) | Only storage inside your network (an S3-compatible store such as MinIO, or a host in `RUNF9_ALLOWED_HOSTS`); a public cloud address is refused |
| Email (confirmations, invitations, password reset) | Recipient address and the message | Resend (or Postmark) | Hosted email providers are refused even if a key is set. Nothing is emailed: invitation links are shown to the admin to pass on (no SMTP relay option yet) |
| Webhooks and security alerts (`RUNF9_ALERT_WEBHOOK_URL`) | Event name, ids and the plan/schedule fields of the event | Public HTTPS receivers you add (internal addresses are refused) | Only HTTPS receivers inside your network that you listed in `RUNF9_ALLOWED_HOSTS` |
| Single sign-on (OIDC) | Sign-in exchange with your identity provider | Your identity provider | Only an identity provider inside your network (e.g. AD FS, Keycloak) or listed in `RUNF9_ALLOWED_HOSTS` |
| Backups | Encrypted database dump | Neon point-in-time recovery; optional encrypted copy in GitHub | Your backup target (`scripts/backup.mjs`) |

Not in the list because RunF9 never does them: analytics or tracking scripts, error reporting to a
third party, telemetry, font or script CDNs (fonts are bundled), or calling home for licensing. In
the browser, the Content-Security-Policy on every page (`next.config.js`) lets the page load scripts,
styles and fonts only from RunF9 itself and connect only back to RunF9 (`connect-src 'self'`).

## Proof: the no-egress check

`scripts/e2e-no-egress.mjs` runs on every change in CI. It:

1. starts a stand-in for your own model server on `127.0.0.1` (chat and embeddings);
2. starts RunF9 air-gapped with **a network guard preloaded into the server process**
   (`scripts/egress-guard.cjs`): every outbound TCP connection to a non-private address is refused and
   recorded. The guard has its own allow-list and does not trust RunF9's settings;
3. proves the guard works, both in a separate process and **inside the RunF9 server** (a deliberate
   connection to an allow-listed public host must be caught, and nothing else);
4. uses the product the way a customer would: sign-up and email confirmation, P6 upload and
   analysis, the interview, AI suggestions, CPM generation, XER/XML/PDF exports, document upload,
   approval, vocabulary and meaning-based search, Ask AI with and without documents, a QA/QC report,
   and an admin trying to add a public webhook and an internet identity provider;
5. fails unless **zero** outbound connections were attempted, and unless the AI features really
   reached the in-network model (so the run exercised them). With AI off (the default for a new
   organization) it also checks that nothing reaches even the in-network model.

What the guard does not cover, so the check does not claim it: DNS lookups (they go to your
resolver), and a forward proxy (an air-gapped network has none; the check removes proxy settings and
your network should block them). The guard trusts host names that look internal
(`*.internal`); your DNS must resolve them inside your network.

## The honest limits

- **RunF9 cloud cannot promise "nothing leaves"**: your data is stored by RunF9's providers. That
  promise needs "your cloud" or "air-gapped".
- **Models on your own hardware are weaker** than the largest cloud models and need a GPU server for
  good speed. Every scheduling feature works without any model.
- **Meaning-based search quality depends on your embedding model.** Keyword search with the
  construction vocabulary always runs, so search never depends on it.
