"use server";

import { GCS_WIDGET_PAGES, GCS_WIDGET_ZONES, GcsNotFound, THEMES_ACP_SECTION, THEME_FONTS, THEME_TOKENS, WIDGETS_ACP_SECTION, type GcsThemeDraft } from "@gcs/core";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import * as z from "zod";
import { assertAcpAction } from "@/lib/acp";
import { gcsAction } from "@/lib/actions";
import { PAGE_EDIT_COOKIE, SKIN_COOKIE, THEME_EDIT_COOKIE } from "@/lib/appearance";
import { services } from "@/lib/services";

const cookieOpts = { path: "/", sameSite: "lax" as const, httpOnly: true, secure: process.env.NODE_ENV === "production" };

const themeKey = z.string().regex(/^[a-z0-9][a-z0-9-]{1,31}$/);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "invalid_color");
const palette = z.object(Object.fromEntries(THEME_TOKENS.map((t) => [t, color.optional()]))).strict();
const draftSchema = z
  .object({
    dark: palette.optional(),
    light: palette.optional(),
    fontDisplay: z.enum(THEME_FONTS).optional(),
    fontText: z.enum(THEME_FONTS).optional(),
    radius: z.number().int().min(0).max(24).optional(),
    width: z.number().int().min(1000).max(1920).optional(),
    customCss: z.string().max(50_000, "too_long").optional(),
    logoUrl: z.null().optional(),
    faviconUrl: z.null().optional(),
  })
  .strict();

/**
 * Deschide editorul de temă pe site (cookie-ul de previzualizare); fără cheie, tema pe care o vede adminul.
 * Toate scrierile editorului trec prin poarta ACP (2FA + sesiune ACP proaspătă), ca acțiunile din panou.
 */
export const openThemeEditor = gcsAction(z.object({ key: themeKey.optional() }), async ({ key }) => {
  await assertAcpAction(THEMES_ACP_SECTION, "edit");
  const { themes } = services();
  const jar = await cookies();
  const theme = key ? await themes.get(key) : await themes.active(jar.get(SKIN_COOKIE)?.value ?? null);
  if (!theme) throw new GcsNotFound();
  jar.set(THEME_EDIT_COOKIE, theme.key, { ...cookieOpts, maxAge: 60 * 60 * 12 });
  revalidatePath("/", "layout");
  return { key: theme.key };
});

/** Închide editorul: adminul revine la tema publicată (draft-ul rămâne salvat). */
export async function closeThemeEditor(): Promise<void> {
  (await cookies()).delete(THEME_EDIT_COOKIE);
  revalidatePath("/", "layout");
}

/**
 * Salvează o modificare în draft și întoarce CSS-ul draft-ului (previzualizarea live).
 * `logoUrl` / `faviconUrl` pot fi doar șterse de aici; încărcarea trece prin `/api/themes/images`.
 */
export const saveThemeDraft = gcsAction(z.object({ key: themeKey, patch: draftSchema }), async ({ key, patch }) => {
  const actor = await assertAcpAction(THEMES_ACP_SECTION, "edit");
  const { themes } = services();
  await themes.saveDraft(actor, key, patch as GcsThemeDraft);
  const theme = await themes.get(key);
  if (!theme) throw new GcsNotFound();
  return { css: themes.css(theme, { draft: true }) };
});

export const publishTheme = gcsAction(z.object({ key: themeKey }), async ({ key }) => {
  const actor = await assertAcpAction(THEMES_ACP_SECTION, "edit");
  const theme = await services().themes.publish(actor, key);
  revalidatePath("/", "layout");
  return { version: theme.version };
});

export const discardThemeDraft = gcsAction(z.object({ key: themeKey }), async ({ key }) => {
  const actor = await assertAcpAction(THEMES_ACP_SECTION, "edit");
  const { themes } = services();
  await themes.discardDraft(actor, key);
  const theme = await themes.get(key);
  revalidatePath("/", "layout");
  return { css: theme ? themes.css(theme) : "" };
});

/** Tema aleasă de vizitator (Setări → Aspect): doar dintre temele active; cookie plus preferința membrului. */
export const setSkin = gcsAction(z.object({ key: themeKey }), async ({ key }, { actor }) => {
  const { themes, db } = services();
  const theme = await themes.get(key);
  if (!theme?.enabled) throw new GcsNotFound();
  (await cookies()).set(SKIN_COOKIE, key, { ...cookieOpts, maxAge: 60 * 60 * 24 * 365 });
  if (actor.userId) await db.$executeRaw`UPDATE users SET prefs = prefs || jsonb_build_object('skin', ${key}::text) WHERE id = ${actor.userId}`;
  revalidatePath("/", "layout");
  return { key };
});

/** Pornește modul „Editează pagina” (widget-urile paginilor index / forum / topic), cu poarta ACP. */
export const openPageEditor = gcsAction(z.object({}), async () => {
  await assertAcpAction(WIDGETS_ACP_SECTION, "edit");
  (await cookies()).set(PAGE_EDIT_COOKIE, "1", { ...cookieOpts, maxAge: 60 * 60 * 12 });
  revalidatePath("/", "layout");
  return {};
});

export async function closePageEditor(): Promise<void> {
  (await cookies()).delete(PAGE_EDIT_COOKIE);
  revalidatePath("/", "layout");
}

/** Salvează layout-ul unei pagini (ordinea din listă = ordinea din zonă); validarea completă e în `GcsWidgetService`. */
export const savePageLayout = gcsAction(
  z.object({
    page: z.enum(GCS_WIDGET_PAGES),
    placements: z
      .array(
        z.object({
          zone: z.enum(GCS_WIDGET_ZONES),
          type: z.string().max(80),
          config: z.record(z.string(), z.unknown()),
          groups: z.array(z.number().int()).max(50),
        }),
      )
      .max(90),
  }),
  async ({ page, placements }) => {
    const actor = await assertAcpAction(WIDGETS_ACP_SECTION, "edit");
    await services().widgets.save(actor, page, placements);
    revalidatePath("/", "layout");
    return {};
  },
);

/** Readuce pagina la widget-urile implicite ale modulelor. */
export const resetPageLayout = gcsAction(z.object({ page: z.enum(GCS_WIDGET_PAGES) }), async ({ page }) => {
  const actor = await assertAcpAction(WIDGETS_ACP_SECTION, "edit");
  await services().widgets.reset(actor, page);
  revalidatePath("/", "layout");
  return {};
});
