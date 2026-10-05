"use server";

import type { GcsResult } from "@gcs/core";
import type { FieldVisibility, ProfileFieldSection, ProfileFieldType } from "@gcs/db";
import { PROFILES_ACP_SECTION } from "@gcs/modules";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

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
    });
    return null;
  });
}

export async function deleteProfileField(id: number): Promise<GcsResult<null>> {
  return runAcpAction(PROFILES_ACP_SECTION, "delete", async (actor) => {
    await services().profileFields.delete(actor, id);
    return null;
  });
}

/** Setările profilurilor (mărimea cover-ului, peretele activ). */
export async function saveProfileSettings(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(PROFILES_ACP_SECTION, "edit", async (actor) => {
    const { settings } = services();
    await settings.set("profile.cover_max_mb", Number(field(fd, "coverMaxMb")), actor);
    await settings.set("profile.wall_enabled", fd.get("wallEnabled") === "on", actor);
    return null;
  });
}
