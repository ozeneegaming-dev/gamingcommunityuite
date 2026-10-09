"use client";

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { faStar as faStarOutline } from "@fortawesome/free-regular-svg-icons";
import {
  faArrowDown,
  faArrowUp,
  faArrowUpRightFromSquare,
  faCertificate,
  faChevronRight,
  faCircleCheck,
  faCircleInfo,
  faCirclePause,
  faCubes,
  faDownload,
  faEllipsis,
  faGripVertical,
  faLock,
  faLockOpen,
  faPowerOff,
  faPuzzlePiece,
  faRotate,
  faSliders,
  faStar,
  faTrash,
  faTriangleExclamation,
  faUnlock,
} from "@fortawesome/free-solid-svg-icons";
import { cx, GcsBadge, GcsButton, GcsDropdown, GcsIconSvg, GcsModal, type GcsDropdownItem } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import type { GcsAcpIconDef } from "../../_components/types";
import { saveAppAccess, saveAppOrder, setLandingApp, toggleApp } from "./app-actions";
import { GcsPluginUpload } from "./GcsPluginUpload";
import { disableAllPlugins, setPluginEnabled, uninstallPlugin } from "./plugin-actions";

/** Un grup din dialogul de acces (fără Banat); Root Admin are mereu acces. */
export type GcsAppGroup = { id: number; name: string; root: boolean };

/** O permisiune de grup editabilă din dialogul 🔒: cine o are acum. */
export type GcsAppAccess = { permission: string; title: string; label: string; allowed: number[] };

export type GcsAppSectionRow = { key: string; label: string; href: string; icon: GcsAcpIconDef | null; access: GcsAppAccess | null };

/** Un rând din listă (aplicație sau plugin), cu textele deja traduse pe server. */
export type GcsAppRow = {
  id: string;
  /** Cheia din ordinea salvată (modulul: `servers`, `plugin.<cheie>`). */
  orderKey: string;
  kind: "app" | "plugin";
  name: string;
  description: string;
  icon: GcsAcpIconDef | null;
  version: string;
  author: string;
  certificate: { signed: boolean; keyId: string | null } | null;
  status: "active" | "stopped" | "locked" | "removed";
  autoDisabled: boolean;
  error: string | null;
  enabled: boolean;
  canToggle: boolean;
  landing: { possible: true } | null;
  access: GcsAppAccess | null;
  /** De ce lipsește dialogul de acces (ex. un plugin oprit). */
  accessNote: string | null;
  sections: GcsAppSectionRow[];
  manageHref: string | null;
  exportHref: string | null;
  uninstall: { removes: string[]; key: string } | null;
};

type Props = {
  apps: GcsAppRow[];
  plugins: GcsAppRow[];
  groups: GcsAppGroup[];
  /** Conținutul dialogului „Detalii” al fiecărui rând (randat pe server). */
  details: Record<string, ReactNode>;
  landing: string;
  landingName: string;
  canEdit: boolean;
  uploadLabels: { file: string; hint: string; submit: string; uploading: string; network: string };
};

type Dialog =
  | { kind: "disable"; row: GcsAppRow }
  | { kind: "disableAll" }
  | { kind: "access"; access: GcsAppAccess }
  | { kind: "details"; row: GcsAppRow }
  | { kind: "update"; row: GcsAppRow }
  | { kind: "uninstall"; row: GcsAppRow };

const STATUS_ICONS = { active: faCircleCheck, stopped: faCirclePause, locked: faLock, removed: faTrash } as const;
const STATUS_TONES = { active: "ok", stopped: "neutral", locked: "info", removed: "neutral" } as const;

/**
 * Lista aplicațiilor și a pluginurilor (specul 2026-10-09-acp-navigatie-aplicatii §2): rânduri compacte cu versiunea,
 * autorul, certificarea, starea, pornirea (★), accesul pe grup (🔒), comutatorul (oprirea cere confirmare, într-un dialog
 * din pagină), secțiunile (▸) și meniul „⋯”. Ordinea se schimbă prin tragere (mâner, și din tastatură: Spațiu, săgeți,
 * Spațiu) sau cu butoanele sus / jos, și se salvează imediat.
 */
export function GcsAppList({ apps, plugins, groups, details, landing, landingName, canEdit, uploadLabels }: Props) {
  const t = useTranslations("acp.appsPage");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [appRows, setAppRows] = useState(apps);
  const [pluginRows, setPluginRows] = useState(plugins);
  const [landingKey, setLandingKey] = useState(landing);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Datele noi de pe server (după `router.refresh()`) înlocuiesc starea optimistă.
  useEffect(() => setAppRows(apps), [apps]);
  useEffect(() => setPluginRows(plugins), [plugins]);
  useEffect(() => setLandingKey(landing), [landing]);

  const others = groups.filter((g) => !g.root);
  const summary = (a: GcsAppAccess) => {
    const count = others.filter((g) => a.allowed.includes(g.id)).length;
    return count === others.length ? t("access.all") : count === 0 ? t("access.none") : t("access.some", { count, total: others.length });
  };
  const restricted = (a: GcsAppAccess) => others.some((g) => !a.allowed.includes(g.id));

  const update = (id: string, patch: Partial<GcsAppRow>) => {
    setAppRows((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setPluginRows((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  async function applyToggle(row: GcsAppRow, next: boolean) {
    update(row.id, { enabled: next, status: next ? "active" : "stopped", autoDisabled: false });
    setNotice(null);
    const res = row.kind === "plugin" ? await setPluginEnabled(row.id, next) : await toggleApp(row.id, next);
    if (!res.ok) {
      update(row.id, { enabled: row.enabled, status: row.status, autoDisabled: row.autoDisabled });
      setNotice({ ok: false, text: errorMessage(res.error) });
      return;
    }
    setNotice({ ok: true, text: t(next ? "toggled.on" : "toggled.off", { name: row.name }) });
    router.refresh();
  }

  function onToggle(row: GcsAppRow, next: boolean) {
    // Oprirea cere confirmare (dialog din pagină: dialogurile native sunt suprimate în browserele integrate).
    if (!next) setDialog({ kind: "disable", row });
    else void applyToggle(row, true);
  }

  async function makeLanding(row: GcsAppRow) {
    const previous = landingKey;
    setLandingKey(row.id);
    setNotice(null);
    const res = await setLandingApp(row.id);
    if (!res.ok) {
      setLandingKey(previous);
      setNotice({ ok: false, text: errorMessage(res.error) });
      return;
    }
    setNotice({ ok: true, text: t("landing.saved", { name: row.name }) });
    router.refresh();
  }

  async function reorder(kind: "app" | "plugin", next: GcsAppRow[]) {
    const previous = kind === "app" ? appRows : pluginRows;
    (kind === "app" ? setAppRows : setPluginRows)(next);
    const order = [...(kind === "app" ? next : appRows), ...(kind === "plugin" ? next : pluginRows)].map((r) => r.orderKey);
    const res = await saveAppOrder(order);
    if (!res.ok) {
      (kind === "app" ? setAppRows : setPluginRows)(previous);
      setNotice({ ok: false, text: errorMessage(res.error) });
      return;
    }
    setNotice({ ok: true, text: t("order.saved") });
  }

  function onAccessSaved(a: GcsAppAccess, allowed: number[]) {
    const patch = (r: GcsAppRow): GcsAppRow => ({
      ...r,
      access: r.access?.permission === a.permission ? { ...r.access, allowed } : r.access,
      sections: r.sections.map((s) => (s.access?.permission === a.permission ? { ...s, access: { ...s.access, allowed } } : s)),
    });
    setAppRows((list) => list.map(patch));
    setPluginRows((list) => list.map(patch));
    setNotice({ ok: true, text: t("access.saved", { name: a.title }) });
    setDialog(null);
    router.refresh();
  }

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rowProps = {
    canEdit,
    landingKey,
    expanded,
    summary,
    restricted,
    onToggle,
    onLanding: (row: GcsAppRow) => void makeLanding(row),
    onAccess: (a: GcsAppAccess) => setDialog({ kind: "access", access: a }),
    onExpand: toggleExpanded,
    onDetails: (row: GcsAppRow) => setDialog({ kind: "details", row }),
    onUpdate: (row: GcsAppRow) => setDialog({ kind: "update", row }),
    onUninstall: (row: GcsAppRow) => setDialog({ kind: "uninstall", row }),
  };

  return (
    <>
      <p className={cx("gcs-appNotice", notice && !notice.ok && "gcs-appNotice--error")} role={notice && !notice.ok ? "alert" : "status"} data-testid="gcs-apps-notice">
        {notice?.text}
      </p>

      <section className="gcs-card gcs-appCard" aria-labelledby="gcs-apps-title" data-testid="gcs-apps-list">
        <header className="gcs-appCard__head">
          <h2 id="gcs-apps-title" className="gcs-acpWidget__title">
            <GcsIconSvg icon={faCubes} className="gcs-acpTitle__icon" />
            {t("appsTitle")}
            <span className="gcs-appCard__count">{appRows.length}</span>
          </h2>
          <p className="gcs-appCard__landing" data-testid="gcs-apps-landing">
            <GcsIconSvg icon={faStar} className="gcs-appCard__star" />
            {t("landing.current", { name: appRows.find((r) => r.id === landingKey)?.name ?? landingName })}
          </p>
        </header>
        <ColumnHeads />
        <SortableRows rows={appRows} kind="app" disabled={!canEdit} onReorder={(next) => void reorder("app", next)} row={rowProps} details={details} />
      </section>

      <section className="gcs-card gcs-appCard" aria-labelledby="gcs-plugins-title" data-testid="gcs-plugins-list">
        <header className="gcs-appCard__head">
          <h2 id="gcs-plugins-title" className="gcs-acpWidget__title">
            <GcsIconSvg icon={faPuzzlePiece} className="gcs-acpTitle__icon" />
            {t("pluginsTitle")}
            <span className="gcs-appCard__count">{pluginRows.length}</span>
          </h2>
          {canEdit && pluginRows.some((p) => p.enabled) && (
            <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faPowerOff} />} onClick={() => setDialog({ kind: "disableAll" })} data-testid="gcs-plugins-disable-all">
              {t("disableAll.button")}
            </GcsButton>
          )}
        </header>
        {pluginRows.length === 0 ? (
          <p className="gcs-acpList__empty">
            <GcsIconSvg icon={faPuzzlePiece} /> {t("pluginsEmpty")}
          </p>
        ) : (
          <>
            <ColumnHeads />
            <SortableRows rows={pluginRows} kind="plugin" disabled={!canEdit} onReorder={(next) => void reorder("plugin", next)} row={rowProps} details={details} />
          </>
        )}
      </section>

      {dialog?.kind === "disable" && (
        <ConfirmDialog
          title={t("disable.title", { name: dialog.row.name })}
          body={dialog.row.kind === "plugin" ? t("disable.pluginBody") : t("disable.body")}
          confirm={t("disable.confirm")}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const row = dialog.row;
            setDialog(null);
            void applyToggle(row, false);
          }}
        />
      )}
      {dialog?.kind === "disableAll" && (
        <ConfirmDialog
          title={t("disableAll.title")}
          body={t("disableAll.body")}
          confirm={t("disableAll.confirm")}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            setBusy(true);
            const res = await disableAllPlugins();
            setBusy(false);
            setDialog(null);
            setNotice(res.ok ? { ok: true, text: t("disableAll.done") } : { ok: false, text: errorMessage(res.error) });
            router.refresh();
          }}
        />
      )}
      {dialog?.kind === "access" && <AccessDialog access={dialog.access} groups={groups} onClose={() => setDialog(null)} onSaved={onAccessSaved} />}
      {dialog?.kind === "details" && (
        <GcsModal title={dialog.row.name} icon={dialog.row.icon ? <GcsIconSvg icon={dialog.row.icon} /> : undefined} size="lg" closeLabel={t("close")} onClose={() => setDialog(null)}>
          <div data-testid="gcs-app-details">{details[dialog.row.id]}</div>
        </GcsModal>
      )}
      {dialog?.kind === "update" && (
        <GcsModal title={t("update.title", { name: dialog.row.name })} icon={<GcsIconSvg icon={faRotate} />} closeLabel={t("close")} onClose={() => setDialog(null)}>
          <p className="gcs-appDialog__text">{t("update.body", { version: dialog.row.version })}</p>
          <GcsPluginUpload labels={uploadLabels} />
        </GcsModal>
      )}
      {dialog?.kind === "uninstall" && dialog.row.uninstall && (
        <UninstallDialog
          row={dialog.row}
          onClose={() => setDialog(null)}
          onDone={(keepData) => {
            setDialog(null);
            setNotice({ ok: true, text: t(keepData ? "uninstall.doneKept" : "uninstall.done", { name: dialog.row.name }) });
            router.refresh();
          }}
        />
      )}
    </>
  );
}

/** Capul de coloane (doar vizual: fiecare rând își spune singur valorile). */
function ColumnHeads() {
  const t = useTranslations("acp.appsPage.columns");
  return (
    <div className="gcs-appRow gcs-appRow--head" aria-hidden="true">
      <span className="gcs-appRow__order" />
      <span className="gcs-appRow__name">{t("name")}</span>
      <span className="gcs-appRow__version">{t("version")}</span>
      <span className="gcs-appRow__author">{t("author")}</span>
      <span className="gcs-appRow__status">{t("status")}</span>
      <span className="gcs-appRow__actions">{t("actions")}</span>
    </div>
  );
}

type RowHandlers = {
  canEdit: boolean;
  landingKey: string;
  expanded: ReadonlySet<string>;
  summary: (a: GcsAppAccess) => string;
  restricted: (a: GcsAppAccess) => boolean;
  onToggle: (row: GcsAppRow, next: boolean) => void;
  onLanding: (row: GcsAppRow) => void;
  onAccess: (a: GcsAppAccess) => void;
  onExpand: (id: string) => void;
  onDetails: (row: GcsAppRow) => void;
  onUpdate: (row: GcsAppRow) => void;
  onUninstall: (row: GcsAppRow) => void;
};

function SortableRows({ rows, kind, disabled, onReorder, row, details }: { rows: GcsAppRow[]; kind: "app" | "plugin"; disabled: boolean; onReorder: (next: GcsAppRow[]) => void; row: RowHandlers; details: Record<string, ReactNode> }) {
  // Id stabil (server = client), altfel `aria-describedby` al mânerelor diferă la hidratare.
  const id = useId();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    onReorder(arrayMove(rows, rows.findIndex((r) => r.id === e.active.id), rows.findIndex((r) => r.id === e.over!.id)));
  }
  return (
    <DndContext id={`${id}-${kind}`} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy} disabled={disabled}>
        <ul className="gcs-appList">
          {rows.map((r, i) => (
            <AppRow
              key={r.id}
              row={r}
              first={i === 0}
              last={i === rows.length - 1}
              reorderable={!disabled}
              onMove={(delta) => onReorder(arrayMove(rows, i, i + delta))}
              handlers={row}
              hasDetails={r.id in details}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

type AppRowProps = { row: GcsAppRow; first: boolean; last: boolean; reorderable: boolean; onMove: (delta: -1 | 1) => void; handlers: RowHandlers; hasDetails: boolean };

function AppRow({ row, first, last, reorderable, onMove, handlers, hasDetails }: AppRowProps) {
  const t = useTranslations("acp.appsPage");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id, disabled: !reorderable });
  const open = handlers.expanded.has(row.id);
  const sectionsId = `gcs-app-sections-${row.id.replace(/[^a-z0-9_-]/gi, "-")}`;
  const isLanding = handlers.landingKey === row.id;

  const menu: GcsDropdownItem[] = [
    ...(hasDetails ? [{ kind: "action" as const, label: t("menu.details"), icon: <GcsIconSvg icon={faCircleInfo} />, onSelect: () => handlers.onDetails(row), testId: `gcs-app-details-${row.id}` }] : []),
    ...(row.manageHref ? [{ kind: "link" as const, label: t("menu.manage"), href: row.manageHref, icon: <GcsIconSvg icon={faSliders} />, testId: `gcs-plugin-manage-${row.id}` }] : []),
    ...(row.kind === "plugin" && row.status !== "removed" && handlers.canEdit
      ? [{ kind: "action" as const, label: t("menu.update"), icon: <GcsIconSvg icon={faRotate} />, onSelect: () => handlers.onUpdate(row), testId: `gcs-plugin-update-${row.id}` }]
      : []),
    ...(row.exportHref ? [{ kind: "link" as const, label: t("menu.export"), href: row.exportHref, icon: <GcsIconSvg icon={faDownload} />, testId: `gcs-plugin-export-${row.id}` }] : []),
    ...(row.uninstall
      ? [
          { kind: "separator" as const },
          { kind: "action" as const, label: t("menu.uninstall"), icon: <GcsIconSvg icon={faTrash} />, onSelect: () => handlers.onUninstall(row), testId: `gcs-plugin-uninstall-${row.id}` },
        ]
      : []),
    ...(row.kind === "app" && row.status === "locked" ? [{ kind: "separator" as const }, { kind: "heading" as const, label: t("menu.coreNote") }] : []),
  ];

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx("gcs-appItem", isDragging && "gcs-appItem--dragging", open && "gcs-appItem--open")}
      data-testid={`gcs-app-${row.id}`}
      data-status={row.status}
    >
      <div className="gcs-appRow">
        <span className="gcs-appRow__order">
          {reorderable && (
            <>
              <button type="button" className="gcs-appRow__grip" aria-label={t("order.drag", { name: row.name })} {...attributes} {...listeners}>
                <GcsIconSvg icon={faGripVertical} />
              </button>
              <span className="gcs-appRow__moves">
                <button type="button" className="gcs-appRow__move" disabled={first} aria-label={t("order.up", { name: row.name })} onClick={() => onMove(-1)}>
                  <GcsIconSvg icon={faArrowUp} />
                </button>
                <button type="button" className="gcs-appRow__move" disabled={last} aria-label={t("order.down", { name: row.name })} onClick={() => onMove(1)}>
                  <GcsIconSvg icon={faArrowDown} />
                </button>
              </span>
            </>
          )}
        </span>
        <span className="gcs-appRow__name">
          <span className="gcs-appRow__icon" aria-hidden="true">
            {row.icon && <GcsIconSvg icon={row.icon} />}
          </span>
          <span className="gcs-appRow__title">
            <strong className="gcs-appRow__label">
              {row.name}
              {row.certificate &&
                (row.certificate.signed ? (
                  <GcsBadge tone="info" icon={<GcsIconSvg icon={faCertificate} />} title={t("certified.title", { keyId: row.certificate.keyId ?? "" })} data-testid="gcs-plugin-cert">
                    {t("certified.label")}
                  </GcsBadge>
                ) : (
                  <GcsBadge tone="warn" icon={<GcsIconSvg icon={faUnlock} />} title={t("uncertified.title")} data-testid="gcs-plugin-cert">
                    {t("uncertified.label")}
                  </GcsBadge>
                ))}
            </strong>
            {row.description && <span className="gcs-appRow__desc">{row.description}</span>}
            {/* Pe ecrane înguste, versiunea și autorul stau sub nume (coloanele lor dispar). */}
            <span className="gcs-appRow__byline">
              <span>v{row.version}</span>
              <span>{row.author}</span>
            </span>
            {row.error && (
              <span className="gcs-appRow__error">
                <GcsIconSvg icon={faTriangleExclamation} /> {row.error}
              </span>
            )}
          </span>
        </span>
        <span className="gcs-appRow__version" title={t("columns.version")}>
          v{row.version}
        </span>
        <span className="gcs-appRow__author" title={t("columns.author")}>
          {row.author}
        </span>
        <span className="gcs-appRow__status">
          <GcsBadge tone={STATUS_TONES[row.status]} icon={<GcsIconSvg icon={STATUS_ICONS[row.status]} />} data-testid="gcs-app-status">
            {t(`status.${row.status}`)}
          </GcsBadge>
          {row.autoDisabled && <span className="gcs-appRow__auto">{t("status.auto")}</span>}
        </span>
        <span className="gcs-appRow__actions">
          {row.landing ? (
            <button
              type="button"
              className={cx("gcs-appBtn", isLanding && "gcs-appBtn--landing")}
              aria-pressed={isLanding}
              aria-label={isLanding ? t("landing.is", { name: row.name }) : t("landing.make", { name: row.name })}
              title={isLanding ? t("landing.is", { name: row.name }) : t("landing.make", { name: row.name })}
              disabled={!handlers.canEdit || isLanding || !row.enabled}
              onClick={() => handlers.onLanding(row)}
              data-testid={`gcs-app-landing-${row.id}`}
            >
              <GcsIconSvg icon={isLanding ? faStar : faStarOutline} />
            </button>
          ) : (
            <span className="gcs-appBtn gcs-appBtn--empty" aria-hidden="true" />
          )}
          {row.access ? (
            <button
              type="button"
              className={cx("gcs-appBtn", handlers.restricted(row.access) && "gcs-appBtn--restricted")}
              aria-label={`${row.access.title}: ${handlers.summary(row.access)}`}
              title={`${row.access.title}: ${handlers.summary(row.access)}`}
              disabled={!handlers.canEdit}
              onClick={() => handlers.onAccess(row.access!)}
              data-testid={`gcs-app-access-${row.id}`}
            >
              <GcsIconSvg icon={handlers.restricted(row.access) ? faLock : faLockOpen} />
            </button>
          ) : (
            <span className="gcs-appBtn gcs-appBtn--empty" title={row.accessNote ?? undefined} aria-hidden="true" />
          )}
          {row.status === "removed" ? (
            <span className="gcs-appSwitch gcs-appSwitch--empty" aria-hidden="true" />
          ) : (
            <span className="gcs-appSwitch" title={row.status === "locked" ? t("lockedHint") : undefined}>
              <input
                type="checkbox"
                role="switch"
                aria-label={t("toggle", { name: row.name })}
                checked={row.status === "locked" || row.enabled}
                disabled={!row.canToggle}
                onChange={(e) => handlers.onToggle(row, e.currentTarget.checked)}
                data-testid={row.kind === "plugin" ? `gcs-plugin-toggle-${row.id}` : `gcs-app-toggle-${row.id}`}
              />
            </span>
          )}
          <button
            type="button"
            className={cx("gcs-appBtn", "gcs-appBtn--expand")}
            aria-expanded={open}
            aria-controls={sectionsId}
            aria-label={t(open ? "sections.hide" : "sections.show", { name: row.name })}
            title={t(open ? "sections.hide" : "sections.show", { name: row.name })}
            onClick={() => handlers.onExpand(row.id)}
            data-testid={`gcs-app-expand-${row.id}`}
          >
            <GcsIconSvg icon={faChevronRight} />
          </button>
          <GcsDropdown
            label={t("menu.label", { name: row.name })}
            trigger={<GcsIconSvg icon={faEllipsis} />}
            triggerClassName="gcs-appBtn"
            items={menu}
            testId={`gcs-app-menu-${row.id}`}
          />
        </span>
      </div>
      <div id={sectionsId} className="gcs-appSections" hidden={!open} role="region" aria-label={t("sections.title", { name: row.name })}>
        {row.sections.length === 0 ? (
          <p className="gcs-appSections__empty">{t("sections.none")}</p>
        ) : (
          <ul className="gcs-appSections__list">
            {row.sections.map((s) => (
              <li key={s.key} className="gcs-appSection" data-testid={`gcs-app-section-${row.id}-${s.key}`}>
                <span className="gcs-appSection__icon" aria-hidden="true">
                  {s.icon && <GcsIconSvg icon={s.icon} />}
                </span>
                <span className="gcs-appSection__name">
                  <a href={s.href} target="_blank" rel="noopener">
                    {s.label}
                    <GcsIconSvg icon={faArrowUpRightFromSquare} className="gcs-appSection__out" />
                  </a>
                  <code className="gcs-appSection__path">{s.href}</code>
                </span>
                <span className="gcs-appSection__perm">{s.access ? `${s.access.label}: ${handlers.summary(s.access)}` : t("sections.noPermission")}</span>
                {s.access ? (
                  <button
                    type="button"
                    className={cx("gcs-appBtn", handlers.restricted(s.access) && "gcs-appBtn--restricted")}
                    aria-label={`${s.access.title}: ${handlers.summary(s.access)}`}
                    title={`${s.access.title}: ${handlers.summary(s.access)}`}
                    disabled={!handlers.canEdit}
                    onClick={() => handlers.onAccess(s.access!)}
                  >
                    <GcsIconSvg icon={handlers.restricted(s.access) ? faLock : faLockOpen} />
                  </button>
                ) : (
                  <span className="gcs-appBtn gcs-appBtn--empty" aria-hidden="true" />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/** Confirmarea unei acțiuni (oprirea unei aplicații, oprirea tuturor pluginurilor), într-un dialog din pagină. */
function ConfirmDialog({ title, body, confirm, busy, onCancel, onConfirm }: { title: string; body: string; confirm: string; busy?: boolean; onCancel: () => void; onConfirm: () => void }) {
  const t = useTranslations("acp.appsPage");
  return (
    <GcsModal title={title} icon={<GcsIconSvg icon={faPowerOff} />} size="sm" closeLabel={t("close")} onClose={onCancel}>
      <div data-testid="gcs-app-confirm">
        <p className="gcs-appDialog__text">{body}</p>
        <div className="gcs-appDialog__actions">
          <GcsButton variant="ghost" onClick={onCancel}>
            {t("cancel")}
          </GcsButton>
          <GcsButton variant="primary" icon={<GcsIconSvg icon={faPowerOff} />} disabled={busy} onClick={onConfirm} data-testid="gcs-app-confirm-ok">
            {confirm}
          </GcsButton>
        </div>
      </div>
    </GcsModal>
  );
}

/** Dialogul 🔒: grupurile care au permisiunea (Root Admin mereu), cu „Toate” / „Niciunul”. */
function AccessDialog({ access, groups, onClose, onSaved }: { access: GcsAppAccess; groups: GcsAppGroup[]; onClose: () => void; onSaved: (a: GcsAppAccess, allowed: number[]) => void }) {
  const t = useTranslations("acp.appsPage.access");
  const tc = useTranslations("acp.appsPage");
  const errorMessage = useErrorMessage();
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set(access.allowed));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = groups.filter((g) => !g.root);

  async function save() {
    setPending(true);
    setError(null);
    const res = await saveAppAccess(access.permission, editable.filter((g) => selected.has(g.id)).map((g) => g.id));
    setPending(false);
    if (!res.ok) return setError(errorMessage(res.error));
    onSaved(access, res.data.allowed);
  }

  return (
    <GcsModal title={access.title} icon={<GcsIconSvg icon={faLock} />} closeLabel={tc("close")} onClose={onClose}>
      <div className="gcs-appAccess" data-testid="gcs-app-access-dialog">
        <p className="gcs-appDialog__text">{t("hint", { permission: access.label })}</p>
        <div className="gcs-appAccess__quick">
          <GcsButton variant="ghost" size="sm" onClick={() => setSelected(new Set(groups.map((g) => g.id)))}>
            {t("selectAll")}
          </GcsButton>
          <GcsButton variant="ghost" size="sm" onClick={() => setSelected(new Set(groups.filter((g) => g.root).map((g) => g.id)))}>
            {t("selectNone")}
          </GcsButton>
        </div>
        <fieldset className="gcs-appAccess__groups">
          <legend className="gcs-srOnly">{t("legend")}</legend>
          {groups.map((g) => (
            <label key={g.id} className={cx("gcs-appAccess__group", g.root && "gcs-appAccess__group--fixed")}>
              <input
                type="checkbox"
                checked={g.root || selected.has(g.id)}
                disabled={g.root || pending}
                onChange={(e) => {
                  const on = e.currentTarget.checked;
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (on) next.add(g.id);
                    else next.delete(g.id);
                    return next;
                  });
                }}
              />
              <span>{g.name}</span>
              {g.root && <small>{t("root")}</small>}
            </label>
          ))}
        </fieldset>
        {error && (
          <p role="alert" className="gcs-appDialog__error">
            {error}
          </p>
        )}
        <div className="gcs-appDialog__actions">
          <GcsButton variant="ghost" onClick={onClose}>
            {tc("cancel")}
          </GcsButton>
          <GcsButton variant="primary" disabled={pending} onClick={() => void save()} data-testid="gcs-app-access-save">
            {t("save")}
          </GcsButton>
        </div>
      </div>
    </GcsModal>
  );
}

/** Dezinstalarea unui plugin: ce se șterge, „Păstrează datele” și cheia tastată. */
function UninstallDialog({ row, onClose, onDone }: { row: GcsAppRow; onClose: () => void; onDone: (keepData: boolean) => void }) {
  const t = useTranslations("acp.appsPage.uninstall");
  const tc = useTranslations("acp.appsPage");
  const errorMessage = useErrorMessage();
  const [keepData, setKeepData] = useState(true);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = row.uninstall!.key;

  async function submit() {
    const fd = new FormData();
    fd.set("confirmKey", typed);
    if (keepData) fd.set("keepData", "on");
    setPending(true);
    setError(null);
    const res = await uninstallPlugin(key, fd);
    setPending(false);
    if (!res.ok) return setError(errorMessage(res.error));
    onDone(keepData);
  }

  return (
    <GcsModal title={t("title", { name: row.name })} icon={<GcsIconSvg icon={faTrash} />} closeLabel={tc("close")} onClose={onClose}>
      <div className="gcs-appUninstall" data-testid="gcs-plugin-uninstall-dialog">
        <p className="gcs-appDialog__text">{keepData ? t("bodyKept") : t("body")}</p>
        {!keepData && (
          <ul className="gcs-appUninstall__removes">
            {row.uninstall!.removes.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        <label className="gcs-checkRow">
          <input type="checkbox" role="switch" checked={keepData} onChange={(e) => setKeepData(e.currentTarget.checked)} />
          {t("keepData")}
        </label>
        <label className="gcs-field">
          {t("typeKey", { key })}
          <input className="gcs-input" value={typed} onChange={(e) => setTyped(e.currentTarget.value)} autoComplete="off" spellCheck={false} placeholder={key} />
        </label>
        {error && (
          <p role="alert" className="gcs-appDialog__error">
            {error}
          </p>
        )}
        <div className="gcs-appDialog__actions">
          <GcsButton variant="ghost" onClick={onClose}>
            {tc("cancel")}
          </GcsButton>
          <GcsButton variant="primary" icon={<GcsIconSvg icon={faTrash} />} disabled={pending || typed.trim() !== key} onClick={() => void submit()} data-testid="gcs-plugin-uninstall-confirm">
            {t("confirm")}
          </GcsButton>
        </div>
      </div>
    </GcsModal>
  );
}
