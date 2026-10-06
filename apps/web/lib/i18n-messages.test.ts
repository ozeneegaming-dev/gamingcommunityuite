import { readFileSync } from "node:fs";
import path from "node:path";
import { IntlMessageFormat } from "intl-messageformat";
import { describe, expect, test } from "vitest";
import { GCS_LOCALES } from "../i18n";
import { argumentNames, flatten } from "../scripts/i18n-core";

const dir = path.resolve(__dirname, "../messages");
const load = (locale: string) => flatten(JSON.parse(readFileSync(path.join(dir, `${locale}.json`), "utf8")) as Record<string, unknown>);
const en = load("en");

/**
 * Toate pachetele de limbă (specul etapei 5 §7): aceleași chei ca `en`, fiecare mesaj se compilează în limba lui și
 * păstrează argumentele sursei; pluralul are formele limbii (ex. rusă: one, few, many, other).
 */
describe.each(GCS_LOCALES)("pachetul %s", (locale) => {
  const messages = load(locale);

  test("are exact cheile din en", () => {
    expect(Object.keys(messages).sort()).toEqual(Object.keys(en).sort());
  });

  test("fiecare mesaj se compilează și are argumentele sursei", () => {
    const bad: string[] = [];
    for (const [key, message] of Object.entries(messages)) {
      try {
        new IntlMessageFormat(message, locale, undefined, { ignoreTag: true });
        if (JSON.stringify(argumentNames(message)) !== JSON.stringify(argumentNames(en[key]!))) bad.push(`${key}: argumente diferite`);
      } catch (error) {
        bad.push(`${key}: ${String(error)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("pluralele au toate categoriile limbii", () => {
    const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories as string[];
    const missing: string[] = [];
    for (const [key, message] of Object.entries(messages)) {
      for (const m of message.matchAll(/\{\s*\w+\s*,\s*plural\s*,/g)) {
        const rest = message.slice(m.index);
        for (const c of categories) if (!new RegExp(`[\\s,]${c}\\s*\\{`).test(rest)) missing.push(`${key}: ${c}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});
