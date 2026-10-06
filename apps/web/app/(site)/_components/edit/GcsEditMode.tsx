import { THEME_FONTS, THEME_TOKENS } from "@gcs/core";
import { viewerTheme } from "@/lib/appearance";
import { GcsEditBar } from "./GcsEditBar";
import { GcsThemeEditor } from "./GcsThemeEditor";

/** Uneltele de editare de pe site: nimic pentru cei fără drept; altfel bara sau, în editare, panoul temei. */
export async function GcsEditMode() {
  const { canEdit, editing, theme, shown } = await viewerTheme();
  if (!canEdit) return null;
  if (!editing) return <GcsEditBar />;
  return (
    <GcsThemeEditor
      themeKey={theme.key}
      themeName={theme.name}
      hasDraft={theme.draft !== null}
      tokens={THEME_TOKENS}
      fonts={THEME_FONTS}
      value={{
        dark: shown.settings.dark,
        light: shown.settings.light,
        fontDisplay: shown.settings.fontDisplay,
        fontText: shown.settings.fontText,
        radius: shown.settings.radius,
        width: shown.settings.width,
        customCss: shown.customCss,
        logoUrl: shown.logoUrl,
        faviconUrl: shown.faviconUrl,
      }}
    />
  );
}
