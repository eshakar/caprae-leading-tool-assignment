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
      spotlightColor={theme === "dark" ? "rgba(45, 212, 191, 0.3)" : "rgba(13, 148, 136, 0.2)"}
      className={cn("rounded-xl! border p-5!", className)}
      style={{ "--spotlight-card-surface": "var(--card)", "--spotlight-card-shadow": "none" } as React.CSSProperties}
      {...props}
    >
      {children}
    </SpotlightCard>
  );
}
