# Planora: Competitive Landscape & Positioning

*Research date: 2026-10-04. Sources were checked through web search, and every claim about a company carries a numbered source `[n]` (see **Sources** at the end). Funding totals from aggregators (CB Insights, Tracxn, VCBacked, Dealroom) are third-party estimates. Where a number could not be verified, this document says **unverified** or **not public**. Pricing in the "recommendation" sections is our proposal, not market data.*

---

## 1. Executive summary (decision-oriented)

1. **The incumbent "system of record" is still Primavera P6, and specifications enforce it.** USACE/NAVFAC spec UFGS 01 32 01.00 10 has a section headed *"Primavera P6 Mandatory Requirements"* and requires a native P6 XER baseline [37]. Every AI entrant that won traction (ALICE, nPlan, SmartPM, Nodes & Links, Foresight) **reads and writes P6** rather than trying to replace it [17][1][3][27][31]. Planora must be "P6-native in, P6-native out".
2. **Capital is going to "AI layers on top of the schedule", not to new CPM engines.** Recent rounds: ALICE (about $201M total, Series C-II Feb 2025) [2]; nPlan (€13.7M Series B, Oct 2025) [4]; Nodes & Links ($12M Series B, Feb 2025) [27]; Foresight ($25M Series A, Mar 2026) [31]; Planera ($8M, Oct 2025, $26.5M total) [8]; Buildots ($130M, total $297M) [10].
3. **Consolidation is accelerating in 2026.** Procore bought Datagrid (agentic AI, about $190M, Jan 2026) [13] and agreed to buy DroneDeploy for about $845M [14]. OpenSpace bought Disperse (Oct 2025) [29]. Autodesk renamed ACC to **Forma** (Mar 2026) [21]. Kahua raised $250M at a valuation above $1B from Bain (Sep 29, 2026) [41]. The exit path for an AI scheduling tool is acquisition by a platform, so integrations matter more than owning the workflow.
4. **The low end is commoditizing quickly.** Several new tools now run DCMA 14-point checks on uploaded XER/MPP files with an "AI copilot": Kazinex Planner, XERXES, PathProof and XER Toolkit, plus open-source P6 MCP servers [36]. Schedule Validator charges about **$40/user/month** [24] and Steelray Project Analyzer about **$1,500/year** [24]. **On its own, a DCMA check is not a differentiator.**
5. **Generative scheduling is proven at the megaproject top end but sold through consultants.** ALICE formalized a McKinsey alliance in April 2026 and claims up to 20% schedule reduction across more than 35 deployments [16]. This is high-touch and expensive. Nobody has made **explained** generative scheduling usable for a mid-market scheduler.
6. **Trust is the primary barrier.** In one 2025 survey of 400 US and Canadian construction professionals, **65% "don't fully trust AI"** [39]. Concerns about data accuracy (57%) and security (54%) lead the list of barriers [39]. Black-box output ("the model says 14 days") will not survive a USACE schedule reviewer or a claims expert.
7. **Federal and defense security is a real gap.** Oracle Primavera Cloud only reached **FedRAMP "In Process"** in Jan 2026 [38]. Kahua is FedRAMP Moderate authorized and sells to USACE, State OBO, the VA and GSA [40]. None of the AI-native schedulers found here advertise an air-gapped or on-premises deployment. This is not a crowded space for Planora's air-gapped mode.
8. **There is a timing opportunity right now.** Microsoft **retired Project Online on Sep 30, 2026**, four days before this report. Desktop Project remains, and Microsoft is pushing users to Planner and Copilot agents [19]. MSP-based schedulers at mid-size GCs are being forced to re-platform.
9. **Pricing norms favor per-project, unlimited-user pricing for team tools** (SmartPM, Touchplan, Planera, ALICE) [5][25][9][18]. Per-seat pricing is the norm for desktop schedulers (P6 Pro is about $2,570 perpetual plus about $550/year maintenance; Asta is about £1,470/year) [17][22].
10. **The failure lessons:** companies tried to change how construction *is done* (Katerra, Veev; vertical integration that burned more than $2B and about $600M respectively) [33][34], or depended on one platform's distribution. Software that augmented existing workflows got acquired (PlanGrid for $875M, Fieldwire for $300M, Synchro by Bentley, Avvir by Hexagon) [30][23][20][28].

**Recommended wedge:** *"Defensible P6 baselines and schedule reviews for federal and public work, explained line-by-line, deployable air-gapped."* Sell first to **independent scheduling consultants and owner's reps**, who review and produce schedules for many projects. Sell second to **mid-size federal and public GCs**, who have to pass UFGS, DCMA and GAO-style reviews.

---

## 2. Market size

| Estimate | Value | Source / year | Notes |
|---|---|---|---|
| Construction management software (global) | **$3.9B (2024) → about $7.6B (2030), 12% CAGR** | Verdantix, 2024–2030 forecast [42] | The most credible analyst figure found. Drivers: talent shortage, owner-led digitization, project risk |
| Construction software (broad) | $19.4B (2023), 14.6% CAGR to 2029 | Secondary market-research summary [42] | Broad definition (design, ERP, and more). Use cautiously |
| Construction PM software (2025) | Estimates range from **$5.4B to $17.4B**, with 9–11% CAGRs | Multiple research vendors [43] | Wide range: definitions vary, so the precision is low |
| "Construction AI scheduling" | $544M (2024) → $784M (2034) | GII / Global Insight Services [42] | Low-quality estimate. It treats AI scheduling as a small niche |
| Procore revenue (proxy for spend) | About $1.31B FY2025 guidance, about 14% growth | Procore Q3 2025 release [11] | One vendor's revenue is about a third of Verdantix's whole CM-software market, so definitions clearly differ |

**Takeaway:** treat **scheduling and project-controls software as roughly a $1–2B slice** (*our estimate, not sourced*) inside a $4–8B construction-management software market growing about 10–12% a year. A solo founder does not need TAM slides. The relevant number is bottom-up: there are thousands of firms that must submit P6 schedules on public work (*unverified count*). At **$2–20K a year each**, a few hundred customers is a $1–5M ARR business.

---

## 3. Competitive landscape

### 3.1 Incumbent schedulers and analyzers

| Company / product | Founded / HQ | Stage & funding | Pricing (public) | Core offering | Strengths | Weaknesses / complaints | 2026 status |
|---|---|---|---|---|---|---|---|
| **Oracle Primavera P6 / Primavera Cloud** (Oracle Construction & Engineering) | P6 lineage since the 1980s (*unverified*); Oracle, Austin TX | Incumbent (Oracle) | P6 Pro about $2,570 perpetual plus about $550/yr; EPPM about $2,750 plus $605/yr; EPPM cloud about $125/user/mo (US reference), £244/user/mo with a 25-user minimum (UK G-Cloud 2026) [17] | Enterprise CPM, EPPM, cloud scheduling. AI features: schedule generation from RFP content, AI-assisted logic and duration suggestions, Schedule Health Score [35] | Mandated by specs (USACE/NAVFAC) [37]; XER is the industry interchange format | Steep learning curve, expensive, "overkill" for small projects (Planning Planet forum threads) [44]; opaque licensing [17] | **Dominant.** Primavera Cloud FedRAMP "In Process" since Jan 2026 [38] |
| **Microsoft Project** | 1984 (*unverified*); Redmond | Incumbent | Plan 1 $10, Plan 3 $30, Plan 5 $55/user/mo; Planner Premium $10 [26] | General-purpose scheduling | Ubiquitous, cheap | Weaker for large CPM and claims work (*industry consensus, unverified*); **Project Online retired Sep 30, 2026** [19] | **Contracting cloud footprint.** Desktop continues; strategy is moving to Planner and Copilot [19] |
| **Asta Powerproject** (Eleco plc) | Asta acquired by Eleco in 2006; UK [22] | Incumbent (LSE-listed parent) | From about $1,675/user; UK subscription £1,470/yr [22] | CPM, 4D BIM, resources | Strong in UK and APAC; more usable than P6 (*common practitioner view, unverified*) | Small share in the US federal market (*unverified*) | Stable; Eleco still acquiring (BestOutcome 2023) [22] |
| **Phoenix Project Manager** | 2005, Salt Lake City [45] | Small independent | Starts at $799 [45] | Desktop CPM, Mac and Windows | Cheap; fast fragnet and TIA work (*unverified*) | Small vendor, limited ecosystem | Active (niche) |
| **Spider Project** | 1993; mostly Russian customers [46] | Small independent | Not public | Resource-, cost- and material-constrained optimization | Strong optimization engine | Geopolitical and sanctions exposure for US buyers | Niche |
| **Safran Project / Safran Risk** | Stavanger, Norway; acquired by **JDM Technology Group, Sep 30, 2021** [47] | Acquired (roll-up) | Not public | Integrated schedule and cost risk (QSRA) | Respected for Monte Carlo risk | Enterprise-only | Active under JDM |
| **InEight Schedule** | Kiewit subsidiary launched 2014; Scottsdale AZ [48] | Corporate subsidiary | Not public | CPM, AI-assisted planning from historical schedules, risk, short-interval planning [49] | Kiewit data and heavy-civil credibility; more than 22,000 users at more than 500 companies [48] | Enterprise suite; competitors may distrust Kiewit ownership (*unverified*) | Active |
| **Deltek Acumen** (Fuse, Risk, 360) | Deltek, Herndon VA | Incumbent | Not public | 300+ schedule-quality metrics, DCMA 14-point, risk, acceleration [50] | **Used by DCMA's own analysts** to standardize assessments [50]; release 8.10 in Mar 2025 [51] | Desktop-era UX; expensive (*unverified*) | Active, the federal standard for analysis |
| **Steelray Project Analyzer** | Steelray, Atlanta (*unverified*) | Small independent | About $1,500/yr flat [24] | P6/MSP quality checks | Cheap, focused | No generation | Active |
| **Schedule Validator** (Sylo Management) | 2015 [52] | Small independent | $40/user/mo [24] | Web DCMA+ scoring for P6, MSP and Asta [52] | Low price, web-based | Analysis only | Active |
| **Contruent** (formerly ARES PRISM) | 1994; Naperville IL; renamed 2023 [53] | Established private company | Not public | Capital-project cost and controls | Owner and EPC project controls | Not a scheduler | Active, expanding in APAC [53] |

### 3.2 AI and analytics scheduling startups

| Company | Founded / HQ | Funding (last round) | Traction signals | Pricing | Core offering | Weaknesses / risks | 2026 status |
|---|---|---|---|---|---|---|---|
| **ALICE Technologies** | Stanford spin-out; Redwood City CA (*HQ unverified*) | About $201.6M total; **Series C-II $22M, Feb 11, 2025** (aggregator) [2]; Series B $30M plus a $13M extension [1] | McKinsey alliance (Apr 17, 2026), more than 35 clients, claims of up to 20% acceleration and about 40% on one data center [16]; Kajima partnership [54] | Custom; token-based for ALICE Core; unlimited users [18] | Generative and optimization scheduling from P6 XER/XML/XLSX [17b] | High-touch and consultant-led; black-box perception (*inferred*); megaproject focus | **Succeeding at the top end** |
| **nPlan** | London (*unverified*) | €13.7M Series B, Oct 2025 (CapHorn, Chevron Technology Ventures, Suffolk Technologies; GV existing); about $42.9M total [4] | Trained on more than 750,000 schedules [4]; Network Rail rollout, HS2 [55] | Not public | ML forecasting of schedule risk (an alternative to traditional QSRA) | Infrastructure and owner focus; UK-centric | **Succeeding** |
| **SmartPM** | Atlanta (*unverified*) | $5.5M Series A, Mar 2024 (Building Ventures, GS Futures, Nemetschek) [3] | More than 100K schedules analyzed, more than 7M activities tracked [3] | Per project, unlimited users. 2021 list: $69, $167 and $250 per project-month [5] | Schedule analytics: quality, delay, compression, forecasting | Gantt UX, "pricey for mid-size", setup effort [56] | **Steady** (lightly funded) |
| **Nodes & Links** | 2018; Cambridge UK / Cyprus [27] | $12M Series B, Feb 2025 (ETF Partners); $24.8M total [27] | Construction, energy, aerospace and defense | Not public | AI schedule management: delay navigation, change control, trends [27] | Enterprise sales cycle | **Growing** |
| **Foresight** | Europe (*unverified*) | **$25M Series A, Mar 2026** (Macquarie; Creandum, ISAI Build/Bouygues) [31] | Data centers, power, defense | Not public | Turns schedules into delay predictions; claims 2x more accurate predictions [31] | Early stage | **Growing** |
| **Planera** | 2021; San Jose CA [7][8] | $8M (Oct 13, 2025, including Zachry); $26.5M total [8] | Data-center focus | Custom; unlimited users [9] | Visual collaborative CPM for GCs and subs, with AI to find delays | Must displace P6/MSP inside GCs | **Growing** (data-center tailwind) |
| **Outbuild** | 2021; remote [6] | $11M Series A, Nov 2024 (Sway; Hilti and Trimble Ventures) [6] | More than 4,000 projects in 10 countries (2024); about 83 staff (Aug 2026) [6][57] | Not public [58] | CPM plus lookahead and pull planning; ACC integration [21b] | Mid-market GC focus overlaps with Procore and Autodesk | **Growing** |
| **Touchplan** (MOCA Systems) | 2014; Boston [25] | Not public | More than 59K users, more than 4,600 projects; Boldt and Alberici enterprise deals [59] | **$15–30K per $50–100M project**, unlimited seats [25] | Lean pull planning; Doxel integration [12] | "Priced for larger companies" [25] | Active |
| **Karmen** | 2024; San Francisco; YC F24 [60] | YC (amount not public) | Early | Not public | Builds baselines from specs and drawings and keeps them updated [60] | Two-person team; trust problem | Early. **The closest conceptual competitor** |
| **Kazinex Planner, XERXES, PathProof, XER Toolkit** | 2024–2026 (*dates unverified*) | Not public | Not public | Not public | Browser DCMA-14, Monte Carlo, update comparison, TIA and forensic PDFs, AI copilot [36] | Thin moats | **Commoditizing Planora's analysis features** |
| **Buildots** | Tel Aviv / London | $130M (2026, led by OG Venture Partners); $297M total [10]; $45M Series D, May 2025 [10b] | More than 100 large organizations (Intel, Digital Realty, JE Dunn, Mortenson) [10] | Not public | Computer-vision progress tracking against the schedule | Requires capture hardware | **Breakout** |
| **Doxel** | 2016 [12] | $56.5M total; $40M Series B, Aug 2021 [12] | Kaiser, Shell [12] | Not public | CV progress tracking | No new round since 2021 [12] | Operating; *trajectory unverified* |
| **OpenSpace** | San Francisco | About $200M total; $50M Series D (2025) (aggregator) [29] | Acquired Disperse, Oct 28, 2025 [29] | Not public | 360° capture plus progress tracking | Not a scheduler | **Consolidator** |
| **Track3D** | 2022 [61] | $10M Series A (Ironspring); $14.3M total [61] | More than 400 projects; Hensel Phelps [61] | Not public | Reality capture tied to quantities | Early | Growing |
| **Reconstruct** | 2016 [62] | Series B led by Nemetschek, May 2025; about $16M total (aggregator) [62] | Not public | Not public | 4D reality and schedule risk | Small | Active |
| **Avvir** | (*unverified*) | $10M (earlier) [28] | Not public | Not public | Scan-vs-BIM progress | | **Acquired by Hexagon, Oct 2022** [28] |
| **Disperse** | London | Not public | Not public | Not public | Progress tracking | | **Acquired by OpenSpace, 2025** [29] |
| **Slate Technologies** | 2020; Pleasanton CA [63] | About $20.2M; Series B Apr 2023 [63] | Not public | Not public | AI decision assistant across project data | Broad positioning | Active; *traction unverified* |
| **Datagrid** | Canada | About $37.7M raised before acquisition [13] | | | Agentic AI across 100+ systems | | **Acquired by Procore, about $190M, Jan 2026** [13] |
| **Trunk Tools** | New York (*unverified*) | $40M Series B, Jul 2025 (Insight); $70M total [64] | Suffolk, DPR; revenue up 5x in 6 months [64] | Not public | Document Q&A and AI agents | Not a scheduler | **Breakout** |
| **Gryps** | 2019 [65] | About $7.7M total [65] | Owner focus | Not public | Owner data aggregation and closeout | Small | Active |
| **Kojo** | 2018 (as Agora) [66] | $94M total; $10M from Wesco, Sep 2025 [66] | 8 trades | Not public | Materials procurement | Adjacent only | Active |
| **Bild AI** | 2025; YC W25 [67] | $3.6M seed (Khosla) [67] | Early | Not public | Blueprint reading for takeoff and code | Adjacent (could feed quantities into scheduling) | Early |
| **Constructable** | 2023; Santa Barbara; YC [68] | About $500K (aggregator) [68] | Early | Not public | GC copilot and project management | Small | Early |
| **Mosaic Building Group** | 2015; Phoenix [69] | $68.75M total; $44M Series B [69] | $100M Mandalay Homes deal [69] | n/a | Tech-enabled GC for production housing | Vertical-integration model (the Katerra risk) | *2026 status unverified* |
| "Hojo", "Struxi" | — | — | — | — | Could not be verified as construction-scheduling companies. "Struxi" most likely refers to **StruxHub** (logistics and coordination) [70] | — | **Unverified** |

### 3.3 Platforms with scheduling modules

| Platform | Facts | Scheduling relevance | Status |
|---|---|---|---|
| **Procore** | FY2025 revenue guidance about $1.31B, about 14% growth [11]; pricing by Annual Construction Volume; renewal increases are a top complaint (third-party analysis) [71]; AI Agents and Agent Builder [11b] | Imports and displays schedules; does not run CPM. Acquisitions: **Datagrid** [13], **DroneDeploy (agreed, about $845M)** [14] | Dominant GC platform, building an AI layer |
| **Autodesk Forma Build** (formerly ACC/Build) | Renamed Mar 24, 2026 [21]; schedule tool imports P6 (.xer/.xml), MSP (.mpp/.xml) and Asta (.pp) and compares up to 5 versions [21b]; PlanGrid acquired for $875M (2018) [30] | Viewer and comparison; integrates Outbuild [21b] | Strong |
| **Trimble** | Acquired Viewpoint for $1.2B [72]; Trimble Ventures invested in Outbuild [6]. Vico Office status: **unverified** (no EOL notice found) | Weak native CPM | Stable |
| **Bentley SYNCHRO** | Synchro (UK, founded 2001) acquired June 2018 [20] | 4D sequencing tied to iTwin | Active |
| **Fieldwire (Hilti)** | Acquired for $300M in Nov 2021; 4,000 paying companies at the time [23] | Field task management with light scheduling | Active |
| **Kahua** | FedRAMP Moderate (2022), GovRAMP; USACE AFCEC, State OBO, VA, GSA [40]; **$250M from Bain at more than $1B valuation (Sep 2026)** [41] | Owner PMIS; partner, not competitor | **Breakout in owner and government markets** |

### 3.4 Failures, exits and pivots

| Company | What happened | Lesson for Planora |
|---|---|---|
| **Katerra** (founded 2015) | Raised more than $2B (about $1B from SoftBank), was valued at $4B, filed Chapter 11 in June 2021. Layoffs began in 2019, then its lender Greensill collapsed [33] | Don't try to change how construction is *done*. Capital intensity kills. Sell software into existing workflows |
| **Veev** | About $600M raised, unicorn in 2022, shut down Nov 2023 after a funding round was cancelled [34] | The same lesson: vertical integration needs continuous fundraising |
| **PlanGrid → Autodesk ($875M, 2018)**, **Fieldwire → Hilti ($300M, 2021)**, **Synchro → Bentley (2018)**, **Avvir → Hexagon (2022)**, **Datagrid → Procore (2026)**, **Disperse → OpenSpace (2025)** [30][23][20][28][13][29] | Focused tools that are loved in the field get bought by platforms | Build the best focused tool and integrate everywhere. Buyers are Oracle, Procore, Autodesk, Bentley, Hexagon, Nemetschek, Trimble and Deltek |
| **Microsoft Project Online** | Retired Sep 30, 2026 [19] | Even Microsoft didn't win construction CPM with a generic tool |
| **Pure scheduling-startup shutdowns** | No verified 2024–2026 shutdown of a construction-scheduling startup was found | *Absence of evidence.* Failed startups in this niche tend to fade quietly or be acqui-hired |

---

## 4. Patterns: why winners win

1. **They ride P6 instead of fighting it.** ALICE ingests XER and XML [17b], SmartPM and Schedule Validator analyze P6, MSP and Asta [3][52], and Autodesk imports all three [21b]. Spec-driven demand (UFGS) means the XER file is the deliverable [37].
2. **They sell to whoever owns the risk.** nPlan (Network Rail, HS2) [55], Foresight (Macquarie, data centers) [31] and Buildots (Intel, Digital Realty) [10] sell to **owners** or megaproject programs, where a 1% delay costs millions. Foresight cites about $14M/month in delay cost for a 60MW AI facility [31].
3. **They ride a vertical tailwind.** Data centers appear in the Planera, Buildots, Foresight and ALICE stories [8][10][31][16].
4. **Distribution through trusted intermediaries.** ALICE goes through McKinsey [16], Deltek through DCMA's own analysts [50], Kahua through GSA sponsorship [40], and Outbuild through Hilti and Trimble ventures [6].
5. **Per-project, unlimited-user pricing** removes friction where many parties touch the schedule [5][9][18][25].
6. **Compliance as a moat.** Kahua's FedRAMP authorization took years and unlocked USACE, State, VA and GSA [40]. Oracle is still "In Process" [38].

**Why companies fail or stall:** capital-intensive vertical integration (Katerra, Veev); tools that need new hardware or behavior on every site (slow); horizontal "AI assistant for everything" positioning with no owned workflow (*inferred*); and black-box outputs that schedulers cannot defend in a review or a claim (see the trust data [39]).

---

## 5. Unmet needs (what schedulers complain about)

| Pain | Evidence | Planora answer |
|---|---|---|
| P6 is costly and hard to learn, and overkill for most projects | Planning Planet threads ("Fed up with Primavera", "P6 more easy options") [44]; perpetual about $2.5K plus 22%/yr [17] | Interview-driven schedule build that **exports clean XER**, so the client never opens P6 to create a baseline |
| AI is not trusted; black-box outputs | 65% don't fully trust AI; 57% worry about data accuracy [39] | **Every duration and logic link carries a written basis**: source (spec section, historical analog, production rate), assumptions, and confidence |
| Garbage in, garbage out | 57% cite data-accuracy concerns [39]; DCMA checks exist because input quality is poor [50] | Validate on import, show the DCMA failures *with the fix*, one-click repair with a diff |
| Baseline rejections and review cycles on federal jobs | UFGS mandatory P6 requirements and review checklists [37] | A "**Spec-compliance pre-flight**" for UFGS 01 32 01.00 10 (and NAVFAC 01 32 16/17) before submittal |
| Monthly update reviews take a lot of time | SmartPM, PathProof and Kazinex all sell update-to-update comparison [3][36] | Narrative auto-generation: "what changed, why it matters, who must act" |
| Security for federal and defense, data sovereignty | 54% cite security concerns [39]; Primavera Cloud not yet FedRAMP authorized [38] | **Air-gapped / on-prem deployment**, SSO, MFA, audit log. Pursue CMMC-aligned and FedRAMP-ready paths later |
| Delay claims and forensic analysis need defensible methods | Tools such as XERXES advertise TIA and forensic reports [36] | TIA/fragnet generator with an audit trail, mapped to AACE RP 29R-03 method names (*no source checked for 29R-03 in this research*) |
| Recovery planning is manual | ALICE's what-if and acceleration value proposition [16] | Ranked recovery options (crash, fast-track, resequence) with cost and risk deltas and an *explanation*. A "mini-ALICE" for the mid-market |

---

## 6. Positioning and differentiation for Planora

### 6.1 Positioning statement

> **Planora is the explainable AI scheduler for public and federal work: it interviews you, builds a CPM schedule where every duration and tie has a written basis, proves it against DCMA, GAO and UFGS, and hands you a clean P6 file. It runs in the cloud or fully air-gapped.**

The positioning against each class of competitor:
- **vs. P6, MSP and Asta:** "Planora doesn't replace P6. It produces the P6 file faster and better."
- **vs. ALICE:** "Generative scheduling for the 95% of projects too small for a McKinsey engagement, and it explains itself."
- **vs. SmartPM, Acumen and the DCMA checkers:** "They tell you what's wrong. Planora tells you why, fixes it, and builds the next one right."
- **vs. Procore and Forma:** they display schedules; Planora creates and defends them, and integrates with them.

### 6.2 Wedge market (in order)

1. **Independent scheduling and claims consultants (1–20 people) and owner's reps / CM-agency firms.** They produce or review dozens of schedules a year, feel P6 cost and review time directly, and the founder's 22 years of consulting is the credibility here. Each one also acts as a channel to their clients.
2. **Mid-size GCs doing USACE, NAVFAC, VA, GSA and state DOT work** ($50M–$500M revenue). They must submit P6 baselines, get rejected, and have one overloaded scheduler.
3. **Later:** defense and sensitive programs that need **air-gapped** deployment, sold through primes or system integrators, plus MSP-to-P6 migrants left behind by the Project Online retirement [19].

Avoid in year 1: megaproject owners (ALICE, nPlan, Foresight territory, with 12–18-month sales cycles), homebuilders, and specialty trades.

### 6.3 Pricing tiers (recommendation, anchored to public comparables)

| Tier | Who | Price (proposal) | Anchors |
|---|---|---|---|
| **Free "Schedule Check"** | Anyone with an XER or MPP file | Free: 1 file a month, DCMA-14 report with plain-English explanations, Planora watermark | Commodity checkers at $40/user/mo and $1,500/yr [24]. Use this as the lead magnet |
| **Pro (individual scheduler or consultant)** | Solo schedulers | **$149/mo or $1,490/yr**: unlimited checks, generation, XER/MSP export, Monte Carlo | Below P6 Pro maintenance plus Acumen; above the commodity checkers because it *generates* |
| **Project** | GC or owner team on a single job | **$500–$1,000 per project-month, unlimited users**: update narratives, recovery options, review workflow | SmartPM 2021 list of $69–$250 per project-month [5]; Touchplan $15–30K per project [25] |
| **Enterprise / Gov** | Firms with 10+ projects; federal | **From $25K/yr**. Self-hosted or air-gapped, SSO/SAML, audit export, compliance package | Primavera EPPM cloud at about $125–£244/user/mo with 25-seat minimums [17] |

Offer a **"consultant partner" program**: wholesale pricing (for example 40% off) so consultants can resell or bundle Planora in their fixed-fee schedule-development services.

### 6.4 Go-to-market for a solo founder with little money

1. **Sell the service first, the software second.** Offer a "48-hour defensible baseline" or a "UFGS pre-flight review" as a fixed-fee service delivered with Planora ($2.5–7.5K; *suggested*). This produces cash, case studies and training data.
2. **Use the founder's network:** 22 years of consulting contacts translate into 30 warm calls to owner's reps, CM agencies and federal GCs. Target 10 paid pilots at $500–$1,000 each.
3. **Content where schedulers already gather:** Planning Planet, the AACE International community, LinkedIn, PMI-SP circles (*channels named by us; no audience sizes verified*). Publish "DCMA-14 explained with real fixes" and "Why your USACE baseline got rejected" as teardown posts that use the free checker.
4. **Integrations as distribution:** an Autodesk Forma Build partner listing (Outbuild has one [21b]), the Procore App Marketplace, and XER round-tripping with Primavera Cloud.
5. **Plan for a federal path later:** SAM.gov registration, GSA Schedule through a reseller (Carahsoft distributes Kahua and Deltek-related content [40][50]), and a CMMC/NIST 800-171 self-assessment. Air-gapped mode avoids FedRAMP for on-prem customers.
6. **Avoid VC-scale burn.** The winners raised $5–25M only *after* proving traction (SmartPM's Series A was $5.5M [3]). Bootstrap to roughly $500K ARR, then decide.

### 6.5 "Wow" features (build these)

1. **Explain-every-number ("basis of schedule").** Click any duration or tie and see the source spec section or drawing, the production-rate math, the historical analog, the assumptions and the confidence. Export it as a Basis of Schedule narrative, which UFGS-style submittals ask for and nobody automates.
2. **Spec pre-flight.** Upload the contract spec (UFGS 01 32 01) and the XER, and get a pass/fail checklist against *that contract's* scheduling clauses plus DCMA-14 and GAO best practices, with one-click fixes shown as a diff.
3. **Round-trip-safe XER and MSP XML.** Lossless import and export with calendars, codes, UDFs and resources preserved, plus a fidelity report. This trust feature beats any AI demo.
4. **Monthly update narrative in 5 minutes:** what slipped, the critical-path shift, float erosion, and out-of-sequence progress, drafted in the reviewer's voice.
5. **Recovery options ranked with an explanation:** "Option B saves 18 working days by splitting Activity 3400 across two crews. Cost +$42K; risk P80 moves from June 12 to May 28." This is ALICE-lite for the mid-market.
6. **Defensible Monte Carlo:** risk ranges tied to the risk register, with tornado and criticality index outputs. Export in a form compatible with Safran or Acumen Risk users.
7. **TIA / fragnet builder** with an immutable audit log, for change orders and claims.
8. **Air-gapped mode plus a provable audit trail** (who changed which logic, when, and why), aimed at federal, defense and claims-litigation users.

### 6.6 What NOT to build

- **A full PMIS** (RFIs, submittals, daily logs): Procore, Forma and Kahua own it [11][21][40].
- **Reality capture or computer-vision progress tracking:** Buildots ($297M raised), OpenSpace, Doxel and Track3D [10][29][12][61]. Integrate with them instead.
- **A P6 replacement for enterprise EPPM** (portfolio, resource leveling across 1,000 projects). Interoperate instead.
- **Lean pull planning and lookahead boards:** Touchplan, Outbuild and Planera already do this [25][6][8].
- **Black-box "optimize" buttons with no rationale:** the trust data says this fails [39].
- **Megaproject owner forecasting from a proprietary dataset:** nPlan (750K schedules) [4] and Foresight [31] lead here, and you can't win a data race solo.
- **FedRAMP authorization in year 1:** too costly. Use air-gapped and on-prem deployment for federal customers first.

---

## 7. Key risks to this strategy

- **Commodity squeeze:** DCMA checkers and MCP servers are free or cheap [36]. Planora's moat must be the **explained generation, spec pre-flight and round-trip fidelity**, not the checks.
- **Oracle catches up:** Primavera Cloud already advertises AI logic and duration suggestions and RFP-based generation [35]. Planora should differentiate on explainability, MSP and Asta support, and air-gapped deployment, which Oracle's cloud cannot offer.
- **Liability:** an AI-generated baseline that gets used in a claim can be attacked. Keep a human scheduler of record and keep the full audit trail.

---

## Sources

1. ENR, "ALICE Technologies Raises $30M in Series B Funding": https://enr.com/articles/54311-alice-technologies-raises-30m-in-series-b-funding ; Series B extension: https://cretech.com/news/construction/construction-design-platform-alice-technologies-bags-fresh-capital-to-expand
2. CB Insights, ALICE financials (Series C-II $22M, Feb 11, 2025; $201.55M total): https://www.cbinsights.com/company/alice-4/financials
3. SmartPM Series A ($5.5M), Business Wire: https://www.businesswire.com/news/home/20250312879905/en ; Silicon UK: https://www.silicon.co.uk/press-release/smartpm-secures-5-5m-in-series-a-funding-to-accelerate-growth-and-innovate-schedule-controls-platform
4. nPlan €13.7M Series B: https://finder.techleap.nl/news/feed/nplan-raises-13-7m-for-ai-projects ; GV round: https://www.venturecapitaljournal.com/gv-leads-18-5m-round-for-nplan/
5. SmartPM 2021 pricing, Extranet Evolution: https://extranetevolution.com/2021/02/smartpm-grow/ ; current per-project model: https://www.softwareadvice.com/construction/smartpm-profile/
6. Outbuild $11M Series A: https://www.outbuild.com/blog/outbuild-secures-11-million-in-series-a-funding ; https://www.constructiondive.com/press-release/20241112-outbuild-secures-11-million-in-series-a-funding/
7. TechCrunch, Planera $13.5M: https://techcrunch.com/2024/08/27/planera-raises-13-5m-to-help-solve-the-gnarly-problem-of-scheduling-for-construction-contractors
8. Planera $8M (Oct 2025): https://www.ironpros.com/home/product/22953284/planera-planera-secures-8-million-to-expand-data-center-construction-scheduling-platform ; https://www.thesaasnews.com/news/planera-raises-8-million-in-funding/
9. Planera pricing page: https://planera.io/pricing
10. Buildots $130M: https://www.prnewswire.com/il/news-releases/buildots-raises-130m-to-bring-ai-to-the-16t-construction-industry--and-power-the-global-data-center-buildout-302877516.html ; [10b] $45M Series D: https://techcrunch.com/2025/05/29/buildots-raises-45m-to-help-companies-track-construction-progress/
11. Procore Q3 2025 results: https://www.businesswire.com/news/home/20251105447371/en/Procore-Announces-Third-Quarter-2025-Financial-Results ; [11b] Procore AI agents: https://businesswire.com/news/home/20241120915400/en/5750295/Procore-Launches-Procore-AI-with-New-Agents-to-Boost-Construction-Management-Efficiency
12. Doxel $40M Series B: https://forconstructionpros.com/construction-technology/news/21603318/doxel-raises-40m-from-insight-partners-to-scale-ai-construction-progress-monitoring ; profile: https://cbinsights.com/company/doxel
13. Procore acquires Datagrid: https://aecmag.com/news/procore-acquires-datagrid/ ; price (~$190M): https://www.vectorshift.ai/research/deals/procore-toric-labs-d-b-a-datagrid-2026 ; Verdantix: https://www.verdantix.com/insights/blog/construction-software-consolidation-heats-up-in-2026--procore-acquires-datagrid-as-hexagon-launches-multivista
14. Procore to acquire DroneDeploy for $845M: https://aecmag.com/news/procore-agrees-to-acquire-dronedeploy-for-845m/
16. McKinsey–ALICE alliance: https://www.mckinsey.com/capabilities/operations/our-insights/operations-blog/mckinsey-and-alice-technologies-collaborate-to-transform-capital-project-delivery-with-generative-scheduling ; https://www.constructiondive.com/news/mckinsey-alice-technologies-partner-generative-ai-schedule/817580/ ; https://blog.alicetechnologies.com/news/mckinsey-and-alice-technologies-form-alliance
17. Primavera licensing (reference prices): https://oraclelicensingexperts.com/oracle-primavera-licensing-p6-costs ; https://redresscompliance.com/oracle-primavera-cloud-vs-p6-eppm-licensing ; UK G-Cloud 15 pricing: https://assets.applytosupply.digitalmarketplace.service.gov.uk/g-cloud-15/documents/702001/817687594476487-pricing-document-2026-01-28-1553.pdf ; [17b] ALICE Optimize (P6 inputs): https://www.alicetechnologies.com/alice-optimize
18. ALICE pricing (custom, token-based, unlimited users): https://www.alicetechnologies.com/pricing ; https://blog.alicetechnologies.com/news/alice-uses-ai-to-optimise-p6-schedules
19. Project Online retirement (Sep 30, 2026): https://blog.theprojectgroup.com/tpg-blog-en/blog/en/project-online-retirement-2026 ; https://www.schneider.im/microsoft-project-online-retirement/
20. Bentley acquires Synchro (2018): https://architosh.com/2018/06/aia2018-bentley-announces-acquisition-of-synchro-software/
21. ACC renamed Autodesk Forma: https://architosh.com/2026/03/autodesk-construction-cloud-acc-is-now-autodesk-forma/ ; [21b] Autodesk Build schedule tool imports: https://www.autodesk.com/blogs/construction/autodesk-build-schedule-tool/ ; Outbuild integration: https://construction.autodesk.co.nz/workflows/construction-software-integrations/outbuild
22. Asta Powerproject pricing: https://www.capterra.co.uk/software/173782/powerproject ; https://shop.eleco.com/products/asta-powerproject-uk ; Eleco history: https://eleco.com/company/about-us ; BestOutcome: https://www.constructiondive.com/press-release/20230925-eleco-plc-acquires-bestoutcome-strengthens-elecosofts-building-lifecycle-1
23. Hilti acquires Fieldwire ($300M): https://enr.com/articles/53015-hilti-acquires-startup-fieldwire-in-300m-deal
24. Steelray pricing: https://www.capterra.com/p/84189/Steelray-Project-Analizer/ ; Schedule Validator pricing: https://www.capterra.com/p/10012584/Schedule-Validator/
25. Touchplan pricing and reviews: https://www.capterra.ca/software/148419/touchplan-io
26. Microsoft Project pricing: https://thedigitalprojectmanager.com/tools/microsoft-project-pricing/
27. Nodes & Links $12M Series B: https://tech.eu/2025/02/18/nodes-links-raises-12m-to-streamline-construction-projects/ ; https://www.seedtable.com/startups/Nodes_&_Links-DBB5GDG
28. Avvir (Hexagon acquisition): https://www.cbinsights.com/company/avvir ; $10M raise: https://cretech.com/news/avvir-raises-10m-for-ai-that-spots-construction-site-errors
29. OpenSpace acquires Disperse: https://aecmag.com/project-management/openspace-acquires-construction-progress-tracking-firm-disperse/ ; OpenSpace funding: https://www.cbinsights.com/company/openspace
30. Autodesk–PlanGrid ($875M), SEC 8-K: https://www.sec.gov/Archives/edgar/data/0000769397/000076939718000055/ex991plangridclosepressrel.htm
31. Foresight $25M Series A: https://datacentremagazine.com/news/foresight-raises-25-million-to-tackle-data-centre-build-delays ; https://pulse2.com/foresight-25-million-raised-for-ai-infrastructure-project-delivery-platform-expansion
33. Katerra: https://www.axios.com/2021/06/08/katerra-bankruptcy-softbank ; https://news.bloomberglaw.com/bankruptcy-law/softbank-backed-katerra-files-bankruptcy-with-billions-in-debt ; https://therealdeal.com/2021/06/10/inside-katerras-final-days/
34. Veev shutdown: https://techcrunch.com/2023/11/27/prefab-home-builder-veev-reportedly-shutting-down-after-reaching-unicorn-status-last-year ; https://www.calcalistech.com/ctechnews/article/hkhfvyhbp
35. Oracle Primavera Cloud roundup (Mar 2026): https://www.oracle.com/customer-hub/construction-engineering/primavera-cloud/roundups/march-2026/ ; Oracle AI in C&E: https://www.oracle.com/webfolder/dms/prod/d3/446004-6-Real-AI-Cons-Engineering.pdf
36. New DCMA/AI schedule checkers: https://www.kazinex.com/products/planner ; https://xerxesai.app/ ; https://pathproof.app/ ; https://xertoolkit.com/our-features/schedule-quality/ ; https://glama.ai/mcp/servers/shamshirialireza/P6-MCP ; https://lobehub.com/mcp/osama-ata-p6xer-mcp-server (vendor pages were blocked from direct fetch, so these claims come from search-result snippets)
37. UFGS 01 32 01.00 10 Project Schedule: https://www.wbdg.org/FFC/DOD/UFGS/UFGS%2001%2032%2001.00%2010.pdf ; NAVFAC review checklist: https://stg.wbdg.org/FFC/NAVGRAPH/01%2032%2017.00%2020_Contractor_Baseline_Project_Schedule_Review_Checklist.pdf
38. Oracle Primavera Cloud FedRAMP In Process (Jan 21, 2026): https://www.oracle.com/news/announcement/oracle-primavera-cloud-achieves-fedramp-in-process-designation-2026-01-21/
39. AI trust and barrier surveys: https://www.placersolutions.io/research-preview (A.I. Excellence in Construction Survey, n=400, 65% don't fully trust AI) ; https://roadsbridges.com/technology/news/55337001/report-most-contractors-expect-ai-to-change-how-projects-get-built (57% data accuracy, 54% security) ; https://www.rics.org/news-insights/artificial-intelligence-in-construction-report
40. Kahua FedRAMP Moderate: https://resources.kahua.com/news/kahua-announces-fedramp-moderate-authorization-status-with-the-sponsorship-of-the-gsa ; https://kahua.com/brochure/why-using-fedramp-approved-construction-project-management-tool/
41. Kahua $250M from Bain (more than $1B valuation): https://dealroom.co/news/157624-kahua-raises-250m-at-1b-valuation-as-bain-bets-on-construction-software/
42. Verdantix market size 2024–2030: https://www.verdantix.com/insights/report/market-size-and-forecast--construction-management-software-for-real-estate---built-environment-2024-2030-global ; Construction AI scheduling market (GII): https://cn.gii.tw/report/gis1956880-construction-ai-scheduling-market-analysis.html
43. Construction management software market estimates: https://www.marketsandmarkets.com/Market-Reports/construction-project-management-software-market-232539827.html ; https://alliedmarketresearch.com/press-release/construction-management-software-market.html ; https://technavio.com/report/global-construction-management-software-market ; https://www.coherentmi.com/industry-reports/construction-software-market/market-size
44. Planning Planet threads: https://planningplanet.com/comment/63481 ; https://planningplanet.com/comment/47651
45. Phoenix Project Manager: https://www.ironpros.com/home/company/10897113/phoenix-project-management-systems-llc ; pricing: https://www.g2.com/products/phoenix-project-manager/pricing
46. Spider Project: https://en.wikipedia.org/wiki/Spider_Project
47. Safran acquired by JDM Technology Group: https://spearhead.com.au/company-news/new-acquisition-to-the-jdm-family
48. InEight / Kiewit: https://www.kiewit.com/about-us/technology-at-kiewit/ineight/ ; https://globest.com/2014/05/28/kiewit-technology-changes-name-expands
49. InEight Schedule capabilities: https://ineight.com/software-capabilities-of-ineight-schedule/
50. Deltek Acumen and DCMA: https://tensix.com/deltek-acumen-fuse-and-the-dcmas-14-point-assessment/ ; https://www.carahsoft.com/resources/13144-defense-contract-management-agency-dmca
51. Acumen 8.10: https://www.deltek.com/en/blog/acumen-8-10-enhancements
52. Schedule Validator (founded 2015, DCMA+): https://www.capterra.com/p/10012584/Schedule-Validator/ ; https://platform.softwareone.com/product/schedule-validator/PCP-1224-9892
53. Contruent: https://www.appsruntheworld.com/apps-top-500-software-vendors/contruent-formerly-ares-prism/ ; https://www.contruent.com/about/news/contruent-announces-partnership-with-engineers-australia-to-strengthen-project-delivery-in-apac-region/
54. Kajima–ALICE: https://blog.alicetechnologies.com/news/kajima-group-partners-with-alice-technologies-to-reimagine-construction-scheduling
55. Network Rail–nPlan: https://www.networkrailmediacentre.co.uk/news/network-rail-using-innovative-technology-to-transform-project-planning-and-delivery ; HS2: https://creativedestructionlab.com/companies/nplan/
56. SmartPM reviews: https://www.capterra.com/p/137005/SmartPM/reviews/ ; https://www.g2.com/products/smartpm-technologies/reviews_and_filters
57. Outbuild headcount and traction: https://www.tipranks.com/private-companies/outbuild ; https://yespress.io/outbuild
58. Outbuild pricing (not public): https://www.g2.com/products/outbuild/pricing
59. Touchplan enterprise agreements: https://itdigest.com/information-communications-technology/software-and-services/touchplan-and-the-boldt-company-complete-enterprise-agreement/ ; https://www.constructiondive.com/press-release/20220111-touchplan-and-alberici-flintco-complete-enterprise-agreement
60. Karmen (YC F24): https://ycombinator.com/companies/karmen ; https://www.ycombinator.com/launches/MCy-karmen-the-ai-assistant-for-construction-project-managers
61. Track3D: https://www.sociable.co/technology/reality-intelligence-startup-track3d-raises-10m-to-tackle-construction-delays/amp ; https://pulse2.com/track3d-construction-reality-intelligence-company-raises-4-3-million-seed
62. Reconstruct: https://www.preqin.com/data/profile/asset/reconstruct--inc-/327487 ; https://www.geoweeknews.com/articles/reconstruct-3d-reality-models-4d-bim-aec-scheduling-risk-insight/
63. Slate Technologies: https://commercialobserver.com/2022/03/contech-slate-technologies-ai/ ; https://www.vcbacked.co/company/slate-technologies
64. Trunk Tools $40M Series B: https://www.insightpartners.com/ideas/trunk-tools-closes-40m-series-b-to-lead-constructions-ai-transformation/
65. Gryps: https://ldv.co/blog/2021/3/30/investing-in-gryps-to-modernize-the-construction-industry-with-process-automation-computer-vision-amp-ai ; https://www.cbinsights.com/company/gryps/financials
66. Kojo: https://distributionstrategy.com/2025/09/kojo-secures-10-million-investment-from-wesco-expanding-construction-tech-platform/ ; https://techcrunch.com/2022/09/14/construction-tech-kojo-materials-management-supply-chain/embed/
67. Bild AI: https://ycombinator.com/companies/bild-ai ; https://www.vcbacked.co/company/bild-ai
68. Constructable: https://www.cbinsights.com/company/constructable ; https://ycombinator.com/companies/constructable
69. Mosaic Building Group: https://www.builderonline.com/design/technology/construction-technology-company-mosaic-raises-44m-series-b-to-fuel-expansion_o ; https://therealdeal.com/2020/09/02/tech-startup-inks-100m-deal-to-help-build-400-homes/
70. StruxHub: https://struxhub.com/blog/how-advanced-construction-scheduling-tools-can-transform-your-projects-insights-and-strategies-from-struxhub/
71. Procore pricing analysis (third-party): https://projul.com/blog/procore-pricing-analysis-2026/ ; https://www.getonecrew.com/post/procore-pricing
72. Trimble–Viewpoint ($1.2B): https://news.crunchbase.com/startups/by-acquiring-construction-startups-big-tech-aims-to-help-build-more-than-software/

*(Source numbers 15 and 32 are intentionally unused.)*
