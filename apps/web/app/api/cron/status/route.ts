import { cronLastRun } from "@/lib/cron";

export const dynamic = "force-dynamic";

/**
 * Când a rulat ultima dată cron-ul (ediția Lite): `{ lastRunAt: ms | null }`. Public și fără date sensibile: îl
 * citește pasul final al instalării (după instalare, rutele `/install` nu mai răspund) și ACP › Sistem › Cron.
 */
export async function GET(): Promise<Response> {
  return Response.json({ lastRunAt: await cronLastRun() }, { headers: { "Cache-Control": "no-store" } });
}
