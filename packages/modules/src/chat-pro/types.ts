import type { GcsUserRef } from "../forums/queries";
import type { GcsChatProCommand, GcsChatProPrefs } from "./prefs";

/** O insignă lângă numele din chat: „Primul mesaj”, „Câștigătorul clasamentului” sau un badge ales de membru. */
export type GcsChatProBadge = { kind: "badge"; key: string; name: string; art: string; image: string | null };

/** Choice-urile jocului piatră-hârtie-foarfecă. */
export const RPS_CHOICES = ["rock", "paper", "scissors"] as const;
export type GcsRpsChoice = (typeof RPS_CHOICES)[number];

/** Rezultatul unei comenzi a botului, așa cum îl vede oricine (fără datele secrete, ex. alegerea provocatorului). */
export type GcsChatProBot =
  | { command: "roll"; max: number; result: number }
  | { command: "iq"; value: number }
  | { command: "birthday"; users: { id: string; name: string; nameKey: string; age: number | null }[] }
  | {
      command: "rps";
      opponent: { id: string; name: string };
      /** `open` = așteaptă răspunsul adversarului; `done` = jucat; `expired` = fără răspuns la timp. */
      state: "open" | "done" | "expired";
      expiresAt: string;
      result?: { challenger: GcsRpsChoice; opponent: GcsRpsChoice; winner: "challenger" | "opponent" | "draw" };
    };

/** Datele adăugate de Chat Pro unei vederi de mesaj (aceleași pentru toți cititorii). */
export type GcsChatProMessage = {
  /** Porecla autorului în chat (`null` = numele de pe forum). */
  nickname: string | null;
  /** Primul mesaj al autorului în chat. */
  first: boolean;
  /** Autorul e câștigătorul ultimei perioade a clasamentului. */
  winner: boolean;
  /** Cel mult 2 badge-uri alese de autor. */
  badges: GcsChatProBadge[];
  /** Mesajul citat (autorul și un extras); `null` = nu e un răspuns sau mesajul citat a fost șters. */
  replyTo: { id: number; author: string | null; snippet: string } | null;
  bot: GcsChatProBot | null;
};

/** Un emoticon încărcat de admini: codul (fără `:`), adresa și dimensiunile. */
export type GcsChatEmoteView = { id: number; code: string; url: string; width: number; height: number; animated: boolean };
export type GcsChatEmotePackView = { id: number; name: string; emotes: GcsChatEmoteView[] };

/** Un GIF din furnizorul ales (GIPHY / Tenor): `url` se trimite în mesaj, `preview` e miniatura. */
export type GcsChatProGif = { id: string; title: string; url: string; preview: string; width: number; height: number };
export type GcsChatProGifProvider = "giphy" | "tenor";

/** Un element al barei de anunțuri, pentru afișare. */
export type GcsChatProBarItemView = { id: number; text: string; ctaLabel: string; ctaUrl: string };

/** Un loc în clasament. */
export type GcsChatProRankRow = { rank: number; user: GcsUserRef; messages: number };

/** Panoul de clasament și provocări. */
export type GcsChatProRanking = {
  period: { start: string; end: string; kind: "month" | "week" };
  /** Secunde până la resetare. */
  resetsIn: number;
  top: GcsChatProRankRow[];
  /** „Spammer-ul zilei”: cele mai multe mesaje azi. */
  spammer: GcsChatProRankRow | null;
  /** Câștigătorul perioadei anterioare, cu insigna primită (badge-ul câștigătorului; `null` dacă a fost șters). */
  lastWinner: GcsChatProLastWinner | null;
  /** Statisticile viewer-ului (lipsesc pentru vizitatori); `previous` = mesajele lui din perioada anterioară. */
  me: { position: number | null; today: number; period: number; week: number; previous: number } | null;
};

export type GcsChatProLastWinner = {
  user: GcsUserRef;
  messages: number;
  start: string;
  end: string;
  badge: { key: string; name: string; art: string; image: string | null } | null;
};

/** Setările Chat Pro trimise clientului (fără chei secrete). */
export type GcsChatProConfig = {
  gif: { provider: GcsChatProGifProvider; attribution: string } | null;
  commands: GcsChatProCommand[];
  /** Mementoul de vot (privat, periodic): textul, linkul și intervalul în minute; `null` = oprit din ACP. */
  vote: { text: string; url: string; minutes: number } | null;
  barSeconds: number;
  rankingSeconds: number;
};

/** Profilul de chat al viewer-ului (modalul de setări, contul). */
export type GcsChatProMe = {
  prefs: GcsChatProPrefs;
  nickname: string | null;
  badgeIds: number[];
  emoteFavorites: string[];
  gifFavorites: GcsChatProGif[];
};

/** Un badge obținut, din care membrul alege cel mult 2 pentru chat. */
export type GcsChatProEarnedBadge = { id: number; key: string; name: string; art: string; image: string | null };

export type { GcsChatProCommand, GcsChatProPrefs };
