import { definePlugin, type GcsPluginContext, type GcsPluginForumListInput, type GcsPluginForumListResult, type GcsPluginForumListSlots } from "../../../src/index";
import { autoBadgeForums, inheritedStyle, subBadge, type GcsServerState, type GcsSubBadge } from "./aspect";

/**
 * Pluginul „Aspect forumuri”: aproape tot aspectul vine din câmpurile declarate în `plugin.json` (nucleul le salvează și
 * desenează stilul în orice temă). Aici rămân doar fundalul moștenit de subforumuri și insignele ON / OFF / NOU din lista
 * subforumurilor (automate după starea serverelor legate, când aplicația Servere e pornită).
 */
function badgeHtml(badge: GcsSubBadge, ctx: GcsPluginContext): string {
  const tip = badge.server
    ? badge.server.online
      ? ctx.t("badge.serverTip", { name: badge.server.name, players: badge.server.players, max: badge.server.maxPlayers })
      : ctx.t("badge.serverOff", { name: badge.server.name })
    : "";
  const title = tip ? ` title="${ctx.escape(tip)}"` : "";
  return `<span class="gcs-slotChip gcs-slotTone--${badge.tone}"${title}>${ctx.escape(ctx.t(badge.label))}</span>`;
}

export default definePlugin({
  hooks: {
    "forum.list": async (data, ctx) => {
      const input = data as unknown as GcsPluginForumListInput;
      const auto = autoBadgeForums(input.nodes);
      const servers: Record<string, GcsServerState> = auto.length > 0 ? await ctx.api.servers.byForums(auto).catch(() => ({})) : {};
      const out: GcsPluginForumListResult = {};
      for (const node of input.nodes) {
        const slots: GcsPluginForumListSlots = {};
        const style = inheritedStyle(node);
        if (style) slots.style = style;
        const subs: Record<string, string> = {};
        for (const child of node.children ?? []) {
          const badge = subBadge(child.data, servers[String(child.id)]);
          if (badge) subs[String(child.id)] = badgeHtml(badge, ctx);
        }
        if (Object.keys(subs).length > 0) slots.subs = subs;
        if (slots.style || slots.subs) out[String(node.id)] = slots;
      }
      return out;
    },
  },
});
