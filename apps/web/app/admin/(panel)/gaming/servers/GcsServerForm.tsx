"use client";

import { faCircleCheck, faCircleXmark, faFloppyDisk, faPlay, faPlus, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { GcsErrorPayload, GcsResult } from "@gcs/core";
import type { GcsServerStatus } from "@gcs/modules";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { GcsUploadInput } from "@/lib/ui-inputs";
import { UPLOAD_RULES } from "@/lib/ui-labels";
import { useErrorMessage } from "@/lib/use-error-message";
import type { GcsAcpIconDef } from "../../_components/types";
import { saveServer, testServer } from "./actions";

/** `protocol`: TeamSpeak cere contul de interogare, Discord doar ID-ul serverului (fără port). */
export type GcsServerFormGame = { key: string; name: string; defaultPort: number; defaultQueryPort: number | null; protocol: string; icon: GcsAcpIconDef | null };
export type GcsServerFormValues = {
  id: number | null;
  game: string;
  name: string;
  host: string;
  port: number;
  queryPort: number | null;
  description: string;
  forumId: number | null;
  groups: number[];
  enabled: boolean;
  bannerUrl: string | null;
  admins: { id: string; name: string }[];
  /** Contul de interogare (TeamSpeak), fără secret: doar dacă e salvat unul. */
  query?: { mode: "raw" | "http"; user: string; hasSecret: boolean };
};

type Props = {
  values: GcsServerFormValues;
  games: GcsServerFormGame[];
  forums: { id: number; name: string; depth: number }[];
  groups: { id: number; name: string }[];
};

const SECTION = { border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 } as const;
const ROW = { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" } as const;
/** Bannerul: imaginile obișnuite, cel mult 8 MB (limita corpului din `/api/servers/banner`). */
const BANNER_RULES = UPLOAD_RULES.image(8);

/** Alegerea adminilor: căutare după nume (ca la mențiuni) și etichete cu „Scoate”; valorile pleacă în `adminIds`. */
function AdminPicker({ initial }: { initial: { id: string; name: string }[] }) {
  const t = useTranslations("acp.servers.fields");
  const [chosen, setChosen] = useState(initial);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setFound([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/forums/mentions?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((r) => (r.ok ? (r.json() as Promise<{ users: { id: string; name: string }[] }>) : { users: [] }))
        .then((d) => setFound(d.users))
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const add = (u: { id: string; name: string }) => {
    setChosen((list) => (list.some((x) => x.id === u.id) || list.length >= 20 ? list : [...list, u]));
    setQuery("");
    setFound([]);
  };

  return (
    <div className="gcs-field" role="group" aria-label={t("admins")}>
      <span>{t("admins")}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }} data-testid="gcs-server-admins-chosen">
        {chosen.length === 0 && <span className="gcs-muted" style={{ fontWeight: 500 }}>{t("adminsNone")}</span>}
        {chosen.map((u) => (
          <span key={u.id} className="gcs-chip">
            <input type="hidden" name="adminIds" value={u.id} />
            {u.name}
            <button type="button" aria-label={t("adminsRemove", { name: u.name })} onClick={() => setChosen((list) => list.filter((x) => x.id !== u.id))}>
              <GcsIconSvg icon={faXmark} />
            </button>
          </span>
        ))}
      </div>
      <input
        className="gcs-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (found[0]) add(found[0]);
          }
        }}
        placeholder={t("adminsSearch")}
        aria-label={t("adminsSearch")}
        autoComplete="off"
        data-testid="gcs-server-admin-search"
      />
      {found.length > 0 && (
        <ul className="gcs-mentionList" role="listbox" aria-label={t("adminsSearch")} style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexWrap: "wrap", gap: 6 }}>
          {found.map((u) => (
            <li key={u.id}>
              <button type="button" className="gcs-btn gcs-btn--ghost gcs-btn--sm" onClick={() => add(u)}>
                <GcsIconSvg icon={faPlus} />
                {u.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <span className="gcs-field__hint">{t("adminsHint")}</span>
    </div>
  );
}

/** Rezultatul butonului „Testează”: statusul citit acum, sau de ce nu răspunde serverul. */
function TestResult({ result }: { result: { ok: true; status: GcsServerStatus } | { ok: false; error: string } }) {
  const t = useTranslations("acp.servers");
  if (!result.ok) {
    return (
      <p role="alert" className="gcs-notice gcs-notice--error" data-testid="gcs-server-test-result">
        {result.error}
      </p>
    );
  }
  const s = result.status;
  return (
    <div role="status" className={`gcs-notice${s.online ? "" : " gcs-notice--error"}`} data-testid="gcs-server-test-result" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <strong style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
        <GcsIconSvg icon={s.online ? faCircleCheck : faCircleXmark} />
        {s.online ? t("testOnline") : t("testOffline")}
      </strong>
      {s.online ? (
        <>
          <span>
            {t("testPlayers", { players: s.players, max: s.maxPlayers })}
            {s.ping !== null && ` · ${t("testPing", { ms: s.ping })}`}
          </span>
          {s.name && (
            <span>
              {t("testName")}: {s.name}
            </span>
          )}
          {s.map && (
            <span>
              {t("testMap")}: {s.map}
            </span>
          )}
          {s.version && (
            <span>
              {t("testVersion")}: {s.version}
            </span>
          )}
          {s.playerList && <span>{t("testList", { count: s.playerList.length })}</span>}
        </>
      ) : (
        s.error && <span>{t.has(`queryErrors.${s.error}`) ? t(`queryErrors.${s.error}`) : s.error}</span>
      )}
    </div>
  );
}

/**
 * Formularul unui server (ACP → Gaming → Servere): jocul, adresa cu butonul „Testează”, bannerul (încărcat prin
 * `/api/servers/banner`), descrierea, forumul, adminii, grupurile care îl văd și „Activ”.
 */
export function GcsServerForm({ values, games, forums, groups }: Props) {
  const t = useTranslations("acp.servers");
  const tf = useTranslations("acp.servers.fields");
  const ta = useTranslations("acp");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [game, setGame] = useState(values.game || games[0]?.key || "");
  const [port, setPort] = useState(String(values.port || games.find((g) => g.key === (values.game || games[0]?.key))?.defaultPort || ""));
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: true; status: GcsServerStatus } | { ok: false; error: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(values.bannerUrl);
  const [queryMode, setQueryMode] = useState<"raw" | "http">(values.query?.mode ?? "raw");
  const protocol = games.find((g) => g.key === game)?.protocol ?? "";
  const discord = protocol === "discord";
  const teamspeak = protocol === "teamspeak";

  /** Alt joc: portul implicit al jocului nou, dacă portul era cel implicit al jocului vechi (sau gol). */
  function chooseGame(key: string) {
    const before = games.find((g) => g.key === game);
    const next = games.find((g) => g.key === key);
    if (next && (port === "" || port === String(before?.defaultPort))) setPort(String(next.defaultPort));
    setGame(key);
  }

  async function runTest() {
    const fd = new FormData(formRef.current!);
    setTesting(true);
    setTest(null);
    const qp = String(fd.get("queryPort") ?? "").trim();
    const res: GcsResult<GcsServerStatus> = await testServer({
      game,
      host: String(fd.get("host") ?? ""),
      port: Number(fd.get("port")),
      queryPort: qp ? Number(qp) : null,
      serverId: values.id,
      ...(teamspeak ? { query: { mode: queryMode, user: String(fd.get("queryUser") ?? ""), ...(String(fd.get("querySecret") ?? "") ? { secret: String(fd.get("querySecret")) } : {}) } } : {}),
    });
    setTesting(false);
    setTest(res.ok ? { ok: true, status: res.data } : { ok: false, error: errorMessage(res.error) });
  }

  async function uploadBanner(file: File): Promise<string | GcsErrorPayload> {
    const body = new FormData();
    body.set("file", file);
    const res = await fetch("/api/servers/banner", { method: "POST", body });
    const json = (await res.json().catch(() => null)) as GcsResult<{ id: string }> | null;
    if (!json) return { code: "validation", status: res.status, fields: { file: "invalid_image" } };
    return json.ok ? json.data.id : json.error;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setSaving(true);
    setStatus(null);
    const file = fd.get("banner");
    fd.delete("banner");
    if (file instanceof File && file.size > 0) {
      const uploaded = await uploadBanner(file);
      if (typeof uploaded !== "string") {
        setSaving(false);
        return setStatus({ ok: false, text: errorMessage(uploaded) });
      }
      fd.set("bannerId", uploaded);
    }
    const res = await saveServer(values.id, fd);
    setSaving(false);
    if (!res.ok) return setStatus({ ok: false, text: errorMessage(res.error) });
    if (values.id === null) {
      router.push("/admin/gaming/servers");
      return;
    }
    setStatus({ ok: true, text: ta("saved") });
    router.refresh();
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 22 }} data-testid="gcs-server-form">
      <fieldset style={SECTION}>
        <legend className="gcs-acpWidget__title" style={{ marginBottom: 8 }}>
          {t("sections.game")}
        </legend>
        <div role="radiogroup" aria-label={tf("game")} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 8 }}>
          {games.map((g) => (
            <label key={g.key} className={`gcs-check gcs-serverGamePick${g.key === game ? " gcs-serverGamePick--on" : ""}`} style={{ padding: "10px 12px", border: "1px solid var(--gcs-border)", borderRadius: 10, gap: 10, background: g.key === game ? "var(--gcs-surface2)" : undefined }}>
              <input type="radio" name="game" value={g.key} checked={g.key === game} onChange={() => chooseGame(g.key)} />
              {g.icon && <GcsIconSvg icon={g.icon} />}
              {g.name}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset style={SECTION}>
        <legend className="gcs-acpWidget__title" style={{ marginBottom: 8 }}>
          {t("sections.connection")}
        </legend>
        <label className="gcs-field" style={{ maxWidth: 520 }}>
          {tf("name")}
          <input className="gcs-input" name="name" defaultValue={values.name} required maxLength={80} />
        </label>
        <div style={ROW}>
          <label className="gcs-field" style={{ flex: "1 1 260px" }}>
            {discord ? tf("guildId") : tf("host")}
            <input className="gcs-input" name="host" defaultValue={values.host} required maxLength={253} autoComplete="off" spellCheck={false} {...(discord ? { inputMode: "numeric" as const, pattern: "\\d{17,20}" } : {})} data-testid="gcs-server-host" />
            <span className="gcs-field__hint">{discord ? tf("guildIdHint") : tf("hostHint")}</span>
          </label>
          {discord ? (
            <input type="hidden" name="port" value="443" />
          ) : (
            <>
              <label className="gcs-field" style={{ width: 130 }}>
                {teamspeak ? tf("voicePort") : tf("port")}
                <input className="gcs-input" name="port" type="number" min={1} max={65535} required value={port} onChange={(e) => setPort(e.target.value)} />
              </label>
              <label className="gcs-field" style={{ width: 170 }}>
                {tf("queryPort")}
                <input className="gcs-input" name="queryPort" type="number" min={1} max={65535} defaultValue={values.queryPort ?? ""} placeholder={teamspeak ? (queryMode === "http" ? "10080" : "10011") : undefined} />
                <span className="gcs-field__hint">{teamspeak ? tf("tsQueryPortHint") : tf("queryPortHint")}</span>
              </label>
            </>
          )}
        </div>
        {teamspeak && (
          <div className="gcs-acpFieldset" style={{ display: "flex", flexDirection: "column", gap: 10 }} data-testid="gcs-server-query">
            <div role="radiogroup" aria-label={tf("queryMode")} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(["raw", "http"] as const).map((m) => (
                <label key={m} className="gcs-check">
                  <input type="radio" name="queryMode" value={m} checked={queryMode === m} onChange={() => setQueryMode(m)} />
                  {tf(`queryModes.${m}`)}
                </label>
              ))}
            </div>
            <div style={ROW}>
              {queryMode === "raw" && (
                <label className="gcs-field" style={{ flex: "1 1 220px" }}>
                  {tf("queryUser")}
                  <input className="gcs-input" name="queryUser" defaultValue={values.query?.user ?? ""} maxLength={100} autoComplete="off" spellCheck={false} data-testid="gcs-server-query-user" />
                </label>
              )}
              <label className="gcs-field" style={{ flex: "1 1 260px" }}>
                {queryMode === "http" ? tf("queryKey") : tf("queryPassword")}
                {/* Doar scris: valoarea salvată nu se trimite niciodată înapoi în pagină. */}
                <input className="gcs-input" name="querySecret" type="password" maxLength={200} autoComplete="new-password" placeholder={values.query?.hasSecret ? tf("querySecretSaved") : ""} data-testid="gcs-server-query-secret" />
                <span className="gcs-field__hint">{values.query?.hasSecret ? tf("querySecretKeep") : tf("querySecretHint")}</span>
              </label>
            </div>
            {values.query?.hasSecret && (
              <label className="gcs-check">
                <input type="checkbox" name="querySecretClear" />
                {tf("querySecretClear")}
              </label>
            )}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
          <GcsButton type="button" variant="ghost" onClick={() => void runTest()} disabled={testing} icon={<GcsIconSvg icon={faPlay} />} data-testid="gcs-server-test">
            {testing ? t("testing") : t("test")}
          </GcsButton>
          {test && <TestResult result={test} />}
        </div>
      </fieldset>

      <fieldset style={SECTION}>
        <legend className="gcs-acpWidget__title" style={{ marginBottom: 8 }}>
          {t("sections.page")}
        </legend>
        <div className="gcs-field" style={{ maxWidth: 520 }}>
          <span>{tf("banner")}</span>
          {preview && <img src={preview} alt={tf("bannerCurrent")} style={{ width: "100%", maxWidth: 520, height: 110, objectFit: "cover", borderRadius: 10, border: "1px solid var(--gcs-border)" }} />}
          {/* Fișierul ales pleacă odată cu formularul (`banner`), încărcat la salvare prin `/api/servers/banner`. */}
          <GcsUploadInput
            name="banner"
            title={tf("bannerUpload")}
            rules={BANNER_RULES}
            current={values.bannerUrl ? { url: values.bannerUrl, name: tf("bannerCurrent") } : null}
            onFile={(file) => setPreview(file ? URL.createObjectURL(file) : values.bannerUrl)}
            testId="gcs-server-banner"
          />
          <span className="gcs-field__hint">{tf("bannerHint")}</span>
          {values.bannerUrl && (
            <label className="gcs-check">
              <input type="checkbox" name="removeBanner" />
              {tf("removeBanner")}
            </label>
          )}
        </div>
        <label className="gcs-field" style={{ maxWidth: 720 }}>
          {tf("description")}
          <textarea className="gcs-input" name="description" defaultValue={values.description} maxLength={2000} rows={5} />
          <span className="gcs-field__hint">{tf("descriptionHint")}</span>
        </label>
        <label className="gcs-field" style={{ maxWidth: 420 }}>
          {tf("forum")}
          <select className="gcs-input" name="forumId" defaultValue={values.forumId ?? ""}>
            <option value="">{tf("noForum")}</option>
            {forums.map((f) => (
              <option key={f.id} value={f.id}>
                {`${"— ".repeat(f.depth)}${f.name}`}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset style={SECTION}>
        <legend className="gcs-acpWidget__title" style={{ marginBottom: 8 }}>
          {t("sections.access")}
        </legend>
        <AdminPicker initial={values.admins} />
        <div className="gcs-field" role="group" aria-label={tf("groups")}>
          <span>{tf("groups")}</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
            {groups.map((g) => (
              <label key={g.id} className="gcs-check">
                <input type="checkbox" name="groups" value={g.id} defaultChecked={values.groups.includes(g.id)} />
                {g.name}
              </label>
            ))}
          </div>
          <span className="gcs-field__hint">{tf("groupsHint")}</span>
        </div>
        <label className="gcs-check">
          <input type="checkbox" name="enabled" defaultChecked={values.enabled} />
          {tf("enabled")}
        </label>
      </fieldset>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <GcsButton type="submit" variant="primary" disabled={saving} icon={<GcsIconSvg icon={values.id === null ? faPlus : faFloppyDisk} />} data-testid="gcs-server-save">
          {values.id === null ? t("create") : t("save")}
        </GcsButton>
        {status && (
          <span role={status.ok ? "status" : "alert"} style={{ fontSize: 13, fontWeight: 600, color: status.ok ? "var(--gcs-ok)" : "#FF8A91" }}>
            {status.text}
          </span>
        )}
      </div>
    </form>
  );
}

