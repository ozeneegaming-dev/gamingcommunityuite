"use client";

import {
  faArrowDown,
  faArrowUp,
  faArrowUpRightFromSquare,
  faBullhorn,
  faCalendarDays,
  faCheck,
  faClone,
  faFileLines,
  faFloppyDisk,
  faGripVertical,
  faImage,
  faLayerGroup,
  faPlus,
  faSliders,
  faTrash,
  faTriangleExclamation,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";
import {
  ANNOUNCEMENT_MULTIPLE,
  ANNOUNCEMENT_ORDERS,
  ANNOUNCEMENT_ROTATE,
  ANNOUNCEMENT_TRANSITIONS,
  announcementBarDefaults,
  announcementConfigIssue,
  announcementPlainText,
  announcementStatus,
  parseAnnouncementText,
  type GcsAnnouncementBar,
  type GcsAnnouncementConfig,
  type GcsAnnouncementStats,
  type GcsAnnouncementVars,
} from "@gcs/modules/announcement";
import { gcsToast, GcsButton, GcsDrawer, GcsIconSvg, GcsModal } from "@gcs/ui";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { announcementBarStyle, GcsAnnouncementBarView, GcsAnnouncementIconSvg, type GcsAnnouncementIcon } from "@/app/(site)/_components/GcsAnnouncementBar";
import { resetAnnouncementBarStats, saveAnnouncementBars } from "./actions";
import { AnnAudienceSection, AnnBehaviourSection, AnnContentSection, AnnLookSection, AnnPositionSection, AnnScheduleSection, AnnSeg, AnnToggle, type AnnGroup } from "./GcsAnnouncementSections";

const SECTIONS = [
  { key: "content", icon: faFileLines },
  { key: "look", icon: faImage },
  { key: "position", icon: faLayerGroup },
  { key: "audience", icon: faUsers },
  { key: "schedule", icon: faCalendarDays },
  { key: "behaviour", icon: faSliders },
] as const;
type Section = (typeof SECTIONS)[number]["key"];

/** Secțiunea panoului în care stă un câmp (o eroare de la salvare deschide secțiunea ei). */
const FIELD_SECTION: Record<string, Section> = {
  label: "content",
  icon: "content",
  text: "content",
  mobileText: "content",
  cta: "content",
  link: "content",
  countdown: "content",
  preset: "look",
  bgKind: "look",
  bgColor: "look",
  bgColor2: "look",
  bgAngle: "look",
  bgImage: "look",
  fgColor: "look",
  size: "look",
  align: "look",
  textMode: "look",
  pillStyle: "look",
  position: "position",
  sticky: "position",
  fullWidth: "position",
  startsAt: "schedule",
  endsAt: "schedule",
  days: "schedule",
  timeFrom: "schedule",
  timeTo: "schedule",
  dismissible: "behaviour",
  closeOnCta: "behaviour",
  reappearDays: "behaviour",
  rotateSeconds: "behaviour",
};

const newId = () => Math.random().toString(36).slice(2, 10);

/** Acțiunile din titlul paginii („Vezi pe site”, „Setări generale”, „Bară nouă”), legate de editor. */
const EditorActions = createContext<{ add: () => void; openSettings: () => void; canAdd: boolean } | null>(null);

export function GcsAnnouncementTitleActions() {
  const t = useTranslations("acp.announcementBar");
  const ctx = useContext(EditorActions);
  return (
    <>
      <GcsButton variant="ghost" asChild icon={<GcsIconSvg icon={faArrowUpRightFromSquare} />}>
        <a href="/" target="_blank" rel="noopener" data-testid="gcs-ann-view-site">
          {t("preview")}
        </a>
      </GcsButton>
      <GcsButton type="button" variant="ghost" icon={<GcsIconSvg icon={faSliders} />} onClick={() => ctx?.openSettings()} data-testid="gcs-ann-settings">
        {t("settings.title")}
      </GcsButton>
      <GcsButton type="button" variant="primary" icon={<GcsIconSvg icon={faPlus} />} disabled={!ctx?.canAdd} onClick={() => ctx?.add()} data-testid="gcs-ann-add">
        {t("add")}
      </GcsButton>
    </>
  );
}

/** Desenul iconițelor alese în panou (cele salvate vin de la server; cele noi se cer o singură dată). */
function useIcons(initial: Record<string, GcsAnnouncementIcon>, names: (string | null)[]) {
  const [icons, setIcons] = useState(initial);
  const missing = names.filter((n): n is string => !!n && !icons[n]).join("|");
  useEffect(() => {
    if (!missing) return;
    const ctrl = new AbortController();
    for (const name of missing.split("|")) {
      fetch(`/api/icons/search?name=${encodeURIComponent(name)}`, { signal: ctrl.signal })
        .then((r) => r.json() as Promise<{ icons: (GcsAnnouncementIcon & { name: string })[] }>)
        .then((res) => {
          const icon = res.icons[0];
          if (icon) setIcons((m) => ({ ...m, [name]: icon }));
        })
        .catch(() => {});
    }
    return () => ctrl.abort();
  }, [missing]);
  return icons;
}

type Props = {
  title: ReactNode;
  initial: GcsAnnouncementConfig;
  stats: Record<string, GcsAnnouncementStats>;
  groups: AnnGroup[];
  locales: { code: string; name: string }[];
  icons: Record<string, GcsAnnouncementIcon>;
  timeZone: string;
  zoneLabel: string;
  sampleName: string;
  maxBars: number;
};

/**
 * Editorul barelor de anunț (macheta „Bara de anunț v2”): în stânga lista barelor (miniatura, starea calculată din
 * program, poziția, publicul, cifrele, pornit / oprit, ordinea prin tragere sau săgeți), în dreapta panoul barei alese cu
 * previzualizarea live (desktop / telefon, un site în miniatură cu bara în poziția aleasă) și cele șase secțiuni.
 * „Salvează” trimite toate barele și setările generale; validarea serverului deschide câmpul cu problema.
 */
export function GcsAnnouncementEditor({ title, initial, stats: initialStats, groups, locales, icons: initialIcons, timeZone, zoneLabel, sampleName, maxBars }: Props) {
  const t = useTranslations("acp.announcementBar");
  const ts = useTranslations("site.announcementBar");
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [config, setConfig] = useState(initial);
  const [selected, setSelected] = useState<string | null>(initial.bars[0]?.id ?? null);
  const [section, setSection] = useState<Section>("content");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [stats, setStats] = useState(initialStats);
  const [resetting, setResetting] = useState(false);
  const [pending, start] = useTransition();
  /** Rezultatul ultimei salvări, în pagină (și ca toast). */
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [now, setNow] = useState(() => new Date());

  const bar = config.bars.find((b) => b.id === selected) ?? null;
  const index = bar ? config.bars.indexOf(bar) : -1;
  const savedIds = useMemo(() => new Set(saved.bars.map((b) => b.id)), [saved]);
  const dirty = useMemo(() => JSON.stringify(config) !== JSON.stringify(saved), [config, saved]);
  const icons = useIcons(initialIcons, config.bars.map((b) => b.icon));
  const vars: GcsAnnouncementVars = { membri_online: format.number(128), jucatori_online: format.number(57), numele_tau: sampleName };

  // Ceasul previzualizării (numărătoarea secundă cu secundă; altfel starea barelor din listă).
  const fast = !!bar?.countdown;
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), fast ? 1000 : 30_000);
    return () => clearInterval(id);
  }, [fast]);

  // Modificări nesalvate: browserul întreabă înainte de a părăsi pagina.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const setBar = (patch: Partial<GcsAnnouncementBar>) => {
    if (!bar) return;
    setConfig((c) => ({ ...c, bars: c.bars.map((b) => (b.id === bar.id ? { ...b, ...patch } : b)) }));
    setStatus(null);
  };
  const patchBar = (id: string, patch: Partial<GcsAnnouncementBar>) => setConfig((c) => ({ ...c, bars: c.bars.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
  const setGeneral = (patch: Partial<GcsAnnouncementConfig>) => setConfig((c) => ({ ...c, ...patch }));
  const move = (id: string, to: number) =>
    setConfig((c) => {
      const from = c.bars.findIndex((b) => b.id === id);
      if (from < 0 || to < 0 || to >= c.bars.length || from === to) return c;
      const bars = [...c.bars];
      const [item] = bars.splice(from, 1);
      bars.splice(to, 0, item!);
      return { ...c, bars };
    });

  const add = () => {
    if (config.bars.length >= maxBars) return;
    const fresh = announcementBarDefaults(newId());
    setConfig((c) => ({ ...c, bars: [...c.bars, fresh] }));
    setSelected(fresh.id);
    setSection("content");
  };
  const duplicate = () => {
    if (!bar || config.bars.length >= maxBars) return;
    const copy: GcsAnnouncementBar = { ...structuredClone(bar), id: newId(), enabled: false, version: 1 };
    setConfig((c) => ({ ...c, bars: [...c.bars.slice(0, index + 1), copy, ...c.bars.slice(index + 1)] }));
    setSelected(copy.id);
  };

  const showError = (fields: Record<string, string>) => {
    const [path = "", code = "invalid"] = Object.entries(fields)[0] ?? [];
    const m = /^bars\.(\d+)\.([A-Za-z]+)/.exec(path);
    if (m) {
      const target = config.bars[Number(m[1])];
      if (target) setSelected(target.id);
      const s = FIELD_SECTION[m[2]!] ?? (["guests", "members", "groups", "excludeGroups", "newMembersDays", "devices", "pages", "paths", "excludePaths", "locales"].includes(m[2]!) ? "audience" : "content");
      setSection(s);
    } else if (path && path !== "bars") {
      setSettingsOpen(true);
    }
    const text = errorMessage({ code: "validation", status: 422, fields: { [path || "_"]: code } });
    setStatus({ ok: false, text });
    gcsToast({ title: text, icon: <GcsIconSvg icon={faTriangleExclamation} /> });
  };

  const save = () =>
    start(async () => {
      // Aceeași validare ca pe server: problema se arată pe loc, cu secțiunea ei deschisă.
      const issue = announcementConfigIssue(config);
      if (issue) return showError({ [issue.path]: issue.code });
      const res = await saveAnnouncementBars(config);
      if (!res.ok) {
        if (res.error.fields) return showError(res.error.fields);
        const text = errorMessage(res.error);
        setStatus({ ok: false, text });
        gcsToast({ title: text, icon: <GcsIconSvg icon={faTriangleExclamation} /> });
        return;
      }
      setConfig(res.data);
      setSaved(res.data);
      setStatus({ ok: true, text: t("saved") });
      gcsToast({ title: t("saved"), icon: <GcsIconSvg icon={faCheck} /> });
      router.refresh();
    });

  const resetStats = async () => {
    if (!bar) return;
    setResetting(true);
    const res = await resetAnnouncementBarStats(bar.id);
    setResetting(false);
    if (res.ok) setStats((s) => ({ ...s, [bar.id]: res.data }));
    else gcsToast({ title: errorMessage(res.error), icon: <GcsIconSvg icon={faTriangleExclamation} /> });
  };

  const statusChip = (b: GcsAnnouncementBar) => {
    const s = announcementStatus(b, now);
    const date = s === "scheduled" && b.startsAt ? format.dateTime(new Date(b.startsAt), { day: "numeric", month: "short", timeZone }) : "";
    return (
      <span className={`gcs-annEd__status gcs-annEd__status--${s}`} data-testid="gcs-ann-status-chip" data-status={s}>
        {t(`status.${s}`, { date })}
      </span>
    );
  };
  const audience = (b: GcsAnnouncementBar) => {
    const names = (ids: number[]) => ids.map((id) => groups.find((g) => g.id === id)?.name).filter(Boolean).join(", ");
    const parts: string[] = [];
    if (b.guests && b.members && b.groups.length === 0) parts.push(t("audience.summary.everyone"));
    else if (b.guests && !b.members) parts.push(t("audience.summary.guests"));
    else if (!b.guests && !b.members) parts.push(t("audience.summary.nobody"));
    else if (b.groups.length > 0) parts.push(t("audience.summary.groups", { groups: names(b.groups) }));
    else parts.push(t("audience.summary.members"));
    if (b.members && b.excludeGroups.length > 0) parts.push(t("audience.summary.without", { groups: names(b.excludeGroups) }));
    if (b.pages !== "all") parts.push(t(`audience.summary.pages.${b.pages}`));
    return parts.join(" · ");
  };

  const preview = bar && (
    <GcsAnnouncementBarView
      bar={bar}
      vars={vars}
      icon={bar.icon ? (icons[bar.icon] ?? null) : null}
      labels={{ region: ts("region"), dismiss: ts("dismiss"), show: ts.raw("show") as string, days: ts.raw("days") as string, timeLeft: ts("timeLeft") }}
      now={now}
      transition="none"
      device={device}
      onDismiss={() => {}}
      testId="gcs-ann-preview-bar"
    />
  );

  return (
    <EditorActions.Provider value={{ add, openSettings: () => setSettingsOpen(true), canAdd: config.bars.length < maxBars }}>
      {title}
      <div className="gcs-annEd" data-testid="gcs-ann-editor">
        <section className="gcs-card gcs-annEd__list" aria-label={t("list")}>
          <header className="gcs-annEd__listHead">
            <b>{t("list")}</b>
            <span className="gcs-annEd__count">{t("count", { n: config.bars.length, max: maxBars })}</span>
          </header>
          {config.bars.length === 0 && (
            <div className="gcs-annEd__empty">
              <GcsIconSvg icon={faBullhorn} />
              <p>{t("empty")}</p>
              <GcsButton type="button" variant="primary" size="sm" icon={<GcsIconSvg icon={faPlus} />} onClick={add}>
                {t("add")}
              </GcsButton>
            </div>
          )}
          <ol className="gcs-annEd__rows">
            {config.bars.map((b, i) => {
              const s = stats[b.id];
              return (
                <li
                  key={b.id}
                  className={["gcs-annEd__row", b.id === selected && "gcs-annEd__row--sel", dragging === b.id && "gcs-annEd__row--drag"].filter(Boolean).join(" ")}
                  draggable
                  onDragStart={(e) => {
                    setDragging(b.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", b.id);
                  }}
                  onDragOver={(e) => {
                    if (!dragging) return;
                    e.preventDefault();
                    if (dragging !== b.id) move(dragging, i);
                  }}
                  onDragEnd={() => setDragging(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(null);
                  }}
                  data-testid="gcs-ann-row"
                  data-bar={b.id}
                >
                  <span className="gcs-annEd__grip" aria-hidden="true">
                    <GcsIconSvg icon={faGripVertical} />
                  </span>
                  <button type="button" className="gcs-annEd__rowMain" aria-current={b.id === selected ? "true" : undefined} onClick={() => setSelected(b.id)} data-testid="gcs-ann-row-open">
                    <span className={`gcs-annEd__mini gcs-annBar--${b.preset}`} style={announcementBarStyle(b)}>
                      {b.icon && icons[b.icon] && <GcsAnnouncementIconSvg icon={icons[b.icon]!} />}
                      <span>
                        {b.label && <b>{b.label} · </b>}
                        {announcementPlainText(parseAnnouncementText(b.text), vars) || t("untitled")}
                      </span>
                    </span>
                    <span className="gcs-annEd__meta">
                      {statusChip(b)}
                      <span>{t(`positions.${b.position}`)}</span>
                      <span>{audience(b)}</span>
                      {s && savedIds.has(b.id) && (
                        <span>
                          {t.rich("rowStats", { views: format.number(s.views), clicks: format.number(s.clicks), b: (chunks) => <b>{chunks}</b> })}
                        </span>
                      )}
                    </span>
                  </button>
                  <span className="gcs-annEd__rowTools">
                    <button type="button" className="gcs-iconBtn" aria-label={t("moveUp")} disabled={i === 0} onClick={() => move(b.id, i - 1)}>
                      <GcsIconSvg icon={faArrowUp} />
                    </button>
                    <button type="button" className="gcs-iconBtn" aria-label={t("moveDown")} disabled={i === config.bars.length - 1} onClick={() => move(b.id, i + 1)}>
                      <GcsIconSvg icon={faArrowDown} />
                    </button>
                    <input
                      type="checkbox"
                      role="switch"
                      className="gcs-switch"
                      checked={b.enabled}
                      aria-label={t("enabledFor", { n: i + 1 })}
                      onChange={(e) => patchBar(b.id, { enabled: e.target.checked })}
                      data-testid="gcs-ann-enabled"
                    />
                  </span>
                </li>
              );
            })}
          </ol>
        </section>

        {bar ? (
          <section className="gcs-card gcs-annEd__panel" aria-label={t("panel")} data-testid="gcs-ann-editor-bar" data-bar={bar.id}>
            <header className="gcs-annEd__panelHead">
              <span className="gcs-annEd__panelIcon" aria-hidden="true">
                {bar.icon && icons[bar.icon] ? <GcsAnnouncementIconSvg icon={icons[bar.icon]!} /> : <GcsIconSvg icon={faBullhorn} />}
              </span>
              <h2 className="gcs-annEd__panelTitle">{bar.label || announcementPlainText(parseAnnouncementText(bar.text), vars) || t("bar", { n: index + 1 })}</h2>
              {statusChip(bar)}
              <span className="gcs-annEd__spacer" />
              <GcsButton type="button" variant="ghost" size="sm" icon={<GcsIconSvg icon={faClone} />} disabled={config.bars.length >= maxBars} onClick={duplicate} data-testid="gcs-ann-duplicate">
                {t("duplicate")}
              </GcsButton>
            </header>

            <div className="gcs-annEd__preview">
              <div className="gcs-annEd__previewHead">
                <b>{t("livePreview")}</b>
                <span className="gcs-annEd__spacer" />
                <AnnSeg
                  label={t("device")}
                  value={device}
                  options={[
                    { value: "desktop", label: t("devices.desktop") },
                    { value: "mobile", label: t("devices.mobile") },
                  ]}
                  onChange={setDevice}
                  testId="gcs-ann-device"
                />
              </div>
              <div className={`gcs-annPv gcs-annPv--${device}`} data-position={bar.position} data-testid="gcs-ann-preview">
                {bar.position === "top" && <div className="gcs-annPv__slot gcs-annPv__slot--top">{preview}</div>}
                <div className="gcs-annPv__hdr" aria-hidden="true">
                  <span className="gcs-annPv__nav">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="gcs-annPv__logo" />
                  <span className="gcs-annPv__nav gcs-annPv__nav--end">
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
                {bar.position === "under" && <div className="gcs-annPv__slot gcs-annPv__slot--under">{preview}</div>}
                <div className="gcs-annPv__body">
                  <i className="gcs-annPv__blk" aria-hidden="true" />
                  {bar.position === "page" && <div className="gcs-annPv__slot gcs-annPv__slot--page">{preview}</div>}
                  <i className="gcs-annPv__card" aria-hidden="true" />
                  <i className="gcs-annPv__card" aria-hidden="true" />
                </div>
                <div className="gcs-annPv__foot" aria-hidden="true" />
                {bar.position === "bottom" && <div className="gcs-annPv__slot gcs-annPv__slot--bottom">{preview}</div>}
              </div>
            </div>

            <div className="gcs-annEd__editor">
              <nav className="gcs-annEd__secnav" aria-label={t("sectionsNav")}>
                {SECTIONS.map((s) => (
                  <button key={s.key} type="button" className={s.key === section ? "gcs-annEd__sec gcs-annEd__sec--on" : "gcs-annEd__sec"} aria-current={s.key === section ? "true" : undefined} onClick={() => setSection(s.key)} data-testid={`gcs-ann-sec-${s.key}`}>
                    <GcsIconSvg icon={s.icon} />
                    {t(`sections.${s.key}`)}
                  </button>
                ))}
              </nav>
              <div className="gcs-annEd__secbody">
                {section === "content" && <AnnContentSection bar={bar} set={setBar} timeZone={timeZone} />}
                {section === "look" && <AnnLookSection bar={bar} set={setBar} />}
                {section === "position" && <AnnPositionSection bar={bar} set={setBar} />}
                {section === "audience" && <AnnAudienceSection bar={bar} set={setBar} groups={groups} locales={locales} />}
                {section === "schedule" && <AnnScheduleSection bar={bar} set={setBar} timeZone={timeZone} zoneLabel={zoneLabel} />}
                {section === "behaviour" && (
                  <AnnBehaviourSection
                    bar={bar}
                    set={setBar}
                    stats={stats[bar.id] ?? null}
                    saved={savedIds.has(bar.id)}
                    statsOn={config.stats}
                    onReset={() => void resetStats()}
                    resetting={resetting}
                    defaultRotate={config.rotateSeconds}
                  />
                )}
              </div>
            </div>

            <footer className="gcs-annEd__foot">
              <GcsButton type="button" variant="ghost" size="sm" className="gcs-annEd__delete" icon={<GcsIconSvg icon={faTrash} />} onClick={() => setRemoving(bar.id)} data-testid="gcs-ann-remove">
                {t("remove")}
              </GcsButton>
              <span className="gcs-annEd__spacer" />
              {status ? (
                <p role={status.ok ? "status" : "alert"} className={status.ok ? "gcs-annEd__saved" : "gcs-annEd__error"} data-testid="gcs-ann-status">
                  {status.text}
                </p>
              ) : (
                <span className="gcs-field__hint">{dirty ? t("unsaved") : t("publishHint")}</span>
              )}
              <GcsButton type="button" variant="primary" icon={<GcsIconSvg icon={faFloppyDisk} />} onClick={save} loading={pending} data-testid="gcs-ann-save">
                {t("save")}
              </GcsButton>
            </footer>
          </section>
        ) : (
          <section className="gcs-card gcs-annEd__panel gcs-annEd__panel--empty">
            <p className="gcs-muted">{config.bars.length === 0 ? t("emptyPanel") : t("pick")}</p>
            {dirty && (
              <GcsButton type="button" variant="primary" icon={<GcsIconSvg icon={faFloppyDisk} />} onClick={save} loading={pending} data-testid="gcs-ann-save">
                {t("save")}
              </GcsButton>
            )}
            {status && (
              <p role={status.ok ? "status" : "alert"} className={status.ok ? "gcs-annEd__saved" : "gcs-annEd__error"} data-testid="gcs-ann-status">
                {status.text}
              </p>
            )}
          </section>
        )}
      </div>

      {settingsOpen && (
        <GcsDrawer
          title={t("settings.title")}
          icon={<GcsIconSvg icon={faSliders} />}
          onClose={() => setSettingsOpen(false)}
          closeLabel={t("cancel")}
          testId="gcs-ann-settings-panel"
          footer={
            <>
              <span className="gcs-field__hint">{t("settings.savedWith")}</span>
              <span className="gcs-annEd__spacer" />
              <GcsButton type="button" variant="primary" icon={<GcsIconSvg icon={faCheck} />} onClick={() => setSettingsOpen(false)} data-testid="gcs-ann-settings-done">
                {t("settings.done")}
              </GcsButton>
            </>
          }
        >
          <fieldset className="gcs-formSec">
            <legend>{t("settings.rotation")}</legend>
            <div className="gcs-formGrid">
              <label className="gcs-field">
                <span className="gcs-annEd__label">{t("settings.multiple")}</span>
                <select className="gcs-input" value={config.multiple} onChange={(e) => setGeneral({ multiple: e.target.value as GcsAnnouncementConfig["multiple"] })} data-testid="gcs-ann-multiple">
                  {ANNOUNCEMENT_MULTIPLE.map((v) => (
                    <option key={v} value={v}>
                      {t(`settings.multiples.${v}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="gcs-field">
                <span className="gcs-annEd__label">{t("settings.transition")}</span>
                <select className="gcs-input" value={config.transition} disabled={config.multiple !== "rotate"} onChange={(e) => setGeneral({ transition: e.target.value as GcsAnnouncementConfig["transition"] })} data-testid="gcs-ann-transition">
                  {ANNOUNCEMENT_TRANSITIONS.map((v) => (
                    <option key={v} value={v}>
                      {t(`settings.transitions.${v}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="gcs-field">
                <span className="gcs-annEd__label">{t("settings.order")}</span>
                <select className="gcs-input" value={config.order} onChange={(e) => setGeneral({ order: e.target.value as GcsAnnouncementConfig["order"] })} data-testid="gcs-ann-order">
                  {ANNOUNCEMENT_ORDERS.map((v) => (
                    <option key={v} value={v}>
                      {t(`settings.orders.${v}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="gcs-field">
                <span className="gcs-annEd__label">{t("rotate")}</span>
                <input
                  type="number"
                  className="gcs-input"
                  min={ANNOUNCEMENT_ROTATE.min}
                  max={ANNOUNCEMENT_ROTATE.max}
                  value={config.rotateSeconds}
                  onChange={(e) => setGeneral({ rotateSeconds: Math.min(ANNOUNCEMENT_ROTATE.max, Math.max(ANNOUNCEMENT_ROTATE.min, Math.round(Number(e.target.value) || ANNOUNCEMENT_ROTATE.min))) })}
                  data-testid="gcs-ann-rotate"
                />
                <span className="gcs-field__hint">{t("rotateHelp", { min: ANNOUNCEMENT_ROTATE.min, max: ANNOUNCEMENT_ROTATE.max })}</span>
              </label>
            </div>
            <AnnToggle label={t("settings.pauseOnHover")} checked={config.pauseOnHover} onChange={(pauseOnHover) => setGeneral({ pauseOnHover })} testId="gcs-ann-pause" />
            <AnnToggle label={t("settings.dots")} checked={config.dots} onChange={(dots) => setGeneral({ dots })} testId="gcs-ann-dots" />
          </fieldset>
          <fieldset className="gcs-formSec">
            <legend>{t("stats.title")}</legend>
            <AnnToggle label={t("settings.stats")} hint={t("settings.statsHint")} checked={config.stats} onChange={(stats) => setGeneral({ stats })} testId="gcs-ann-stats-on" />
          </fieldset>
        </GcsDrawer>
      )}

      {removing !== null && (
        <GcsModal title={t("removeTitle")} icon={<GcsIconSvg icon={faTrash} />} onClose={() => setRemoving(null)} closeLabel={t("cancel")} size="sm">
          <p style={{ marginTop: 0 }}>{t("removeBody", { text: config.bars.find((b) => b.id === removing)?.label || announcementPlainText(parseAnnouncementText(config.bars.find((b) => b.id === removing)?.text ?? "")) || t("untitled") })}</p>
          <div className="gcs-footerEditor__actions">
            <GcsButton
              type="button"
              variant="primary"
              icon={<GcsIconSvg icon={faTrash} />}
              onClick={() => {
                const at = config.bars.findIndex((b) => b.id === removing);
                const rest = config.bars.filter((b) => b.id !== removing);
                setConfig((c) => ({ ...c, bars: c.bars.filter((b) => b.id !== removing) }));
                setSelected(rest[Math.min(at, rest.length - 1)]?.id ?? null);
                setRemoving(null);
              }}
              data-testid="gcs-ann-remove-confirm"
            >
              {t("removeConfirm")}
            </GcsButton>
            <GcsButton type="button" variant="ghost" onClick={() => setRemoving(null)}>
              {t("cancel")}
            </GcsButton>
          </div>
        </GcsModal>
      )}
    </EditorActions.Provider>
  );
}
