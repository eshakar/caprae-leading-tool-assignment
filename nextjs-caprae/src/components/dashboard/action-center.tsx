"use client";

import Link from "next/link";
import useSWR from "swr";

import { GlowCard } from "@/components/glow-card";
import CountUp from "@/components/reactbits/CountUp";
import { Skeleton } from "@/components/ui/skeleton";
import type { ActionCard, Actions } from "@/lib/api";
import { relativeDay } from "@/lib/format";
import { cn } from "@/lib/utils";

function Queue({
  label,
  tone,
  dot,
  ping,
  title,
  hint,
  items,
  meta,
  cta,
  ctaClass,
  href,
  empty,
}: {
  label: string;
  tone: string;
  dot: string;
  ping?: boolean;
  title: string;
  hint: string;
  items: ActionCard[] | undefined;
  meta: (i: ActionCard) => string;
  cta: string;
  ctaClass: string;
  href: (i: ActionCard) => string;
  empty: string;
}) {
  const first = items?.[0];
  return (
    <GlowCard className="flex flex-col justify-between border-transparent shadow-md">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className={cn("flex items-center gap-1.5 font-mono text-[11px] font-bold tracking-wider uppercase", tone)}>
            <span className={cn("size-2 rounded-full", dot, ping && "animate-ping")} />
            {label}
          </span>
          <span className={cn("font-heading text-[2.5rem] leading-none font-bold tabular", tone)}>{items ? <CountUp to={items.length} duration={0.8} /> : "–"}</span>
        </div>
        <h3 className="font-heading text-xl font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="mt-5 space-y-1 rounded-md bg-surface-card p-2.5">
        {!items ? (
          <Skeleton className="h-16" />
        ) : !first ? (
          <p className="py-3 text-center text-xs text-muted-foreground">{empty}</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate font-semibold">{first.company_name}</span>
              <span className={cn("shrink-0 font-mono text-[11px] font-bold", tone)}>{meta(first)}</span>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {[first.owner_name, first.industry, first.state].filter(Boolean).join(" · ")}
              {items.length > 1 && ` · +${items.length - 1} more`}
            </p>
            <Link
              href={href(first)}
              className={cn("mt-1 block w-full rounded px-2 py-1 text-center font-heading text-[11px] font-bold tracking-wider uppercase transition-colors", ctaClass)}
            >
              {cta}
            </Link>
          </>
        )}
      </div>
    </GlowCard>
  );
}

/** "What should I do today?" - overdue follow-ups, this week's follow-ups and hot leads nobody has contacted. */
export function ActionCenter() {
  const { data } = useSWR<Actions>("/leads/actions/today");
  const open = data ? data.follow_ups_due.length + data.upcoming.length + data.hot_untouched.length : null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-heading text-[1.875rem] font-semibold tracking-tight">Today&apos;s actions</h2>
          <p className="text-sm text-muted-foreground">Your daily follow-up list. Nothing slips because nobody remembered to follow up.</p>
        </div>
        {open !== null && (
          <span className="rounded-full bg-card px-3 py-1 font-mono text-[11px] font-bold text-gold">
            Queue: {open} open task{open === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Queue
          label="Critical focus"
          tone="text-gold"
          dot="bg-gold"
          ping
          title="Follow-ups due"
          hint="Contacted leads waiting on you"
          items={data?.follow_ups_due}
          meta={(i) => (i.days_overdue > 0 ? `${i.days_overdue}d overdue` : "Due today")}
          cta="Draft follow-up"
          ctaClass="bg-amber text-primary-foreground hover:bg-gold"
          href={(i) => `/leads/${i.id}#copilot`}
          empty="You're all caught up."
        />
        <Queue
          label="Cadence active"
          tone="text-cyan-soft"
          dot="bg-cyan-soft"
          title="Coming up this week"
          hint="Scheduled follow-ups"
          items={data?.upcoming}
          meta={(i) => `Due ${relativeDay(i.follow_up_at)}`}
          cta="Review schedule"
          ctaClass="bg-card hover:bg-surface-high"
          href={(i) => `/leads/${i.id}`}
          empty="Nothing scheduled this week."
        />
        <Queue
          label="Net new leads"
          tone="text-cyan"
          dot="bg-cyan"
          title="Hot & untouched"
          hint="Top-scoring leads nobody has contacted"
          items={data?.hot_untouched}
          meta={(i) => `Score ${i.score}`}
          cta="Draft first touch"
          ctaClass="bg-amber-soft text-primary-foreground hover:bg-gold"
          href={(i) => `/leads/${i.id}#copilot`}
          empty="Every hot lead has been contacted."
        />
      </div>
    </section>
  );
}
