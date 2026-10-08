import { GCS_ADMIN_FLAGS, SERVERS_ACP_SECTION, gameDef } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../../_components/GcsActionForm";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../../../_components/GcsAcpTitle";
import { saveBridgeConfig, saveVipMappings } from "../../bridge-actions";
import { GcsBridgeKeys } from "../../GcsBridgeKeys";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.bridge"))("title") };
}

const KIND_BADGE: Record<string, string> = { STEAM: "gcs-badge--ok", NONSTEAM: "gcs-badge--warn", NAME: "gcs-badge--neutral" };

/**
 * ACP → Gaming → Servere → un server → Plugin și chei API (specul 2026-10-08-servere-bridge §15.3): starea punții
 * (ultimul heartbeat, pluginul, jucătorii online, meciul curent), cheile, modul identităților și VIP-ul pe server.
 */
export default async function AcpServerBridgePage({ params }: Props) {
  const { actor } = await requireAcpSection(SERVERS_ACP_SECTION);
  const id = Number((await params).id);
  const { bridge, acp, settings } = services();
  const status = Number.isInteger(id) ? await bridge.status(actor, id) : null;
  if (!status) notFound();
  const [t, format, canEdit, canDelete, siteUrl] = await Promise.all([
    getTranslations("acp.bridge"),
    getFormatter(),
    acp.can(actor, SERVERS_ACP_SECTION, "edit"),
    acp.can(actor, SERVERS_ACP_SECTION, "delete"),
    settings.get<string>("site.url"),
  ]);
  const s = status.server;
  const game = gameDef(s.game);
  const supported = s.game === "cs16" || s.game === "cs2";
  const site = siteUrl || process.env.GCS_BASE_URL || "https://example.invalid";

  return (
    <>
      <Link href={`/admin/gaming/servers/${s.id}`} className="gcs-acpBack">
        <GcsIcon name="fa-solid fa-arrow-left" />
        {t("back")}
      </Link>
      <GcsAcpTitle icon="fa-solid fa-plug" description={`${s.name} · ${game?.name ?? s.game}`}>
        {t("title")}
      </GcsAcpTitle>

      {!supported && (
        <GcsCard style={{ padding: 16 }} role="note">
          {t("unsupported")}
        </GcsCard>
      )}

      <GcsCard as="section" aria-labelledby="gcs-bridge-status" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }} data-testid="gcs-bridge-status">
        <h2 id="gcs-bridge-status" className="gcs-acpWidget__title">
          <GcsAcpTitleIcon name="fa-solid fa-heart-pulse" />
          {t("status.title")}
        </h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
          <span className={`gcs-badge ${status.connected ? "gcs-badge--ok" : "gcs-badge--neutral"}`} data-testid="gcs-bridge-connected" data-connected={status.connected ? "1" : "0"}>
            {status.connected ? t("status.connected") : t("status.disconnected")}
          </span>
          <span>
            {t("status.lastSeen")}: <strong>{s.bridgeSeenAt ? format.dateTime(new Date(s.bridgeSeenAt), { dateStyle: "medium", timeStyle: "medium" }) : t("status.never")}</strong>
          </span>
          <span>
            {t("status.plugin")}: <strong data-testid="gcs-bridge-plugin">{s.bridgePlugin ?? "—"}</strong>
          </span>
        </div>
        <div className="gcs-acpKpis" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          {(
            [
              ["online", status.roster?.players.length ?? 0, "fa-solid fa-users"],
              ["players", status.counts.players, "fa-solid fa-id-card"],
              ["sanctions", status.counts.activeSanctions, "fa-solid fa-gavel"],
              ["matches", status.counts.matches, "fa-solid fa-trophy"],
            ] as const
          ).map(([key, value, icon], i) => (
            <div key={key} className={`gcs-acpKpi gcs-acpKpi--${i + 1}`} data-testid={`gcs-bridge-count-${key}`}>
              <div className="gcs-acpKpi__head">
                <span className="gcs-acpKpi__icon">
                  <GcsIcon name={icon} />
                </span>
                <span className="gcs-acpKpi__label">{t(`status.counts.${key}`)}</span>
              </div>
              <div className="gcs-acpKpi__row">
                <span className="gcs-acpKpi__value">{format.number(value)}</span>
              </div>
            </div>
          ))}
        </div>
        {status.match && (
          <p style={{ margin: 0 }} data-testid="gcs-bridge-match">
            <GcsIcon name="fa-solid fa-trophy" /> {t("status.match", { a: status.match.teams.A.name, b: status.match.teams.B.name, scoreA: status.match.teams.A.score, scoreB: status.match.teams.B.score, round: status.match.round, state: t(`status.matchStates.${status.match.status}`) })}
          </p>
        )}
        {status.roster && status.roster.players.length > 0 && (
          <table className="gcs-table__table" data-testid="gcs-bridge-roster">
            <thead>
              <tr>
                <th className="gcs-table__th" scope="col">{t("status.player")}</th>
                <th className="gcs-table__th" scope="col">{t("status.identity")}</th>
                <th className="gcs-table__th" scope="col">{t("status.team")}</th>
                <th className="gcs-table__th" scope="col">{t("status.score")}</th>
              </tr>
            </thead>
            <tbody>
              {status.roster.players.map((p) => (
                <tr key={p.playerId} className="gcs-table__row">
                  <td className="gcs-table__td">
                    {p.name || "—"} {p.adminId !== null && <span className="gcs-badge gcs-badge--accent">{t("status.admin")}</span>}
                  </td>
                  <td className="gcs-table__td">
                    <span className={`gcs-badge ${KIND_BADGE[p.kind] ?? "gcs-badge--neutral"}`}>{t(`kinds.${p.kind}`)}</span>
                  </td>
                  <td className="gcs-table__td">{p.team ?? "—"}</td>
                  <td className="gcs-table__td">{p.score ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </GcsCard>

      <GcsCard as="section" aria-labelledby="gcs-bridge-keys" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 id="gcs-bridge-keys" className="gcs-acpWidget__title">
          <GcsAcpTitleIcon name="fa-solid fa-key" />
          {t("keys.title")}
        </h2>
        <p className="gcs-muted" style={{ margin: 0, fontSize: 14 }}>
          {t("keys.lead")}
        </p>
        <GcsBridgeKeys serverId={s.id} game={s.game} siteUrl={site} keys={status.keys} canEdit={canEdit} canDelete={canDelete} />
      </GcsCard>

      <GcsCard as="section" aria-labelledby="gcs-bridge-identity" style={{ padding: 16, maxWidth: 820 }}>
        <h2 id="gcs-bridge-identity" className="gcs-acpWidget__title" style={{ marginBottom: 12 }}>
          <GcsAcpTitleIcon name="fa-solid fa-id-badge" />
          {t("identity.title")}
        </h2>
        <GcsActionForm action={saveBridgeConfig.bind(null, s.id)} submitLabel={t("identity.save")} submitKind="save">
          <label className="gcs-field" style={{ maxWidth: 420 }}>
            {t("identity.mode")}
            <select className="gcs-input" name="identityMode" defaultValue={s.identityMode} data-testid="gcs-bridge-identity-mode">
              <option value="mixed">{t("identity.modes.mixed")}</option>
              <option value="steam">{t("identity.modes.steam")}</option>
            </select>
            <span className="gcs-field__hint">{s.game === "cs2" ? t("identity.cs2Hint") : t("identity.modeHint")}</span>
          </label>
          <label className="gcs-checkRow">
            <input type="checkbox" name="nameIds" defaultChecked={s.nameIds} />
            {t("identity.nameIds")}
          </label>
          <span className="gcs-field__hint">{t("identity.nameIdsHint")}</span>
          <label className="gcs-checkRow">
            <input type="checkbox" name="isMix" defaultChecked={s.isMix} data-testid="gcs-bridge-is-mix" />
            {t("identity.isMix")}
          </label>
        </GcsActionForm>
      </GcsCard>

      <GcsCard as="section" aria-labelledby="gcs-bridge-vip" style={{ padding: 16, maxWidth: 820 }}>
        <h2 id="gcs-bridge-vip" className="gcs-acpWidget__title" style={{ marginBottom: 8 }}>
          <GcsAcpTitleIcon name="fa-solid fa-crown" />
          {t("vip.title")}
        </h2>
        <p className="gcs-muted" style={{ margin: "0 0 12px", fontSize: 14 }}>
          {t("vip.lead")}
        </p>
        {status.vip.length === 0 ? (
          <p className="gcs-muted" style={{ margin: 0 }}>
            {t("vip.none")}
          </p>
        ) : (
          <GcsActionForm action={saveVipMappings.bind(null, s.id)} submitLabel={t("vip.save")} submitKind="save">
            <table className="gcs-table__table" data-testid="gcs-bridge-vip">
              <thead>
                <tr>
                  <th className="gcs-table__th" scope="col">{t("vip.group")}</th>
                  <th className="gcs-table__th" scope="col">{t("vip.enabled")}</th>
                  <th className="gcs-table__th" scope="col">{t("vip.flags")}</th>
                </tr>
              </thead>
              <tbody>
                {status.vip.map((g) => (
                  <tr key={g.groupId} className="gcs-table__row">
                    <td className="gcs-table__td" style={{ color: g.color ?? undefined, fontWeight: 700 }}>
                      <input type="hidden" name="group" value={g.groupId} />
                      {g.name}
                    </td>
                    <td className="gcs-table__td">
                      <input type="checkbox" name="vip" value={g.groupId} defaultChecked={g.enabled} aria-label={t("vip.enabledFor", { group: g.name })} />
                    </td>
                    <td className="gcs-table__td">
                      <input className="gcs-input" name={`flags:${g.groupId}`} defaultValue={g.flags} maxLength={23} pattern={`[${GCS_ADMIN_FLAGS}]*`} style={{ width: 140, fontFamily: "var(--gcs-font-mono, monospace)" }} aria-label={t("vip.flagsFor", { group: g.name })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <span className="gcs-field__hint">{t("vip.flagsHint")}</span>
          </GcsActionForm>
        )}
      </GcsCard>

      <GcsCard as="section" aria-labelledby="gcs-bridge-setup" style={{ padding: 16, maxWidth: 820, display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 id="gcs-bridge-setup" className="gcs-acpWidget__title">
          <GcsAcpTitleIcon name="fa-solid fa-screwdriver-wrench" />
          {t("setup.title")}
        </h2>
        <p style={{ margin: 0, fontSize: 14 }}>{s.game === "cs16" ? t("setup.cs16") : t("setup.cs2")}</p>
        <p className="gcs-muted" style={{ margin: 0, fontSize: 13 }}>
          {t("setup.endpoint")}: <code>{`${site.replace(/\/+$/, "")}/api/servers/bridge/v1`}</code>
        </p>
        <p className="gcs-muted" style={{ margin: 0, fontSize: 13 }}>
          {t("setup.security")}
        </p>
      </GcsCard>
    </>
  );
}
