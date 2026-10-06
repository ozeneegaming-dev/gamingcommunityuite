import "server-only";
import { DEFAULT_THEME_SETTINGS, THEMES_ACP_SECTION, WIDGETS_ACP_SECTION, type GcsThemeView } from "@gcs/core";
import { cookies } from "next/headers";
import { cache } from "react";
import { getAcpContext } from "./acp";
import { currentActor } from "./actor";
import { services } from "./services";

export const THEME_COOKIE = "gcs-theme";
export const THEME_MODES = ["dark", "light", "auto"] as const;
export type GcsThemeMode = (typeof THEME_MODES)[number];
export const isThemeMode = (v: unknown): v is GcsThemeMode => THEME_MODES.includes(v as GcsThemeMode);

/** Modul temei (dark / light / auto): alegerea vizitatorului (cookie), altfel setarea `site.theme` din ACP. */
export async function themeMode(): Promise<GcsThemeMode> {
  const fromCookie = (await cookies()).get(THEME_COOKIE)?.value;
  if (isThemeMode(fromCookie)) return fromCookie;
  const fromSettings = await services()
    .settings.get<string>("site.theme")
    .catch(() => "dark");
  return isThemeMode(fromSettings) ? fromSettings : "dark";
}

/** Tema aleasă de vizitator (Setări → Aspect); dacă lipsește sau nu mai e activă, tema implicită. */
export const SKIN_COOKIE = "gcs-skin";
/** Cheia temei pe care adminul o editează pe site (previzualizarea draft-ului). */
export const THEME_EDIT_COOKIE = "gcs-theme-edit";

const FALLBACK_THEME: GcsThemeView = {
  key: "default",
  name: "Default",
  isDefault: true,
  enabled: true,
  settings: DEFAULT_THEME_SETTINGS,
  customCss: "",
  logoUrl: null,
  faviconUrl: null,
  version: 0,
  draft: null,
};

export type GcsViewerTheme = {
  /** Tema publicată pe care o vede viewerul. */
  theme: GcsThemeView;
  /** Ce se afișează: tema cu draft-ul aplicat când adminul e în editor, altfel tema publicată. */
  shown: GcsThemeView;
  /** În editor: CSS-ul temei editate cu draft-ul aplicat, pus inline (tema editată poate fi și una inactivă). */
  inlineCss: string | null;
  /** Viewerul poate edita teme (ACP → Aspect → Teme). */
  canEdit: boolean;
  editing: boolean;
};

/** Tema request-ului curent (o singură dată pe request). Înainte de instalare: valorile implicite. */
export const viewerTheme = cache(async (): Promise<GcsViewerTheme> => {
  try {
    const jar = await cookies();
    const { themes, acp } = services();
    const actor = await currentActor();
    const canEdit = actor.userId ? await acp.can(actor, THEMES_ACP_SECTION, "edit") : false;
    // Editorul (și draft-ul) apare doar cu poarta ACP trecută; altfel adminul vede tema publicată și butonul.
    const editKey = canEdit ? jar.get(THEME_EDIT_COOKIE)?.value : undefined;
    const gateOk = editKey ? (await getAcpContext()).state === "ok" : false;
    const edited = editKey && gateOk ? await themes.get(editKey) : null;
    if (edited) {
      const shown = themes.withDraft(edited);
      return { theme: edited, shown, inlineCss: themes.css(edited, { draft: true }), canEdit, editing: true };
    }
    const theme = await themes.active(jar.get(SKIN_COOKIE)?.value ?? null);
    return { theme, shown: theme, inlineCss: null, canEdit, editing: false };
  } catch {
    return { theme: FALLBACK_THEME, shown: FALLBACK_THEME, inlineCss: null, canEdit: false, editing: false };
  }
});

/** Cookie-ul modului „Editează pagina” (widget-urile paginilor index / forum / topic). */
export const PAGE_EDIT_COOKIE = "gcs-page-edit";

export type GcsViewerEditing = {
  /** Poate edita teme / widget-uri (drepturile ACP; butoanele apar și fără poarta ACP trecută). */
  canTheme: boolean;
  canWidgets: boolean;
  /** Modul „Editează pagina” e activ (cookie + poarta ACP trecută). */
  pageEditing: boolean;
};

/** Uneltele de editare ale viewerului (o singură dată pe request). */
export const viewerEditing = cache(async (): Promise<GcsViewerEditing> => {
  try {
    const actor = await currentActor();
    if (!actor.userId) return { canTheme: false, canWidgets: false, pageEditing: false };
    const { acp } = services();
    const [canTheme, canWidgets] = await Promise.all([acp.can(actor, THEMES_ACP_SECTION, "edit"), acp.can(actor, WIDGETS_ACP_SECTION, "edit")]);
    const wantsPage = canWidgets && (await cookies()).get(PAGE_EDIT_COOKIE)?.value === "1";
    const pageEditing = wantsPage && (await getAcpContext()).state === "ok";
    return { canTheme, canWidgets, pageEditing };
  } catch {
    return { canTheme: false, canWidgets: false, pageEditing: false };
  }
});
