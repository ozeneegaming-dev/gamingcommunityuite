import type { MemberRemovalMode } from "@gcs/db";

/** Ce face ștergerea cu conținutul public (specul 2026-10-09-stergere-unire-membri §2). */
export type GcsRemovalMode = MemberRemovalMode;

/** Un număr din „ce are membrul”: cheia (`forums.posts`, `clans.memberships`…) are textul `acp.removal.items.<cheie>`. */
export type GcsMemberDataItem = { key: string; count: number };

/**
 * O observație afișată înainte de confirmare (`acp.removal.notes.<cheie>`, cu parametri): ex. cine preia un clan,
 * ce VIP se păstrează la unire. `warn` = ceva ce staff-ul trebuie să știe (se pierde, se aplică țintei).
 */
export type GcsMemberDataNote = { key: string; level: "info" | "warn"; params?: Record<string, string | number> };

/**
 * Cursorul unui pas, salvat cu progresul: un handler care parcurge rânduri ce rămân pe loc (ex. reacțiile țintei, verificate
 * una câte una) își ține aici poziția, ca reluarea să nu le parcurgă din nou. `null` = de la început.
 */
export type GcsStepCursor = { value: string | null };

/** Contextul unui lot de ștergere. */
export type GcsEraseContext = {
  userId: string;
  mode: GcsRemovalMode;
  /** Mesajele private trimise rămân în conversațiile celorlalți (ca „Membru șters”). */
  keepMessages: boolean;
  /** Câte rânduri „grele” (ex. postări șterse prin serviciu) procesează un lot. */
  batchSize: number;
  cursor: GcsStepCursor;
};

/** Contextul unui lot de unire: totul din `sourceId` trece în `targetId`. */
export type GcsMergeContext = { sourceId: string; targetId: string; batchSize: number; cursor: GcsStepCursor };

/**
 * Datele unui membru într-o aplicație (forum, clanuri, servere…), tratate de aplicația care le deține. Nucleul cheamă
 * `erase` / `merge` în bucle, câte un lot, până întorc 0; după fiecare lot salvează progresul. Fiecare lot trebuie să fie
 * **idempotent**: lucrează doar pe rândurile rămase (ce s-a mutat / șters nu mai apare), iar un transfer de contor se
 * face „adaugă la țintă și golește sursa” în aceeași tranzacție. Astfel o rulare întreruptă se reia de unde a rămas.
 */
export interface GcsMemberDataHandler {
  /** Cheia pasului (`forums`, `clans`…), unică; textul `acp.removal.steps.<cheie>`. */
  key: string;
  /** Ce are membrul în aplicație (ecranul de confirmare și previzualizarea unirii). Doar numerele nenule contează. */
  summary(userId: string): Promise<GcsMemberDataItem[]>;
  /** Observațiile ștergerii (ex. „conduce clanul X: conducerea trece la Y”). */
  deleteNotes?(userId: string): Promise<GcsMemberDataNote[]>;
  /** Observațiile unirii (conflicte, ce se pierde). */
  mergeNotes?(sourceId: string, targetId: string): Promise<GcsMemberDataNote[]>;
  /** Un lot de ștergere; întoarce câte rânduri a procesat (0 = pasul e gata). */
  erase(ctx: GcsEraseContext): Promise<number>;
  /** Un lot de unire; întoarce câte rânduri a procesat (0 = pasul e gata). */
  merge(ctx: GcsMergeContext): Promise<number>;
  /**
   * GDPR (Membri v2): datele personale ale membrului în aplicație, ca JSON (fișierul `<cheie>.json` din arhiva de export).
   * Lipsă = arhiva are doar numerele din `summary`.
   */
  export?(userId: string): Promise<unknown>;
}

/** Progresul unui pas, salvat în `member_removals.steps`. */
export type GcsRemovalStepState = { done: boolean; processed: number; cursor?: string | null };
