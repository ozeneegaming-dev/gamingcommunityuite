import "server-only";
import type { GcsSlotJson } from "@gcs/core";
import { getTimeZone } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { forumHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import type { GcsSlotComponentProps } from "@/lib/forum-slot-components";
import { GcsServerLiveProvider } from "../GcsServerLive";
import type { GcsServerCardData } from "../types";
import { forumServerData, propFields, propId, propIds, propStyle } from "./data";
import { GcsForumServerCardLive } from "./GcsForumServerCardLive";
import { GcsServerChips, GcsServerStateChip, GcsServerStrip, GcsServerSummary, GcsServerTopicBar } from "./GcsForumServerLive";

/**
 * Componentele de slot ale aplicației Servere (registrul `FORUM_SLOT_COMPONENTS`): fiecare citește serverele vizibile
 * din `forumServerData` (o dată pe cerere) și pune partea live într-un `GcsServerLiveProvider` cu serverele ei. Un
 * server ascuns vizitatorului (grupuri) sau oprit nu desenează nimic.
 */

async function one(props: GcsSlotComponentProps): Promise<{ server: GcsServerCardData; pollSeconds: number } | null> {
  const id = propId(props.serverId);
  if (id === null) return null;
  const { byId, pollSeconds } = await forumServerData();
  const server = byId.get(id);
  return server ? { server, pollSeconds } : null;
}

export async function ServersStateSlot(props: GcsSlotComponentProps) {
  const hit = await one(props);
  if (!hit) return null;
  return (
    <GcsServerLiveProvider initial={{ [hit.server.id]: hit.server.status }} pollSeconds={hit.pollSeconds}>
      <GcsServerStateChip server={hit.server} />
    </GcsServerLiveProvider>
  );
}

export async function ServersStripSlot(props: GcsSlotComponentProps) {
  const hit = await one(props);
  if (!hit) return null;
  return (
    <GcsServerLiveProvider initial={{ [hit.server.id]: hit.server.status }} pollSeconds={hit.pollSeconds}>
      <GcsServerStrip server={hit.server} style={propStyle(props.style)} fields={propFields(props.fields)} />
    </GcsServerLiveProvider>
  );
}

type ChipProp = { serverId: number; forumId: number; name: string; slug: string };
const chipProps = (v: GcsSlotJson | undefined): ChipProp[] =>
  Array.isArray(v)
    ? v
        .map((x) => (x && typeof x === "object" && !Array.isArray(x) ? x : null))
        .filter((x): x is Record<string, GcsSlotJson> => x !== null)
        .map((x) => ({ serverId: propId(x.serverId) ?? 0, forumId: propId(x.forumId) ?? 0, name: typeof x.name === "string" ? x.name : "", slug: typeof x.slug === "string" && /^[a-z0-9-]{1,120}$/.test(x.slug) ? x.slug : "forum" }))
        .filter((x) => x.serverId > 0 && x.forumId > 0 && x.name !== "")
        .slice(0, 60)
    : [];

export async function ServersChipsSlot(props: GcsSlotComponentProps) {
  const { byId, pollSeconds } = await forumServerData();
  // Toate subforumurile rămân (lista lor obișnuită e ascunsă de cipuri); unul cu server ascuns apare fără date live.
  const items = chipProps(props.items).map((c) => ({ server: byId.get(c.serverId) ?? null, name: c.name, href: forumHref({ id: c.forumId, slug: c.slug }) }));
  if (items.length === 0) return null;
  const visible = items.flatMap((i) => (i.server ? [i.server] : []));
  return (
    <GcsServerLiveProvider initial={Object.fromEntries(visible.map((s) => [s.id, s.status]))} pollSeconds={pollSeconds}>
      <GcsServerChips items={items} />
    </GcsServerLiveProvider>
  );
}

export async function ServersSummarySlot(props: GcsSlotComponentProps) {
  const { byId, pollSeconds } = await forumServerData();
  const servers = propIds(props.serverIds).flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  if (servers.length === 0) return null;
  return (
    <GcsServerLiveProvider initial={Object.fromEntries(servers.map((s) => [s.id, s.status]))} pollSeconds={pollSeconds}>
      <GcsServerSummary servers={servers} />
    </GcsServerLiveProvider>
  );
}

export async function ServersBarSlot(props: GcsSlotComponentProps) {
  const hit = await one(props);
  if (!hit) return null;
  return (
    <GcsServerLiveProvider initial={{ [hit.server.id]: hit.server.status }} pollSeconds={hit.pollSeconds}>
      <GcsServerTopicBar server={hit.server} fields={propFields(props.fields)} />
    </GcsServerLiveProvider>
  );
}

/** Ora de început a zilei de azi (în fusul vizitatorului), în ms. */
function startOfToday(timeZone: string, now: number): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(now));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0) % 24;
  return now - ((get("hour") * 60 + get("minute")) * 60 + get("second")) * 1000;
}

/** Cardul mare (macheta D): istoricul pe 24 h și lista jucătorilor (cu dreptul verificat) se citesc doar aici. */
export async function ServersCardSlot(props: GcsSlotComponentProps) {
  const hit = await one(props);
  if (!hit) return null;
  const { serverQueries } = services();
  const actor = await currentActor();
  const [details, history, timeZone] = await Promise.all([serverQueries.details(actor, hit.server.id), serverQueries.history(hit.server.id, "24h"), getTimeZone()]);
  if (!details) return null;
  const midnight = startOfToday(timeZone, Date.now());
  const today = history.buckets.filter((b) => Date.parse(b.at) + history.size * 1000 > midnight && b.peak !== null);
  const peakToday = today.length > 0 ? Math.max(...today.map((b) => b.peak ?? 0), hit.server.status?.online ? hit.server.status.players : 0) : null;
  return (
    <GcsServerLiveProvider initial={{ [hit.server.id]: hit.server.status }} pollSeconds={hit.pollSeconds} players={{ initial: details.players }}>
      <GcsForumServerCardLive server={hit.server} fields={propFields(props.fields)} history={history.buckets.map((b) => b.avg)} peakToday={peakToday} playersAllowed={!details.playersHidden} />
    </GcsServerLiveProvider>
  );
}
