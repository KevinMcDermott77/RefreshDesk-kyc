# RefreshDesk-kyc

# RefreshDesk

> An auditable KYC refresh and remediation tool for UK accountants, TCSPs, and small regulated firms. Turns overdue client lists into one-click campaigns with automated chases, a branded client portal, and an audit-ready paper trail. Built on a RAG-based research assistant that answers compliance questions with cited sources and logs every decision.

---

## What this is

A workflow tool for the unsexy, underserved part of KYC: **refresh and remediation**.

Most KYC vendors sell onboarding — the new-customer flow. RefreshDesk sells the existing-customer flow. UK accountants, TCSPs, and small wealth managers are required by the Money Laundering Regulations 2017 to refresh client KYC on a risk-based schedule. Today they do this in Outlook, spreadsheets, and ad-hoc e-sign tools. The result: missed deadlines, weak audit trails, and analysts spending 30-60% of their time chasing clients for documents.

RefreshDesk replaces that with:

1. **Campaign manager** — bulk launch refresh requests across hundreds of clients
2. **Branded client portal** — secure, no-login document upload with a firm's branding
3. **Auditable AI research assistant** — analyst asks questions about a client's documents, gets cited answers, every step logged
4. **Compliance paper trail** — every action recorded, exportable as an audit pack

This is a workflow product with an AI research engine inside it, not an "AI tool" with a workflow bolted on.

---

## What this is not

- Not a customer onboarding tool (Onfido, Sumsub, Veriff own that segment)
- Not a sanctions/PEP/adverse media data provider (ComplyAdvantage, Dow Jones, Refinitiv)
- Not an enterprise platform for tier-1 banks
- Not a black-box AI that generates compliance decisions without evidence
- Not production-ready yet (see roadmap)

---

## Who it's for

**Primary ICP:** UK accountancy practices, TCSPs, and small wealth managers in the 5-50 user band. Roughly 6,000-8,000 firms in the UK with mandatory MLR obligations and ongoing client refresh burden.

**Secondary ICP:** Specialist lenders, IFAs, family offices, legal/corporate services firms.

**Not for:** Tier-1 banks, large fintechs with existing onboarding stacks, or anyone whose primary problem is high-volume new-customer ID verification.

---

## Core workflow

```
Firm imports client list (CSV) with refresh due dates
        ↓
Firm launches refresh campaign for due/overdue clients
        ↓
Clients receive branded email → secure portal link
        ↓
Clients upload documents + complete questionnaire
        ↓
Documents land in analyst review queue
        ↓
Analyst asks questions: "is the source of funds consistent
with the prior submission?" "are the UBOs unchanged?"
        ↓
RAG engine retrieves evidence from uploaded + historical docs
        ↓
LLM generates cited answer with linked source passages
        ↓
Analyst reviews, approves, flags, or escalates
        ↓
Decision + evidence logged to audit trail
        ↓
Audit pack exportable as PDF for MLRO / FCA examination
```

---

## Why the AI engine matters commercially

The competitive moat for RefreshDesk is **audit quality**, not workflow speed.

Workflow tools are easy to copy. Audit-grade reasoning with traceable evidence is not. Every answer the system produces is grounded in specific document passages, every retrieval scored, every prompt version logged, every human review captured. An MLRO can hand the audit pack to an FCA examiner without flinching.

This is what makes RefreshDesk different from a CRM with email automation. And it's what makes building it a senior-level applied AI engineering exercise rather than a CRUD app.

---

## Specialism alignment

This project is the practical anchor for an 18-month development path in **auditable RAG and AI evaluation for AML/KYC and regulated document workflows**. Every concept learned through structured study (DeepLearning.AI courses, Hugging Face LLM course, AICC Learning Lab, Chip Huyen blog/book) is applied here first.

Course → Concept → Applied to RefreshDesk → Documented in dev log → Portfolio evidence.

---

## Tech stack

| Layer | Technology | Status |
|---|---|---|
| Frontend | Next.js 15 + TypeScript + Tailwind v4 | planned |
| Backend API | FastAPI (Python) | planned |
| LLM | Claude API (claude-sonnet) | planned |
| Embeddings | OpenAI text-embedding-3-small | planned |
| Vector store | pgvector (Postgres) | planned |
| Document parsing | PyMuPDF / pdfplumber | planned |
| Database | Supabase (Postgres) | planned |
| Auth | Supabase Auth (multi-tenant, RBAC) | planned |
| File storage | Supabase Storage (UK region) | planned |
| Email | Resend or Postmark | planned |
| Billing | Stripe | planned |
| Companies House | Existing kyc-search tool, integrated as service | planned |
| Org chart | Existing org-chart-builder, integrated as visualisation | planned |
| Deployment | Railway (UK region) | planned |
| Observability | Custom logging + LangSmith later | planned |

---

## Features — 30-day build target (MVP foundation)

**Multi-tenant infrastructure**
- [ ] Firm signup, auth, RBAC (admin / analyst / auditor roles)
- [ ] Firm settings: branding, logo, retention rules

**Client management**
- [ ] CSV import of client list with refresh due dates
- [ ] Manual client add/edit
- [ ] Risk rating (low / standard / high) per client
- [ ] Client list with filters (overdue, due soon, complete)

**Campaign builder**
- [ ] Select clients (filter or manual)
- [ ] Choose email template
- [ ] Schedule send with reminder cadence (3, 7, 14 days)
- [ ] Send branded email with secure portal link

**Client portal**
- [ ] Magic-link access (no login)
- [ ] Branded landing page (firm logo, colours)
- [ ] Document upload (PDF, JPG, PNG)
- [ ] Configurable questionnaire
- [ ] Submission confirmation

**Analyst review queue**
- [ ] Inbox of submissions
- [ ] Document viewer
- [ ] Approve / reject / request more
- [ ] Internal notes

**Audit trail (the differentiator)**
- [ ] Every event logged with timestamp, actor, payload
- [ ] Per-client audit timeline view
- [ ] Export audit pack as PDF

---

## Features — 90-day build target (the AI layer)

**Document ingestion pipeline**
- [ ] Automatic chunking with configurable strategy
- [ ] Embedding generation and pgvector storage
- [ ] Metadata extraction (document type, date, entity references)

**RAG research assistant**
- [ ] Analyst asks question about a client
- [ ] Semantic search over that client's documents
- [ ] LLM generates answer with inline citations
- [ ] Source passages displayed alongside answer
- [ ] Prompt versioning (which prompt produced which answer)

**Evaluation framework**
- [ ] First 50 evaluation questions with known-good answers
- [ ] Retrieval quality metrics (recall@5, MRR)
- [ ] Citation quality scoring
- [ ] Failure mode log

**Cost & observability**
- [ ] Per-query cost tracking
- [ ] Usage dashboard per firm

---

## Features — 6-month build target (commercial readiness)

- [ ] Stripe billing with tiered subscription
- [ ] Companies House integration (current officers, recent filings)
- [ ] UBO change detection (compare against last refresh)
- [ ] Org chart visualisation of extracted relationships
- [ ] Sanctions/PEP screening via OpenSanctions free tier
- [ ] Onfido integration for ID document authenticity (optional add-on)
- [ ] Practice management integrations (Xero, IRIS) — research only

---

## Features — explicitly out of scope (year one)

- Liveness detection / biometric ID
- Adverse media monitoring (data licensing)
- Real-time perpetual monitoring of registries
- Building proprietary sanctions data
- Multi-jurisdiction registry coverage beyond UK
- Mobile apps
- Algorithmic risk scoring (firms set their own rules)

---

## Evaluation criteria (defined upfront)

The system is evaluated against these from day one, not retrofitted later.

### Retrieval quality
- Does the system retrieve the most relevant passages for a given compliance question?
- Metric: recall@5 against a labelled test set
- Baseline: 10 hand-labelled questions on a sample document set

### Answer quality
- Is the answer factually grounded in retrieved passages?
- Are all claims traceable to a cited source?
- Does the answer avoid hallucinating facts not in the documents?
- Metric: human-rated accuracy on the eval set

### Citation quality
- Does each citation point to the correct passage?
- Is the cited passage sufficient to verify the claim?

### Audit trail completeness
- Is every query logged with timestamp, question, answer, sources, retrieval scores, prompt version?
- Is every human review decision recorded with reviewer ID and rationale?

### Reproducibility
- Can any past answer be reproduced by knowing prompt version + retrieved chunks + model version?

---

## Initial architecture

```
┌──────────────────────────────────────────────────────┐
│                 Frontend (Next.js)                    │
│  Firm dashboard │ Client list │ Campaign builder      │
│  Review queue   │ Audit view  │ Settings              │
└─────────┬────────────────────────────────────────────┘
          │ API calls (authenticated)
┌─────────▼────────────────────────────────────────────┐
│                 Client portal (Next.js)               │
│  Magic-link auth │ Branded UI │ Doc upload │ Q&A      │
└─────────┬────────────────────────────────────────────┘
          │
┌─────────▼────────────────────────────────────────────┐
│              Backend API (FastAPI)                    │
│  /firms │ /clients │ /campaigns │ /portal │           │
│  /documents │ /research │ /audit │ /billing           │
└──┬─────────┬────────┬─────────┬─────────┬────────────┘
   │         │        │         │         │
┌──▼──┐ ┌────▼───┐ ┌──▼─────┐ ┌─▼──────┐ ┌▼──────┐
│Supa │ │pgvector│ │Resend  │ │Claude  │ │Stripe │
│base │ │vectors │ │email   │ │API     │ │billing│
└─────┘ └────────┘ └────────┘ └────────┘ └───────┘
                              │
                       ┌──────▼──────┐
                       │ kyc-search  │ (existing)
                       │ Companies   │
                       │ House lookup│
                       └─────────────┘
```

---

## Project rules

1. **Build alongside learning.** Every module completed in any course = one applied change to RefreshDesk.
2. **Evaluation first.** Write the eval question before building the feature it tests.
3. **No black boxes.** Every AI answer must be traceable to source passages.
4. **Log everything.** If it isn't logged, it didn't happen.
5. **Human in the loop.** No compliance decision is finalised without human approval.
6. **Ship in vertical slices.** Each slice = a real workflow a firm can use end-to-end.
7. **UK first.** Don't bake in multi-jurisdiction assumptions that fragment the data model.
8. **Boring stack.** No experimental frameworks. Next.js + FastAPI + Postgres + Claude.

---

## Commercial model (planned)

Tiered subscription, billed monthly or annually:

| Tier | Monthly | Clients on file | Users |
|---|---|---|---|
| Starter | £149 | 100 | 2 |
| Practice | £349 | 500 | 5 |
| Firm | £749 | 2,000 | 15 |

Annual contracts at 10x monthly. No per-document or per-check fees in year one — keeps the sales conversation simple.

---

## Path to first 5 paying customers

1. Pick 50 NI/Ireland accountancy firms within reach (existing AutoMate playbook fits)
2. Offer 3 a free 6-month pilot in exchange for design feedback and a public logo
3. Convert pilots to paid testimonials and case studies (refresh time saved, audit pack quality)
4. Use those to close 3-5 paid at £349/mo via ICAEW networks, MLRO LinkedIn groups, FCA SME forums
5. After 10 paying customers, broaden to UK mainland via cold outreach + content

---

## Development log

| Date | What was built | What was learned |
|---|---|---|
| — | — | — |

*Updated after every working session.*

---

## Related projects (existing)

- [kyc-search](../kyc-search) — Companies House lookup; integrated as the structured-data layer for entity refresh
- [org-chart-builder](../org-chart-builder) — Entity relationship visualiser; integrated as the visualisation layer for extracted UBO/control structures

---

## Author

Kevin McDermott — AML/KYC compliance professional and applied AI engineer in training. Based in Northern Ireland.

Specialising in auditable RAG and AI evaluation for regulated document workflows.
