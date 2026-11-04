import { APPS_ACP_SECTION } from "@gcs/core";
import type { GcsImageViewerLabels } from "@gcs/ui";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { MARKETPLACE_SECTION, marketCatalog } from "@/lib/marketplace.server";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { GcsMarketplace, type GcsMarketCard, type GcsMarketState } from "./GcsMarketplace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.marketplace"))("title") };
}

/** Versiunea instalată e mai veche decât cea din catalog (1.2.0 < 1.10.0). */
function older(installed: string, latest: string | null): boolean {
  if (!latest) return false;
  const a = installed.split(/[.+-]/).map((n) => Number.parseInt(n, 10) || 0);
  const b = latest.split(/[.+-]/).map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
}

/**
 * ACP › Sistem › Marketplace: catalogul Data Center-ului (aplicații premium, pluginuri, teme, widget-uri…) ca grilă de
 * carduri, cu vitrina fiecărui element (capturi, descriere, noutăți) și acțiunea potrivită stării lui: cumpără / ia
 * gratuit, plata în așteptare, pornește aplicația, instalează sau actualizează pachetul. Plata se face pe pagina
 * Data Center-ului (Stripe sau confirmare manuală); tokenul licenței nu ajunge în browser.
 */
export default async function AcpMarketplacePage({ searchParams }: { searchParams: Promise<{ mine?: string }> }) {
  const { mine } = await searchParams;
  const panel = await requireAcpSection(MARKETPLACE_SECTION);
  const { apps, pluginAdmin, acp } = services();
  const [t, tv, locale, catalog, appList, plugins, canBuy, canInstall] = await Promise.all([
    getTranslations("acp.marketplace"),
    getTranslations("imageViewer"),
    getLocale(),
    marketCatalog(),
    apps.catalog(),
    pluginAdmin.list().catch(() => []),
    acp.can(panel.actor, MARKETPLACE_SECTION, "edit"),
    acp.can(panel.actor, APPS_ACP_SECTION, "edit"),
  ]);
  const viewerLabels = Object.fromEntries(
    (["dialog", "close", "prev", "next", "zoomIn", "zoomOut", "original", "download", "thumbnails", "counter", "by", "source"] as const).map((k) => [k, tv.raw(k) as string]),
  ) as GcsImageViewerLabels;

  const cards: GcsMarketCard[] = [];
  if (catalog.ok) {
    for (const item of catalog.items) {
      let state: GcsMarketState;
      let installedVersion: string | null = null;
      if (item.order && !item.owned) state = "pending";
      else if (!item.owned) state = item.price.cents === 0 ? "get" : "buy";
      else if (item.kind === "app" && appList.some((a) => a.key === item.key)) {
        state = appList.find((a) => a.key === item.key)!.enabled ? "enabled" : "activate";
      } else {
        // Un pachet sau o aplicație premium livrată ca pachet semnat (`gcs.<cheia>`, ex. Studio VIP).
        const pluginKey = item.kind === "app" && item.key ? `gcs.${item.key}` : item.key;
        const plugin = pluginKey ? plugins.find((p) => p.key === pluginKey) : undefined;
        installedVersion = plugin?.version ?? null;
        state = !plugin ? (item.package ? "install" : "unavailable") : older(plugin.version, item.version) && item.package ? "update" : "installed";
      }
      cards.push({ ...item, state, installedVersion });
    }
  }
  const categories = catalog.ok
    ? Object.entries(catalog.categories)
        .map(([key, label]) => ({ key, label: t.has(`categories.${key}`) ? t(`categories.${key}`) : label, count: cards.filter((c) => c.category === key).length }))
        .filter((c) => c.count > 0)
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <GcsAcpTitle icon="fa-solid fa-store" description={t("description")}>
        {t("title")}
      </GcsAcpTitle>
      <GcsMarketplace
        items={cards}
        categories={categories}
        card={catalog.ok ? catalog.card : false}
        error={catalog.ok ? null : catalog.error}
        canBuy={canBuy}
        canInstall={canInstall}
        locale={locale}
        viewerLabels={viewerLabels}
        initialMine={mine === "1"}
      />
    </div>
  );
}
