"use server";

import {
  GCS_WIDGET_PAGES,
  GcsValidationError,
  MAX_THEME_PACKAGE_BYTES,
  MENUS_ACP_SECTION,
  THEME_TOGGLE_SETTING,
  THEMES_ACP_SECTION,
  themeTogglePairError,
  WIDGETS_ACP_SECTION,
  type GcsNavItemInput,
  type GcsResult,
} from "@gcs/core";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { assertAcpAction } from "@/lib/acp";
import { field, runAcpAction } from "@/lib/acp-actions";
import { PAGE_EDIT_COOKIE } from "@/lib/appearance";
import { services } from "@/lib/services";

const cookieOpts = { path: "/", sameSite: "lax" as const, httpOnly: true, secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 12 };

// ─── Teme ────────────────────────────────────────────────────────────────────

export async function updateTheme(key: string, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(THEMES_ACP_SECTION, "edit", async (actor) => {
    await services().themes.update(actor, key, { name: field(fd, "name"), enabled: fd.get("enabled") === "on", isDefault: fd.get("isDefault") === "on" });
    return null;
  });
}

/** Tema nouă, copiată dintr-una existentă (sau din valorile implicite). */
export async function createTheme(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(THEMES_ACP_SECTION, "edit", async (actor) => {
    const from = field(fd, "from");
    await services().themes.create(actor, { key: field(fd, "key").trim().toLowerCase(), name: field(fd, "name"), ...(from ? { from } : {}) });
    return null;
  });
}

/** Importă o temă dintr-un fișier `.gcs-theme.json` (exportat din altă temă sau livrat separat). */
export async function importTheme(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(THEMES_ACP_SECTION, "edit", async (actor) => {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new GcsValidationError({ file: "required" });
    if (file.size > MAX_THEME_PACKAGE_BYTES) throw new GcsValidationError({ file: "too_large" });
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      throw new GcsValidationError({ file: "invalid_theme_package" });
    }
    await services().themes.importPackage(actor, raw);
    return null;
  });
}

/**
 * „Comutator întunecat/luminos”: perechea de teme a lunii / soarelui din antet, meniul contului și subsol. Ambele teme
 * trebuie să existe și să fie diferite; o temă dezactivată mai târziu ascunde comutatorul (fără erori).
 */
export async function saveThemeToggle(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(THEMES_ACP_SECTION, "edit", async (actor) => {
    const { themes, settings } = services();
    const pair = { enabled: fd.get("enabled") === "on", dark: field(fd, "dark"), light: field(fd, "light") };
    const error = themeTogglePairError(pair);
    if (error) throw new GcsValidationError({ [error === "same_theme" ? "light" : "dark"]: error });
    const keys = new Set((await themes.list()).map((t) => t.key));
    if (!keys.has(pair.dark)) throw new GcsValidationError({ dark: "invalid_choice" });
    if (!keys.has(pair.light)) throw new GcsValidationError({ light: "invalid_choice" });
    await settings.set(THEME_TOGGLE_SETTING, pair, actor);
    return null;
  });
}

export async function deleteTheme(key: string): Promise<GcsResult<null>> {
  return runAcpAction(THEMES_ACP_SECTION, "delete", async (actor) => {
    await services().themes.remove(actor, key);
    return null;
  });
}

// ─── Widget-uri ──────────────────────────────────────────────────────────────

const PAGE_PATHS: Record<string, string> = { index: "/", forum: "/", topic: "/" };

/** „Editează pe site”: modul „Editează pagina” pornit, pe pagina principală (forumurile și topicurile au același buton). */
export async function editWidgetsOnSite(page: string): Promise<void> {
  await assertAcpAction(WIDGETS_ACP_SECTION, "edit");
  (await cookies()).set(PAGE_EDIT_COOKIE, "1", cookieOpts);
  redirect(PAGE_PATHS[page] ?? "/");
}

export async function resetWidgets(page: string): Promise<GcsResult<null>> {
  return runAcpAction(WIDGETS_ACP_SECTION, "edit", async (actor) => {
    if (!(GCS_WIDGET_PAGES as readonly string[]).includes(page)) return null;
    await services().widgets.reset(actor, page);
    return null;
  });
}

// ─── Meniul principal ────────────────────────────────────────────────────────

/** Salvează tot meniul (arborele trimis de editor); validarea completă e în `GcsNavService`. */
export async function saveMenu(items: GcsNavItemInput[]): Promise<GcsResult<null>> {
  return runAcpAction(MENUS_ACP_SECTION, "edit", async (actor) => {
    await services().nav.save(actor, items);
    return null;
  });
}
