import { allowedBlocks, PAGES_ACP } from "@gcs/modules";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { GcsIcon } from "@gcs/ui/icons";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { mediaImages, pagesGroups } from "../../_parts";
import { GcsPageBuilder, type GcsBuilderField, type GcsBuilderWidget } from "./GcsPageBuilder";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.pages.builder"))("title") };
}

/**
 * ACP › Pagini › Construiește: constructorul unei pagini (secțiuni, coloane, blocuri). Serverul pregătește tot ce alege
 * constructorul: widget-urile aplicațiilor pornite (cu câmpurile lor traduse), bazele de date și categoriile, imaginile
 * din bibliotecă, blocurile reutilizabile, folderele, grupurile și blocurile editorului permise adminului.
 */
export default async function AcpPageBuilder({ params }: Props) {
  const { actor } = await requireAcpSection(PAGES_ACP.pages, "edit");
  const id = Number((await params).id);
  const { pagesAdmin, registry, apps, db } = services();
  const node = Number.isSafeInteger(id) ? await pagesAdmin.node(actor, id) : null;
  if (!node || node.kind !== "page") notFound();
  const [t, tAll, enabled, groups, images, databases, blocks, folders, editorBlocks] = await Promise.all([
    getTranslations("acp.pages.builder"),
    getTranslations(),
    apps.enabledFilter(),
    pagesGroups(),
    mediaImages(),
    db.pagesDatabase.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, categories: { orderBy: { position: "asc" }, select: { id: true, name: true } } } }),
    db.pagesBlock.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }], select: { id: true, name: true, category: true } }),
    db.pagesNode.findMany({ where: { kind: "folder" }, orderBy: { path: "asc" }, select: { id: true, path: true } }),
    allowedBlocks(services(), actor),
  ]);
  const label = (key: string) => (tAll.has(key as never) ? tAll(key as never) : key);
  // Sursele opțiunilor dinamice ale widget-urilor (aceleași ca în „Editează pagina”).
  const dynamic: Record<string, { value: string; label: string }[]> = {
    "pages.databases": databases.map((d) => ({ value: String(d.id), label: d.name })),
    "pages.blocks": blocks.map((b) => ({ value: String(b.id), label: b.name })),
    groups: groups.map((g) => ({ value: String(g.id), label: g.name })),
  };
  const widgets: GcsBuilderWidget[] = registry
    .widgetDefs()
    .filter((w) => enabled(w.module))
    .map(({ module, def }) => ({
      key: def.key,
      module: label(registry.module(module)?.app?.labelKey ?? `pageEditor.categories.${module}`),
      label: label(def.labelKey),
      description: def.descriptionKey ? label(def.descriptionKey) : "",
      icon: def.icon,
      defaults: def.defaultConfig,
      fields: (def.fields ?? []).flatMap((f): GcsBuilderField[] => {
        if (f.type === "richtext") return [];
        if (f.type === "select") {
          const options = f.optionsFrom ? [{ value: "", label: "—" }, ...(dynamic[f.optionsFrom] ?? [])] : (f.options ?? []).map((o) => ({ value: o.value, label: label(o.labelKey) }));
          return [{ key: f.key, label: label(f.labelKey), type: "select" as const, options }];
        }
        if (f.type === "number") return [{ key: f.key, label: label(f.labelKey), type: "number" as const, min: f.min, max: f.max }];
        return [{ key: f.key, label: label(f.labelKey), type: "text" as const, maxLength: f.maxLength }];
      }),
    }));

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-pen-ruler"
        description={t("lead")}
        actions={
          <Link className="gcs-btn gcs-btn--ghost gcs-btn--sm" href="/admin/pages">
            <GcsIcon name="fa-solid fa-arrow-left" />
            {t("back")}
          </Link>
        }
      >
        {t("titleFor", { title: node.title })}
      </GcsAcpTitle>
      <GcsPageBuilder
        nodeId={node.id}
        viewHref={`/pages/${node.path}`}
        initial={node.layout}
        widgets={widgets}
        databases={databases}
        images={images.map((m) => ({ id: m.id, title: m.title, url: `/files/${m.attachmentId}` }))}
        blocks={blocks}
        folders={folders}
        groups={groups.map((g) => ({ id: g.id, name: g.name }))}
        editorBlocks={editorBlocks}
      />
    </>
  );
}
