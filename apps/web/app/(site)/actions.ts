"use server";

import { sql, sqlJsonMerge } from "@gcs/db";
import { cookies, headers } from "next/headers";
import { GCS_LOCALES, LOCALE_COOKIE, type GcsLocale } from "@/i18n";
import { currentActor } from "@/lib/actor";
import { isSameOrigin } from "@/lib/actions";
import { isThemeMode, SKIN_COOKIE, THEME_COOKIE } from "@/lib/appearance";
import { services } from "@/lib/services";

/**
 * Schimbă limba UI-ului (specul etapei 5): cookie de un an pentru oricine; pentru membri, alegerea se salvează și în
 * preferințe (`users.prefs.locale`), ca să-i urmeze pe alte dispozitive și în emailuri. Doar limbile active din ACP.
 */
export async function setLocale(formData: FormData): Promise<void> {
  if (!isSameOrigin(await headers())) return;
  const locale = formData.get("locale");
  if (!GCS_LOCALES.includes(locale as GcsLocale)) return;
  const { settings, db } = services();
  const enabled: string[] = await settings.get<string[]>("i18n.locales").catch((): string[] => [...GCS_LOCALES]);
  if (Array.isArray(enabled) && !enabled.includes(locale as string)) return;
  (await cookies()).set(LOCALE_COOKIE, locale as GcsLocale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  const actor = await currentActor();
  if (actor.userId) {
    await db.$executeRaw(sql`UPDATE users SET prefs = ${sqlJsonMerge("prefs", { locale: locale as string })} WHERE id = ${actor.userId}`);
  }
}

/**
 * Schimbă tema site-ului din subsol (meniul „Tema forumului”), fără JavaScript: doar dintre temele active; cookie pentru
 * oricine, plus preferința membrului (ca alegerea din Setări → Aspect).
 */
export async function setSkinChoice(formData: FormData): Promise<void> {
  if (!isSameOrigin(await headers())) return;
  const key = formData.get("skin");
  if (typeof key !== "string" || !/^[a-z0-9][a-z0-9-]{1,31}$/.test(key)) return;
  const { themes, db } = services();
  if (!(await themes.get(key))?.enabled) return;
  (await cookies()).set(SKIN_COOKIE, key, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  const actor = await currentActor();
  if (actor.userId) {
    await db.$executeRaw(sql`UPDATE users SET prefs = ${sqlJsonMerge("prefs", { skin: key })} WHERE id = ${actor.userId}`);
  }
}

/** Schimbă modul temei (dark / light / auto): cookie pentru oricine, plus preferința membrului. */
export async function setThemeMode(formData: FormData): Promise<void> {
  if (!isSameOrigin(await headers())) return;
  const mode = formData.get("mode");
  if (!isThemeMode(mode)) return;
  (await cookies()).set(THEME_COOKIE, mode, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  const actor = await currentActor();
  if (actor.userId) {
    await services().db.$executeRaw(sql`UPDATE users SET prefs = ${sqlJsonMerge("prefs", { theme: mode })} WHERE id = ${actor.userId}`);
  }
}
