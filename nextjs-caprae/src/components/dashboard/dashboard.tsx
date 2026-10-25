"use client";

import { ArrowRight, Flame, MailCheck, Radar, Target } from "lucide-react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import useSWR from "swr";

import { ActionCenter } from "@/components/dashboard/action-center";
import { Hero } from "@/components/dashboard/hero";
import { PipelineBrief } from "@/components/dashboard/pipeline-brief";
import { GlowCard } from "@/components/glow-card";
import { ScoreRing, StageBadge } from "@/components/leads/badges";
import CountUp from "@/components/reactbits/CountUp";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { STAGES, type Stats } from "@/lib/api";

const distConfig = { count: { label: "Leads", color: "var(--chart-1)" } } satisfies ChartConfig;
const industryConfig = { avg_score: { label: "Avg score", color: "var(--chart-2)" } } satisfies ChartConfig;

function bucketColor(bucket: string) {
  const lo = parseInt(bucket, 10);
  return lo >= 75 ? "var(--hot)" : lo >= 55 ? "var(--warm)" : "var(--cold)";
}

function Kpi({ icon: Icon, label, value, suffix, hint }: { icon: typeof Flame; label: string; value: number; suffix?: string; hint: string }) {
  return (
    <GlowCard>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{label}</span>
        <Icon className="size-4" />
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight tabular">
        <CountUp to={value} duration={1.2} separator="," />
        {suffix}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </GlowCard>
  );
}

export function Dashboard() {
  const { data, error, isLoading } = useSWR<Stats>("/stats");

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Hero stats={data} />

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Can&apos;t reach the API</AlertTitle>
          <AlertDescription>{error.message}. Make sure the FastAPI server is running and API_URL is set.</AlertDescription>
        </Alert>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading || !data ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[126px] rounded-xl" />)
        ) : (
          <>
            <Kpi icon={Radar} label="Leads in workspace" value={data.total} hint={`${data.enriched} enriched from their websites`} />
            <Kpi icon={Flame} label="Hot leads" value={data.by_tier.hot} hint="Score of 75+ - act on these first" />
            <Kpi icon={Target} label="Average Deal Signal" value={Math.round(data.avg_score)} suffix="/100" hint="Measured against your scoring profile" />
            <Kpi
              icon={MailCheck}
              label="Reachable"
              value={data.total ? Math.round((data.with_email / data.total) * 100) : 0}
              suffix="%"
              hint="Have at least one email on file"
            />
          </>
        )}
      </section>

      <PipelineBrief />

      <ActionCenter />

      <section className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Score distribution</CardTitle>
            <CardDescription>How your pipeline ranks against your scoring profile</CardDescription>
          </CardHeader>
          <CardContent>
            {data ? (
              <ChartContainer config={distConfig} className="h-[240px] w-full">
                <BarChart data={data.score_distribution} margin={{ left: -20 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="bucket" tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} />
                  <ChartTooltip cursor={{ fill: "var(--muted)" }} content={<ChartTooltipContent />} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {data.score_distribution.map((d) => (
                      <Cell key={d.bucket} fill={bucketColor(d.bucket)} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : (
              <Skeleton className="h-[240px]" />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Pipeline</CardTitle>
            <CardDescription>Where leads are in your outreach</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data
              ? STAGES.map((s) => {
                  const n = data.by_stage[s.value] ?? 0;
                  const pct = data.total ? (n / data.total) * 100 : 0;
                  return (
                    <div key={s.value} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>{s.label}</span>
                        <span className="text-muted-foreground tabular">{n}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary/80 transition-all duration-700" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })
              : Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-7" />)}
            <Button asChild variant="ghost" size="sm" className="w-full">
              <Link href="/pipeline">
                Open pipeline board <ArrowRight />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Priority queue</CardTitle>
            <CardDescription>Highest-scoring leads you haven&apos;t closed out yet</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {data?.top_leads.length === 0 && <p className="text-sm text-muted-foreground">No open leads yet.</p>}
            {data
              ? data.top_leads.map((l) => (
                  <Link
                    key={l.id}
                    href={`/leads/${l.id}`}
                    className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-muted/60"
                  >
                    <ScoreRing score={l.score} tier={l.score_tier} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{l.company_name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[l.industry, l.state].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <StageBadge stage={l.stage} />
                  </Link>
                ))
              : Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Industries</CardTitle>
            <CardDescription>Average Deal Signal by industry</CardDescription>
          </CardHeader>
          <CardContent>
            {data ? (
              <ChartContainer config={industryConfig} className="h-[240px] w-full">
                <BarChart data={data.by_industry} layout="vertical" margin={{ left: 10, right: 16 }}>
                  <XAxis type="number" domain={[0, 100]} hide />
                  <YAxis
                    dataKey="industry"
                    type="category"
                    tickLine={false}
                    axisLine={false}
                    width={110}
                    fontSize={11}
                    tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)}
                  />
                  <ChartTooltip cursor={{ fill: "var(--muted)" }} content={<ChartTooltipContent />} />
                  <Bar dataKey="avg_score" fill="var(--color-avg_score)" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ChartContainer>
            ) : (
              <Skeleton className="h-[240px]" />
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
