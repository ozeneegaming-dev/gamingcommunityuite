/**
 * Versiuni semantice (`1.4.2`, `2.0.0-beta.1`) și intervale simple, pentru compatibilitatea pluginurilor:
 * `*`, `1.2.3`, `=1.2.3`, `>=1.2.3`, `>1.2.3`, `<=1.2.3`, `<1.2.3`, `^1.2.3`, `~1.2.3`, `1.x`, `1.2.x`, combinate cu spații
 * (și) și `||` (sau). Versiunile pre-release se compară după regulile semver, fără excluderi speciale.
 */
export type GcsSemver = { major: number; minor: number; patch: number; prerelease: string[] };

const NUM = "(0|[1-9]\\d{0,8})";
const IDENT = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";
const SEMVER_RE = new RegExp(`^${NUM}\\.${NUM}\\.${NUM}(?:-(${IDENT}(?:\\.${IDENT})*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);

export function parseSemver(value: unknown): GcsSemver | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const m = SEMVER_RE.exec(value.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: m[4] ? m[4].split(".") : [] };
}

function compareIdent(a: string, b: string): number {
  const an = /^\d+$/.test(a);
  const bn = /^\d+$/.test(b);
  if (an && bn) return Math.sign(Number(a) - Number(b));
  if (an) return -1;
  if (bn) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** -1, 0 sau 1. Fără pre-release > cu pre-release (`1.0.0` > `1.0.0-rc.1`). */
export function compareSemver(a: GcsSemver, b: GcsSemver): number {
  for (const k of ["major", "minor", "patch"] as const) {
    if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
  }
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const c = compareIdent(x, y);
    if (c !== 0) return c;
  }
  return 0;
}

type Comparator = { op: "<" | "<=" | ">" | ">=" | "="; v: GcsSemver };

const v = (major: number, minor: number, patch: number, prerelease: string[] = []): GcsSemver => ({ major, minor, patch, prerelease });

/** Un termen (`^1.2.3`, `1.x`, `>=2.0.0`) → comparatoare (toate trebuie îndeplinite); `null` dacă e invalid. */
function parseTerm(term: string): Comparator[] | null {
  if (term === "*" || term === "x" || term === "X") return [];
  const op = /^(<=|>=|<|>|=|\^|~)?(.*)$/.exec(term);
  if (!op) return null;
  const prefix = op[1] ?? "";
  const rest = op[2]!;
  const partial = /^(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/.exec(rest);
  const full = parseSemver(rest);

  if (prefix === "^" || prefix === "~") {
    const base = full ?? (partial && !/[xX*]/.test(rest) ? v(Number(partial[1]), Number(partial[2] ?? 0), Number(partial[3] ?? 0)) : null);
    if (!base) return null;
    let upper: GcsSemver;
    if (prefix === "~") upper = partial && partial[2] === undefined ? v(base.major + 1, 0, 0) : v(base.major, base.minor + 1, 0);
    else if (base.major > 0) upper = v(base.major + 1, 0, 0);
    else if (base.minor > 0) upper = v(0, base.minor + 1, 0);
    else upper = v(0, 0, base.patch + 1);
    return [
      { op: ">=", v: base },
      { op: "<", v: { ...upper, prerelease: ["0"] } },
    ];
  }

  if (full) return [{ op: prefix === "" ? "=" : (prefix as Comparator["op"]), v: full }];
  if (!partial) return null;
  const isX = (s: string | undefined) => s === undefined || /^[xX*]$/.test(s);
  if (isX(partial[1])) return prefix === "" || prefix === "=" ? [] : null;
  const major = Number(partial[1]);
  if (isX(partial[2])) {
    if (prefix !== "" && prefix !== "=") return null;
    return [
      { op: ">=", v: v(major, 0, 0) },
      { op: "<", v: v(major + 1, 0, 0, ["0"]) },
    ];
  }
  const minor = Number(partial[2]);
  if (isX(partial[3])) {
    if (prefix !== "" && prefix !== "=") return null;
    return [
      { op: ">=", v: v(major, minor, 0) },
      { op: "<", v: v(major, minor + 1, 0, ["0"]) },
    ];
  }
  return null;
}

function parseRange(range: string): Comparator[][] | null {
  if (typeof range !== "string" || range.length > 200) return null;
  const sets: Comparator[][] = [];
  for (const alt of range.split("||")) {
    const terms = alt.trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return null;
    const set: Comparator[] = [];
    for (const term of terms) {
      const parsed = parseTerm(term);
      if (!parsed) return null;
      set.push(...parsed);
    }
    sets.push(set);
  }
  return sets;
}

export function isValidSemverRange(range: unknown): boolean {
  return typeof range === "string" && parseRange(range) !== null;
}

/** Versiunea se potrivește intervalului? Un interval invalid nu se potrivește cu nimic. */
export function satisfiesSemver(version: string, range: string): boolean {
  const parsed = parseSemver(version);
  const sets = parseRange(range);
  if (!parsed || !sets) return false;
  return sets.some((set) =>
    set.every(({ op, v: target }) => {
      const c = compareSemver(parsed, target);
      switch (op) {
        case "<":
          return c < 0;
        case "<=":
          return c <= 0;
        case ">":
          return c > 0;
        case ">=":
          return c >= 0;
        case "=":
          return c === 0;
      }
    }),
  );
}
