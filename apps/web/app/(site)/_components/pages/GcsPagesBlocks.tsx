import type { GcsActor } from "@gcs/core";
import { columnCount, type GcsPagesBlock, type GcsPagesLayout } from "@gcs/modules";
import { GcsIcon } from "@gcs/ui/icons";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense, type ReactNode } from "react";
import { GcsNamedHtml } from "@/lib/member-names";
import { services } from "@/lib/services";
import { WIDGET_RENDERERS } from "../widgets/registry";
import { GcsRecordList } from "./GcsRecordList";

type Ctx = { actor: GcsActor; path: string; folderId: number | null };

/** Titlul unui bloc (cu iconița), dacă are unul. */
function BlockTitle({ block }: { block: GcsPagesBlock }) {
  if (!block.title) return null;
  return (
    <h2 className="gcs-pgBlock__title">
      {block.icon && <GcsIcon name={block.icon} />}
      {block.title}
    </h2>
  );
}

/** Un bloc randat; o eroare într-un bloc (ex. un widget) îl ascunde doar pe el. */
async function GcsPagesBlockView({ block, ctx, narrow }: { block: GcsPagesBlock; ctx: Ctx; narrow: boolean }): Promise<ReactNode> {
  if (block.groups.length > 0 && !block.groups.some((g) => ctx.actor.groupIds.includes(g))) return null;
  try {
    const inner = await blockBody(block, ctx, narrow);
    if (inner === null) return null;
    // Widget-urile au cardul lor; celelalte blocuri primesc cardul paginii, dacă e cerut.
    if (block.type === "widget") return <div className="gcs-pgBlock gcs-pgBlock--widget" data-block={block.id}>{inner}</div>;
    return (
      <section className={`gcs-pgBlock gcs-pgBlock--${block.type}${block.card ? " gcs-card gcs-pgBlock--card" : ""}`} data-block={block.id} data-testid={`gcs-pages-block-${block.type}`}>
        <BlockTitle block={block} />
        {inner}
      </section>
    );
  } catch (error) {
    console.error(`[GCS] pages block ${block.type} (${block.id}):`, error);
    return null;
  }
}

async function blockBody(block: GcsPagesBlock, ctx: Ctx, narrow: boolean): Promise<ReactNode> {
  const { pagesQueries, registry, apps } = services();
  switch (block.type) {
    case "content":
      return block.html ? <GcsNamedHtml className="gcs-postBody gcs-pgBlock__body" html={block.html} /> : null;
    case "html":
      return block.html ? <GcsNamedHtml className="gcs-pgBlock__html" html={block.html} userContent={false} /> : null;
    case "widget": {
      const def = registry.widgetDef(block.widget);
      const render = WIDGET_RENDERERS[block.widget];
      if (!def || !render || !(await apps.enabledFilter())(def.module)) return null;
      return render({ id: `pg-${block.id}`, config: block.config, actor: ctx.actor, page: "index", zone: narrow ? "sidebar" : "top" });
    }
    case "records": {
      const data = await pagesQueries.latest(ctx.actor, block.databaseId, { limit: block.limit, sort: block.sort, categoryId: block.categoryId });
      if (!data) return null;
      const t = await getTranslations("pages");
      return (
        <>
          <GcsRecordList db={data.db} records={data.records} view={narrow && block.view === "grid" ? "compact" : block.view} hideImages={block.hideImages} />
          <Link className="gcs-pgBlock__more" href={`/pages/${data.db.path}`}>
            {t("viewAll", { name: data.db.name })}
          </Link>
        </>
      );
    }
    case "image": {
      if (!block.mediaId) return null;
      const m = await services().db.pagesMedia.findUnique({ where: { id: block.mediaId }, select: { attachmentId: true, alt: true, title: true } });
      if (!m) return null;
      const img = <img src={`/files/${m.attachmentId}`} alt={m.alt || m.title} loading="lazy" className="gcs-pgImage__img" />;
      return (
        <figure className={`gcs-pgImage gcs-pgImage--${block.size}`}>
          {block.link ? <a href={block.link}>{img}</a> : img}
          {block.caption && <figcaption>{block.caption}</figcaption>}
        </figure>
      );
    }
    case "block": {
      const b = (await pagesQueries.blocks([block.blockId])).get(block.blockId);
      return b?.html ? <GcsNamedHtml className={b.kind === "content" ? "gcs-postBody gcs-pgBlock__body" : "gcs-pgBlock__html"} html={b.html} userContent={b.kind === "content"} /> : null;
    }
    case "pages": {
      const items = await pagesQueries.folderPages(ctx.actor, block.folderId ?? ctx.folderId);
      if (items.length === 0) return null;
      return (
        <nav className="gcs-pgMenu" aria-label={block.title || undefined}>
          <ul>
            {items.map((p) => (
              <li key={p.href}>
                <Link href={p.href} aria-current={p.href === `/pages/${ctx.path}` ? "page" : undefined} className="gcs-pgMenu__link">
                  <GcsIcon name={p.icon ?? "fa-solid fa-file-lines"} />
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      );
    }
  }
}

/**
 * Layout-ul unei pagini (constructorul): secțiunile cu coloanele lor (pe telefon, una sub alta), fiecare bloc randat
 * separat (streaming), cu titlul și cardul lui. Coloanele înguste primesc widget-urile în varianta de coloană.
 */
export async function GcsPagesBlocks({ layout, actor, path, folderId }: { layout: GcsPagesLayout; actor: GcsActor; path: string; folderId: number | null }) {
  const ctx: Ctx = { actor, path, folderId };
  return (
    <div className={`gcs-pgLayout gcs-pgLayout--${layout.width}`} data-testid="gcs-pages-layout">
      {layout.sections.map((s) => (
        <section key={s.id} className={`gcs-pgSection gcs-pgSection--${s.style}`} data-columns={s.columns} aria-label={s.title || undefined}>
          {s.title && <h2 className="gcs-pgSection__title">{s.title}</h2>}
          <div className="gcs-pgSection__grid" style={{ ["--gcs-pg-cols" as string]: s.columns.split("-").map((n) => `${n}fr`).join(" ") }}>
            {s.blocks.slice(0, columnCount(s.columns)).map((col, i) => {
              const narrow = (s.columns === "2-1" && i === 1) || (s.columns === "1-2" && i === 0) || s.columns === "1-1-1";
              return (
                <div key={i} className="gcs-pgSection__col">
                  {col.map((b) => (
                    <Suspense key={b.id} fallback={<div className="gcs-card gcs-widgetSkeleton gcs-widgetSkeleton--sidebar" aria-hidden="true" />}>
                      <GcsPagesBlockView block={b} ctx={ctx} narrow={narrow} />
                    </Suspense>
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
