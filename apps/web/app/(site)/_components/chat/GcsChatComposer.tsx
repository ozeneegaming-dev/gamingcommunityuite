"use client";

import { faFaceSmile, faImage } from "@fortawesome/free-regular-svg-icons";
import { faArrowTurnDown, faMagnifyingGlass, faMicrophone, faStop, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { GcsAttachmentInfo, GcsErrorPayload, GcsResult } from "@gcs/core";
import type { GcsChatConfig, GcsGif } from "@gcs/modules";
import { GcsIconSvg, GcsSpinner } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { GcsChatEmojiPicker } from "./GcsChatEmojiPicker";
import { useDismiss } from "./use-dismiss";
import { useMentionInput } from "@gcs/ui/mention-input";
import type { GcsMentionHint } from "@gcs/core/text-mentions";

const MAX_FILES = 4;
const VOICE_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

export type GcsChatComposerHandle = {
  /** Adaugă `@nume ` în mesaj (click pe numele unui membru). */
  mention: (name: string) => void;
  /** Pune focusul în câmp (ex. după „Răspunde”). */
  focus: () => void;
};

/** O sugestie a completării automate (ex. `:cod:` al unui emoticon): valoarea inserată și ce se afișează. */
export type GcsComposerSuggestion = { key: string; value: string; label: ReactNode };

/**
 * O comandă din paleta „/” a câmpului: numele, felul de folosire, descrierea, exemplele și sugestiile pentru argumente
 * (ex. drepturile, duratele, camerele lui `/acces`). Membrii (`@`) vin din sugestiile de mențiuni, ca peste tot.
 */
export type GcsComposerCommand = {
  name: string;
  usage: string;
  description: string;
  examples?: string[];
  hints?: { key: string; label: string; items: { value: string; label?: string }[] }[];
};

/**
 * Extensiile câmpului de mesaj (Chat Pro). Fără ele, câmpul e exact cel al chat-ului standard.
 * - `before`: deasupra câmpului (ex. bara „Răspunzi lui …”);
 * - `onInput`: la fiecare schimbare a textului (semnalul „scrie…”);
 * - `emojiPanel` / `gifPanel`: selectoarele proprii (emoticoanele comunității, GIF-urile furnizorului ales);
 * - `suggest`: sugestiile pentru `:text` tastat (emoticoanele după cod).
 */
export type GcsChatComposerExtensions = {
  before?: ReactNode;
  onInput?: (text: string) => void;
  emojiPanel?: (api: { insert: (s: string) => void; close: () => void; placement: "above" | "below" }) => ReactNode;
  gifPanel?: (api: { send: (url: string) => Promise<boolean>; close: () => void; placement: "above" | "below" }) => ReactNode;
  gifLabel?: string;
  suggest?: (query: string) => GcsComposerSuggestion[];
};

type Props = {
  channel: string;
  disabled: boolean;
  busy: boolean;
  config: Pick<GcsChatConfig, "maxLength" | "giphy" | "voice" | "voiceMaxSeconds" | "allowImages" | "hideEnterMobile">;
  labels: { placeholder: string; send: string; input: string };
  /** Unde se deschid selectoarele: deasupra câmpului (implicit) sau dedesubt (câmpul e deasupra listei). */
  placement?: "above" | "below";
  /** Trimite mesajul (cu sugestiile de mențiuni alese, încă în text); `true` dacă a plecat (câmpul se golește). */
  onSend: (body: string, files: string[], mentions: GcsMentionHint[]) => Promise<boolean>;
  onError: (error: GcsErrorPayload | string | null) => void;
  /** Extensiile Chat Pro (lipsă = chat-ul standard). */
  ext?: GcsChatComposerExtensions;
  /** Comenzile permise viewer-ului: „/” la începutul mesajului deschide paleta lor. */
  commands?: GcsComposerCommand[];
};

type Pending = { id: string; url: string; name: string };

async function uploadChatFile(channel: string, file: Blob, name: string): Promise<GcsResult<GcsAttachmentInfo>> {
  const fd = new FormData();
  fd.set("channel", channel);
  fd.set("file", file, name);
  try {
    const res = await fetch("/api/chat/uploads", { method: "POST", body: fd });
    return (await res.json()) as GcsResult<GcsAttachmentInfo>;
  } catch {
    return { ok: false, error: { code: "internal", status: 500 } } as GcsResult<GcsAttachmentInfo>;
  }
}

/**
 * Câmpul de mesaj al chat-ului (după chatbox-ul de referință): câmpul pe toată lățimea, cu uneltele în dreapta lui (imagine,
 * GIF, voce, emoticoane) și butonul albastru Enter. Imaginile se adaugă și prin lipire sau tragere, mesajele vocale se
 * înregistrează în browser, GIF-urile vin din GIPHY (`/giphy cuvânt` sau butonul GIF). Selectoarele sunt flotante,
 * ancorate de butoane, și se închid la click în afară sau la Escape. Butonul Enter se poate ascunde pe mobil (Enter
 * trimite oricum).
 */
export const GcsChatComposer = forwardRef<GcsChatComposerHandle, Props>(function GcsChatComposer(props, ref) {
  const { channel, disabled, busy, config, labels, onSend, onError, placement = "above", ext, commands } = props;
  const tk = useTranslations("chat.commands");
  const t = useTranslations("chat.ui");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Pending[]>([]);
  const [panel, setPanel] = useState<"emoji" | "gif" | null>(null);
  const [uploading, setUploading] = useState(false);
  // @mențiunile: aceeași listă de sugestii ca în editorul postărilor (membri și grupuri), ancorată de câmp.
  const te = useTranslations("topic.editor");
  const mention = useMentionInput<HTMLInputElement>({
    value: text,
    onValue: setText,
    labels: { empty: te("noMentions"), group: te("mentionGroup"), online: te("mentionOnline") },
    enabled: !disabled,
    placement: placement === "below" ? "below" : "above",
    maxLength: config.maxLength > 0 ? config.maxLength : 2000,
  });
  const inputRef = mention.ref;
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const emojiButton = useRef<HTMLButtonElement>(null);
  const gifButton = useRef<HTMLButtonElement>(null);
  const closePanel = useCallback(() => setPanel(null), []);
  useDismiss(panel !== null, panelRef, closePanel, panel === "gif" ? gifButton : emojiButton);
  const [gifQuery, setGifQuery] = useState("");
  const [gifs, setGifs] = useState<GcsGif[] | null>(null);
  const [gifLoading, setGifLoading] = useState(false);
  // Înregistrarea se oferă doar unde browserul o poate face (aflat după hidratare).
  const [canRecord, setCanRecord] = useState(false);
  useEffect(() => {
    setCanRecord(config.voice && "MediaRecorder" in window && !!navigator.mediaDevices?.getUserMedia);
  }, [config.voice]);

  const insert = (s: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = (text.slice(0, start) + s + text.slice(end)).slice(0, config.maxLength > 0 ? config.maxLength : 2000);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = Math.min(start + s.length, next.length);
      el?.setSelectionRange(pos, pos);
    });
  };

  useImperativeHandle(ref, () => ({
    mention: (name) => {
      const before = text && !text.endsWith(" ") ? " " : "";
      insert(`${before}@${name} `);
    },
    focus: () => inputRef.current?.focus(),
  }));

  // ─── Completarea automată (`:cod` → emoticonul), doar cu extensia `suggest` ───────────
  const [suggestions, setSuggestions] = useState<{ start: number; end: number; items: GcsComposerSuggestion[]; active: number } | null>(null);
  const updateSuggestions = (value: string, caret: number) => {
    if (!ext?.suggest) return;
    const m = /(^|\s):([a-z0-9_]{2,32})$/i.exec(value.slice(0, caret));
    const items = m ? ext.suggest(m[2]!.toLowerCase()).slice(0, 8) : [];
    setSuggestions(m && items.length > 0 ? { start: caret - m[2]!.length - 1, end: caret, items, active: 0 } : null);
  };
  const applySuggestion = (s: GcsComposerSuggestion) => {
    if (!suggestions) return;
    const next = `${text.slice(0, suggestions.start)}${s.value} ${text.slice(suggestions.end)}`;
    setText(next);
    setSuggestions(null);
    const pos = suggestions.start + s.value.length + 1;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
    });
  };

  // ─── Paleta de comenzi („/” la început): numele comenzilor, apoi sugestiile pentru argumente ───────────
  const [cmdActive, setCmdActive] = useState(0);
  const [cmdDismissed, setCmdDismissed] = useState<string | null>(null);
  const palette = useMemo(() => {
    if (!commands || commands.length === 0 || disabled || cmdDismissed === text) return null;
    const byName = /^\/([\w-]*)$/.exec(text);
    if (byName) {
      const q = byName[1]!.toLowerCase();
      const list = commands.filter((c) => c.name.startsWith(q));
      return list.length > 0 ? { mode: "name" as const, list } : null;
    }
    const withArgs = /^\/([\w-]+)\s([\s\S]*)$/.exec(text);
    const cmd = withArgs ? commands.find((c) => c.name === withArgs[1]!.toLowerCase()) : undefined;
    if (!withArgs || !cmd) return null;
    const token = /(\S*)$/.exec(withArgs[2]!)![1]!;
    // `@nume`: sugestiile de mențiuni (aceeași listă ca peste tot) au întâietate.
    if (token.startsWith("@")) return null;
    const used = new Set(withArgs[2]!.split(/\s+/).filter(Boolean));
    const groups = (cmd.hints ?? [])
      .map((g) => ({ ...g, items: g.items.filter((i) => !used.has(i.value) && i.value.toLowerCase().startsWith(token.toLowerCase())) }))
      .filter((g) => g.items.length > 0);
    return { mode: "args" as const, cmd, token, groups };
  }, [commands, disabled, cmdDismissed, text]);
  const paletteItems = palette ? (palette.mode === "name" ? palette.list.map((c) => `/${c.name}`) : palette.groups.flatMap((g) => g.items.map((i) => i.value))) : [];
  useEffect(() => setCmdActive(palette?.mode === "name" ? 0 : -1), [palette?.mode, paletteItems.length]);
  const pickPalette = (value: string) => {
    if (!palette) return;
    const next = palette.mode === "name" ? `${value} ` : `${text.slice(0, text.length - palette.token.length)}${value} `;
    setText(next);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.length, next.length);
    });
  };

  const addFiles = async (list: File[]) => {
    const images = list.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    if (!config.allowImages) return onError(t("imagesOff"));
    const room = MAX_FILES - files.length;
    if (room <= 0) return onError(t("tooManyFiles", { max: MAX_FILES }));
    setUploading(true);
    try {
      for (const file of images.slice(0, room)) {
        const res = await uploadChatFile(channel, file, file.name || "imagine.png");
        if (!res.ok) {
          onError(res.error);
          break;
        }
        setFiles((list) => [...list, { id: res.data.id, url: res.data.url, name: res.data.filename }]);
      }
    } finally {
      setUploading(false);
    }
  };

  // Imaginile trase peste tot chat-ul (nu doar peste câmp).
  useEffect(() => {
    const root = formRef.current?.closest(".gcs-chat") as HTMLElement | null;
    if (!root || disabled || !config.allowImages) return;
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      void addFiles([...e.dataTransfer.files]);
    };
    root.addEventListener("dragover", over);
    root.addEventListener("drop", drop);
    return () => {
      root.removeEventListener("dragover", over);
      root.removeEventListener("drop", drop);
    };
  });

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const body = text.trim();
    const giphy = /^\/giphy(?:\s+(.*))?$/i.exec(body);
    if (giphy && config.giphy) {
      setPanel("gif");
      setGifQuery(giphy[1]?.trim() ?? "");
      setText("");
      if (giphy[1]?.trim()) void searchGifs(giphy[1].trim());
      return;
    }
    if (!body && files.length === 0) return;
    const ok = await onSend(
      body,
      files.map((f) => f.id),
      mention.hints(),
    );
    if (ok) {
      setText("");
      setFiles([]);
      setPanel(null);
      mention.reset();
    }
  };

  // ─── GIPHY ───────────────────────────────────────────────────────────────
  const searchGifs = async (q: string) => {
    if (!q.trim()) return;
    setGifLoading(true);
    try {
      const res = await fetch(`/api/chat/giphy?q=${encodeURIComponent(q.trim())}`);
      const body = (await res.json().catch(() => ({ gifs: [] }))) as { gifs?: GcsGif[] };
      if (!res.ok) onError(res.status === 429 ? t("gifRateLimited") : t("gifError"));
      setGifs(body.gifs ?? []);
    } finally {
      setGifLoading(false);
    }
  };
  const sendGif = async (gif: GcsGif) => {
    if (await onSend(gif.url, [], [])) {
      setPanel(null);
      setGifs(null);
      setGifQuery("");
    }
  };

  // ─── Mesaje vocale ───────────────────────────────────────────────────────
  const [recording, setRecording] = useState<{ seconds: number } | null>(null);
  const recorder = useRef<{ rec: MediaRecorder; stream: MediaStream; cancel: boolean; timer: ReturnType<typeof setInterval> } | null>(null);

  const startVoice = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return onError(t("micDenied"));
    }
    const mimeType = VOICE_TYPES.find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    rec.onstop = async () => {
      const state = recorder.current;
      recorder.current = null;
      if (state) clearInterval(state.timer);
      stream.getTracks().forEach((tr) => tr.stop());
      setRecording(null);
      if (!state || state.cancel || chunks.length === 0) return;
      const type = rec.mimeType || mimeType || "audio/webm";
      const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
      setUploading(true);
      try {
        const res = await uploadChatFile(channel, new Blob(chunks, { type }), `voce.${ext}`);
        if (!res.ok) return onError(res.error);
        await onSend("", [res.data.id], []);
      } finally {
        setUploading(false);
      }
    };
    const started = Date.now();
    const timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      setRecording({ seconds });
      if (seconds >= config.voiceMaxSeconds) stopVoice(false);
    }, 250);
    recorder.current = { rec, stream, cancel: false, timer };
    rec.start(1000);
    setRecording({ seconds: 0 });
  };
  const stopVoice = (cancel: boolean) => {
    const state = recorder.current;
    if (!state) return;
    state.cancel = cancel;
    if (state.rec.state !== "inactive") state.rec.stop();
  };
  useEffect(
    () => () => {
      if (recorder.current) {
        recorder.current.cancel = true;
        if (recorder.current.rec.state !== "inactive") recorder.current.rec.stop();
      }
    },
    [],
  );

  const off = disabled || busy || uploading;
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return (
    <div className={`gcs-chat__composer${config.hideEnterMobile ? " gcs-chat__composer--noEnterMobile" : ""}`}>
      {files.length > 0 && (
        <ul className="gcs-chat__pending" aria-label={t("attached")}>
          {files.map((f) => (
            <li key={f.id}>
              <img src={f.url} alt={f.name} />
              <button
                type="button"
                aria-label={t("removeFile", { name: f.name })}
                title={t("removeFile", { name: f.name })}
                onClick={() => setFiles((list) => list.filter((x) => x.id !== f.id))}
              >
                <GcsIconSvg icon={faXmark} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {panel === "emoji" &&
        (ext?.emojiPanel ? (
          <div ref={panelRef} style={{ display: "contents" }}>
            {ext.emojiPanel({ insert, close: closePanel, placement })}
          </div>
        ) : (
          <GcsChatEmojiPicker ref={panelRef} placement={placement} onPick={insert} />
        ))}
      {panel === "gif" && ext?.gifPanel && (
        <div ref={panelRef} style={{ display: "contents" }}>
          {ext.gifPanel({ send: (url) => onSend(url, [], []), close: closePanel, placement })}
        </div>
      )}
      {panel === "gif" && !ext?.gifPanel && (
        <div ref={panelRef} className={`gcs-chat__panel gcs-chat__gifs gcs-chat__panel--${placement}`} role="dialog" aria-label="GIPHY" data-testid="gcs-chat-gifs">
          <form
            className="gcs-chat__gifSearch"
            onSubmit={(e) => {
              e.preventDefault();
              void searchGifs(gifQuery);
            }}
          >
            <input className="gcs-input" aria-label={t("gifSearch")} placeholder={t("gifSearch")} value={gifQuery} onChange={(e) => setGifQuery(e.target.value)} autoFocus maxLength={50} />
            <button type="submit" className="gcs-chat__tool" aria-label={t("search")} title={t("search")} disabled={gifLoading || !gifQuery.trim()}>
              <GcsIconSvg icon={faMagnifyingGlass} />
            </button>
          </form>
          {gifLoading && (
            <p className="gcs-chat__note gcs-loading">
              <GcsSpinner size="sm" />
            </p>
          )}
          {gifs && gifs.length === 0 && !gifLoading && <p className="gcs-chat__note">{t("gifNone")}</p>}
          <div className="gcs-chat__gifGrid">
            {(gifs ?? []).map((g) => (
              <button key={g.id} type="button" onClick={() => void sendGif(g)} aria-label={g.title || "GIF"} disabled={off}>
                <img src={g.preview} alt="" loading="lazy" referrerPolicy="no-referrer" />
              </button>
            ))}
          </div>
          <p className="gcs-chat__attribution">Powered by GIPHY</p>
        </div>
      )}
      {recording && (
        <p className="gcs-chat__recording">
          <span className="gcs-chat__recDot" aria-hidden="true" />
          <span className="gcs-chat__recTime" role="timer" aria-live="off">
            {mmss(recording.seconds)} / {mmss(config.voiceMaxSeconds)}
          </span>
          <button type="button" className="gcs-linkButton" onClick={() => stopVoice(true)}>
            {t("voiceCancel")}
          </button>
        </p>
      )}
      {ext?.before}
      {palette && (
        <div className={`gcs-chat__panel gcs-chatCmd gcs-chat__panel--${placement}`} role="listbox" aria-label={tk("title")} data-testid="gcs-chat-commands">
          {palette.mode === "name" ? (
            <>
              <span className="gcs-chatCmd__head">{tk("title")}</span>
              {palette.list.map((c, i) => (
                <button
                  key={c.name}
                  type="button"
                  role="option"
                  aria-selected={i === cmdActive}
                  tabIndex={-1}
                  className={`gcs-chatCmd__item gcs-sweep${i === cmdActive ? " gcs-chatCmd__item--on" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickPalette(`/${c.name}`)}
                  data-testid={`gcs-chat-command-${c.name}`}
                >
                  <b>/{c.name}</b>
                  <span className="gcs-chatCmd__usage">{c.usage}</span>
                  <span className="gcs-chatCmd__desc">{c.description}</span>
                </button>
              ))}
            </>
          ) : (
            <>
              <span className="gcs-chatCmd__head">{tk("title")}</span>
              <span className="gcs-chatCmd__item gcs-chatCmd__item--static">
                <b>/{palette.cmd.name}</b>
                <span className="gcs-chatCmd__usage">{palette.cmd.usage}</span>
                <span className="gcs-chatCmd__desc">{palette.cmd.description}</span>
              </span>
              {palette.cmd.examples && palette.cmd.examples.length > 0 && (
                <span className="gcs-chatCmd__examples">
                  <span className="gcs-chatCmd__muted">{tk("examples")}</span>
                  {palette.cmd.examples.map((x) => (
                    <code key={x}>{x}</code>
                  ))}
                </span>
              )}
              {(() => {
                let n = -1;
                return palette.groups.map((g) => (
                  <span key={g.key} className="gcs-chatCmd__group">
                    <span className="gcs-chatCmd__head">{g.label}</span>
                    <span className="gcs-chatCmd__chips">
                      {g.items.map((it) => {
                        n += 1;
                        const on = n === cmdActive;
                        return (
                          <button
                            key={it.value}
                            type="button"
                            role="option"
                            aria-selected={on}
                            tabIndex={-1}
                            className={`gcs-chatCmd__chip gcs-sweep${on ? " gcs-chatCmd__chip--on" : ""}`}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => pickPalette(it.value)}
                            title={it.label}
                          >
                            {it.value}
                          </button>
                        );
                      })}
                    </span>
                  </span>
                ));
              })()}
            </>
          )}
        </div>
      )}
      {suggestions && (
        <ul className={`gcs-chat__panel gcs-chatPro__suggest gcs-chat__panel--${placement}`} role="listbox" aria-label={t("suggestions")} data-testid="gcs-chat-suggest">
          {suggestions.items.map((s, i) => (
            <li key={s.key} role="option" aria-selected={i === suggestions.active}>
              <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => applySuggestion(s)}>
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form ref={formRef} className="gcs-chat__form" onSubmit={(e) => void submit(e)}>
        <div className="gcs-chat__field gcs-mentionAnchor">
          {mention.popup}
          <input
            ref={inputRef}
            className="gcs-chat__input"
            aria-label={labels.input}
            placeholder={recording ? t("recording") : labels.placeholder}
            maxLength={config.maxLength > 0 ? config.maxLength : 2000}
            value={text}
            disabled={disabled || recording !== null}
            onChange={(e) => {
              setText(e.target.value);
              ext?.onInput?.(e.target.value);
              updateSuggestions(e.target.value, e.target.selectionStart ?? e.target.value.length);
              mention.onText(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
            onKeyDown={(e) => {
              if (mention.onKeyDown(e)) return;
              if (palette && paletteItems.length > 0) {
                const n = paletteItems.length;
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setCmdActive((i) => (e.key === "ArrowDown" ? (i + 1) % n : (i <= 0 ? n : i) - 1));
                  return;
                }
                if ((e.key === "Enter" || e.key === "Tab") && (cmdActive >= 0 || e.key === "Tab")) {
                  e.preventDefault();
                  pickPalette(paletteItems[Math.max(0, cmdActive)]!);
                  return;
                }
              }
              if (palette && e.key === "Escape") {
                e.preventDefault();
                setCmdDismissed(text);
                return;
              }
              if (!suggestions) return;
              const n = suggestions.items.length;
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setSuggestions({ ...suggestions, active: (suggestions.active + (e.key === "ArrowDown" ? 1 : n - 1)) % n });
              } else if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                applySuggestion(suggestions.items[suggestions.active]!);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setSuggestions(null);
              }
            }}
            onBlur={() => {
              setSuggestions(null);
              mention.onBlur();
            }}
            {...(suggestions || palette ? { role: "combobox", "aria-expanded": true, "aria-autocomplete": "list" as const } : mention.open ? { role: "combobox", ...mention.aria } : {})}
            onPaste={(e) => {
              const pasted = [...e.clipboardData.files];
              if (pasted.some((f) => f.type.startsWith("image/"))) {
                e.preventDefault();
                void addFiles(pasted);
              }
            }}
            data-testid="gcs-chat-input"
          />
          <div className="gcs-chat__buttons">
            {config.allowImages && (
              <>
                <button type="button" className="gcs-chat__tool" aria-label={t("addImage")} title={t("addImage")} disabled={off} onClick={() => fileRef.current?.click()}>
                  <GcsIconSvg icon={faImage} />
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  multiple
                  hidden
                  data-testid="gcs-chat-file"
                  onChange={(e) => {
                    void addFiles([...(e.target.files ?? [])]);
                    e.target.value = "";
                  }}
                />
              </>
            )}
            {(ext?.gifPanel !== undefined || config.giphy) && (
              <button
                ref={gifButton}
                type="button"
                className="gcs-chat__tool gcs-chat__tool--gif"
                aria-label="GIF"
                title={ext?.gifLabel ?? "GIPHY"}
                aria-haspopup="dialog"
                aria-expanded={panel === "gif"}
                disabled={disabled}
                onClick={() => setPanel(panel === "gif" ? null : "gif")}
              >
                GIF
              </button>
            )}
            {canRecord &&
              (recording ? (
                <button type="button" className="gcs-chat__tool gcs-chat__tool--rec" aria-label={t("voiceStop")} title={t("voiceStop")} onClick={() => stopVoice(false)}>
                  <GcsIconSvg icon={faStop} />
                </button>
              ) : (
                <button type="button" className="gcs-chat__tool" aria-label={t("voiceStart")} title={t("voiceStart")} disabled={off} onClick={() => void startVoice()}>
                  <GcsIconSvg icon={faMicrophone} />
                </button>
              ))}
            <button
              ref={emojiButton}
              type="button"
              className="gcs-chat__tool gcs-chat__tool--emoji"
              aria-label={t("emoji")}
              title={t("emoji")}
              aria-haspopup="dialog"
              aria-expanded={panel === "emoji"}
              disabled={disabled}
              onClick={() => setPanel(panel === "emoji" ? null : "emoji")}
            >
              <GcsIconSvg icon={faFaceSmile} />
            </button>
          </div>
        </div>
        <button
          type="submit"
          className="gcs-chat__send"
          aria-label={labels.send}
          title={labels.send}
          disabled={off || recording !== null || (!text.trim() && files.length === 0)}
          aria-busy={busy || uploading || undefined}
        >
          {/* Cât se trimite mesajul sau se încarcă un fișier: loaderul temei („Stil loader”). */}
          {busy || uploading ? <GcsSpinner size="sm" /> : <GcsIconSvg icon={faArrowTurnDown} className="gcs-chat__sendIcon" />}
        </button>
      </form>
    </div>
  );
});
