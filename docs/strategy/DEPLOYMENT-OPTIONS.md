# Deployment options: letting each customer choose their cloud

Question from the founder (10/27/2026): when an organization adopts RunF9, can it choose the platform
(AWS, Microsoft Azure, Google Cloud, or RunF9's own), so one product fits Deloitte on AWS, an Azure
shop, and a firm that wants it in-house?

**Short answer: yes, and it is the right direction, if "choose your cloud" means *RunF9 runs inside
the customer's own cloud account* (often called "bring your own cloud"). It is the wrong direction if
it means *RunF9 operates its own copy of the service on three clouds*.** The difference decides
whether this is affordable for a small team.

## Two things "choose your cloud" can mean

| | A. RunF9 runs the service on AWS, Azure and Google | B. RunF9 installs into the customer's own account |
|---|---|---|
| Who holds the data | RunF9 (on whichever cloud was picked) | The customer, in their own account |
| What the security reviewer hears | "Still a third party holding our data" | "Our data never leaves our tenant" |
| Cost to RunF9 | Three production systems to run, monitor, secure, back up and audit; SOC 2 scope triples | One product, packaged once; the customer runs the servers |
| Who it wins | Almost nobody: buyers care about *who* holds the data, not which cloud a vendor uses | Large firms, owners, government and defense work |
| Verdict | **Don't** (except a second *region* later, for data residency) | **Do**, for enterprise contracts |

So the onboarding choice should be: **"Start on RunF9 Cloud now"** (self-serve), or **"Deploy in
your AWS / Azure / Google account or on your own servers"** (an enterprise contract with an install).
The cloud is picked when the contract is signed, not by a self-serve button that provisions
infrastructure. Building that button means building a cloud platform company.

This choice is on the website now: the "Run it where your data lives" section
(`src/components/landing/Deployment.tsx`) lets a visitor pick RunF9 Cloud, their AWS, Azure or
Google Cloud account, or their own servers, shows where the data lives and which AI is used for each,
labels each option "Available now" or "On request", and routes the request with the cloud named.

## A different cloud for each client (10/28/2026)

Some firms need several clouds at once: one owner mandates Azure, another AWS, a third Google Cloud.
RunF9 handles this as **one deployment per cloud**, not one database spread across clouds:

- each client's projects run in a RunF9 deployment inside the cloud that client requires (the firm's
  account or the client's), with its own PostgreSQL;
- schedules, project documents and the **document-search (RAG) index stay in that deployment's
  database**, so nothing about one client's project is stored in another client's cloud;
- each deployment uses the AI in its own cloud (Azure OpenAI, Bedrock, Vertex AI) or none;
- the firm's people sign in to every deployment with the same company login (SSO, already built).

Shown on the website ("A different cloud per client" chip and tab, labelled "On request") and in the
app (Home shows where data is stored; Organization > "Where your data lives" lists the clouds with a
request link). Each deployment can name itself with `RUNF9_DATA_LOCATION`.

**Next step if customers ask for it: one portfolio across deployments.** A read-only "portfolio
summary" that each deployment publishes (status, finish, variance; no files or documents), pulled
into one view with the firm's SSO. Build it when a paying firm runs two or more deployments. Routing
individual projects to different databases inside one deployment is *not* recommended: every query,
the audit log, backups and the security boundary would have to span clouds.

### Where the RAG data should live

In **the same database as the project it describes**, i.e. the client's cloud when the project runs
in the client's cloud, and RunF9 Cloud only for projects hosted there. Reasons:

1. **The index is the documents.** Passages and their vectors can be read back into contract and spec
   text, so a central copy in RunF9's (or another cloud's) database would move the client's data out
   of the cloud the client chose.
2. **Access rules stay in one place.** Workspace walls, document approval, CUI flags and deletion
   apply to the passages because they sit in the same database as the project.
3. **Deletion and retention are simple.** Delete the project or end the contract and the index goes
   with it; there is no second copy to chase.
4. **It already works this way.** Keyword and construction-vocabulary search run inside Postgres;
   meaning-based search stores vectors in the same database and is computed only by a model inside
   the customer's network (`RUNF9_EMBEDDINGS_MODEL`). On RunF9 Cloud no outside embedding service is
   used.

## Why this is feasible for RunF9 specifically

RunF9 already avoids cloud-specific services. It is:

- one Node.js container (the Docker image already exists, with an SBOM);
- a PostgreSQL database (any managed Postgres works: Amazon RDS/Aurora, Azure Database for
  PostgreSQL, Google Cloud SQL/AlloyDB, or self-hosted);
- an optional AI model behind one gateway (`src/lib/llm/provider.ts`), with an OpenAI-compatible
  local mode;
- an air-gapped mode with a proof that nothing leaves (`scripts/e2e-no-egress.mjs`).

Keyword and meaning-based document search run inside Postgres, so they move with the database. The
one rule that keeps this cheap: **nothing in the core may depend on a single cloud.** Each cloud
gets an *adapter* (how to deploy, which Postgres, which model service), and the product stays the
same everywhere.

## What it takes, per cloud

| Piece | Work | Notes |
|---|---|---|
| Helm chart (Kubernetes) | Once | Covers Amazon EKS, Azure AKS and Google GKE in one package |
| "Quick start" template per cloud | Once per cloud | Terraform (AWS, Google) / Bicep (Azure): network, Postgres, container service, secrets, TLS |
| Customer's own AI service | Once per cloud | Azure OpenAI (close to the existing OpenAI adapter), Amazon Bedrock and Google Vertex AI (both offer Claude; need their own sign-in methods) |
| In-network embeddings | Done | Any OpenAI-compatible embedding server; the cloud services above need the same adapters |
| Licensing | Once | A signed license key (seats, expiry) checked offline; no calling home |
| Conformance suite | Mostly done | The existing end-to-end scripts plus the no-egress check, run against any install; "supported" means "passes the suite" |

Order: **Azure first** (construction firms run on Microsoft 365, and government work leans Azure
Government / GCC High), **then AWS** (including GovCloud), **Google only when a paying customer asks.**
Don't build an adapter before a customer is waiting for it.

## The maintenance cost (the part that decides it)

Self-hosted software is cheap to *sell* and expensive to *keep*. Plan for this before the first
contract:

1. **Versions in the wild.** Customers upgrade on their schedule, so several versions run at once.
   Set a support policy (e.g. the current and two previous releases) and keep migrations additive,
   as the repo already requires.
2. **Security fixes can't be pushed.** RunF9 Cloud is patched in minutes; customer installs wait for
   the customer. Ship signed images and a security notice, and make upgrades one command.
3. **Every environment is different**: proxies, private DNS, identity providers, certificate
   authorities. Most support time goes here. The configuration reference and conformance suite are
   the defence.
4. **Testing multiplies.** Don't run full CI on every cloud for every change. Run the suite on the
   container and Postgres (already done), and run a full install test per cloud before each release.
5. **Debugging is blind.** No access to customer logs by default. Build a "support bundle" export
   (logs and configuration, without customer data) that the customer reviews and sends.
6. **Price it.** Private deployment should be an enterprise tier: an annual license plus an
   implementation fee. Its support cost per customer is several times that of a cloud customer.

## Verdict

- **Right approach?** Yes, as *one cloud-neutral product in two delivery modes*: RunF9 Cloud for
  most customers, and a private deployment (customer's cloud or air-gapped) for enterprise. Not as
  RunF9 running the service on three clouds.
- **Possible?** Yes. The architecture already fits; the work is packaging (Helm, per-cloud
  templates), the customer's own AI services (Azure OpenAI, Bedrock, Vertex), licensing, and
  support tooling.
- **Efficient?** Only with discipline: no cloud-specific code in the core, one artifact for every
  target, a conformance suite as the definition of "supported", adapters built only when a customer
  is waiting, and an enterprise price that pays for the support.
