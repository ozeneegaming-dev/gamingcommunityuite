import { currentActor } from "@/lib/actor";
import { iconData } from "@/lib/group-mentions";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const LIMIT = { window: 60, max: 60 };

/**
 * Sugestiile pentru @mențiuni din editor (Mențiuni v2): cel mult 10 membri al căror nume (fără diacritice) începe cu
 * textul scris (de la 2 caractere), cu avatarul, stilul numelui, statusul online și tagul clanului (dacă aplicația
 * Clanuri îl arată pe hover card). Cu `groups=1`, și grupurile pe care autorul le poate menționa (de la 1 caracter),
 * cu culoarea și iconița lor. Doar pentru useri autentificați; `users` păstrează și forma veche (`id`, `name`), folosită
 * de celelalte câmpuri cu sugestii (destinatari, ignorați, admini de server).
 */
export async function GET(req: Request): Promise<Response> {
  const actor = await currentActor();
  if (!actor.userId) return Response.json({ users: [], groups: [] }, { status: 401 });
  const { rateLimiter, mentionQueries, clanQueries } = services();
  const limit = await rateLimiter.consume(`mentions:${actor.userId}`, LIMIT);
  if (!limit.allowed) return Response.json({ users: [], groups: [] }, { status: 429 });

  const params = new URL(req.url).searchParams;
  const q = (params.get("q") ?? "").trim().slice(0, 40);
  const withGroups = params.get("groups") === "1";
  const [found, groups] = await Promise.all([mentionQueries.users(q), withGroups && q.length > 0 ? mentionQueries.groups(actor, q) : Promise.resolve([])]);
  // Tagul clanului: o singură interogare pentru toată lista (aplicația Clanuri, dacă îl arată pe hover card).
  const clans = found.length > 0 ? await clanQueries.tagsFor(found.map((u) => u.id), "hovercard").catch(() => new Map()) : new Map();
  const users = found.map((u) => {
    const clan = clans.get(u.id);
    return {
      id: u.id,
      name: u.name,
      image: u.image,
      nameKey: u.nameKey,
      online: u.online,
      clan: clan ? { tag: clan.tag, name: clan.name, color: clan.color, color2: clan.color2, ink: clan.ink } : null,
    };
  });
  return Response.json(
    { users, groups: groups.map((g) => ({ id: g.id, name: g.name, color: g.color, icon: iconData(g.icon) })) },
    { headers: { "Cache-Control": "private, max-age=30" } },
  );
}
