import type { Metadata } from "next";
import { Chakra_Petch, Manrope } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { themeMode, viewerTheme } from "@/lib/appearance";
import type { ReactNode } from "react";
import { services } from "@/lib/services";
import { siteBaseUrl } from "@/lib/seo";
import { GcsThemePreviewBridge } from "./(site)/_components/edit/GcsThemePreviewBridge";
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
  const siteName = await orDefault(() => services().settings.get<string>("site.name"), "GamingCommunitySuite");
  const base = await siteBaseUrl();
  const { shown } = await viewerTheme();
  const custom = await orDefault(() => services().settings.get<string>("site.description"), "");
  const description = custom.trim() || (await orDefault(async () => (await getTranslations("site"))("metaDescription", { name: siteName }), siteName));
  return {
    title: { default: siteName, template: `%s · ${siteName}` },
    description,
    metadataBase: new URL(base),
    openGraph: { siteName, type: "website" },
    ...(shown.faviconUrl ? { icons: { icon: [{ url: shown.faviconUrl, type: "image/png" }] } } : {}),
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  // Versiunea permisiunilor se schimbă la orice modificare de grup: browserul ia imediat CSS-ul nou,
  // deși îl poate păstra în cache 60 s.
  const version = await orDefault(
    async () => `${await services().permissions.currentVersion()}-${await services().cosmetics.version()}-${await services().appearance.version()}`,
    "0",
  );
  const theme = await viewerTheme();
  return (
    <html lang={locale} data-theme={await themeMode()} className={`${display.variable} ${text.variable}`}>
      <head>
        {/* Stilurile de nume și ramele de avatar, generate din ACP (spec §9). */}
        <link rel="stylesheet" href={`/gcs-names.css?v=${version}`} />
        {/* Tema (specul etapei 5): CSS-ul publicat; în previzualizarea editorului vizual, draft-ul, inline. */}
        {theme.inlineCss === null ? (
          <link rel="stylesheet" href={`/gcs-theme.css?t=${encodeURIComponent(theme.theme.key)}&v=${theme.theme.version}`} />
        ) : (
          // Fără `<`: CSS-ul extra e sanitizat, iar restul e generat din valori validate.
          <style id="gcs-theme-draft" dangerouslySetInnerHTML={{ __html: theme.inlineCss }} />
        )}
      </head>
      <body className="gcs-root">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
        {/* Previzualizarea editorului vizual de temă (iframe): primește draft-ul live prin postMessage. */}
        {theme.preview && <GcsThemePreviewBridge />}
      </body>
    </html>
  );
}
