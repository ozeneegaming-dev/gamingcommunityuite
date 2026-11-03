"use client";

import { MOBILE_BAR_ITEMS, MOBILE_BAR_MAX, THEME_FIELDS, THEME_TOKENS, isThemeHex, themeElementAllowsTransparent, type GcsMobileBarItem, type GcsThemePalette, type GcsThemeToken } from "@gcs/core/themes";
import { GcsIconSvg } from "@gcs/ui";
import { faArrowDown, faArrowUp, faArrowUpFromBracket, faCheck, faChevronRight, faClockRotateLeft, faTrash, faXmark } from "@fortawesome/free-solid-svg-icons";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState, type ReactNode } from "react";
import { HEADER_ART_THUMBS } from "./header-art";
import { fieldKey, type GcsStudioColorRef, type GcsStudioImageSlot } from "./studio-panels";

type Translator = ReturnType<typeof useTranslations>;

/** Butonul „Revino la implicit” (doar când valoarea diferă de cea implicită). */
function RevertButton({ visible, onClick, label, testId }: { visible: boolean; onClick: () => void; label: string; testId: string }) {
  if (!visible) return <span className="gcs-themeStudio__revertSpacer" aria-hidden="true" />;
  return (
    <button type="button" className="gcs-themeStudio__revert" onClick={onClick} aria-label={label} title={label} data-testid={testId}>
      <GcsIconSvg icon={faClockRotateLeft} />
    </button>
  );
}

/** Textul unei valori numerice cu unitatea ei (`64px`, `120%`). */
const withUnit = (value: number, unit?: string) => `${value}${unit ?? ""}`;

/**
 * Un rând de setare: eticheta, controlul potrivit câmpului (interval, comutator, alegere, text, font), un text scurt
 * de ajutor și „Revino la implicit”. Valorile sunt validate și pe server; aici controalele nu permit ieșirea din interval.
 */
export function GcsStudioSettingRow({
  path,
  value,
  defaultValue,
  fonts,
  onChange,
}: {
  path: string;
  value: unknown;
  defaultValue: unknown;
  fonts: readonly string[];
  onChange: (value: unknown) => void;
}) {
  const t = useTranslations("themeStudio");
  const id = useId();
  const field = THEME_FIELDS[path];
  const key = fieldKey(path);
  if (!field) return null;
  const label = t(`fields.${key}.label`);
  const help = t.has(`fields.${key}.help`) ? t(`fields.${key}.help`) : null;
  const testId = `gcs-studio-field-${key}`;
  const changed = JSON.stringify(value) !== JSON.stringify(defaultValue);

  let control: ReactNode = null;
  switch (field.kind) {
    case "int": {
      const n = typeof value === "number" ? value : Number(defaultValue);
      control = (
        <div className="gcs-themeStudio__range">
          <input
            id={id}
            type="range"
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            value={n}
            onChange={(e) => onChange(Number(e.target.value))}
            data-testid={testId}
          />
          <output htmlFor={id} className="gcs-themeStudio__rangeValue">
            {withUnit(n, field.unit)}
          </output>
        </div>
      );
      break;
    }
    case "bool":
      control = (
        <input id={id} type="checkbox" role="switch" className="gcs-themeStudio__switch" checked={value === true} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      );
      break;
    case "enum": {
      // Imaginea antetului: fiecare variantă cu miniatura ei (imaginile incluse în GCS).
      const thumbs = path === "header.art" ? HEADER_ART_THUMBS : null;
      control = (
        <div className={thumbs ? "gcs-themeStudio__choices gcs-themeStudio__choices--thumbs" : "gcs-themeStudio__choices"} role="radiogroup" aria-labelledby={`${id}-label`} data-testid={testId}>
          {field.options.map((o) => (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={value === o}
              className={value === o ? "gcs-themeStudio__choice gcs-themeStudio__choice--active" : "gcs-themeStudio__choice"}
              onClick={() => onChange(o)}
              data-value={o}
            >
              {thumbs && <span className="gcs-themeStudio__choiceThumb" style={thumbs[o] ? { backgroundImage: `url("${thumbs[o]}")` } : undefined} aria-hidden="true" />}
              {t(`fields.${key}.options.${o}`)}
            </button>
          ))}
        </div>
      );
      break;
    }
    case "font":
      control = (
        <select id={id} className="gcs-themeStudio__input" value={String(value)} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
          {fonts.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      );
      break;
    case "barItems": {
      // Bara de jos de pe mobil: elementele alese, în ordine (sus / jos / scoate), și cele care se mai pot adăuga.
      const list = (Array.isArray(value) ? value : []) as GcsMobileBarItem[];
      const swap = (i: number, j: number) => {
        const next = [...list];
        [next[i], next[j]] = [next[j]!, next[i]!];
        onChange(next);
      };
      const rest = MOBILE_BAR_ITEMS.filter((k) => !list.includes(k));
      control = (
        <div className="gcs-themeStudio__barItems" data-testid={testId}>
          <ol className="gcs-themeStudio__barList">
            {list.map((k, i) => (
              <li key={k} className="gcs-themeStudio__barItem">
                <span>{t(`fields.${key}.options.${k}`)}</span>
                <button type="button" className="gcs-themeStudio__revert" aria-label={t("barUp", { item: t(`fields.${key}.options.${k}`) })} disabled={i === 0} onClick={() => swap(i, i - 1)}>
                  <GcsIconSvg icon={faArrowUp} />
                </button>
                <button type="button" className="gcs-themeStudio__revert" aria-label={t("barDown", { item: t(`fields.${key}.options.${k}`) })} disabled={i === list.length - 1} onClick={() => swap(i, i + 1)}>
                  <GcsIconSvg icon={faArrowDown} />
                </button>
                <button
                  type="button"
                  className="gcs-themeStudio__revert"
                  aria-label={t("barRemove", { item: t(`fields.${key}.options.${k}`) })}
                  disabled={list.length <= 1}
                  onClick={() => onChange(list.filter((x) => x !== k))}
                  data-testid={`${testId}-remove-${k}`}
                >
                  <GcsIconSvg icon={faXmark} />
                </button>
              </li>
            ))}
          </ol>
          {list.length < MOBILE_BAR_MAX && rest.length > 0 && (
            <select
              id={id}
              className="gcs-themeStudio__input"
              value=""
              onChange={(e) => e.target.value && onChange([...list, e.target.value as GcsMobileBarItem])}
              aria-label={t("barAdd")}
              data-testid={`${testId}-add`}
            >
              <option value="">{t("barAdd")}</option>
              {rest.map((k) => (
                <option key={k} value={k}>
                  {t(`fields.${key}.options.${k}`)}
                </option>
              ))}
            </select>
          )}
        </div>
      );
      break;
    }
    case "text":
      // Textele lungi (HTML-ul propriu din antet) într-o zonă de text.
      if (field.max > 200) {
        control = (
          <textarea
            id={id}
            className="gcs-themeStudio__input gcs-themeStudio__textarea"
            value={String(value ?? "")}
            maxLength={field.max}
            rows={4}
            onChange={(e) => onChange(e.target.value)}
            data-testid={testId}
          />
        );
        break;
      }
    // falls through
    case "fontName":
      control = (
        <input
          id={id}
          type="text"
          className="gcs-themeStudio__input"
          value={String(value ?? "")}
          maxLength={field.kind === "text" ? field.max : 40}
          placeholder={t.has(`fields.${key}.placeholder`) ? t(`fields.${key}.placeholder`) : undefined}
          onChange={(e) => onChange(field.kind === "fontName" ? e.target.value.replace(/[^A-Za-z0-9 ]/g, "") : e.target.value)}
          data-testid={testId}
        />
      );
      break;
    default:
      return null;
  }

  return (
    <div className="gcs-themeStudio__setting" data-changed={changed || undefined}>
      <div className="gcs-themeStudio__settingHead">
        {field.kind === "enum" ? (
          <span id={`${id}-label`} className="gcs-themeStudio__label">
            {label}
          </span>
        ) : (
          <label htmlFor={id} className="gcs-themeStudio__label">
            {label}
          </label>
        )}
        <RevertButton visible={changed} onClick={() => onChange(defaultValue)} label={t("revert", { name: label })} testId={`gcs-studio-revert-${key}`} />
      </div>
      {control}
      {help && <p className="gcs-themeStudio__help">{help}</p>}
    </div>
  );
}

/** Culoarea afișată pentru o valoare (tokenurile se rezolvă din paleta modului editat). */
export function resolveColor(value: string, palette: GcsThemePalette): string {
  if (value === "transparent") return "transparent";
  if (value.startsWith("@")) return palette[value.slice(1) as GcsThemeToken] ?? "#000000";
  return value;
}

export function colorLabel(t: Translator, ref: GcsStudioColorRef): string {
  return ref.kind === "token" ? t(`tokens.${ref.token}`) : t(`colors.${ref.key}`);
}

/** Textul valorii: hex-ul, numele tokenului sau „transparent”. */
function valueLabel(t: Translator, value: string): string {
  if (value === "transparent") return t("transparent");
  if (value.startsWith("@")) return t(`tokens.${value.slice(1)}`);
  return value.toUpperCase();
}

const refId = (ref: GcsStudioColorRef) => (ref.kind === "token" ? ref.token : ref.key);

/** Un rând de culoare (deschide selectorul de culoare). */
export function GcsStudioColorRow({
  colorRef,
  value,
  defaultValue,
  palette,
  onOpen,
  onRevert,
}: {
  colorRef: GcsStudioColorRef;
  value: string;
  defaultValue: string;
  palette: GcsThemePalette;
  onOpen: () => void;
  onRevert: () => void;
}) {
  const t = useTranslations("themeStudio");
  const label = colorLabel(t, colorRef);
  const changed = value.toUpperCase() !== defaultValue.toUpperCase();
  return (
    <div className="gcs-themeStudio__colorRow" data-changed={changed || undefined}>
      <button type="button" className="gcs-themeStudio__colorOpen" onClick={onOpen} data-testid={`gcs-studio-color-${refId(colorRef)}`}>
        <span className="gcs-themeStudio__swatchDot" style={{ background: resolveColor(value, palette) }} aria-hidden="true" />
        <span className="gcs-themeStudio__colorText">
          <span className="gcs-themeStudio__label">{label}</span>
          <code className="gcs-themeStudio__code">{valueLabel(t, value)}</code>
        </span>
        <GcsIconSvg icon={faChevronRight} className="gcs-themeStudio__chevron" />
      </button>
      <RevertButton visible={changed} onClick={onRevert} label={t("revert", { name: label })} testId={`gcs-studio-revert-color-${refId(colorRef)}`} />
    </div>
  );
}

/**
 * Selectorul de culoare: „Mostre” (tokenurile paletei modului editat; pentru elemente și „transparent”, în afară de
 * elementele care au mereu fundal, ca antetul casetelor) și „Selector” (`input type=color` + câmp hex). Culorile
 * paletei sunt doar hex, deci mostrele le copiază valoarea.
 */
export function GcsStudioColorSelector({
  colorRef,
  value,
  palette,
  onChange,
}: {
  colorRef: GcsStudioColorRef;
  value: string;
  palette: GcsThemePalette;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("themeStudio");
  const [tab, setTab] = useState<"swatches" | "picker">(colorRef.kind === "token" ? "picker" : "swatches");
  const resolved = resolveColor(value, palette);
  const hex = isThemeHex(resolved) ? resolved.toUpperCase() : "#000000";
  const [text, setText] = useState(hex);
  useEffect(() => setText(hex), [hex]);
  const element = colorRef.kind === "element";
  const transparent = colorRef.kind === "element" && themeElementAllowsTransparent(colorRef.key);
  const tabs = [
    { id: "swatches" as const, label: t("tabs.swatches") },
    { id: "picker" as const, label: t("tabs.picker") },
  ];
  return (
    <div className="gcs-themeStudio__selector">
      <div className="gcs-themeStudio__tabs" role="tablist" aria-label={colorLabel(t, colorRef)}>
        {tabs.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={tab === x.id}
            className={tab === x.id ? "gcs-themeStudio__tab gcs-themeStudio__tab--active" : "gcs-themeStudio__tab"}
            onClick={() => setTab(x.id)}
            data-testid={`gcs-studio-tab-${x.id}`}
          >
            {x.label}
          </button>
        ))}
      </div>
      {tab === "swatches" ? (
        <div className="gcs-themeStudio__swatches" role="listbox" aria-label={t("tabs.swatches")}>
          {THEME_TOKENS.filter((tk) => !(colorRef.kind === "token" && colorRef.token === tk)).map((tk) => {
            const next = element ? `@${tk}` : palette[tk].toUpperCase();
            const selected = element ? value === next : value.toUpperCase() === next;
            return (
              <button
                key={tk}
                type="button"
                role="option"
                aria-selected={selected}
                className={selected ? "gcs-themeStudio__swatch gcs-themeStudio__swatch--active" : "gcs-themeStudio__swatch"}
                onClick={() => onChange(next)}
                data-testid={`gcs-studio-swatch-${tk}`}
              >
                <span className="gcs-themeStudio__swatchDot" style={{ background: palette[tk] }} aria-hidden="true" />
                <span>{t(`tokens.${tk}`)}</span>
                {selected && <GcsIconSvg icon={faCheck} className="gcs-themeStudio__swatchCheck" />}
              </button>
            );
          })}
          {transparent && (
            <button
              type="button"
              role="option"
              aria-selected={value === "transparent"}
              className={value === "transparent" ? "gcs-themeStudio__swatch gcs-themeStudio__swatch--active" : "gcs-themeStudio__swatch"}
              onClick={() => onChange("transparent")}
              data-testid="gcs-studio-swatch-transparent"
            >
              <span className="gcs-themeStudio__swatchDot gcs-themeStudio__swatchDot--none" aria-hidden="true" />
              <span>{t("transparent")}</span>
            </button>
          )}
        </div>
      ) : (
        <div className="gcs-themeStudio__picker">
          <input type="color" className="gcs-themeStudio__colorInput" value={hex.toLowerCase()} onChange={(e) => onChange(e.target.value.toUpperCase())} aria-label={t("tabs.picker")} data-testid="gcs-studio-picker" />
          <label className="gcs-themeStudio__hex">
            <span>{t("hex")}</span>
            <input
              type="text"
              className="gcs-themeStudio__input"
              value={text}
              maxLength={7}
              spellCheck={false}
              aria-invalid={!isThemeHex(text) || undefined}
              onChange={(e) => {
                const v = e.target.value.trim();
                setText(v);
                if (isThemeHex(v)) onChange(v.toUpperCase());
              }}
              data-testid="gcs-studio-hex"
            />
          </label>
          {!isThemeHex(text) && <p className="gcs-themeStudio__error">{t("invalidHex")}</p>}
        </div>
      )}
    </div>
  );
}

/** O imagine a temei (logo-urile, favicon-ul): previzualizare, încărcare, ștergere. */
export function GcsStudioImageRow({
  slot,
  url,
  busy,
  onUpload,
  onRemove,
}: {
  slot: GcsStudioImageSlot;
  url: string | null;
  busy: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("themeStudio");
  return (
    <div className="gcs-themeStudio__image" data-testid={`gcs-studio-image-${slot}`}>
      <span className="gcs-themeStudio__label">{t(`images.${slot}`)}</span>
      <div className="gcs-themeStudio__imageBox">
        {url ? (
          // Previzualizarea fișierului încărcat (un fișier public al site-ului).
          <img src={url} alt="" className={`gcs-themeStudio__imagePreview gcs-themeStudio__imagePreview--${slot}`} />
        ) : (
          <span className="gcs-themeStudio__muted">{t("images.none")}</span>
        )}
      </div>
      <div className="gcs-themeStudio__imageActions">
        <label className={busy ? "gcs-themeStudio__btn gcs-themeStudio__btn--busy" : "gcs-themeStudio__btn"}>
          <GcsIconSvg icon={faArrowUpFromBracket} />
          {t("images.upload")}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="gcs-srOnly"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) onUpload(file);
            }}
            data-testid={`gcs-studio-upload-${slot}`}
          />
        </label>
        {url && (
          <button type="button" className="gcs-themeStudio__btn gcs-themeStudio__btn--ghost" onClick={onRemove} data-testid={`gcs-studio-remove-${slot}`}>
            <GcsIconSvg icon={faTrash} />
            {t("images.remove")}
          </button>
        )}
      </div>
    </div>
  );
}
