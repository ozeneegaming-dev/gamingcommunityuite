"use server";

import type { GcsResult } from "@gcs/core";
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

export async function saveProfileField(id: number | null, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(PROFILES_ACP_SECTION, "edit", async (actor) => {
    await services().profileFields.save(actor, id, {
      key: field(fd, "key").trim(),
      label: field(fd, "label"),
      type: field(fd, "type") as ProfileFieldType,
      options: field(fd, "options").split(/\r?\n|,/),
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

export async function deleteProfileField(id: number): Promise<GcsResult<null>> {
  return runAcpAction(PROFILES_ACP_SECTION, "delete", async (actor) => {
    await services().profileFields.delete(actor, id);
    return null;
  });
}

/** Ordinea câmpurilor din postbit (`postbit.fields`): după numerele din formular. */
export async function savePostbitOrder(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(PROFILES_ACP_SECTION, "edit", async (actor) => {
    const order = [...fd.entries()]
      .filter(([k]) => k.startsWith("order."))
      .map(([k, v]) => ({ key: k.slice(6), pos: Number(v) }))
      .sort((a, b) => a.pos - b.pos)
      .map((e) => e.key);
    await services().settings.set("postbit.fields", order, actor);
    return null;
  });
}

/** Setările profilurilor (mărimea cover-ului, peretele activ). */
export async function saveProfileSettings(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(PROFILES_ACP_SECTION, "edit", async (actor) => {
    const { settings } = services();
    await settings.set("profile.cover_max_mb", Number(field(fd, "coverMaxMb")), actor);
    await settings.set("profile.wall_enabled", fd.get("wallEnabled") === "on", actor);
    // Profil gaming v2: pragul insignei „Sponsor” și cheia FACEIT (goală = neschimbată; „șterge” o golește).
    if (fd.has("sponsorMin")) await settings.set("profile.sponsor_min_amount", Number(field(fd, "sponsorMin")), actor);
    const faceit = field(fd, "faceitKey").trim();
    if (fd.get("faceitClear") === "on") await settings.set("profile.faceit_api_key", "", actor);
    else if (faceit) await settings.set("profile.faceit_api_key", faceit, actor);
    return null;
  });
}
