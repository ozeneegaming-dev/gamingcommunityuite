import type { Metadata } from "next";
import { Chakra_Petch, Manrope } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { themeMode } from "@/lib/appearance";
import type { ReactNode } from "react";
import { services } from "@/lib/services";
import { siteBaseUrl } from "@/lib/seo";
import "./globals.css";

const display = Chakra_Petch({ subsets: ["latin", "latin-ext"], weight: ["500", "600", "700"], variable: "--font-gcs-display" });
const text = Manrope({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600", "700"], variable: "--font-gcs-text" });

export const dynamic = "force-dynamic";

/** Înainte de instalare baza de date poate lipsi: layout-ul trebuie să se randeze oricum (pentru /install). */
async function orDefault<T>(value: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await value();
  } catch {
    return fallback;
  }
}

/** Titlul vine din setarea `site.name` (ACP → Setări → Generale) și se schimbă fără restart. */
export async function generateMetadata(): Promise<Metadata> {
  const siteName = await orDefault(() => services().settings.get<string>("site.name"), "RED-LINE");
  const base = await siteBaseUrl();
  return {
    title: { default: siteName, template: `%s · ${siteName}` },
    metadataBase: new URL(base),
    openGraph: { siteName, type: "website" },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  // Versiunea permisiunilor se schimbă la orice modificare de grup: browserul ia imediat CSS-ul nou,
  // deși îl poate păstra în cache 60 s.
  const version = await orDefault(
    async () => `${await services().permissions.currentVersion()}-${await services().cosmetics.version()}`,
    "0",
  );
  return (
    <html lang={locale} data-theme={await themeMode()} className={`${display.variable} ${text.variable}`}>
      <head>
        {/* Stilurile de nume și ramele de avatar, generate din ACP (spec §9). */}
        <link rel="stylesheet" href={`/gcs-names.css?v=${version}`} />
      </head>
      <body className="gcs-root">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
