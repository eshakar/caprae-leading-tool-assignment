"use client";

import { ArrowUpRight, Loader2, RefreshCw, Sparkles, Target } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import ShinyText from "@/components/reactbits/ShinyText";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { aiApi, type PipelineBrief as Brief } from "@/lib/api";

/** On-demand AI morning brief: generated only when asked, so the dashboard never waits on a model. */
export function PipelineBrief() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    try {
      setBrief(await aiApi.brief());
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full bg-primary/10 blur-3xl" />
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <ShinyText text="AI Pipeline Brief" speed={3} className="font-semibold" />
          </CardTitle>
          <CardDescription>
            A 30-second read on your pipeline: what needs attention and what to do first. Grounded only in your own data.
          </CardDescription>
        </div>
        {brief && (
          <Button size="sm" variant="ghost" onClick={generate} disabled={loading} aria-label="Regenerate brief">
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!brief && !loading && (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              The AI reads your scores, stages, follow-ups and top leads, then writes your priorities for today.
            </p>
            <Button onClick={generate} className="shrink-0">
              <Sparkles /> Generate brief
            </Button>
          </div>
        )}
        {loading && !brief && (
          <div className="space-y-3">
            <Skeleton className="h-6 w-3/4" />
            <div className="grid gap-3 md:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          </div>
        )}
        {brief && (
          <div className={loading ? "space-y-4 opacity-60 transition-opacity" : "space-y-4 transition-opacity"}>
            <p className="text-lg font-medium tracking-tight">{brief.headline}</p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {brief.insights.map((i, idx) => {
                const body = (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium">{i.title}</p>
                      {i.lead_id > 0 && <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition group-hover:text-primary" />}
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{i.detail}</p>
                  </>
                );
                const cls = "group block rounded-xl border bg-background/60 p-3.5 transition hover:border-primary/40 hover:bg-muted/40";
                return i.lead_id > 0 ? (
                  <Link key={idx} href={`/leads/${i.lead_id}`} className={cls}>
                    {body}
                  </Link>
                ) : (
                  <div key={idx} className={cls}>
                    {body}
                  </div>
                );
              })}
            </div>
            <div className="flex flex-col gap-2 rounded-xl bg-primary/8 p-3.5 text-sm sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-start gap-2">
                <Target className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>
                  <span className="font-medium">Focus today: </span>
                  {brief.focus_today}
                </span>
              </p>
              <Badge variant="outline" className="w-fit shrink-0 font-mono text-[10px]">
                {brief.generator === "rules" ? "rule-based fallback" : brief.generator}
              </Badge>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
