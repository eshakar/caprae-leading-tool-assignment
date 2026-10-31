"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

import SpotlightCard from "@/components/reactbits/SpotlightCard";
import { cn } from "@/lib/utils";

const subscribe = () => () => {};

/** React Bits SpotlightCard, themed with shadcn tokens and following light/dark mode. */
export function GlowCard({ className, children, ...props }: React.ComponentProps<typeof SpotlightCard>) {
  const { resolvedTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const theme = mounted && resolvedTheme === "dark" ? "dark" : "light";
  return (
    <SpotlightCard
      theme={theme}
      spotlightColor={theme === "dark" ? "rgba(245, 158, 11, 0.18)" : "rgba(217, 119, 6, 0.12)"}
      className={cn("rounded-xl! border p-5!", className)}
      style={{ "--spotlight-card-surface": "var(--card)", "--spotlight-card-shadow": "none" } as React.CSSProperties}
      {...props}
    >
      {children}
    </SpotlightCard>
  );
}
