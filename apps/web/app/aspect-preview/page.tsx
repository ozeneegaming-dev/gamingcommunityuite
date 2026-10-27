import { applyExtensionDraft, extensionFields, WIDGET_EXT_KEY, widgetExtValues, WIDGETS_ACP_SECTION } from "@gcs/core";
import { FORUMS_ACP_SECTION, type GcsForumRow, type GcsIndexCategory, type GcsSlotNodeRef } from "@gcs/modules";
import type { ForumType } from "@gcs/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { GcsCategoryCard } from "../(site)/_components/forum/GcsCategoryCard";
import { WIDGET_RENDERERS } from "../(site)/_components/widgets/registry";
import { requireAcpSection } from "@/lib/acp";
import { GcsSlotStyles } from "@/lib/forum-slots";
import { safeModeActive } from "@/lib/plugins";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.aspect"))("preview.title"), robots: { index: false, follow: false } };
}

type Props = { searchParams: Promise<{ scope?: string; id?: string; ext?: string; tab?: string; draft?: string; unread?: string }> };

/** Schița trimisă de previzualizare (base64url din JSON), sau `{}` dacă lipsește ori e stricată. */
function decodeDraft(raw: string | undefined): Record<string, unknown> {
  if (!raw || raw.length > 16_000) return {};
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string" && e[1].length <= 2000).slice(0, 60));
  } catch {
    return {};
  }
}

/**
 * Previzualizarea live a unui tab de aspect (Aspect forumuri, în `iframe` din ACP): rândul forumului cu banda categoriei
 * lui, sau widget-ul, desenate de site (designul și setările temei, ca pe pagina publică) cu valorile încă nesalvate.
 * Stă în afara ACP-ului ca să primească designul site-ului, dar cere aceeași poartă ACP și dreptul pe secțiune.
 */
export default async function AspectPreviewPage({ searchParams }: Props) {
  const sp = await searchParams;
  const id = Number(sp.id);
  if (!Number.isSafeInteger(id) || id <= 0 || !sp.ext || !sp.tab) notFound();
  const draft = decodeDraft(sp.draft);
  const plugins = !(await safeModeActive());
  return (
    <main className="gcs-aspectPreviewPage" data-testid="gcs-aspect-preview-page">
      {sp.scope === "widget" ? <WidgetPreview id={id} ext={sp.ext} draft={draft} plugins={plugins} /> : <ForumPreview id={id} ext={sp.ext} draft={draft} plugins={plugins} unread={sp.unread === "1"} />}
    </main>
  );
}

/** Un rând de forum „de probă” cu datele reale ale nodului (fără ultimul mesaj; contoarele lui). */
function sampleRow(f: { id: number; type: ForumType; name: string; slug: string; description: string; icon: string | null; color: string | null; linkUrl: string | null; topicsCount: number; postsCount: number; subforumColumns: number }, subs: { id: number; name: string; slug: string; icon: string | null; topicsCount: number }[], unread: boolean): GcsForumRow {
  return { ...f, subforums: subs, last: null, unread, pageTopics: false };
}

async function ForumPreview({ id, ext, draft, plugins, unread }: { id: number; ext: string; draft: Record<string, unknown>; plugins: boolean; unread: boolean }) {
  const panel = await requireAcpSection(FORUMS_ACP_SECTION);
  const { db, forumSlots } = services();
  const select = { id: true, type: true, name: true, slug: true, description: true, icon: true, color: true, linkUrl: true, topicsCount: true, postsCount: true, subforumColumns: true, parentId: true } as const;
  const node = await db.forum.findUnique({ where: { id }, select });
  if (!node) notFound();
  // Categoria afișată: nodul însuși sau cel mai apropiat strămoș categorie.
  let category = node.type === "CATEGORY" ? node : null;
  let parentId = node.parentId;
  for (let i = 0; !category && parentId !== null && i < 6; i++) {
    const parent = await db.forum.findUnique({ where: { id: parentId }, select });
    if (!parent) break;
    if (parent.type === "CATEGORY") category = parent;
    parentId = parent.parentId;
  }
  const children = async (of: number) => db.forum.findMany({ where: { parentId: of, type: { not: "CATEGORY" } }, orderBy: { position: "asc" }, take: 4, select });
  const subsOf = async (of: number) => (await children(of)).map((s) => ({ id: s.id, name: s.name, slug: s.slug, icon: s.icon, topicsCount: s.topicsCount }));
  const rows: GcsForumRow[] =
    node.type === "CATEGORY"
      ? await Promise.all((await children(node.id)).slice(0, 2).map(async (f) => sampleRow(f, await subsOf(f.id), unread)))
      : [sampleRow(node, await subsOf(node.id), unread)];
  const shown: GcsIndexCategory = category
    ? { id: category.id, name: category.name, slug: category.slug, color: category.color, icon: category.icon, forums: rows }
    : { id: 0, name: node.name, slug: node.slug, color: node.color, icon: node.icon, forums: rows };
  const refs: GcsSlotNodeRef[] = [
    ...(category ? [{ id: category.id, type: "CATEGORY" as const, parentId: null, name: category.name, slug: category.slug }] : []),
    ...rows.map((r) => ({
      id: r.id,
      type: r.type,
      parentId: r.id === node.id ? node.parentId : node.id,
      ...(r.id === node.id && node.parentId !== null && node.parentId !== category?.id ? { parentType: "FORUM" as const } : {}),
      name: r.name,
      slug: r.slug,
      children: r.subforums.map((s) => ({ id: s.id, type: "FORUM" as const, name: s.name, slug: s.slug })),
    })),
  ];
  const slots = await forumSlots.list(panel.actor, await getLocale(), "index", refs, { plugins, draft: { extension: ext, forumId: id, values: draft } });
  return (
    <div className="gcs-forumIndex" data-view="rows">
      <GcsSlotStyles plugins={[...new Set([...slots.values()].flatMap((b) => b.plugins))]} />
      <GcsCategoryCard category={shown} slots={slots} />
    </div>
  );
}

async function WidgetPreview({ id, ext, draft, plugins }: { id: number; ext: string; draft: Record<string, unknown>; plugins: boolean }) {
  const panel = await requireAcpSection(WIDGETS_ACP_SECTION);
  const { widgets } = services();
  const placement = await widgets.placement(id);
  const render = placement ? WIDGET_RENDERERS[placement.type] : undefined;
  if (!placement || !render) notFound();
  const def = (await widgets.activeExtensions({ plugins })).find((e) => e.def.key === ext)?.def;
  const stored = widgetExtValues(placement.config);
  const config = def ? { ...placement.config, [WIDGET_EXT_KEY]: { ...stored, [def.key]: applyExtensionDraft(extensionFields(def), stored[def.key], draft) } } : placement.config;
  return <aside className="gcs-forumSidebar gcs-aspectPreviewPage__widget">{await render({ id: String(placement.id), config, actor: panel.actor })}</aside>;
}
