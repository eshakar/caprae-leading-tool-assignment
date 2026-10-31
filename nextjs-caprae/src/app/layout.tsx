import type { Metadata } from "next";
import { Hanken_Grotesk, JetBrains_Mono, Space_Grotesk } from "next/font/google";

import { AppSidebar } from "@/components/app-sidebar";
import { CommandPalette } from "@/components/command-palette";
import { Providers } from "@/components/providers";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

import "./globals.css";

const body = Hanken_Grotesk({ variable: "--font-sans", subsets: ["latin"] });
const heading = Space_Grotesk({ variable: "--font-heading", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "SaaSquatch Pro", template: "%s · SaaSquatch Pro" },
  description: "Find, verify, prioritize and reach the right companies - explainable Deal Signal scoring and an AI outreach copilot.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${body.variable} ${heading.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>
          <SidebarProvider style={{ "--sidebar-width": "18rem" } as React.CSSProperties}>
            <AppSidebar />
            <SidebarInset className="min-w-0">{children}</SidebarInset>
          </SidebarProvider>
          <CommandPalette />
        </Providers>
      </body>
    </html>
  );
}
