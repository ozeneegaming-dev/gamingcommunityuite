"use client";

export type GcsBirthdayLabels = { title: string; day: string; month: string; year: string; yearHint: string; visible: string; showYear: string; hint: string; months: string[] };
export type GcsBirthdayState = { day: string; month: string; year: string; visible: boolean; showYear: boolean };

/** Anul-marcaj al zilelor salvate fără an (vezi `BIRTHDAY_NO_YEAR` în `@gcs/modules`). */
const NO_YEAR = "1904";
const pad = (n: number | string) => String(n).padStart(2, "0");

/** Starea inițială din data salvată (`YYYY-MM-DD`; anul-marcaj = fără an). */
export function birthdayState(date: string | null, visible: boolean, showYear: boolean): GcsBirthdayState {
  const [y, m, d] = date ? date.split("-") : ["", "", ""];
  return { day: d ? String(Number(d)) : "", month: m ? String(Number(m)) : "", year: y && y !== NO_YEAR ? y : "", visible, showYear };
}

/** Valoarea trimisă: `YYYY-MM-DD`, `MM-DD` (fără an) sau `null` (ștearsă / incompletă). */
export function birthdayValue(s: GcsBirthdayState): string | null {
  if (!s.day || !s.month) return null;
  return s.year ? `${s.year}-${pad(s.month)}-${pad(s.day)}` : `${pad(s.month)}-${pad(s.day)}`;
}

/**
 * Ziua de naștere în grupul „De bază” din „Editează profilul”: ziua și luna, anul opțional, dacă e publică (pe profil și
 * în `/zi-de-nastere` din chat) și dacă anul apare pe profil. Se salvează odată cu restul profilului.
 */
export function GcsBirthdayFields({ value, onChange, labels }: { value: GcsBirthdayState; onChange: (next: GcsBirthdayState) => void; labels: GcsBirthdayLabels }) {
  const set = (patch: Partial<GcsBirthdayState>) => onChange({ ...value, ...patch });
  return (
    <div className="gcs-birthdayForm" role="group" aria-label={labels.title} data-testid="gcs-birthday-form">
      <span className="gcs-birthdayForm__title">{labels.title}</span>
      <div className="gcs-birthdayForm__row">
        <label className="gcs-field">
          {labels.day}
          <select className="gcs-input" value={value.day} onChange={(e) => set({ day: e.target.value })} data-testid="gcs-birthday-day">
            <option value="">—</option>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="gcs-field">
          {labels.month}
          <select className="gcs-input" value={value.month} onChange={(e) => set({ month: e.target.value })} data-testid="gcs-birthday-month">
            <option value="">—</option>
            {labels.months.map((name, i) => (
              <option key={name} value={i + 1}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="gcs-field">
          {labels.year}
          <input
            className="gcs-input"
            inputMode="numeric"
            maxLength={4}
            placeholder={labels.yearHint}
            value={value.year}
            onChange={(e) => {
              const year = e.target.value.replace(/\D/g, "").slice(0, 4);
              set({ year, ...(year === "" ? { showYear: false } : {}) });
            }}
            data-testid="gcs-birthday-year"
          />
        </label>
      </div>
      <label className="gcs-check">
        <input type="checkbox" checked={value.visible} onChange={(e) => set({ visible: e.target.checked })} data-testid="gcs-birthday-visible" />
        {labels.visible}
      </label>
      <label className="gcs-check">
        <input type="checkbox" checked={value.showYear} disabled={value.year === ""} onChange={(e) => set({ showYear: e.target.checked })} data-testid="gcs-birthday-show-year" />
        {labels.showYear}
      </label>
      <p className="gcs-field__hint">{labels.hint}</p>
    </div>
  );
}
