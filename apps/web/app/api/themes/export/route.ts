import { GcsValidationError, THEMES_ACP_SECTION, toResult } from "@gcs/core";
import { assertAcpAction } from "@/lib/acp";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * Pachetul unei teme (ACP → Aspect → Teme → Exportă): `GET ?key=<cheia>` descarcă `<cheia>.gcs-theme.json` (setările și
 * fișierele CSS, fără imaginile site-ului), care se poate încărca pe alt site din aceeași pagină.
 */
export async function GET(req: Request): Promise<Response> {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  const result = await toResult(async () => {
    if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(key)) throw new GcsValidationError({ key: "invalid_key" });
    const actor = await assertAcpAction(THEMES_ACP_SECTION, "view");
    return services().themes.exportPackage(actor, key);
  });
  if (!result.ok) return Response.json(result, { status: result.error.status });
  return new Response(`${JSON.stringify(result.data, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${key}.gcs-theme.json"`,
      "Cache-Control": "no-store",
    },
  });
}
