# SaaSquatch Pro: project overview

**What this is for, who it helps, and exactly how AI is used (and where it deliberately isn't).**

SaaSquatch Pro is an enhancement to Caprae Capital's [SaaSquatch](https://www.saasquatchleads.com/) lead-generation
tool, built for the Caprae Full Stack Developer challenge. It turns a list of companies into a ranked, verified,
ready-to-contact pipeline, and uses AI where AI is genuinely better than code: understanding what the user wants,
summarising the pipeline, and writing a credible first message.

---

## 1. The purpose

### The problem
SaaSquatch's users are **search funders, private-equity operators and B2B sales teams** sourcing lower-middle-market
companies. Getting a list of companies is the easy part. The time goes into everything after it:

| Question the user has | What it costs today |
|---|---|
| *Which of these 500 companies should I call first?* | Every row looks the same, so people work the list top to bottom. |
| *Can I actually reach the owner?* | Many emails bounce or go to an `info@` inbox nobody reads. |
| *What do I say to a 60-year-old founder?* | A respectful, personalised first touch takes 10–15 minutes per lead. |
| *What should I do today?* | Follow-ups slip, and most deals are lost in the follow-up, not the first email. |

### The goal
**Spend time only on the leads that will actually close, and make every touch count.** In practice:

1. **Know who to call first.** An explainable 0–100 *Deal Signal Score* against your own acquisition or sales profile.
2. **Know you can reach them.** Website enrichment plus email verification (valid / risky / invalid, with a reason).
3. **Know what to say.** An AI Outreach Copilot that writes from verified facts only.
4. **Know what to do today.** An Action Center, follow-up tracking, an activity timeline and an AI Pipeline Brief.
5. **Get there fast.** Ask for leads in plain English, or press ⌘K / Ctrl K anywhere.

### Why it fits Caprae
Caprae invests in companies and then works alongside them operationally. The product reflects that:
- **Acquisition mode** rewards succession signals (founder tenure, family ownership, "planning to retire" language).
  It also stops already PE-backed targets from ranking as "hot".
- **AI-written acquisition outreach talks about legacy, employees and continuity**, never "buying your company".
- Every score and every AI output can be **explained and traced back to data**. A searcher has to justify outreach
  to investors, and a ranking that can't explain itself doesn't get trusted.

---

## 2. How a user works with it

```
 Import CSV / add a website ──► Enrich (crawl site, verify emails) ──► Deal Signal Score + reasons
                                                                            │
        ┌───────────────────────────────────────────────────────────────────┘
        ▼
 Dashboard: AI Pipeline Brief · Today's actions · priority queue
        │
        ├─ "Ask AI: hot HVAC firms in Texas we haven't contacted"  ──► filtered lead list
        │
        ▼
 Lead workspace: score breakdown · contacts · signals · AI Outreach Copilot
        │
        ▼
 Send / mark contacted ──► follow-up auto-scheduled ──► pipeline board ──► printable one-pager for IC
```

---

## 3. How AI helps: the three AI features

All three share one design: **the model only sees data we hand it, must answer in a strict JSON schema, its output
is validated by the server, and a deterministic fallback takes over if no AI is available.** The product never
breaks because a model is down or a key is missing.

### 3.1 AI Outreach Copilot: "what do I say?"
**Where:** lead workspace → *AI Outreach Copilot* (`POST /api/leads/{id}/outreach`)

**What the AI gets:** only the facts we scraped and verified for that company (name, industry, location, owner,
headcount, founding year, family-owned, hiring, tech stack…), plus the user's goal (acquisition / sales /
partnership), tone and a sentence about who they are.

**What it returns:** a subject line, a 90–150 word email, a LinkedIn note (≤300 characters), a cold-call opener, a
follow-up email, and the list of facts it actually used.

**Guardrails:** the prompt forbids inventing awards, news, revenue or names. Acquisition copy must emphasise legacy
and continuity. No markdown and no emojis. The output schema is enforced.

**Real example** (Gemini, on fictional seed lead *Everglades Electric Contractors*, score 96):
> **Subject:** Everglades Electric Contractors and long-term continuity
>
> Hi Patricia, I have been following Everglades Electric Contractors and deeply admire the business you have built
> in Fort Lauderdale since 1976. Growing a family-owned company to 90 employees over nearly five decades is a
> remarkable achievement. … my priority is to protect your legacy, care for your team, and preserve the culture you
> built rather than make quick changes. … Would you be open to a brief 10-minute conversation next week?
>
> *Facts used:* Serving Fort Lauderdale since 1976 · Family-owned · 90 employees · Patricia Rowe as owner

Every personal detail in that email came from the lead record, and nothing was invented.

**Value:** a first touch drops from roughly 10–15 minutes of writing to about 30 seconds of review (our estimate,
not a measured result). It still reads as written for that one founder.

### 3.2 Ask AI search: "find me the right leads"
**Where:** the dashboard hero search bar, and the ⌘K / Ctrl K command palette (`POST /api/ai/search`)

**What the AI gets:** the user's sentence, plus the **actual** industries and states present in the database.

**What it returns:** structured filters (tiers, stages, industries, states, minimum score, has-email,
follow-up-due, keywords, sort) and a one-sentence explanation shown to the user.

**Guardrails:** the allowed values are passed as enums in the schema. The server then **re-validates every value**
against the real facets, so a hallucinated industry, state or sort order can never reach the database query.

**Real example** (Gemini):
> *"best heating and cooling companies in texas or florida that we have not reached out to yet"*
> → tier **hot** · industry **HVAC** · states **TX, FL** · stage **new**
> → "I have filtered for hot-tier HVAC leads in Texas and Florida that are in the new stage."

The model understood "heating and cooling" as HVAC, "best" as the hot tier, and "not reached out to" as the New
stage, with no keyword lists. Without an AI key, a keyword parser handles the common phrasings.

**Value:** non-technical dealmakers get the full power of the filters without learning the filter UI.

### 3.3 AI Pipeline Brief: "what should I do today?"
**Where:** dashboard → *AI Pipeline Brief* → *Generate brief* (`POST /api/ai/brief`)

**What the AI gets:** a JSON snapshot of the pipeline: totals, tiers, stages, industry averages, overdue
follow-ups, hot leads nobody has contacted, and the top open leads with their next best action.

**What it returns:** a headline, up to four insights (each linked to the lead it's about), and one "focus today".

**Guardrails:** the prompt says to use only the numbers and companies given. Lead ids are checked against the
snapshot server-side, so a link can never point to an invented company. A rule-based brief is the fallback.

**Real example** (Gemini):
> **The pipeline holds 30 enriched leads with 13 hot opportunities and 23 uncontacted leads.**
> - *Engage top replied lead immediately:* Everglades Electric Contractors (96) has replied. Book an intro call
>   while interest is warm.
> - *Outreach to top untouched HVAC targets:* Lone Star Comfort HVAC (95) and Triangle Mechanical Services (94) are
>   still uncontacted. Generate a personalised intro and reach out.
>
> **Focus today:** book an intro call with Everglades Electric Contractors and reach out to Lone Star Comfort HVAC
> and Triangle Mechanical Services.

**Value:** a 30-second morning read replaces scanning charts and tables to work out priorities.

---

## 4. Where AI is deliberately *not* used

Using AI everywhere would make the product slower, costlier and harder to trust. These parts are deterministic code:

| Part | Why not AI |
|---|---|
| **Deal Signal Score** | Must be explainable, repeatable and tunable. Every point has a written reason, users adjust weights with sliders, and the same lead always gets the same score. An LLM score would be a black box. |
| **Website enrichment** | JSON-LD, markup and regex extraction is faster, free, and auditable. It respects `robots.txt`. |
| **Email verification** | Syntax, disposable-domain and role-inbox checks plus a live MX lookup are facts, not guesses. |
| **Deduplication & CSV mapping** | Normalised domains and company names give exact, predictable merges. |

AI handles **language**: understanding requests, summarising, writing. Code handles **facts**: scraping,
verifying, scoring. Each AI feature is grounded in what the code established.

---

## 5. How the AI layer is built

```
 Feature (outreach / search / brief)
        │  system prompt + facts as JSON + JSON schema
        ▼
 app/services/llm.py  ── generate_json() ──►  Claude  (structured outputs, server-side refusal fallback)
        │                                   ►  Gemini  (responseJsonSchema, model fallback chain on 429/503)
        │                                   ►  Grok    (OpenAI-compatible json_schema)
        ▼
 parsed dict ──► server-side validation ──► UI
        │
        └─ any failure (no key, outage, quota, bad JSON) ──► LLMUnavailable ──► deterministic fallback
```

- **Provider-agnostic.** Set `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` or `XAI_API_KEY`; nothing else changes. The
  sidebar shows which provider is active, and every AI output records the model that produced it.
- **Resilient.** Gemini automatically tries `gemini-3.5-flash` → `gemini-3.8-flash` → `gemini-3.1-flash-lite` when a
  model is overloaded. If everything fails, the user still gets a template draft, keyword search or rule-based
  brief, never an error page.
- **Minimal data sharing.** Only the fields needed for the task are sent to the model, never the whole database.
- **Secure.** Keys live in `.env` locally (git-ignored) and in AWS Secrets Manager in production, injected into the
  container at runtime.
- **Tested.** Unit tests mock each provider's HTTP API, covering the request shape, response parsing, model
  fallback and template fallback. API tests run with no key to prove the fallbacks work end to end.

---

## 6. Try it in two minutes

1. Open the dashboard. Move the cursor over the hero: each dot is a company, and amber dots are hot leads.
2. Type *"family-owned businesses scoring above 80"* into **Ask AI** and press Enter.
3. Press **Ctrl K** (⌘K on Mac) and type a company name, or a request like *"leads with a follow-up due"*.
4. Back on the dashboard, click **Generate brief**.
5. Open a hot lead → **AI Outreach Copilot** → choose *Acquisition* and *Warm* → **Generate**.
6. Click **One-pager** to get a print-ready target profile for an investment committee.

---

## 7. What comes next

- **Learn from outcomes.** Calibrate score weights against actual won/lost deals.
- **Send and track.** Gmail and Outlook sequences, with replies feeding the activity timeline.
- **Per-lead AI research memo.** Combine enrichment and public sources into a sourced thesis, with citations.
- **Team workspaces.** Auth (Cognito), shared pipelines, and assignment of leads to team members.
