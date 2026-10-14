"use client";

import { BellRing, CalendarCheck, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Lead } from "@/lib/api";
import { daysFromNowAt9, formatDate, relativeDay, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const QUICK = [
  { label: "Tomorrow", days: 1 },
  { label: "+3 days", days: 3 },
  { label: "+1 week", days: 7 },
  { label: "+2 weeks", days: 14 },
];

function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function FollowUpCard({ lead, onChange }: { lead: Lead; onChange: (iso: string | null) => void }) {
  const due = lead.follow_up_due;
  return (
    <Card className={cn(due && "border-hot/40")}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className={cn("size-4", due ? "text-hot" : "text-primary")} /> Follow-up
        </CardTitle>
        <CardDescription>
          {lead.last_contacted_at ? `Last contacted ${timeAgo(lead.last_contacted_at)}.` : "Not contacted yet."} Moving a lead to
          “Contacted” schedules one automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {lead.follow_up_at ? (
          <div className={cn("flex items-center justify-between rounded-lg border p-3", due ? "border-hot/30 bg-hot/8" : "bg-muted/40")}>
            <div className="flex items-center gap-2">
              <CalendarCheck className={cn("size-4", due ? "text-hot" : "text-muted-foreground")} />
              <div>
                <p className="text-sm font-medium">{formatDate(lead.follow_up_at, true)}</p>
                <p className={cn("text-xs", due ? "font-medium text-hot" : "text-muted-foreground")}>{relativeDay(lead.follow_up_at)}</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="size-8" onClick={() => onChange(null)} aria-label="Clear follow-up">
              <X />
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No follow-up scheduled.</p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map((q) => (
            <Button key={q.days} variant="outline" size="sm" onClick={() => onChange(daysFromNowAt9(q.days))}>
              {q.label}
            </Button>
          ))}
        </div>
        <Input
          type="date"
          aria-label="Pick a follow-up date"
          value={toDateInput(lead.follow_up_at)}
          onChange={(e) => {
            if (!e.target.value) return onChange(null);
            const [y, m, d] = e.target.value.split("-").map(Number);
            onChange(new Date(y, m - 1, d, 9, 0, 0).toISOString());
          }}
        />
      </CardContent>
    </Card>
  );
}
