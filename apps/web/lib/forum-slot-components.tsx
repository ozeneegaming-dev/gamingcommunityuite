import type { GcsSlotJson } from "@gcs/core";
import type { ComponentType } from "react";
import { GcsForumServerTab } from "@/app/admin/(panel)/community/forums/[id]/GcsForumServerTab";
import { ServersBarSlot, ServersCardSlot, ServersChipsSlot, ServersStateSlot, ServersStripSlot, ServersSummarySlot } from "@/app/(site)/_components/servers/forum/slots";

/** Props-urile JSON ale unei componente de slot (cele trimise de extensie în `{ kind: "component", props }`). */
export type GcsSlotComponentProps = Record<string, GcsSlotJson>;

/**
 * Registrul componentelor de slot ale site-ului (Forum v2): o extensie de forum a unei aplicații trimite
 * `{ kind: "component", component: "<aplicație>.<nume>", props }`, iar site-ul desenează componenta de aici. Componenta
 * (server sau client) primește props-urile JSON și trebuie să-și verifice singură datele. O cheie necunoscută nu desenează
 * nimic (ex. o aplicație dezinstalată).
 *
 * Aplicațiile își adaugă componentele aici, cu prefixul cheii lor de modul (ex. `servers.status`), ca la `profileTabs`.
 * Taburile din formularul ACP (`GcsForumEditTab.component`) au registrul lor, `FORUM_TAB_COMPONENTS`, mai jos.
 */
export const FORUM_SLOT_COMPONENTS: Record<string, ComponentType<GcsSlotComponentProps>> = {
  // Aplicația Servere: serverele ca forumuri (macheta `ServerForum`).
  "servers.state": ServersStateSlot,
  "servers.strip": ServersStripSlot,
  "servers.chips": ServersChipsSlot,
  "servers.summary": ServersSummarySlot,
  "servers.card": ServersCardSlot,
  "servers.bar": ServersBarSlot,
};

/** Props-urile unui tab contribuit desenat de o componentă (`GcsForumEditTab.component`). */
export type GcsForumTabComponentProps = { forumId: number; extension: string; tab: string; values: Record<string, unknown> };

/** Componentele taburilor din formularul ACP al forumului, după cheie (vezi `GcsForumEditTab.component`). */
export const FORUM_TAB_COMPONENTS: Record<string, ComponentType<GcsForumTabComponentProps>> = {
  "servers.forumTab": GcsForumServerTab,
};
