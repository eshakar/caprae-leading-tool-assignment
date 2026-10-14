"use client";

import { ArrowLeft, CircleAlert, CircleCheck, Printer } from "lucide-react";
import Link from "next/link";
import useSWR from "swr";

import { ScoreRing, TierBadge } from "@/components/leads/badges";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Lead } from "@/lib/api";
import { formatDate, formatMoney, formatNumber, location, yearsSince } from "@/lib/format";

const SIGNALS: [string, string][] = [
  ["succession_language", "Succession / retirement language on website"],
  ["family_owned", "Family-owned"],
  ["owner_operated", "Owner-operated"],
  ["veteran_owned", "Veteran-owned"],
  ["woman_owned", "Woman-owned"],
  ["hiring", "Actively hiring"],
  ["has_online_booking", "Online booking"],
  ["stale_website", "Outdated website"],
  ["pe_backed", "Appears PE-backed / part of a group"],
];

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3 print:break-inside-avoid">
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 print:break-inside-avoid">
      <h2 className="border-b pb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  );
}

/**
 * One-page target profile a searcher can save as PDF and share with investors or partners:
 * the snapshot, why it ranks where it does, the risks, and how to reach the owner.
 */
export function LeadMemo({ id }: { id: number }) {
  const { data: lead, error } = useSWR<Lead>(Number.isFinite(id) ? `/leads/${id}` : null);

  if (error) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load this lead</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      </div>
    );
  }
  if (!lead) return <Skeleton className="m-6 h-[800px]" />;

  const yib = yearsSince(lead.founded_year);
  const strengths = lead.score_breakdown.filter((f) => f.sentiment === "positive");
  const risks = lead.score_breakdown.filter((f) => f.sentiment === "negative");
  const signals = SIGNALS.filter(([k]) => lead.signals?.[k] === true).map(([, label]) => label);
  const bestEmail = lead.emails.find((e) => e.status === "valid") ?? lead.emails.find((e) => e.status === "risky");
  const today = new Date().toISOString();

  return (
    <div className="p-4 md:p-6 print:p-0">
      <title>{`${lead.company_name} · Target profile`}</title>
      <div className="mx-auto mb-4 flex max-w-[820px] items-center justify-between print:hidden">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/leads/${lead.id}`}>
            <ArrowLeft /> Back to lead
          </Link>
        </Button>
        <Button onClick={() => window.print()}>
          <Printer /> Print / Save as PDF
        </Button>
      </div>

      <article className="mx-auto max-w-[820px] space-y-6 rounded-xl border bg-card p-8 shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6">
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-semibold tracking-wider text-primary uppercase">Target profile</p>
            <h1 className="text-3xl font-semibold tracking-tight">{lead.company_name}</h1>
            <p className="text-sm text-muted-foreground">
              {[lead.industry, location(lead.city, lead.state), lead.domain].filter((v) => v && v !== "—").join(" · ")}
            </p>
            {lead.description && <p className="max-w-xl pt-2 text-sm leading-relaxed">{lead.description}</p>}
          </div>
          <div className="flex shrink-0 flex-col items-center gap-2">
            <ScoreRing score={lead.score} tier={lead.score_tier} size={88} />
            <TierBadge tier={lead.score_tier} />
            <span className="text-[11px] text-muted-foreground">Deal Signal Score</span>
          </div>
        </header>

        <Section title="Snapshot">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Employees" value={formatNumber(lead.employee_count)} />
            <Stat label="Annual revenue" value={formatMoney(lead.revenue_usd)} />
            <Stat label="In business" value={yib !== null ? `${yib} years (est. ${lead.founded_year})` : "—"} />
            <Stat label="Owner" value={lead.owner_name ? `${lead.owner_name}${lead.owner_title ? `, ${lead.owner_title}` : ""}` : "—"} />
            <Stat label="Pipeline stage" value={<span className="capitalize">{lead.stage}</span>} />
            <Stat label="Next follow-up" value={lead.follow_up_at ? formatDate(lead.follow_up_at, true) : "—"} />
          </div>
        </Section>

        <div className="grid gap-6 sm:grid-cols-2">
          <Section title="Why it fits">
            {strengths.length === 0 ? (
              <p className="text-sm text-muted-foreground">No strong fit signals yet.</p>
            ) : (
              <ul className="space-y-2">
                {strengths.map((f) => (
                  <li key={f.key} className="flex gap-2 text-sm">
                    <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
                    <span>
                      <span className="font-medium">{f.label}:</span> {f.reason}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Risks & gaps to diligence">
            {risks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No red flags from available data.</p>
            ) : (
              <ul className="space-y-2">
                {risks.map((f) => (
                  <li key={f.key} className="flex gap-2 text-sm">
                    <CircleAlert className="mt-0.5 size-4 shrink-0 text-hot" />
                    <span>
                      <span className="font-medium">{f.label}:</span> {f.reason}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <Section title="Signals detected">
            <div className="flex flex-wrap gap-1.5">
              {signals.length ? signals.map((s) => <Badge key={s} variant="outline">{s}</Badge>) : <p className="text-sm text-muted-foreground">None detected.</p>}
            </div>
          </Section>
          <Section title="Technology">
            <div className="flex flex-wrap gap-1.5">
              {lead.tech_stack.length ? (
                lead.tech_stack.map((t) => (
                  <Badge key={t} variant="secondary">
                    {t}
                  </Badge>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Nothing detected.</p>
              )}
            </div>
          </Section>
        </div>

        <Section title="How to reach them">
          <div className="grid gap-1 text-sm sm:grid-cols-2">
            <p>
              <span className="text-muted-foreground">Email: </span>
              {bestEmail ? `${bestEmail.email} (${bestEmail.status})` : "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Phone: </span>
              {lead.phone ?? lead.phones[0] ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Website: </span>
              {lead.website ?? "—"}
            </p>
            <p className="truncate">
              <span className="text-muted-foreground">LinkedIn: </span>
              {lead.linkedin_url ?? lead.socials.linkedin ?? "—"}
            </p>
          </div>
        </Section>

        {lead.notes && (
          <Section title="Notes">
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{lead.notes}</p>
          </Section>
        )}

        <footer className="border-t pt-3 text-[11px] text-muted-foreground">
          Prepared {formatDate(today, true)} with SaaSquatch Pro. Data comes from the company&apos;s public website
          {lead.enriched_at ? ` (last checked ${formatDate(lead.enriched_at, true)})` : ""} and user input. Verify it before relying on it.
        </footer>
      </article>
    </div>
  );
}
