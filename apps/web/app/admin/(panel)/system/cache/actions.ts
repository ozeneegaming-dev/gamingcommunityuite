"use server";

import type { GcsResult } from "@gcs/core";
import { CACHE_ACP_SECTION } from "@gcs/modules";
import { revalidatePath } from "next/cache";
import { runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/** Golește o zonă a cache-ului (cheile ei); paginile o recitesc din baza de date. */
export async function clearCacheArea(area: string): Promise<GcsResult<number>> {
  return runAcpAction(CACHE_ACP_SECTION, "edit", async (actor) => {
    const removed = await services().cacheAdmin.clearArea(actor, area);
    revalidatePath("/", "layout");
    return removed;
  });
}

/** Invalidează un tag (ca după o editare a datelor lui). */
export async function clearCacheTag(tag: string): Promise<GcsResult<null>> {
  return runAcpAction(CACHE_ACP_SECTION, "edit", async (actor) => {
    await services().cacheAdmin.clearTag(actor, tag);
    revalidatePath("/", "layout");
    return null;
  });
}

/** Golește tot cache-ul (datele și paginile randate ale Next.js). */
export async function clearAllCache(): Promise<GcsResult<number>> {
  return runAcpAction(CACHE_ACP_SECTION, "edit", async (actor) => {
    const removed = await services().cacheAdmin.clearAll(actor);
    revalidatePath("/", "layout");
    return removed;
  });
}
