"use client";

import { faArrowLeft, faArrowRight, faGripVertical, faXmark } from "@fortawesome/free-solid-svg-icons";
import {
  HEADER_DEVICES,
  HEADER_PRESETS,
  HEADER_ROWS,
  HEADER_ZONES,
  headerLayoutIsPreset,
  headerPreset,
  moveHeaderElement,
  placedHeaderElements,
  unusedHeaderElements,
  type GcsHeaderBuilder,
  type GcsHeaderDevice,
  type GcsHeaderElement,
  type GcsHeaderPreset,
  type GcsHeaderRow,
  type GcsHeaderSlot,
  type GcsHeaderZone,
} from "@gcs/core/themes";
import { GcsIconSvg } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useState, type DragEvent, type KeyboardEvent } from "react";

/** Elementele înregistrate de aplicații (chat, „Joacă acum”), oferite în tava „nefolosite”. */
export const APP_HEADER_ELEMENTS: readonly GcsHeaderElement[] = ["chat.button", "servers.playNow"];
const DRAG_TYPE = "application/x-gcs-header-element";

type Props = {
  value: GcsHeaderBuilder;
  device: GcsHeaderDevice;
  onDevice: (d: GcsHeaderDevice) => void;
  /** Un aspect nou; `preset` = o presetare aplicată (editorul o leagă de opțiunile ei, ex. bara de jos). */
  onChange: (next: GcsHeaderBuilder, preset?: GcsHeaderPreset) => void;
  /** Itemii de pe primul nivel ai meniului (pentru meniul împărțit). */
  navItems: { id: number; label: string }[];
};

/** Toate locurile, în ordine (rând, apoi zonă): săgețile sus / jos mută elementul în locul vecin. */
const SLOTS: { row: GcsHeaderRow; zone: GcsHeaderZone }[] = HEADER_ROWS.flatMap((row) => HEADER_ZONES.map((zone) => ({ row, zone })));

/**
 * Constructorul de antet din editorul vizual (specul 2026-10-10-hero-cockpit §9): presetările, tab-urile dispozitivelor
 * (previzualizarea trece pe același dispozitiv), grila 3 rânduri × 3 zone cu elementele trase între zone și rânduri sau
 * în tava „nefolosite”, și alegerea itemilor din dreapta logo-ului pentru meniul împărțit. Cu tastatura: Enter / spațiu
 * ia un element, săgețile îl mută (stânga / dreapta în zonă, sus / jos în zona vecină), Delete îl scoate.
 */
export function GcsHeaderBuilderEditor({ value, device, onDevice, onChange, navItems }: Props) {
  const t = useTranslations("themeStudio.builder");
  const [picked, setPicked] = useState<GcsHeaderElement | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const layout = value[device];
  const label = (k: GcsHeaderElement) => (t.has(`elements.${k.replace(".", "_")}`) ? t(`elements.${k.replace(".", "_")}`) : k);
  const where = (s: { row: GcsHeaderRow; zone: GcsHeaderZone }) => `${t(`rows.${s.row}`)} · ${t(`zones.${s.zone}`)}`;

  const move = (key: GcsHeaderElement, to: GcsHeaderSlot | null) => {
    const next = { ...value, [device]: moveHeaderElement(layout, key, to) };
    onChange(next);
    setAnnounce(to ? t("moved", { element: label(key), place: where(to) }) : t("removed", { element: label(key) }));
  };
  const slotOf = (key: GcsHeaderElement): (GcsHeaderSlot & { size: number }) | null => {
    for (const s of SLOTS) {
      const i = layout[s.row][s.zone].indexOf(key);
      if (i >= 0) return { ...s, index: i, size: layout[s.row][s.zone].length };
    }
    return null;
  };

  const onDragStart = (key: GcsHeaderElement) => (e: DragEvent) => {
    e.dataTransfer.setData(DRAG_TYPE, key);
    e.dataTransfer.setData("text/plain", key);
    e.dataTransfer.effectAllowed = "move";
  };
  const dropTarget = (id: string, to: (index?: number) => GcsHeaderSlot | null) => ({
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setOver(id);
    },
    onDragLeave: () => setOver((o) => (o === id ? null : o)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOver(null);
      const key = (e.dataTransfer.getData(DRAG_TYPE) || e.dataTransfer.getData("text/plain")) as GcsHeaderElement;
      if (!key) return;
      // Peste un element: locul lui (inserare înainte); altfel la sfârșitul zonei.
      const chip = (e.target as HTMLElement).closest<HTMLElement>("[data-chip-index]");
      move(key, to(chip ? Number(chip.dataset.chipIndex) : undefined));
    },
  });

  const onChipKey = (key: GcsHeaderElement) => (e: KeyboardEvent) => {
    const at = slotOf(key);
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setPicked((p) => (p === key ? null : key));
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      move(key, null);
      return;
    }
    if (!at) {
      // Din tavă: săgeata sus pune elementul în ultima zonă (rândul principal, dreapta).
      if (e.key === "ArrowUp") {
        e.preventDefault();
        move(key, { row: "main", zone: "right", index: 99 });
      }
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      move(key, { row: at.row, zone: at.zone, index: Math.max(0, at.index + (e.key === "ArrowLeft" ? -1 : 1)) });
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const i = SLOTS.findIndex((s) => s.row === at.row && s.zone === at.zone) + (e.key === "ArrowDown" ? 1 : -1);
      const s = SLOTS[i];
      if (s) move(key, { ...s, index: 99 });
    }
  };

  const chip = (key: GcsHeaderElement, index: number | null) => (
    <span
      key={key}
      className={`gcs-hbEdit__chip${picked === key ? " gcs-hbEdit__chip--picked" : ""}`}
      draggable
      tabIndex={0}
      role="button"
      aria-pressed={picked === key}
      aria-label={t("chipLabel", { element: label(key) })}
      onDragStart={onDragStart(key)}
      onKeyDown={onChipKey(key)}
      onClick={() => setPicked((p) => (p === key ? null : key))}
      data-chip-index={index ?? undefined}
      data-testid={`gcs-hb-chip-${key}`}
    >
      <GcsIconSvg icon={faGripVertical} className="gcs-hbEdit__grip" />
      {label(key)}
      {index !== null && (
        <button
          type="button"
          className="gcs-hbEdit__remove"
          aria-label={t("remove", { element: label(key) })}
          onClick={(e) => {
            e.stopPropagation();
            move(key, null);
          }}
          tabIndex={-1}
        >
          <GcsIconSvg icon={faXmark} />
        </button>
      )}
    </span>
  );

  const unused = unusedHeaderElements(layout, APP_HEADER_ELEMENTS);
  const navRight = placedHeaderElements(value.desktop).includes("navRight");
  const custom = !headerLayoutIsPreset(value);

  return (
    <div className="gcs-hbEdit" data-testid="gcs-header-builder-editor">
      <div className="gcs-hbEdit__presets" role="radiogroup" aria-label={t("presets")}>
        {HEADER_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={value.preset === p}
            className={`gcs-themeStudio__choice${value.preset === p ? " gcs-themeStudio__choice--active" : ""}`}
            onClick={() => onChange(headerPreset(p), p)}
            data-testid={`gcs-hb-preset-${p}`}
          >
            {t(`presetNames.${p}`)}
          </button>
        ))}
      </div>
      <p className="gcs-themeStudio__help">{custom ? t("custom", { preset: t(`presetNames.${value.preset}`) }) : t(`presetHelp.${value.preset}`)}</p>

      <div className="gcs-themeStudio__tabs" role="tablist" aria-label={t("devices")}>
        {HEADER_DEVICES.map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={device === d}
            className={device === d ? "gcs-themeStudio__tab gcs-themeStudio__tab--active" : "gcs-themeStudio__tab"}
            onClick={() => onDevice(d)}
            data-testid={`gcs-hb-device-${d}`}
          >
            {t(`deviceNames.${d}`)}
          </button>
        ))}
      </div>

      <div className="gcs-hbEdit__grid" data-testid="gcs-hb-grid">
        {HEADER_ROWS.map((row) => (
          <div key={row} className="gcs-hbEdit__row">
            <span className="gcs-hbEdit__rowName">{t(`rows.${row}`)}</span>
            <div className="gcs-hbEdit__zones">
              {HEADER_ZONES.map((zone) => {
                const id = `${row}-${zone}`;
                const items = layout[row][zone];
                return (
                  <div
                    key={zone}
                    className={`gcs-hbEdit__zone${over === id ? " gcs-hbEdit__zone--over" : ""}`}
                    aria-label={where({ row, zone })}
                    role="group"
                    data-testid={`gcs-hb-zone-${id}`}
                    {...dropTarget(id, (index) => ({ row, zone, index: index ?? items.length }))}
                  >
                    {items.map((k, i) => chip(k, i))}
                    {picked && !items.includes(picked) && (
                      <button type="button" className="gcs-hbEdit__here" onClick={() => (move(picked, { row, zone, index: items.length }), setPicked(null))} data-testid={`gcs-hb-here-${id}`}>
                        {t("here")}
                      </button>
                    )}
                    {items.length === 0 && !picked && <span className="gcs-hbEdit__empty">{t(`zones.${zone}`)}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className={`gcs-hbEdit__tray${over === "tray" ? " gcs-hbEdit__zone--over" : ""}`} role="group" aria-label={t("unused")} data-testid="gcs-hb-tray" {...dropTarget("tray", () => null)}>
        <span className="gcs-hbEdit__rowName">{t("unused")}</span>
        <div className="gcs-hbEdit__trayItems">
          {unused.length === 0 ? <span className="gcs-hbEdit__empty">{t("allUsed")}</span> : unused.map((k) => chip(k, null))}
          {picked && placedHeaderElements(layout).includes(picked) && (
            <button type="button" className="gcs-hbEdit__here" onClick={() => (move(picked, null), setPicked(null))}>
              {t("toTray")}
            </button>
          )}
        </div>
      </div>
      <p className="gcs-themeStudio__help">
        <GcsIconSvg icon={faArrowLeft} /> <GcsIconSvg icon={faArrowRight} /> {t("keyboard")}
      </p>
      <p className="gcs-srOnly" role="status" aria-live="polite">
        {announce}
      </p>

      {navRight && navItems.length > 0 && (
        <fieldset className="gcs-hbEdit__split" data-testid="gcs-hb-split">
          <legend className="gcs-themeStudio__label">{t("split")}</legend>
          <p className="gcs-themeStudio__help">{value.split === null ? t("splitAuto") : t("splitHelp")}</p>
          {navItems.map((n, i) => {
            const right = value.split === null ? i >= Math.ceil(navItems.length / 2) : value.split.includes(n.id);
            return (
              <label key={n.id} className="gcs-hbEdit__splitItem">
                <input
                  type="checkbox"
                  checked={right}
                  onChange={(e) => {
                    const current = value.split ?? navItems.slice(Math.ceil(navItems.length / 2)).map((x) => x.id);
                    const next = e.target.checked ? [...current.filter((x) => x !== n.id), n.id] : current.filter((x) => x !== n.id);
                    onChange({ ...value, split: next });
                  }}
                  data-testid={`gcs-hb-split-${n.id}`}
                />
                {n.label}
              </label>
            );
          })}
          {value.split !== null && (
            <button type="button" className="gcs-themeStudio__btn gcs-themeStudio__btn--ghost" onClick={() => onChange({ ...value, split: null })}>
              {t("splitReset")}
            </button>
          )}
        </fieldset>
      )}
    </div>
  );
}
