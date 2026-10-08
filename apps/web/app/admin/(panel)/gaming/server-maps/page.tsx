import { SERVER_MAPS_ACP_SECTION, gameDef } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { pageParam } from "@/lib/forum-page";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../_components/GcsAcpTitle";
import { removeMapImage } from "./actions";
import { GcsMapUpload } from "./GcsMapUpload";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.serverMaps"))("title") };
}

type Props = { searchParams: Promise<{ game?: string; q?: string; missing?: string; page?: string }> };

const GAMES = ["cs16", "cs2"] as const;

/**
 * ACP → Gaming → Hărți (specul 2026-10-08-servere-bridge §13): catalogul hărților văzute pe servere, încărcarea în masă
 * și starea imaginilor aduse după șablonul de adresă. Fără imagine se arată arta generică originală a jocului; GCS nu
 * livrează capturi de hărți ale altora.
 */
export default async function AcpServerMapsPage({ searchParams }: Props) {
  const { actor } = await requireAcpSection(SERVER_MAPS_ACP_SECTION);
  const sp = await searchParams;
  const game = GAMES.includes(sp.game as (typeof GAMES)[number]) ? sp.game : undefined;
  const q = (sp.q ?? "").slice(0, 40);
  const missing = sp.missing === "1";
  const { bridge, acp, settings } = services();
  const [t, list, canEdit, canDelete, tpl16, tpl2] = await Promise.all([
    getTranslations("acp.serverMaps"),
    bridge.maps.list(actor, { ...(game ? { game } : {}), q, missing, page: pageParam(sp.page) }),
    acp.can(actor, SERVER_MAPS_ACP_SECTION, "edit"),
    acp.can(actor, SERVER_MAPS_ACP_SECTION, "delete"),
    settings.get<string>("servers.map_template_cs16"),
    settings.get<string>("servers.map_template_cs2"),
  ]);
  const games = GAMES.map((key) => ({ key, name: gameDef(key)?.name ?? key }));
  const href = (page: number) => {
    const p = new URLSearchParams();
    if (game) p.set("game", game);
    if (q) p.set("q", q);
    if (missing) p.set("missing", "1");
    if (page > 1) p.set("page", String(page));
    return `/admin/gaming/server-maps?${p}`;
  };

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-map" description={t("lead")}>
        {t("title")}
      </GcsAcpTitle>

      {canEdit && (
        <GcsCard as="section" aria-labelledby="gcs-maps-upload" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 id="gcs-maps-upload" className="gcs-acpWidget__title">
            <GcsAcpTitleIcon name="fa-solid fa-upload" />
            {t("upload.title")}
          </h2>
          <GcsMapUpload games={games} />
        </GcsCard>
      )}

      <GcsCard as="section" aria-labelledby="gcs-maps-template" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 6 }}>
        <h2 id="gcs-maps-template" className="gcs-acpWidget__title">
          <GcsAcpTitleIcon name="fa-solid fa-link" />
          {t("template.title")}
        </h2>
        <p className="gcs-muted" style={{ margin: 0, fontSize: 14 }}>
          {t("template.lead")}
        </p>
        <p style={{ margin: 0, fontSize: 14 }}>
          CS 1.6: <code>{tpl16 || t("template.none")}</code> · CS2: <code>{tpl2 || t("template.none")}</code> ·{" "}
          <Link href="/admin/settings/servers_bridge">{t("template.edit")}</Link>
        </p>
      </GcsCard>

      <form method="get" action="/admin/gaming/server-maps" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="gcs-field" style={{ width: 200 }}>
          {t("filterGame")}
          <select className="gcs-input" name="game" defaultValue={game ?? ""}>
            <option value="">{t("allGames")}</option>
            {games.map((g) => (
              <option key={g.key} value={g.key}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="gcs-field" style={{ width: 220 }}>
          {t("search")}
          <input className="gcs-input" type="search" name="q" defaultValue={q} maxLength={40} />
        </label>
        <label className="gcs-checkRow">
          <input type="checkbox" name="missing" value="1" defaultChecked={missing} />
          {t("missingOnly")}
        </label>
        <button type="submit" className="gcs-btn gcs-btn--ghost">
          {t("searchSubmit")}
        </button>
      </form>

      <GcsCard as="section" aria-label={t("title")} style={{ padding: 16 }}>
        {list.items.length === 0 ? (
          <p className="gcs-acpList__empty" style={{ margin: 0 }}>
            <GcsIcon name="fa-solid fa-map" />
            {t("empty")}
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }} data-testid="gcs-server-maps">
            {list.items.map((m) => (
              <li key={m.id} className="gcs-card" style={{ overflow: "hidden", display: "flex", flexDirection: "column" }} data-testid="gcs-server-map" data-map={m.name}>
                <div style={{ position: "relative", aspectRatio: "16 / 9", background: "var(--gcs-surface-2, #111)" }}>
                  <img src={m.image.url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  {m.image.generic && (
                    <span style={{ position: "absolute", left: 10, bottom: 8, fontWeight: 800, color: "#fff", textShadow: "0 1px 3px rgba(0,0,0,.8)" }}>{m.name}</span>
                  )}
                </div>
                <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
                  <strong style={{ fontSize: 14 }}>{m.name}</strong>
                  <span className="gcs-muted">
                    {gameDef(m.game)?.name ?? m.game} · {m.image.generic ? t("generic") : t(`sources.${m.source ?? "UPLOAD"}`)}
                  </span>
                  {m.fetchError && (
                    <span className="gcs-badge gcs-badge--warn" style={{ alignSelf: "flex-start" }}>
                      {t("fetchError", { error: m.fetchError, attempts: m.attempts })}
                    </span>
                  )}
                  {!m.image.generic && canDelete && <GcsActionForm action={removeMapImage.bind(null, m.id)} submitLabel={t("removeImage")} submitKind="remove" variant="ghost" compact confirm={t("removeConfirm", { name: m.name })} />}
                </div>
              </li>
            ))}
          </ul>
        )}
        {list.pages > 1 && (
          <p className="gcs-acpList__more">
            {list.page > 1 && <Link href={href(list.page - 1)}>{t("prev")}</Link>} {list.page < list.pages && <Link href={href(list.page + 1)}>{t("next")}</Link>}
          </p>
        )}
      </GcsCard>
    </>
  );
}
