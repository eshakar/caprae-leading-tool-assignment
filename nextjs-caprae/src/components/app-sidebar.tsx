"use client";

import { KanbanSquare, LayoutDashboard, Search, SlidersHorizontal, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import useSWR from "swr";

import { openCommandPalette } from "@/components/command-palette";
import GradientText from "@/components/reactbits/GradientText";
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

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/settings", label: "Scoring profile", icon: SlidersHorizontal },
];

function NavItems({ activePath }: { activePath: string | null }) {
  return (
    <SidebarMenu>
      {NAV.map((item) => {
        const active = activePath !== null && (item.href === "/" ? activePath === "/" : activePath.startsWith(item.href));
        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
              <Link href={item.href}>
                <item.icon />
                <span>{item.label}</span>
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

function AiStatus() {
  const { data } = useSWR<{ enabled: boolean; provider: string | null; model: string | null }>("/ai/status");
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background/60 px-3 py-2 text-xs group-data-[collapsible=icon]:hidden">
      <Sparkles className="size-3.5 text-primary" />
      <span className="text-muted-foreground">
        AI Copilot: {data ? (data.enabled ? <span className="text-success font-medium">{{ gemini: "Gemini", xai: "Grok" }[data.provider ?? ""] ?? "Claude"}</span> : "template mode") : "…"}
      </span>
    </div>
  );
}

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link href="/" className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            S
          </div>
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <GradientText className="!mx-0 text-base font-semibold" colors={["#14b8a6", "#f59e0b", "#14b8a6"]} animationSpeed={6}>
              SaaSquatch Pro
            </GradientText>
            <span className="text-[11px] text-muted-foreground">Deal & lead intelligence</span>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="pb-0">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={openCommandPalette} tooltip="Search & Ask AI (Ctrl K)" className="border bg-background/60 text-muted-foreground">
                <Search />
                <span className="flex-1">Search or ask AI…</span>
                <kbd className="rounded border bg-muted px-1.5 font-mono text-[10px] group-data-[collapsible=icon]:hidden">Ctrl K</kbd>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            {/* usePathname can suspend on dynamic routes when Cache Components is on */}
            <Suspense fallback={<NavItems activePath={null} />}>
              <ActiveNav />
            </Suspense>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <AiStatus />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
