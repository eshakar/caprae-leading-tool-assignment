"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";

import { isLeadDataKey, type Job, leadsApi } from "@/lib/api";

/** Starts a background enrichment job and polls it until done, keeping a single progress toast updated. */
export function useEnrichmentJob() {
  const { mutate } = useSWRConfig();
  const [job, setJob] = useState<Job | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const refresh = useCallback(
    () => mutate(isLeadDataKey),
    [mutate],
  );

  const start = useCallback(
    async (ids: number[], force = false) => {
      if (!ids.length) return;
      try {
        let current = await leadsApi.bulkEnrich(ids, force);
        setJob(current);
        const toastId = toast.loading(`Enriching 0 / ${current.total} leads…`);
        const poll = async () => {
          try {
            current = await leadsApi.job(current.id);
            setJob(current);
            if (current.status === "done" || current.status === "failed") {
              const ok = current.completed - current.failed;
              if (current.status === "failed") toast.error("Enrichment job failed", { id: toastId });
              else if (current.failed) toast.warning(`Enriched ${ok} leads · ${current.failed} couldn't be reached`, { id: toastId });
              else toast.success(`Enriched ${ok} leads`, { id: toastId });
              await refresh();
              setJob(null);
              return;
            }
            toast.loading(`Enriching ${current.completed} / ${current.total} leads…`, { id: toastId });
            void refresh();
            timer.current = setTimeout(poll, 1500);
          } catch (err) {
            toast.error((err as Error).message, { id: toastId });
            setJob(null);
          }
        };
        timer.current = setTimeout(poll, 1000);
      } catch (err) {
        toast.error((err as Error).message);
      }
    },
    [refresh],
  );

  return { job, start, running: job !== null };
}
