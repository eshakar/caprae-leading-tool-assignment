import type { Metadata } from "next";

import { TopBar } from "@/components/page-header";
import { IcpForm } from "@/components/settings/icp-form";

export const metadata: Metadata = { title: "Scoring profile" };

export default function Page() {
  return (
    <>
      <TopBar>
        <span className="font-medium">Scoring profile</span>
      </TopBar>
      <IcpForm />
    </>
  );
}
