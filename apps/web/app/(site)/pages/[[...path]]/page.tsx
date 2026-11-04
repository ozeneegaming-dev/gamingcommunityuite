import type { GcsActor } from "@gcs/core";
import { allowedBlocks, GcsPagesQueries, splitPageTags, type GcsPagesDb, type GcsPagesTreeNode } from "@gcs/modules";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { clientIp } from "@/lib/client-ip";
import { GcsNamedHtml } from "@/lib/member-names";
import { services } from "@/lib/services";
import { GcsDatabaseView } from "../../_components/pages/GcsDatabaseView";
import { GcsPagesBlocks } from "../../_components/pages/GcsPagesBlocks";
import { GcsRecordForm, type GcsRecordFormInitial } from "../../_components/pages/GcsRecordForm";
import { GcsRecordList } from "../../_components/pages/GcsRecordList";
import { GcsRecordPage } from "../../_components/pages/GcsRecordPage";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ path?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

type Resolved = { actor: GcsActor; node: GcsPagesTreeNode; rest: string[]; db: GcsPagesDb | null } | { actor: GcsActor; directory: true };

async function resolve(path: string[] | undefined): Promise<Resolved | null> {
  const actor = await currentActor();
  const { pagesQueries } = services();
  const found = await pagesQueries.resolve(actor, path ?? []);
  if (!found) return null;
  if (found === "directory") return { actor, directory: true };
  const db = found.node.contentType === "database" && found.node.databaseId ? await pagesQueries.databaseFor(actor, found.node.databaseId) : null;
  if (found.node.contentType === "database" && !db) return null;
  return { actor, node: found.node, rest: found.rest, db };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations("pages");
  const r = await resolve((await params).path);
  if (!r) return { title: t("title") };
  if ("directory" in r) return { title: t("title") };
  const view = r.rest.length === 0 ? await services().pagesQueries.pageView(r.actor, r.node) : null;
  const route = r.db ? GcsPagesQueries.route(r.rest) : null;
  if (r.db && route?.kind === "record") {
    const rec = await services().pagesQueries.record(r.actor, r.db, route.ref);
    if (rec) return { title: rec.record.title, description: rec.record.excerpt || undefined, openGraph: rec.record.image ? { images: [rec.record.image] } : undefined };
  }
  return {
    title: view?.node.seoTitle || r.node.title,
    description: view?.node.seoDescription || r.db?.description || undefined,
    ...(view?.node.seoImage ? { openGraph: { images: [view.node.seoImage] } } : {}),
    ...(view?.node.noindex || !r.node.published ? { robots: { index: false } } : {}),
  };
}

/** Cuprinsul aplicației (sau al unui folder): paginile și folderele vizibile, cu numărul înregistrărilor bazelor. */
async function Directory({ actor, folder }: { actor: GcsActor; folder: GcsPagesTreeNode | null }) {
  const [t, format] = await Promise.all([getTranslations("pages"), getFormatter()]);
  const entries = await services().pagesQueries.directory(actor, folder?.id ?? null);
  const crumbs = folder ? await services().pagesQueries.crumbs(folder) : [];
  return (
    <div className="gcs-pgDirectory" data-testid="gcs-pages-directory">
      <header className="gcs-pageHeader">
        {crumbs.length > 1 && (
          <nav className="gcs-breadcrumb" aria-label={t("breadcrumb")}>
            <ol>
              {crumbs.slice(0, -1).map((c) => (
                <li key={c.href}>
                  <Link href={c.href}>{c.title}</Link>
                </li>
              ))}
              <li aria-current="page">{folder!.title}</li>
            </ol>
          </nav>
        )}
        <h1 className="gcs-display gcs-pageHeader__title">
          <GcsIcon name={folder?.icon ?? "fa-solid fa-file-lines"} className="gcs-hIcon" />
          {folder ? folder.title : t("title")}
        </h1>
      </header>
      {entries.length === 0 ? (
        <p className="gcs-card gcs-emptyState">
          <GcsIcon name="fa-regular fa-file" className="gcs-emptyIcon" />
          {t("emptyDirectory")}
        </p>
      ) : (
        <ul className="gcs-pgDir">
          {entries.map((e) => (
            <li key={e.id} className={`gcs-card gcs-pgDir__item gcs-pgDir__item--${e.kind}`}>
              <Link href={e.href} className="gcs-pgDir__link">
                <GcsIcon name={e.icon ?? (e.kind === "folder" ? "fa-regular fa-folder" : "fa-regular fa-file-lines")} className="gcs-pgDir__icon" />
                <span className="gcs-pgDir__title">{e.title}</span>
                {e.records !== null && <span className="gcs-pgDir__count">{t("recordsCount", { count: e.records, n: format.number(e.records) })}</span>}
                {!e.published && <span className="gcs-pgFlag gcs-pgFlag--hidden">{t("draft")}</span>}
              </Link>
              {e.children && e.children.length > 0 && (
                <ul className="gcs-pgDir__children">
                  {e.children.map((c) => (
                    <li key={c.id}>
                      <Link href={c.href}>
                        <GcsIcon name={c.icon ?? "fa-regular fa-file-lines"} />
                        {c.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** HTML-ul unei pagini „HTML manual”, cu etichetele `{block="…"}` și `{database="…"}` înlocuite de componentele lor. */
async function HtmlPage({ html, actor }: { html: string; actor: GcsActor }) {
  const { pagesQueries, pagesAccess } = services();
  const parts = splitPageTags(html);
  const out = [];
  for (const [i, p] of parts.entries()) {
    if (p.kind === "html") out.push(<GcsNamedHtml key={i} className="gcs-pgHtml__part" html={p.html} userContent={false} />);
    else if (p.kind === "block") {
      const b = await pagesQueries.blockByKey(p.key);
      if (b?.html) out.push(<GcsNamedHtml key={i} className={b.kind === "content" ? "gcs-postBody" : "gcs-pgHtml__part"} html={b.html} userContent={b.kind === "content"} />);
    } else {
      const d = (await pagesAccess.databases()).find((x) => x.key === p.key);
      const data = d ? await pagesQueries.latest(actor, d.id, { limit: 6, sort: d.sort }) : null;
      if (data) out.push(<GcsRecordList key={i} db={data.db} records={data.records} view={data.db.listLayout === "table" ? "list" : data.db.listLayout} />);
    }
  }
  return (
    <div className="gcs-pgHtml" data-testid="gcs-pages-html">
      {out}
    </div>
  );
}

/** Categoriile bazei, cu adâncimea (pentru selectul din formular). */
async function categoryOptions(actor: GcsActor, db: GcsPagesDb) {
  const cats = await services().pagesQueries.categories(actor, db);
  const depth = (id: number | null, n = 0): number => {
    const c = cats.find((x) => x.id === id);
    return c?.parentId && n < 5 ? depth(c.parentId, n + 1) : n;
  };
  return cats.map((c) => ({ id: c.id, name: c.name, depth: depth(c.id) }));
}

/** Serverele de joc pentru câmpurile „server” (doar cu aplicația Servere pornită). */
async function serverOptions(db: GcsPagesDb) {
  if (!db.fields.some((f) => f.type === "server") || !(await services().apps.enabled("servers"))) return [];
  return services().db.gameServer.findMany({ where: { enabled: true }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true } });
}

/**
 * `/pages/...` (specul 2026-11-03-pagini §2): cuprinsul, un folder, o pagină (constructorul sau HTML), o bază de date
 * cu înregistrările ei (lista, o categorie, trimiterea, o înregistrare și editarea ei). Orice lucru invizibil = 404.
 */
export default async function PagesRoute({ params, searchParams }: Props) {
  const [{ path }, sp] = await Promise.all([params, searchParams]);
  const r = await resolve(path);
  if (!r) notFound();
  if ("directory" in r) return <Directory actor={r.actor} folder={null} />;
  const { actor, node, rest, db } = r;
  const t = await getTranslations("pages");
  const { pagesQueries, pagesAccess, pagesRecords } = services();
  const base = `/pages/${node.path}`;

  if (node.kind === "folder") return <Directory actor={actor} folder={node} />;

  const draftBanner = !node.published && (
    <p className="gcs-pgNotice gcs-pgNotice--hidden" role="status" data-testid="gcs-pages-draft">
      <GcsIcon name="fa-solid fa-pen-ruler" />
      {t("draftBanner")}
    </p>
  );

  if (!db) {
    const view = await pagesQueries.pageView(actor, node);
    if (!view) notFound();
    return (
      <div className="gcs-pgPage" data-testid="gcs-pages-page" data-page={node.id}>
        {draftBanner}
        {view.node.showTitle && (
          <header className="gcs-pageHeader">
            {view.crumbs.length > 1 && (
              <nav className="gcs-breadcrumb" aria-label={t("breadcrumb")}>
                <ol>
                  {view.crumbs.slice(0, -1).map((c) => (
                    <li key={c.href}>
                      <Link href={c.href}>{c.title}</Link>
                    </li>
                  ))}
                  <li aria-current="page">{node.title}</li>
                </ol>
              </nav>
            )}
            <h1 className="gcs-display gcs-pageHeader__title">
              {node.icon && <GcsIcon name={node.icon} className="gcs-hIcon" />}
              {node.title}
            </h1>
          </header>
        )}
        {node.contentType === "html" ? <HtmlPage html={view.html} actor={actor} /> : <GcsPagesBlocks layout={view.layout} actor={actor} path={node.path} folderId={node.parentId} />}
        {view.editor && (
          <p className="gcs-pgEditLinks">
            <Link className="gcs-btn gcs-btn--ghost gcs-btn--sm" href={`/admin/pages/${node.id}/${node.contentType === "html" ? "html" : "builder"}`}>
              <GcsIcon name="fa-solid fa-pen-ruler" />
              {t("editPage")}
            </Link>
          </p>
        )}
      </div>
    );
  }

  const route = GcsPagesQueries.route(rest);
  if (!route) notFound();
  if (route.kind === "list" || route.kind === "category") {
    const view = await GcsDatabaseView({ actor, db, title: node.title, categorySlug: route.kind === "category" ? route.slug : null, searchParams: sp });
    if (!view) notFound();
    return (
      <>
        {draftBanner}
        {view}
      </>
    );
  }

  const noun = db.recordLabel || t("record");
  const staff = await pagesAccess.isStaff(actor);
  const blocks = actor.userId ? await allowedBlocks(services(), actor) : [];
  if (route.kind === "submit") {
    if (!(await pagesAccess.canSubmit(actor, db))) notFound();
    const cat = Number(one(sp.c)) || null;
    return (
      <div className="gcs-pgSubmit">
        <header className="gcs-pageHeader">
          <nav className="gcs-breadcrumb" aria-label={t("breadcrumb")}>
            <ol>
              <li>
                <Link href={base}>{node.title}</Link>
              </li>
              <li aria-current="page">{t("add", { noun: noun.toLowerCase() })}</li>
            </ol>
          </nav>
          <h1 className="gcs-display gcs-pageHeader__title">
            <GcsIcon name="fa-solid fa-plus" className="gcs-hIcon" />
            {t("add", { noun: noun.toLowerCase() })}
          </h1>
        </header>
        <GcsRecordForm
          databaseId={db.id}
          noun={noun}
          fields={db.fields}
          categories={await categoryOptions(actor, db)}
          categoryId={cat}
          recordImage={db.recordImage}
          blocks={blocks}
          servers={await serverOptions(db)}
          staff={staff}
          needsApproval={db.approval && !(await pagesAccess.skipsApproval(actor))}
          cancelHref={base}
        />
      </div>
    );
  }

  const data = await pagesQueries.record(actor, db, route.ref);
  if (!data) notFound();
  if (route.ref !== `${data.record.id}-${data.canonicalSlug}`) permanentRedirect(`${data.record.href}${route.edit ? "/edit" : ""}`);
  if (route.edit) {
    if (!data.can.edit) notFound();
    const files: GcsRecordFormInitial["files"] = {};
    const values: GcsRecordFormInitial["fields"] = {};
    for (const f of data.fields) {
      if (f.type === "image" || f.type === "file") files[f.key] = { id: String(f.value), url: f.url ?? "", name: f.display };
      else if (f.type === "member") values[f.key] = f.display;
      else if (f.type === "youtube") values[f.key] = `https://youtu.be/${String(f.value)}`;
      else values[f.key] = f.value;
    }
    return (
      <div className="gcs-pgSubmit">
        <header className="gcs-pageHeader">
          <h1 className="gcs-display gcs-pageHeader__title">
            <GcsIcon name="fa-solid fa-pen" className="gcs-hIcon" />
            {t("editing", { title: data.record.title })}
          </h1>
        </header>
        <GcsRecordForm
          databaseId={db.id}
          noun={noun}
          fields={db.fields}
          categories={await categoryOptions(actor, db)}
          categoryId={data.record.category?.id ?? null}
          recordImage={db.recordImage}
          blocks={blocks}
          servers={await serverOptions(db)}
          staff={staff}
          needsApproval={false}
          cancelHref={data.record.href}
          initial={{
            recordId: data.record.id,
            title: data.record.title,
            categoryId: data.record.category?.id ?? null,
            content: (data.record.contentJson as GcsRecordFormInitial["content"]) ?? null,
            image: data.record.image ? { id: data.record.image.replace("/files/", ""), url: data.record.image, name: "" } : null,
            fields: values,
            files,
            featured: data.record.featured,
            pinned: data.record.pinned,
          }}
        />
      </div>
    );
  }
  if (data.record.status === "PUBLISHED") await pagesRecords.viewed(data.record.id, actor.userId ?? clientIp(await headers()));
  return <GcsRecordPage actor={actor} db={db} data={data} commentsPage={Math.max(1, Number(one(sp.cp)) || 1)} base={base} />;
}
