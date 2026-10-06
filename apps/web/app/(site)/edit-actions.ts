"use server";

import { GCS_WIDGET_PAGES, GCS_WIDGET_ZONES, GcsNotFound, WIDGETS_ACP_SECTION } from "@gcs/core";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import * as z from "zod";
import { assertAcpAction } from "@/lib/acp";
import { gcsAction } from "@/lib/actions";
import { PAGE_EDIT_COOKIE, SKIN_COOKIE } from "@/lib/appearance";
import { services } from "@/lib/services";

const cookieOpts = { path: "/", sameSite: "lax" as const, httpOnly: true, secure: process.env.NODE_ENV === "production" };

const themeKey = z.string().regex(/^[a-z0-9][a-z0-9-]{1,31}$/);

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
