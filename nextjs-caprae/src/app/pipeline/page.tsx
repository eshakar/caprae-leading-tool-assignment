import type { Metadata } from "next";

import { TopBar } from "@/components/page-header";
import { PipelineBoard } from "@/components/pipeline/pipeline-board";

export const metadata: Metadata = { title: "Pipeline" };

export default function Page() {
  return (
    <>
      <TopBar>
        <span className="font-medium">Pipeline</span>
      </TopBar>
      <PipelineBoard />
    </>
  );
}
