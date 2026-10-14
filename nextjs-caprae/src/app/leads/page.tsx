import type { Metadata } from "next";
import { Suspense } from "react";

import { LeadsView } from "@/components/leads/leads-view";
import { TopBar } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Leads" };

function LeadsFallback() {
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-10" />
      <Skeleton className="h-[480px]" />
    </div>
  );
}

export default function Page() {
  return (
    <>
      <TopBar>
        <span className="font-medium">Leads</span>
      </TopBar>
      {/* LeadsView reads search params, so it renders inside a Suspense boundary. */}
      <Suspense fallback={<LeadsFallback />}>
        <LeadsView />
      </Suspense>
    </>
  );
}
