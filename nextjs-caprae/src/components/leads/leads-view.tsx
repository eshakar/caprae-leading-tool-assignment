"use client";

import {
  BellRing,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Filter,
  Layers,
  Loader2,
  MoreHorizontal,
  Search,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDeferredValue, useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";

import { AddLeadDialog } from "@/components/leads/add-lead-dialog";
import { EmailStatusIcon, ScoreRing, StageBadge, TierBadge } from "@/components/leads/badges";
import { ImportDialog } from "@/components/leads/import-dialog";
import { useEnrichmentJob } from "@/components/leads/use-enrichment-job";
import { PageTitle } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type LeadPage, leadsApi, qs, STAGES, type Stage, type Tier } from "@/lib/api";
import { formatMoney, formatNumber, location } from "@/lib/format";
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
const PAGE_SIZE = 25;
const MULTI = "__multi";

/** Select value for a multi-value filter: "all", the single value, or a read-only "several" marker. */
function selectValue(values: string[]) {
  return values.length === 0 ? "all" : values.length === 1 ? values[0] : MULTI;
}

function MultiItem({ values }: { values: string[] }) {
  return values.length > 1 ? (
    <SelectItem value={MULTI} disabled>
      {values.join(", ")}
    </SelectItem>
  ) : null;
}

export function LeadsView() {
  // Filters arrive in the URL from Ask AI / the command palette; a new AI query remounts with fresh state.
  const searchParams = useSearchParams();
  return <LeadsViewInner key={searchParams.get("ai") ?? ""} />;
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
  const { job, start: startEnrichment, running } = useEnrichmentJob();

  const activeFilters =
    tiers.length + (stage.length ? 1 : 0) + (industry.length ? 1 : 0) + (stateFilter.length ? 1 : 0) + (minScore > 0 ? 1 : 0) + (hasEmail ? 1 : 0) + (dueOnly ? 1 : 0);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const items = data?.items ?? [];
  const allOnPageSelected = items.length > 0 && items.every((i) => selected.has(i.id));
  const selectedIds = [...selected];

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
    const params = onlySelected ? { format, ids: selectedIds.map(String) } : { format, ...filters, min_score: filters.min_score };
    const url = `/api/leads/export${qs(params as Record<string, string | string[] | number | boolean | undefined>)}`;
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
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

  async function enrichOne(id: number) {
    await startEnrichment([id], true);
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

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <PageTitle
        title="Leads"
        description={data ? `${formatNumber(data.total)} companies match your filters` : "Your prospect database"}
        actions={
          <>
            <Button variant="outline" onClick={dedupe}>
              <Layers /> Merge duplicates
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Download /> Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Export {selected.size ? `${selected.size} selected` : "filtered leads"}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => exportCsv("standard", selected.size > 0)}>CSV (with score reasons)</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportCsv("hubspot", selected.size > 0)}>HubSpot import format</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportCsv("salesforce", selected.size > 0)}>Salesforce import format</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" onClick={() => setDialog("import", true)}>
              <Upload /> Import
            </Button>
            <Button onClick={() => setDialog("add", true)}>
              <UserPlus /> Add company
            </Button>
          </>
        }
      />

      {aiQuery && (
        <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">&ldquo;{aiQuery}&rdquo;</p>
            {aiWhy && <p className="text-muted-foreground">{aiWhy}</p>}
          </div>
          <Button size="sm" variant="ghost" onClick={() => router.replace(pathname)}>
            <X /> Clear
          </Button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search company, domain, owner, city, industry…"
            className="pl-8"
            aria-label="Search leads"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border p-0.5" role="group" aria-label="Filter by tier">
            {TIERS.map((t) => {
              const on = tiers.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => resetPage(setTiers)(on ? tiers.filter((x) => x !== t) : [...tiers, t])}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                    on ? (t === "hot" ? "bg-hot/15 text-hot" : t === "warm" ? "bg-warm/15 text-warm" : "bg-cold/15 text-cold") : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-pressed={on}
                >
                  {t}
                </button>
              );
            })}
          </div>
          <Select value={selectValue(stage)} onValueChange={(v) => resetPage(setStage)(v === "all" ? [] : [v])}>
            <SelectTrigger className="w-[130px]" aria-label="Stage">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              <MultiItem values={stage} />
              {STAGES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">
                <Filter /> Filters
                {activeFilters > 0 && <Badge className="ml-1 h-5 px-1.5">{activeFilters}</Badge>}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 space-y-4">
              <div className="grid gap-2">
                <Label>Industry</Label>
                <Select value={selectValue(industry)} onValueChange={(v) => resetPage(setIndustry)(v === "all" ? [] : [v])}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All industries</SelectItem>
                    <MultiItem values={industry} />
                    {facets?.industries.map((i) => (
                      <SelectItem key={i} value={i}>
                        {i}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>State</Label>
                <Select value={selectValue(stateFilter)} onValueChange={(v) => resetPage(setStateFilter)(v === "all" ? [] : [v])}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All states</SelectItem>
                    <MultiItem values={stateFilter} />
                    {facets?.states.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-3">
                <div className="flex justify-between text-sm">
                  <Label>Minimum score</Label>
                  <span className="text-muted-foreground tabular">{minScore}</span>
                </div>
                <Slider value={[minScore]} onValueChange={(v) => resetPage(setMinScore)(v[0] ?? 0)} max={100} step={5} />
              </div>
              <label className="flex items-center justify-between text-sm">
                Has an email on file
                <Switch checked={hasEmail} onCheckedChange={resetPage(setHasEmail)} />
              </label>
              <label className="flex items-center justify-between text-sm">
                Follow-up due
                <Switch checked={dueOnly} onCheckedChange={resetPage(setDueOnly)} />
              </label>
              <Button variant="ghost" size="sm" className="w-full" onClick={clearFilters}>
                Clear all filters
              </Button>
            </PopoverContent>
          </Popover>
          <Select value={sort} onValueChange={resetPage(setSort)}>
            <SelectTrigger className="w-[150px]" aria-label="Sort">
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
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-primary/5 px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <Button size="sm" onClick={() => startEnrichment(selectedIds, true)} disabled={running}>
            {running ? <Loader2 className="animate-spin" /> : <Sparkles />} Enrich
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                Move to stage
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {STAGES.map((s) => (
                <DropdownMenuItem key={s.value} onSelect={() => bulkStage(s.value)}>
                  {s.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="outline" onClick={() => exportCsv("standard", true)}>
            <Download /> Export
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={bulkDelete}>
            <Trash2 /> Delete
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
            <X /> Clear
          </Button>
        </div>
      )}
      {job && (
        <div className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm">
          <Loader2 className="size-4 animate-spin text-primary" />
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

      <Card className="min-w-0 overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-10 pl-4">
                <Checkbox checked={allOnPageSelected} onCheckedChange={toggleAll} aria-label="Select page" />
              </TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Deal Signal</TableHead>
              <TableHead className="hidden 2xl:table-cell">Why</TableHead>
              <TableHead className="hidden md:table-cell">Location</TableHead>
              <TableHead className="hidden lg:table-cell">Size</TableHead>
              <TableHead className="hidden md:table-cell">Contact</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && !data
              ? Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={9}>
                      <Skeleton className="h-9" />
                    </TableCell>
                  </TableRow>
                ))
              : items.map((l) => (
                  <TableRow key={l.id} data-state={selected.has(l.id) ? "selected" : undefined} className="group">
                    <TableCell className="pl-4">
                      <Checkbox checked={selected.has(l.id)} onCheckedChange={() => toggle(l.id)} aria-label={`Select ${l.company_name}`} />
                    </TableCell>
                    <TableCell className="max-w-[240px]">
                      <Link href={`/leads/${l.id}`} className="block truncate font-medium hover:underline">
                        {l.company_name}
                      </Link>
                      <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                        {l.industry && <span>{l.industry}</span>}
                        {l.industry && l.domain && <span>·</span>}
                        {l.domain && <span className="truncate">{l.domain}</span>}
                        {l.enrichment_status === "pending" && (
                          <Badge variant="outline" className="h-4 px-1 text-[10px]">
                            not enriched
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <ScoreRing score={l.score} tier={l.score_tier} size={36} />
                        <TierBadge tier={l.score_tier} className="hidden sm:inline-flex" />
                      </div>
                    </TableCell>
                    <TableCell className="hidden max-w-[280px] 2xl:table-cell">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="line-clamp-2 text-xs text-muted-foreground">{l.top_reason ?? "—"}</p>
                        </TooltipTrigger>
                        {l.top_reason && <TooltipContent className="max-w-xs">{l.top_reason}</TooltipContent>}
                      </Tooltip>
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{location(l.city, l.state)}</TableCell>
                    <TableCell className="hidden text-sm lg:table-cell">
                      <div className="tabular">{l.employee_count ? `${formatNumber(l.employee_count)} emp` : "—"}</div>
                      <div className="text-xs text-muted-foreground tabular">{formatMoney(l.revenue_usd)}</div>
                    </TableCell>
                    <TableCell className="hidden max-w-[220px] md:table-cell">
                      {l.best_email ? (
                        <div className="flex items-center gap-1.5 text-sm">
                          {l.email_status && <EmailStatusIcon status={l.email_status} />}
                          <span className="truncate">{l.best_email}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">No email yet</span>
                      )}
                      {l.owner_name && <div className="truncate text-xs text-muted-foreground">{l.owner_name}</div>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <StageBadge stage={l.stage} />
                        {l.follow_up_due && (
                          <Badge variant="outline" className="h-5 gap-1 border-hot/30 bg-hot/10 px-1.5 text-[10px] text-hot">
                            <BellRing className="size-3" /> Follow-up due
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8" aria-label="Row actions">
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/leads/${l.id}`}>Open & draft outreach</Link>
                          </DropdownMenuItem>
                          {l.domain && (
                            <DropdownMenuItem onSelect={() => enrichOne(l.id)} disabled={running}>
                              <Sparkles /> Re-enrich
                            </DropdownMenuItem>
                          )}
                          {l.website && (
                            <DropdownMenuItem asChild>
                              <a href={l.website} target="_blank" rel="noopener noreferrer">
                                <ExternalLink /> Visit website
                              </a>
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => removeOne(l.id, l.company_name)}>
                            <Trash2 /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
            {data && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-16 text-center">
                  <p className="font-medium">No leads match</p>
                  <p className="mt-1 text-sm text-muted-foreground">Try clearing filters or add a company to get started.</p>
                  <div className="mt-4 flex justify-center gap-2">
                    {activeFilters > 0 || search ? (
                      <Button variant="outline" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    ) : null}
                    <Button onClick={() => setDialog("add", true)}>
                      <UserPlus /> Add company
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft /> Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight />
            </Button>
          </div>
        </div>
      )}

      <AddLeadDialog open={addOpen} onOpenChange={(o) => setDialog("add", o)} />
      <ImportDialog open={importOpen} onOpenChange={(o) => setDialog("import", o)} />
    </div>
  );
}
