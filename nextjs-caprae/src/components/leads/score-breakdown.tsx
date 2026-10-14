import { ShieldAlert } from "lucide-react";

import type { ScoreFactor } from "@/lib/api";
import { cn } from "@/lib/utils";

const BAR: Record<ScoreFactor["sentiment"], string> = {
  positive: "bg-success",
  neutral: "bg-warm",
  negative: "bg-hot",
};

export function ScoreBreakdown({ factors }: { factors: ScoreFactor[] }) {
  const knockout = factors.find((f) => f.key === "knockout");
  const rest = factors.filter((f) => f.key !== "knockout");
  return (
    <div className="space-y-3">
      {knockout && (
        <div className="flex items-start gap-2 rounded-lg border border-hot/30 bg-hot/8 p-3 text-sm">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-hot" />
          <div>
            <p className="font-medium">Fit gate applied</p>
            <p className="text-muted-foreground">{knockout.reason}</p>
          </div>
        </div>
      )}
      {rest.map((f) => {
        const pct = f.max > 0 ? Math.max(0, Math.min(100, (f.points / f.max) * 100)) : 0;
        return (
          <div key={f.key} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">{f.label}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular">
                {f.points.toFixed(1)} / {f.max.toFixed(0)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full transition-all duration-700", BAR[f.sentiment])} style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{f.reason}</p>
          </div>
        );
      })}
    </div>
  );
}
