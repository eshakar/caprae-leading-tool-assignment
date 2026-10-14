"use client";

import { BellRing, GripVertical } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";

import { ScoreRing } from "@/components/leads/badges";
import { PageTitle } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { type LeadPage, leadsApi, STAGES, type Stage } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const KEY = "/leads?page_size=200&sort=-score";

const COLUMN_ACCENT: Record<Stage, string> = {
  new: "bg-muted-foreground",
  contacted: "bg-chart-5",
  replied: "bg-chart-1",
  meeting: "bg-chart-3",
  won: "bg-success",
  lost: "bg-destructive",
};

export function PipelineBoard() {
  const { data, error, mutate } = useSWR<LeadPage>(KEY);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overStage, setOverStage] = useState<Stage | null>(null);

  async function move(id: number, stage: Stage) {
    if (!data) return;
    const lead = data.items.find((l) => l.id === id);
    if (!lead || lead.stage === stage) return;
    const optimistic = { ...data, items: data.items.map((l) => (l.id === id ? { ...l, stage } : l)) };
    try {
      await mutate(
        async () => {
          await leadsApi.update(id, { stage });
          return optimistic;
        },
        { optimisticData: optimistic, rollbackOnError: true, revalidate: true },
      );
      toast.success(`${lead.company_name} → ${stage}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <PageTitle title="Pipeline" description="Drag a card to move a lead through your outreach. Cards are sorted by Deal Signal Score." />
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load pipeline</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
      <div className="grid auto-cols-[minmax(250px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-4">
        {STAGES.map((s) => {
          const cards = data?.items.filter((l) => l.stage === s.value) ?? [];
          const value = cards.reduce((sum, c) => sum + (c.revenue_usd ?? 0), 0);
          return (
            <div
              key={s.value}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setOverStage(s.value);
              }}
              onDragLeave={() => setOverStage((cur) => (cur === s.value ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                const id = Number(e.dataTransfer.getData("text/plain"));
                setOverStage(null);
                setDragId(null);
                if (id) void move(id, s.value);
              }}
              className={cn(
                "flex min-h-[420px] flex-col rounded-xl border bg-muted/30 transition-colors",
                overStage === s.value && "border-primary bg-primary/5",
              )}
            >
              <div className="flex items-center justify-between border-b px-3 py-2.5">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className={cn("size-2 rounded-full", COLUMN_ACCENT[s.value])} />
                  {s.label}
                  <span className="text-muted-foreground tabular">{cards.length}</span>
                </div>
                {value > 0 && <span className="text-xs text-muted-foreground tabular">{formatMoney(value)} rev</span>}
              </div>
              <div className="flex flex-1 flex-col gap-2 p-2">
                {!data && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
                {cards.map((l) => (
                  <div
                    key={l.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", String(l.id));
                      e.dataTransfer.effectAllowed = "move";
                      setDragId(l.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverStage(null);
                    }}
                    className={cn(
                      "group flex cursor-grab items-start gap-2 rounded-lg border bg-card p-2.5 shadow-xs transition-all active:cursor-grabbing hover:border-primary/40",
                      dragId === l.id && "opacity-50",
                    )}
                  >
                    <GripVertical className="mt-1 size-4 shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/leads/${l.id}`} className="block truncate text-sm font-medium hover:underline" draggable={false}>
                        {l.company_name}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">{[l.industry, l.state].filter(Boolean).join(" · ") || "—"}</p>
                      {l.owner_name && <p className="truncate text-xs text-muted-foreground">{l.owner_name}</p>}
                      {l.follow_up_due && (
                        <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-hot">
                          <BellRing className="size-3" /> Follow-up due
                        </p>
                      )}
                    </div>
                    <ScoreRing score={l.score} tier={l.score_tier} size={34} />
                  </div>
                ))}
                {data && cards.length === 0 && (
                  <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                    Drop leads here
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
