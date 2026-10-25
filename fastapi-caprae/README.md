# fastapi-caprae: SaaSquatch Pro API

FastAPI + PostgreSQL service that enriches, verifies, scores and drafts outreach for leads.
See the [root README](../README.md) for the product rationale and architecture.

## Quick start
```bash
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env                                  # set DATABASE_URL
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```
Open http://localhost:8000/docs. On first start, 30 fictional demo leads are seeded (`SEED_SAMPLE_DATA=true`).

## Tests
```bash
# Uses a separate database; override with TEST_DATABASE_URL
createdb caprae_test
pytest
```
The tests cover normalisation, email verification, the scoring rules (knockouts, sales vs acquisition mode),
HTML/JSON-LD extraction, blocked-site handling, template outreach, the Claude/Gemini/Grok provider layer (mocked), the AI search parser
and filter sanitising, the rule-based brief, and the full API (CRUD, dedup, CSV
import/export in three formats, ICP rescoring, bulk actions, validation errors, follow-up scheduling, activity timeline, Action Center).

## Layout
```
app/
  main.py               app factory, CORS, GZip, lifespan seeding, DB-outage handler
  core/config.py        env-driven settings (pydantic-settings)
  db/session.py         engine (pre-ping, recycle) + session dependency
  db/seed.py            fictional demo dataset (.example domains)
  models/               Lead, LeadActivity, ICPProfile, EnrichmentJob, OutreachDraft
  schemas/              request/response models + validation
  api/routes/           leads, icp, outreach, ai, stats/health
  services/
    crawler.py          robots-aware async crawler + JSON-LD/markup/text extraction
    email_validation.py syntax → disposable/role → cached MX lookup
    scoring.py          explainable Deal Signal Score + knockouts + next best action
    llm.py              provider-agnostic structured-output calls (Claude / Gemini / Grok) + fallbacks
    outreach.py         AI Outreach Copilot with template fallback
    ai_insights.py      Ask AI search (plain English -> validated filters) and the AI Pipeline Brief
    activity.py         activity timeline, stage-driven follow-ups, Action Center
    leads.py            enrichment orchestration, background jobs, dedup, CSV import/export, stats
    normalize.py        domain/company/phone/state/number normalisation
alembic/                migrations (initial schema + pg_trgm search indexes, activity timeline + follow-ups)
scripts/start.sh        container entrypoint: migrate → seed once → uvicorn workers
```

## Docker
```bash
docker build -t caprae-api .
docker run -p 8000:8000 -e DATABASE_URL=postgresql+psycopg://... caprae-api
```
