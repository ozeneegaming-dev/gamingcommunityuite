"use server";

import { cookies, headers } from "next/headers";
import { GCS_LOCALES, LOCALE_COOKIE, type GcsLocale } from "@/i18n";
import { currentActor } from "@/lib/actor";
import { isSameOrigin } from "@/lib/actions";
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
    await db.$executeRaw`UPDATE users SET prefs = prefs || jsonb_build_object('locale', ${locale as string}::text) WHERE id = ${actor.userId}`;
  }
}
