import { currentActor } from "@/lib/actor";
import { memberLook } from "@/lib/member-look";
import { services } from "@/lib/services";
import { hoverCardVars } from "@/lib/template-data";
import { siteTemplateHtml } from "@/lib/templates";
import { groupPillProps } from "@/lib/group-pills";
import { iconData } from "@/lib/group-mentions";
import { namesHtml } from "@/lib/member-names";

export const dynamic = "force-dynamic";

/** Iconița unui grup fără iconiță aleasă (ca pe pastilele `@Grup` și pe cardul grupului). */
const DEFAULT_GROUP_ICON = "fa-solid fa-users";

/**
 * Datele hover card-ului (spec §8): `GET /api/users/{id}/card`. Partea comună e cache-uită în Redis 60 s;
 * clientul păstrează răspunsul 5 minute. Un profil pe care viewer-ul nu-l vede dă 404. Dacă tema viewer-ului a
 * modificat șablonul `members.hover_card`, răspunsul are și `html` (randat și sanitizat pe server).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  if (!/^[a-z0-9]{8,40}$/i.test(id)) return new Response(null, { status: 404 });
  // Hover card v2: cardul de bază plus nivelul, statusul (online / pe server / ultima vizită) și cipurile aplicațiilor.
  const card = await services().hoverCards.load(await currentActor(), id);
  if (!card) return new Response(null, { status: 404 });
  // Tagul clanului lângă nume (aplicația Clanuri, dacă opțiunile îl arată pe hover card).
  const clan = (await services().clanQueries.tagsFor([card.user.id], "hovercard")).get(card.user.id) ?? null;
  const rawHtml = await siteTemplateHtml("members.hover_card", hoverCardVars(card, clan));
  // Numele din șablon: markup-ul comun (stilul de acum, literele efectelor pe litere).
  const html = rawHtml === null ? null : await namesHtml(rawHtml);
  // Aspectul publicat de pluginuri (Studio VIP): banner-ul, fundalul copertei și arma, cu stilurile calculate de GCS.
  const look = await memberLook(card.user.id);
  // Grupul afișat și grupurile secundare: pastile-link spre membrii grupului, cu tooltip-ul numărătorii și iconița
  // grupului (rândul grupului și „Alte grupuri” din cardul v3; datele SVG, registrul de iconițe rămâne pe server).
  const mg = (await services().groupDirectory.memberGroups([card.user.id])).get(card.user.id);
  const pill = async (groupId: number) => {
    const p = await groupPillProps(groupId);
    return p
      ? { id: p.group.id, name: p.group.name, color: p.group.color, href: p.href ?? null, tooltip: p.tooltip ?? [], ariaLabel: p.ariaLabel ?? p.group.name, icon: iconData(p.ref.icon) ?? iconData(DEFAULT_GROUP_ICON) }
      : null;
  };
  const shown = mg ? await pill(mg.shown.id) : null;
  const secondaryGroups = mg ? (await Promise.all(mg.secondary.map((g) => pill(g.id)))).filter((g) => g !== null) : [];
  const user = shown ? { ...card.user, group: { ...card.user.group, ...shown, name: mg!.shown.title ?? shown.name } } : card.user;
  return Response.json(
    { ...card, user, secondaryGroups, clan, html, look: look ? { banner: look.banner, card: look.card, flair: look.flair } : null },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
