"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { aiApi, leadsUrlForFilters } from "@/lib/api";

export const ASK_AI_EXAMPLES = [
  "Hot HVAC companies in Texas we haven't contacted",
  "Family-owned businesses scoring above 80",
  "Leads with a follow-up due",
];

/** Turns a plain-English request into lead filters (AI, or keyword rules without a key) and opens the results. */
export function useAskAI() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function ask(query: string) {
    const q = query.trim();
    if (q.length < 2 || pending) return false;
    setPending(true);
    try {
      const res = await aiApi.search(q);
      router.push(leadsUrlForFilters(res.filters, q, res.explanation));
      return true;
    } catch (err) {
      toast.error((err as Error).message);
      return false;
    } finally {
      setPending(false);
    }
  }

  return { ask, pending };
}
