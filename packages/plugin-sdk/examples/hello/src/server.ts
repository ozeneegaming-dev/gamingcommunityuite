/**
 * Pluginul de exemplu `gcs.hello`. Se compilează (esbuild) într-un singur `server.mjs`, fără importuri la rulare:
 * `pnpm --filter @gcs/plugin-sdk build:example`.
 */
import { definePlugin, type GcsPluginContext } from "../../../src/index";

type LogRow = { post_id: number; topic_id: number; created_at: string };

async function seenCount(ctx: GcsPluginContext): Promise<number> {
  const [row] = await ctx.db.query<{ n: number }>("SELECT count(*)::int AS n FROM greetings_log");
  return row?.n ?? 0;
}

function greeting(ctx: GcsPluginContext): string {
  return `<p class="gcsp-hello__greeting"><gcs-icon name="fa-solid fa-hand"></gcs-icon> ${ctx.escape(ctx.settings.get<string>("greeting"))}</p>`;
}

export default definePlugin({
  widgets: {
    greeting: async (_input, ctx) => {
      const count = ctx.settings.get<boolean>("showCount") ? await seenCount(ctx) : null;
      return [
        `<div class="gcsp-hello" data-gcsp-widget="greeting">`,
        greeting(ctx),
        count === null ? "" : `<p class="gcs-muted">${ctx.escape(ctx.t("widget.count", { count }))}</p>`,
        `<a class="gcs-btn gcs-btn--ghost gcs-btn--sm" href="/p/gcs.hello">${ctx.escape(ctx.t("widget.open"))}</a>`,
        `</div>`,
      ].join("");
    },
  },

  pages: {
    "/": async (_input, ctx) => {
      // 0 = „Nelimitat” (setarea are opțiunea).
      const pageSize = ctx.settings.get<number>("pageSize") || 1000;
      const rows = await ctx.db.query<LogRow>("SELECT post_id, topic_id, created_at FROM greetings_log ORDER BY id DESC LIMIT $1", [pageSize]);
      const items = rows
        .map((r) => `<li><a href="/topic/${r.topic_id}/post/${r.post_id}">#${r.post_id}</a> <time datetime="${ctx.escape(r.created_at)}">${ctx.escape(new Date(r.created_at).toLocaleString(ctx.locale))}</time></li>`)
        .join("");
      return {
        title: ctx.t("page.title"),
        html: `<section class="gcsp-hello" data-gcsp-page="home">${greeting(ctx)}<p>${ctx.escape(ctx.t("page.intro"))}</p>${
          items ? `<ul class="gcsp-hello__list">${items}</ul>` : `<p class="gcs-muted">${ctx.escape(ctx.t("page.empty"))}</p>`
        }</section>`,
      };
    },
  },

  acp: {
    "/": async (_input, ctx) => {
      const [stats] = await ctx.db.query<{ total: number; today: number }>(
        "SELECT count(*)::int AS total, count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS today FROM greetings_log",
      );
      const stat = (label: string, value: number) => `<div class="gcsp-hello__stat"><small class="gcs-muted">${ctx.escape(label)}</small><h3>${value}</h3></div>`;
      return {
        title: ctx.t("acp.menu"),
        html: `<section class="gcsp-hello"><div class="gcsp-hello__stats">${stat(ctx.t("acp.total"), stats?.total ?? 0)}${stat(ctx.t("acp.today"), stats?.today ?? 0)}</div><p class="gcs-muted">${ctx.escape(ctx.t("acp.settings"))}</p></section>`,
      };
    },
  },

  api: {
    "/stats": async (_request, ctx) => ({ body: { posts: await seenCount(ctx), greeting: ctx.settings.get<string>("greeting") } }),
  },

  events: {
    "post.created": async (event, ctx) => {
      const { postId, topicId, authorId } = event.payload;
      if (typeof postId !== "number" || typeof topicId !== "number") return;
      await ctx.db.execute("INSERT INTO greetings_log (post_id, topic_id, author_id) VALUES ($1, $2, $3)", [postId, topicId, typeof authorId === "string" ? authorId : null]);
    },
  },

  hooks: {
    "postbit.after_fields": async (_data, ctx) => `<p class="gcsp-hello__badge"><gcs-icon name="fa-solid fa-hand"></gcs-icon> ${ctx.escape(ctx.t("postbit.badge"))}</p>`,
  },

  jobs: {
    cleanup: async (_data, ctx) => {
      const removed = await ctx.db.execute("DELETE FROM greetings_log WHERE created_at < now() - make_interval(days => $1)", [ctx.settings.get<number>("keepDays")]);
      ctx.log.info(`cleanup: ${removed} rows removed`);
    },
  },
});
