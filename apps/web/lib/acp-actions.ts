import "server-only";
import { GcsForbidden, toResult, type GcsAcpRight, type GcsActor, type GcsResult } from "@gcs/core";
import { headers } from "next/headers";
import { isSameOrigin } from "./actions";
import { assertAcpAction } from "./acp";

/**
 * Corpul comun al Server Actions din ACP: CSRF (Origin), poarta ACP (2FA, reautentificare),
 * dreptul pe secțiune și `GcsResult`. Permisiunile fine (ex. protecția Root) le verifică serviciile din `core`.
 */
export async function runAcpAction<T>(
  section: string,
  right: GcsAcpRight,
  fn: (actor: GcsActor) => Promise<T>,
): Promise<GcsResult<T>> {
  return toResult(async () => {
    if (!isSameOrigin(await headers())) throw new GcsForbidden({ reason: "csrf" });
    const actor = await assertAcpAction(section, right);
    return fn(actor);
  });
}

/** Citește un câmp text dintr-un FormData. */
export const field = (fd: FormData, name: string): string => {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
};

/** Citește un întreg dintr-un FormData (NaN dacă lipsește sau e invalid). */
export const intField = (fd: FormData, name: string): number => {
  const v = field(fd, name).trim();
  return /^-?\d+$/.test(v) ? Number(v) : Number.NaN;
};
