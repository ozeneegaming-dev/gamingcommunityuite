import type { Metadata } from "next";
import { Chakra_Petch, Manrope } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { services } from "@/lib/services";
import "./globals.css";

const display = Chakra_Petch({ subsets: ["latin", "latin-ext"], weight: ["500", "600", "700"], variable: "--font-gcs-display" });
const text = Manrope({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600", "700"], variable: "--font-gcs-text" });

export const dynamic = "force-dynamic";

/** Titlul vine din setarea `site.name` (ACP → Setări → Generale) și se schimbă fără restart. */
export async function generateMetadata(): Promise<Metadata> {
  const siteName = await services().settings.get<string>("site.name");
  return { title: { default: siteName, template: `%s · ${siteName}` } };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  // Versiunea permisiunilor se schimbă la orice modificare de grup: browserul ia imediat CSS-ul nou,
  // deși îl poate păstra în cache 60 s.
  const version = await services().permissions.currentVersion();
  return (
    <html lang={locale} className={`${display.variable} ${text.variable}`}>
      <head>
        {/* Stilurile de nume ale grupurilor, generate din ACP (spec §9). */}
        <link rel="stylesheet" href={`/gcs-names.css?v=${version}`} />
      </head>
      <body className="gcs-root">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
