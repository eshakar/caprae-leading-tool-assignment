"use client";

import { BriefcaseBusiness, Check, Copy, History, Loader2, Mail, Phone, Reply, Send, Sparkles } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import useSWR from "swr";

import ShinyText from "@/components/reactbits/ShinyText";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { type Lead, leadsApi, type OutreachDraft } from "@/lib/api";
import { timeAgo } from "@/lib/format";

const SENDER_KEY = "saasquatch.sender_context";

// Per-viewer convenience: remember "who I am" between leads. Storage can be unavailable (private mode).
const senderStore = {
  get(): string {
    try {
      return localStorage.getItem(SENDER_KEY) ?? "";
    } catch {
      return "";
    }
  },
  set(v: string) {
    try {
      localStorage.setItem(SENDER_KEY, v);
    } catch {
      /* ignore */
    }
  },
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Clipboard is not available");
        }
      }}
    >
      {copied ? <Check /> : <Copy />} {copied ? "Copied" : label}
    </Button>
  );
}

function DraftBlock({ text }: { text: string }) {
  return <pre className="max-h-80 overflow-auto rounded-lg bg-muted/50 p-4 font-sans text-sm leading-relaxed whitespace-pre-wrap">{text}</pre>;
}

const noopSubscribe = () => () => {};

export function OutreachCopilot({ lead, onContacted }: { lead: Lead; onContacted: () => void }) {
  const { data: history, mutate } = useSWR<OutreachDraft[]>(`/leads/${lead.id}/outreach`);
  const { data: ai } = useSWR<{ enabled: boolean; provider: string | null; model: string | null }>("/ai/status");
  const storedSender = useSyncExternalStore(noopSubscribe, senderStore.get, () => "");
  const [goal, setGoal] = useState("acquisition");
  const [tone, setTone] = useState("warm");
  const [sender, setSender] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const senderValue = sender ?? storedSender;
  const draft = history?.find((d) => d.id === selectedId) ?? history?.[0];
  const bestEmail = lead.emails.find((e) => e.status === "valid")?.email ?? lead.emails.find((e) => e.status === "risky")?.email;

  async function generate() {
    setBusy(true);
    senderStore.set(senderValue);
    try {
      const d = await leadsApi.outreach(lead.id, { goal, tone, sender_context: senderValue.trim() || undefined });
      await mutate();
      setSelectedId(d.id);
      toast.success(d.generator === "template" ? "Draft created from template" : "Personalized draft ready");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const mailto =
    draft && bestEmail
      ? `mailto:${bestEmail}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.email_body)}`
      : undefined;

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <ShinyText text="AI Outreach Copilot" speed={3} className="font-semibold" />
        </CardTitle>
        <CardDescription>
          Writes the first touch from facts we found about this company, never made-up claims.{" "}
          {ai && !ai.enabled && "Running in template mode (add ANTHROPIC_API_KEY, GEMINI_API_KEY or XAI_API_KEY to the API to use an LLM)."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Goal</Label>
            <Select value={goal} onValueChange={setGoal}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="acquisition">Acquisition / succession</SelectItem>
                <SelectItem value="sales">Sell a product or service</SelectItem>
                <SelectItem value="partnership">Partnership / referrals</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Tone</Label>
            <Select value={tone} onValueChange={setTone}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="warm">Warm</SelectItem>
                <SelectItem value="direct">Direct</SelectItem>
                <SelectItem value="formal">Formal</SelectItem>
                <SelectItem value="casual">Casual</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="sender">About you (optional, remembered on this device)</Label>
          <Textarea
            id="sender"
            value={senderValue}
            onChange={(e) => setSender(e.target.value)}
            maxLength={600}
            rows={2}
            placeholder="e.g. Jane Smith, a searcher backed by 12 operators, focused on home services in the Southeast"
          />
        </div>
        <Button onClick={generate} disabled={busy} className="w-full">
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {busy ? "Writing…" : draft ? "Generate a new version" : "Generate outreach"}
        </Button>

        {draft && (
          <div className="space-y-3 border-t pt-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary">{draft.generator === "template" ? "Template" : draft.generator}</Badge>
              <span className="capitalize">
                {draft.goal} · {draft.tone}
              </span>
              <span>· {timeAgo(draft.created_at)}</span>
            </div>
            {draft.personalization_points.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {draft.personalization_points.map((p) => (
                  <Badge key={p} variant="outline" className="font-normal">
                    {p}
                  </Badge>
                ))}
              </div>
            )}
            <Tabs defaultValue="email">
              <TabsList className="w-full">
                <TabsTrigger value="email">
                  <Mail /> Email
                </TabsTrigger>
                <TabsTrigger value="linkedin">
                  <BriefcaseBusiness /> LinkedIn
                </TabsTrigger>
                <TabsTrigger value="call">
                  <Phone /> Call
                </TabsTrigger>
                <TabsTrigger value="follow">
                  <Reply /> Follow-up
                </TabsTrigger>
              </TabsList>
              <TabsContent value="email" className="space-y-2">
                <p className="text-sm">
                  <span className="text-muted-foreground">Subject:</span> <span className="font-medium">{draft.subject}</span>
                </p>
                <DraftBlock text={draft.email_body} />
                <div className="flex flex-wrap gap-2">
                  <CopyButton text={`Subject: ${draft.subject}\n\n${draft.email_body}`} label="Copy email" />
                  {mailto ? (
                    <Button size="sm" asChild onClick={onContacted}>
                      <a href={mailto}>
                        <Send /> Open in mail & mark contacted
                      </a>
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={onContacted}>
                      Mark as contacted
                    </Button>
                  )}
                </div>
              </TabsContent>
              <TabsContent value="linkedin" className="space-y-2">
                <DraftBlock text={draft.linkedin_note} />
                <div className="flex items-center justify-between">
                  <CopyButton text={draft.linkedin_note} label="Copy note" />
                  <span className="text-xs text-muted-foreground tabular">{draft.linkedin_note.length}/300</span>
                </div>
              </TabsContent>
              <TabsContent value="call" className="space-y-2">
                <DraftBlock text={draft.call_opener} />
                <CopyButton text={draft.call_opener} label="Copy opener" />
              </TabsContent>
              <TabsContent value="follow" className="space-y-2">
                <DraftBlock text={draft.follow_up} />
                <CopyButton text={draft.follow_up} label="Copy follow-up" />
              </TabsContent>
            </Tabs>
          </div>
        )}

        {history && history.length > 1 && (
          <div className="space-y-1 border-t pt-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <History className="size-3.5" /> Previous drafts
            </p>
            {history.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setSelectedId(d.id)}
                className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted ${draft?.id === d.id ? "bg-muted" : ""}`}
              >
                <span className="truncate">{d.subject}</span>
                <span className="ml-2 shrink-0 text-muted-foreground">{timeAgo(d.created_at)}</span>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
