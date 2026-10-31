"use client";

import { Bot, Building2, FileUp, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";

import { ASK_AI_EXAMPLES, useAskAI } from "@/components/ai/use-ask-ai";
import { openCommandPalette } from "@/components/command-palette";
import { SignalRadar } from "@/components/dashboard/signal-radar";
import BlurText from "@/components/reactbits/BlurText";
import type { LeadPage, Stats } from "@/lib/api";

const PIPELINE_KEY = "/leads?page_size=200&sort=-score";

export function Hero({ stats }: { stats?: Stats }) {
  const { ask, pending } = useAskAI();
  const [query, setQuery] = useState("");
  const { data: all } = useSWR<LeadPage>(PIPELINE_KEY);

  async function run(q: string) {
    setQuery(q);
    if (await ask(q)) setQuery("");
  }

  return (
    <section className="relative w-full overflow-hidden rounded-xl bg-card p-5 shadow-xl lg:p-8">
      <div className="pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-amber/10 blur-[90px]" />
      <div className="pointer-events-none absolute bottom-0 -left-20 size-64 rounded-full bg-cyan/5 blur-[80px]" />

      <div className="relative z-10 grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
        <div className="flex flex-col gap-5 lg:col-span-7">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-card px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-gold">
              <span className="inline-block size-1.5 animate-ping rounded-full bg-gold" />
              AI sourcing engine
            </span>
            <span className="font-mono text-[11px] font-bold text-outline">
              {stats ? `${stats.enriched} of ${stats.total} leads enriched from their websites` : "Loading pipeline…"}
            </span>
          </div>

          <div className="space-y-1">
            <h1 className="font-heading text-3xl leading-none font-bold tracking-tight md:text-[2.5rem] md:leading-[1.1]">
              Built for search funds, PE operators <span className="text-amber-soft">&amp; B2B sales teams</span>
            </h1>
            <BlurText
              text="Spend time on the leads that will actually close."
              className="pt-2 font-heading text-xl font-semibold text-gold"
              delay={60}
              animateBy="words"
            />
            <p className="max-w-2xl pt-1 text-sm leading-relaxed text-muted-foreground">
              Every lead is enriched from its website, has its emails verified, and gets an explainable Deal Signal Score.
              Ask for what you want in plain English and the AI finds it, then drafts the first touch.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <form
              className="group relative flex w-full items-center rounded-md bg-background shadow-inner ring-cyan/40 transition focus-within:ring-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(query);
              }}
            >
              <Bot className="absolute left-3.5 size-[22px] text-gold" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find leads with AI… e.g. hot HVAC companies in Texas we haven't contacted"
                aria-label="Ask AI to find leads"
                className="w-full bg-transparent py-3.5 pr-32 pl-12 text-sm outline-none placeholder:text-outline"
              />
              <button
                type="submit"
                disabled={pending || query.trim().length < 2}
                className="absolute right-2 flex items-center gap-1.5 rounded bg-amber px-3 py-1.5 font-heading text-[11px] font-bold tracking-wider text-primary-foreground uppercase shadow-sm transition-colors hover:bg-gold disabled:opacity-60"
              >
                {pending && <Loader2 className="size-3.5 animate-spin" />}
                {pending ? "Thinking" : "Find leads"}
              </button>
            </form>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="mr-1 font-mono text-[11px] font-bold tracking-wider text-outline uppercase">Suggested:</span>
              {ASK_AI_EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  disabled={pending}
                  onClick={() => run(ex)}
                  className="rounded-full bg-surface-card px-2.5 py-1 text-left font-mono text-[11px] font-bold transition-colors hover:bg-surface-high disabled:opacity-50"
                >
                  &ldquo;{ex}&rdquo;
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link
              href="/leads?add=1"
              className="flex items-center gap-1.5 rounded-md bg-amber px-5 py-2.5 font-heading text-sm font-semibold text-primary-foreground shadow-lg shadow-amber/20 transition-colors hover:bg-gold"
            >
              <Building2 className="size-5" /> Add a company
            </Link>
            <Link
              href="/leads?import=1"
              className="flex items-center gap-1.5 rounded-md bg-surface-card px-4 py-2.5 font-heading text-sm font-semibold transition-colors hover:bg-surface-high"
            >
              <FileUp className="size-5" /> Import CSV
            </Link>
            <button
              type="button"
              onClick={openCommandPalette}
              className="flex items-center gap-1.5 font-mono text-[11px] font-bold text-outline transition-colors hover:text-foreground"
            >
              or press <kbd className="rounded bg-surface-card px-1.5 py-0.5 text-gold">⌘K / Ctrl K</kbd> anywhere
            </button>
          </div>
        </div>

        <div className="relative flex h-full min-h-[340px] w-full flex-col overflow-hidden rounded-md bg-surface-card p-3 shadow-inner lg:col-span-5">
          <div className="z-10 flex items-center justify-between pb-2">
            <div className="flex items-center gap-1.5">
              <span className="font-heading font-semibold">Strongest signals</span>
              <span className="flex items-center gap-1 rounded bg-emerald/20 px-1.5 py-0.5 font-mono text-[11px] font-bold tracking-wider text-emerald uppercase">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald" /> live
              </span>
            </div>
            <span className="font-mono text-[11px] font-bold text-outline">Real-time cluster map</span>
          </div>
          <p className="z-10 pb-1.5 text-xs text-muted-foreground">
            Hover the map: each dot is a company in your pipeline, amber ones are hot leads. Click one to open it.
          </p>
          <SignalRadar leads={all?.items} />
        </div>
      </div>
    </section>
  );
}
