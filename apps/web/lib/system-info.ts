import "server-only";
import { statfs } from "node:fs/promises";
import pkg from "../package.json";

/** Versiunea aplicației: `GCS_VERSION` (setată la build/deploy) sau versiunea pachetului web. */
export const GCS_APP_VERSION: string = process.env.GCS_VERSION?.trim() || pkg.version;

/** Spațiul pe disc al volumului aplicației (octeți), sau `null` dacă sistemul nu îl raportează. */
export async function diskUsage(path = process.cwd()): Promise<{ free: number; total: number } | null> {
  try {
    const s = await statfs(path);
    const total = Number(s.blocks) * Number(s.bsize);
    const free = Number(s.bavail) * Number(s.bsize);
    return total > 0 ? { free, total } : null;
  } catch {
    return null;
  }
}
