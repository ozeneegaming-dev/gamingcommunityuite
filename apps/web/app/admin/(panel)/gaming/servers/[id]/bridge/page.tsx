import { GCS_ADMIN_FLAGS, SERVERS_ACP_SECTION, gameDef, isPowerAdmin } from "@gcs/modules";
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
import { saveBridgeConfig, saveBridgeModules, saveVipMappings } from "../../bridge-actions";
import { GcsBridgeKeys } from "../../GcsBridgeKeys";
import { GcsPluginDownload } from "../../GcsPluginDownload";
import { GcsServerTv } from "../../GcsServerTv";
import { deleteMatchDemo, refetchMatchDemo, saveServerTv, testServerTv } from "../../tv-actions";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.bridge"))("title") };
}

const KIND_BADGE: Record<string, string> = { STEAM: "gcs-badge--ok", NONSTEAM: "gcs-badge--warn", NAME: "gcs-badge--neutral" };
const DEMO_BADGE: Record<string, string> = { waiting: "gcs-badge--neutral", fetching: "gcs-badge--warn", available: "gcs-badge--ok", not_found: "gcs-badge--neutral", failed: "gcs-badge--accent", expired: "gcs-badge--neutral" };
/** Mărimea unui fișier (MB, o zecimală). */
const mb = (bytes: number | null) => (bytes === null ? "—" : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** Modulele opționale (specul plugin-v2 §1.2): câmpul formularului și cheia din `config.features`. */
const MODULES = [
  ["manageAdmins", "admins"],
  ["enforceSanctions", "sanctions"],
  ["manageVip", "vip"],
  ["mixReady", "mixReady"],
  ["adminCommands", "commands"],
] as const;

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
  const [t, format, canEdit, canDelete, siteUrl, tvView, demos] = await Promise.all([
    getTranslations("acp.bridge"),
    getFormatter(),
    acp.can(actor, SERVERS_ACP_SECTION, "edit"),
    acp.can(actor, SERVERS_ACP_SECTION, "delete"),
    settings.get<string>("site.url"),
    bridge.tv.view(actor, id),
    bridge.demos.recent(actor, id),
  ]);
  const tvReported = status.roster?.tv ?? null;
  const tvError = (code: string | null) => (code && t.has(`tv.errors.${code}`) ? t(`tv.errors.${code}`) : (code ?? "?"));
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
          {status.roster && (
            <span data-testid="gcs-bridge-modules">
              {t("status.modules")}:{" "}
              <strong>{status.roster.modules && status.roster.modules.length > 0 ? status.roster.modules.map((m) => t(`modules.names.${m}`)).join(", ") : t("status.collectorOnly")}</strong>
            </span>
          )}
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
                    {p.adminId === null && isPowerAdmin(p.flags) && (
                      <span className="gcs-badge gcs-badge--accent" title={p.flags ?? ""} data-testid="gcs-bridge-server-admin">
                        {t("status.serverAdmin")}
                      </span>
                    )}
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
        <GcsBridgeKeys serverId={s.id} game={s.game} siteUrl={site} keys={status.keys.map((k) => ({ ...k, lastUsedLabel: k.lastUsedAt ? format.dateTime(new Date(k.lastUsedAt), { dateStyle: "medium", timeStyle: "medium" }) : null, expiresLabel: k.expiresAt ? format.dateTime(new Date(k.expiresAt), { timeStyle: "short" }) : null }))} canEdit={canEdit} canDelete={canDelete} />
      </GcsCard>

      <GcsCard as="section" aria-labelledby="gcs-bridge-package" style={{ padding: 16, maxWidth: 820, display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 id="gcs-bridge-package" className="gcs-acpWidget__title">
          <GcsAcpTitleIcon name="fa-solid fa-file-zipper" />
          {t("package.title")}
        </h2>
        <p className="gcs-muted" style={{ margin: 0, fontSize: 14 }}>
          {t("package.lead")}
        </p>
        {supported && canEdit && <GcsPluginDownload serverId={s.id} game={s.game} variant="primary" label={t("package.download")} testId="gcs-bridge-package" />}
      </GcsCard>

      <GcsCard as="section" aria-labelledby="gcs-bridge-modules" style={{ padding: 16, maxWidth: 820 }}>
        <h2 id="gcs-bridge-modules" className="gcs-acpWidget__title" style={{ marginBottom: 8 }}>
          <GcsAcpTitleIcon name="fa-solid fa-sliders" />
          {t("modules.title")}
        </h2>
        <p className="gcs-muted" style={{ margin: "0 0 12px", fontSize: 14 }}>
          {t("modules.lead")}
        </p>
        <GcsActionForm action={saveBridgeModules.bind(null, s.id)} submitLabel={t("modules.save")} submitKind="save">
          {MODULES.map(([field, key]) => (
            <div key={field}>
              <label className="gcs-checkRow">
                <input type="checkbox" name={field} defaultChecked={status.features[key]} data-testid={`gcs-bridge-module-${key}`} />
                {t(`modules.names.${key}`)}
              </label>
              <span className="gcs-field__hint">{t(`modules.hints.${key}`)}</span>
            </div>
          ))}
        </GcsActionForm>
      </GcsCard>

      {supported && (
        <GcsCard as="section" aria-labelledby="gcs-bridge-tv-title" id="gcs-bridge-tv" style={{ padding: 16, maxWidth: 820, display: "flex", flexDirection: "column", gap: 12 }} data-testid="gcs-bridge-tv">
          <h2 id="gcs-bridge-tv-title" className="gcs-acpWidget__title">
            <GcsAcpTitleIcon name="fa-solid fa-tv" />
            {t("tv.title")}
          </h2>
          <p className="gcs-muted" style={{ margin: 0, fontSize: 14 }}>
            {t("tv.lead")}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 20px", fontSize: 14 }} data-testid="gcs-tv-status">
            {tvReported && (
              <span data-testid="gcs-tv-reported">
                {t("tv.reported.label")}:{" "}
                <strong>
                  {s.game === "cs16"
                    ? t("tv.reported.hltv", { count: tvReported.hltv ?? 0 })
                    : tvReported.enabled === false
                      ? t("tv.reported.gotvOff")
                      : t("tv.reported.gotv", { delay: tvReported.delay ?? 0, port: tvReported.port ?? 0, recording: tvReported.recording ? "yes" : "no" })}
                </strong>
              </span>
            )}
            <span data-testid="gcs-tv-last-fetch">
              {t("tv.lastFetch.label")}:{" "}
              <strong>
                {tvView.lastFetch
                  ? `${format.dateTime(new Date(tvView.lastFetch.at), { dateStyle: "medium", timeStyle: "short" })} · ${
                      tvView.lastFetch.ok
                        ? t("tv.lastFetch.ok", { files: Number(tvView.lastFetch.info?.files ?? 0), matched: Number(tvView.lastFetch.info?.matched ?? 0) })
                        : t("tv.lastFetch.failed", { error: tvError(tvView.lastFetch.code) })
                    }`
                  : t("tv.lastFetch.never")}
              </strong>
            </span>
            {tvView.lastRcon && (
              <span data-testid="gcs-tv-last-rcon">
                {t("tv.lastRcon.label")}:{" "}
                <strong>
                  {format.dateTime(new Date(tvView.lastRcon.at), { dateStyle: "medium", timeStyle: "short" })} · {tvView.lastRcon.action} · {tvView.lastRcon.ok ? t("tv.lastRcon.ok") : tvError(tvView.lastRcon.code)}
                </strong>
              </span>
            )}
          </div>
          <GcsServerTv view={tvView} canEdit={canEdit} save={saveServerTv.bind(null, s.id)} test={testServerTv.bind(null, s.id)} />
          <h3 className="gcs-acpWidget__title" style={{ fontSize: 15, marginTop: 8 }}>
            {t("tv.recent.title")}
          </h3>
          {demos.length === 0 ? (
            <p className="gcs-muted" style={{ margin: 0 }}>
              {t("tv.recent.none")}
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="gcs-table__table" data-testid="gcs-tv-demos">
                <thead>
                  <tr>
                    <th className="gcs-table__th" scope="col">{t("tv.recent.match")}</th>
                    <th className="gcs-table__th" scope="col">{t("tv.recent.status")}</th>
                    <th className="gcs-table__th" scope="col">{t("tv.recent.size")}</th>
                    <th className="gcs-table__th" scope="col">{t("tv.recent.downloads")}</th>
                    <th className="gcs-table__th" scope="col">{t("tv.recent.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {demos.map((d) => (
                    <tr key={d.id} className="gcs-table__row" data-testid="gcs-tv-demo" data-status={d.status}>
                      <td className="gcs-table__td">
                        {d.match ? (
                          <Link href={`/servers/matches/${d.match.id}`}>
                            #{d.match.id} {d.match.map} · {d.match.teams.A} {d.match.score.A}–{d.match.score.B} {d.match.teams.B}
                          </Link>
                        ) : (
                          "—"
                        )}
                        {d.part > 1 && <span className="gcs-muted"> · {t("tv.recent.part", { part: d.part })}</span>}
                      </td>
                      <td className="gcs-table__td">
                        <span className={`gcs-badge ${DEMO_BADGE[d.status] ?? "gcs-badge--neutral"}`}>{t(`tv.demoStatus.${d.status}`)}</span>
                        {d.error && <span className="gcs-muted"> {tvError(d.error)}</span>}
                      </td>
                      <td className="gcs-table__td">{mb(d.size)}</td>
                      <td className="gcs-table__td">{d.downloads}</td>
                      <td className="gcs-table__td">
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {canEdit && d.matchId !== null && d.part === 1 && d.status !== "fetching" && (
                            <GcsActionForm action={refetchMatchDemo.bind(null, d.matchId)} submitLabel={t("tv.recent.refetch")} submitKind="recompute" variant="ghost" compact />
                          )}
                          {canDelete && d.status === "available" && (
                            <GcsActionForm action={deleteMatchDemo.bind(null, d.id)} submitLabel={t("tv.recent.delete")} submitKind="delete" variant="ghost" compact confirm={t("tv.recent.deleteConfirm")} />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GcsCard>
      )}

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
