"use client";

import { faMagnifyingGlass, faUser, faUsers, faXmark } from "@fortawesome/free-solid-svg-icons";
import { cx, GcsAvatar, GcsIconSvg, GcsMemberName } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { addModerators, updateModerator } from "../../../moderation-actions";

/** O categorie din panou, cu forumurile ei în ordinea arborelui (`depth` = adâncimea sub categorie, pentru subforumuri). */
export type GcsModForumCategory = { id: number; name: string; forums: { id: number; name: string; depth: number }[] };
export type GcsModGroupOption = { id: number; key: string; name: string };
export type GcsModPresets = Record<"all" | "basic" | "approvals", readonly string[]>;

type Suggestion = { id: string; name: string; image: string | null; nameKey: string | null };

const PRESETS = ["all", "basic", "approvals"] as const;
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
/** Fără diacritice și fără majuscule, pentru căutarea forumurilor. */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Puterile: preseturile (Toate, Moderare de bază, Doar aprobări) și câte un comutator pentru fiecare putere. */
function GcsModPowers({ powers, presets, value, onChange }: { powers: readonly string[]; presets: GcsModPresets; value: string[]; onChange: (v: string[]) => void }) {
  const t = useTranslations("acp.moderators");
  return (
    <fieldset className="gcs-formSec">
      <legend>{t("powers")}</legend>
      <div className="gcs-acpMods__chips" role="group" aria-label={t("presets")}>
        {PRESETS.map((key) => {
          const on = sameSet(value, presets[key]);
          return (
            <button key={key} type="button" className={cx("gcs-acpMods__preset", on && "gcs-acpMods__preset--on")} aria-pressed={on} onClick={() => onChange([...presets[key]])} data-testid={`gcs-mod-preset-${key}`}>
              {t(`preset.${key}`)}
            </button>
          );
        })}
      </div>
      <div className="gcs-acpMods__chips">
        {powers.map((p) => (
          <label key={p} className={cx("gcs-acpMods__power", value.includes(p) && "gcs-acpMods__power--on")}>
            <input
              type="checkbox"
              name="power"
              value={p}
              checked={value.includes(p)}
              onChange={(e) => onChange(e.target.checked ? powers.filter((x) => x === p || value.includes(x)) : value.filter((x) => x !== p))}
            />
            <span>{t(`power.${p}`)}</span>
          </label>
        ))}
      </div>
      {value.length === 0 && <p className="gcs-field__hint">{t("powersNone")}</p>}
    </fieldset>
  );
}

/**
 * Căutarea unui membru cu sugestii pe măsură ce scrii (cu sau fără `@`, de la 2 caractere), din `/api/forums/mentions`:
 * avatarul și numele în stilul grupului. Săgețile aleg sugestia, Enter o confirmă. Fără o sugestie aleasă, se trimite
 * textul scris (serverul caută membrul după nume).
 */
function GcsModMemberSearch() {
  const t = useTranslations("acp.moderators");
  const id = useId();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Suggestion | null>(null);
  const [found, setFound] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(0);
  const term = query.trim().replace(/^@+/, "");

  useEffect(() => {
    if (picked || term.length < 2) {
      setFound([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/forums/mentions?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? (r.json() as Promise<{ users: Suggestion[] }>) : { users: [] }))
        .then((d) => {
          setFound(d.users);
          setActive(0);
        })
        .catch(() => {});
    }, 180);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [term, picked]);

  const choose = (u: Suggestion) => {
    setPicked(u);
    setQuery("");
    setFound([]);
  };

  if (picked) {
    return (
      <div className="gcs-field">
        <span>{t("member")}</span>
        <input type="hidden" name="userName" value={picked.name} />
        <span className="gcs-acpMods__picked" data-testid="gcs-mod-picked">
          <GcsAvatar name={picked.name} size="xs" {...(picked.image ? { src: picked.image } : {})} />
          <GcsMemberName userId={picked.id} name={picked.name} nameKey={picked.nameKey} />
          <button type="button" className="gcs-iconBtn" aria-label={t("memberChange", { name: picked.name })} onClick={() => setPicked(null)}>
            <GcsIconSvg icon={faXmark} />
          </button>
        </span>
      </div>
    );
  }

  const listId = `${id}-list`;
  return (
    <div className="gcs-field gcs-acpMods__search">
      <label htmlFor={`${id}-q`}>{t("member")}</label>
      <span className="gcs-acpMods__inputIcon">
        <GcsIconSvg icon={faMagnifyingGlass} />
        <input
          id={`${id}-q`}
          className="gcs-input"
          name="userName"
          value={query}
          maxLength={41}
          autoComplete="off"
          placeholder={t("memberPlaceholder")}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={found.length > 0}
          aria-controls={listId}
          aria-activedescendant={found.length > 0 ? `${id}-opt-${active}` : undefined}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (found.length === 0) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i + (e.key === "ArrowDown" ? 1 : found.length - 1)) % found.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(found[active]!);
            }
          }}
          data-testid="gcs-mod-member"
        />
      </span>
      {found.length > 0 && (
        <ul id={listId} role="listbox" aria-label={t("suggestions")} className="gcs-acpMods__suggest" data-testid="gcs-mod-suggestions">
          {found.map((u, i) => (
            <li
              key={u.id}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={cx("gcs-acpMods__option", i === active && "gcs-acpMods__option--on")}
              onMouseDown={(e) => {
                // Alegerea înainte ca inputul să piardă focusul.
                e.preventDefault();
                choose(u);
              }}
              onMouseEnter={() => setActive(i)}
              data-testid="gcs-mod-suggestion"
            >
              <GcsAvatar name={u.name} size="xs" {...(u.image ? { src: u.image } : {})} />
              <GcsMemberName name={u.name} nameKey={u.nameKey} />
            </li>
          ))}
        </ul>
      )}
      <span className="gcs-field__hint">{t("memberHint")}</span>
    </div>
  );
}

/**
 * Panoul „Adaugă moderator”: cine (un membru, din sugestii, sau un grup), forumurile grupate pe categorii în ordinea
 * arborelui (căutare, „Toate” pe categorie, numărul celor alese) și puterile (preseturi + comutatoare). Butonul spune
 * pe câte forumuri se adaugă. Serverul validează tot din nou.
 */
export function GcsModeratorAddForm({ categories, groups, powers, presets }: { categories: GcsModForumCategory[]; groups: GcsModGroupOption[]; powers: readonly string[]; presets: GcsModPresets }) {
  const t = useTranslations("acp.moderators");
  const id = useId();
  const [target, setTarget] = useState<"user" | "group">("user");
  const [selected, setSelected] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<string[]>([...presets.basic]);

  const q = fold(search.trim());
  const visible = useMemo(
    () => categories.map((c) => ({ ...c, forums: q && !fold(c.name).includes(q) ? c.forums.filter((f) => fold(f.name).includes(q)) : c.forums })).filter((c) => c.forums.length > 0),
    [categories, q],
  );
  const toggle = (forumId: number, on: boolean) => setSelected((s) => (on ? [...s, forumId] : s.filter((x) => x !== forumId)));
  const count = selected.length;

  return (
    <GcsActionForm action={addModerators} submitLabel={count > 0 ? t("submitCount", { count }) : t("submit")} submitKind="create">
      <fieldset className="gcs-formSec">
        <legend>{t("whoTitle")}</legend>
        <div className="gcs-acpMods__seg" role="radiogroup" aria-label={t("whoTitle")}>
          {(["user", "group"] as const).map((k) => (
            <label key={k} className={cx("gcs-acpMods__segItem", target === k && "gcs-acpMods__segItem--on")}>
              <input type="radio" name="target" value={k} checked={target === k} onChange={() => setTarget(k)} />
              <GcsIconSvg icon={k === "user" ? faUser : faUsers} />
              <span>{t(k === "user" ? "targetUser" : "targetGroup")}</span>
            </label>
          ))}
        </div>
        {target === "user" ? (
          <GcsModMemberSearch />
        ) : (
          <div className="gcs-field">
            <label htmlFor={`${id}-group`}>{t("groupLabel")}</label>
            <select id={`${id}-group`} className="gcs-input" name="groupId" required defaultValue="">
              <option value="" disabled>
                {t("groupChoose")}
              </option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </fieldset>

      <fieldset className="gcs-formSec">
        <legend>
          {t("forums")}
          <span className="gcs-acpMods__count" aria-live="polite" data-testid="gcs-mod-forum-count">
            {t("chosen", { count })}
          </span>
        </legend>
        {selected.map((f) => (
          <input key={f} type="hidden" name="forumId" value={f} />
        ))}
        <label className="gcs-acpMods__inputIcon">
          <GcsIconSvg icon={faMagnifyingGlass} />
          <span className="gcs-srOnly">{t("forumSearch")}</span>
          <input type="search" className="gcs-input" value={search} placeholder={t("forumSearch")} onChange={(e) => setSearch(e.target.value)} data-testid="gcs-mod-forum-search" />
        </label>
        {visible.length === 0 ? (
          <p className="gcs-muted" style={{ margin: 0, fontSize: 13 }}>
            {categories.length === 0 ? t("noForums") : t("noForumMatch")}
          </p>
        ) : (
          <div className="gcs-acpMods__cats">
            {visible.map((c) => {
              const ids = c.forums.map((f) => f.id);
              const all = ids.every((f) => selected.includes(f));
              return (
                <section key={c.id} className="gcs-acpMods__cat" aria-label={c.name} data-testid="gcs-mod-category" data-category={c.name}>
                  <header className="gcs-acpMods__catHead">
                    <span>{c.name}</span>
                    <button
                      type="button"
                      className="gcs-acpMods__all"
                      aria-pressed={all}
                      aria-label={t(all ? "noneIn" : "allIn", { category: c.name })}
                      onClick={() => setSelected((s) => (all ? s.filter((x) => !ids.includes(x)) : [...new Set([...s, ...ids])]))}
                    >
                      {t(all ? "none" : "all")}
                    </button>
                  </header>
                  {c.forums.map((f) => (
                    <label key={f.id} className="gcs-checkRow gcs-acpMods__forum" style={f.depth > 0 ? { paddingInlineStart: f.depth * 16 } : undefined}>
                      <input type="checkbox" checked={selected.includes(f.id)} onChange={(e) => toggle(f.id, e.target.checked)} />
                      {f.name}
                    </label>
                  ))}
                </section>
              );
            })}
          </div>
        )}
      </fieldset>

      <GcsModPowers powers={powers} presets={presets} value={chosen} onChange={setChosen} />
    </GcsActionForm>
  );
}

/** Panoul de editare al unui moderator pe forum: forumul și ținta (doar afișate) și puterile, de schimbat. */
export function GcsModeratorEditForm({ id, summary, initial, powers, presets }: { id: number; summary: ReactNode; initial: string[]; powers: readonly string[]; presets: GcsModPresets }) {
  const t = useTranslations("acp.moderators");
  const [chosen, setChosen] = useState(initial);
  return (
    <GcsActionForm action={updateModerator.bind(null, id)} submitLabel={t("save")} submitKind="save">
      <fieldset className="gcs-formSec">
        <legend>{t("whoTitle")}</legend>
        <div className="gcs-acpMods__summary">{summary}</div>
      </fieldset>
      <GcsModPowers powers={powers} presets={presets} value={chosen} onChange={setChosen} />
    </GcsActionForm>
  );
}
