"use client";

import {
  Activity,
  BadgeCheck,
  Briefcase,
  Building2,
  Calendar,
  Globe2,
  Handshake,
  Info,
  Landmark,
  Loader2,
  Lock,
  Mail,
  MapPin,
  PhoneCall,
  RefreshCw,
  RotateCcw,
  Save,
  ScanSearch,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { type ICP, icpApi, isLeadDataKey, type Lead, type LeadPage, type Stats } from "@/lib/api";
import { formatMoney, parseCompactNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const WEIGHT_META: Record<
  string,
  { label: string; short: string; hint: string; icon: typeof Users; tone: string; salesLabel?: string; salesHint?: string }
> = {
  industry_fit: { label: "Industry fit", short: "Industry", hint: "Lead is in one of your target industries", icon: Building2, tone: "text-amber-soft" },
  size_fit: { label: "Company size", short: "Size", hint: "Headcount inside your range", icon: Users, tone: "text-cyan-soft" },
  revenue_fit: { label: "Revenue", short: "Revenue", hint: "Revenue inside your range", icon: Landmark, tone: "text-gold" },
  location_fit: { label: "Location", short: "Location", hint: "Headquartered in a target state", icon: MapPin, tone: "text-indigo" },
  longevity: { label: "Years in business", short: "Longevity", hint: "Durable, proven businesses score higher", icon: Calendar, tone: "text-amber-soft" },
  succession: {
    label: "Succession signals",
    short: "Succession",
    salesLabel: "Buying triggers",
    hint: "Retirement language, family-owned, long founder tenure, outdated site",
    salesHint: "Hiring, outdated website, no CRM or marketing automation",
    icon: Activity,
    tone: "text-gold",
  },
  independence: { label: "Ownership", short: "Ownership", hint: "Independent & owner-operated vs. PE-backed", icon: Lock, tone: "text-cyan-soft" },
  contactability: { label: "Contactability", short: "Contact", hint: "Verified personal email, phone, owner identified", icon: PhoneCall, tone: "text-emerald" },
  growth: { label: "Growth & health", short: "Growth", hint: "Hiring, online booking, active socials", icon: TrendingUp, tone: "text-indigo" },
};

const sectionCls = "flex flex-col gap-3 rounded-xl bg-card p-5 shadow-md";
const tileCls = "flex flex-col gap-2 rounded-xl bg-surface-card p-3";
const fieldCls =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none placeholder:text-outline focus:border-cyan/60 focus:ring-1 focus:ring-cyan/40";

function SectionHeader({ icon: Icon, tone, title, sub, chip }: { icon: typeof Users; tone: string; title: string; sub: string; chip?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
      <div className="flex items-center gap-2">
        <div className={cn("flex size-8 items-center justify-center rounded-md bg-surface-card", tone)}>
          <Icon className="size-5" />
        </div>
        <div>
          <h2 className="font-heading font-semibold">{title}</h2>
          <span className="font-mono text-[11px] text-muted-foreground">{sub}</span>
        </div>
      </div>
      {chip}
    </div>
  );
}

function TagInput({ values, onChange, placeholder, upper }: { values: string[]; onChange: (v: string[]) => void; placeholder: string; upper?: boolean }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const parts = draft
      .split(",")
      .map((s) => (upper ? s.trim().toUpperCase() : s.trim()))
      .filter(Boolean);
    if (parts.length) onChange([...new Set([...values, ...parts])]);
    setDraft("");
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-surface-high px-2.5 py-1 font-mono text-[11px] font-bold text-gold">
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`} className="hover:text-destructive">
              <X className="size-3" />
            </button>
          </span>
        ))}
        {values.length === 0 && <span className="text-xs text-muted-foreground">None - every value scores half points</span>}
      </div>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        placeholder={placeholder}
        className={fieldCls}
      />
    </div>
  );
}

function RangeInputs({ min, max, onChange, money }: { min: number | null; max: number | null; onChange: (min: number | null, max: number | null) => void; money?: boolean }) {
  const fmt = (n: number | null) => (n === null ? "" : money ? formatMoney(n).replace("$", "") : String(n));
  const [lo, setLo] = useState(fmt(min));
  const [hi, setHi] = useState(fmt(max));
  const commit = () => onChange(parseCompactNumber(lo), parseCompactNumber(hi));
  return (
    <div className="flex items-center gap-2">
      <input value={lo} onChange={(e) => setLo(e.target.value)} onBlur={commit} placeholder="Min" inputMode="decimal" className={fieldCls} />
      <span className="text-outline">–</span>
      <input value={hi} onChange={(e) => setHi(e.target.value)} onBlur={commit} placeholder="Max" inputMode="decimal" className={fieldCls} />
    </div>
  );
}

function rangeLabel(lo: number | null, hi: number | null, money?: boolean) {
  const f = (n: number) => (money ? formatMoney(n) : n.toLocaleString());
  if (lo === null && hi === null) return "Any";
  if (lo !== null && hi !== null) return `${f(lo)} – ${f(hi)}`;
  return lo !== null ? `${f(lo)}+` : `Up to ${f(hi as number)}`;
}

/** Recomputes a lead's score from its saved breakdown with new weights (factor ratio × normalised weight). */
function previewScore(lead: Lead, weights: Record<string, number>) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  const factors = lead.score_breakdown.filter((f) => f.key in WEIGHT_META);
  const rows = factors.map((f) => {
    const ratio = f.max ? f.points / f.max : 0;
    const max = ((weights[f.key] ?? 0) / total) * 100;
    return { ...f, ratio, newPoints: ratio * max, newMax: max };
  });
  const raw = rows.reduce((s, r) => s + r.newPoints, 0);
  const knock = lead.score_breakdown.find((f) => f.key === "knockout");
  const cap = knock ? factors.reduce((s, f) => s + f.points, 0) + knock.points : 100;
  return { score: Math.round(Math.min(raw, cap)), rows, capped: !!knock && raw > cap, capReason: knock?.reason };
}

function SignalGeometry({ rows }: { rows: { key: string; ratio: number }[] }) {
  const n = rows.length || 1;
  const pt = (i: number, r: number) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [100 + Math.cos(a) * r * 72, 100 + Math.sin(a) * r * 72] as const;
  };
  const ring = (r: number) => rows.map((_, i) => pt(i, r).join(",")).join(" ");
  const shape = rows.map((row, i) => pt(i, Math.max(0.06, row.ratio)).join(",")).join(" ");
  return (
    <svg viewBox="-42 -14 284 228" className="h-60 w-72 max-w-full text-amber" role="img" aria-label="Signal geometry of the benchmark lead">
      {[1, 0.66, 0.33].map((r) => (
        <polygon key={r} points={ring(r)} fill="none" stroke="currentColor" strokeOpacity={0.12 + (1 - r) * 0.1} />
      ))}
      {rows.map((_, i) => {
        const [x, y] = pt(i, 1);
        return <line key={i} x1={100} y1={100} x2={x} y2={y} stroke="currentColor" strokeOpacity={0.15} />;
      })}
      <polygon points={shape} fill="currentColor" fillOpacity={0.25} stroke="currentColor" strokeWidth={2} />
      {rows.map((row, i) => {
        const [x, y] = pt(i, Math.max(0.06, row.ratio));
        const [lx, ly] = pt(i, 1.24);
        return (
          <g key={row.key}>
            <circle cx={x} cy={y} r={3} className="fill-gold" />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="fill-foreground font-mono" fontSize={7.5}>
              {WEIGHT_META[row.key]?.short} {Math.round(row.ratio * 100)}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function CalibrationPanel({ weights, savedWeights }: { weights: Record<string, number>; savedWeights: Record<string, number> }) {
  const { data: leads } = useSWR<LeadPage>("/leads?page_size=200&sort=-score");
  const top = leads?.items.slice(0, 12) ?? [];
  const [pick, setPick] = useState<number | null>(null);
  const id = pick ?? top[0]?.id ?? null;
  const { data: lead } = useSWR<Lead>(id ? `/leads/${id}` : null);
  const rank = leads && lead ? leads.items.filter((l) => l.score > lead.score).length + 1 : null;
  const preview = useMemo(() => (lead ? previewScore(lead, weights) : null), [lead, weights]);
  const saved = useMemo(() => (lead ? previewScore(lead, savedWeights).score : null), [lead, savedWeights]);
  const delta = preview && saved !== null ? preview.score - saved : 0;
  const tier = preview ? (preview.score >= 75 ? "hot" : preview.score >= 55 ? "warm" : "cold") : "cold";

  return (
    <section className="relative flex flex-col gap-3 overflow-hidden rounded-xl bg-card p-5 shadow-xl">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="font-mono text-[11px] font-bold tracking-wider text-gold uppercase">Live signal calibration</span>
          <h2 className="font-heading font-semibold">Benchmark model preview</h2>
        </div>
        <span className="flex items-center gap-1 rounded bg-surface-card px-2 py-0.5 font-mono text-[11px] font-bold text-cyan">
          <Zap className="size-3.5" /> Reactive calculator
        </span>
      </div>

      <div className="flex items-center gap-3 rounded-xl bg-surface-card p-3">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-amber/15 text-gold">
          <Building2 className="size-6" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <Select value={id ? String(id) : undefined} onValueChange={(v) => setPick(Number(v))}>
              <SelectTrigger size="sm" className="h-7 max-w-[75%] border-none bg-transparent px-0 font-heading text-base font-semibold shadow-none dark:bg-transparent">
                <SelectValue placeholder="Pick a lead" />
              </SelectTrigger>
              <SelectContent>
                {top.map((l) => (
                  <SelectItem key={l.id} value={String(l.id)}>
                    {l.company_name} ({l.score})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {rank && leads && <span className="shrink-0 font-mono text-xs font-bold text-emerald">#{rank} of {leads.total}</span>}
          </div>
          <span className="truncate text-xs text-muted-foreground">
            {lead ? [[lead.city, lead.state].filter(Boolean).join(", "), lead.industry, lead.employee_count ? `${lead.employee_count} employees` : null].filter(Boolean).join(" • ") : "…"}
          </span>
        </div>
      </div>

      <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-xl bg-surface-card p-5">
        <div className="pointer-events-none absolute -top-12 -right-12 size-40 rounded-full bg-gold/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-12 -left-12 size-40 rounded-full bg-cyan/10 blur-2xl" />
        {preview ? (
          <>
            <div className="flex items-baseline gap-1">
              <span className="font-heading text-[2.5rem] font-extrabold tracking-tight text-gold tabular">{preview.score}</span>
              <span className="font-heading text-xl font-light text-muted-foreground">/100</span>
              {delta !== 0 && (
                <span className={cn("ml-2 font-mono text-sm font-bold", delta > 0 ? "text-emerald" : "text-destructive")}>
                  {delta > 0 ? "+" : ""}
                  {delta} vs saved
                </span>
              )}
            </div>
            <span className={cn("mt-1 text-center font-mono text-[11px] font-bold tracking-widest uppercase", tier === "hot" ? "text-emerald" : tier === "warm" ? "text-cyan-soft" : "text-cold")}>
              {tier === "hot" ? "Hot • outreach recommended" : tier === "warm" ? "Warm • nurture" : "Cold • deprioritize"}
            </span>
            {preview.capped && <span className="mt-1 text-center text-[11px] text-muted-foreground">Capped by a fit gate: {preview.capReason}</span>}
          </>
        ) : (
          <Skeleton className="h-16 w-40" />
        )}
      </div>

      <div className="flex flex-col items-center gap-2 rounded-xl bg-surface-card p-3">
        <div className="flex w-full items-center justify-between">
          <span className="font-mono text-[11px] text-muted-foreground uppercase">Signal geometry (share of each factor earned)</span>
        </div>
        {preview ? <SignalGeometry rows={preview.rows} /> : <Skeleton className="size-60 rounded-full" />}
        <div className="flex w-full flex-col gap-1.5 pt-1 text-xs">
          {preview?.rows
            .slice()
            .sort((a, b) => b.newPoints - a.newPoints)
            .map((r) => (
              <div key={r.key} className="flex items-center justify-between gap-2 rounded bg-card p-1.5">
                <span className="truncate text-muted-foreground" title={r.reason}>
                  {WEIGHT_META[r.key]?.label}: {r.reason}
                </span>
                <span className={cn("shrink-0 font-mono font-bold tabular", r.ratio >= 0.7 ? "text-emerald" : r.ratio >= 0.4 ? "text-gold" : "text-cold")}>
                  +{r.newPoints.toFixed(1)} pts
                </span>
              </div>
            ))}
        </div>
        <p className="w-full text-[11px] text-outline">Weight changes preview instantly. Target-market changes apply when you save.</p>
      </div>
    </section>
  );
}

export function IcpForm() {
  const { data, error, mutate } = useSWR<ICP>("/icp");
  const { data: defaults } = useSWR<Record<string, number>>("/icp/defaults");
  const { data: stats } = useSWR<Stats>("/stats");
  const { mutate: globalMutate } = useSWRConfig();
  const [draft, setDraft] = useState<ICP | null>(null);
  const [saving, setSaving] = useState(false);

  const icp = draft ?? data;
  const update = (patch: Partial<ICP>) => icp && setDraft({ ...icp, ...patch });
  const totalWeight = icp ? Object.values(icp.weights).reduce((a, b) => a + b, 0) : 0;
  const sales = icp?.mode === "sales";

  const modified = useMemo(() => {
    if (!draft || !data) return 0;
    const keys: (keyof ICP)[] = ["mode", "target_industries", "target_states", "min_employees", "max_employees", "min_revenue", "max_revenue", "min_years_in_business"];
    const changed = keys.filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(data[k])).length;
    return changed + Object.keys(WEIGHT_META).filter((k) => (draft.weights[k] ?? 0) !== (data.weights[k] ?? 0)).length;
  }, [draft, data]);

  async function save() {
    if (!icp) return;
    setSaving(true);
    try {
      const saved = await icpApi.save({
        name: icp.name,
        mode: icp.mode,
        target_industries: icp.target_industries,
        target_states: icp.target_states,
        min_employees: icp.min_employees,
        max_employees: icp.max_employees,
        min_revenue: icp.min_revenue,
        max_revenue: icp.max_revenue,
        min_years_in_business: icp.min_years_in_business,
        weights: icp.weights,
      });
      await mutate(saved, { revalidate: false });
      setDraft(null);
      await globalMutate(isLeadDataKey);
      toast.success("Profile saved - every lead has been rescored");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load your profile</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      </div>
    );
  }
  if (!icp || !data) return <Skeleton className="m-6 h-[600px]" />;

  return (
    <div className="flex w-full flex-col pb-4">
      <div className="flex flex-col gap-5 p-4 md:p-6">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-amber/20 px-2 py-0.5 font-mono text-[11px] font-bold tracking-widest text-gold uppercase">Scoring engine</span>
              <span className="flex items-center gap-1 font-mono text-[11px] font-bold text-cyan uppercase">
                <span className="inline-block size-1.5 animate-pulse rounded-full bg-cyan" /> Explainable · every point has a reason
              </span>
            </div>
            <h1 className="font-heading text-[1.875rem] font-semibold tracking-tight">Deal Signal scoring profile</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Describe the companies you want. Every lead is ranked against this profile, fit gates stop irrelevant leads from
              ranking as hot, and saving rescores the whole pipeline instantly.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start lg:self-auto">
            <div className="flex items-center gap-2 rounded-xl bg-surface-card px-3 py-2 shadow-md">
              <div className="size-2.5 rounded-full bg-emerald shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
              <div className="flex flex-col">
                <span className="font-mono text-[11px] text-muted-foreground uppercase">Active profile</span>
                <span className="text-sm font-semibold">{icp.name}</span>
              </div>
            </div>
            <div className="flex rounded-xl bg-card p-1 shadow-sm" role="group" aria-label="Scoring mode">
              {[
                { mode: "acquisition" as const, icon: Handshake, label: "Acquisition" },
                { mode: "sales" as const, icon: Briefcase, label: "B2B sales" },
              ].map((m) => (
                <button
                  key={m.mode}
                  type="button"
                  onClick={() => update({ mode: m.mode })}
                  aria-pressed={icp.mode === m.mode}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
                    icp.mode === m.mode ? "bg-surface-high text-gold shadow-inner" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <m.icon className="size-4" /> {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
          <div className="flex flex-col gap-5 xl:col-span-7">
            <section className={sectionCls}>
              <SectionHeader
                icon={Landmark}
                tone="text-amber"
                title="Core firmographic criteria"
                sub="Wrong industry caps a lead at 55, wrong geography at 70"
                chip={<span className="rounded bg-surface-card px-2 py-0.5 font-mono text-[11px] font-bold text-emerald">FIT GATES</span>}
              />
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className={tileCls}>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold">Target revenue bracket</label>
                    <span className="font-mono text-[13px] font-semibold text-gold">{rangeLabel(icp.min_revenue, icp.max_revenue, true)}</span>
                  </div>
                  <RangeInputs key={`r-${data.updated_at}`} money min={icp.min_revenue} max={icp.max_revenue} onChange={(a, b) => update({ min_revenue: a, max_revenue: b })} />
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Info className="size-3.5 text-cyan" /> Accepts 500K, 2.5M, 20000000
                  </span>
                </div>
                <div className={tileCls}>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold">Headcount (employees)</label>
                    <span className="font-mono text-[13px] font-semibold text-gold">{rangeLabel(icp.min_employees, icp.max_employees)}</span>
                  </div>
                  <RangeInputs key={`e-${data.updated_at}`} min={icp.min_employees} max={icp.max_employees} onChange={(a, b) => update({ min_employees: a, max_employees: b })} />
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Info className="size-3.5 text-cyan" /> Leads outside the range earn partial size points
                  </span>
                </div>
                <div className={tileCls}>
                  <div className="flex items-center justify-between">
                    <label htmlFor="years" className="text-xs font-semibold">
                      Minimum years in business
                    </label>
                    <span className="font-mono text-[13px] font-semibold text-gold">{icp.min_years_in_business ? `${icp.min_years_in_business}+ yrs` : "Any"}</span>
                  </div>
                  <input
                    id="years"
                    type="number"
                    min={0}
                    max={200}
                    value={icp.min_years_in_business ?? ""}
                    onChange={(e) => update({ min_years_in_business: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
                    className={fieldCls}
                  />
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <BadgeCheck className="size-3.5 text-emerald" /> Proven, durable businesses score higher on longevity
                  </span>
                </div>
                <div className={tileCls}>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold">Target industries</label>
                    <span className="font-mono text-[11px] font-bold text-cyan">{icp.target_industries.length} active</span>
                  </div>
                  <TagInput values={icp.target_industries} onChange={(v) => update({ target_industries: v })} placeholder="Type an industry and press Enter" />
                </div>
                <div className={cn(tileCls, "md:col-span-2")}>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold">Geographic focus (states)</label>
                    <span className="font-mono text-[11px] font-bold text-cyan">{icp.target_states.length} active</span>
                  </div>
                  <TagInput values={icp.target_states} onChange={(v) => update({ target_states: v })} placeholder="TX, FL, GA…" upper />
                </div>
              </div>
            </section>

            <section className={sectionCls}>
              <SectionHeader
                icon={SlidersHorizontal}
                tone="text-gold"
                title={sales ? "Buying-trigger signal weights" : "Succession & transition signal weights"}
                sub="Relative weights, auto-scaled to add up to 100"
                chip={
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-amber/20 px-2.5 py-1 font-mono text-[13px] font-semibold text-gold">Total: 100% (scaled)</span>
                    <button
                      type="button"
                      onClick={() => defaults && update({ weights: { ...defaults } })}
                      disabled={!defaults}
                      className="flex items-center gap-1 rounded-md bg-surface-card px-2 py-1 text-xs hover:bg-surface-high disabled:opacity-50"
                    >
                      <RotateCcw className="size-3.5" /> Reset
                    </button>
                  </div>
                }
              />
              <div className="flex flex-col gap-3">
                {Object.entries(WEIGHT_META).map(([key, meta]) => {
                  const w = icp.weights[key] ?? 0;
                  const pct = totalWeight ? Math.round((w / totalWeight) * 100) : 0;
                  return (
                    <div key={key} className={tileCls}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <meta.icon className={cn("size-[18px]", meta.tone)} />
                          <span className="text-sm font-semibold">{sales && meta.salesLabel ? meta.salesLabel : meta.label}</span>
                        </div>
                        <span className="font-mono text-[13px] font-bold text-gold tabular">{pct}%</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{sales && meta.salesHint ? meta.salesHint : meta.hint}</p>
                      <Slider value={[w]} max={40} step={1} onValueChange={(v) => update({ weights: { ...icp.weights, [key]: v[0] ?? 0 } })} aria-label={meta.label} />
                    </div>
                  );
                })}
              </div>
            </section>

            <section className={sectionCls}>
              <SectionHeader
                icon={ScanSearch}
                tone="text-cyan"
                title="Enrichment & verification protocol"
                sub="What runs on every lead before it is scored"
                chip={<span className="rounded bg-indigo/20 px-2 py-0.5 font-mono text-[11px] font-bold text-cyan uppercase">Always on</span>}
              />
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {[
                  { icon: Mail, title: "Email verification", text: "Syntax, disposable-domain and role-inbox checks, then a live MX lookup. No mail is ever sent.", tag: "Valid / risky / invalid", tone: "text-emerald" },
                  { icon: Globe2, title: "Polite website crawl", text: "Respects robots.txt, reads JSON-LD first, then markup and text. Results are cached for 7 days.", tag: "Robots-aware", tone: "text-cyan" },
                  { icon: ShieldCheck, title: "Knockout gates", text: sales ? "Wrong industry or geography caps the score so off-target leads never rank as hot." : "Wrong industry, geography or an existing PE backer caps the score (PE-backed: 40).", tag: "Explained in UI", tone: "text-gold" },
                ].map((c) => (
                  <div key={c.title} className={cn(tileCls, "justify-between")}>
                    <div className="flex flex-col gap-1">
                      <span className="flex items-center gap-1.5 text-xs font-semibold">
                        <c.icon className={cn("size-4", c.tone)} /> {c.title}
                      </span>
                      <span className="text-xs text-muted-foreground">{c.text}</span>
                    </div>
                    <span className={cn("pt-1 font-mono text-[11px] font-bold uppercase", c.tone)}>{c.tag}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="flex flex-col gap-5 xl:col-span-5">
            <CalibrationPanel weights={icp.weights} savedWeights={data.weights} />
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 z-20 mt-2 flex flex-wrap items-center justify-between gap-3 border-t bg-card/95 px-4 py-3 shadow-2xl backdrop-blur-xl md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="hidden items-center gap-2 md:flex">
            <SlidersHorizontal className="size-5 text-gold" />
            <span className="text-xs font-semibold">Model configuration:</span>
            <span className={cn("font-mono text-[11px] font-bold", modified ? "text-cyan" : "text-emerald")}>
              {modified ? `${modified} parameter${modified === 1 ? "" : "s"} modified (unsaved)` : "Saved"}
            </span>
          </div>
          <div className="hidden h-4 w-px bg-border md:block" />
          <span className="font-mono text-[13px] text-muted-foreground">
            Current pipeline: <span className="font-bold text-gold">{stats ? `${stats.by_tier.hot} hot` : "…"}</span> of {stats?.total ?? "…"} leads
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDraft(null)}
            disabled={!draft || saving}
            className="rounded-md bg-surface-high px-3 py-2 text-xs font-semibold transition-colors hover:bg-surface-card disabled:opacity-50"
          >
            Discard changes
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!draft || saving || totalWeight === 0}
            className="flex items-center gap-2 rounded-md bg-amber px-4 py-2 text-xs font-bold text-primary-foreground shadow-[0_0_16px_rgba(245,158,11,0.35)] transition-colors hover:bg-gold disabled:opacity-50 disabled:shadow-none"
          >
            {saving ? <Loader2 className="size-[18px] animate-spin" /> : draft ? <RefreshCw className="size-[18px]" /> : <Save className="size-[18px]" />}
            {saving ? "Rescoring…" : `Save & rescore all ${stats?.total ?? ""} leads`}
          </button>
        </div>
      </div>
    </div>
  );
}
