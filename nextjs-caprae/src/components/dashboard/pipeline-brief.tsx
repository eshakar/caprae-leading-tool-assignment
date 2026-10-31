"use client";

import { AlertTriangle, CheckCircle2, Hourglass, Loader2, Rocket, Sparkles, Target, Zap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import ShinyText from "@/components/reactbits/ShinyText";
import { aiApi, type PipelineBrief as Brief } from "@/lib/api";

const TILE_STYLES = [
  { icon: AlertTriangle, tone: "text-gold" },
  { icon: Rocket, tone: "text-cyan" },
  { icon: Hourglass, tone: "text-indigo" },
  { icon: Target, tone: "text-emerald" },
];

/** On-demand AI morning brief: generated only when asked, so the dashboard never waits on a model. */
export function PipelineBrief() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [at, setAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    try {
      setBrief(await aiApi.brief());
      setAt(new Date());
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex flex-col justify-between overflow-hidden rounded-xl bg-card p-5 shadow-lg lg:col-span-8">
      <div className="pointer-events-none absolute -right-16 -bottom-16 size-56 rounded-full bg-indigo/5 blur-3xl" />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-md bg-surface-card text-cyan">
              <Sparkles className="size-5" />
            </div>
            <div>
              <h2 className="font-heading font-semibold">
                <ShinyText text="AI Pipeline Brief" speed={3} />
              </h2>
              <span className="font-mono text-[11px] font-bold text-indigo uppercase">Grounded analytical memo</span>
            </div>
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-md bg-surface-card px-3 py-1.5 font-heading text-xs font-semibold text-gold shadow-sm transition-colors hover:bg-surface-high disabled:opacity-70"
          >
            {loading ? <Loader2 className="size-[18px] animate-spin" /> : brief ? <CheckCircle2 className="size-[18px] text-emerald" /> : <Zap className="size-[18px]" />}
            {loading ? "Synthesizing…" : brief ? "Regenerate brief" : "Generate brief"}
          </button>
        </div>
        <p className="font-heading leading-snug font-semibold text-gold">
          {brief?.headline ?? "A 30-second read on your pipeline: what needs attention and what to do first. Grounded only in your own data."}
        </p>
        {!brief && (
          <p className="text-xs text-muted-foreground">
            The AI reads your scores, stages, follow-ups and top leads, then writes your priorities for today.
          </p>
        )}
      </div>

      <div className="mt-4 space-y-2 rounded-md bg-surface-card p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 font-mono text-[11px] font-bold tracking-wider text-emerald uppercase">
            <span className="size-2 rounded-full bg-emerald" />
            {brief && at
              ? `Intelligence memo • synthesized ${at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : "Intelligence memo • not generated yet"}
          </span>
          <span className="font-mono text-[11px] font-bold text-outline">
            {brief ? (brief.generator === "rules" ? "rule-based fallback" : brief.generator) : "click Generate brief"}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 pt-1 md:grid-cols-3">
          {brief
            ? brief.insights.slice(0, 3).map((ins, i) => {
                const { icon: Icon, tone } = TILE_STYLES[i % TILE_STYLES.length];
                return (
                  <div key={i} className="flex flex-col justify-between gap-1.5 rounded bg-card p-2.5">
                    <div className={`flex items-center gap-1 font-heading text-[11px] font-bold uppercase ${tone}`}>
                      <Icon className="size-4 shrink-0" />
                      <span className="line-clamp-2">
                        {i + 1}. {ins.title}
                      </span>
                    </div>
                    <p className="text-xs leading-snug">{ins.detail}</p>
                    {ins.lead_id > 0 && (
                      <Link href={`/leads/${ins.lead_id}`} className="font-mono text-[11px] font-bold text-cyan-soft hover:underline">
                        Open lead →
                      </Link>
                    )}
                  </div>
                );
              })
            : TILE_STYLES.slice(0, 3).map(({ icon: Icon, tone }, i) => (
                <div key={i} className="flex flex-col gap-2 rounded bg-card p-2.5">
                  <div className={`flex items-center gap-1 font-heading text-[11px] font-bold uppercase ${tone}`}>
                    <Icon className="size-4" />
                    <span>{["Needs attention", "Hot & untouched", "Cadence"][i]}</span>
                  </div>
                  <div className={loading ? "h-8 animate-pulse rounded bg-surface-card" : "h-8 rounded bg-surface-card/60"} />
                </div>
              ))}
        </div>
        {brief && (
          <p className="flex items-start gap-2 pt-1 text-xs">
            <Target className="mt-0.5 size-4 shrink-0 text-gold" />
            <span>
              <span className="font-semibold text-gold">Focus today: </span>
              {brief.focus_today}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
