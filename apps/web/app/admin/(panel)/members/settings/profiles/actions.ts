"use server";

import { GcsValidationError, type GcsResult } from "@gcs/core";
import type { FieldVisibility, ProfileFieldSection, ProfileFieldType } from "@gcs/db";
import { PROFILES_ACP_SECTION } from "@gcs/modules";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/** Imaginile opțiunilor (`IMAGE_SELECT`): câte un rând „Opțiune = URL”. */
function optionImages(raw: string): Record<string, string> {
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .map((line) => line.split("="))
      .filter((parts) => parts.length >= 2)
      .map(([option, ...url]) => [option!.trim(), url.join("=").trim()]),
  );
}

/** Opțiunile listei: editorul din panou trimite câte una pe rând (pot conține virgule); un singur rând = separate prin virgulă. */
function optionList(raw: string): string[] {
  return /\r?\n/.test(raw) ? raw.split(/\r?\n/) : raw.split(",");
}

export async function saveProfileField(id: number | null, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(PROFILES_ACP_SECTION, "edit", async (actor) => {
    await services().profileFields.save(actor, id, {
      key: field(fd, "key").trim(),
      label: field(fd, "label"),
      type: field(fd, "type") as ProfileFieldType,
      options: optionList(field(fd, "options")),
      section: field(fd, "section") as ProfileFieldSection,
      required: fd.get("required") === "on",
      maxLength: intField(fd, "maxLength"),
      visibility: field(fd, "visibility") as FieldVisibility,
      showOnCard: fd.get("showOnCard") === "on",
      position: intField(fd, "position"),
      icon: field(fd, "icon") || null,
      showInPostbit: fd.get("showInPostbit") === "on",
      optionImages: optionImages(field(fd, "optionImages")),
      groupId: field(fd, "groupId") ? Number(field(fd, "groupId")) : null,
      helper: field(fd, "helper"),
      linkTemplate: field(fd, "linkTemplate") || null,
    });
    return null;
  });
}

/** Un grup de câmpuri (profil gaming v2): cheia, titlul, textul de ajutor din formularul membrului, iconița și ordinea. */
export async function saveProfileFieldGroup(id: number | null, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(PROFILES_ACP_SECTION, "edit", async (actor) => {
    await services().profileFields.saveGroup(actor, id, {
      key: field(fd, "key").trim(),
      label: field(fd, "label"),
      helper: field(fd, "helper"),
      icon: field(fd, "icon") || null,
      position: intField(fd, "position"),
    });
    return null;
  });
}

export async function deleteProfileFieldGroup(id: number): Promise<GcsResult<null>> {
  return runAcpAction(PROFILES_ACP_SECTION, "delete", async (actor) => {
    await services().profileFields.deleteGroup(actor, id);
    return null;
  });
}

/** Ordinea câmpurilor din listă (tragere sau săgeți): toate id-urile, în ordinea nouă; serviciul verifică setul. */
export async function reorderProfileFields(ids: number[]): Promise<GcsResult<null>> {
  return runAcpAction(PROFILES_ACP_SECTION, "edit", async (actor) => {
    await services().profileFields.reorder(actor, Array.isArray(ids) ? ids.map(Number) : []);
    return null;
  });
}

/** Ordinea grupurilor de câmpuri (tragere sau săgeți): toate id-urile, în ordinea nouă. */
export async function reorderProfileFieldGroups(ids: number[]): Promise<GcsResult<null>> {
  return runAcpAction(PROFILES_ACP_SECTION, "edit", async (actor) => {
    await services().profileFields.reorderGroups(actor, Array.isArray(ids) ? ids.map(Number) : []);
    return null;
  });
}

export async function deleteProfileField(id: number): Promise<GcsResult<null>> {
  return runAcpAction(PROFILES_ACP_SECTION, "delete", async (actor) => {
    await services().profileFields.delete(actor, id);
    return null;
  });
}

/**
 * Ordinea câmpurilor din postbit (`postbit.fields`): lista din „Ordinea în postare” trimite `order.<cheie>` = poziția.
 * Doar câmpurile marcate „În postare”, fiecare o dată, cu poziții întregi.
 */
export async function savePostbitOrder(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(PROFILES_ACP_SECTION, "edit", async (actor) => {
    const { profiles, settings } = services();
    const entries = [...fd.entries()]
      .filter(([k]) => k.startsWith("order."))
      .map(([k, v]) => ({ key: k.slice(6), pos: typeof v === "string" && /^\d{1,3}$/.test(v.trim()) ? Number(v) : Number.NaN }));
    const postbit = new Set((await profiles.fields()).filter((f) => f.showInPostbit).map((f) => f.key));
    if (entries.some((e) => !postbit.has(e.key) || !Number.isInteger(e.pos)) || new Set(entries.map((e) => e.key)).size !== entries.length) {
      throw new GcsValidationError({ order: "invalid_order" });
    }
    const order = entries.sort((a, b) => a.pos - b.pos).map((e) => e.key);
    await settings.set("postbit.fields", order, actor);
    return null;
  });
}

/** Setările profilurilor (mărimea cover-ului, peretele activ). */
export async function saveProfileSettings(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(PROFILES_ACP_SECTION, "edit", async (actor) => {
    const { settings } = services();
    await settings.set("profile.cover_max_mb", Number(field(fd, "coverMaxMb")), actor);
    await settings.set("profile.wall_enabled", fd.get("wallEnabled") === "on", actor);
    // Semnătura: lungimea maximă (0 = fără semnături) și câte imagini poate avea.
    await settings.set("profile.signature_max_chars", Number(field(fd, "signatureMaxChars")), actor);
    await settings.set("profile.signature_max_images", Number(field(fd, "signatureMaxImages")), actor);
    // Profil gaming v2: cheia FACEIT (goală = neschimbată; „șterge” o golește). Pragul insignei „Sponsor” e în Donații › Setări.
    const faceit = field(fd, "faceitKey").trim();
    if (fd.get("faceitClear") === "on") await settings.set("profile.faceit_api_key", "", actor);
    else if (faceit) await settings.set("profile.faceit_api_key", faceit, actor);
    return null;
  });
}
