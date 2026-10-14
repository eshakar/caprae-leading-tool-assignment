# SaaSquatch Pro: lead intelligence that tells you *who to call first and what to say*

An enhancement to Caprae Capital's [SaaSquatch](https://www.saasquatchleads.com/) lead-generation tool, built for the
Caprae Full Stack Developer pre-screening challenge.

| | |
|---|---|
| **Backend** | FastAPI · SQLAlchemy 2 · PostgreSQL 17 · Alembic · httpx · BeautifulSoup · dnspython · Anthropic Claude |
| **Frontend** | Next.js 16 (App Router, Cache Components) · React 19 · Tailwind CSS v4 · shadcn/ui · React Bits · SWR · Recharts |
| **Infra** | Docker (multi-stage) · Docker Compose · GitHub Actions CI · AWS (RDS + ECS Fargate / App Runner + ECR + Secrets Manager) |

```
fastapi-caprae/   REST API: enrichment crawler, email verification, Deal Signal scoring, AI outreach, CSV import/export
nextjs-caprae/    Web app: dashboard, lead table, lead workspace, pipeline board, scoring-profile editor
docs/             AWS deployment guide
```

---

## 1. The business problem

SaaSquatch is Caprae's primary **sourcing** tool. Its users are search funders and PE operators looking for
lower-middle-market companies to acquire, plus B2B sales teams prospecting the same SMBs. Scraping a list of
companies is easy. What users actually lose time on is everything *after* the list:

1. **Which of these 500 companies should I call first?** Raw lists don't rank, and every row looks the same.
2. **Can I even reach them?** Half the emails bounce and many are `info@` inboxes nobody reads.
3. **What do I say?** Writing a credible, personalised first touch to a 60-year-old founder takes 15 minutes per lead.

So I took the **Quality First** approach. On top of a solid lead database I built two headline features, plus two
workflow features that turn the tool from a list into a daily operating system:

### ⭐ Feature 1: explainable Deal Signal Score
Every lead gets a **0–100 score with a reason for every point**, measured against the user's own Ideal Customer /
Acquisition Profile.

- **Two modes:** *Acquisition sourcing* rewards succession signals (retirement language, family-owned,
  second-generation, 30+ years of founder tenure, a website untouched since 2019), independence and longevity.
  *B2B sales* rewards buying triggers (hiring, an outdated site, no CRM detected).
- **Knockout gates** stop a strong-looking but irrelevant lead from ranking as "hot": a wrong industry caps the
  score at 55, a wrong geography at 70, and an already PE-backed target (acquisition mode) at 40. The UI says
  exactly which gate applied.
- **Tunable weights.** The user drags sliders, and every lead is rescored server-side instantly.
- **Next best action** on every lead ("Enrich to uncover contacts", "Book an intro call while interest is warm"…).

*Why it matters:* a ranking that can't explain itself doesn't get trusted. A searcher has to justify each outreach
to investors, and an SDR manager has to justify territory. Explainability is what turns a score into a workflow.

### ⭐ Feature 2: AI Outreach Copilot (grounded, not generic)
One click produces a **subject + email, a LinkedIn note (≤300 chars), a cold-call opener and a follow-up**, written
by Claude from *only* the facts we scraped. The JSON schema is enforced, and the prompt forbids invented awards,
news or numbers. You choose the goal (acquisition / sales / partnership) and tone, and it remembers who you are.
"Open in mail & mark contacted" moves the lead along the pipeline. Draft history is kept per lead.

- Uses `claude-opus-5-5` with structured outputs and server-side refusal fallback.
- **Degrades gracefully.** Without an API key, or if the API is down or rate-limited, a deterministic template
  engine produces a usable, personalised draft, so the feature never breaks a demo or a workflow.
- Acquisition copy is deliberately founder-respectful: it talks about legacy, employees and continuity rather than
  "buying your company". That reflects Caprae's operator-first, post-acquisition value-creation philosophy.

### ⭐ Feature 3: follow-up tracker, Action Center and activity timeline
Most deals are lost in the follow-up, not the first email.
- Moving a lead to **Contacted** stamps `last_contacted_at` and schedules a follow-up in 3 days. **Replied** schedules
  a "book the call" nudge for the next day. **Meeting / Won / Lost** clears it. Users can override with quick picks
  (+3 days, +1 week…) or a date picker.
- The dashboard opens with **Today's actions**: overdue follow-ups (with "2d overdue"), follow-ups coming up this
  week, and hot leads nobody has contacted yet. The leads table and pipeline cards flag "Follow-up due", and there's
  a matching filter.
- Every lead keeps an **append-only activity timeline**: created, enriched (what was found), enrichment failures,
  stage changes, score moves of 3+ points (and why), drafts generated, notes and field edits. It's the audit trail a
  CRM would keep, and it makes handoffs between team members painless.

### ⭐ Feature 4: printable target one-pager
`/leads/{id}/memo` renders a clean, print-ready **target profile**: snapshot (headcount, revenue, years in business,
owner, stage, next follow-up), **"Why it fits"** and **"Risks & gaps to diligence"** (taken straight from the
explainable score), detected signals, tech stack, contact routes and notes. "Print / Save as PDF" produces a light,
one-page document whatever the on-screen theme. A searcher can drop it straight into an investor update or IC
pre-read.

### The foundation those features need
- **Live website enrichment.** A polite async crawler reads the homepage, then discovers contact, about, team and
  careers pages. It extracts **schema.org JSON-LD first** (most reliable), then markup, then visible text. That
  yields emails (including `name [at] domain [dot] com` obfuscation), phones, socials, the founder, founding year,
  address, tech stack (29 signatures, e.g. ServiceTitan, HubSpot, Shopify) and deal signals.
- **Email verification without sending mail:** syntax checks (`email-validator`), a disposable-domain list,
  role-inbox detection, then a live DNS **MX lookup** (cached). Each email is labelled *valid*, *risky* or
  *invalid* with a reason. Personal, valid inboxes are sorted first.
- **Deduplication** by normalised domain *and* canonical company name ("Acme Plumbing, LLC" = "ACME Plumbing Inc."),
  applied on create, on CSV import and as a one-click "Merge duplicates" that never overwrites user-entered data.
- **CSV import** with automatic header mapping (`Annual Revenue` → revenue, `$4.5M` → 4500000, `11-50` → 30), and
  **CRM-ready export** in standard (including score reasons), **HubSpot** and **Salesforce** formats.
- **Background bulk enrichment** with bounded concurrency and a live progress bar, plus a **drag-and-drop pipeline
  board** (New → Contacted → Replied → Meeting → Won/Lost) with revenue roll-ups.

**Visual identity:** a "Deep Teal & Amber" theme (calm, finance-grade teal primary with warm amber highlights),
tuned separately for light and dark mode, with semantic hot/warm/cold colours kept distinct from the brand colours.

---

## 2. UX decisions

- **One input to start.** "Add a company" needs only a website. The crawl, verification and scoring happen
  automatically, and you land on the finished lead.
- **The table answers "why?" without a click.** Every row shows the score ring, the tier and the *single most telling
  reason*: a knockout first, then the strongest differentiating signal (succession > growth > longevity…), never
  the generic "matches your industry" shown on every row.
- **Progressive disclosure.** Tier chips and stage are always visible; industry, state, minimum score and has-email
  sit in a filter popover with a live count badge.
- **Trust cues.** Green, amber and red icons on every email with a hover reason; colour-coded factor bars; a
  "Fit gate applied" callout.
- **Action placement.** On the lead page the Copilot comes first, because it's the thing you *do*, followed by
  "Why this score?" for when you want to check.
- Dark/light theme, keyboard-accessible Radix primitives, toasts instead of blocking dialogs, skeleton loaders,
  empty states with a next step, and a responsive layout that collapses to icons and hides columns on smaller screens.
- **React Bits** is used sparingly where it earns attention: an Aurora hero, BlurText headline, CountUp KPIs,
  SpotlightCard metrics, a ShinyText Copilot title and the GradientText wordmark. All of it respects light/dark mode.

---

## 3. Architecture

```
            Browser
               │  same-origin requests only (no CORS, no API URL baked into the bundle)
               ▼
   ┌─────────────────────────┐        ┌───────────────────────────────┐
   │  Next.js 16 (Node)      │  /api  │  FastAPI (uvicorn workers)    │
   │  static shell + PPR     │───────▶│  routes → services → models   │
   │  /api/[...path] proxy   │ API_URL│  BackgroundTasks for bulk jobs│
   └─────────────────────────┘        └──────┬───────────────┬────────┘
                                             │               │ httpx (async, robots-aware)
                                     SQLAlchemy 2            ▼
                                             ▼         company websites, DNS (MX)
                                   ┌──────────────────┐   Anthropic API (Claude)
                                   │ PostgreSQL 17    │
                                   │ JSONB + pg_trgm  │
                                   └──────────────────┘
```

**Data storage: PostgreSQL.** Leads have a relational core (stage, score, industry, state, all indexed) plus
semi-structured enrichment output (emails with verification metadata, socials, tech stack, signals, score
breakdown) stored as **JSONB**. One table, no joins on the hot path, and still queryable (`jsonb_array_length` powers
the "has email" filter). A composite `(stage, score)` index serves the pipeline and priority queue, and **`pg_trgm`
GIN indexes** keep `ILIKE '%term%'` search fast at scale. Schema changes are versioned with **Alembic** (tested
up → down → up).

**Caching and performance**
- *Enrichment cache:* a lead enriched within `ENRICHMENT_CACHE_DAYS` (default 7) is served from Postgres instead
  of re-crawled. Bulk jobs skip fresh leads unless forced.
- *DNS cache:* MX results are memoised in-process for 6 hours, so 50 leads on one domain cost one lookup.
- *Crawler:* one shared async `httpx` client per job (connection pooling and keep-alive), bounded concurrency
  (`CRAWLER_CONCURRENCY`), a 2 MB response cap, an 8 s timeout, retry with backoff on 429/5xx, and robots.txt
  respected by default.
- *API:* lightweight list DTOs (the full breakdown ships only on the detail view), server-side pagination, sorting
  and filtering, GZip, and `pool_pre_ping` + `pool_recycle` for RDS failovers.
- *Frontend:* Cache Components/Partial Prerendering serve static shells instantly. SWR handles
  stale-while-revalidate, `keepPreviousData` for flicker-free filtering, optimistic pipeline moves with rollback,
  and `useDeferredValue` for search-as-you-type.

**Resilience against real-world websites:** CAPTCHA and bot-wall detection (Cloudflare challenge markers,
401/403/429) reports *"Blocked by site protection"* instead of storing garbage. There's an optional
`CRAWLER_PROXY_URL` for a rotating egress proxy. Each failure is isolated per lead inside bulk jobs, and errors are
surfaced in the UI.

**Ethical data collection:** an identifying User-Agent, robots.txt compliance, only public business pages
(home/contact/about/team/careers), no login walls, and a page cap per site.

**Hosting: containers on AWS (server-based, not serverless).** The crawler holds connections open for seconds
and bulk jobs run in the background, which suits long-lived containers far better than Lambda's request model.

| Component | AWS service |
|---|---|
| Database | **Amazon RDS for PostgreSQL 17** (Multi-AZ in prod), private subnets |
| API | **ECS Fargate** service (or App Runner) from the `fastapi-caprae` image; runs `alembic upgrade head` on boot |
| Web | **ECS Fargate** service (or App Runner) from the `nextjs-caprae` standalone image |
| Routing | **Application Load Balancer** (public → web; API reachable only from the web service) |
| Images | **Amazon ECR** |
| Secrets | **AWS Secrets Manager** → `DATABASE_URL`, `ANTHROPIC_API_KEY` injected as env vars |
| Logs/metrics | **CloudWatch Logs** · health checks on `/api/health` (verifies the DB too) and `/` |
| CI | **GitHub Actions**: Postgres-backed pytest + migration round-trip, typecheck, lint, production build |

Step-by-step instructions: **[docs/AWS_DEPLOYMENT.md](docs/AWS_DEPLOYMENT.md)**.

---

## 4. Run it locally

### Option A: Docker (one command)
```bash
docker compose up --build
# Web  http://localhost:3000   ·   API docs  http://localhost:8000/docs
# Optional: ANTHROPIC_API_KEY=sk-ant-... docker compose up --build
```

### Option B: native
Prerequisites: Python 3.12+, Node 20.9+, PostgreSQL 15+.

```bash
# 1) API
cd fastapi-caprae
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env                                   # set DATABASE_URL (and ANTHROPIC_API_KEY if you have one)
alembic upgrade head
uvicorn app.main:app --reload --port 8000              # seeds 30 fictional demo leads on first start

# 2) Web (new terminal)
cd nextjs-caprae
npm install
cp .env.example .env.local                             # API_URL=http://localhost:8000
npm run dev                                            # http://localhost:3000
```

### Tests
```bash
cd fastapi-caprae && pytest          # 24 tests against a real Postgres (TEST_DATABASE_URL, defaults to caprae_test)
cd nextjs-caprae && npx tsc --noEmit && npm run lint && npm run build
```

### Dataset
On first start the API seeds **30 fictional companies** on the reserved `.example` TLD (RFC 2606), so the dashboard
is meaningful immediately and no real person's data is redistributed. Add any real website, or import a CSV, to
see live enrichment. A sample CSV can be downloaded from the Import dialog.

---

## 5. API overview

Interactive docs at `/docs`. Main endpoints (all under `/api`):

| Method | Path | Purpose |
|---|---|---|
| GET | `/leads` | Search, filter (tier, stage, industry, state, min score, has email), sort, paginate |
| POST | `/leads` | Create from a website or name; dedupes; optional instant enrichment |
| GET/PATCH/DELETE | `/leads/{id}` | Lead workspace; PATCH rescores automatically |
| POST | `/leads/{id}/enrich` | Crawl + verify + rescore one lead |
| POST | `/leads/enrich` → GET `/leads/jobs/{id}` | Background bulk enrichment with progress |
| POST | `/leads/import` · GET `/leads/export?format=hubspot` | CSV in/out (standard, HubSpot, Salesforce) |
| POST | `/leads/dedupe` · GET `/leads/duplicates` | Merge duplicate records |
| POST | `/leads/bulk/stage` · `/leads/bulk/delete` | Bulk actions |
| GET/PUT | `/icp` | Scoring profile; PUT rescores every lead |
| POST/GET | `/leads/{id}/outreach` | AI Outreach Copilot drafts + history |
| GET | `/leads/actions/today` | Action Center: overdue follow-ups, this week's follow-ups, hot & untouched leads |
| GET | `/leads/{id}/activities` | Activity timeline |
| GET | `/stats` · `/health` · `/ai/status` | Dashboard metrics, health check, Copilot mode |

---

## 6. What I'd build next
Redis + a worker queue (SQS) for 10k-lead enrichment batches, Google Places / state business-registry sources for
discovery, email-sequence sending via the Gmail/Outlook APIs with reply tracking, native HubSpot/Salesforce sync over
OAuth, multi-user workspaces with auth (Cognito), and score calibration against actual won/lost outcomes.
