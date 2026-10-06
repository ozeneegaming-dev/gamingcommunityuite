import type { GcsActor } from "@gcs/core";
import { TEST_OUTBOX_KEY } from "@gcs/modules/services";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

type Body =
  | { action: "vip"; email: string; groupKey: string; days: number | null; asPrimary?: boolean }
  | { action: "frame"; email: string; frameKey: string | null; styleKey?: string | null }
  | { action: "ignore"; email: string; ignoredEmail: string; posts: boolean; messages: boolean }
  | { action: "conversation"; fromEmail: string; toEmails: string[]; title: string; text: string }
  | { action: "evaluate"; email: string }
  | { action: "expire"; email: string }
  | { action: "sweep" }
  | { action: "outbox" }
  | { action: "digest" };

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

async function actorFor(email: string): Promise<GcsActor> {
  const { db } = services();
  const user = await db.user.findUniqueOrThrow({ where: { email: email.toLowerCase() }, include: { groups: true } });
  return { userId: user.id, groupIds: [user.primaryGroupId, ...user.groups.map((g) => g.groupId)], primaryGroupId: user.primaryGroupId, isBanned: false, ip: "e2e" };
}

/** Un Root Admin „de sistem” (fără user). */
async function rootActor(): Promise<GcsActor> {
  const root = await services().db.group.findUniqueOrThrow({ where: { key: "root_admin" } });
  return { userId: null, groupIds: [root.id], primaryGroupId: root.id, isBanned: false, ip: "e2e" };
}

/**
 * Datele etapei 3 pentru testele E2E (`POST /api/_test/profile`), prin serviciile reale. Există doar cu `GCS_TEST_ROUTES=1`.
 * Joburile (evaluarea regulilor, expirarea VIP) se pot declanșa direct, ca testele să nu aștepte worker-ul.
 */
export async function POST(req: Request): Promise<Response> {
  if (process.env.GCS_TEST_ROUTES !== "1") return new Response(null, { status: 404 });
  const body = (await req.json()) as Body;
  const s = services();
  switch (body.action) {
    case "vip": {
      const group = await s.db.group.findUniqueOrThrow({ where: { key: body.groupKey } });
      const user = await actorFor(body.email);
      const sub = await s.vip.grant(await rootActor(), { userId: user.userId!, groupId: group.id, days: body.days, asPrimary: body.asPrimary ?? true });
      return Response.json({ id: sub.id });
    }
    case "frame": {
      const actor = await actorFor(body.email);
      const frame = body.frameKey ? await s.db.avatarFrame.findUniqueOrThrow({ where: { key: body.frameKey } }) : null;
      const style = body.styleKey ? await s.db.nameStyle.findUniqueOrThrow({ where: { key: body.styleKey } }) : null;
      await s.cosmetics.choose(actor, { avatarFrameId: frame?.id ?? null, ...(body.styleKey !== undefined ? { nameStyleId: style?.id ?? null } : {}) });
      return Response.json({ ok: true });
    }
    case "ignore": {
      const ignored = await actorFor(body.ignoredEmail);
      await s.social.ignore(await actorFor(body.email), ignored.userId!, { posts: body.posts, messages: body.messages });
      return Response.json({ ok: true });
    }
    case "conversation": {
      const from = await actorFor(body.fromEmail);
      const to = await Promise.all(body.toEmails.map(async (e) => (await actorFor(e)).userId!));
      await s.redis.del(`gcs:rl:pm:${from.userId}`);
      const res = await s.conversations.start(from, { to, title: body.title, content: doc(body.text) });
      await s.redis.del(`gcs:rl:pm:${from.userId}`);
      return Response.json(res);
    }
    case "evaluate": {
      await s.achievements.evaluate((await actorFor(body.email)).userId!);
      return Response.json({ ok: true });
    }
    case "expire": {
      const user = await actorFor(body.email);
      await s.db.vipSubscription.updateMany({ where: { userId: user.userId!, status: "ACTIVE" }, data: { expiresAt: new Date(Date.now() - 1000) } });
      return Response.json({ ok: true });
    }
    case "sweep":
      return Response.json(await s.vip.sweep());
    case "digest":
      return Response.json({ sent: await s.notificationProducers.digest() });
    case "outbox": {
      const mails = await s.redis.lrange(TEST_OUTBOX_KEY, 0, 49);
      return Response.json(mails.map((m) => JSON.parse(m) as unknown));
    }
  }
}
