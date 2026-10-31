"use client";

import { BadgeCheck, Bot, Building2, ExternalLink, FileText, Link2, Loader2, Mail, PenLine, Phone, Radar, Send, Terminal } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";

import { Skeleton } from "@/components/ui/skeleton";
import { type Lead, leadsApi, type OutreachDraft } from "@/lib/api";
import { cn } from "@/lib/utils";

const SIGNAL_LABELS: Record<string, string> = {
  succession_language: "Succession / retirement language",
  family_owned: "Family-owned",
  owner_operated: "Owner-operated",
  hiring: "Currently hiring",
  veteran_owned: "Veteran-owned",
  woman_owned: "Woman-owned",
  pe_backed: "PE-backed",
  has_online_booking: "Online booking",
  stale_website: "Outdated website",
  copyright_year: "Site copyright",
  generation: "Generation",
};
const HIDDEN_SIGNALS = new Set(["sample"]);

function initials(name: string | null) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function signalList(signals: Record<string, unknown>) {
  return Object.entries(signals)
    .filter(([k]) => !HIDDEN_SIGNALS.has(k))
    .filter(([, v]) => v === true || (typeof v === "string" && v) || (typeof v === "number" && v > 0))
    .map(([k, v]) => {
      const label = SIGNAL_LABELS[k] ?? k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
      return typeof v === "string" || typeof v === "number" ? `${label}: ${v}` : label;
    });
}

/** Right-hand preview of the selected lead: score breakdown, principal, signals and the latest Copilot draft. */
export function LeadDossier({ id }: { id: number | null }) {
  const { data: lead } = useSWR<Lead>(id ? `/leads/${id}` : null);
  const { data: drafts, mutate } = useSWR<OutreachDraft[]>(id ? `/leads/${id}/outreach` : null);
  const [busy, setBusy] = useState(false);

  if (!id) {
    return (
      <div className="rounded-2xl bg-card p-5 text-sm text-muted-foreground shadow-2xl">Select a lead to see its dossier.</div>
    );
  }
  if (!lead) return <Skeleton className="h-[640px] rounded-2xl" />;

  const draft = drafts?.[0];
  const validEmail = lead.emails.find((e) => e.status === "valid");
  const bestEmail = validEmail ?? lead.emails.find((e) => e.status === "risky");
  const factors = lead.score_breakdown.filter((f) => f.key !== "knockout" && f.max > 0).sort((a, b) => b.max - a.max).slice(0, 5);
  const knock = lead.score_breakdown.find((f) => f.key === "knockout");
  const signals = signalList(lead.signals ?? {});

  async function generate() {
    if (!lead) return;
    setBusy(true);
    try {
      const d = await leadsApi.outreach(lead.id, { goal: "acquisition", tone: "warm" });
      await mutate([d, ...(drafts ?? [])], { revalidate: false });
      toast.success(d.generator === "template" ? "Draft created from template" : "Draft written by AI");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const mailto =
    draft && bestEmail ? `mailto:${bestEmail.email}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.email_body)}` : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 rounded-2xl bg-card p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber/20 text-gold">
              <Building2 className="size-6" />
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="font-mono text-[11px] font-bold tracking-wider text-gold uppercase">Active selection</span>
              <h2 className="truncate font-heading leading-tight font-bold">{lead.company_name}</h2>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Link href={`/leads/${lead.id}/memo`} title="Printable one-pager" className="rounded-md p-1 text-outline transition-colors hover:bg-surface-card hover:text-foreground">
              <FileText className="size-[18px]" />
            </Link>
            <Link href={`/leads/${lead.id}`} title="Open full workspace" className="rounded-md p-1 text-outline transition-colors hover:bg-surface-card hover:text-foreground">
              <ExternalLink className="size-[18px]" />
            </Link>
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-xl bg-surface-card p-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] text-outline uppercase">Deal Signal breakdown</span>
            <span className={cn("font-mono text-[13px] font-bold", lead.score_tier === "hot" ? "text-emerald" : lead.score_tier === "warm" ? "text-cyan-soft" : "text-cold")}>
              {lead.score}/100 · {lead.score_tier}
            </span>
          </div>
          {factors.map((f) => (
            <div key={f.key} className="space-y-0.5">
              <div className="flex justify-between font-mono text-[11px]">
                <span className="text-muted-foreground">{f.label}</span>
                <span className="font-bold tabular">
                  {f.points.toFixed(0)}/{f.max.toFixed(0)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-card">
                <div className="h-full rounded-full bg-gradient-to-r from-amber to-gold" style={{ width: `${(f.points / f.max) * 100}%` }} />
              </div>
            </div>
          ))}
          {knock && <p className="font-mono text-[11px] text-destructive">Fit gate: {knock.reason}</p>}
        </div>

        <div className="flex flex-col gap-1 rounded-xl bg-surface-card p-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] text-outline uppercase">Primary principal</span>
            {validEmail && <span className="rounded bg-emerald/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald">Email verified</span>}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-amber/20 font-heading font-bold text-gold">{initials(lead.owner_name)}</div>
            <div className="flex min-w-0 flex-col">
              <span className="font-heading leading-tight font-bold">{lead.owner_name ?? "Owner not identified yet"}</span>
              <span className="text-xs text-muted-foreground">{lead.owner_title ?? "Enrich to find the decision maker"}</span>
              {lead.founded_year && <span className="font-mono text-[11px] text-outline">Company founded {lead.founded_year}</span>}
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <div className="flex min-w-0 items-center gap-1.5 rounded bg-card p-1.5 font-mono text-[11px]">
              <Phone className="size-3.5 shrink-0 text-emerald" />
              <span className="truncate">{lead.phone ?? lead.phones[0] ?? "No phone"}</span>
            </div>
            <div className="flex min-w-0 items-center gap-1.5 rounded bg-card p-1.5 font-mono text-[11px]">
              <Link2 className="size-3.5 shrink-0 text-cyan" />
              {lead.linkedin_url ? (
                <a href={lead.linkedin_url} target="_blank" rel="noopener noreferrer" className="truncate hover:underline">
                  LinkedIn
                </a>
              ) : (
                <span className="truncate text-outline">No LinkedIn</span>
              )}
            </div>
            <div className="col-span-2 flex min-w-0 items-center gap-1.5 rounded bg-card p-1.5 font-mono text-[11px]">
              <Mail className="size-3.5 shrink-0 text-gold" />
              <span className="truncate">{bestEmail?.email ?? "No email yet"}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1 rounded-xl bg-surface-card p-3">
          <span className="font-mono text-[11px] text-outline uppercase">Detected signals</span>
          <div className="mt-1 flex flex-col gap-2">
            <div className="flex items-start gap-2">
              <Radar className="mt-0.5 size-4 shrink-0 text-gold" />
              <div className="flex flex-col">
                <span className="text-xs font-semibold">From the company website</span>
                <span className="text-[11px] text-muted-foreground">{signals.length ? signals.join(" · ") : "No signals detected yet"}</span>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Terminal className="mt-0.5 size-4 shrink-0 text-cyan" />
              <div className="flex flex-col">
                <span className="text-xs font-semibold">Tech stack</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {lead.tech_stack.length ? (
                    lead.tech_stack.map((t) => (
                      <span key={t} className="rounded bg-card px-1.5 py-0.5 font-mono text-[11px] text-outline">
                        {t}
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] text-muted-foreground">None detected</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="relative flex flex-col gap-2 rounded-xl bg-surface-high p-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-mono text-[11px] font-bold text-cyan uppercase">
              <Bot className="size-4" /> Copilot drafted intro
            </span>
            {draft && <span className="font-mono text-[11px] text-outline">{draft.generator === "template" ? "template" : draft.generator}</span>}
          </div>
          {draft ? (
            <>
              <div className="flex flex-col gap-1.5 rounded-lg bg-background p-2.5 shadow-inner">
                <div className="font-mono text-[11px] text-outline">Subject: {draft.subject}</div>
                <p className="line-clamp-5 text-xs leading-relaxed whitespace-pre-line">{draft.email_body}</p>
              </div>
              {draft.personalization_points.length > 0 && (
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-[11px] text-outline uppercase">Grounded in:</span>
                  <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                    {draft.personalization_points.slice(0, 3).map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex items-center gap-1.5 pt-0.5">
                {mailto ? (
                  <a
                    href={mailto}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-amber py-2 text-xs font-semibold text-primary-foreground shadow-md transition-colors hover:bg-gold"
                  >
                    <Send className="size-4" /> Open in mail
                  </a>
                ) : (
                  <span className="flex flex-1 items-center justify-center rounded-md bg-card py-2 text-xs text-muted-foreground">No email to send to</span>
                )}
                <Link
                  href={`/leads/${lead.id}#copilot`}
                  className="flex items-center justify-center gap-1 rounded-md bg-surface-card px-3 py-2 text-xs transition-colors hover:bg-card"
                >
                  <PenLine className="size-4" /> Refine
                </Link>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={generate}
              disabled={busy}
              className="flex items-center justify-center gap-1.5 rounded-md bg-amber py-2 text-xs font-semibold text-primary-foreground shadow-md transition-colors hover:bg-gold disabled:opacity-70"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
              {busy ? "Writing…" : "Generate a grounded intro"}
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between px-2 font-mono text-[11px] text-outline">
        <span>
          Lead #{lead.id} · source: {lead.source}
        </span>
        <Link href={`/leads/${lead.id}`} className="flex items-center gap-1 transition-colors hover:text-gold">
          Activity log <BadgeCheck className="size-3" />
        </Link>
      </div>
    </div>
  );
}
