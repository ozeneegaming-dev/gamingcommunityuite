"use server";

import type { GcsResult } from "@gcs/core";
import { ADS_ACP_SECTION, type GcsAdInput } from "@gcs/modules";
import { field, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/** O dată `YYYY-MM-DD` din formular (miezul nopții UTC) sau `null`. */
const day = (v: string): Date | null => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null);

function inputOf(fd: FormData): GcsAdInput {
  return {
    name: field(fd, "name"),
    kind: field(fd, "kind") === "html" ? "html" : "image",
    imageUrl: field(fd, "imageUrl").trim(),
    linkUrl: field(fd, "linkUrl").trim(),
    alt: field(fd, "alt"),
    html: field(fd, "html"),
    enabled: field(fd, "enabled") === "on",
    hideGroups: fd
      .getAll("hideGroup")
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0),
    startsAt: day(field(fd, "startsAt")),
    endsAt: day(field(fd, "endsAt")),
  };
}

export async function saveAd(id: number | null, fd: FormData): Promise<GcsResult<{ id: number }>> {
  return runAcpAction(ADS_ACP_SECTION, "edit", (actor) => services().ads.save(actor, id, inputOf(fd)));
}

export async function deleteAd(id: number): Promise<GcsResult<null>> {
  return runAcpAction(ADS_ACP_SECTION, "delete", async (actor) => {
    await services().ads.remove(actor, id);
    return null;
  });
}

export async function resetAdStats(id: number): Promise<GcsResult<null>> {
  return runAcpAction(ADS_ACP_SECTION, "edit", async (actor) => {
    await services().ads.resetStats(actor, id);
    return null;
  });
}
