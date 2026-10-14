# nextjs-caprae: SaaSquatch Pro web app

Next.js 16 (App Router, Cache Components) + shadcn/ui + React Bits front end for the SaaSquatch Pro API.
See the [root README](../README.md) for the product rationale and architecture.

## Quick start
```bash
npm install
cp .env.example .env.local     # API_URL=http://localhost:8000
npm run dev                    # http://localhost:3000
```
The FastAPI server must be running (see `../fastapi-caprae`).

## How it talks to the API
The browser only calls same-origin `/api/*`. `src/app/api/[...path]/route.ts` proxies those requests to `API_URL`,
which is read **at runtime**. That means no CORS, the backend can live on a private network, and one Docker
image works in every environment.

## Pages
| Route | What it does |
|---|---|
| `/` | KPIs, Today's actions (follow-ups due, upcoming, hot & untouched), score distribution, pipeline funnel, priority queue, industry breakdown |
| `/leads` | Search, tier chips, filters, sorting, bulk enrich/stage/export/delete, add & CSV import dialogs |
| `/leads/[id]` | Lead workspace: follow-up scheduler, AI Outreach Copilot, explainable score, contacts with verification, signals, tech stack, notes, activity timeline |
| `/leads/[id]/memo` | Printable target one-pager (Save as PDF) |
| `/pipeline` | Drag-and-drop Kanban with optimistic updates |
| `/settings` | Scoring profile: acquisition vs sales mode, target market, weight sliders (rescores everything on save) |

## UI stack
- **shadcn/ui** (Radix, "nova" preset) for every primitive: sidebar, table, dialog, sheet, select, tabs, charts…
- **React Bits** in `src/components/reactbits`: Aurora, BlurText, CountUp, SpotlightCard, ShinyText, GradientText
- SWR for data fetching and revalidation, Sonner toasts, next-themes for light/dark, Recharts via shadcn charts

## Checks
```bash
npx tsc --noEmit && npm run lint && npm run build
```

## Docker
```bash
docker build -t caprae-web .
docker run -p 3000:3000 -e API_URL=http://host.docker.internal:8000 caprae-web
```
