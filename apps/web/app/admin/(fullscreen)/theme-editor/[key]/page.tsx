import { THEME_FONTS, THEMES_ACP_SECTION, themeCustomCss } from "@gcs/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { THEME_PREVIEW_PARAM } from "@/lib/theme-preview";
import { GcsThemeStudio } from "../_components/GcsThemeStudio";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("themeStudio"))("title"), robots: { index: false, follow: false } };
}

/**
 * Editorul vizual de temă (ACP → Aspect → Teme → „Editează vizual”), pe tot ecranul, în afara shell-ului ACP.
 * Aceeași gardă ca paginile ACP (2FA, sesiune ACP proaspătă) plus dreptul de editare pe teme; altfel 404.
 */
export default async function ThemeStudioPage({ params }: { params: Promise<{ key: string }> }) {
  await requireAcpSection(THEMES_ACP_SECTION, "edit");
  const { key } = await params;
  const { themes, settings } = services();
  const theme = await themes.get(key);
  if (!theme) notFound();
  const shown = themes.withDraft(theme);
  const siteName = await settings.get<string>("site.name");
  return (
    <GcsThemeStudio
      themeKey={theme.key}
      themeName={theme.name}
      siteName={siteName}
      hasDraft={theme.draft !== null}
      fonts={THEME_FONTS}
      previewUrl={`/?${THEME_PREVIEW_PARAM}=${encodeURIComponent(theme.key)}`}
      cssFiles={theme.cssFiles}
      initial={{ settings: shown.settings, customCss: themeCustomCss(shown), logoUrl: shown.logoUrl, faviconUrl: shown.faviconUrl }}
    />
  );
}
