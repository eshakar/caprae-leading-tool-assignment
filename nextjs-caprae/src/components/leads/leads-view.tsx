"use client";

import {
  BadgeCheck,
  BellRing,
  Building2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  Factory,
  Layers,
  Loader2,
  MapPin,
  MoreHorizontal,
  PenLine,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  TrendingUp,
  Upload,
  UserPlus,
  Users,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDeferredValue, useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";

import { useAskAI } from "@/components/ai/use-ask-ai";
import { AddLeadDialog } from "@/components/leads/add-lead-dialog";
import { StageBadge } from "@/components/leads/badges";
import { ImportDialog } from "@/components/leads/import-dialog";
import { LeadDossier } from "@/components/leads/lead-dossier";
import { useEnrichmentJob } from "@/components/leads/use-enrichment-job";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { type LeadListItem, type LeadPage, leadsApi, qs, STAGES, type Stage, type Stats, type Tier } from "@/lib/api";
import { formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const SORTS = [
  { value: "-score", label: "Highest score" },
  { value: "score", label: "Lowest score" },
  { value: "-created_at", label: "Newest" },
  { value: "company_name", label: "Name A–Z" },
  { value: "-revenue_usd", label: "Revenue" },
  { value: "-employee_count", label: "Employees" },
  { value: "founded_year", label: "Oldest company" },
];
const TIERS: Tier[] = ["hot", "warm", "cold"];
const TIER_LABEL: Record<Tier, string> = { hot: "Hot 75+", warm: "Warm 55–74", cold: "Cold <55" };
const TIER_TAG: Record<Tier, string> = { hot: "Hot lead", warm: "Warm lead", cold: "Low fit" };
const PAGE_SIZE = 25;
const PIPELINE_KEY = "/leads?page_size=200&sort=-score";
const OPEN_STAGES = new Set(["new", "contacted", "replied", "meeting"]);
const chip = "flex items-center gap-1.5 rounded-lg bg-surface-card px-3 py-1.5 text-xs shadow-sm transition-colors hover:bg-surface-high";

function downloadCsv(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function initials(name: string | null) {
  return name
    ? name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase())
        .join("")
    : "?";
}

export function LeadsView() {
  // Filters arrive in the URL from Ask AI / the command palette; a new AI query remounts with fresh state.
  const searchParams = useSearchParams();
  return <LeadsViewInner key={searchParams.get("ai") ?? ""} />;
}

function LeadRow({
  lead,
  active,
  checked,
  onCheck,
  onSelect,
  onEnrich,
  onDelete,
  enriching,
}: {
  lead: LeadListItem;
  active: boolean;
  checked: boolean;
  onCheck: () => void;
  onSelect: () => void;
  onEnrich: () => void;
  onDelete: () => void;
  enriching: boolean;
}) {
  const hot = lead.score_tier === "hot";
  return (
    <div
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button, a, [role=checkbox], [role=menuitem]")) return;
        onSelect();
      }}
      className={cn(
        "group relative cursor-pointer rounded-2xl bg-card p-3 shadow-md transition-all hover:bg-surface-card",
        active && "bg-gradient-to-r from-amber/10 via-transparent to-transparent shadow-lg ring-1 ring-amber/30",
      )}
    >
      <div className="grid grid-cols-1 items-center gap-3 xl:grid-cols-12">
        <div className="flex min-w-0 items-start gap-3 xl:col-span-5 2xl:col-span-4">
          <Checkbox checked={checked} onCheckedChange={onCheck} aria-label={`Select ${lead.company_name}`} className="mt-1.5" />
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-surface-card shadow-inner transition-transform group-hover:scale-105">
            <Factory className={cn("size-7", hot ? "text-gold" : lead.score_tier === "warm" ? "text-cyan-soft" : "text-cold")} />
          </div>
          <div className="flex min-w-0 flex-col">
            <div className="flex flex-wrap items-center gap-1.5">
              <Link href={`/leads/${lead.id}`} className="truncate font-heading font-bold transition-colors group-hover:text-gold">
                {lead.company_name}
              </Link>
              {lead.state && <span className="rounded bg-surface-high px-1.5 font-mono text-[11px] font-bold text-gold">{lead.state}</span>}
            </div>
            <span className="truncate text-xs text-muted-foreground">{lead.domain ?? "No website"}</span>
            <div className="mt-1 flex items-center gap-1.5 whitespace-nowrap">
              {lead.founded_year && <span className="font-mono text-[11px] font-bold text-outline">EST. {lead.founded_year}</span>}
              {lead.founded_year && lead.city && <span className="text-outline">•</span>}
              {lead.city && (
                <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                  <MapPin className="size-3 text-outline" />
                  {lead.city}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center xl:col-span-2">
          <div className={cn("flex items-center gap-1.5 rounded-full px-3 py-1 shadow-sm", hot ? "bg-amber/20 text-gold" : "bg-surface-high text-muted-foreground")}>
            <span className="font-mono text-base font-bold tabular">{lead.score}</span>
            <TrendingUp className={cn("size-4", hot ? "text-emerald" : "text-outline")} />
          </div>
          <span className={cn("mt-1 font-mono text-[11px] font-semibold tracking-wider uppercase", hot ? "text-gold" : "text-muted-foreground")}>
            {TIER_TAG[lead.score_tier]}
          </span>
        </div>

        <div className="flex flex-col justify-center xl:col-span-2 xl:items-end">
          <div className="flex items-baseline gap-1">
            <span className="font-heading font-semibold tabular">{formatMoney(lead.revenue_usd)}</span>
            <span className="font-mono text-[11px] text-outline">REV</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="size-3.5" />
            <span>{lead.employee_count ? `${formatNumber(lead.employee_count)} employees` : "Headcount unknown"}</span>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-1 xl:hidden 2xl:col-span-2 2xl:flex">
          <div className="flex items-center gap-1.5">
            <div className={cn("flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold", hot ? "bg-amber/30 text-gold" : "bg-surface-high")}>
              {initials(lead.owner_name)}
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1 truncate text-xs font-medium">
                {lead.owner_name ?? "Owner unknown"}
                {lead.email_status === "valid" && <BadgeCheck className="size-3.5 shrink-0 text-emerald" />}
              </span>
              <span className="truncate font-mono text-[11px] text-outline">{lead.best_email ?? "No email yet"}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 xl:col-span-3 xl:flex-col xl:items-end 2xl:col-span-2">
          <Link
            href={`/leads/${lead.id}#copilot`}
            className={cn(
              "flex w-full items-center justify-center gap-1 rounded-lg px-3 py-1.5 font-heading text-xs font-semibold whitespace-nowrap shadow-md transition-colors xl:w-auto",
              active ? "bg-amber text-primary-foreground hover:bg-gold" : "bg-surface-card text-gold hover:bg-amber hover:text-primary-foreground",
            )}
          >
            <PenLine className="size-4" /> Draft AI touch
          </Link>
          <div className="flex w-full items-center gap-1 xl:w-auto">
            <button
              type="button"
              onClick={onSelect}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-surface-card px-3 py-1 text-xs transition-colors hover:bg-surface-high xl:flex-none"
            >
              <Eye className={cn("size-4", active ? "text-cyan" : "text-outline")} /> Dossier
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Row actions" className="rounded-lg bg-surface-card p-1.5 transition-colors hover:bg-surface-high">
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {lead.domain && (
                  <DropdownMenuItem onSelect={onEnrich} disabled={enriching}>
                    <Sparkles /> Re-enrich
                  </DropdownMenuItem>
                )}
                {lead.website && (
                  <DropdownMenuItem asChild>
                    <a href={lead.website} target="_blank" rel="noopener noreferrer">
                      <ExternalLink /> Visit website
                    </a>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                  <Link href={`/leads/${lead.id}/memo`}>One-pager</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5 pt-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <ShieldCheck className="size-4 shrink-0 text-cyan" />
          <span className="shrink-0 font-mono text-[11px] font-semibold text-cyan uppercase">Why it scores:</span>
          <span className="truncate text-xs">{lead.top_reason ?? "Enrich this lead to uncover deal signals."}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {lead.follow_up_due && (
            <span className="flex items-center gap-1 rounded bg-amber/15 px-2 py-0.5 font-mono text-[11px] font-bold text-gold">
              <BellRing className="size-3" /> Follow-up due
            </span>
          )}
          {lead.enrichment_status === "pending" && <span className="rounded bg-surface-card px-2 py-0.5 font-mono text-[11px] text-outline">Not enriched</span>}
          <StageBadge stage={lead.stage} />
        </div>
      </div>
    </div>
  );
}

function LeadsViewInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Dialog state lives in the URL so it resets correctly when the route is hidden/re-shown (Activity).
  const addOpen = searchParams.get("add") === "1";
  const importOpen = searchParams.get("import") === "1";
  const setDialog = (key: "add" | "import", open: boolean) => {
    const sp = new URLSearchParams(searchParams.toString());
    if (open) sp.set(key, "1");
    else sp.delete(key);
    const s = sp.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  const aiQuery = searchParams.get("ai");
  const aiWhy = searchParams.get("why");
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const deferredSearch = useDeferredValue(search);
  const [tiers, setTiers] = useState<Tier[]>(() => searchParams.getAll("tier").filter((t): t is Tier => TIERS.includes(t as Tier)));
  const [stage, setStage] = useState<string[]>(() => searchParams.getAll("stage"));
  const [industry, setIndustry] = useState<string[]>(() => searchParams.getAll("industry"));
  const [stateFilter, setStateFilter] = useState<string[]>(() => searchParams.getAll("state"));
  const [minScore, setMinScore] = useState(() => Number(searchParams.get("min_score")) || 0);
  const [hasEmail, setHasEmail] = useState(() => searchParams.get("has_email") === "true");
  const [dueOnly, setDueOnly] = useState(() => searchParams.get("follow_up_due") === "true");
  const [sort, setSort] = useState(() => {
    const s = searchParams.get("sort");
    return s && SORTS.some((x) => x.value === s) ? s : "-score";
  });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [focusId, setFocusId] = useState<number | null>(null);
  const [aiText, setAiText] = useState("");
  const { ask, pending: asking } = useAskAI();

  const filters = useMemo(
    () => ({
      search: deferredSearch.trim() || undefined,
      tier: tiers.length ? tiers : undefined,
      stage: stage.length ? stage : undefined,
      industry: industry.length ? industry : undefined,
      state: stateFilter.length ? stateFilter : undefined,
      min_score: minScore > 0 ? minScore : undefined,
      has_email: hasEmail ? true : undefined,
      follow_up_due: dueOnly ? true : undefined,
    }),
    [deferredSearch, tiers, stage, industry, stateFilter, minScore, hasEmail, dueOnly],
  );
  const key = `/leads${qs({ ...filters, sort, page, page_size: PAGE_SIZE })}`;
  const { data, error, isLoading, mutate } = useSWR<LeadPage>(key);
  const { data: facets } = useSWR<{ industries: string[]; states: string[] }>("/leads/facets");
  const { data: stats } = useSWR<Stats>("/stats");
  const { data: pipeline } = useSWR<LeadPage>(PIPELINE_KEY);
  const { job, start: startEnrichment, running } = useEnrichmentJob();

  const items = data?.items ?? [];
  const activeId = focusId !== null && items.some((i) => i.id === focusId) ? focusId : (items[0]?.id ?? null);
  const activeFilters =
    tiers.length + (stage.length ? 1 : 0) + (industry.length ? 1 : 0) + (stateFilter.length ? 1 : 0) + (minScore > 0 ? 1 : 0) + (hasEmail ? 1 : 0) + (dueOnly ? 1 : 0);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const allOnPageSelected = items.length > 0 && items.every((i) => selected.has(i.id));
  const selectedIds = [...selected];
  const openRevenue = pipeline?.items.filter((l) => OPEN_STAGES.has(l.stage)).reduce((s, l) => s + (l.revenue_usd ?? 0), 0);

  function resetPage<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

  function clearFilters() {
    setTiers([]);
    setStage([]);
    setIndustry([]);
    setStateFilter([]);
    setMinScore(0);
    setHasEmail(false);
    setDueOnly(false);
    setSearch("");
    setPage(1);
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) items.forEach((i) => next.delete(i.id));
      else items.forEach((i) => next.add(i.id));
      return next;
    });
  }

  function exportCsv(format: "standard" | "hubspot" | "salesforce", onlySelected: boolean) {
    const params = onlySelected ? { format, ids: selectedIds.map(String) } : { format, ...filters };
    downloadCsv(`/api/leads/export${qs(params as Record<string, string | string[] | number | boolean | undefined>)}`);
    toast.success(`Exporting ${onlySelected ? selectedIds.length : (data?.total ?? 0)} leads (${format})`);
  }

  async function bulkStage(next: Stage) {
    try {
      const r = await leadsApi.bulkStage(selectedIds, next);
      toast.success(`Moved ${r.updated} leads to ${next}`);
      setSelected(new Set());
      await mutate();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function bulkDelete() {
    try {
      const r = await leadsApi.bulkDelete(selectedIds);
      toast.success(`Deleted ${r.deleted} leads`);
      setSelected(new Set());
      await mutate();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function dedupe() {
    try {
      const r = await leadsApi.dedupe();
      toast.success(r.records_removed ? `Merged ${r.records_removed} duplicate records` : "No duplicates found");
      await mutate();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function removeOne(id: number, name: string) {
    try {
      await leadsApi.remove(id);
      toast.success(`Deleted ${name}`);
      await mutate();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const multi = (values: string[]) => (values.length === 0 ? "all" : values.length === 1 ? values[0] : "__multi");

  return (
    <div className="flex w-full flex-col pb-24">
      <div className="flex flex-col gap-3 px-4 pt-5 md:px-6">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-amber/10 px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wider text-gold uppercase">AI lead explorer</span>
              <span className="font-mono text-[11px] text-outline">• {data ? `${formatNumber(data.total)} companies match` : "Loading…"}</span>
            </div>
            <h1 className="flex flex-wrap items-baseline gap-2 font-heading text-[1.875rem] font-semibold tracking-tight">
              Leads Explorer
              <span className="text-sm font-normal text-muted-foreground">/ enriched company directory &amp; decision makers</span>
            </h1>
          </div>
          <div className="flex items-center gap-1.5 rounded-xl bg-card p-1.5 shadow-md">
            <div className="flex items-center gap-1.5 rounded-lg bg-surface-card px-3 py-1">
              <span className="size-2 animate-pulse rounded-full bg-emerald" />
              <span className="font-mono text-[13px] font-bold tabular">{stats?.total ?? "…"}</span>
              <span className="text-xs text-muted-foreground">Active targets</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg bg-surface-card px-3 py-1">
              <span className="font-mono text-[11px] font-semibold text-cyan uppercase">Avg score</span>
              <span className="font-mono text-[13px] font-bold text-gold tabular">{stats ? stats.avg_score.toFixed(1) : "…"}</span>
            </div>
            <div className="hidden items-center gap-1.5 rounded-lg bg-surface-card px-3 py-1 xl:flex">
              <span className="font-mono text-[11px] text-outline uppercase">Open pipeline</span>
              <span className="font-mono text-[13px] font-semibold tabular">{openRevenue !== undefined ? formatMoney(openRevenue) : "…"}</span>
            </div>
          </div>
        </div>

        <div className="my-1 flex w-full flex-col gap-3 rounded-2xl bg-card p-3 shadow-xl">
          <form
            className="relative flex w-full items-center"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await ask(aiText)) setAiText("");
            }}
          >
            <Sparkles className="pointer-events-none absolute left-3 size-[22px] text-cyan" />
            <input
              value={aiText}
              onChange={(e) => setAiText(e.target.value)}
              placeholder="Filter leads with AI: family-owned HVAC in Texas or Florida scoring above 80…"
              aria-label="Filter leads with AI"
              className="w-full rounded-xl bg-background py-3 pr-44 pl-12 text-sm outline-none placeholder:text-outline focus:ring-1 focus:ring-cyan"
            />
            <div className="absolute right-2 flex items-center gap-1.5">
              <span className="hidden items-center rounded bg-surface-high px-2 py-1 font-mono text-[11px] font-bold text-cyan sm:inline-flex">
                <Zap className="mr-1 size-3.5" /> Semantic match
              </span>
              <button
                type="submit"
                disabled={asking || aiText.trim().length < 2}
                className="flex items-center gap-1 rounded-lg bg-amber px-3 py-1.5 font-heading text-xs font-semibold text-primary-foreground shadow-md transition-colors hover:bg-gold disabled:opacity-60"
              >
                {asking && <Loader2 className="size-3.5 animate-spin" />} {asking ? "Thinking" : "Apply filter"}
              </button>
            </div>
          </form>

          {aiQuery && (
            <div className="flex items-start gap-3 rounded-xl border border-amber/30 bg-amber/5 px-3 py-2 text-sm">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-gold" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">&ldquo;{aiQuery}&rdquo;</p>
                {aiWhy && <p className="text-xs text-muted-foreground">{aiWhy}</p>}
              </div>
              <button type="button" onClick={() => router.replace(pathname)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <X className="size-3.5" /> Clear
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Select value={multi(industry)} onValueChange={(v) => resetPage(setIndustry)(v === "all" ? [] : [v])}>
                <SelectTrigger className="h-8 border-none bg-surface-card text-xs shadow-sm" aria-label="Sector">
                  <Factory className="size-4 text-cyan" />
                  <span className="text-muted-foreground">Sector:</span>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All verticals</SelectItem>
                  {industry.length > 1 && (
                    <SelectItem value="__multi" disabled>
                      {industry.join(", ")}
                    </SelectItem>
                  )}
                  {facets?.industries.map((i) => (
                    <SelectItem key={i} value={i}>
                      {i}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center rounded-lg bg-surface-card p-0.5 shadow-sm" role="group" aria-label="Filter by tier">
                {TIERS.map((t) => {
                  const on = tiers.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={on}
                      onClick={() => resetPage(setTiers)(on ? tiers.filter((x) => x !== t) : [...tiers, t])}
                      className={cn(
                        "flex items-center gap-1 rounded px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors",
                        on ? "bg-amber/25 text-gold shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {on && <span className="size-1.5 rounded-full bg-gold" />}
                      {TIER_LABEL[t]} {stats && `(${stats.by_tier[t] ?? 0})`}
                    </button>
                  );
                })}
              </div>

              <Select value={multi(stateFilter)} onValueChange={(v) => resetPage(setStateFilter)(v === "all" ? [] : [v])}>
                <SelectTrigger className="h-8 border-none bg-surface-card text-xs shadow-sm" aria-label="HQ state">
                  <MapPin className="size-4 text-outline" />
                  <span className="text-muted-foreground">HQ:</span>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any state</SelectItem>
                  {stateFilter.length > 1 && (
                    <SelectItem value="__multi" disabled>
                      {stateFilter.join(", ")}
                    </SelectItem>
                  )}
                  {facets?.states.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={multi(stage)} onValueChange={(v) => resetPage(setStage)(v === "all" ? [] : [v])}>
                <SelectTrigger className="h-8 border-none bg-surface-card text-xs shadow-sm" aria-label="Stage">
                  <Layers className="size-4 text-amber-soft" />
                  <span className="text-muted-foreground">Stage:</span>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All stages</SelectItem>
                  {stage.length > 1 && (
                    <SelectItem value="__multi" disabled>
                      {stage.join(", ")}
                    </SelectItem>
                  )}
                  {STAGES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <button type="button" aria-pressed={hasEmail} onClick={() => resetPage(setHasEmail)(!hasEmail)} className={chip}>
                <ShieldCheck className={cn("size-4", hasEmail ? "text-emerald" : "text-outline")} />
                <span>Contact:</span>
                <span className={cn("font-mono font-semibold", hasEmail ? "text-emerald" : "text-muted-foreground")}>{hasEmail ? "Has email" : "Any"}</span>
              </button>

              <button type="button" aria-pressed={dueOnly} onClick={() => resetPage(setDueOnly)(!dueOnly)} className={chip}>
                <BellRing className={cn("size-4", dueOnly ? "text-gold" : "text-outline")} />
                <span className={dueOnly ? "font-semibold text-gold" : ""}>Follow-up due</span>
              </button>

              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className={chip}>
                    <SlidersHorizontal className="size-4 text-amber-soft" />
                    <span>Score:</span>
                    <span className="font-mono font-semibold text-amber-soft">{minScore > 0 ? `${minScore}+` : "Any"}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 space-y-3">
                  <div className="flex justify-between text-sm">
                    <span>Minimum score</span>
                    <span className="font-mono tabular">{minScore}</span>
                  </div>
                  <Slider value={[minScore]} onValueChange={(v) => resetPage(setMinScore)(v[0] ?? 0)} max={100} step={5} />
                </PopoverContent>
              </Popover>

              <Select value={sort} onValueChange={resetPage(setSort)}>
                <SelectTrigger className="h-8 border-none bg-surface-card text-xs shadow-sm" aria-label="Sort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORTS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-outline" />
                <input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Keyword search…"
                  aria-label="Search leads"
                  className="w-44 rounded-md bg-surface-card py-1.5 pr-2 pl-7 text-xs outline-none placeholder:text-outline focus:ring-1 focus:ring-cyan"
                />
              </div>
              {(activeFilters > 0 || search) && (
                <button type="button" onClick={clearFilters} className="flex items-center gap-1 font-mono text-[11px] font-bold text-outline transition-colors hover:text-gold">
                  <SlidersHorizontal className="size-3.5" /> Clear ({activeFilters + (search ? 1 : 0)} active)
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-between gap-2 px-2 py-1 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1.5">
              <Checkbox checked={allOnPageSelected} onCheckedChange={toggleAll} aria-label="Select visible leads" />
              <span className="text-xs text-muted-foreground select-none">
                Select visible (<span className="font-mono font-semibold text-foreground">{items.length}</span>)
              </span>
            </label>
            <div className="h-3 w-px bg-border" />
            <span className="font-mono text-[11px] font-bold text-cyan">{selected.size ? `${selected.size} selected` : "Batch mode ready"}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={dedupe} className={chip}>
              <Layers className="size-4" /> Merge duplicates
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={chip}>
                  <Download className="size-4" /> Export CSV
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Export {selected.size ? `${selected.size} selected` : "filtered leads"}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => exportCsv("standard", selected.size > 0)}>CSV (with score reasons)</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportCsv("hubspot", selected.size > 0)}>HubSpot import format</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportCsv("salesforce", selected.size > 0)}>Salesforce import format</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button type="button" onClick={() => setDialog("import", true)} className={chip}>
              <Upload className="size-4" /> Import
            </button>
            <button
              type="button"
              onClick={() => setDialog("add", true)}
              className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-cyan to-indigo px-3 py-1.5 font-heading text-xs font-semibold text-background shadow-md transition-all hover:brightness-110"
            >
              <UserPlus className="size-4" /> Add company
            </button>
          </div>
        </div>

        {job && (
          <div className="flex items-center gap-3 rounded-lg bg-card px-3 py-2 text-sm">
            <Loader2 className="size-4 animate-spin text-cyan" />
            <span className="shrink-0">
              Enriching {job.completed}/{job.total}
            </span>
            <Progress value={job.total ? (job.completed / job.total) * 100 : 0} className="h-1.5" />
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Couldn&apos;t load leads</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
          <div className="flex flex-col gap-2 lg:col-span-8">
            <div className="hidden grid-cols-12 gap-3 px-3 py-1 font-mono text-[11px] font-bold tracking-wider text-outline uppercase select-none xl:grid">
              <div className="col-span-5 2xl:col-span-4">Target company &amp; origin</div>
              <div className="col-span-2 text-center">Deal Signal</div>
              <div className="col-span-2 text-right">Key financials</div>
              <div className="hidden 2xl:col-span-2 2xl:block">Decision maker</div>
              <div className="col-span-3 text-right 2xl:col-span-2">Next action</div>
            </div>
            {isLoading && !data
              ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)
              : items.map((l) => (
                  <LeadRow
                    key={l.id}
                    lead={l}
                    active={l.id === activeId}
                    checked={selected.has(l.id)}
                    onCheck={() => toggle(l.id)}
                    onSelect={() => setFocusId(l.id)}
                    onEnrich={() => startEnrichment([l.id], true)}
                    onDelete={() => removeOne(l.id, l.company_name)}
                    enriching={running}
                  />
                ))}
            {data && items.length === 0 && (
              <div className="rounded-2xl bg-card py-16 text-center">
                <p className="font-medium">No leads match</p>
                <p className="mt-1 text-sm text-muted-foreground">Try clearing filters or add a company to get started.</p>
                <div className="mt-4 flex justify-center gap-2">
                  {(activeFilters > 0 || search) && (
                    <button type="button" onClick={clearFilters} className={chip}>
                      Clear filters
                    </button>
                  )}
                  <button type="button" onClick={() => setDialog("add", true)} className="flex items-center gap-1 rounded-lg bg-amber px-3 py-1.5 text-xs font-semibold text-primary-foreground">
                    <Building2 className="size-4" /> Add company
                  </button>
                </div>
              </div>
            )}
            {data && data.total > PAGE_SIZE && (
              <div className="flex items-center justify-between pt-2 text-sm text-muted-foreground">
                <span className="font-mono text-xs">
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className={cn(chip, "disabled:opacity-50")}>
                    <ChevronLeft className="size-4" /> Previous
                  </button>
                  <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className={cn(chip, "disabled:opacity-50")}>
                    Next <ChevronRight className="size-4" />
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="sticky top-20 flex flex-col gap-3 lg:col-span-4">
            <LeadDossier id={activeId} />
          </div>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center px-4 md:pl-[calc(var(--sidebar-width)+1rem)]">
          <div className="pointer-events-auto flex flex-wrap items-center gap-4 rounded-full bg-card/95 px-5 py-2.5 shadow-2xl ring-1 ring-border backdrop-blur-xl">
            <div className="flex items-center gap-2">
              <span className="size-2.5 animate-ping rounded-full bg-gold" />
              <span className="text-xs font-medium">
                <strong className="font-mono font-bold text-gold">{selected.size} target{selected.size === 1 ? "" : "s"}</strong> selected
              </span>
            </div>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => startEnrichment(selectedIds, true)}
                disabled={running}
                className="flex items-center gap-1 rounded-full bg-surface-card px-3 py-1 text-xs transition-colors hover:bg-surface-high disabled:opacity-60"
              >
                {running ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Enrich
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="rounded-full bg-surface-card px-3 py-1 text-xs transition-colors hover:bg-surface-high">
                    Move to stage
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {STAGES.map((s) => (
                    <DropdownMenuItem key={s.value} onSelect={() => bulkStage(s.value)}>
                      {s.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <button type="button" onClick={() => exportCsv("standard", true)} className="rounded-full bg-surface-card px-3 py-1 text-xs transition-colors hover:bg-surface-high">
                Export
              </button>
              <button type="button" onClick={bulkDelete} className="rounded-full bg-destructive/15 px-3 py-1 text-xs text-destructive transition-colors hover:bg-destructive/25">
                Delete
              </button>
              <button type="button" onClick={() => setSelected(new Set())} aria-label="Clear selection" className="rounded-full p-1 text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      <AddLeadDialog open={addOpen} onOpenChange={(o) => setDialog("add", o)} />
      <ImportDialog open={importOpen} onOpenChange={(o) => setDialog("import", o)} />
    </div>
  );
}
