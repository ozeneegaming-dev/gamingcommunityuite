import { GcsForbidden, GcsNotFound, GcsRateLimited, GcsValidationError, toResult, WIDGETS_ACP_SECTION, type GcsForumExtField } from "@gcs/core";
import { FORUMS_ACP_SECTION } from "@gcs/modules";
import { headers } from "next/headers";
import { assertAcpAction } from "@/lib/acp";
import { isSameOrigin } from "@/lib/actions";
import { safeModeActive } from "@/lib/plugins";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 6 * 1024 * 1024;
const UPLOAD_LIMIT = { window: 3600, max: 120 };

/**
 * O imagine a unui câmp `image` dintr-un tab contribuit (Aspect forumuri: iconița, fundalul unui forum sau al benzii unui
 * widget): `multipart/form-data` cu `file`, `scope` (`forum` / `widget`), `id` (forumul sau amplasarea), `extension`,
 * `tab` și `field`. Limitele (mărime, latură, animație) le dă câmpul declarat, nu clientul; dreptul e cel de editare din
 * ACP (forumuri sau widget-uri). Răspunde cu `GcsResult<{ id, url }>`; id-ul intră în formular și se salvează cu el.
 */
export async function POST(req: Request): Promise<Response> {
  const result = await toResult(async () => {
    const h = await headers();
    if (!isSameOrigin(h)) throw new GcsForbidden({ reason: "csrf" });
    if (Number(h.get("content-length") ?? "0") > MAX_BODY_BYTES) throw new GcsValidationError({ file: "too_large" });
    const form = await req.formData().catch(() => null);
    const get = (key: string) => {
      const v = form?.get(key);
      return typeof v === "string" ? v : "";
    };
    const file = form?.get("file");
    const scope = get("scope");
    const id = Number(get("id"));
    if (!(file instanceof File) || file.size === 0) throw new GcsValidationError({ file: "required" });
    if ((scope !== "forum" && scope !== "widget") || !Number.isSafeInteger(id) || id <= 0) throw new GcsValidationError({ scope: "invalid" });
    const actor = await assertAcpAction(scope === "forum" ? FORUMS_ACP_SECTION : WIDGETS_ACP_SECTION, "edit");
    const { db, forumSlots, widgets, attachments, rateLimiter } = services();
    const plugins = !(await safeModeActive());

    // Câmpul declarat (tipul `image`), din tabul extensiei active pe ținta aleasă.
    let fields: readonly GcsForumExtField[] = [];
    if (scope === "forum") {
      const forum = await db.forum.findUnique({ where: { id }, select: { id: true, type: true } });
      if (!forum) throw new GcsNotFound();
      fields = (await forumSlots.editTabs(forum, { plugins })).find((x) => x.extension === get("extension") && x.tab.key === get("tab"))?.tab.fields ?? [];
    } else {
      const placement = await widgets.placement(id);
      if (!placement) throw new GcsNotFound();
      fields = (await widgets.editTabs(placement.config, { plugins })).find((x) => x.extension === get("extension") && x.tab.key === get("tab"))?.tab.fields ?? [];
    }
    const field = fields.find((f) => f.key === get("field"));
    if (!field || field.type !== "image") throw new GcsNotFound();

    const limit = await rateLimiter.consume(`decor-upload:${actor.userId}`, UPLOAD_LIMIT);
    if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });
    const uploaded = await attachments.storeDecorImage(
      actor.userId,
      { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) },
      { maxBytes: field.maxKb * 1024, maxSide: field.maxSide, animated: field.animated ?? false, target: `${scope}:${id}:${field.key}` },
    );
    return { id: uploaded.id, url: uploaded.url };
  });
  return Response.json(result, { status: result.ok ? 200 : result.error.status });
}
