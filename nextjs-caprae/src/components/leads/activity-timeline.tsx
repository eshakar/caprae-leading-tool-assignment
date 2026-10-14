"use client";

import { AlertTriangle, ArrowRightLeft, BellRing, Pencil, Plus, Radar, Sparkles, StickyNote, TrendingUp } from "lucide-react";
import useSWR from "swr";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Activity } from "@/lib/api";
import { formatDate, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const KIND: Record<Activity["kind"], { icon: typeof Plus; className: string }> = {
  created: { icon: Plus, className: "bg-muted text-foreground" },
  enriched: { icon: Radar, className: "bg-chart-1/15 text-chart-1" },
  enrichment_failed: { icon: AlertTriangle, className: "bg-hot/15 text-hot" },
  stage: { icon: ArrowRightLeft, className: "bg-chart-3/15 text-chart-3" },
  score: { icon: TrendingUp, className: "bg-chart-2/15 text-chart-2" },
  outreach: { icon: Sparkles, className: "bg-primary/15 text-primary" },
  note: { icon: StickyNote, className: "bg-chart-2/15 text-chart-2" },
  follow_up: { icon: BellRing, className: "bg-warm/15 text-warm" },
  edited: { icon: Pencil, className: "bg-muted text-muted-foreground" },
};

export function ActivityTimeline({ leadId }: { leadId: number }) {
  const { data } = useSWR<Activity[]>(`/leads/${leadId}/activities`);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>Everything that has happened to this lead, newest first</CardDescription>
      </CardHeader>
      <CardContent>
        {!data ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ol className="relative max-h-96 space-y-4 overflow-y-auto pr-1">
            {data.map((a, i) => {
              const k = KIND[a.kind] ?? KIND.edited;
              return (
                <li key={a.id} className="relative flex gap-3">
                  {i < data.length - 1 && <span className="absolute top-8 bottom-[-16px] left-[15px] w-px bg-border" aria-hidden />}
                  <span className={cn("relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full", k.className)}>
                    <k.icon className="size-3.5" />
                  </span>
                  <div className="min-w-0 pt-1">
                    <p className="text-sm leading-snug">{a.message}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground" title={new Date(a.created_at).toLocaleString()}>
                      {timeAgo(a.created_at)} · {formatDate(a.created_at)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
