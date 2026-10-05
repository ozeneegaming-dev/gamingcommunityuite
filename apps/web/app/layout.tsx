import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

// Placeholder pentru Task 1. Titlul vine din setarea site.name, iar textele din messages/*.json (Task 11).
export const metadata: Metadata = { title: "RED-LINE" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ro">
      <body>{children}</body>
    </html>
  );
}
