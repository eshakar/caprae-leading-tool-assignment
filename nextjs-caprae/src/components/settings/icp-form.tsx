"use client";

import { Briefcase, Handshake, Loader2, RotateCcw, Save, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";

import { PageTitle } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { type ICP, icpApi, isLeadDataKey } from "@/lib/api";
import { formatMoney, parseCompactNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const WEIGHT_META: Record<string, { label: string; hint: string; salesLabel?: string; salesHint?: string }> = {
  industry_fit: { label: "Industry fit", hint: "Lead is in one of your target industries" },
  size_fit: { label: "Company size", hint: "Headcount inside your range" },
  revenue_fit: { label: "Revenue", hint: "Revenue inside your range" },
  location_fit: { label: "Location", hint: "Headquartered in a target state" },
  longevity: { label: "Years in business", hint: "Durable, proven businesses score higher" },
  succession: { label: "Succession signals", salesLabel: "Buying triggers", hint: "Retirement language, family-owned, long founder tenure, outdated site", salesHint: "Hiring, outdated website, no CRM or marketing automation" },
  independence: { label: "Ownership", hint: "Independent & owner-operated vs. PE-backed" },
  contactability: { label: "Contactability", hint: "Verified personal email, phone, owner identified" },
  growth: { label: "Growth & health", hint: "Hiring, online booking, active socials" },
};

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
          <Badge key={v} variant="secondary" className="gap-1 pr-1">
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`} className="rounded-sm hover:bg-foreground/10">
              <X className="size-3" />
            </button>
          </Badge>
        ))}
        {values.length === 0 && <span className="text-xs text-muted-foreground">None - every value scores half points</span>}
      </div>
      <Input
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
      />
    </div>
  );
}

function RangeInputs({
  label,
  min,
  max,
  onChange,
  money,
}: {
  label: string;
  min: number | null;
  max: number | null;
  onChange: (min: number | null, max: number | null) => void;
  money?: boolean;
}) {
  const fmt = (n: number | null) => (n === null ? "" : money ? formatMoney(n).replace("$", "") : String(n));
  const [lo, setLo] = useState(fmt(min));
  const [hi, setHi] = useState(fmt(max));
  const commit = () => onChange(parseCompactNumber(lo), parseCompactNumber(hi));
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <Input value={lo} onChange={(e) => setLo(e.target.value)} onBlur={commit} placeholder="Min" inputMode="decimal" />
        <span className="text-muted-foreground">–</span>
        <Input value={hi} onChange={(e) => setHi(e.target.value)} onBlur={commit} placeholder="Max" inputMode="decimal" />
      </div>
      {money && <p className="text-xs text-muted-foreground">Accepts 500K, 2.5M, 20000000</p>}
    </div>
  );
}

export function IcpForm() {
  const { data, error, mutate } = useSWR<ICP>("/icp");
  const { data: defaults } = useSWR<Record<string, number>>("/icp/defaults");
  const { mutate: globalMutate } = useSWRConfig();
  const [draft, setDraft] = useState<ICP | null>(null);
  const [saving, setSaving] = useState(false);

  const icp = draft ?? data;
  const dirty = draft !== null;
  const update = (patch: Partial<ICP>) => icp && setDraft({ ...icp, ...patch });
  const totalWeight = icp ? Object.values(icp.weights).reduce((a, b) => a + b, 0) : 0;
  const sales = icp?.mode === "sales";

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
  if (!icp) return <Skeleton className="m-6 h-[600px]" />;

  return (
    <div className="flex flex-col gap-4 p-4 pb-24 md:p-6">
      <PageTitle
        title="Scoring profile"
        description="Describe the companies you want. The Deal Signal Score ranks every lead against this profile and explains each point."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { mode: "acquisition" as const, icon: Handshake, title: "Acquisition sourcing", text: "Search funds & PE: favour succession signals, independence and longevity." },
          { mode: "sales" as const, icon: Briefcase, title: "B2B sales prospecting", text: "SDRs: favour buying triggers like hiring, outdated sites and missing CRM." },
        ].map((m) => (
          <button
            key={m.mode}
            type="button"
            onClick={() => update({ mode: m.mode })}
            className={cn("flex items-start gap-3 rounded-xl border p-4 text-left transition-colors", icp.mode === m.mode ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50")}
            aria-pressed={icp.mode === m.mode}
          >
            <m.icon className="mt-0.5 size-5 text-primary" />
            <div>
              <p className="font-medium">{m.title}</p>
              <p className="text-sm text-muted-foreground">{m.text}</p>
            </div>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Target market</CardTitle>
            <CardDescription>Leads outside your target industries are capped at 55; outside your geography at 70.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-1.5">
              <Label>Industries</Label>
              <TagInput values={icp.target_industries} onChange={(v) => update({ target_industries: v })} placeholder="Type an industry and press Enter" />
            </div>
            <div className="grid gap-1.5">
              <Label>States</Label>
              <TagInput values={icp.target_states} onChange={(v) => update({ target_states: v })} placeholder="TX, FL, GA…" upper />
            </div>
            <RangeInputs key={`e-${icp.updated_at}`} label="Employees" min={icp.min_employees} max={icp.max_employees} onChange={(a, b) => update({ min_employees: a, max_employees: b })} />
            <RangeInputs key={`r-${icp.updated_at}`} label="Annual revenue ($)" money min={icp.min_revenue} max={icp.max_revenue} onChange={(a, b) => update({ min_revenue: a, max_revenue: b })} />
            <div className="grid gap-1.5">
              <Label htmlFor="years">Minimum years in business</Label>
              <Input
                id="years"
                type="number"
                min={0}
                max={200}
                value={icp.min_years_in_business ?? ""}
                onChange={(e) => update({ min_years_in_business: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Weights
              <Button variant="ghost" size="sm" onClick={() => defaults && update({ weights: { ...defaults } })} disabled={!defaults}>
                <RotateCcw /> Reset
              </Button>
            </CardTitle>
            <CardDescription>How much each factor matters. These are relative, so they&apos;re scaled to add up to 100.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            {Object.entries(WEIGHT_META).map(([key, meta]) => {
              const w = icp.weights[key] ?? 0;
              const pct = totalWeight ? Math.round((w / totalWeight) * 100) : 0;
              return (
                <div key={key} className="grid gap-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{sales && meta.salesLabel ? meta.salesLabel : meta.label}</p>
                      <p className="text-xs text-muted-foreground">{sales && meta.salesHint ? meta.salesHint : meta.hint}</p>
                    </div>
                    <span className="shrink-0 text-sm font-medium tabular">{pct}%</span>
                  </div>
                  <Slider value={[w]} max={40} step={1} onValueChange={(v) => update({ weights: { ...icp.weights, [key]: v[0] ?? 0 } })} aria-label={meta.label} />
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <div
        className={cn(
          "fixed right-4 bottom-4 left-4 z-30 flex items-center justify-between gap-3 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur transition-all md:left-auto md:w-[440px]",
          dirty ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0",
        )}
      >
        <span className="text-sm">Unsaved changes</span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
            Discard
          </Button>
          <Button onClick={save} disabled={saving || totalWeight === 0}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />} Save & rescore all
          </Button>
        </div>
      </div>
    </div>
  );
}
