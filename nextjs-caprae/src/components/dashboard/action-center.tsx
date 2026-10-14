"use client";

import { BellRing, CalendarClock, Flame, PartyPopper } from "lucide-react";
import Link from "next/link";
import useSWR from "swr";

import { ScoreRing, StageBadge } from "@/components/leads/badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ActionCard, Actions } from "@/lib/api";
import { relativeDay } from "@/lib/format";

function Row({ item, right }: { item: ActionCard; right: React.ReactNode }) {
  return (
    <Link href={`/leads/${item.id}`} className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-muted/60">
      <ScoreRing score={item.score} tier={item.score_tier} size={34} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.company_name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {[item.owner_name, item.industry, item.state].filter(Boolean).join(" · ")}
        </p>
      </div>
      {right}
    </Link>
  );
}

function Column({
  icon: Icon,
  title,
  hint,
  items,
  empty,
  render,
  tone,
}: {
  icon: typeof Flame;
  title: string;
  hint: string;
  items: ActionCard[] | undefined;
  empty: string;
  render: (i: ActionCard) => React.ReactNode;
  tone: string;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-center gap-2">
        <span className={`flex size-7 items-center justify-center rounded-md ${tone}`}>
          <Icon className="size-3.5" />
        </span>
        <div>
          <p className="text-sm font-medium leading-tight">
            {title} {items && items.length > 0 && <span className="text-muted-foreground tabular">({items.length})</span>}
          </p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
      </div>
      {!items ? (
        <Skeleton className="h-24" />
      ) : items.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          <PartyPopper className="size-3.5" /> {empty}
        </div>
      ) : (
        <div className="space-y-0.5">{items.map((i) => <div key={i.id}>{render(i)}</div>)}</div>
      )}
    </div>
  );
}

/** "What should I do today?" - overdue follow-ups, this week's follow-ups and hot leads nobody has contacted. */
export function ActionCenter() {
  const { data } = useSWR<Actions>("/leads/actions/today");
  const dueCount = data?.follow_ups_due.length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Today&apos;s actions
          {dueCount > 0 && <Badge className="bg-hot text-white">{dueCount} overdue</Badge>}
        </CardTitle>
        <CardDescription>Your daily follow-up list. Nothing slips because nobody remembered to follow up.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-3">
        <Column
          icon={BellRing}
          title="Follow-ups due"
          hint="Contacted leads waiting on you"
          items={data?.follow_ups_due}
          empty="You're all caught up."
          tone="bg-hot/15 text-hot"
          render={(i) => (
            <Row
              item={i}
              right={<span className="shrink-0 text-xs font-medium text-hot">{i.days_overdue > 0 ? `${i.days_overdue}d overdue` : "today"}</span>}
            />
          )}
        />
        <Column
          icon={CalendarClock}
          title="Coming up this week"
          hint="Scheduled follow-ups"
          items={data?.upcoming}
          empty="Nothing scheduled this week."
          tone="bg-chart-1/15 text-chart-1"
          render={(i) => <Row item={i} right={<span className="shrink-0 text-xs text-muted-foreground">{relativeDay(i.follow_up_at)}</span>} />}
        />
        <Column
          icon={Flame}
          title="Hot & untouched"
          hint="Top-scoring leads nobody has contacted"
          items={data?.hot_untouched.slice(0, 5)}
          empty="Every hot lead has been contacted."
          tone="bg-warm/15 text-warm"
          render={(i) => <Row item={i} right={<StageBadge stage={i.stage} />} />}
        />
      </CardContent>
    </Card>
  );
}
