"use client";

import {
  ArrowRight,
  BadgeCheck,
  BellRing,
  Bot,
  Building2,
  Download,
  Eye,
  Flame,
  Gauge,
  KanbanSquare,
  Landmark,
  ListFilter,
  Rows3,
  Wallet,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { type LeadListItem, type LeadPage, leadsApi, STAGES, type Stage } from "@/lib/api";
import { formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const KEY = "/leads?page_size=200&sort=-score";
const OPEN: Stage[] = ["new", "contacted", "replied", "meeting"];
// Illustrative close probabilities per stage for the stage-weighted pipeline figure.
const STAGE_PROBABILITY: Record<Stage, number> = { new: 0.1, contacted: 0.2, replied: 0.4, meeting: 0.6, won: 1, lost: 0 };
const COLUMN: Record<Stage, { dot: string; chip: string; label: string }> = {
  new: { dot: "bg-cyan", chip: "text-cyan", label: "New & enriched" },
  contacted: { dot: "bg-gold", chip: "text-gold", label: "Contacted / cadence" },
  replied: { dot: "bg-amber-soft", chip: "text-amber-soft", label: "Replied" },
  meeting: { dot: "bg-emerald", chip: "text-emerald", label: "Meeting booked" },
  won: { dot: "bg-indigo", chip: "text-indigo", label: "Won" },
  lost: { dot: "bg-cold", chip: "text-cold", label: "Lost" },
};

/** The export is a file download from the API proxy, not a page, so use a plain anchor click. */
function downloadCsv() {
  const a = document.createElement("a");
  a.href = "/api/leads/export?format=standard";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function Kpi({
  label,
  value,
  note,
  sub,
  icon: Icon,
  tone,
  glow,
}: {
  label: string;
  value: string;
  note?: string;
  sub: string;
  icon: typeof Wallet;
  tone: string;
  glow: string;
}) {
  return (
    <div className="relative flex items-center justify-between overflow-hidden rounded-xl bg-card p-3 shadow-sm">
      <div className={cn("pointer-events-none absolute -right-4 -bottom-4 size-20 rounded-full blur-xl", glow)} />
      <div>
        <span className="font-mono text-[11px] font-bold tracking-wider text-outline uppercase">{label}</span>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className={cn("font-heading text-xl font-bold tracking-tight tabular", tone)}>{value}</span>
          {note && <span className="font-mono text-xs font-semibold text-emerald">{note}</span>}
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">{sub}</span>
      </div>
      <div className={cn("flex size-10 items-center justify-center rounded-md bg-surface-card", tone)}>
        <Icon className="size-[22px]" />
      </div>
    </div>
  );
}

function DealCard({
  lead,
  dragging,
  onDragStart,
  onDragEnd,
  onAdvance,
}: {
  lead: LeadListItem;
  dragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onAdvance?: () => void;
}) {
  const top = lead.score >= 90;
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative flex cursor-grab flex-col gap-2 overflow-hidden rounded-xl bg-surface-card p-3 shadow-md transition-all hover:bg-surface-high active:cursor-grabbing",
        dragging && "opacity-50",
      )}
    >
      {lead.follow_up_due && <div className="absolute inset-y-0 left-0 w-1 bg-amber" />}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Link
              href={`/leads/${lead.id}`}
              draggable={false}
              className="truncate font-heading font-semibold transition-colors group-hover:text-amber-soft"
            >
              {lead.company_name}
            </Link>
            {lead.email_status === "valid" && <BadgeCheck className="size-3.5 shrink-0 text-emerald" aria-label="Verified email" />}
          </div>
          <span className="block truncate font-mono text-[11px] text-outline">
            {[lead.industry, [lead.city, lead.state].filter(Boolean).join(", ")].filter(Boolean).join(" • ") || "—"}
          </span>
        </div>
        <div
          className={cn(
            "flex shrink-0 items-center gap-1 rounded px-2 py-0.5 font-mono text-[13px] font-bold tabular",
            top
              ? "bg-amber text-primary-foreground shadow-[0_0_12px_rgba(245,158,11,0.35)]"
              : lead.score_tier === "hot"
                ? "bg-amber/20 text-gold shadow-[0_0_10px_rgba(245,158,11,0.2)]"
                : "bg-surface-high text-muted-foreground",
          )}
        >
          {top ? <Flame className="size-3.5" /> : <Zap className="size-3.5" />}
          {lead.score}
        </div>
      </div>

      {(lead.follow_up_due || lead.top_reason) && (
        <div className="flex flex-wrap gap-1">
          {lead.follow_up_due && (
            <span className="flex items-center gap-1 rounded bg-amber/15 px-2 py-0.5 font-mono text-[11px] font-bold text-gold uppercase">
              <BellRing className="size-3" /> Follow-up due
            </span>
          )}
          {lead.top_reason && (
            <span className="line-clamp-1 rounded-full bg-amber/10 px-2 py-0.5 font-mono text-[11px] text-amber-soft" title={lead.top_reason}>
              {lead.top_reason}
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 rounded-md bg-card px-2 py-1">
        <div>
          <span className="block font-mono text-[10px] font-bold text-outline uppercase">Revenue</span>
          <span className="font-mono text-sm font-semibold tabular">{formatMoney(lead.revenue_usd)}</span>
        </div>
        <div>
          <span className="block font-mono text-[10px] font-bold text-outline uppercase">Employees</span>
          <span className="font-mono text-sm font-semibold tabular">{formatNumber(lead.employee_count)}</span>
        </div>
      </div>

      <div className="flex items-center justify-between pt-0.5">
        <Link
          href={`/leads/${lead.id}#copilot`}
          draggable={false}
          className="flex items-center gap-1 rounded bg-indigo/20 px-2 py-1 text-xs font-semibold text-cyan transition-colors hover:bg-indigo/30"
        >
          <Bot className="size-3.5" /> Generate outreach
        </Link>
        <div className="flex items-center gap-0.5 text-muted-foreground">
          <Link href={`/leads/${lead.id}`} draggable={false} title="Open lead" className="p-1 transition-colors hover:text-gold">
            <Eye className="size-4" />
          </Link>
          {onAdvance && (
            <button type="button" onClick={onAdvance} title="Advance to next stage" className="p-1 transition-colors hover:text-amber-soft">
              <ArrowRight className="size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function PipelineBoard() {
  const { data, error, mutate } = useSWR<LeadPage>(KEY);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overStage, setOverStage] = useState<Stage | null>(null);
  const [industry, setIndustry] = useState("all");
  const [highOnly, setHighOnly] = useState(false);
  const [text, setText] = useState("");

  const all = useMemo(() => data?.items ?? [], [data]);
  const industries = useMemo(() => [...new Set(all.map((l) => l.industry).filter(Boolean) as string[])].sort(), [all]);
  const visible = all.filter(
    (l) =>
      (industry === "all" || l.industry === industry) &&
      (!highOnly || l.score >= 80) &&
      (!text.trim() || `${l.company_name} ${l.owner_name ?? ""} ${l.city ?? ""}`.toLowerCase().includes(text.trim().toLowerCase())),
  );

  const open = all.filter((l) => OPEN.includes(l.stage));
  const openRevenue = open.reduce((s, l) => s + (l.revenue_usd ?? 0), 0);
  const weighted = open.reduce((s, l) => s + (l.revenue_usd ?? 0) * STAGE_PROBABILITY[l.stage], 0);
  const avgOpen = open.length ? Math.round(open.reduce((s, l) => s + l.score, 0) / open.length) : 0;
  const due = all.filter((l) => l.follow_up_due).length;
  const activeFilters = (industry !== "all" ? 1 : 0) + (highOnly ? 1 : 0) + (text.trim() ? 1 : 0);

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
      toast.success(`${lead.company_name} → ${STAGES.find((s) => s.value === stage)?.label ?? stage}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="flex w-full flex-col gap-4 p-4 pb-10 md:p-6">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded-full bg-surface-card px-2 py-0.5 font-mono text-[11px] font-bold tracking-widest text-cyan uppercase">
              Pipeline engine
            </span>
            <span className="flex items-center gap-1 font-mono text-[11px] font-bold text-gold">
              <span className="inline-block size-1.5 animate-ping rounded-full bg-gold" /> Live
            </span>
          </div>
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="font-heading text-[1.875rem] font-semibold tracking-tight">Active deal progression</h1>
            <span className="font-mono text-xs font-semibold text-muted-foreground">Drag a card, or use → to advance it</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl bg-card p-1 shadow-sm">
            <span className="flex items-center gap-1.5 rounded-lg bg-surface-high px-3 py-1.5 text-xs font-semibold text-gold shadow-inner">
              <KanbanSquare className="size-4" /> Kanban
            </span>
            <Link href="/leads" className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
              <Rows3 className="size-4" /> List
            </Link>
          </div>
          <Link
            href="/leads?add=1"
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan/20 via-indigo/20 to-amber/20 px-3.5 py-1.5 text-xs font-semibold text-gold shadow-[0_0_16px_rgba(34,211,238,0.12)] transition-all hover:from-cyan/30 hover:to-amber/30"
          >
            <Building2 className="size-4 text-cyan" /> Add a company
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Open pipeline" value={data ? formatMoney(openRevenue) : "…"} sub={`${open.length} open leads (revenue)`} icon={Landmark} tone="text-amber-soft" glow="bg-amber/5" />
        <Kpi label="Stage-weighted" value={data ? formatMoney(weighted) : "…"} sub="Revenue × stage probability" icon={Wallet} tone="text-gold" glow="bg-gold/5" />
        <Kpi label="Avg Deal Signal" value={data ? `${avgOpen}/100` : "…"} sub={`${open.filter((l) => l.score_tier === "hot").length} hot leads still open`} icon={Gauge} tone="text-cyan" glow="bg-cyan/5" />
        <Kpi label="Follow-ups due" value={data ? String(due) : "…"} sub="Contacted leads waiting on you" icon={BellRing} tone="text-indigo" glow="bg-indigo/5" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-card/80 px-3 py-2 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 flex items-center gap-1 font-mono text-[11px] font-bold text-outline uppercase">
            <ListFilter className="size-3.5" /> Filters:
          </span>
          <Select value={industry} onValueChange={setIndustry}>
            <SelectTrigger size="sm" className="h-7 rounded-full border-none bg-surface-card text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Sector: all</SelectItem>
              {industries.map((i) => (
                <SelectItem key={i} value={i}>
                  {i}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => setHighOnly((v) => !v)}
            aria-pressed={highOnly}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs transition-colors",
              highOnly ? "bg-amber/15 text-gold hover:bg-amber/25" : "bg-surface-card hover:bg-surface-high",
            )}
          >
            Signal score ≥ 80 {highOnly && "✓"}
          </button>
          {activeFilters > 0 && (
            <button
              type="button"
              onClick={() => {
                setIndustry("all");
                setHighOnly(false);
                setText("");
              }}
              className="px-2 font-mono text-[11px] font-bold text-outline transition-colors hover:text-foreground"
            >
              Reset
            </button>
          )}
        </div>
        <div className="relative flex items-center">
          <ListFilter className="absolute left-2 size-4 text-outline" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Filter pipeline cards…"
            aria-label="Filter pipeline cards"
            className="w-48 rounded-md bg-surface-card py-1 pr-3 pl-7 text-xs outline-none placeholder:text-outline focus:ring-1 focus:ring-cyan sm:w-60"
          />
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load pipeline</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      <div className="w-full overflow-x-auto pb-4">
        <div className="flex min-w-[1500px] items-start gap-3">
          {STAGES.map((s, idx) => {
            const cards = visible.filter((l) => l.stage === s.value);
            const value = cards.reduce((sum, c) => sum + (c.revenue_usd ?? 0), 0);
            const next = STAGES[idx + 1]?.value;
            const canAdvance = OPEN.includes(s.value) && next;
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
                  "flex min-h-[460px] flex-1 flex-col gap-2 rounded-xl bg-card/50 p-2 ring-1 ring-transparent transition-colors",
                  overStage === s.value && "bg-amber/5 ring-amber/50",
                )}
              >
                <div className="flex items-center justify-between px-1 py-1">
                  <div className="flex items-center gap-1.5">
                    <span className={cn("size-2 rounded-full", COLUMN[s.value].dot)} />
                    <span className="font-heading font-semibold">{COLUMN[s.value].label}</span>
                    <span className={cn("rounded bg-surface-card px-1.5 font-mono text-[11px] font-bold", COLUMN[s.value].chip)}>{cards.length}</span>
                  </div>
                  <span className="font-mono text-xs font-bold text-muted-foreground tabular">{value > 0 ? formatMoney(value) : ""}</span>
                </div>
                {!data && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
                {cards.map((l) => (
                  <DealCard
                    key={l.id}
                    lead={l}
                    dragging={dragId === l.id}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", String(l.id));
                      e.dataTransfer.effectAllowed = "move";
                      setDragId(l.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverStage(null);
                    }}
                    onAdvance={canAdvance ? () => void move(l.id, next) : undefined}
                  />
                ))}
                {data && cards.length === 0 && (
                  <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed p-4 text-center font-mono text-[11px] text-outline">
                    Drop leads here
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col items-center justify-between gap-2 rounded-xl bg-card px-3 py-2.5 shadow-sm sm:flex-row">
        <div className="flex items-center gap-2">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-cyan opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-cyan" />
          </span>
          <span className="font-mono text-[11px] font-bold">
            {data ? `${visible.length} of ${all.length} leads shown · sorted by Deal Signal Score` : "Loading pipeline…"}
          </span>
        </div>
        <button
          type="button"
          onClick={downloadCsv}
          className="flex items-center gap-1 rounded bg-surface-card px-2.5 py-1 text-xs transition-colors hover:bg-surface-high"
        >
          <Download className="size-3.5" /> Export pipeline CSV
        </button>
      </div>
    </div>
  );
}
