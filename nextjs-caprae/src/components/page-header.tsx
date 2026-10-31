"use client";

import { Search } from "lucide-react";
import useSWR from "swr";

import { openCommandPalette } from "@/components/command-palette";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

function CopilotPill() {
  const { data } = useSWR<{ enabled: boolean }>("/ai/status");
  if (!data) return null;
  return (
    <div className="hidden items-center gap-1.5 rounded-full border border-input bg-surface-card px-2.5 py-1 lg:flex">
      <span className="relative flex size-2">
        {data.enabled && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald opacity-75" />}
        <span className={cn("relative inline-flex size-2 rounded-full", data.enabled ? "bg-emerald" : "bg-cold")} />
      </span>
      <span className={cn("font-mono text-[11px] font-bold uppercase", data.enabled ? "text-emerald" : "text-cold")}>
        {data.enabled ? "Copilot ready" : "Template mode"}
      </span>
    </div>
  );
}

export function TopBar({ children }: { children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b bg-card/85 px-4 backdrop-blur-xl md:px-6 print:hidden">
      <SidebarTrigger className="-ml-1" />
      {children && (
        <>
          <Separator orientation="vertical" className="data-[orientation=vertical]:h-4" />
          <div className="hidden min-w-0 items-center gap-2 text-sm md:flex">{children}</div>
        </>
      )}
      <button
        type="button"
        onClick={openCommandPalette}
        className="relative flex h-9 w-full max-w-xl items-center rounded-md border border-input bg-surface-card pr-16 pl-10 text-left text-sm text-outline transition-colors hover:border-cyan/60"
      >
        <Search className="absolute left-3 size-[18px] text-outline" />
        <span className="truncate">Search or ask AI…</span>
        <kbd className="absolute right-2 rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">Ctrl K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-3">
        <CopilotPill />
        <div className="hidden h-4 w-px bg-border lg:block" />
        <ThemeToggle />
      </div>
    </header>
  );
}

export function PageTitle({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
