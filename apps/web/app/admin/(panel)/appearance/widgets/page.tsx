import { GCS_WIDGET_PAGES, WIDGETS_ACP_SECTION } from "@gcs/core";
import { GcsButton, GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { editWidgetsOnSite, resetWidgets } from "../actions";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../_components/GcsAcpTitle";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.widgetsAdmin"))("title") };
}

/**
 * ACP → Aspect → Widget-uri (specul etapei 5): widget-urile se aranjează direct pe site („Editează pagina”); aici e
 * rezumatul fiecărei pagini, linkul spre editor și revenirea la layout-ul implicit.
 */
export default async function AcpWidgetsPage() {
  const panel = await requireAcpSection(WIDGETS_ACP_SECTION);
  const [t, tp] = await Promise.all([getTranslations("acp.widgetsAdmin"), getTranslations("pageEditor")]);
  const { widgets } = services();
  const layouts = await Promise.all(GCS_WIDGET_PAGES.map(async (page) => ({ page, layout: await widgets.layout(page, panel.actor, { all: true }) })));
  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-table-cells-large">
        {t("title")}
      </GcsAcpTitle>
      <p className="gcs-muted" style={{ margin: 0 }}>
        {t("hint")}
      </p>
      {layouts.map(({ page, layout }) => (
        <GcsCard key={page} as="section" aria-label={tp(`pages.${page}`)} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 className="gcs-acpWidget__title"><GcsAcpTitleIcon name="fa-solid fa-file-lines" />{tp(`pages.${page}`)}</h2>
          <p className="gcs-muted" style={{ margin: 0 }}>
            {(["top", "sidebar", "bottom"] as const).map((z) => `${tp(`zones.${z}`)}: ${layout[z].length}`).join(" · ")}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <form action={editWidgetsOnSite.bind(null, page)}>
              <GcsButton type="submit" variant="primary" size="sm" icon={<GcsIcon name="fa-solid fa-pen-to-square" />}>
                {t("editOnSite")}
              </GcsButton>
            </form>
            <GcsActionForm action={resetWidgets.bind(null, page)} submitLabel={tp("restoreDefault")} submitKind="reset" variant="ghost" compact confirm={tp("confirmDefault")}>
              {null}
            </GcsActionForm>
          </div>
        </GcsCard>
      ))}
    </>
  );
}
