"use client";

import { ArrowRight, BadgeCheck, BarChart3, Eye, PieChart } from "lucide-react";
import Link from "next/link";
import useSWR from "swr";

import { ActionCenter } from "@/components/dashboard/action-center";
import { Hero } from "@/components/dashboard/hero";
import { PipelineBrief } from "@/components/dashboard/pipeline-brief";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { type LeadPage, qs, type Stats } from "@/lib/api";
import { cn } from "@/lib/utils";

const TIERS = [
  { label: "Tier 1 (90 – 100)", min: 90, max: 100, bar: "bg-gold", text: "text-gold" },
  { label: "Tier 2 (80 – 89)", min: 80, max: 89, bar: "bg-amber-soft", text: "text-amber-soft" },
  { label: "Tier 3 (70 – 79)", min: 70, max: 79, bar: "bg-cyan-soft", text: "text-cyan-soft" },
  { label: "Below threshold (<70)", min: 0, max: 69, bar: "bg-outline", text: "text-outline" },
];
const INDUSTRY_TONES = [
  { bar: "bg-gold", text: "text-gold" },
  { bar: "bg-gold", text: "text-gold" },
  { bar: "bg-cyan-soft", text: "text-cyan-soft" },
  { bar: "bg-cyan", text: "text-cyan" },
];
const PRIORITY_KEY = `/leads${qs({ stage: ["new", "contacted", "replied"], sort: "-score", page_size: 4 })}`;

function ScoreDistribution({ stats }: { stats?: Stats }) {
  const counts = TIERS.map((t) =>
    (stats?.score_distribution ?? [])
      .filter((b) => {
        const lo = parseInt(b.bucket, 10);
        return lo >= t.min && lo <= t.max;
      })
      .reduce((s, b) => s + b.count, 0),
  );
  const total = stats?.total || 0;
  return (
    <div className="flex flex-col justify-between rounded-xl bg-card p-5 shadow-lg lg:col-span-4">
      <div className="flex items-center justify-between pb-1">
        <div>
          <h3 className="font-heading font-semibold">Score distribution</h3>
          <p className="text-xs text-muted-foreground">How your pipeline ranks against your scoring profile</p>
        </div>
        <BarChart3 className="size-5 text-outline" />
      </div>
      <div className="my-auto space-y-2.5 py-3">
        {TIERS.map((t, i) => {
          const pct = total ? Math.round((counts[i] / total) * 100) : 0;
          return (
            <div key={t.label} className="space-y-1">
              <div className="flex justify-between font-mono text-xs font-semibold">
                <span className={cn("flex items-center gap-1.5", t.text)}>
                  <span className={cn("size-2 rounded-sm", t.bar)} /> {t.label}
                </span>
                <span className="font-bold tabular">
                  {stats ? `${counts[i]} lead${counts[i] === 1 ? "" : "s"} (${pct}%)` : "…"}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-card">
                <div className={cn("h-full rounded-full transition-all duration-700", t.bar)} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between rounded-md bg-surface-card px-3 py-2">
        <div className="flex flex-col">
          <span className="font-heading text-[11px] font-bold tracking-wider text-outline uppercase">Pipeline</span>
          <span className="text-xs">Where leads are in your outreach</span>
        </div>
        <Link
          href="/pipeline"
          className="inline-flex items-center gap-1 rounded bg-card px-2 py-1 font-heading text-[11px] font-bold tracking-wider text-gold uppercase transition-colors hover:bg-surface-high"
        >
          Open pipeline board <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </div>
  );
}

function PriorityQueue() {
  const { data } = useSWR<LeadPage>(PRIORITY_KEY);
  return (
    <div className="flex flex-col rounded-xl bg-card p-5 shadow-lg lg:col-span-8">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
        <div>
          <h2 className="font-heading text-xl font-semibold">Priority queue</h2>
          <p className="text-xs text-muted-foreground">Highest-scoring leads you haven&apos;t closed out yet</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Link href="/leads?stage=new&stage=contacted&stage=replied&ai=Open%20leads&why=Leads%20in%20New%2C%20Contacted%20or%20Replied." className="rounded bg-surface-card px-2 py-1 font-mono text-[11px] font-bold uppercase hover:bg-surface-high">
            Filter: open ({data ? data.total : "…"})
          </Link>
          <Link href="/leads" className="rounded bg-surface-card px-2 py-1 font-mono text-[11px] font-bold text-gold uppercase hover:bg-surface-high">
            Sort: signal score ↓
          </Link>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {!data
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[72px]" />)
          : data.items.map((l) => {
              const hot = l.score_tier === "hot";
              return (
                <div
                  key={l.id}
                  className="flex flex-col items-start justify-between gap-3 rounded-md bg-surface-card p-3 transition-colors hover:bg-surface-high md:flex-row md:items-center"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={cn(
                        "flex size-12 shrink-0 flex-col items-center justify-center rounded-md",
                        hot ? "bg-amber/20 text-gold" : "bg-surface-high text-cyan-soft",
                      )}
                    >
                      <span className="font-heading text-xl leading-none font-bold tabular">{l.score}</span>
                      <span className="text-[9px] font-bold uppercase opacity-80">Score</span>
                    </div>
                    <div className="flex min-w-0 flex-col">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link href={`/leads/${l.id}`} className="truncate font-heading font-bold hover:underline">
                          {l.company_name}
                        </Link>
                        <span className={cn("rounded-full bg-card px-2 py-0.5 font-mono text-[11px] font-bold", hot ? "text-gold" : "text-cyan-soft")}>
                          {[l.industry, l.state].filter(Boolean).join(" • ")}
                        </span>
                        {l.email_status === "valid" && (
                          <span className="rounded bg-emerald/10 px-1.5 font-mono text-[11px] font-bold text-emerald">Verified email</span>
                        )}
                      </div>
                      {l.top_reason && (
                        <p className="truncate pt-0.5 text-xs text-muted-foreground">
                          <span className="font-medium text-gold">Explainable match:</span> {l.top_reason}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex w-full shrink-0 items-center justify-end gap-1.5 md:w-auto">
                    <Link
                      href={`/leads/${l.id}#copilot`}
                      className="rounded bg-amber px-3 py-1.5 font-heading text-[11px] font-bold text-primary-foreground uppercase transition-colors hover:bg-gold"
                    >
                      Draft first touch
                    </Link>
                    <Link
                      href={`/leads/${l.id}`}
                      title="View lead"
                      aria-label={`View ${l.company_name}`}
                      className="rounded bg-card p-1.5 text-muted-foreground transition-colors hover:bg-surface-high hover:text-foreground"
                    >
                      <Eye className="size-[18px]" />
                    </Link>
                  </div>
                </div>
              );
            })}
        {data?.items.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No open leads yet.</p>}
      </div>
    </div>
  );
}

function Industries({ stats }: { stats?: Stats }) {
  const top = [...(stats?.by_industry ?? [])].sort((a, b) => b.avg_score - a.avg_score).slice(0, 4);
  const reachable = stats?.total ? Math.round((stats.with_email / stats.total) * 1000) / 10 : 0;
  return (
    <div className="flex flex-col justify-between rounded-xl bg-card p-5 shadow-lg lg:col-span-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <h3 className="font-heading text-xl font-semibold">Industries</h3>
          <PieChart className="size-5 text-outline" />
        </div>
        <p className="text-xs text-muted-foreground">Average Deal Signal by industry</p>
      </div>
      <div className="space-y-3 py-3">
        {!stats
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)
          : top.map((ind, i) => (
              <div key={ind.industry} className="space-y-1">
                <div className="flex justify-between font-mono text-xs font-semibold">
                  <span className="font-semibold">{ind.industry}</span>
                  <span className={cn("font-bold", INDUSTRY_TONES[i].text)}>{ind.avg_score.toFixed(1)} signal avg</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-surface-card">
                  <div className={cn("h-full rounded-full", INDUSTRY_TONES[i].bar)} style={{ width: `${ind.avg_score}%` }} />
                </div>
                <div className="font-mono text-[11px] text-outline">
                  {ind.count} compan{ind.count === 1 ? "y" : "ies"} tracked
                </div>
              </div>
            ))}
      </div>
      <div className="flex items-center justify-between rounded-md bg-surface-card p-2">
        <div className="flex items-center gap-1.5">
          <BadgeCheck className="size-[18px] text-cyan" />
          <span className="font-mono text-[11px] font-bold">MX-verified emails</span>
        </div>
        <span className="font-mono text-[11px] font-bold text-emerald tabular">{stats ? `${reachable}% reachable` : "…"}</span>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { data, error } = useSWR<Stats>("/stats");

  return (
    <div className="flex w-full flex-col gap-8 p-4 pb-8 md:p-6">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Can&apos;t reach the API</AlertTitle>
          <AlertDescription>{error.message}. Make sure the FastAPI server is running and API_URL is set.</AlertDescription>
        </Alert>
      )}

      <Hero stats={data} />

      <section className="grid w-full grid-cols-1 gap-5 lg:grid-cols-12">
        <PipelineBrief />
        <ScoreDistribution stats={data} />
      </section>

      <ActionCenter />

      <section className="grid w-full grid-cols-1 gap-5 lg:grid-cols-12">
        <PriorityQueue />
        <Industries stats={data} />
      </section>
    </div>
  );
}
