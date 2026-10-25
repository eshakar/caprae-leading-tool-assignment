"use client";

import {
  BellRing,
  Download,
  Flame,
  KanbanSquare,
  LayoutDashboard,
  Loader2,
  Moon,
  SlidersHorizontal,
  Sparkles,
  Upload,
  UserPlus,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useDeferredValue, useEffect, useState } from "react";
import useSWR from "swr";

import { useAskAI } from "@/components/ai/use-ask-ai";
import { ScoreRing } from "@/components/leads/badges";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { type LeadPage, qs } from "@/lib/api";

const OPEN_EVENT = "open-command-palette";

/** Opens the palette from anywhere (sidebar button, hero hint) without prop drilling. */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** The export is a file download from the API proxy, not a page, so use a plain anchor. */
function downloadAllLeads() {
  const a = document.createElement("a");
  a.href = "/api/leads/export?format=standard";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

export function CommandPalette() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { ask, pending } = useAskAI();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const term = useDeferredValue(input.trim());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !isTyping(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  const { data: matches, isLoading } = useSWR<LeadPage>(
    open && term.length >= 2 ? `/leads${qs({ search: term, page_size: 6, sort: "-score" })}` : null,
  );

  function run(action: () => void) {
    setOpen(false);
    setInput("");
    action();
  }

  const go = (href: string) => run(() => router.push(href));
  const quickFilter = (label: string, params: Record<string, string>) =>
    go(`/leads${qs({ ...params, ai: label, why: "Quick filter from the command palette." })}`);

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setInput("");
      }}
      title="Command palette"
      description="Search leads, jump to a page, or ask the AI"
      className="sm:max-w-xl"
    >
      <Command>
        <CommandInput value={input} onValueChange={setInput} placeholder="Search leads, run a command, or ask AI anything…" />
        <CommandList className="max-h-[420px]">
          <CommandEmpty>{isLoading ? "Searching…" : "No matches. Press Enter on “Ask AI” to search in plain English."}</CommandEmpty>

          {input.trim().length >= 3 && (
            <CommandGroup heading="AI">
              <CommandItem
                forceMount
                value={`ask-ai ${input}`}
                disabled={pending}
                onSelect={async () => {
                  if (await ask(input)) run(() => {});
                }}
              >
                {pending ? <Loader2 className="animate-spin text-primary" /> : <Sparkles className="text-primary" />}
                <span className="truncate">
                  Ask AI: <span className="font-medium">&ldquo;{input.trim()}&rdquo;</span>
                </span>
                <CommandShortcut>↵</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          )}

          {term.length >= 2 && !!matches?.items.length && (
            <CommandGroup heading={`Leads · ${matches.total} match${matches.total === 1 ? "" : "es"}`}>
              {matches.items.map((l) => (
                <CommandItem key={l.id} forceMount value={`lead-${l.id} ${l.company_name}`} onSelect={() => go(`/leads/${l.id}`)}>
                  <ScoreRing score={l.score} tier={l.score_tier} size={28} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{l.company_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[l.industry, l.state, l.owner_name].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          <CommandGroup heading="Go to">
            <CommandItem onSelect={() => go("/")}>
              <LayoutDashboard /> Dashboard
            </CommandItem>
            <CommandItem onSelect={() => go("/leads")}>
              <Users /> Leads
            </CommandItem>
            <CommandItem onSelect={() => go("/pipeline")}>
              <KanbanSquare /> Pipeline board
            </CommandItem>
            <CommandItem onSelect={() => go("/settings")}>
              <SlidersHorizontal /> Scoring profile
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />
          <CommandGroup heading="Quick filters">
            <CommandItem onSelect={() => quickFilter("Hot leads nobody has contacted", { tier: "hot", stage: "new" })}>
              <Flame /> Hot leads nobody has contacted
            </CommandItem>
            <CommandItem onSelect={() => quickFilter("Follow-ups due", { follow_up_due: "true" })}>
              <BellRing /> Follow-ups due
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />
          <CommandGroup heading="Actions">
            <CommandItem onSelect={() => go("/leads?add=1")}>
              <UserPlus /> Add a company
            </CommandItem>
            <CommandItem onSelect={() => go("/leads?import=1")}>
              <Upload /> Import a CSV
            </CommandItem>
            <CommandItem onSelect={() => run(downloadAllLeads)}>
              <Download /> Export all leads (CSV)
            </CommandItem>
            <CommandItem onSelect={() => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}>
              <Moon /> Toggle light / dark mode
            </CommandItem>
          </CommandGroup>
        </CommandList>
        <div className="flex items-center justify-between border-t px-3 py-2 text-[11px] text-muted-foreground">
          <span>
            <kbd className="font-mono">↑↓</kbd> navigate · <kbd className="font-mono">↵</kbd> select · <kbd className="font-mono">esc</kbd> close
          </span>
          <span className="flex items-center gap-1">
            <Sparkles className="size-3 text-primary" /> AI turns plain English into filters
          </span>
        </div>
      </Command>
    </CommandDialog>
  );
}
