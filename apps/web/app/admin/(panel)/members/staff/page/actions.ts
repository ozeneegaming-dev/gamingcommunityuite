"use server";

import { GcsValidationError, type GcsResult } from "@gcs/core";
import { STAFF_LAYOUTS, STAFF_PAGE_ACP_SECTION, type GcsStaffLayout, type GcsStaffSectionInput } from "@gcs/modules";
import { field, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/** Secțiunile paginii Staff (ordinea listei, titlul benzii, aspectul, vizibilitatea). */
export async function saveStaffSections(input: GcsStaffSectionInput[]): Promise<GcsResult<null>> {
  return runAcpAction(STAFF_PAGE_ACP_SECTION, "edit", async (actor) => {
    if (!Array.isArray(input) || input.length > 50) throw new GcsValidationError({ sections: "invalid" });
    const clean = input.map((s) => ({
      groupId: Number(s?.groupId),
      title: typeof s?.title === "string" ? s.title : null,
      layout: (STAFF_LAYOUTS as readonly string[]).includes(s?.layout) ? (s.layout as GcsStaffLayout) : ("detailed" as const),
      enabled: s?.enabled !== false,
    }));
    await services().staffPage.saveSections(actor, clean);
    return null;
  });
}

/** Ordinea membrilor unei secțiuni (drag & drop). */
export async function reorderStaffMembers(groupId: number, userIds: string[]): Promise<GcsResult<null>> {
  return runAcpAction(STAFF_PAGE_ACP_SECTION, "edit", async (actor) => {
    if (!Array.isArray(userIds) || userIds.some((id) => typeof id !== "string")) throw new GcsValidationError({ order: "invalid_order" });
    await services().staffPage.reorderMembers(actor, groupId, userIds);
    return null;
  });
}

/** Descrierea (document din editor, câmpul `descriptionDoc`) și responsabilitățile (un rând = una). */
export async function saveStaffProfile(userId: string, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(STAFF_PAGE_ACP_SECTION, "edit", async (actor) => {
    let description: unknown = null;
    try {
      description = JSON.parse(field(fd, "descriptionDoc") || "null") as unknown;
    } catch {
      description = null;
    }
    await services().staffPage.saveProfile(actor, userId, { description, duties: field(fd, "duties").split(/\r?\n/) });
    return null;
  });
}
