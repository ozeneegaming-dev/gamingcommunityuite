"use client";

import { faCheck, faFolder, faPlus, faServer, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { GcsServerStatus, GcsWizardInput } from "@gcs/modules";
import { GcsIconSvg } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type CSSProperties } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import type { GcsAcpIconDef } from "../../../_components/types";
import { testServer } from "../../../gaming/servers/actions";
import { checkServerCategory, createServerCategory, createSimpleCategory } from "./actions";

export type GcsWizardGame = { key: string; name: string; protocol: string; defaultPort: number; soon: boolean; icon: GcsAcpIconDef | null };
type Existing = { id: number; name: string; game: string; address: string; linked: boolean };
type Row = { uid: number; existingId: number | null; game: string; name: string; addr: string; check: { state: "idle" | "wait" | "ok" | "off"; info: string } };

type Props = {
  serversAvailable: boolean;
  games: GcsWizardGame[];
  existing: Existing[];
  subforums: { key: string; name: string; on: boolean }[];
};

const LIVE = ["status", "players", "map", "address", "connect", "top"] as const;
const GRADIENTS: Record<string, string> = {
  cs16: "linear-gradient(135deg,#F4B740,#6B4410)",
  cs2: "linear-gradient(135deg,#FF8A3D,#7C2D12)",
  minecraft: "linear-gradient(135deg,#3DDC97,#14532D)",
  minecraft_bedrock: "linear-gradient(135deg,#5EA2FF,#14532D)",
  rust: "linear-gradient(135deg,#E2603A,#5A1F0E)",
  gmod: "linear-gradient(135deg,#5EA2FF,#1D3F7A)",
  teamspeak: "linear-gradient(135deg,#4F86C6,#1A2D4F)",
  mumble: "linear-gradient(135deg,#A0AABE,#2A3140)",
  discord: "linear-gradient(135deg,#7C83FF,#3A3FB8)",
  fivem: "linear-gradient(135deg,#FF5C8A,#5A1030)",
};

/** `host:port` (IPv6 între paranteze) din câmpul adresei; fără port → portul implicit al jocului. */
function splitAddress(raw: string, fallback: number): { host: string; port: number } {
  const v = raw.trim();
  const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(v);
  if (v6) return { host: v6[1]!, port: v6[2] ? Number(v6[2]) : fallback };
  const m = /^([^:\s]+):(\d+)$/.exec(v);
  return m ? { host: m[1]!, port: Number(m[2]) } : { host: v, port: fallback };
}

/**
 * Asistentul „Creează categorie” (macheta aprobată `ServerWizard`): 1. tipul (simplă / servere), 2. jocul (cu protocolul
 * lui), 3. serverele (nume, adresă, „Verifică” cu răspunsul live, sau unul existent) cu subforumurile fiecăruia și ce
 * apare live, 4. rezumatul. Tot ce se creează se verifică pe server înainte de orice scriere.
 */
export function GcsServerWizard({ serversAvailable, games, existing, subforums }: Props) {
  const t = useTranslations("acp.serverWizard");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [type, setType] = useState<"simple" | "servers">(serversAvailable ? "servers" : "simple");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [game, setGame] = useState(games.find((g) => !g.soon)?.key ?? "cs16");
  const [uid, setUid] = useState(2);
  const [rows, setRows] = useState<Row[]>([{ uid: 1, existingId: null, game, name: "", addr: "", check: { state: "idle", info: "" } }]);
  const [subs, setSubs] = useState(subforums.map((s) => ({ name: s.name, on: s.on })));
  const [custom, setCustom] = useState("");
  const [live, setLive] = useState<Record<(typeof LIVE)[number], boolean>>({ status: true, players: true, map: true, address: true, connect: true, top: false });
  const [pickExisting, setPickExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const steps = type === "simple" ? [t("steps.type")] : [t("steps.type"), t("steps.game"), t("steps.servers"), t("steps.confirm")];
  const gameOf = (key: string) => games.find((g) => g.key === key);
  const chosenSubs = subs.filter((s) => s.on).map((s) => s.name);
  const update = (id: number, patch: Partial<Row>) => setRows((list) => list.map((r) => (r.uid === id ? { ...r, ...patch } : r)));

  function payload(): GcsWizardInput {
    return {
      name,
      description,
      subforums: chosenSubs,
      live,
      servers: rows.map((r) => {
        if (r.existingId !== null) return { existingId: r.existingId };
        const g = gameOf(r.game);
        const { host, port } = g?.protocol === "discord" ? { host: r.addr.trim(), port: 443 } : splitAddress(r.addr, g?.defaultPort ?? 27015);
        return { name: r.name, game: r.game, host, port };
      }),
    };
  }

  async function verify(row: Row) {
    const g = gameOf(row.game);
    const { host, port } = g?.protocol === "discord" ? { host: row.addr.trim(), port: 443 } : splitAddress(row.addr, g?.defaultPort ?? 27015);
    update(row.uid, { check: { state: "wait", info: "" } });
    const res = await testServer({ game: row.game, host, port, queryPort: null });
    if (!res.ok) return update(row.uid, { check: { state: "off", info: errorMessage(res.error) } });
    const s: GcsServerStatus = res.data;
    const detail = s.map ?? s.version ?? "";
    update(row.uid, { check: s.online ? { state: "ok", info: [detail, s.maxPlayers > 0 ? `${s.players}/${s.maxPlayers}` : String(s.players)].filter(Boolean).join(" · ") } : { state: "off", info: s.error ? t(`errors.${s.error}` as never) : t("noAnswer") } });
  }

  async function next() {
    setError(null);
    if (step === 1) {
      if (!name.trim()) return setError(t("needName"));
      if (type === "simple") {
        setBusy(true);
        const res = await createSimpleCategory({ name, description });
        setBusy(false);
        if (!res.ok) return setError(errorMessage(res.error));
        router.push(`/admin/community/forums/${res.data.id}`);
        return;
      }
      return setStep(2);
    }
    if (step === 2) {
      // Jocul ales devine implicitul rândurilor încă goale.
      setRows((list) => list.map((r) => (r.existingId === null && !r.addr ? { ...r, game } : r)));
      return setStep(3);
    }
    if (step === 3) {
      setBusy(true);
      const res = await checkServerCategory(payload());
      setBusy(false);
      if (!res.ok) return setError(errorMessage(res.error));
      return setStep(4);
    }
    setBusy(true);
    const res = await createServerCategory(payload());
    setBusy(false);
    if (!res.ok) return setError(errorMessage(res.error));
    router.push(`/admin/community/forums?created=${res.data.categoryId}`);
  }

  const counts = [
    { n: 1, label: t("count.category") },
    { n: rows.length, label: t("count.forums") },
    { n: rows.length * chosenSubs.length, label: t("count.subforums") },
    { n: rows.length, label: t("count.linked") },
  ];

  return (
    <div className="gcs-card gcsx-wiz" data-testid="gcs-server-wizard" data-step={step}>
      <ol className="gcsx-wiz__steps" aria-label={t("stepsLabel")}>
        {steps.map((label, i) => (
          <li key={label} className={`gcsx-wiz__step${i + 1 === step ? " gcsx-wiz__step--on" : i + 1 < step ? " gcsx-wiz__step--done" : ""}`} aria-current={i + 1 === step ? "step" : undefined}>
            <b>{i + 1 < step ? <GcsIconSvg icon={faCheck} /> : i + 1}</b>
            {label}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div className="gcsx-wiz__body">
          <div className="gcsx-wiz__grid2">
            <label className="gcs-field">
              <span className="gcsx-wiz__l">{t("name")}</span>
              <input className="gcs-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required data-testid="gcs-wizard-name" />
            </label>
            <label className="gcs-field">
              <span className="gcsx-wiz__l">{t("description")}</span>
              <input className="gcs-input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} data-testid="gcs-wizard-description" />
            </label>
          </div>
          <span className="gcsx-wiz__l">{t("type")}</span>
          <div className="gcsx-wiz__types" role="radiogroup" aria-label={t("type")}>
            {(["simple", "servers"] as const).map((k) => {
              const off = k === "servers" && !serversAvailable;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={type === k}
                  disabled={off}
                  className={`gcsx-wiz__type${type === k ? " gcsx-wiz__type--on" : ""}`}
                  onClick={() => setType(k)}
                  data-testid={`gcs-wizard-type-${k}`}
                >
                  <span className="gcsx-wiz__typeHead">
                    <span className="gcsx-wiz__tile" style={{ background: k === "simple" ? "linear-gradient(135deg,#4FA3FF,#1D4FA8)" : "linear-gradient(135deg,#FF8A3D,#B33A00)" }} aria-hidden="true">
                      <GcsIconSvg icon={k === "simple" ? faFolder : faServer} />
                    </span>
                    <b>{t(`types.${k}.name`)}</b>
                    {k === "servers" && <span className="gcsx-wiz__badge">{off ? t("premiumOff") : t("appBadge")}</span>}
                  </span>
                  <span className="gcsx-wiz__hint">{t(`types.${k}.desc`)}</span>
                  <span className="gcsx-wiz__points">
                    {[1, 2, 3].map((n) => (
                      <span key={n}>
                        <GcsIconSvg icon={faCheck} />
                        {t(`types.${k}.p${n}` as never)}
                      </span>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="gcsx-wiz__body">
          <div className="gcsx-wiz__headline">
            <h3>{t("gameTitle")}</h3>
            <span className="gcsx-wiz__hint">{t("gameHint")}</span>
          </div>
          <div className="gcsx-wiz__games" role="radiogroup" aria-label={t("gameTitle")}>
            {games.map((g) => (
              <button
                key={g.key}
                type="button"
                role="radio"
                aria-checked={game === g.key}
                disabled={g.soon}
                className={`gcsx-wiz__game${game === g.key ? " gcsx-wiz__game--on" : ""}${g.soon ? " gcsx-wiz__game--off" : ""}`}
                onClick={() => !g.soon && setGame(g.key)}
                data-testid={`gcs-wizard-game-${g.key}`}
              >
                <span className="gcsx-wiz__tile" style={{ background: GRADIENTS[g.key] ?? "var(--gcs-surface2)" }} aria-hidden="true">
                  {g.icon && <GcsIconSvg icon={g.icon} />}
                </span>
                <span className="gcsx-wiz__gameText">
                  <b>{g.name}</b>
                  <span className="gcsx-wiz__hint">{t(`protocols.${g.protocol}` as never)}</span>
                </span>
                {g.soon && <span className="gcsx-wiz__soon">{t("soon")}</span>}
              </button>
            ))}
          </div>
          <p className="gcsx-wiz__note">{t.has(`notes.${game}` as never) ? t(`notes.${game}` as never) : t("notes.default")}</p>
        </div>
      )}

      {step === 3 && (
        <div className="gcsx-wiz__body">
          <div className="gcsx-wiz__headline">
            <h3>{t("serversTitle")}</h3>
            <span className="gcsx-wiz__hint">{t("serversHint")}</span>
          </div>
          <div className="gcsx-wiz__srvHead" aria-hidden="true">
            <span>{t("col.name")}</span>
            <span>{t("col.address")}</span>
            <span>{t("col.live")}</span>
            <span />
          </div>
          {rows.map((r, i) => {
            const ex = r.existingId !== null ? existing.find((e) => e.id === r.existingId) : null;
            const g = gameOf(r.game);
            return (
              <div key={r.uid} className="gcsx-wiz__srv" data-testid="gcs-wizard-server">
                {ex ? (
                  <>
                    <span className="gcs-input gcsx-wiz__static">{ex.name}</span>
                    <span className="gcs-input gcsx-wiz__static gcsx-wiz__mono">{ex.address || g?.name}</span>
                    <span className="gcsx-wiz__ok">
                      <span className="gcsx-wiz__dot" />
                      {t("existing")}
                    </span>
                  </>
                ) : (
                  <>
                    <input className="gcs-input" aria-label={`${t("col.name")} ${i + 1}`} placeholder={t("namePh")} value={r.name} onChange={(e) => update(r.uid, { name: e.target.value })} maxLength={80} data-testid="gcs-wizard-server-name" />
                    <span className="gcsx-wiz__addrCell">
                      {games.filter((x) => !x.soon).length > 1 && (
                        <select className="gcs-input gcsx-wiz__gamePick" aria-label={t("gameTitle")} value={r.game} onChange={(e) => update(r.uid, { game: e.target.value, check: { state: "idle", info: "" } })}>
                          {games
                            .filter((x) => !x.soon)
                            .map((x) => (
                              <option key={x.key} value={x.key}>
                                {x.name}
                              </option>
                            ))}
                        </select>
                      )}
                      <input
                        className="gcs-input gcsx-wiz__mono"
                        aria-label={`${t("col.address")} ${i + 1}`}
                        placeholder={g?.protocol === "discord" ? t("guildPh") : `ip:${g?.defaultPort ?? 27015}`}
                        value={r.addr}
                        onChange={(e) => update(r.uid, { addr: e.target.value, check: { state: "idle", info: "" } })}
                        spellCheck={false}
                        autoComplete="off"
                        data-testid="gcs-wizard-server-address"
                      />
                    </span>
                    <span className={`gcsx-wiz__ok gcsx-wiz__ok--${r.check.state}`} role="status" data-testid="gcs-wizard-server-check">
                      {r.check.state !== "idle" && <span className="gcsx-wiz__dot" />}
                      {r.check.state === "ok" ? t("online", { info: r.check.info }) : r.check.state === "wait" ? t("checking") : r.check.state === "off" ? r.check.info : ""}
                    </span>
                  </>
                )}
                <span className="gcsx-wiz__srvActions">
                  {!ex && (
                    <button type="button" className="gcs-btn gcs-btn--ghost gcs-btn--sm" onClick={() => void verify(r)} disabled={!r.addr.trim() || r.check.state === "wait"} data-testid="gcs-wizard-verify">
                      {t("verify")}
                    </button>
                  )}
                  <button type="button" className="gcs-iconBtn" aria-label={t("remove")} onClick={() => setRows((list) => list.filter((x) => x.uid !== r.uid))} disabled={rows.length === 1}>
                    <GcsIconSvg icon={faXmark} />
                  </button>
                </span>
              </div>
            );
          })}
          <div className="gcsx-wiz__row">
            <button
              type="button"
              className="gcs-btn gcs-btn--ghost"
              onClick={() => {
                setRows((list) => [...list, { uid, existingId: null, game, name: "", addr: "", check: { state: "idle", info: "" } }]);
                setUid(uid + 1);
              }}
              disabled={rows.length >= 20}
              data-testid="gcs-wizard-add"
            >
              <GcsIconSvg icon={faPlus} />
              {t("addServer")}
            </button>
            {existing.length > 0 &&
              (pickExisting ? (
                <select
                  className="gcs-input"
                  style={{ maxWidth: 320 }}
                  aria-label={t("pickExisting")}
                  defaultValue=""
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    const ex = existing.find((x) => x.id === id);
                    if (ex && !rows.some((r) => r.existingId === id)) {
                      setRows((list) => [...list.filter((r) => r.existingId !== null || r.addr || r.name), { uid, existingId: id, game: ex.game, name: ex.name, addr: "", check: { state: "idle", info: "" } }]);
                      setUid(uid + 1);
                    }
                    setPickExisting(false);
                  }}
                  data-testid="gcs-wizard-existing"
                >
                  <option value="">{t("pickExisting")}</option>
                  {existing.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                      {x.address ? ` · ${x.address}` : ""}
                      {x.linked ? ` (${t("alreadyLinked")})` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <button type="button" className="gcs-btn gcs-btn--ghost" onClick={() => setPickExisting(true)} data-testid="gcs-wizard-pick">
                  {t("pickExisting")}
                </button>
              ))}
          </div>

          <div className="gcsx-wiz__grid2" style={{ marginTop: 6 }}>
            <div className="gcsx-wiz__col">
              <span className="gcsx-wiz__l">{t("subsTitle")}</span>
              <div className="gcsx-wiz__chips">
                {subs.map((s, i) => (
                  <button key={`${s.name}-${i}`} type="button" aria-pressed={s.on} className={`gcsx-wiz__chip${s.on ? " gcsx-wiz__chip--on" : ""}`} onClick={() => setSubs((list) => list.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))}>
                    <i aria-hidden="true" />
                    {s.name}
                  </button>
                ))}
                <span className="gcsx-wiz__chip gcsx-wiz__chip--add">
                  <input
                    className="gcsx-wiz__chipInput"
                    placeholder={t("custom")}
                    value={custom}
                    maxLength={60}
                    onChange={(e) => setCustom(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && custom.trim()) {
                        e.preventDefault();
                        setSubs((list) => (list.length >= 10 ? list : [...list, { name: custom.trim(), on: true }]));
                        setCustom("");
                      }
                    }}
                    aria-label={t("custom")}
                    data-testid="gcs-wizard-custom"
                  />
                </span>
              </div>
            </div>
            <div className="gcsx-wiz__col">
              <span className="gcsx-wiz__l">{t("liveTitle")}</span>
              <div className="gcsx-wiz__chips">
                {LIVE.map((k) => (
                  <button key={k} type="button" aria-pressed={live[k]} className={`gcsx-wiz__chip${live[k] ? " gcsx-wiz__chip--on" : ""}`} onClick={() => setLive((v) => ({ ...v, [k]: !v[k] }))}>
                    <i aria-hidden="true" />
                    {t(`live.${k}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="gcsx-wiz__summary">
          <div className="gcsx-wiz__col" style={{ flex: 1 }}>
            <h3>{t("treeTitle")}</h3>
            <div className="gcsx-wiz__tree" data-testid="gcs-wizard-tree">
              <span className="gcsx-wiz__treeCat">
                <GcsIconSvg icon={faFolder} />
                {name} <span className="gcsx-wiz__hint">({t("treeType")})</span>
              </span>
              {rows.map((r) => {
                const ex = r.existingId !== null ? existing.find((e) => e.id === r.existingId) : null;
                return (
                  <span key={r.uid} className="gcsx-wiz__treeItem">
                    <span className="gcsx-wiz__treeSrv">
                      <span className="gcsx-wiz__dot" />
                      {ex ? ex.name : r.name}
                      <span className="gcsx-wiz__hint gcsx-wiz__mono">{ex ? ex.address : r.addr}</span>
                    </span>
                    <span className="gcsx-wiz__treeSubs">{chosenSubs.join(" · ") || t("noSubs")}</span>
                  </span>
                );
              })}
            </div>
          </div>
          <div className="gcsx-wiz__col" style={{ flex: "0 0 360px" }}>
            <h3>{t("summaryTitle")}</h3>
            <div className="gcsx-wiz__counts">
              {counts.map((c) => (
                <div key={c.label}>
                  <b>{c.n}</b>
                  <span className="gcsx-wiz__hint">{c.label}</span>
                </div>
              ))}
            </div>
            <span className="gcsx-wiz__hint">{t("afterNote")}</span>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="gcs-notice gcs-notice--error" data-testid="gcs-wizard-error" style={{ margin: 0 } as CSSProperties}>
          {error}
        </p>
      )}
      <div className="gcsx-wiz__foot">
        <button type="button" className="gcs-btn gcs-btn--ghost" onClick={() => (step === 1 ? router.push("/admin/community/forums") : setStep(step - 1))} disabled={busy}>
          {t("back")}
        </button>
        <span style={{ flex: 1 }} />
        <span className="gcsx-wiz__hint">{t("stepOf", { n: step, total: steps.length })}</span>
        <button type="button" className="gcs-btn gcs-btn--primary" onClick={() => void next()} disabled={busy} data-testid="gcs-wizard-next">
          {step === steps.length ? t("create") : t("continue")}
        </button>
      </div>
    </div>
  );
}
