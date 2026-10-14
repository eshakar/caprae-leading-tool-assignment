"use client";

import {
  ArrowLeft,
  FileText,
  AtSign,
  BriefcaseBusiness,
  Camera,
  CirclePlay,
  Star,
  ThumbsUp,
  Building2,
  CalendarClock,
  Cpu,
  ExternalLink,
  Globe,
  Lightbulb,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Radar,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";

import { ActivityTimeline } from "@/components/leads/activity-timeline";
import { EditLeadSheet } from "@/components/leads/edit-lead-sheet";
import { FollowUpCard } from "@/components/leads/follow-up-card";
import { EmailStatusIcon, ScoreRing, StageBadge, TierBadge } from "@/components/leads/badges";
import { OutreachCopilot } from "@/components/leads/outreach-copilot";
import { ScoreBreakdown } from "@/components/leads/score-breakdown";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { isLeadDataKey, type Lead, leadsApi, STAGES, type Stage } from "@/lib/api";
import { formatMoney, formatNumber, location, timeAgo, yearsSince } from "@/lib/format";

// lucide v1 ships no brand logos, so each network gets a neutral, recognisable glyph.
const SOCIAL_ICONS: Record<string, typeof Globe> = {
  linkedin: BriefcaseBusiness,
  facebook: ThumbsUp,
  instagram: Camera,
  twitter: AtSign,
  youtube: CirclePlay,
  yelp: Star,
};

const SIGNAL_LABELS: { key: string; label: string; tone: "good" | "info" | "bad" }[] = [
  { key: "succession_language", label: "Succession / retirement language", tone: "good" },
  { key: "family_owned", label: "Family-owned", tone: "good" },
  { key: "owner_operated", label: "Owner-operated", tone: "good" },
  { key: "veteran_owned", label: "Veteran-owned", tone: "info" },
  { key: "woman_owned", label: "Woman-owned", tone: "info" },
  { key: "hiring", label: "Actively hiring", tone: "info" },
  { key: "has_online_booking", label: "Online booking", tone: "info" },
  { key: "stale_website", label: "Outdated website", tone: "info" },
  { key: "pe_backed", label: "PE-backed / part of a group", tone: "bad" },
];

function Fact({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

export function LeadDetail({ id }: { id: number }) {
  const router = useRouter();
  const { mutate: globalMutate } = useSWRConfig();
  const { data: lead, error, mutate } = useSWR<Lead>(Number.isFinite(id) ? `/leads/${id}` : null);
  const [enriching, setEnriching] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);

  // Lists, stats, the action center and this lead's timeline - everything except the detail we just set.
  const refreshLists = () => globalMutate((key) => key !== `/leads/${id}` && isLeadDataKey(key));

  async function save(patch: Parameters<typeof leadsApi.update>[1], message?: string) {
    if (!lead) return;
    try {
      const updated = await leadsApi.update(lead.id, patch);
      await mutate(updated, { revalidate: false });
      void refreshLists();
      if (message) toast.success(message);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function enrich() {
    if (!lead) return;
    setEnriching(true);
    const t = toast.loading(`Crawling ${lead.domain}…`);
    try {
      const updated = await leadsApi.enrich(lead.id);
      await mutate(updated, { revalidate: false });
      void refreshLists();
      if (updated.enrichment_status === "failed") toast.error(updated.enrichment_error ?? "Enrichment failed", { id: t });
      else if (updated.signals?.reserved_domain) toast.info(updated.enrichment_error ?? "Demo record", { id: t });
      else toast.success(`Found ${updated.emails.length} emails · ${updated.tech_stack.length} technologies · score ${updated.score}`, { id: t });
    } catch (err) {
      toast.error((err as Error).message, { id: t });
    } finally {
      setEnriching(false);
    }
  }

  async function remove() {
    if (!lead) return;
    try {
      await leadsApi.remove(lead.id);
      toast.success(`Deleted ${lead.company_name}`);
      void refreshLists();
      router.push("/leads");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  if (error) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>{error.status === 404 ? "Lead not found" : "Couldn't load this lead"}</AlertTitle>
          <AlertDescription>
            {error.message}{" "}
            <Link href="/leads" className="underline">
              Back to leads
            </Link>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="grid gap-4 p-4 md:p-6 lg:grid-cols-3">
        <Skeleton className="h-28 lg:col-span-3" />
        <Skeleton className="h-96 lg:col-span-2" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const yib = yearsSince(lead.founded_year);
  const signals = lead.signals ?? {};
  const activeSignals = SIGNAL_LABELS.filter((s) => signals[s.key] === true);
  const notesValue = notes ?? lead.notes ?? "";

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <title>{`${lead.company_name} · SaaSquatch Pro`}</title>
      <Button variant="ghost" size="sm" asChild className="w-fit">
        <Link href="/leads">
          <ArrowLeft /> All leads
        </Link>
      </Button>

      {/* Header */}
      <Card>
        <CardContent className="flex flex-col gap-4 md:flex-row md:items-center">
          <ScoreRing score={lead.score} tier={lead.score_tier} size={84} />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{lead.company_name}</h1>
              <TierBadge tier={lead.score_tier} />
              <StageBadge stage={lead.stage} />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {lead.website && (
                <a href={lead.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                  <Globe className="size-3.5" /> {lead.domain} <ExternalLink className="size-3" />
                </a>
              )}
              {lead.industry && <span>{lead.industry}</span>}
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" /> {location(lead.city, lead.state)}
              </span>
              <span>
                Enriched {timeAgo(lead.enriched_at)}
                {lead.enrichment_status === "failed" && " (failed)"}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={lead.stage} onValueChange={(v) => save({ stage: v as Stage }, `Moved to ${v}`)}>
              <SelectTrigger className="w-[130px]" aria-label="Stage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAGES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil /> Edit
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/leads/${lead.id}/memo`}>
                <FileText /> One-pager
              </Link>
            </Button>
            <Button onClick={enrich} disabled={enriching || !lead.domain}>
              {enriching ? <Loader2 className="animate-spin" /> : <Sparkles />} Enrich
            </Button>
            <Button variant="ghost" size="icon" onClick={remove} aria-label="Delete lead" className="text-destructive hover:text-destructive">
              <Trash2 />
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4">
        <Lightbulb className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-medium">Next best action</p>
          <p className="text-sm text-muted-foreground">{lead.next_action}</p>
        </div>
      </div>

      {lead.enrichment_status === "failed" && lead.enrichment_error && (
        <Alert>
          <Radar />
          <AlertTitle>Last enrichment didn&apos;t complete</AlertTitle>
          <AlertDescription>{lead.enrichment_error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle>Company</CardTitle>
              {lead.description && <CardDescription className="leading-relaxed">{lead.description}</CardDescription>}
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <Fact icon={Users} label="Employees" value={formatNumber(lead.employee_count)} />
              <Fact icon={Building2} label="Revenue" value={formatMoney(lead.revenue_usd)} />
              <Fact icon={CalendarClock} label="In business" value={yib !== null ? `${yib} yrs (since ${lead.founded_year})` : "—"} />
              <Fact icon={Users} label="Owner / decision maker" value={lead.owner_name ? `${lead.owner_name}${lead.owner_title ? ` · ${lead.owner_title}` : ""}` : "—"} />
              <Fact icon={Phone} label="Main phone" value={lead.phone ?? "—"} />
              <Fact icon={Globe} label="Source" value={<span className="capitalize">{lead.source}</span>} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contacts</CardTitle>
              <CardDescription>Emails are verified by syntax, disposable-domain list and live MX lookup.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {lead.emails.length === 0 ? (
                <p className="text-sm text-muted-foreground">No emails found yet. {lead.domain ? "Try enriching this lead." : "Add a website to enrich."}</p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {lead.emails.map((e) => (
                    <li key={e.email} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <EmailStatusIcon status={e.status} reason={e.reason} />
                      <a href={`mailto:${e.email}`} className="min-w-0 flex-1 truncate hover:underline">
                        {e.email}
                      </a>
                      {e.is_role && (
                        <Badge variant="outline" className="text-[10px]">
                          role
                        </Badge>
                      )}
                      <span className="hidden text-xs text-muted-foreground sm:inline">{e.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                {lead.phones.map((p) => (
                  <Button key={p} variant="outline" size="sm" asChild>
                    <a href={`tel:${p.replace(/[^\d+]/g, "")}`}>
                      <Phone /> {p}
                    </a>
                  </Button>
                ))}
                {Object.entries(lead.socials).map(([net, url]) => {
                  const Icon = SOCIAL_ICONS[net] ?? Globe;
                  return (
                    <Button key={net} variant="outline" size="sm" asChild>
                      <a href={url} target="_blank" rel="noopener noreferrer" className="capitalize">
                        <Icon /> {net}
                      </a>
                    </Button>
                  );
                })}
                {lead.emails.length > 0 && (
                  <Button variant="ghost" size="sm" asChild>
                    <a href={`mailto:${lead.emails[0].email}`}>
                      <Mail /> Email
                    </a>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Radar className="size-4" /> Signals
                </CardTitle>
                <CardDescription>Detected on the company&apos;s website</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {activeSignals.length === 0 && <p className="text-sm text-muted-foreground">No signals detected yet.</p>}
                {activeSignals.map((s) => (
                  <Badge
                    key={s.key}
                    variant="outline"
                    className={s.tone === "good" ? "border-success/30 bg-success/10 text-success" : s.tone === "bad" ? "border-hot/30 bg-hot/10 text-hot" : ""}
                  >
                    {s.label}
                    {s.key === "stale_website" && typeof signals.copyright_year === "number" ? ` (©${signals.copyright_year})` : ""}
                  </Badge>
                ))}
                {typeof signals.generation === "string" && (
                  <Badge variant="outline" className="border-success/30 bg-success/10 text-success capitalize">
                    {signals.generation} generation
                  </Badge>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Cpu className="size-4" /> Tech stack
                </CardTitle>
                <CardDescription>Useful for tailoring a pitch</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {lead.tech_stack.length === 0 && <p className="text-sm text-muted-foreground">Nothing detected.</p>}
                {lead.tech_stack.map((t) => (
                  <Badge key={t} variant="secondary">
                    {t}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={notesValue}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={() => {
                  if (notes !== null && notes !== (lead.notes ?? "")) void save({ notes }, "Notes saved");
                }}
                rows={4}
                placeholder="Call notes, objections, timing… (saved when you click away)"
              />
            </CardContent>
          </Card>
          <ActivityTimeline leadId={lead.id} />
        </div>

        <div className="space-y-4 lg:col-span-2">
          <FollowUpCard
            lead={lead}
            onChange={(iso) => save({ follow_up_at: iso }, iso ? "Follow-up scheduled" : "Follow-up cleared")}
          />
          <OutreachCopilot lead={lead} onContacted={() => lead.stage === "new" && save({ stage: "contacted" }, "Marked as contacted")} />
          <Card>
            <CardHeader>
              <CardTitle>Why this score?</CardTitle>
              <CardDescription>
                Explainable Deal Signal Score.{" "}
                <Link href="/settings" className="underline">
                  Tune the weights
                </Link>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScoreBreakdown factors={lead.score_breakdown} />
            </CardContent>
          </Card>
        </div>
      </div>

      <EditLeadSheet lead={lead} open={editOpen} onOpenChange={setEditOpen} onSaved={(l) => { void mutate(l, { revalidate: false }); void refreshLists(); }} />
    </div>
  );
}
