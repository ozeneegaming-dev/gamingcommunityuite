/**
 * JS-ul Studioului VIP (doar pentru pluginul semnat; GCS îl încarcă pe paginile pluginului și unde apare widget-ul lui).
 * Studioul: previzualizarea live, numărătoarea modificărilor, variantele, filtrele, încărcarea pe loturi, tragerea
 * fundalului cardului, citatul, player-ul, resetarea și salvarea într-o singură cerere (cu ferestrele „Devino VIP” și
 * „Se echipează…”). Caruselul „VIP online”: săgeți, tastatură, swipe și buclă infinită. Totul merge și fără el.
 */

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = <T extends Element = HTMLElement>(root: ParentNode, sel: string) => root.querySelector<T & Element>(sel) as T | null;
const $$ = <T extends Element = HTMLElement>(root: ParentNode, sel: string) => Array.from(root.querySelectorAll(sel)) as unknown as T[];

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** Id-ul YouTube dintr-un link (aceleași reguli ca serverul, care validează oricum). */
function youtubeId(raw: string): string | null {
  const v = raw.trim();
  if (YOUTUBE_ID.test(v)) return v;
  try {
    const url = new URL(v);
    const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
    const parts = url.pathname.split("/").filter(Boolean);
    let id: string | null | undefined = null;
    if (host === "youtu.be") id = parts[0];
    else if (host === "youtube.com" || host === "youtube-nocookie.com") id = url.pathname === "/watch" ? url.searchParams.get("v") : ["shorts", "embed", "live", "v"].includes(parts[0] ?? "") ? parts[1] : null;
    return id && YOUTUBE_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

// ─── Studioul ────────────────────────────────────────────────────────────────

type Group = "name" | "frame" | "banner" | "card" | "weapon" | "background" | "quote" | "theme" | "song";
const GROUPS: Group[] = ["name", "frame", "banner", "card", "weapon", "background", "quote", "theme", "song"];
const BATCH = 10;

function initStudio(root: HTMLElement): void {
  root.dataset.gcspReady = "1";
  root.classList.add("gcsp-js");
  const form = $<HTMLFormElement>(root, "[data-gcsp-form]");
  if (!form) return;
  const t = (key: string) => root.getAttribute(`data-gcsp-t-${key}`) ?? key;
  const radio = (name: string) => $<HTMLInputElement>(form, `input[type="radio"][name="${name}"]:checked`);
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;
  const value = (name: string) => field(name)?.value ?? "";
  const tileOf = (input: Element | null) => input?.closest<HTMLElement>(".gcsp-tile") ?? null;
  const pv = (name: string) => $$<HTMLElement>(root, `[data-gcsp-pv="${name}"]`);
  const setLook = (els: HTMLElement[], source: Element | null) => {
    if (!source) return;
    for (const el of els) {
      el.className = source.className;
      const style = source.getAttribute("style");
      if (style) el.setAttribute("style", style);
      else el.removeAttribute("style");
    }
  };
  const show = (el: Element | null | undefined, on: boolean) => el?.classList.toggle("gcsp-hide", !on);

  // Variantele: radio-urile din banda de după placă; când se schimbă stilul, una din banda lui trebuie bifată.
  const variantStrip = (styleInput: HTMLInputElement | null) => {
    const next = tileOf(styleInput)?.nextElementSibling;
    return next?.classList.contains("gcsp-variants") ? (next as HTMLElement) : null;
  };
  const ensureVariant = () => {
    const style = radio("nameStyle");
    const strip = variantStrip(style);
    if (!strip) return;
    if (!$(strip, "input:checked")) {
      const firstVariant = $<HTMLInputElement>(strip, "input");
      if (firstVariant) firstVariant.checked = true;
    }
  };

  const songFile = () => (field("songFile") as HTMLInputElement | null)?.files?.[0] ?? null;

  /** Starea fiecărui grup (comparată cu cea salvată pentru numărătoare). */
  const snapshot = (): Record<Group, string> => {
    const style = radio("nameStyle")?.value ?? "";
    const variant = $$<HTMLInputElement>(form, 'input[name="nameVariant"]:checked').find((v) => v.value.startsWith(`${style}:`))?.value ?? "";
    const card = radio("card")?.value ?? "";
    const autoplay = (field("songAutoplay") as HTMLInputElement | null)?.checked ? "1" : "0";
    const keep = (field("songKeepAudio") as HTMLInputElement | null)?.checked ? "1" : "0";
    return {
      name: `${style}|${style ? variant : ""}`,
      frame: radio("frame")?.value ?? "",
      banner: `${radio("banner")?.value ?? ""}|${value("bannerLabel").trim()}`,
      card: card ? `${card}|${value("cardX")}|${value("cardY")}` : "",
      weapon: radio("weapon")?.value ?? "",
      background: radio("background")?.value ?? "",
      quote: value("quote").trim(),
      theme: radio("theme")?.value ?? "",
      song: `${radio("song")?.value ?? ""}|${value("songTitle")}|${value("songYoutube")}|${songFile()?.name ?? ""}|${keep}|${autoplay}`,
    };
  };
  let saved = snapshot();
  let dirty = 0;

  const count = $(root, "[data-gcsp-count]");
  const updateCount = () => {
    const now = snapshot();
    dirty = GROUPS.filter((g) => now[g] !== saved[g]).length;
    if (!count) return;
    const n = dirty;
    const mod = n % 100;
    const key = n === 0 ? "count-none" : n === 1 ? "count-one" : mod >= 1 && mod <= 19 ? "count-few" : "count-many";
    count.textContent = t(key).replace("{n}", String(n));
    count.classList.toggle("gcsp-dock__count--dirty", n > 0);
  };

  // ─ Previzualizările ─

  const previewName = () => {
    const style = radio("nameStyle");
    const tile = tileOf(style);
    const strip = variantStrip(style);
    const variant = strip ? $<HTMLInputElement>(strip, "input:checked") : null;
    const look = $(tile ?? root, ".gcsp-ns, .gcsp-nsGroup");
    if (variant && look && variant.dataset.gcspCls) {
      // Placa arată și ea varianta aleasă.
      look.className = variant.dataset.gcspCls;
      look.setAttribute("style", variant.dataset.gcspStyle ?? "");
    }
    setLook(pv("name"), look);
  };

  const previewBanner = () => {
    const tile = tileOf(radio("banner"));
    setLook(pv("banner"), $(tile ?? root, ".gcsp-pill"));
    const input = field("bannerLabel") as HTMLInputElement | null;
    const label = input ? input.value.trim() || input.placeholder : null;
    if (label !== null) for (const el of [...pv("banner"), ...$$<HTMLElement>(root, "[data-gcsp-label]")]) el.textContent = label;
  };

  const previewFrame = () => {
    const r = radio("frame");
    const src = r?.dataset.gcspSrc ?? "";
    for (const img of pv("frame") as HTMLImageElement[]) {
      show(img, Boolean(src));
      if (src) {
        img.src = src;
        img.setAttribute("style", `--fs:${r!.dataset.gcspFs ?? 130};--fx:${r!.dataset.gcspFx ?? 0};--fy:${r!.dataset.gcspFy ?? 0}`);
      }
    }
  };

  const cardImgs = () => pv("card") as HTMLImageElement[];
  const previewCard = () => {
    const src = radio("card")?.dataset.gcspSrc ?? "";
    for (const img of cardImgs()) {
      show(img, Boolean(src));
      img.closest(".gcsp-card__cover")?.classList.toggle("gcsp-card__cover--image", Boolean(src));
      if (src) {
        img.src = src;
        img.setAttribute("style", `--cx:${value("cardX") || 50};--cy:${value("cardY") || 50}`);
      }
    }
    const position = $(root, ".gcsp-position");
    if (position) position.style.opacity = src ? "1" : "0.45";
  };

  const previewWeapon = () => {
    const r = radio("weapon");
    const src = r?.dataset.gcspSrc ?? "";
    for (const img of pv("weapon") as HTMLImageElement[]) {
      show(img, Boolean(src));
      if (src) img.src = src;
    }
    for (const el of pv("weapon-label")) el.textContent = r?.dataset.gcspLabel ?? "—";
  };

  const previewBackground = () => {
    const r = radio("background");
    const src = r?.dataset.gcspSrc ?? "";
    const video = r?.dataset.gcspVideo ?? "";
    for (const img of pv("bg") as HTMLImageElement[]) {
      show(img, Boolean(src));
      if (src) img.src = src;
    }
    for (const v of pv("bg-video") as HTMLVideoElement[]) {
      const play = Boolean(video) && !reducedMotion();
      show(v, play);
      if (play) {
        if (v.getAttribute("src") !== video) {
          v.src = video;
          v.poster = src;
        }
        v.muted = true;
        void v.play().catch(() => {});
      } else {
        v.pause();
        v.removeAttribute("src");
      }
    }
  };

  const quoteCount = $(root, "[data-gcsp-quote-count]");
  const previewQuote = () => {
    const text = value("quote");
    const trimmed = text.trim();
    for (const el of pv("quote")) el.textContent = trimmed;
    for (const el of pv("quote-box")) show(el, trimmed.length > 0);
    if (quoteCount) {
      const n = [...text].length;
      quoteCount.textContent = `${n}/200`;
      quoteCount.classList.toggle("gcsp-counter--warn", n >= 160 && n < 190);
      quoteCount.classList.toggle("gcsp-counter--danger", n >= 190);
    }
  };

  const previewTheme = () => {
    const r = radio("theme");
    const style = r?.dataset.gcspStyle ?? "";
    for (const el of pv("theme")) {
      if (style) el.setAttribute("style", style);
      else el.removeAttribute("style");
      el.classList.toggle("gcsp-prof--themed", Boolean(style));
    }
  };

  let objectUrl: string | null = null;
  const player = $(root, "[data-gcsp-player]");
  const audio = $<HTMLAudioElement>(root, '[data-gcsp-pv="audio"]');
  const ytBox = $(root, '[data-gcsp-pv="yt"]');
  const stopPlayback = () => {
    audio?.pause();
    player?.classList.remove("gcsp-player--playing");
    const frame = ytBox ? $(ytBox, "iframe") : null;
    frame?.remove();
  };
  const previewSong = () => {
    const r = radio("song");
    const key = r?.value ?? "";
    let title = "";
    let artist = "";
    let src = "";
    let yt = "";
    if (key === "custom") {
      title = value("songTitle").trim();
      yt = youtubeId(value("songYoutube")) ?? "";
      const file = songFile();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = file ? URL.createObjectURL(file) : null;
      src = objectUrl ?? (audio?.dataset.gcspSaved ?? "");
      title ||= file?.name ?? "";
    } else if (key) {
      title = r?.dataset.gcspTitle ?? "";
      artist = r?.dataset.gcspArtist ?? "";
      src = r?.dataset.gcspAudio ?? "";
      yt = r?.dataset.gcspYt ?? "";
    }
    stopPlayback();
    for (const el of pv("song-title")) el.textContent = title || player?.dataset.gcspEmpty || "";
    for (const el of pv("song-artist")) el.textContent = artist;
    for (const el of pv("song-mini-title")) el.textContent = title;
    for (const el of pv("song-mini")) show(el, Boolean(key));
    player?.classList.toggle("gcsp-player--empty", !(src || yt));
    if (audio) {
      if (src) audio.src = src;
      else audio.removeAttribute("src");
    }
    if (ytBox) {
      ytBox.dataset.gcspYt = yt;
      show(ytBox, Boolean(yt) && !src);
    }
  };

  const previewAll = () => {
    ensureVariant();
    previewName();
    previewBanner();
    previewFrame();
    previewCard();
    previewWeapon();
    previewBackground();
    previewQuote();
    previewTheme();
    previewSong();
    updateCount();
  };

  // Melodia salvată (fișierul încărcat): păstrată pentru „Melodia mea” fără fișier nou.
  if (audio?.getAttribute("src") && radio("song")?.value === "custom") audio.dataset.gcspSaved = audio.getAttribute("src") ?? "";
  if (player) player.dataset.gcspEmpty = $(player, '[data-gcsp-pv="song-title"]')?.textContent ?? "";

  form.addEventListener("change", (e) => {
    const target = e.target as HTMLInputElement;
    if (target.name === "nameStyle") ensureVariant();
    if (target.name === "nameStyle" || target.name === "nameVariant") previewName();
    else if (target.name === "banner") previewBanner();
    else if (target.name === "frame") previewFrame();
    else if (target.name === "card" || target.name === "cardX" || target.name === "cardY") previewCard();
    else if (target.name === "weapon") previewWeapon();
    else if (target.name === "background") previewBackground();
    else if (target.name === "theme") previewTheme();
    else if (target.name.startsWith("song")) previewSong();
    updateCount();
  });
  form.addEventListener("input", (e) => {
    const target = e.target as HTMLInputElement;
    if (target.name === "quote") previewQuote();
    else if (target.name === "bannerLabel") previewBanner();
    else if (target.name === "cardX" || target.name === "cardY") previewCard();
    else if (target.name === "songTitle" || target.name === "songYoutube") {
      // Scrierea unui link sau a unui titlu alege „Melodia mea”.
      const custom = $<HTMLInputElement>(form, 'input[name="song"][value="custom"]');
      if (custom && !custom.checked) custom.checked = true;
      previewSong();
    }
    updateCount();
  });

  // ─ Player-ul ─

  const playBtn = $<HTMLButtonElement>(root, "[data-gcsp-play]");
  const volume = $<HTMLInputElement>(root, "[data-gcsp-volume]");
  playBtn?.addEventListener("click", () => {
    if (audio?.getAttribute("src")) {
      if (audio.paused) {
        audio.volume = Number(volume?.value ?? 70) / 100;
        void audio.play().catch(() => {});
      } else audio.pause();
      return;
    }
    const yt = ytBox?.dataset.gcspYt;
    if (ytBox && yt && YOUTUBE_ID.test(yt) && !$(ytBox, "iframe")) {
      const frame = document.createElement("iframe");
      frame.src = `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0`;
      frame.title = "YouTube";
      frame.allow = "autoplay; encrypted-media; picture-in-picture";
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      ytBox.append(frame);
      show(ytBox, true);
    }
  });
  audio?.addEventListener("play", () => {
    player?.classList.add("gcsp-player--playing");
    playBtn?.setAttribute("aria-label", playBtn.dataset.gcspLabelPause ?? "Pause");
  });
  audio?.addEventListener("pause", () => {
    player?.classList.remove("gcsp-player--playing");
    playBtn?.setAttribute("aria-label", playBtn.dataset.gcspLabelPlay ?? "Play");
  });
  if (playBtn) playBtn.dataset.gcspLabelPlay = playBtn.getAttribute("aria-label") ?? "Play";
  volume?.addEventListener("input", () => {
    if (audio) audio.volume = Number(volume.value) / 100;
  });

  // ─ Tragerea fundalului cardului ─

  for (const cover of $$<HTMLElement>(root, "[data-gcsp-drag]")) {
    let start: { x: number; y: number; cx: number; cy: number } | null = null;
    cover.addEventListener("pointerdown", (e) => {
      if (!radio("card")?.value) return;
      start = { x: e.clientX, y: e.clientY, cx: Number(value("cardX") || 50), cy: Number(value("cardY") || 50) };
      cover.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    cover.addEventListener("pointermove", (e) => {
      if (!start) return;
      const rect = cover.getBoundingClientRect();
      const clamp = (n: number) => Math.round(Math.min(100, Math.max(0, n)));
      const x = field("cardX") as HTMLInputElement | null;
      const y = field("cardY") as HTMLInputElement | null;
      // Imaginea urmează cursorul: tragerea spre dreapta arată partea din stânga.
      if (x) x.value = String(clamp(start.cx - ((e.clientX - start.x) / rect.width) * 100));
      if (y) y.value = String(clamp(start.cy - ((e.clientY - start.y) / rect.height) * 200));
      previewCard();
    });
    const end = () => {
      if (!start) return;
      start = null;
      updateCount();
    };
    cover.addEventListener("pointerup", end);
    cover.addEventListener("pointercancel", end);
  }

  // ─ Filtrele pe categorii și încărcarea pe loturi ─

  for (const grid of $$<HTMLElement>(root, ".gcsp-grid")) {
    // Tot ce e înaintea plăcii alese apare din prima (ordinea rămâne cea din catalog).
    const tiles = $$<HTMLElement>(grid, ".gcsp-tile");
    const chosenAt = tiles.findIndex((t) => t.querySelector("input:checked"));
    for (const t of tiles.slice(0, chosenAt + 1)) t.classList.remove("gcsp-later");
    const later = () => $$<HTMLElement>(grid, ".gcsp-later:not(.gcsp-hide-filter)");
    if (later().length === 0) continue;
    const sentinel = document.createElement("div");
    sentinel.setAttribute("aria-hidden", "true");
    sentinel.style.height = "1px";
    grid.after(sentinel);
    // Câte un lot de 10 cât timp capătul grilei e aproape de ecran (observatorul anunță doar schimbările, deci după
    // fiecare lot verificăm din nou poziția).
    const near = () => {
      const r = sentinel.getBoundingClientRect();
      return r.height > 0 && r.top < window.innerHeight + 200;
    };
    const fill = () => {
      if (!near() || later().length === 0) return;
      for (const el of later().slice(0, BATCH)) el.classList.remove("gcsp-later");
      requestAnimationFrame(fill);
    };
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) fill();
        if ($$(grid, ".gcsp-later").length === 0) io.disconnect();
      },
      { rootMargin: "200px" },
    );
    io.observe(sentinel);
  }
  for (const bar of $$<HTMLElement>(root, ".gcsp-filters")) {
    const grid = bar.nextElementSibling as HTMLElement | null;
    bar.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-gcsp-filter]");
      if (!btn || !grid) return;
      for (const b of $$<HTMLButtonElement>(bar, "[data-gcsp-filter]")) {
        const on = b === btn;
        b.classList.toggle("gcsp-filter--on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      }
      const cat = btn.dataset.gcspFilter;
      for (const tile of $$<HTMLElement>(grid, ".gcsp-tile")) {
        const own = tile.dataset.gcspCat;
        const visible = cat === "all" || !own || own === cat;
        tile.classList.toggle("gcsp-hide-filter", !visible);
        // O categorie aleasă se arată întreagă (categoriile sunt mici).
        if (visible && cat !== "all") tile.classList.remove("gcsp-later");
      }
    });
  }

  // ─ Ferestrele ─

  const veil = $(root, "[data-gcsp-veil]");
  let lastFocus: HTMLElement | null = null;
  let openName: string | null = null;
  const closeSheets = () => {
    for (const s of $$<HTMLElement>(root, "[data-gcsp-sheet]")) s.classList.remove("gcsp-sheet--open");
    root.classList.remove("gcsp-studio--sheet");
    openName = null;
    lastFocus?.focus();
  };
  const openSheet = (name: string) => {
    const sheet = $(root, `[data-gcsp-sheet="${name}"]`);
    if (!sheet) return null;
    for (const s of $$<HTMLElement>(root, "[data-gcsp-sheet]")) s.classList.toggle("gcsp-sheet--open", s === sheet);
    // Containerul pluginului e bloc de conținere: fereastra se pune în dreptul ecranului.
    const box = (root.closest(".gcsp") as HTMLElement | null) ?? root;
    const top = Math.max(16, -box.getBoundingClientRect().top + window.innerHeight * 0.28);
    sheet.style.setProperty("--gcsp-sheet-top", `${Math.round(top)}px`);
    root.classList.add("gcsp-studio--sheet");
    if (!openName) lastFocus = document.activeElement as HTMLElement | null;
    openName = name;
    ($(sheet, "a, button") ?? sheet).focus({ preventScroll: true });
    return sheet;
  };
  root.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("[data-gcsp-close]")) closeSheets();
  });
  veil?.addEventListener("click", () => {
    if (openName !== "saving") closeSheets();
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openName && openName !== "saving") closeSheets();
  });

  // ─ Resetarea la implicit (doar în pagină; salvarea o aplică) ─

  $(root, "[data-gcsp-reset]")?.addEventListener("click", () => {
    for (const name of ["nameStyle", "frame", "banner", "card", "weapon", "background", "theme", "song"]) {
      const def = $<HTMLInputElement>(form, `input[type="radio"][name="${name}"][value=""]`);
      if (def) def.checked = true;
    }
    for (const name of ["quote", "bannerLabel", "songTitle", "songYoutube"]) {
      const f = field(name);
      if (f) f.value = "";
    }
    for (const name of ["cardX", "cardY"]) {
      const f = field(name);
      if (f) f.value = "50";
    }
    const file = field("songFile") as HTMLInputElement | null;
    if (file) file.value = "";
    const autoplay = field("songAutoplay") as HTMLInputElement | null;
    if (autoplay) autoplay.checked = false;
    previewAll();
  });

  // ─ Salvarea ─

  const savingTitle = $(root, "[data-gcsp-saving-title]");
  const savingText = $(root, "[data-gcsp-saving-text]");
  const errors = $(root, "[data-gcsp-errors]");
  let busy = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    if (root.dataset.gcspVip !== "1" && root.dataset.gcspTest !== "1") {
      openSheet("vip");
      return;
    }
    busy = true;
    openSheet("saving");
    if (savingTitle) savingTitle.textContent = t("save-saving");
    try {
      const res = await fetch(form.action, { method: "POST", body: new FormData(form), credentials: "same-origin", headers: { Accept: "application/json" } });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; tab?: string; error?: string; problems?: { group: Group; plans: string[] }[] } | null;
      if (res.ok && body?.ok) {
        saved = snapshot();
        updateCount();
        if (savingTitle) savingTitle.textContent = t("save-done");
        if (savingText) savingText.textContent = "";
        const tab = body.tab && /^[a-z]{2,12}$/.test(body.tab) ? body.tab : "name";
        // Pagina se reîncarcă: CSS-ul numelor și ramele de pe site se iau din nou.
        window.setTimeout(() => window.location.assign(`${window.location.pathname}?saved=1&tab=${tab}`), reducedMotion() ? 200 : 650);
        return;
      }
      busy = false;
      if (body?.error === "vip_required") {
        openSheet("vip");
        return;
      }
      if (errors) {
        errors.replaceChildren();
        const items = body?.problems?.length
          ? body.problems.map((p) => t("save-locked").replace("{group}", t(`groups-${p.group}`)).replace("{plans}", p.plans.length ? p.plans.join(", ") : "VIP"))
          : [t("save-failed")];
        for (const text of items) {
          const li = document.createElement("li");
          li.textContent = text;
          errors.append(li);
        }
      }
      openSheet("error");
    } catch {
      busy = false;
      if (errors) {
        errors.replaceChildren();
        const li = document.createElement("li");
        li.textContent = t("save-failed");
        errors.append(li);
      }
      openSheet("error");
    }
  });

  window.addEventListener("beforeunload", (e) => {
    if (dirty > 0 && !busy) e.preventDefault();
  });

  previewAll();
  saved = snapshot();
  updateCount();
}

// ─── Caruselul „VIP online” ──────────────────────────────────────────────────

function initRoster(root: HTMLElement): void {
  root.dataset.gcspReady = "1";
  const track = $<HTMLUListElement>(root, ".gcsp-roster__track");
  if (!track) return;
  const originals = $$<HTMLLIElement>(track, ".gcsp-roster__item");
  if (originals.length === 0) return;
  root.classList.add("gcsp-roster--js");
  track.tabIndex = 0;
  const step = () => {
    const item = originals[0]!;
    const gap = Number.parseFloat(getComputedStyle(track).columnGap || "10") || 10;
    return item.getBoundingClientRect().width + gap;
  };
  const behavior = (): ScrollBehavior => (reducedMotion() ? "auto" : "smooth");
  const go = (dir: -1 | 1) => track.scrollBy({ left: dir * step(), behavior: behavior() });

  // Bucla infinită: o copie a cardurilor înainte și una după; la capete, poziția sare în mijloc fără animație.
  const overflow = track.scrollWidth > track.clientWidth + 4;
  if (overflow) {
    const clone = (li: HTMLLIElement) => {
      const c = li.cloneNode(true) as HTMLLIElement;
      c.setAttribute("aria-hidden", "true");
      c.dataset.gcspClone = "1";
      for (const a of $$<HTMLElement>(c, "a")) a.tabIndex = -1;
      return c;
    };
    track.prepend(...originals.map(clone));
    track.append(...originals.map(clone));
    const setWidth = () => originals.length * step();
    const jump = (left: number) => {
      track.style.scrollBehavior = "auto";
      track.scrollLeft = left;
      track.style.scrollBehavior = "";
    };
    requestAnimationFrame(() => jump(setWidth()));
    let timer = 0;
    track.addEventListener("scroll", () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const w = setWidth();
        if (track.scrollLeft < w * 0.5) jump(track.scrollLeft + w);
        else if (track.scrollLeft > w * 1.5) jump(track.scrollLeft - w);
      }, 140);
    });

    const arrow = (dir: -1 | 1) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `gcsp-roster__nav gcsp-roster__nav--${dir < 0 ? "prev" : "next"}`;
      b.setAttribute("aria-label", root.dataset[dir < 0 ? "gcspPrev" : "gcspNext"] ?? (dir < 0 ? "Previous" : "Next"));
      b.textContent = dir < 0 ? "‹" : "›";
      b.addEventListener("click", () => go(dir));
      return b;
    };
    root.append(arrow(-1), arrow(1));
  }
  track.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(-1);
    }
  });
}

// ─── Pornirea (și pentru paginile încărcate de navigarea din client) ────────

function scan(): void {
  for (const el of $$<HTMLElement>(document, "[data-gcsp-studio]:not([data-gcsp-ready])")) initStudio(el);
  for (const el of $$<HTMLElement>(document, "[data-gcsp-roster]:not([data-gcsp-ready])")) initRoster(el);
}

let pending = false;
function schedule(): void {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    scan();
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan, { once: true });
else scan();
new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
