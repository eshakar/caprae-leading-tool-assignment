import Link from "next/link";
import { Suspense } from "react";

import { LeadDetail } from "@/components/leads/lead-detail";
import { TopBar } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";

async function LeadDetailForParams({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LeadDetail id={Number(id)} />;
}

export default function Page({ params }: PageProps<"/leads/[id]">) {
  return (
    <>
      <TopBar>
        <Link href="/leads" className="text-muted-foreground hover:text-foreground">
          Leads
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="font-medium">Lead details</span>
      </TopBar>
      {/* The id is request-time data, so it is read inside a Suspense boundary. */}
      <Suspense fallback={<Skeleton className="m-6 h-96" />}>
        <LeadDetailForParams params={params} />
      </Suspense>
    </>
  );
}
