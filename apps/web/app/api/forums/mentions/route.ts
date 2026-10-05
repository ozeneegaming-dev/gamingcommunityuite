import { normalizeUsername } from "@gcs/core";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const LIMIT = { window: 60, max: 60 };

/**
 * Sugestiile pentru @mențiuni din editor: membrii al căror nume (fără diacritice) începe cu textul scris.
 * Doar pentru useri autentificați; răspunde `{ users: [{ id, name }] }`.
 */
export async function GET(req: Request): Promise<Response> {
  const actor = await currentActor();
  if (!actor.userId) return Response.json({ users: [] }, { status: 401 });
  const { db, rateLimiter } = services();
  const limit = await rateLimiter.consume(`mentions:${actor.userId}`, LIMIT);
  if (!limit.allowed) return Response.json({ users: [] }, { status: 429 });

  const q = normalizeUsername(new URL(req.url).searchParams.get("q") ?? "");
  if (q.length < 2 || q.length > 40) return Response.json({ users: [] });
  const users = await db.user.findMany({
    where: { nameNormalized: { startsWith: q } },
    orderBy: [{ postsCount: "desc" }, { name: "asc" }],
    take: 8,
    select: { id: true, name: true },
  });
  return Response.json({ users }, { headers: { "Cache-Control": "private, max-age=30" } });
}
