import type { Metadata } from "next";

import { Dashboard } from "@/components/dashboard/dashboard";
import { TopBar } from "@/components/page-header";

export const metadata: Metadata = { title: "Dashboard" };

export default function Page() {
  return (
    <>
      <TopBar>
        <span className="font-medium">Dashboard</span>
      </TopBar>
      <Dashboard />
    </>
  );
}
