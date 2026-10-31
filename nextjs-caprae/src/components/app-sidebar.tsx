"use client";

import { BrainCircuit, FileUp, Kanban, LayoutGrid, Plus, Radar, SlidersHorizontal, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import useSWR from "swr";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import type { LeadPage, Stats } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const PROVIDER_LABEL: Record<string, string> = { anthropic: "Claude", gemini: "Gemini", xai: "Grok" };
const OPEN_STAGES = new Set(["new", "contacted", "replied", "meeting"]);
// Shared with the pipeline board, so both read one cached request.
const PIPELINE_KEY = "/leads?page_size=200&sort=-score";

function useNavBadges() {
  const { data: stats } = useSWR<Stats>("/stats");
  const { data: pipeline } = useSWR<LeadPage>(PIPELINE_KEY);
  const openRevenue = pipeline?.items.filter((l) => OPEN_STAGES.has(l.stage)).reduce((s, l) => s + (l.revenue_usd ?? 0), 0);
  return {
    leads: stats ? (
      <span className="rounded bg-amber/15 px-1.5 py-0.5 font-mono text-[11px] font-bold text-gold tabular">{stats.total}</span>
    ) : null,
    pipeline:
      openRevenue !== undefined ? (
        <span className="rounded bg-surface-card px-1.5 py-0.5 font-mono text-[11px] font-semibold text-muted-foreground tabular">
          {formatMoney(openRevenue)}
        </span>
      ) : null,
  };
}

function NavItems({ activePath }: { activePath: string | null }) {
  const badges = useNavBadges();
  const items = [
    { href: "/", label: "Dashboard", icon: LayoutGrid, badge: null },
    { href: "/leads", label: "Leads", icon: Radar, badge: badges.leads },
    { href: "/pipeline", label: "Pipeline", icon: Kanban, badge: badges.pipeline },
    { href: "/settings", label: "Scoring profile", icon: SlidersHorizontal, badge: <Sparkles className="size-4 text-indigo" /> },
  ];
  return (
    <SidebarMenu className="gap-1">
      {items.map((item) => {
        const active = activePath !== null && (item.href === "/" ? activePath === "/" : activePath.startsWith(item.href));
        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton
              asChild
              isActive={active}
              tooltip={item.label}
              className={cn(
                "h-10 rounded-md border-l-2 border-transparent text-muted-foreground",
                "data-[active=true]:border-amber data-[active=true]:bg-surface-high data-[active=true]:font-semibold data-[active=true]:text-gold",
                "data-[active=true]:shadow-[inset_0_0_12px_rgba(245,158,11,0.06)]",
              )}
            >
              <Link href={item.href}>
                <item.icon />
                <span className="flex-1">{item.label}</span>
                <span className="group-data-[collapsible=icon]:hidden">{item.badge}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

function ActiveNav() {
  const pathname = usePathname();
  return <NavItems activePath={pathname} />;
}

function CopilotStatus() {
  const { data } = useSWR<{ enabled: boolean; provider: string | null; model: string | null }>("/ai/status");
  const live = !!data?.enabled;
  return (
    <div className="flex items-center justify-between rounded-lg border border-input bg-surface-card p-2.5 group-data-[collapsible=icon]:hidden">
      <div className="flex items-center gap-2.5">
        <span className="relative flex size-2.5">
          {live && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald opacity-75" />}
          <span className={cn("relative inline-flex size-2.5 rounded-full", live ? "bg-emerald" : "bg-cold")} />
        </span>
        <div className="flex flex-col">
          <span className="font-mono text-xs font-semibold">AI Copilot</span>
          <span className="font-mono text-[11px] font-bold uppercase tracking-wide text-cyan">
            {data ? (live ? `Live • ${PROVIDER_LABEL[data.provider ?? ""] ?? "LLM"}` : "Template mode") : "…"}
          </span>
        </div>
      </div>
      <BrainCircuit className="size-[18px] text-cyan-soft" />
    </div>
  );
}

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-16 justify-center border-b px-4 group-data-[collapsible=icon]:px-2">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-amber font-heading text-sm font-bold text-primary-foreground shadow-[0_0_12px_rgba(245,158,11,0.35)]">
            S
          </div>
          <div className="flex min-w-0 flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate font-heading font-semibold tracking-tight text-amber-soft">SaaSquatch Pro</span>
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-gold">Deal &amp; Lead Intelligence</span>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <div className="p-3 pb-0">
          <CopilotStatus />
        </div>
        <SidebarGroup className="px-3">
          <SidebarGroupLabel className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted-foreground/70">
            Main workspace
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {/* usePathname can suspend on dynamic routes when Cache Components is on */}
            <Suspense fallback={<NavItems activePath={null} />}>
              <ActiveNav />
            </Suspense>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t p-3 group-data-[collapsible=icon]:hidden">
        <div className="flex items-center gap-1.5">
          <Link
            href="/leads?add=1"
            className="flex flex-1 items-center justify-center gap-1 rounded-md bg-amber px-2 py-2 text-xs font-semibold text-primary-foreground shadow-[0_0_12px_rgba(245,158,11,0.25)] transition-colors hover:bg-gold"
          >
            <Plus className="size-4" /> Company
          </Link>
          <Link
            href="/leads?import=1"
            title="Import CSV"
            aria-label="Import CSV"
            className="flex items-center justify-center rounded-md border border-input bg-surface-card p-2 text-muted-foreground transition-colors hover:bg-surface-high hover:text-foreground"
          >
            <FileUp className="size-4" />
          </Link>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
