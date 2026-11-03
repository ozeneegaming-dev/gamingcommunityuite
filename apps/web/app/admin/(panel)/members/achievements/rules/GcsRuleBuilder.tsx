"use client";

import { faBoxOpen, faCopy, faFileExport, faFileImport, faPen, faPlus, faTrash } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsDrawer, GcsIconSvg, GcsTooltip } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { GcsConfirmDialog } from "../../../_components/GcsConfirmDialog";
import { deleteRule, duplicateRule, exportRules, importGamingPack, importRules, saveEventRule, toggleRule } from "../actions";

export type GcsBuilderEvent = { key: string; label: string; icon: string; app: string; appLabel: string; kind: "count" | "value"; scopes: string[]; other: string | null };
type Opt = { id: number; name: string };
export type GcsBuilderReward = { points: number; badgeId: number | null; groupId: number | null; groupDays: number | null; vipGroupId: number | null; vipDays: number | null; nameStyleId: number | null };
export type GcsBuilderRule = {
  id: number;
  name: string;
  event: string;
  enabled: boolean;
  /** Evenimentul nu mai e disponibil (aplicația oprită sau dezinstalată). */
  unavailable: boolean;
  conditions: { mode: "nth" | "every" | "reach"; n: number; forumIds: number[]; serverIds: number[]; groupIds: number[]; windowDays: number | null };
  rewards: { actor: GcsBuilderReward; other: GcsBuilderReward | null };
};

export type GcsRuleBuilderProps = {
  events: GcsBuilderEvent[];
  forums: Opt[];
  servers: Opt[] | null;
  groups: Opt[];
  /** Grupurile care se pot da ca recompensă (fără cele protejate și fără VIP-uri). */
  rewardGroups: Opt[];
  badges: Opt[];
  nameStyles: Opt[];
  vipGroups: Opt[] | null;
  rules: GcsBuilderRule[];
};

const EMPTY: GcsBuilderReward = { points: 0, badgeId: null, groupId: null, groupDays: null, vipGroupId: null, vipDays: null, nameStyleId: null };
const blank = (event: string, kind: "count" | "value"): Omit<GcsBuilderRule, "id" | "unavailable"> => ({
  name: "",
  event,
  enabled: true,
  conditions: { mode: kind === "value" ? "reach" : "nth", n: 1, forumIds: [], serverIds: [], groupIds: [], windowDays: null },
  rewards: { actor: { ...EMPTY, points: 10 }, other: null },
});

const num = (v: string) => (v.trim() === "" ? null : Number(v));
const pick = (list: Opt[], ids: number[]) => list.filter((o) => ids.includes(o.id)).map((o) => o.name);

/**
 * ACP → Membri → Realizări → Reguli (Realizări v2): lista regulilor ca propoziții scurte („Când … → Atunci …”), cu
 * pornire / oprire, copiere, editare și ștergere (confirmare în pagină); exportul / importul JSON și „Pachet Gaming”.
 * Constructorul „Când → Și → Atunci” stă în panoul din dreapta, deschis de „Regulă nouă” sau de „Editează”.
 */
export function GcsRuleBuilder(props: GcsRuleBuilderProps) {
  const t = useTranslations("acp.achievements.v2");
  const tPanel = useTranslations("ui.panel");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const first = props.events[0];
  const [draft, setDraft] = useState(() => blank(first?.key ?? "", first?.kind ?? "count"));
  // Panoul constructorului: `null` = închis, `"new"` = regulă nouă, altfel id-ul regulii editate.
  const [panel, setPanel] = useState<number | "new" | null>(null);
  const editing = typeof panel === "number" ? panel : null;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "delete"; rule: GcsBuilderRule } | { kind: "pack" } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ev = props.events.find((e) => e.key === draft.event);
  const appGroups = [...new Set(props.events.map((e) => e.appLabel))];

  const sentence = (r: Omit<GcsBuilderRule, "id" | "unavailable">) => {
    const e = props.events.find((x) => x.key === r.event);
    const c = r.conditions;
    const when = e ? e.label : r.event;
    const how = e?.kind === "value" || c.mode === "reach" ? t("s.reach", { n: c.n }) : c.mode === "every" ? t("s.every", { n: c.n }) : t("s.nth", { n: c.n });
    const where = [
      c.forumIds.length > 0 ? t("s.forums", { list: pick(props.forums, c.forumIds).join(", ") }) : null,
      c.serverIds.length > 0 && props.servers ? t("s.servers", { list: pick(props.servers, c.serverIds).join(", ") }) : null,
      c.groupIds.length > 0 ? t("s.groups", { list: pick(props.groups, c.groupIds).join(", ") }) : null,
      c.windowDays ? t("s.window", { days: c.windowDays }) : null,
    ].filter(Boolean);
    const reward = (rw: GcsBuilderReward) =>
      [
        rw.points ? t("s.points", { n: rw.points }) : null,
        rw.badgeId ? t("s.badge", { name: pick(props.badges, [rw.badgeId])[0] ?? "?" }) : null,
        rw.groupId ? (rw.groupDays ? t("s.groupDays", { name: pick(props.groups, [rw.groupId])[0] ?? "?", days: rw.groupDays }) : t("s.group", { name: pick(props.groups, [rw.groupId])[0] ?? "?" })) : null,
        rw.vipGroupId && rw.vipDays ? t("s.vip", { name: pick(props.vipGroups ?? [], [rw.vipGroupId])[0] ?? "VIP", days: rw.vipDays }) : null,
        rw.nameStyleId ? t("s.nameStyle", { name: pick(props.nameStyles, [rw.nameStyleId])[0] ?? "?" }) : null,
      ]
        .filter(Boolean)
        .join(", ");
    return { when, how, where: where.join(" · "), then: reward(r.rewards.actor), other: r.rewards.other && e?.other ? `${e.other}: ${reward(r.rewards.other)}` : null };
  };

  async function run<T>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: Parameters<typeof errorMessage>[0] }>, done?: (data: T) => void) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) return setError(errorMessage(res.error));
    done?.(res.data);
    router.refresh();
  }

  const setCond = (patch: Partial<GcsBuilderRule["conditions"]>) => setDraft((d) => ({ ...d, conditions: { ...d.conditions, ...patch } }));
  const setReward = (side: "actor" | "other", patch: Partial<GcsBuilderReward>) =>
    setDraft((d) => ({ ...d, rewards: { ...d.rewards, [side]: { ...(d.rewards[side] ?? EMPTY), ...patch } } }));

  const toggleId = (list: number[], id: number) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  function startEdit(r: GcsBuilderRule) {
    setError(null);
    setDraft({ name: r.name, event: r.event, enabled: r.enabled, conditions: r.conditions, rewards: r.rewards });
    setPanel(r.id);
  }

  function startNew() {
    setError(null);
    setDraft(blank(first?.key ?? "", first?.kind ?? "count"));
    setPanel("new");
  }

  function close() {
    setPanel(null);
    setError(null);
  }

  async function doExport() {
    await run(
      () => exportRules(),
      (data) => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = "gcs-achievement-rules.json";
        a.click();
        URL.revokeObjectURL(url);
      },
    );
  }

  async function doImport(file: File) {
    const text = await file.text();
    await run(
      () => importRules(text),
      (r) => setNotice(t("imported", r)),
    );
  }

  const chips = (list: Opt[], selected: number[], onToggle: (id: number) => void, label: string) => (
    <fieldset className="gcs-ruleB__chips">
      <legend>{label}</legend>
      {list.map((o) => (
        <label key={o.id} className={`gcs-chip gcs-ruleB__chip${selected.includes(o.id) ? " is-on" : ""}`}>
          <input type="checkbox" checked={selected.includes(o.id)} onChange={() => onToggle(o.id)} />
          {o.name}
        </label>
      ))}
    </fieldset>
  );

  const rewardEditor = (side: "actor" | "other") => {
    const r = draft.rewards[side] ?? EMPTY;
    const sel = (value: number | null, list: Opt[], onChange: (v: number | null) => void, label: string, none: string) => (
      <label className="gcs-field">
        {label}
        <select className="gcs-input" value={value ?? ""} onChange={(e) => onChange(num(e.target.value))}>
          <option value="">{none}</option>
          {list.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
    );
    return (
      <div className="gcs-formGrid" data-testid={`gcs-rule-reward-${side}`}>
        <label className="gcs-field">
          {t("rewardPoints")}
          <input className="gcs-input" type="number" min={-1000} max={1000} value={r.points} onChange={(e) => setReward(side, { points: Number(e.target.value) || 0 })} />
        </label>
        {sel(r.badgeId, props.badges, (v) => setReward(side, { badgeId: v }), t("rewardBadge"), t("none"))}
        {sel(r.groupId, props.rewardGroups, (v) => setReward(side, { groupId: v }), t("rewardGroup"), t("none"))}
        {r.groupId !== null && (
          <label className="gcs-field">
            {t("rewardGroupDays")}
            <input className="gcs-input" type="number" min={1} placeholder={t("permanent")} value={r.groupDays ?? ""} onChange={(e) => setReward(side, { groupDays: num(e.target.value) })} />
          </label>
        )}
        {props.vipGroups && (
          <>
            {sel(r.vipGroupId, props.vipGroups, (v) => setReward(side, { vipGroupId: v, vipDays: v ? (r.vipDays ?? 7) : null }), t("rewardVip"), t("none"))}
            {r.vipGroupId !== null && (
              <label className="gcs-field">
                {t("rewardVipDays")}
                <input className="gcs-input" type="number" min={1} value={r.vipDays ?? ""} onChange={(e) => setReward(side, { vipDays: num(e.target.value) })} />
              </label>
            )}
          </>
        )}
        {props.nameStyles.length > 0 && sel(r.nameStyleId, props.nameStyles, (v) => setReward(side, { nameStyleId: v }), t("rewardNameStyle"), t("none"))}
      </div>
    );
  };

  /** Propoziția regulii: „Când” și „Atunci” îngroșate (lista regulilor și previzualizarea din panou). */
  const sentenceView = (r: Omit<GcsBuilderRule, "id" | "unavailable">) => {
    const s = sentence(r);
    return (
      <>
        <b>{t("when")}</b> {s.when} {s.how}
        {s.where && <> · {s.where}</>} <b>→ {t("then")}</b> {s.then || "—"}
        {s.other && <> · {s.other}</>}
      </>
    );
  };

  const save = () =>
    run(
      () => saveEventRule(editing, { ...draft, name: draft.name.trim() || sentence(draft).when }),
      () => {
        setNotice(t("saved"));
        setPanel(null);
      },
    );

  const editingRule = editing !== null ? props.rules.find((r) => r.id === editing) : undefined;

  return (
    <>
      <section className="gcs-card gcs-ruleList" aria-labelledby="gcs-rule-list-title" data-testid="gcs-rule-list">
        <div className="gcs-ruleList__head">
          <h2 id="gcs-rule-list-title" className="gcs-acpWidget__title">
            {t("listTitle", { count: props.rules.length })}
          </h2>
          <div className="gcs-ruleList__tools">
            <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faBoxOpen} />} onClick={() => setConfirm({ kind: "pack" })} data-testid="gcs-rule-pack">
              {t("gamingPack")}
            </GcsButton>
            <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faFileExport} />} onClick={doExport} disabled={props.rules.length === 0}>
              {t("export")}
            </GcsButton>
            <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faFileImport} />} onClick={() => fileRef.current?.click()}>
              {t("import")}
            </GcsButton>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              aria-label={t("import")}
              data-testid="gcs-rule-import-file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void doImport(f);
                e.target.value = "";
              }}
            />
            <GcsButton variant="primary" size="sm" icon={<GcsIconSvg icon={faPlus} />} onClick={startNew} disabled={props.events.length === 0} data-testid="gcs-rule-new">
              {t("builderTitle")}
            </GcsButton>
          </div>
        </div>
        {props.events.length === 0 && <p className="gcs-muted">{t("noEvents")}</p>}
        {props.rules.length === 0 ? (
          <p className="gcs-muted">{t("empty")}</p>
        ) : (
          <ul className="gcs-ruleList__items">
            {props.rules.map((r) => (
              <li key={r.id} className={`gcs-ruleList__row${r.enabled ? "" : " is-off"}`} data-testid="gcs-rule-row" data-rule={r.name}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={r.enabled}
                  aria-label={t("toggle", { name: r.name })}
                  className="gcs-ruleList__switch gcs-sweep"
                  disabled={busy || r.unavailable}
                  onClick={() => run(() => toggleRule(r.id, !r.enabled))}
                >
                  <span />
                </button>
                <span className="gcs-ruleList__text">
                  <strong>{r.name}</strong>
                  <span className="gcs-ruleList__sentence">{sentenceView(r)}</span>
                  {r.unavailable && <span className="gcs-ruleList__warn">{t("unavailable")}</span>}
                </span>
                <span className="gcs-ruleList__actions">
                  <GcsTooltip content={t("edit")}>
                    <button type="button" className="gcs-iconBtn" aria-label={t("editNamed", { name: r.name })} disabled={r.unavailable} onClick={() => startEdit(r)}>
                      <GcsIconSvg icon={faPen} />
                    </button>
                  </GcsTooltip>
                  <GcsTooltip content={t("copy")}>
                    <button type="button" className="gcs-iconBtn" aria-label={t("copyNamed", { name: r.name })} disabled={busy} onClick={() => run(() => duplicateRule(r.id))}>
                      <GcsIconSvg icon={faCopy} />
                    </button>
                  </GcsTooltip>
                  <GcsTooltip content={t("delete")}>
                    <button type="button" className="gcs-iconBtn gcs-iconBtn--danger" aria-label={t("deleteNamed", { name: r.name })} disabled={busy} onClick={() => setConfirm({ kind: "delete", rule: r })}>
                      <GcsIconSvg icon={faTrash} />
                    </button>
                  </GcsTooltip>
                </span>
              </li>
            ))}
          </ul>
        )}
        {panel === null && error && (
          <p role="alert" className="gcs-field__error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="gcs-ruleB__notice">
            {notice}
          </p>
        )}
      </section>

      {panel !== null && (
        <GcsDrawer
          title={editing ? t("editTitle") : t("builderTitle")}
          icon={<GcsIconSvg icon={editing ? faPen : faPlus} />}
          size="lg"
          closeLabel={tPanel("close")}
          onClose={close}
          testId="gcs-rule-builder"
          footer={
            <>
              {editingRule && (
                <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faTrash} />} disabled={busy} onClick={() => setConfirm({ kind: "delete", rule: editingRule })}>
                  {t("delete")}
                </GcsButton>
              )}
              <span className="gcs-achSpacer" />
              {error && (
                <span role="alert" className="gcs-field__error">
                  {error}
                </span>
              )}
              <GcsButton variant="ghost" onClick={close}>
                {t("cancel")}
              </GcsButton>
              <GcsButton variant="primary" icon={<GcsIconSvg icon={editing ? faPen : faPlus} />} disabled={busy} onClick={save}>
                {editing ? t("saveRule") : t("addRule")}
              </GcsButton>
            </>
          }
        >
          <p className="gcs-ruleB__preview" data-testid="gcs-rule-preview">
            {sentenceView(draft)}
          </p>
          <fieldset className="gcs-formSec">
            <legend>{t("when")}</legend>
            <select
              className="gcs-input"
              aria-label={t("event")}
              value={draft.event}
              onChange={(e) => {
                const next = props.events.find((x) => x.key === e.target.value);
                setDraft((d) => ({ ...d, event: e.target.value, conditions: { ...d.conditions, mode: next?.kind === "value" ? "reach" : d.conditions.mode === "reach" ? "nth" : d.conditions.mode }, rewards: next?.other ? d.rewards : { ...d.rewards, other: null } }));
              }}
            >
              {appGroups.map((app) => (
                <optgroup key={app} label={app}>
                  {props.events
                    .filter((x) => x.appLabel === app)
                    .map((x) => (
                      <option key={x.key} value={x.key}>
                        {x.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </fieldset>
          <fieldset className="gcs-formSec">
            <legend>{t("and")}</legend>
            <div className="gcs-formGrid gcs-formGrid--3">
              {ev?.kind === "value" ? (
                <span className="gcs-field">
                  <span>{t("mode")}</span>
                  <span className="gcs-ruleB__text">{t("reachLabel")}</span>
                </span>
              ) : (
                <label className="gcs-field">
                  {t("mode")}
                  <select className="gcs-input" value={draft.conditions.mode} onChange={(e) => setCond({ mode: e.target.value as "nth" | "every" })}>
                    <option value="nth">{t("modeNth")}</option>
                    <option value="every">{t("modeEvery")}</option>
                  </select>
                </label>
              )}
              <label className="gcs-field">
                {t("n")}
                <input className="gcs-input" type="number" min={1} value={draft.conditions.n} onChange={(e) => setCond({ n: Math.max(1, Number(e.target.value) || 1) })} />
              </label>
              {ev?.kind !== "value" && (
                <label className="gcs-field">
                  {t("windowDays")}
                  <input className="gcs-input" type="number" min={1} placeholder={t("anytime")} value={draft.conditions.windowDays ?? ""} onChange={(e) => setCond({ windowDays: num(e.target.value) })} />
                </label>
              )}
            </div>
            <details className="gcs-ruleB__more">
              <summary className="gcs-sweep">{t("moreConditions")}</summary>
              {ev?.scopes.includes("forum") && chips(props.forums, draft.conditions.forumIds, (id) => setCond({ forumIds: toggleId(draft.conditions.forumIds, id) }), t("onlyForums"))}
              {ev?.scopes.includes("server") && props.servers && chips(props.servers, draft.conditions.serverIds, (id) => setCond({ serverIds: toggleId(draft.conditions.serverIds, id) }), t("onlyServers"))}
              {chips(props.groups, draft.conditions.groupIds, (id) => setCond({ groupIds: toggleId(draft.conditions.groupIds, id) }), t("onlyGroups"))}
            </details>
          </fieldset>
          <fieldset className="gcs-formSec">
            <legend>{t("then")}</legend>
            {rewardEditor("actor")}
            {ev?.other && (
              <>
                <label className="gcs-toggleRow">
                  <span>{t("otherReward", { who: ev.other })}</span>
                  <input type="checkbox" checked={draft.rewards.other !== null} onChange={(e) => setDraft((d) => ({ ...d, rewards: { ...d.rewards, other: e.target.checked ? { ...EMPTY, points: 1 } : null } }))} />
                </label>
                {draft.rewards.other && rewardEditor("other")}
              </>
            )}
          </fieldset>
          <fieldset className="gcs-formSec">
            <legend>{t("secRule")}</legend>
            <label className="gcs-field">
              {t("ruleName")}
              <input className="gcs-input" maxLength={80} value={draft.name} placeholder={sentence(draft).when} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            </label>
            <label className="gcs-toggleRow">
              <span>{t("enabled")}</span>
              <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))} />
            </label>
          </fieldset>
        </GcsDrawer>
      )}

      {confirm?.kind === "delete" && (
        <GcsConfirmDialog
          title={t("deleteTitle")}
          body={t("deleteBody", { name: confirm.rule.name })}
          confirmLabel={t("delete")}
          danger
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() =>
            run(
              () => deleteRule(confirm.rule.id),
              () => {
                if (editing === confirm.rule.id) setPanel(null);
                setConfirm(null);
              },
            )
          }
        />
      )}
      {confirm?.kind === "pack" && (
        <GcsConfirmDialog
          title={t("gamingPack")}
          body={t("gamingPackBody")}
          confirmLabel={t("gamingPackImport")}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() =>
            run(
              () => importGamingPack(),
              (r) => {
                setConfirm(null);
                setNotice(t("imported", r));
              },
            )
          }
        />
      )}
    </>
  );
}
