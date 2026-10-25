"use client";

import { ArrowRight, Command, Loader2, Sparkles, Upload, UserPlus } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useState, useSyncExternalStore } from "react";
import useSWR from "swr";

import { ASK_AI_EXAMPLES, useAskAI } from "@/components/ai/use-ask-ai";
import { openCommandPalette } from "@/components/command-palette";
import { ScoreRing } from "@/components/leads/badges";
import Aurora from "@/components/reactbits/Aurora";
import BlurText from "@/components/reactbits/BlurText";
import LeadConstellation from "@/components/reactbits/LeadConstellation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Stats } from "@/lib/api";

const subscribe = () => () => {};
const PROVIDER_LABEL: Record<string, string> = { anthropic: "Claude", gemini: "Gemini", xai: "Grok" };

export function Hero({ stats }: { stats?: Stats }) {
  const { resolvedTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const dark = mounted && resolvedTheme === "dark";
  const { data: ai } = useSWR<{ enabled: boolean; provider: string | null }>("/ai/status");
  const { ask, pending } = useAskAI();
  const [query, setQuery] = useState("");

  return (
    <section className="group/hero relative overflow-hidden rounded-2xl border bg-card">
      {/* Background layers: aurora glow, dotted grid, interactive lead constellation, legibility fade */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 opacity-60 dark:opacity-80">
          <Aurora colorStops={["#0d9488", "#f59e0b", "#14b8a6"]} amplitude={0.9} blend={0.6} speed={0.6} />
        </div>
        <div className="hero-grid absolute inset-0 opacity-60" />
        <div className="absolute inset-0">
          <LeadConstellation
            color={dark ? "rgba(94, 234, 212, 1)" : "rgba(13, 148, 136, 1)"}
            hotColor={dark ? "rgba(251, 191, 36, 1)" : "rgba(217, 119, 6, 1)"}
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-card/95 via-card/70 to-card/10" />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-card/80" />
      </div>

      <div className="relative grid gap-8 p-6 md:p-10 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-center">
        <div className="flex min-w-0 flex-col gap-4">
          <span className="flex w-fit items-center gap-2 rounded-full border bg-background/70 px-3 py-1 text-xs font-medium backdrop-blur">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-success" />
            </span>
            {ai?.enabled ? `AI Copilot online · ${PROVIDER_LABEL[ai.provider ?? ""] ?? "LLM"}` : "Built for search funds, PE operators & B2B sales teams"}
          </span>
          <BlurText
            text="Spend time on the leads that will actually close."
            className="max-w-2xl text-3xl font-semibold tracking-tight md:text-4xl"
            delay={60}
            animateBy="words"
          />
          <p className="max-w-2xl text-sm text-muted-foreground md:text-base">
            Every lead is enriched from its website, has its emails verified, and gets an explainable Deal Signal Score.
            Ask for what you want in plain English and the AI finds it, then drafts the first touch.
          </p>

          <form
            className="flex max-w-2xl items-center gap-2 rounded-xl border bg-background/80 p-1.5 shadow-sm backdrop-blur transition focus-within:border-primary/60 focus-within:ring-4 focus-within:ring-primary/15"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await ask(query)) setQuery("");
            }}
          >
            <Sparkles className="ml-2 size-4 shrink-0 text-primary" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask AI: hot HVAC companies in Texas we haven't contacted…"
              aria-label="Ask AI to find leads"
              className="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
            />
            <Button type="submit" size="sm" disabled={pending || query.trim().length < 2}>
              {pending ? <Loader2 className="animate-spin" /> : <ArrowRight />}
              <span className="hidden sm:inline">{pending ? "Thinking" : "Find leads"}</span>
            </Button>
          </form>
          <div className="flex flex-wrap items-center gap-2">
            {ASK_AI_EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                disabled={pending}
                onClick={() => ask(ex)}
                className="rounded-full border bg-background/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur transition hover:border-primary/50 hover:text-foreground disabled:opacity-50"
              >
                {ex}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button asChild size="sm" variant="outline" className="bg-background/70">
              <Link href="/leads?add=1">
                <UserPlus /> Add a company
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="bg-background/70">
              <Link href="/leads?import=1">
                <Upload /> Import CSV
              </Link>
            </Button>
            <button
              type="button"
              onClick={openCommandPalette}
              className="hidden items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground sm:flex"
            >
              or press
              <kbd className="inline-flex items-center gap-0.5 rounded border bg-background/80 px-1.5 py-0.5 font-mono text-[11px]">
                <Command className="size-3" />K / Ctrl K
              </kbd>
              anywhere
            </button>
          </div>
        </div>

        <div className="hidden rounded-xl border bg-background/70 p-4 shadow-sm backdrop-blur lg:block">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium">Strongest signals</p>
            <span className="text-[11px] text-muted-foreground">live</span>
          </div>
          <div className="space-y-1">
            {stats
              ? stats.top_leads.slice(0, 4).map((l) => (
                  <Link
                    key={l.id}
                    href={`/leads/${l.id}`}
                    className="flex items-center gap-3 rounded-lg p-1.5 transition-colors hover:bg-muted/70"
                  >
                    <ScoreRing score={l.score} tier={l.score_tier} size={34} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{l.company_name}</p>
                      <p className="truncate text-xs text-muted-foreground">{[l.industry, l.state].filter(Boolean).join(" · ")}</p>
                    </div>
                  </Link>
                ))
              : Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11" />)}
          </div>
          <p className="mt-3 border-t pt-3 text-[11px] leading-relaxed text-muted-foreground">
            Move your cursor over the background: each dot is a company, amber ones are hot leads.
          </p>
        </div>
      </div>
    </section>
  );
}
