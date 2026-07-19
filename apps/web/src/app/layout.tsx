import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import "./live-session-console.css";
import "./session-console.css";

export const metadata: Metadata = {
  title: "Pacta — AI negotiation orchestrator",
  description:
    "Use-case-configurable, human-gated multi-party negotiation orchestration.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
