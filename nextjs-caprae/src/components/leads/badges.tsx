import { CircleAlert, CircleCheck, CircleX, Flame, Snowflake, Sun } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { EmailStatus, Stage, Tier } from "@/lib/api";
import { cn } from "@/lib/utils";

const TIER_STYLE: Record<Tier, { label: string; className: string; icon: typeof Flame }> = {
  hot: { label: "Hot", className: "bg-hot/12 text-hot border-hot/30", icon: Flame },
  warm: { label: "Warm", className: "bg-warm/12 text-warm border-warm/30", icon: Sun },
  cold: { label: "Cold", className: "bg-cold/12 text-cold border-cold/30", icon: Snowflake },
};

export function TierBadge({ tier, className }: { tier: Tier; className?: string }) {
  const t = TIER_STYLE[tier];
  return (
    <Badge variant="outline" className={cn("gap-1 font-medium", t.className, className)}>
      <t.icon className="size-3" />
      {t.label}
    </Badge>
  );
}

const STAGE_STYLE: Record<Stage, string> = {
  new: "bg-muted text-foreground/80",
  contacted: "bg-chart-5/15 text-chart-5 border-chart-5/30",
  replied: "bg-chart-1/15 text-chart-1 border-chart-1/30",
  meeting: "bg-chart-3/15 text-chart-3 border-chart-3/30",
  won: "bg-success/15 text-success border-success/30",
  lost: "bg-destructive/10 text-destructive border-destructive/30",
};

export function StageBadge({ stage }: { stage: Stage }) {
  return (
    <Badge variant="outline" className={cn("capitalize", STAGE_STYLE[stage])}>
      {stage}
    </Badge>
  );
}

const EMAIL_STYLE: Record<EmailStatus, { icon: typeof CircleCheck; className: string; label: string }> = {
  valid: { icon: CircleCheck, className: "text-success", label: "Verified" },
  risky: { icon: CircleAlert, className: "text-warm", label: "Risky" },
  invalid: { icon: CircleX, className: "text-destructive", label: "Invalid" },
};

export function EmailStatusIcon({ status, reason }: { status: EmailStatus; reason?: string }) {
  const s = EMAIL_STYLE[status];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex shrink-0", s.className)} aria-label={s.label}>
          <s.icon className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <span className="font-medium">{s.label}</span>
        {reason ? ` — ${reason}` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

export function ScoreRing({ score, tier, size = 44 }: { score: number; tier: Tier; size?: number }) {
  const stroke = size > 60 ? 6 : 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = tier === "hot" ? "var(--hot)" : tier === "warm" ? "var(--warm)" : "var(--cold)";
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
      </svg>
      <span className={cn("absolute font-semibold tabular", size > 60 ? "text-2xl" : "text-xs")}>{score}</span>
    </div>
  );
}
