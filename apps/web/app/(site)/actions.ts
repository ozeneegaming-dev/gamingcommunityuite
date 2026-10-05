"use server";

import { cookies, headers } from "next/headers";
import { GCS_LOCALES, LOCALE_COOKIE, type GcsLocale } from "@/i18n";
import { isSameOrigin } from "@/lib/actions";

/** Schimbă limba UI-ului (cookie de un an). */
export async function setLocale(formData: FormData): Promise<void> {
  if (!isSameOrigin(await headers())) return;
  const locale = formData.get("locale");
  if (!GCS_LOCALES.includes(locale as GcsLocale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale as GcsLocale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
}
