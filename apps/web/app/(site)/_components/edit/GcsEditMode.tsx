import { THEME_FONTS, THEME_TOKENS } from "@gcs/core";
import { viewerEditing, viewerTheme } from "@/lib/appearance";
import { GcsEditBar } from "./GcsEditBar";
import { GcsThemeEditor } from "./GcsThemeEditor";

/** Uneltele de editare de pe site: nimic pentru cei fără drept; altfel bara sau, în editarea temei, panoul ei. */
export async function GcsEditMode() {
  const [{ editing, preview, theme, shown }, tools] = await Promise.all([viewerTheme(), viewerEditing()]);
  // În previzualizarea editorului vizual, pagina arată ca pentru vizitatori (fără bara de editare).
  if (preview || (!tools.canTheme && !tools.canWidgets)) return null;
  if (!editing) return <GcsEditBar canTheme={tools.canTheme} canWidgets={tools.canWidgets} pageEditing={tools.pageEditing} />;
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
