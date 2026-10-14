import Link from "next/link";
import { Suspense } from "react";

import { LeadMemo } from "@/components/leads/lead-memo";
import { TopBar } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";

async function MemoForParams({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LeadMemo id={Number(id)} />;
}

export default function Page({ params }: PageProps<"/leads/[id]/memo">) {
  return (
    <>
      <TopBar>
        <Link href="/leads" className="text-muted-foreground hover:text-foreground">
          Leads
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="font-medium">Target profile</span>
      </TopBar>
      <Suspense fallback={<Skeleton className="m-6 h-[800px]" />}>
        <MemoForParams params={params} />
      </Suspense>
    </>
  );
}
