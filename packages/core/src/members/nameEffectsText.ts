/**
 * Categoria „Efecte text” a efectelor numelui: efecte noi, cele mai multe adaptate dintr-o bibliotecă de efecte text
 * CSS cu licență MIT (vezi `THIRD-PARTY-NOTICES.md`), plus două originale GCS. Fiecare e rescris pentru numele unui
 * membru:
 * - culorile vin din cernelurile variantei (`--nfx-i1` … `--nfx-i5`, închise automat pe tema deschisă);
 * - distanțele sunt în `em` (aceleași la 12 px într-o listă și la 40 px pe profil);
 * - cadrele-cheie au prefixul `gcsNfx`; sub `prefers-reduced-motion` totul se oprește (regula din `nameEffects.ts`);
 * - `base` se aplică peste tot (și în listele dense: culoarea și o animație ușoară, fără filtre animate scumpe), `rich`
 *   doar în locurile mari (postbit, profil, hover card, meniul userului, previzualizări): straturile cu textul dublat
 *   (`data-text`) și decorurile;
 * - efectele pe litere (`letter`, `letterRich`, `letterNth`) animă fiecare literă (`.gcs-name__ls > b`, `--i` = indexul
 *   ei); componenta numelui desenează literele doar pentru membrii care au ales un astfel de efect. Amplitudinea
 *   mișcărilor verticale e `--nfx-amp` (mică în liste, mai mare în locurile mari), ca rândurile să nu se suprapună.
 */
import { black, d, DECOR, g, i, sheen, TEXT_LAYER, white, type Fx } from "./nameFxKit";

/** Textul umplut cu un fundal (tăiat pe litere). */
const CLIP = ["-webkit-background-clip:text", "background-clip:text", "color:transparent", "-webkit-text-fill-color:transparent"];
/** O culoare cu transparență (fix, nu depinde de temă). */
const mix = (c: string, pct: number) => `color-mix(in srgb,${c} ${pct}%,transparent)`;
/**
 * Un strat cu textul dublat, umplut cu un fundal tăiat pe litere: după `TEXT_LAYER` (care pune umplerea plină) și după
 * fundal (shorthand-ul `background` resetează tăierea).
 */
const LAYER_CLIP = ["color:transparent", "-webkit-text-fill-color:transparent", "-webkit-background-clip:text", "background-clip:text"];
/** Amplitudinea mișcărilor pe verticală: mică în liste, mai mare în locurile mari. */
const amp = (k: number) => `calc(var(--nfx-amp,.12em)*${k})`;
/** Indexul literei, limitat (numele lungi nu-și trimit literele departe). */
const iClamp = (center: number) => `clamp(-3,var(--i) - ${center},3)`;
/** Locurile mari: mișcări mai ample. */
const RICH_AMP = ["--nfx-amp:.2em"];

/** Umbra care se rotește ca a unui cadran solar: 8 poziții, trei trepte de umbră în culoarea a doua. */
function sundial(): string {
  const frames: string[] = [];
  for (let k = 0; k <= 8; k++) {
    const a = (k * Math.PI) / 4;
    const x = Math.cos(a);
    const y = Math.sin(a);
    const step = (n: number) => `${(x * 0.13 * n).toFixed(3)}em ${(y * 0.13 * n).toFixed(3)}em`;
    frames.push(`${(k * 12.5).toFixed(1)}%{text-shadow:${step(1)} ${i(2)},${step(2)} ${mix(i(2), 55)},${step(3)} ${mix(i(2), 25)}}`);
  }
  return `@keyframes gcsNfxSundial{${frames.join("")}}`;
}

/** Stiva de umbre a literelor retro (70s): culorile 2 și 3, apoi o nuanță închisă, la `k` em pe treaptă. */
const groovy = (k: number) =>
  `text-shadow:${k}em ${k}em 0 ${i(2)},${2 * k}em ${2 * k}em 0 color-mix(in oklab,${i(2)},${i(3)}),${3 * k}em ${3 * k}em 0 ${i(3)},${4 * k}em ${4 * k}em 0 ${black(i(3), 50)}`;

export const TEXT_EFFECTS = [
  "boreal",
  "cameleon",
  "lichid",
  "obsidian",
  "sclipire",
  "glitch_scan",
  "vid",
  "scaner",
  "jar",
  "ecou",
  "feliat",
  "tremur",
  "anaglif",
  "fosfor",
  "reflector",
  "elastic",
  "puls_cardiac",
  "marker",
  "cadran",
  "negativ",
  "holograma",
  "folie",
  "pixeli",
  "praf_stele",
  "vapori",
  "plasa",
  "irizat",
  "sticla",
  "flux_date",
  "prisma",
  "laser",
  "microcip",
  "termic",
  "semnal",
  "portal",
  "duoton",
  "eclipsa",
  "voal",
  "marmura",
  "unde",
  "fantoma",
  "lenticular",
  "caustic",
  // Pe litere.
  "magnetic",
  "val_litere",
  "unda",
  "focus",
  "spectru",
  "pop",
  "topire",
  "cinetic",
  "orbite",
  "paralaxa",
  "ploaie_litere",
  "zootrop",
  "pendul",
  "fum",
  "kilovolt",
  "spargere",
  "karaoke",
  "retro",
  "mercur",
] as const;
export type GcsTextEffect = (typeof TEXT_EFFECTS)[number];

export const TEXT_FX: Record<GcsTextEffect, Fx> = {
  /* adapted from CSS Text Effects (MIT) — aurora */
  boreal: {
    base: [`background-image:linear-gradient(115deg,${i(2)},${i(3)},${i(2)},${i(3)})`, "background-size:300% 100%", ...CLIP, `animation:gcsNfxBoreal ${d(7)} linear infinite`],
  },

  /* adapted from CSS Text Effects (MIT) — aurora (nuanța care se rotește lin, pe o culoare plină) */
  cameleon: {
    base: [`color:${white(i(1), 12)}`, `text-shadow:0 0 .35em ${g(55)}`, `animation:gcsNfxHue ${d(9)} linear infinite`],
  },

  /* adapted from CSS Text Effects (MIT) — liquid */
  lichid: {
    base: [
      `-webkit-text-stroke:max(1px,.03em) ${mix(i(3), 70)}`,
      `background-image:linear-gradient(0deg,${i(3)} 0 46%,${mix(i(3), 60)} 48%,${mix(i(3), 22)} 52% 100%)`,
      "background-size:100% 220%",
      ...CLIP,
      `animation:gcsNfxLiquid ${d(3.4)} ease-in-out infinite`,
    ],
  },

  /* adapted from CSS Text Effects (MIT) — chrome (oglinda neagră lucioasă, cu reflexia care trece) */
  obsidian: {
    base: [
      `background-image:linear-gradient(100deg,transparent 38%,${sheen(0.95)} 50%,transparent 62%),linear-gradient(180deg,#4A4E59 0%,#15171D 46%,#000 52%,#2A2D35 100%)`,
      "background-size:250% 100%,100% 100%",
      "background-position:150% 0,0 0",
      ...CLIP,
      `-webkit-text-stroke:max(.6px,.035em) ${mix(i(1), 85)}`,
      `filter:drop-shadow(0 0 1px ${g(70)}) drop-shadow(0 0 .2em ${g(45)})`,
      `animation:gcsNfxSheen ${d(3.2)} ease-in-out infinite`,
    ],
    rich: {
      after: [
        ...TEXT_LAYER,
        "top:70%",
        `color:${white(i(1), 20)}`,
        "-webkit-text-stroke:0",
        "transform:scaleY(-.7)",
        "transform-origin:50% 50%",
        "opacity:.28",
        "-webkit-mask-image:linear-gradient(0deg,#000 0%,transparent 80%)",
        "mask-image:linear-gradient(0deg,#000 0%,transparent 80%)",
      ],
    },
  },

  /** Original GCS: o sclipire în cruce (ca reflexia unei lentile) trece peste nume, odată cu o rază pe litere. */
  sclipire: {
    base: [
      `background-image:linear-gradient(100deg,transparent 42%,${sheen(0.95)} 50%,transparent 58%),linear-gradient(${white(i(1), 25)},${white(i(1), 25)})`,
      "background-size:300% 100%,100% 100%",
      "background-position:150% 0,0 0",
      ...CLIP,
      `animation:gcsNfxFlareSheen ${d(3.6)} ease-in-out infinite`,
    ],
    rich: {
      self: [`filter:drop-shadow(0 0 .15em ${g(45)})`],
      after: [
        ...DECOR,
        "top:50%",
        "left:0",
        "width:1.3em",
        "height:1.3em",
        "margin:-.65em 0 0 -.65em",
        `background:radial-gradient(circle,#fff 0 .05em,${g(85)} .1em,transparent .32em),linear-gradient(90deg,transparent,#fff 50%,transparent) 50% 50%/100% .05em no-repeat,linear-gradient(0deg,transparent,#fff 50%,transparent) 50% 50%/.05em 100% no-repeat`,
        `filter:drop-shadow(0 0 .12em ${g(95)})`,
        `animation:gcsNfxFlare ${d(3.6)} ease-in-out infinite`,
      ],
    },
  },

  /* adapted from CSS Text Effects (MIT) — signal + crt (glitch cu linii de scanare și o bandă de lumină) */
  glitch_scan: {
    base: [
      `background-image:linear-gradient(180deg,transparent 40%,${sheen(0.9)} 50%,transparent 60%),repeating-linear-gradient(0deg,${i(1)} 0 .09em,${mix(i(1), 55)} .09em .15em)`,
      "background-size:100% 260%,100% 100%",
      "background-position:0 100%,0 0",
      ...CLIP,
      "display:inline-block",
      `filter:drop-shadow(.05em 0 0 ${g(55, i(2))}) drop-shadow(-.05em 0 0 ${g(55, i(3))})`,
      `animation:gcsNfxVscan ${d(2.4)} linear infinite,gcsNfxJolt ${d(2)} steps(1) infinite`,
    ],
    rich: {
      before: [...TEXT_LAYER, `color:${i(2)}`, "clip-path:inset(0 0 58% 0)", "opacity:.15", `animation:gcsNfxSignalA ${d(2)} steps(1) infinite`],
      after: [...TEXT_LAYER, `color:${i(3)}`, "clip-path:inset(42% 0 0 0)", "opacity:.12", `animation:gcsNfxSignalB ${d(2)} steps(1) infinite`],
    },
  },

  /** Original GCS: un miez întunecat, cu o aură violet care pulsează în jurul literelor. */
  vid: {
    base: [
      `color:color-mix(in oklab,#05030A 86%,${i(1)})`,
      `text-shadow:0 0 .06em ${g(95)},0 0 .25em ${g(75)},0 0 .6em ${g(40)}`,
      `animation:gcsNfxVoid ${d(2.8)} ease-in-out infinite`,
    ],
    rich: {
      self: ["isolation:isolate"],
      before: [...DECOR, "opacity:1", "inset:-.15em -.45em", "z-index:-1", "border-radius:50%", `background:radial-gradient(closest-side,${g(30)},transparent)`, `animation:gcsNfxAura ${d(2.8)} ease-in-out infinite`],
    },
  },

  /* adapted from CSS Text Effects (MIT) — scanner */
  scaner: {
    base: [
      `background-image:linear-gradient(90deg,${mix(i(1), 35)} 0 40%,${i(1)} 50%,${mix(i(1), 35)} 60% 100%)`,
      "background-size:300% 100%",
      ...CLIP,
      `animation:gcsNfxScanGlow ${d(2.6)} ease-in-out infinite alternate`,
    ],
    rich: {
      after: [...DECOR, "opacity:1", "top:-.15em", "bottom:-.15em", "left:0", "width:max(2px,.08em)", `background:${i(2)}`, `box-shadow:0 0 .4em ${g(100, i(2))}`, `animation:gcsNfxScanBar ${d(2.6)} ease-in-out infinite alternate`],
    },
  },

  /* adapted from CSS Text Effects (MIT) — ember */
  jar: {
    base: [`color:${white(i(1), 45)}`, `animation:gcsNfxEmberGlow ${d(1.7)} ease-in-out infinite alternate`],
  },

  /* adapted from CSS Text Effects (MIT) — echo */
  ecou: {
    base: [`color:${i(1)}`, `text-shadow:0 0 .3em ${g(40)}`],
    rich: {
      before: [...TEXT_LAYER, `color:${i(2)}`, `animation:gcsNfxEcho ${d(2)} ease-out infinite`],
      after: [...TEXT_LAYER, `color:${i(3)}`, `animation:gcsNfxEcho ${d(2)} ease-out infinite`, `animation-delay:${d(1)}`],
    },
  },

  /* adapted from CSS Text Effects (MIT) — sliced */
  feliat: {
    base: [`color:${i(1)}`, `text-shadow:.04em 0 ${g(45, i(2))},-.04em 0 ${g(45, i(3))}`],
    rich: {
      self: ["color:transparent", "-webkit-text-fill-color:transparent"],
      before: [...TEXT_LAYER, `color:${i(1)}`, "clip-path:inset(0 0 50% 0)", `animation:gcsNfxSlicedTop ${d(3)} ease-in-out infinite`],
      after: [...TEXT_LAYER, `color:${i(1)}`, "clip-path:inset(50% 0 0 0)", `animation:gcsNfxSlicedBot ${d(3)} ease-in-out infinite`],
    },
  },

  /* adapted from CSS Text Effects (MIT) — jitter */
  tremur: {
    base: [`color:${i(1)}`, "display:inline-block", `animation:gcsNfxTremor ${d(1.9)} steps(1) infinite`],
  },

  /* adapted from CSS Text Effects (MIT) — anaglyph */
  anaglif: {
    base: [`color:${i(1)}`, `animation:gcsNfxAnaglyph ${d(2.4)} ease-in-out infinite`],
  },

  /* adapted from CSS Text Effects (MIT) — crt */
  fosfor: {
    base: [`color:${i(1)}`, `text-shadow:0 0 .25em ${g(80)}`, `animation:gcsNfxCrt ${d(3.4)} steps(1) infinite`],
    rich: {
      after: [
        ...DECOR,
        "opacity:1",
        "inset:-.05em -.1em",
        "background:repeating-linear-gradient(0deg,transparent 0 .07em,rgb(0 0 0/calc(.38*var(--nfx-dk,1))) .07em .14em)",
        `animation:gcsNfxCrtRoll ${d(6)} linear infinite`,
      ],
    },
  },

  /* adapted from CSS Text Effects (MIT) — spotlight */
  reflector: {
    base: [`background-image:radial-gradient(3.5ch 100% at 50% 50%,${i(1)} 20%,${mix(i(1), 30)} 75%)`, "background-size:300% 100%", ...CLIP, `animation:gcsNfxSpot ${d(3.4)} ease-in-out infinite alternate`],
  },

  /* adapted from CSS Text Effects (MIT) — elastic */
  elastic: {
    base: [`color:${i(1)}`, "display:inline-block", `animation:gcsNfxElastic ${d(1.6)} ease-in-out infinite`],
  },

  /* adapted from CSS Text Effects (MIT) — heartbeat */
  puls_cardiac: {
    base: [`color:${i(1)}`, "display:inline-block", `animation:gcsNfxHeart ${d(1.4)} ease-in-out infinite`],
  },

  /* adapted from CSS Text Effects (MIT) — marker */
  marker: {
    base: [
      `color:${i(1)}`,
      `background-image:linear-gradient(100deg,${g(55, i(3))},${g(35, i(3))})`,
      "background-repeat:no-repeat",
      "background-position:0 62%",
      "background-size:0% 46%",
      "-webkit-box-decoration-break:clone",
      "box-decoration-break:clone",
      `animation:gcsNfxMarker ${d(3)} ease-in-out infinite`,
    ],
  },

  /* adapted from CSS Text Effects (MIT) — sundial */
  cadran: {
    base: [`color:${i(1)}`, `animation:gcsNfxSundial ${d(5)} linear infinite`],
  },

  /* adapted from CSS Text Effects (MIT) — negative */
  negativ: {
    base: [`color:${i(1)}`, `text-shadow:0 0 .3em ${g(35)}`],
    rich: {
      self: ["isolation:isolate"],
      after: [...DECOR, "opacity:1", "top:0", "bottom:0", "left:0", "width:34%", `background:${i(1)}`, "mix-blend-mode:difference", `animation:gcsNfxScanBar ${d(2.4)} ease-in-out infinite alternate`],
    },
  },

  /* adapted from CSS Text Effects (MIT) — hologram */
  holograma: {
    base: [
      `color:color-mix(in srgb,${i(3)} 72%,${i(1)})`,
      `text-shadow:0 0 .2em ${g(60, i(3))},0 0 .7em ${g(45, i(3))}`,
      "display:inline-block",
      `animation:gcsNfxHoloFloat ${d(3.8)} ease-in-out infinite`,
    ],
    rich: {
      self: ["isolation:isolate"],
      before: [...TEXT_LAYER, `color:${i(2)}`, "clip-path:inset(0 0 52% 0)", "opacity:.58", `animation:gcsNfxHoloSplit ${d(2.8)} steps(1) infinite`],
      after: [...TEXT_LAYER, `background:repeating-linear-gradient(0deg,${mix(i(1), 70)} 0 .035em,transparent .035em .13em)`, ...LAYER_CLIP, "opacity:.48", `animation:gcsNfxHoloLines ${d(1.2)} linear infinite`],
    },
  },

  /* adapted from CSS Text Effects (MIT) — foil */
  folie: {
    base: [
      `background-image:linear-gradient(108deg,${black(i(3), 45)} 0%,${i(1)} 18%,${white(i(1), 60)} 24%,${i(2)} 36%,${i(1)} 51%,${black(i(2), 35)} 68%,${white(i(1), 55)} 76%,${i(2)} 100%)`,
      "background-size:230% 100%",
      ...CLIP,
      `animation:gcsNfxFoil ${d(3.1)} ease-in-out infinite`,
    ],
    rich: { self: [`filter:drop-shadow(0 .03em 0 ${mix(white(i(1), 70), 45)}) drop-shadow(0 .25em .5em rgba(0,0,0,.3))`] },
  },

  /* adapted from CSS Text Effects (MIT) — pixel */
  pixeli: {
    base: [`color:${i(1)}`, `text-shadow:.03em 0 0 ${i(2)},-.03em 0 0 ${i(3)}`],
    rich: {
      before: [...TEXT_LAYER, `color:${i(2)}`, "opacity:.85", "clip-path:polygon(0 0,100% 0,100% 28%,0 28%,0 44%,100% 44%,100% 58%,0 58%)", `animation:gcsNfxPixelA ${d(2.2)} steps(1) infinite`],
      after: [...TEXT_LAYER, `color:${i(3)}`, "opacity:.85", "clip-path:polygon(0 30%,100% 30%,100% 42%,0 42%,0 66%,100% 66%,100% 82%,0 82%)", `animation:gcsNfxPixelB ${d(2.2)} steps(1) infinite`],
    },
  },

  /* adapted from CSS Text Effects (MIT) — starlight */
  praf_stele: {
    base: [
      `background-image:radial-gradient(circle at 14% 35%,#fff 0 .07em,transparent .08em),radial-gradient(circle at 42% 68%,#fff 0 .05em,transparent .07em),radial-gradient(circle at 75% 24%,#fff 0 .07em,transparent .09em),linear-gradient(100deg,${i(1)},${i(3)},${i(1)})`,
      "background-size:4em 2em,5em 2.4em,6em 2.3em,240% 100%",
      ...CLIP,
      `animation:gcsNfxStarlight ${d(3.6)} linear infinite`,
    ],
    rich: { self: [`filter:drop-shadow(0 0 .3em ${g(45, i(3))})`] },
  },

  /* adapted from CSS Text Effects (MIT) — vapor */
  vapori: {
    base: [`color:${i(1)}`, `text-shadow:0 0 .4em ${g(45)}`, "display:inline-block", `animation:gcsNfxVaporMain ${d(2.8)} ease-in-out infinite`],
    rich: {
      before: [...TEXT_LAYER, `color:${i(2)}`, "filter:blur(.07em)", "opacity:.62", `animation:gcsNfxVaporA ${d(2.8)} ease-in-out infinite`],
      after: [...TEXT_LAYER, `color:${i(3)}`, "filter:blur(.07em)", "opacity:.62", `animation:gcsNfxVaporB ${d(2.8)} ease-in-out infinite`],
    },
  },

  /* adapted from CSS Text Effects (MIT) — mesh */
  plasa: {
    base: [
      `background-image:radial-gradient(circle at 18% 28%,${i(2)} 0 12%,transparent 28%),radial-gradient(circle at 78% 24%,${i(3)} 0 14%,transparent 30%),radial-gradient(circle at 44% 82%,${white(i(1), 70)} 0 10%,transparent 24%),linear-gradient(110deg,${i(2)},${i(3)})`,
      "background-size:180% 180%,170% 170%,160% 160%,220% 100%",
      ...CLIP,
      `animation:gcsNfxMesh ${d(4.8)} ease-in-out infinite alternate`,
    ],
    rich: { self: [`filter:drop-shadow(0 0 .5em ${g(28, i(3))})`] },
  },

  /* adapted from CSS Text Effects (MIT) — iridescent */
  irizat: {
    base: [
      `background-image:conic-gradient(from 20deg,${white(i(1), 80)},${i(3)},${white(i(2), 50)},${i(2)},${white(i(1), 60)},${white(i(1), 80)})`,
      "background-size:220% 220%",
      "background-position:50% 50%",
      ...CLIP,
      `animation:gcsNfxIris ${d(4.5)} linear infinite`,
    ],
  },

  /* adapted from CSS Text Effects (MIT) — glass */
  sticla: {
    base: [`color:${mix(i(1), 65)}`, `-webkit-text-stroke:max(.5px,.025em) ${mix(i(1), 60)}`, "display:inline-block", `animation:gcsNfxGlass ${d(3.4)} ease-in-out infinite`],
    rich: {
      before: [...TEXT_LAYER, `color:${i(3)}`, "opacity:.34", "filter:blur(.1em)", "transform:translate(.13em,.17em)"],
      after: [...TEXT_LAYER, "background:linear-gradient(115deg,transparent 22%,#fff 44%,transparent 62%) 110% 0/260% 100%", ...LAYER_CLIP, "opacity:.55", `animation:gcsNfxGlassSheen ${d(2.7)} ease-in-out infinite`],
    },
  },

  /* adapted from CSS Text Effects (MIT) — datastream */
  flux_date: {
    base: [
      `background-image:repeating-linear-gradient(0deg,${i(3)} 0 .07em,${mix(i(3), 45)} .07em .13em,${mix(i(3), 20)} .13em .27em),linear-gradient(90deg,${i(2)},${i(3)},${i(1)})`,
      "background-size:100% 1.07em,240% 100%",
      ...CLIP,
      `animation:gcsNfxStream ${d(1.6)} linear infinite`,
    ],
    rich: {
      after: [
        ...DECOR,
        'content:"0101 1100 0011"',
        'content:"0101 1100 0011" / ""',
        "opacity:1",
        "left:50%",
        "top:100%",
        "font-size:.42em",
        "font-weight:600",
        "letter-spacing:.16em",
        "white-space:nowrap",
        `color:${mix(i(3), 50)}`,
        "-webkit-text-fill-color:currentColor",
        "transform:translateX(-50%)",
        `animation:gcsNfxStreamCode ${d(1.6)} linear infinite`,
      ],
    },
  },

  /* adapted from CSS Text Effects (MIT) — prismcut */
  prisma: {
    base: [`color:${i(1)}`, `text-shadow:-.04em 0 ${g(45, i(2))},.04em 0 ${g(45, i(3))}`],
    rich: {
      before: [...TEXT_LAYER, `color:${i(2)}`, "clip-path:polygon(0 0,66% 0,46% 100%,0 100%)", `animation:gcsNfxPrismA ${d(3)} ease-in-out infinite`],
      after: [...TEXT_LAYER, `color:${i(3)}`, "clip-path:polygon(42% 0,100% 0,100% 100%,24% 100%)", `animation:gcsNfxPrismB ${d(3)} ease-in-out infinite`],
    },
  },

  /* adapted from CSS Text Effects (MIT) — laser */
  laser: {
    base: [`color:${i(1)}`, `text-shadow:0 0 .25em ${g(35, i(2))}`],
    rich: {
      before: [...TEXT_LAYER, `color:${i(2)}`, "clip-path:inset(44% 0 42% 0)", `text-shadow:0 0 .33em ${i(2)}`, `animation:gcsNfxLaserSlice ${d(2.2)} ease-in-out infinite`],
      after: [
        ...DECOR,
        "left:-8%",
        "top:49%",
        "width:116%",
        "height:max(1px,.06em)",
        `background:linear-gradient(90deg,transparent,#fff,${i(2)},transparent)`,
        `box-shadow:0 0 .43em ${g(100, i(2))}`,
        `animation:gcsNfxLaser ${d(2.2)} ease-in-out infinite`,
      ],
    },
  },

  /* adapted from CSS Text Effects (MIT) — microchip */
  microcip: {
    base: [
      `background-image:linear-gradient(90deg,transparent 0 44%,${i(3)} 44% 47%,transparent 47% 100%),linear-gradient(0deg,transparent 0 46%,${i(2)} 46% 49%,transparent 49% 100%),repeating-linear-gradient(90deg,${mix(i(3), 35)} 0 1px,transparent 1px .47em),linear-gradient(100deg,${i(1)},${i(3)})`,
      "background-size:1.4em 1.4em,1.4em 1.4em,.47em 100%,220% 100%",
      ...CLIP,
      `animation:gcsNfxChip ${d(3.8)} linear infinite`,
    ],
  },

  /* adapted from CSS Text Effects (MIT) — heatmap */
  termic: {
    base: [
      `background-image:radial-gradient(circle at 20% 50%,${white(i(1), 70)} 0 8%,transparent 24%),radial-gradient(circle at 70% 40%,${i(2)} 0 12%,transparent 28%),radial-gradient(circle at 44% 78%,${i(3)} 0 14%,transparent 32%),linear-gradient(90deg,#2D7DFF,#36F0B2,#FFCF4A,#FF4F8B)`,
      "background-size:130% 130%,150% 150%,140% 140%,260% 100%",
      ...CLIP,
      `animation:gcsNfxHeat ${d(3.5)} ease-in-out infinite alternate`,
    ],
  },

  /* adapted from CSS Text Effects (MIT) — signal */
  semnal: {
    base: [`color:${i(1)}`, `animation:gcsNfxSignal ${d(2)} steps(1) infinite`],
    rich: {
      before: [...TEXT_LAYER, `color:${i(2)}`, "clip-path:inset(0 0 58% 0)", "opacity:.15", `animation:gcsNfxSignalA ${d(2)} steps(1) infinite`],
      after: [...TEXT_LAYER, `color:${i(3)}`, "clip-path:inset(42% 0 0 0)", "opacity:.12", `animation:gcsNfxSignalB ${d(2)} steps(1) infinite`],
    },
  },

  /* adapted from CSS Text Effects (MIT) — portal */
  portal: {
    base: [`background-image:conic-gradient(from 0deg,${i(2)},${i(1)},${i(3)},${i(2)})`, ...CLIP, `animation:gcsNfxHue ${d(3.6)} linear infinite`],
    rich: {
      after: [...TEXT_LAYER, "background:radial-gradient(circle,transparent 0 30%,#fff 34% 36%,transparent 40% 100%)", ...LAYER_CLIP, "opacity:.72", `animation:gcsNfxPortalPulse ${d(1.8)} ease-in-out infinite`],
    },
  },

  /* adapted from CSS Text Effects (MIT) — duotone */
  duoton: {
    base: [`color:${i(1)}`, `text-shadow:-.06em 0 ${g(40, i(2))},.06em 0 ${g(40, i(3))}`],
    rich: {
      before: [...TEXT_LAYER, `color:${i(2)}`, "mix-blend-mode:screen", `animation:gcsNfxDuoA ${d(2.6)} ease-in-out infinite`],
      after: [...TEXT_LAYER, `color:${i(3)}`, "mix-blend-mode:screen", `animation:gcsNfxDuoB ${d(2.6)} ease-in-out infinite`],
    },
  },

  /* adapted from CSS Text Effects (MIT) — eclipse */
  eclipsa: {
    base: [`color:${i(1)}`, `text-shadow:0 0 .3em ${g(70, i(2))},0 0 .8em ${g(40, i(2))}`, `animation:gcsNfxEclipseDim ${d(5)} ease-in-out infinite`],
    rich: {
      after: [
        ...DECOR,
        "opacity:1",
        "top:50%",
        "left:-1.5em",
        "width:1.3em",
        "height:1.3em",
        "border-radius:50%",
        "background:#05040C",
        `box-shadow:0 0 .3em .06em ${g(85, i(2))},inset -.13em -.1em .27em rgba(0,0,0,.9)`,
        "transform:translateY(-50%)",
        `animation:gcsNfxEclipse ${d(5)} ease-in-out infinite`,
      ],
    },
  },

  /* adapted from CSS Text Effects (MIT) — lightleak */
  voal: {
    base: [`color:${i(1)}`, `text-shadow:0 0 .3em ${g(35, i(2))}`],
    rich: {
      self: ["isolation:isolate"],
      before: [
        ...TEXT_LAYER,
        `background:linear-gradient(118deg,transparent 12%,${i(2)} 34%,${white(i(2), 50)} 44%,#fff 48%,transparent 62%) 120% 0/240% 100%`,
        ...LAYER_CLIP,
        "mix-blend-mode:screen",
        `animation:gcsNfxLeakA ${d(4.4)} ease-in-out infinite`,
      ],
      after: [...TEXT_LAYER, `background:linear-gradient(248deg,transparent 18%,${i(3)} 38%,${i(2)} 48%,transparent 68%) -20% 0/240% 100%`, ...LAYER_CLIP, "mix-blend-mode:screen", `animation:gcsNfxLeakB ${d(5.6)} ease-in-out infinite`],
    },
  },

  /* adapted from CSS Text Effects (MIT) — marble */
  marmura: {
    base: [
      `background-image:radial-gradient(ellipse 40% 70% at 18% 42%,${mix(i(1), 55)} 0%,transparent 55%),radial-gradient(ellipse 50% 40% at 72% 58%,${mix(i(3), 40)} 0%,transparent 50%),linear-gradient(118deg,#F4F0EA 0%,#D9D2C8 14%,${i(2)} 22%,#EBE6DF 34%,${i(3)} 48%,#CFC7BB 58%,#F7F3ED 72%,${i(1)} 86%,#E8E2D8 100%)`,
      "background-size:160% 160%,180% 180%,280% 100%",
      ...CLIP,
      // Pe tema deschisă (`--nfx-dk: 0`), un contur fin: piatra albă rămâne lizibilă pe fundal alb.
      "-webkit-text-stroke:max(.4px,.02em) color-mix(in srgb,#000 calc((1 - var(--nfx-dk,1))*40%),transparent)",
      `animation:gcsNfxMarble ${d(5.2)} ease-in-out infinite alternate`,
    ],
  },

  /* adapted from CSS Text Effects (MIT) — ripple */
  unde: {
    base: [`color:color-mix(in srgb,${i(3)} 55%,${i(1)})`],
    rich: {
      before: [
        ...TEXT_LAYER,
        `background:repeating-radial-gradient(circle at 50% 55%,transparent 0 .2em,${white(i(3), 40)} .23em .3em,transparent .33em .53em)`,
        ...LAYER_CLIP,
        "opacity:.9",
        `animation:gcsNfxRings ${d(2.4)} linear infinite`,
      ],
      after: [
        ...TEXT_LAYER,
        `background:repeating-radial-gradient(circle at 50% 55%,transparent 0 .27em,${i(2)} .3em .37em,transparent .4em .67em)`,
        ...LAYER_CLIP,
        "opacity:.55",
        "mix-blend-mode:screen",
        `animation:gcsNfxRings ${d(2.4)} linear infinite reverse`,
      ],
    },
  },

  /* adapted from CSS Text Effects (MIT) — shimmer */
  fantoma: {
    base: [
      `background-image:linear-gradient(90deg,${mix(i(1), 40)} 0 40%,${mix(i(1), 70)} 46%,${white(i(1), 90)} 50%,${mix(i(1), 70)} 54%,${mix(i(1), 40)} 60% 100%)`,
      "background-size:300% 100%",
      ...CLIP,
      `animation:gcsNfxGhost ${d(2.8)} linear infinite`,
    ],
  },

  /* adapted from CSS Text Effects (MIT) — lenticular */
  lenticular: {
    base: [
      `background-image:repeating-linear-gradient(90deg,rgb(255 255 255/.28) 0 1px,transparent 1px 3px),linear-gradient(115deg,${i(2)} 0%,${white(i(1), 85)} 18%,${i(3)} 36%,${white(i(1), 50)} 52%,${i(2)} 70%,${white(i(1), 85)} 86%,${i(3)} 100%)`,
      "background-size:4px 100%,240% 100%",
      "background-position:0 0,120% 0",
      ...CLIP,
      "display:inline-block",
      `animation:gcsNfxLenti ${d(2.8)} ease-in-out infinite alternate`,
    ],
    rich: {
      before: [
        ...TEXT_LAYER,
        `color:${i(2)}`,
        "-webkit-mask-image:repeating-linear-gradient(90deg,#000 0 2px,transparent 2px 4px)",
        "mask-image:repeating-linear-gradient(90deg,#000 0 2px,transparent 2px 4px)",
        `animation:gcsNfxLentiA ${d(2.8)} ease-in-out infinite alternate`,
      ],
      after: [
        ...TEXT_LAYER,
        `color:${i(3)}`,
        "-webkit-mask-image:repeating-linear-gradient(90deg,transparent 0 2px,#000 2px 4px)",
        "mask-image:repeating-linear-gradient(90deg,transparent 0 2px,#000 2px 4px)",
        `animation:gcsNfxLentiB ${d(2.8)} ease-in-out infinite alternate`,
      ],
    },
  },

  /* adapted from CSS Text Effects (MIT) — caustic */
  caustic: {
    base: [
      `background-image:radial-gradient(ellipse 55% 35% at 18% 42%,#fff 0 8%,transparent 42%),radial-gradient(ellipse 45% 50% at 68% 58%,${white(i(3), 30)} 0 10%,transparent 46%),radial-gradient(ellipse 40% 30% at 42% 78%,#fff 0 6%,transparent 40%),radial-gradient(ellipse 50% 40% at 82% 28%,${white(i(2), 40)} 0 9%,transparent 44%),linear-gradient(165deg,color-mix(in srgb,${i(3)} 70%,${i(1)}) 0%,${i(1)} 42%,color-mix(in srgb,${i(2)} 55%,${i(1)}) 100%)`,
      "background-size:160% 160%,180% 170%,150% 150%,170% 160%,100% 100%",
      ...CLIP,
      `animation:gcsNfxCaustic ${d(4.2)} ease-in-out infinite alternate`,
    ],
    rich: { self: [`filter:drop-shadow(0 0 .35em ${g(45, i(3))})`] },
  },

  // ─── Pe litere ───

  /* adapted from CSS Text Effects (MIT) — magnetic */
  magnetic: {
    base: [`color:${i(1)}`],
    letter: [`animation:gcsNfxMagnet ${d(2.7)} ease-in-out infinite`, "animation-delay:calc(var(--i)*.07s)"],
    letterNth: { odd: [`color:${i(3)}`] },
  },

  /* adapted from CSS Text Effects (MIT) — wave */
  val_litere: {
    base: [`color:${i(1)}`, `text-shadow:0 0 .3em ${g(35)}`],
    rich: { self: RICH_AMP },
    letter: [`animation:gcsNfxWave ${d(1.3)} ease-in-out infinite`, "animation-delay:calc(var(--i)*-.14s)"],
  },

  /* adapted from CSS Text Effects (MIT) — loader (o undă de lumină trece prin literele estompate) */
  unda: {
    base: [`color:${mix(i(1), 45)}`],
    rich: {
      self: RICH_AMP,
      after: [
        ...DECOR,
        "opacity:1",
        "left:0",
        "right:0",
        "bottom:-.18em",
        "height:.08em",
        "border-radius:.08em",
        `background:linear-gradient(90deg,${i(2)},${i(3)}) 0 0/0% 100% no-repeat,${mix(i(1), 14)}`,
        `animation:gcsNfxBar ${d(3.2)} cubic-bezier(.6,0,.4,1) infinite`,
      ],
    },
    letter: [`animation:gcsNfxBright ${d(1.6)} ease-in-out infinite`, "animation-delay:calc(var(--i)*.1s)"],
  },

  /* adapted from CSS Text Effects (MIT) — focus */
  focus: {
    base: [`color:${i(1)}`],
    letter: [`animation:gcsNfxFade ${d(2.6)} ease-in-out infinite`, "animation-delay:calc(var(--i)*.18s)"],
    letterRich: [`animation:gcsNfxFocus ${d(2.6)} ease-in-out infinite`, "animation-delay:calc(var(--i)*.18s)"],
  },

  /* adapted from CSS Text Effects (MIT) — spectrum (fiecare literă trece prin culorile variantei) */
  spectru: {
    base: [`color:${i(1)}`],
    letter: [`animation:gcsNfxSpectrum ${d(2.4)} linear infinite`, "animation-delay:calc(var(--i)*-.25s)"],
  },

  /* adapted from CSS Text Effects (MIT) — pop */
  pop: {
    base: [`color:${i(1)}`],
    rich: { self: RICH_AMP },
    letter: [`animation:gcsNfxPop ${d(1.5)} cubic-bezier(.3,1.6,.4,1) infinite`, "animation-delay:calc(var(--i)*.09s)"],
  },

  /* adapted from CSS Text Effects (MIT) — melt */
  topire: {
    base: [`color:${i(1)}`],
    letter: ["transform-origin:50% 0", `animation:gcsNfxMelt ${d(2.8)} ease-in infinite`, "animation-delay:calc(var(--i)*.22s)"],
    letterNth: { even: [`color:${i(2)}`] },
  },

  /* adapted from CSS Text Effects (MIT) — kinetic */
  cinetic: {
    base: [`color:${i(1)}`],
    rich: { self: RICH_AMP },
    letter: [`animation:gcsNfxKinetic ${d(2.6)} cubic-bezier(.2,.8,.2,1) infinite`, "animation-delay:calc(var(--i)*.08s)"],
    letterNth: { "2n": [`color:${i(3)}`], "3n": [`color:${i(2)}`] },
  },

  /* adapted from CSS Text Effects (MIT) — orbit */
  orbite: {
    base: [`color:${i(1)}`],
    rich: { self: RICH_AMP },
    letter: ["transform-origin:50% 120%", `animation:gcsNfxOrbit2 ${d(2.8)} cubic-bezier(.45,0,.2,1) infinite`, "animation-delay:calc(var(--i)*-.18s)"],
    letterNth: { odd: [`color:${i(3)}`], "3n": [`color:${i(2)}`] },
  },

  /* adapted from CSS Text Effects (MIT) — parallax */
  paralaxa: {
    base: [`color:${i(1)}`],
    letter: [`animation:gcsNfxParallax ${d(3)} ease-in-out infinite`, "animation-delay:calc(var(--i)*-.11s)"],
  },

  /* adapted from CSS Text Effects (MIT) — glyphrain */
  ploaie_litere: {
    base: [`color:${i(1)}`],
    rich: { self: RICH_AMP },
    letter: [`animation:gcsNfxGlyphRain ${d(2.4)} cubic-bezier(.25,.8,.25,1) infinite`, "animation-delay:calc(var(--i)*.12s)"],
    letterRich: [`text-shadow:0 -.28em 0 ${mix(i(3), 30)},0 -.56em 0 ${mix(i(2), 14)}`],
    letterNth: { even: [`color:${i(3)}`] },
  },

  /* adapted from CSS Text Effects (MIT) — zoetrope */
  zootrop: {
    base: [`color:${i(1)}`],
    letter: [`animation:gcsNfxZoetrope ${d(3)} cubic-bezier(.55,0,.25,1) infinite`, "animation-delay:calc(var(--i)*.09s)"],
    letterNth: { "3n": [`color:${i(2)}`], "3n+1": [`color:${i(3)}`] },
  },

  /* adapted from CSS Text Effects (MIT) — pendulum */
  pendul: {
    base: [`color:${i(1)}`],
    letter: ["transform-origin:50% -80%", `animation:gcsNfxPendulum ${d(1.8)} ease-in-out infinite`, "animation-delay:calc(var(--i)*-.12s)"],
    letterNth: { even: [`color:${i(3)}`] },
  },

  /* adapted from CSS Text Effects (MIT) — smoke */
  fum: {
    base: [`color:${i(1)}`],
    letter: [`animation:gcsNfxSmoke ${d(3.4)} ease-in-out infinite`, "animation-delay:calc(var(--i)*.16s)"],
  },

  /* adapted from CSS Text Effects (MIT) — voltage */
  kilovolt: {
    base: [`color:${i(1)}`],
    letter: [`animation:gcsNfxVoltage ${d(2.6)} steps(1) infinite`, "animation-delay:calc(var(--i)*.08s)"],
  },

  /* adapted from CSS Text Effects (MIT) — shatter */
  spargere: {
    base: [`color:${i(1)}`],
    letter: ["transform-origin:50% 60%", `animation:gcsNfxFracture ${d(3.2)} cubic-bezier(.22,1.15,.36,1) infinite`, "animation-delay:calc(var(--i)*.07s)"],
  },

  /* adapted from CSS Text Effects (MIT) — karaoke */
  karaoke: {
    base: [`color:${mix(i(1), 50)}`],
    rich: { self: RICH_AMP },
    letter: [
      `background:linear-gradient(180deg,${white(i(1), 80)} 0%,${i(2)} 42%,${i(3)} 100%) no-repeat 0 0/0% 100%`,
      "-webkit-background-clip:text",
      "background-clip:text",
      `animation:gcsNfxKaraoke ${d(4.4)} cubic-bezier(.2,.85,.25,1) infinite`,
      "animation-delay:calc(var(--i)*.28s)",
    ],
  },

  /* adapted from CSS Text Effects (MIT) — groovy */
  retro: {
    base: [`color:${white(i(1), 40)}`, "display:inline-block", "transform:skewX(-8deg)"],
    letter: [groovy(0.03), `animation:gcsNfxGroovy ${d(3.2)} cubic-bezier(.45,0,.3,1) infinite`, "animation-delay:calc(var(--i)*.1s)"],
  },

  /* adapted from CSS Text Effects (MIT) — gooey */
  mercur: {
    base: [`color:${i(1)}`],
    letter: [
      `background:linear-gradient(185deg,${white(i(1), 85)} 8%,${i(3)} 34%,${white(i(1), 60)} 50%,${i(2)} 72%,${black(i(1), 30)} 100%) 0 0/100% 190%`,
      "-webkit-background-clip:text",
      "background-clip:text",
      "color:transparent",
      "transform-origin:50% 100%",
      `animation:gcsNfxGooey ${d(3.4)} cubic-bezier(.45,.06,.28,1) infinite`,
      "animation-delay:calc(var(--i)*.06s)",
    ],
  },
};

/** Cadrele-cheie ale efectelor text (cele comune, ca `gcsNfxSheen`, sunt în `nameEffects.ts`). */
export const TEXT_KEYFRAMES = [
  "@keyframes gcsNfxBoreal{0%{background-position:0% 50%;filter:hue-rotate(0deg)}100%{background-position:300% 50%;filter:hue-rotate(360deg)}}",
  "@keyframes gcsNfxHue{to{filter:hue-rotate(360deg)}}",
  "@keyframes gcsNfxLiquid{0%,100%{background-position:0 -110%}50%{background-position:0 10%}}",
  "@keyframes gcsNfxFlareSheen{0%,20%{background-position:150% 0,0 0}60%,100%{background-position:-50% 0,0 0}}",
  "@keyframes gcsNfxFlare{0%,20%{left:0;opacity:0;transform:scale(.4) rotate(0)}35%{opacity:1;transform:scale(1) rotate(45deg)}50%{opacity:1;transform:scale(.7) rotate(90deg)}60%,100%{left:100%;opacity:0;transform:scale(.3) rotate(135deg)}}",
  "@keyframes gcsNfxJolt{0%,21%,24%,100%{transform:none}22%{transform:skewX(-8deg) translateX(-.04em)}23%{transform:skewX(6deg) translateX(.03em)}}",
  "@keyframes gcsNfxSignalA{0%,20%,52%,100%{transform:translate(0);opacity:.15}23%{transform:translate(-.26em,-.03em);opacity:.9}54%{transform:translate(.17em,.07em);opacity:.7}}",
  "@keyframes gcsNfxSignalB{0%,24%,58%,100%{transform:translate(0);opacity:.12}27%{transform:translate(.26em,.03em);opacity:.86}60%{transform:translate(-.17em,-.07em);opacity:.72}}",
  `@keyframes gcsNfxVoid{0%,100%{text-shadow:0 0 .06em ${g(95)},0 0 .25em ${g(70)},0 0 .6em ${g(35)}}50%{text-shadow:0 0 .08em ${g(100)},0 0 .4em ${g(95)},0 0 1em ${g(60)}}}`,
  "@keyframes gcsNfxScanGlow{0%{background-position:100% 0}100%{background-position:0% 0}}",
  "@keyframes gcsNfxScanBar{0%{left:0;transform:translateX(0)}100%{left:100%;transform:translateX(-100%)}}",
  `@keyframes gcsNfxEmberGlow{0%{text-shadow:0 -.07em .2em ${g(90, i(1))},0 -.2em .45em ${g(80, i(2))},0 -.4em .9em ${g(60, i(3))}}100%{text-shadow:0 -.1em .27em ${g(95, i(1))},0 -.3em .65em ${g(90, i(2))},0 -.6em 1.25em ${g(75, i(3))}}}`,
  "@keyframes gcsNfxEcho{0%{opacity:.8;transform:scale(1);filter:blur(0)}100%{opacity:0;transform:scale(1.6);filter:blur(.08em)}}",
  `@keyframes gcsNfxSlicedTop{0%,22%,78%,100%{transform:translateX(0);color:${i(1)}}38%,62%{transform:translateX(.27em);color:${i(2)}}}`,
  `@keyframes gcsNfxSlicedBot{0%,22%,78%,100%{transform:translateX(0);color:${i(1)}}38%,62%{transform:translateX(-.27em);color:${i(3)}}}`,
  "@keyframes gcsNfxTremor{0%,7%,15%,55%,100%{transform:none;opacity:1}8%{transform:skewX(-14deg) translateX(-.13em)}10%{transform:skewX(10deg) translateX(.1em)}12%{transform:translateY(-.1em);opacity:.6}46%{transform:skewX(8deg)}48%{transform:skewX(-6deg) translateY(.07em);opacity:.75}50%{transform:translateX(.07em)}}",
  `@keyframes gcsNfxAnaglyph{0%,100%{text-shadow:0 0 0 ${i(2)},0 0 0 ${i(3)}}50%{text-shadow:-.2em 0 .03em ${mix(i(2), 85)},.2em 0 .03em ${mix(i(3), 85)}}}`,
  "@keyframes gcsNfxCrt{0%,6%,100%{opacity:1}3%{opacity:.82}4.5%{opacity:.95}70%{opacity:.9}71%{opacity:1}}",
  "@keyframes gcsNfxCrtRoll{to{background-position:0 1.6em}}",
  "@keyframes gcsNfxSpot{0%{background-position:100% 0}100%{background-position:0% 0}}",
  "@keyframes gcsNfxElastic{0%,100%{transform:scale(1,1)}28%{transform:scale(1.18,.82)}44%{transform:scale(.86,1.14)}60%{transform:scale(1.08,.94)}74%{transform:scale(.97,1.03)}86%{transform:scale(1.01,.99)}}",
  `@keyframes gcsNfxHeart{0%,100%{transform:scale(1);text-shadow:0 0 0 transparent}14%{transform:scale(1.1);text-shadow:0 0 .6em ${g(65)}}28%{transform:scale(1)}42%{transform:scale(1.12);text-shadow:0 0 .85em ${g(80)}}70%{transform:scale(1);text-shadow:0 0 0 transparent}}`,
  "@keyframes gcsNfxMarker{0%{background-size:0% 46%;background-position:0 62%}38%,62%{background-size:100% 46%;background-position:0 62%}100%{background-size:0% 46%;background-position:100% 62%}}",
  sundial(),
  "@keyframes gcsNfxHoloFloat{0%,100%{transform:translateY(.07em) skewX(0deg);filter:brightness(1)}50%{transform:translateY(-.13em) skewX(-3deg);filter:brightness(1.35)}}",
  "@keyframes gcsNfxHoloSplit{0%,14%,40%,72%,100%{transform:translateX(0);opacity:.22}15%{transform:translateX(-.17em);opacity:.8}17%{transform:translateX(.13em);opacity:.6}74%{transform:translateX(.1em);opacity:.7}}",
  "@keyframes gcsNfxHoloLines{to{background-position:0 .4em}}",
  "@keyframes gcsNfxFoil{0%,100%{background-position:115% 0}45%{background-position:-35% 0}}",
  "@keyframes gcsNfxPixelA{0%,20%,54%,100%{transform:translate(0)}22%{transform:translate(.23em,-.07em)}24%{transform:translate(-.13em,.03em)}56%{transform:translate(.17em,.07em)}58%{transform:translate(-.23em,0)}}",
  "@keyframes gcsNfxPixelB{0%,18%,58%,100%{transform:translate(0)}19%{transform:translate(-.2em,.07em)}21%{transform:translate(.13em,-.03em)}60%{transform:translate(-.17em,-.07em)}63%{transform:translate(.2em,.03em)}}",
  "@keyframes gcsNfxStarlight{0%{background-position:0 0,0 0,0 0,120% 0}100%{background-position:4em 0,-5em 0,6em 0,-120% 0}}",
  "@keyframes gcsNfxVaporMain{0%,100%{transform:translateX(-.1em)}50%{transform:translateX(.1em)}}",
  "@keyframes gcsNfxVaporA{0%,100%{transform:translate(-.33em,.2em) scaleX(1.08);opacity:.22}50%{transform:translate(-.6em,-.13em) scaleX(1.22);opacity:.58}}",
  "@keyframes gcsNfxVaporB{0%,100%{transform:translate(.33em,-.17em) scaleX(1.08);opacity:.2}50%{transform:translate(.6em,.17em) scaleX(1.2);opacity:.56}}",
  "@keyframes gcsNfxMesh{0%{background-position:0% 20%,100% 10%,35% 100%,100% 0}100%{background-position:100% 80%,0% 60%,70% 0%,-100% 0}}",
  "@keyframes gcsNfxIris{to{filter:hue-rotate(360deg);background-position:120% 50%}}",
  "@keyframes gcsNfxGlass{50%{transform:translateY(-.1em)}}",
  "@keyframes gcsNfxGlassSheen{to{background-position:-110% 0}}",
  "@keyframes gcsNfxStream{to{background-position:0 1.07em,-120% 0}}",
  "@keyframes gcsNfxStreamCode{0%{opacity:.2;transform:translate(-50%,-.07em)}50%{opacity:.7}100%{opacity:.2;transform:translate(-50%,.33em)}}",
  "@keyframes gcsNfxPrismA{0%,100%{transform:translate(0);opacity:.35}50%{transform:translate(-.23em,-.07em);opacity:.85}}",
  "@keyframes gcsNfxPrismB{0%,100%{transform:translate(0);opacity:.35}50%{transform:translate(.23em,.07em);opacity:.85}}",
  "@keyframes gcsNfxLaser{0%,100%{transform:translateY(-.47em) scaleX(.35);opacity:0}44%,58%{transform:translateY(0) scaleX(1);opacity:1}}",
  "@keyframes gcsNfxLaserSlice{0%,100%{transform:translateX(0);opacity:.2}50%{transform:translateX(.17em);opacity:1}}",
  "@keyframes gcsNfxChip{to{background-position:1.4em 0,0 1.4em,.47em 0,-120% 0}}",
  "@keyframes gcsNfxHeat{0%{background-position:0 0,100% 20%,40% 100%,100% 0}100%{background-position:100% 90%,0 60%,80% 0,-100% 0}}",
  "@keyframes gcsNfxSignal{0%,21%,47%,100%{filter:none}22%,24%{filter:blur(.03em) contrast(1.4)}}",
  "@keyframes gcsNfxPortalPulse{0%,100%{transform:scale(.92);opacity:.24}50%{transform:scale(1.08);opacity:.8}}",
  "@keyframes gcsNfxDuoA{0%,100%{transform:translate(-.08em,0);opacity:.42}50%{transform:translate(-.23em,-.08em);opacity:.8}}",
  "@keyframes gcsNfxDuoB{0%,100%{transform:translate(.08em,0);opacity:.42}50%{transform:translate(.23em,.08em);opacity:.8}}",
  "@keyframes gcsNfxEclipse{0%{left:-1.5em}50%{left:calc(50% - .65em)}100%{left:100%}}",
  "@keyframes gcsNfxEclipseDim{0%,28%,72%,100%{filter:brightness(1)}50%{filter:brightness(.4)}}",
  "@keyframes gcsNfxLeakA{0%,100%{background-position:130% 0;opacity:.12}42%{background-position:-30% 0;opacity:1}}",
  "@keyframes gcsNfxLeakB{0%,100%{background-position:-30% 0;opacity:.1}55%{background-position:130% 0;opacity:.95}}",
  "@keyframes gcsNfxMarble{0%{background-position:8% 30%,90% 70%,0% 50%}100%{background-position:78% 68%,12% 22%,100% 50%}}",
  "@keyframes gcsNfxRings{0%{background-size:40% 40%;background-position:50% 55%;opacity:.35}70%{opacity:.95}100%{background-size:220% 220%;background-position:50% 55%;opacity:.15}}",
  "@keyframes gcsNfxGhost{to{background-position:300% 0}}",
  "@keyframes gcsNfxLenti{from{transform:perspective(15em) rotateY(-14deg);background-position:0 0,120% 0}to{transform:perspective(15em) rotateY(14deg);background-position:0 0,-20% 0}}",
  "@keyframes gcsNfxLentiA{from{transform:translateX(-.1em);opacity:.4}to{transform:translateX(.13em);opacity:.85}}",
  "@keyframes gcsNfxLentiB{from{transform:translateX(.1em);opacity:.85}to{transform:translateX(-.13em);opacity:.35}}",
  "@keyframes gcsNfxCaustic{0%{background-position:0% 25%,100% 80%,35% 100%,90% 5%,0 0}100%{background-position:85% 70%,5% 15%,70% 0%,15% 90%,0 0}}",
  // Pe litere.
  `@keyframes gcsNfxMagnet{0%,100%{transform:translateX(0) scale(1);text-shadow:0 0 0 transparent}42%{transform:translateX(calc(${iClamp(3)}*-.07em)) scale(1.12);text-shadow:0 0 .5em ${g(70, i(2))}}62%{transform:translateX(calc(${iClamp(3)}*.1em)) scale(.96)}}`,
  `@keyframes gcsNfxWave{0%,100%{transform:translateY(${amp(1)})}50%{transform:translateY(${amp(-1)})}}`,
  `@keyframes gcsNfxBright{0%,40%,100%{transform:translateY(0);color:${mix(i(1), 45)};text-shadow:none}20%{transform:translateY(${amp(-1.2)});color:${white(i(1), 25)};text-shadow:0 0 .4em ${g(60, i(3))}}}`,
  "@keyframes gcsNfxBar{0%{background-size:0% 100%,auto}85%,92%{background-size:100% 100%,auto;opacity:1}100%{background-size:100% 100%,auto;opacity:0}}",
  "@keyframes gcsNfxFade{0%,100%{opacity:1}50%{opacity:.35}}",
  "@keyframes gcsNfxFocus{0%,100%{filter:blur(0);opacity:1}50%{filter:blur(.12em);opacity:.4}}",
  `@keyframes gcsNfxSpectrum{0%,100%{color:${i(1)}}20%{color:${i(2)}}40%{color:${i(3)}}60%{color:${i(4)}}80%{color:${i(5)}}}`,
  `@keyframes gcsNfxPop{0%,55%,100%{transform:translateY(0);text-shadow:0 0 0 ${i(2)}}25%{transform:translateY(${amp(-2)}) rotate(-4deg);text-shadow:0 ${amp(2)} 0 ${mix(i(2), 85)}}}`,
  "@keyframes gcsNfxMelt{0%,45%{transform:scaleY(1) translateY(0)}70%{transform:scaleY(1.4) translateY(.15em) scaleX(.92)}85%,100%{transform:scaleY(1) translateY(0)}}",
  `@keyframes gcsNfxKinetic{0%,18%{transform:translateY(0) rotate(0)}34%{transform:translateY(${amp(-1.8)}) rotate(-9deg)}52%{transform:translateY(${amp(1.3)}) rotate(7deg)}68%,100%{transform:translateY(0) rotate(0)}}`,
  `@keyframes gcsNfxOrbit2{0%,100%{transform:translate(0,0) rotate(0)}35%{transform:translate(.17em,${amp(-2.2)}) rotate(16deg)}70%{transform:translate(-.17em,${amp(1)}) rotate(-10deg)}}`,
  `@keyframes gcsNfxParallax{0%,100%{transform:translate(0);text-shadow:.13em .13em 0 ${mix(i(2), 72)},-.13em -.1em 0 ${mix(i(3), 72)}}50%{transform:translateY(-.13em);text-shadow:.27em .07em 0 ${mix(i(2), 72)},-.27em -.03em 0 ${mix(i(3), 72)}}}`,
  `@keyframes gcsNfxGlyphRain{0%,100%{transform:translateY(0);opacity:1}38%{transform:translateY(${amp(2.4)});opacity:.22}64%{transform:translateY(${amp(-1)});opacity:.75}}`,
  "@keyframes gcsNfxZoetrope{0%,12%{transform:perspective(16em) rotateY(0)}62%,100%{transform:perspective(16em) rotateY(360deg)}}",
  "@keyframes gcsNfxPendulum{0%,100%{transform:rotate(10deg)}50%{transform:rotate(-10deg)}}",
  `@keyframes gcsNfxSmoke{0%,42%{transform:none;opacity:1;color:${i(1)}}62%{color:${i(3)}}78%{transform:translate(.2em,-.7em) rotate(14deg) scale(1.4);opacity:0}79%{transform:translateY(.33em) scale(.8);opacity:0}92%,100%{transform:none;opacity:1}}`,
  `@keyframes gcsNfxVoltage{0%,100%{transform:none;color:${i(1)};text-shadow:none;filter:brightness(1)}7%{transform:translate(.03em,-.03em) skewX(-10deg);color:${white(i(1), 80)};text-shadow:0 0 .13em #fff,0 0 .47em ${i(3)},.07em 0 0 ${i(2)},-.07em 0 0 ${i(3)};filter:brightness(1.85)}9%{transform:translate(-.03em,.03em) skewX(8deg);color:${i(3)};text-shadow:0 0 .33em ${i(3)},0 0 .73em ${mix(i(3), 70)}}11%,48%{transform:none;color:${i(1)};text-shadow:none;filter:brightness(1)}61%{transform:translate(0,-.03em) skewX(4deg);color:${white(i(1), 80)};text-shadow:0 0 .2em ${i(2)},0 0 .6em ${i(2)},-.03em 0 0 ${i(3)};filter:brightness(1.6)}63%{transform:none;color:${i(1)};text-shadow:none;filter:brightness(1)}}`,
  `@keyframes gcsNfxFracture{0%,18%{transform:none;opacity:1;color:${i(1)}}28%{transform:translate(calc(${iClamp(2.5)}*.3em),calc(-.5em - ${iClamp(0)}*.05em)) rotate(calc(${iClamp(2.5)}*18deg)) scale(.88);opacity:.55;color:${i(2)}}38%{transform:translate(calc(${iClamp(2.5)}*.45em),.3em) rotate(calc(${iClamp(2.5)}*-12deg)) scale(1.05);opacity:.25}48%{transform:translate(0,-.2em) scale(1.08);opacity:0}49%{transform:scale(.7);opacity:0;color:${i(3)}}62%,100%{transform:none;opacity:1;color:${i(1)}}}`,
  `@keyframes gcsNfxKaraoke{0%,6%{background-size:0% 100%;transform:translateY(0) scale(1);color:${mix(i(1), 50)}}14%{background-size:100% 100%;transform:translateY(${amp(-1.5)}) scale(1.12);color:transparent}22%,64%{background-size:100% 100%;transform:none;color:transparent}78%,100%{background-size:0% 100%;transform:none;color:${mix(i(1), 50)}}}`,
  `@keyframes gcsNfxGroovy{0%,100%{transform:translate(0,0);${groovy(0.03)}}35%,65%{transform:translate(-.1em,-.17em);${groovy(0.1)}}}`,
  `@keyframes gcsNfxGooey{0%,16%,100%{transform:translateX(0) scale(1,1);background-position:50% 0%}44%,54%{transform:translateX(calc(${iClamp(3)}*-.17em)) scale(1.14,.7);background-position:50% 90%}}`,
];
