"use server";

import type { GcsResult } from "@gcs/core";
import { SERVER_ADMINS_ACP_SECTION, type GcsServerAdminInput } from "@gcs/modules";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

const optionalInt = (fd: FormData, name: string) => (field(fd, name).trim() === "" ? null : intField(fd, name));

/** Câmpurile formularului de admin (ACP → Gaming → Admini servere). */
function adminInput(fd: FormData): GcsServerAdminInput {
  const kind = field(fd, "identityKind");
  return {
    subject: field(fd, "subject") as GcsServerAdminInput["subject"],
    userId: field(fd, "userId") || null,
    identity: field(fd, "identity") || null,
    identityKind: kind === "nonsteam" ? "nonsteam" : "steam",
    name: field(fd, "name"),
    password: field(fd, "password"),
    serverId: optionalInt(fd, "serverId"),
    presetId: optionalInt(fd, "presetId"),
    // Flag-urile proprii doar cu „Flag-uri proprii” bifat; altfel cele ale presetului.
    flags: fd.get("customFlags") === "on" ? fd.getAll("flag").filter((v): v is string => typeof v === "string").join("") : null,
    immunity: optionalInt(fd, "immunity"),
    allowNonSteam: fd.get("allowNonSteam") === "on",
    note: field(fd, "note"),
    expiresAt: field(fd, "expiresAt") || null,
  };
}

export async function saveServerAdmin(id: number | null, fd: FormData): Promise<GcsResult<{ id: number }>> {
  return runAcpAction(SERVER_ADMINS_ACP_SECTION, "edit", (actor) => services().bridge.admins.save(actor, id, adminInput(fd)));
}

export async function deleteServerAdmin(id: number): Promise<GcsResult<null>> {
  return runAcpAction(SERVER_ADMINS_ACP_SECTION, "delete", async (actor) => {
    await services().bridge.admins.remove(actor, id);
    return null;
  });
}

export async function saveAdminPreset(id: number | null, fd: FormData): Promise<GcsResult<{ id: number }>> {
  return runAcpAction(SERVER_ADMINS_ACP_SECTION, "edit", (actor) =>
    services().bridge.admins.savePreset(actor, id, { name: field(fd, "name"), flags: fd.getAll("flag").filter((v): v is string => typeof v === "string").join(""), immunity: intField(fd, "immunity") }),
  );
}

export async function deleteAdminPreset(id: number): Promise<GcsResult<null>> {
  return runAcpAction(SERVER_ADMINS_ACP_SECTION, "delete", async (actor) => {
    await services().bridge.admins.removePreset(actor, id);
    return null;
  });
}
