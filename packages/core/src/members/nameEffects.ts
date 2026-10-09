/**
 * Efectele numelui (capabilitatea `appearance`): o listă albă de efecte originale GCS, fiecare definită o singură dată
 * aici și aplicată în două feluri, din același text CSS:
 * - pe numele membrilor care l-au ales (selectorii lor, în `/gcs-names.css`);
 * - pe clasele de previzualizare `.gcs-nfx.gcs-nfx--<efect>` (studioul unui plugin), cu culorile ca variabile CSS
 *   (`--nfx-c1` … `--nfx-c5`, `--nfx-gc`, `--nfx-sp`, `--nfx-glow`), singurele lucruri pe care le alege pluginul.
 *
 * Culorile vin doar din `#RRGGBB` validate; nimic din CSS nu vine de la plugin. Pe tema deschisă, culorile se închid
 * automat (cerneala `--nfx-i*`), ca numele să rămână lizibile. Animațiile folosesc doar transform, opacity,
 * background-position, clip-path, mask și text-shadow, pe elemente mici; sub `prefers-reduced-motion` totul se oprește
 * și rămâne aspectul static (gândit să arate bine și fără mișcare).
 *
 * Decorațiile (straturi cu textul dublat, particule, iconițe) apar doar în locurile „mari”: profilul, postbit-ul,
 * hover card-ul, meniul userului și previzualizările. În liste (subiecte, membri online, widget-uri) numele are doar
 * culoarea și animația ușoară a efectului, ca paginile dense să rămână calme și ieftine. Fiecare nume are cel mult două
 * pseudo-elemente (`::before`, `::after`), fără evenimente de mouse, poziționate absolut (nu mută nimic din pagină).
 */

import { NAME_SCOPE } from "./memberName";
import { TEXT_EFFECTS, TEXT_FX, TEXT_KEYFRAMES } from "./nameEffectsText";
import { black, cycle, d, DECOR, dots, dropGlow, g, gc, GRAD_TEXT, i, sheen, TEXT_LAYER, white, type Fx } from "./nameFxKit";

/** Efectele originale (până la categoria „Efecte text”). */
const CORE_EFFECTS = [
  "none",
  "gradient",
  "shimmer",
  "pulse",
  "neon",
  "glitch",
  "scan",
  "chrome",
  "fire",
  "holo",
  "caret",
  "inferno",
  "typewriter",
  "reveal",
  "shatter",
  "citylights",
  "cosmic",
  "crosshair",
  "love",
  "electric",
  "mirror",
  "lightning",
  "money",
  "razor",
  "shadowdance",
  "toxic",
  "vscan",
  "gold",
  "aura",
  "matrix",
  "frost",
  "plasma",
  "outline",
  "extrude",
] as const;
/** Lista albă a efectelor: cele originale și categoria „Efecte text” (`nameEffectsText.ts`). */
export const NAME_EFFECTS = [...CORE_EFFECTS, ...TEXT_EFFECTS] as const;
export type GcsNameEffect = (typeof NAME_EFFECTS)[number];

// ─── Efectele ───

const CORE_FX: Record<(typeof CORE_EFFECTS)[number], Fx> = {
  none: { base: [] },

  /** Gradient fix (fără mișcare): numele cu mai multe culori și fără efect. */
  gradient: { base: [...GRAD_TEXT, "background-size:100% 100%"] },

  /** Curgere de culoare: gradientul alunecă prin litere. */
  shimmer: {
    base: [...GRAD_TEXT, `animation:gcsNfxFlow ${d(3.6)} linear infinite`],
    rich: { self: [dropGlow(5, 35)] },
  },

  /** Respirație: strălucirea crește și scade încet. */
  pulse: {
    base: [`color:${white(i(1), 12)}`, `animation:gcsNfxBreath ${d(2.6)} ease-in-out infinite,${cycle(8)}`],
  },

  /** Tub de neon: miez aproape alb, halou în trei straturi și pâlpâirea unui tub care bâzâie. */
  neon: {
    base: [
      `color:${white(i(1), 55)}`,
      `text-shadow:0 0 1px var(--nfx-cyg,${white(i(1), 70)}),0 0 4px ${gc(95)},0 0 11px ${gc(80)},0 0 22px ${gc(55)},0 0 38px ${gc(30)}`,
      `animation:gcsNfxFlicker ${d(5.5)} linear infinite,${cycle(8)}`,
    ],
  },

  /** Glitch RGB: straturi decalate (roșu / albastru), felii care sar și un tremur scurt. */
  glitch: {
    base: [`color:${i(1)}`, `animation:gcsNfxGlitchShadow ${d(3.2)} steps(1) infinite`, `text-shadow:.06em 0 ${g(70, i(2))},-.06em 0 ${g(70, i(3))}`],
    rich: {
      self: ["display:inline-block", `animation:gcsNfxGlitchShadow ${d(3.2)} steps(1) infinite,gcsNfxJitter ${d(3.2)} steps(1) infinite`],
      before: [...TEXT_LAYER, `color:${i(2)}`, "clip-path:inset(0 0 100% 0)", `animation:gcsNfxSliceA ${d(3.2)} steps(1) infinite`],
      after: [...TEXT_LAYER, `color:${i(3)}`, "clip-path:inset(0 0 100% 0)", `animation:gcsNfxSliceB ${d(3.2)} steps(1) infinite`],
    },
  },

  /** Scanare: linii de ecran care coboară și o bandă de lumină care trece peste litere. */
  scan: {
    base: [
      `background-image:repeating-linear-gradient(0deg,rgba(0,0,0,.42) 0 1px,transparent 1px 3px),linear-gradient(180deg,transparent 40%,${sheen(0.9)} 50%,transparent 60%),var(--nfx-grad)`,
      "background-size:100% 6px,100% 250%,200% 100%",
      "background-position:0 0,0 100%,0 0",
      "-webkit-background-clip:text",
      "background-clip:text",
      "color:transparent",
      "-webkit-text-fill-color:transparent",
      `animation:gcsNfxScan ${d(2.4)} linear infinite`,
    ],
    rich: { self: [dropGlow(4, 40)] },
  },

  /** Crom lustruit: metal cu linia orizontului și o sclipire care trece. */
  chrome: {
    base: [
      `background-image:linear-gradient(100deg,transparent 38%,${sheen(0.95)} 50%,transparent 62%),linear-gradient(180deg,${white(i(1), 70)} 0%,${i(1)} 44%,${black(i(3), 15)} 50%,${i(2)} 72%,${white(i(1), 55)} 100%)`,
      "background-size:250% 100%,100% 100%",
      "background-position:150% 0,0 0",
      "-webkit-background-clip:text",
      "background-clip:text",
      "color:transparent",
      "-webkit-text-fill-color:transparent",
      `animation:gcsNfxSheen ${d(3.4)} ease-in-out infinite`,
    ],
    rich: { self: ["filter:drop-shadow(0 1px 0 rgba(0,0,0,.55)) drop-shadow(0 0 6px rgba(255,255,255,.12))"] },
  },

  /** Flacără: miez fierbinte și limbi de foc în straturi de umbră care pâlpâie în sus. */
  fire: {
    base: [`color:color-mix(in oklab,${white(i(1), 45)} calc(var(--nfx-dk,1)*100%),${i(2)})`, `animation:gcsNfxFlame ${d(1.5)} ease-in-out infinite alternate`],
  },

  /** Holografic: irizare pastelată pe diagonală, cu o sclipire. */
  holo: {
    base: [
      `background-image:linear-gradient(100deg,transparent 40%,${sheen(0.8)} 50%,transparent 60%),linear-gradient(125deg,${white(i(1), 30)},${white(i(2), 30)},${white(i(3), 30)},${white(i(4), 30)},${white(i(5), 30)},${white(i(1), 30)})`,
      "background-size:250% 100%,300% 300%",
      "background-position:150% 0,0 0",
      "-webkit-background-clip:text",
      "background-clip:text",
      "color:transparent",
      "-webkit-text-fill-color:transparent",
      `animation:gcsNfxHolo ${d(6)} linear infinite`,
    ],
    rich: { self: [dropGlow(6, 30)] },
  },

  /** Terminal digital: litere de cod, strălucire de monitor, cursorul care clipește și un mic glitch. */
  caret: {
    base: [
      'font-family:ui-monospace,"Cascadia Code","SFMono-Regular",Consolas,monospace',
      "letter-spacing:.02em",
      `color:${i(1)}`,
      `text-shadow:0 0 6px ${g(70)}`,
      `animation:gcsNfxDigital ${d(4)} steps(1) infinite`,
    ],
    rich: {
      after: [...DECOR, "opacity:1", "left:100%", "top:.12em", "bottom:.12em", "width:.5em", "margin-left:.1em", `background:${i(1)}`, `box-shadow:0 0 6px ${g(80)}`, "animation:gcsNfxBlink 1s steps(1) infinite"],
    },
  },

  /** Infern: foc care urcă prin litere și jar care se ridică din nume. */
  inferno: {
    base: [
      `background-image:linear-gradient(0deg,${i(3)} 0%,${i(2)} 25%,${white(i(1), 30)} 50%,${i(2)} 75%,${i(3)} 100%)`,
      "background-size:100% 200%",
      "-webkit-background-clip:text",
      "background-clip:text",
      "color:transparent",
      "-webkit-text-fill-color:transparent",
      `animation:gcsNfxRise ${d(1.6)} linear infinite`,
      dropGlow(5, 70),
    ],
    rich: {
      self: [`filter:drop-shadow(0 -2px 6px ${g(75, i(2))}) drop-shadow(0 0 2px ${g(60, i(1))})`],
      before: [...DECOR, "left:5%", "right:5%", "bottom:30%", "height:1.4em", `background:${dots(white(i(1), 20), [[8, 92, 1.6], [27, 98, 1.2], [46, 90, 1.8], [63, 96, 1.3], [82, 94, 1.6]])}`, `animation:gcsNfxEmber ${d(2.2)} ease-out infinite`],
      after: [...DECOR, "left:12%", "right:0", "bottom:20%", "height:1.6em", `background:${dots(i(2), [[15, 95, 1.3], [38, 92, 1.7], [58, 99, 1.2], [77, 93, 1.5], [93, 97, 1.1]])}`, `animation:gcsNfxEmber2 ${d(2.9)} ease-out .8s infinite`],
    },
  },

  /** Mașina de scris: numele se tastează cu un cursor, stă, se șterge și o ia de la capăt. */
  typewriter: {
    base: [`color:${i(1)}`, `text-shadow:0 0 6px ${g(40)}`],
    rich: {
      self: [`animation:gcsNfxType ${d(5.5)} steps(12,end) infinite`],
      after: [
        ...DECOR,
        "opacity:1",
        "left:100%",
        "top:.08em",
        "bottom:.08em",
        "width:.07em",
        "margin-left:.06em",
        `background:${i(2)}`,
        `box-shadow:0 0 5px ${g(80)}`,
        `animation:gcsNfxTypeCaret ${d(5.5)} steps(12,end) infinite,gcsNfxBlink .9s steps(1) infinite`,
      ],
    },
  },

  /** Licăr: literele se aprind una câte una, apoi se sting la fel. */
  reveal: {
    base: [`color:${white(i(1), 20)}`, `text-shadow:0 0 8px ${g(65)}`],
    rich: {
      self: [
        "-webkit-mask-image:linear-gradient(90deg,transparent 0%,#000 18%,#000 62%,transparent 80%)",
        "mask-image:linear-gradient(90deg,transparent 0%,#000 18%,#000 62%,transparent 80%)",
        "-webkit-mask-size:260% 100%",
        "mask-size:260% 100%",
        "-webkit-mask-position:0 0",
        "mask-position:0 0",
        `animation:gcsNfxReveal ${d(3.8)} linear infinite`,
      ],
    },
  },

  /** Oglindă spartă: litere luminoase cu fisuri în sticlă, o așchie decalată și un tremur scurt. */
  shatter: {
    base: [
      `background-image:linear-gradient(118deg,transparent 45.4%,rgba(0,0,0,.7) 45.6% 46.6%,${sheen(0.95)} 46.8% 48%,transparent 48.2%),linear-gradient(62deg,transparent 59.6%,rgba(0,0,0,.65) 59.8% 60.8%,${sheen(0.9)} 61% 62%,transparent 62.2%),linear-gradient(160deg,transparent 27.6%,rgba(0,0,0,.55) 27.8% 28.6%,${sheen(0.85)} 28.8% 29.8%,transparent 30%),linear-gradient(180deg,${white(i(1), 55)},${i(1)} 60%,${black(i(2), 10)})`,
      "-webkit-background-clip:text",
      "background-clip:text",
      "color:transparent",
      "-webkit-text-fill-color:transparent",
      dropGlow(4, 45),
    ],
    rich: {
      self: ["display:inline-block", `animation:gcsNfxShake ${d(4.5)} linear infinite`],
      before: [...TEXT_LAYER, `color:${white(i(2), 35)}`, "opacity:.55", "clip-path:polygon(48% 0,100% 0,100% 55%,63% 100%,52% 46%)", "transform:translate(.05em,-.04em)", `animation:gcsNfxShard ${d(4.5)} linear infinite`],
    },
  },

  /** Lumini de oraș: neon pastelat care trece prin culorile variantei. */
  citylights: {
    base: [`color:${white(i(1), 62)}`, `animation:gcsNfxCity ${d(6)} ease-in-out infinite`],
  },

  /** Cosmic: gradient violet înclinat, cu stele care plutesc și sclipesc în jurul numelui. */
  cosmic: {
    base: [...GRAD_TEXT, "font-style:italic", `animation:gcsNfxFlow ${d(7)} linear infinite`],
    rich: {
      self: ["isolation:isolate", dropGlow(6, 45)],
      before: [
        ...DECOR,
        "opacity:1",
        "inset:-.45em -.5em",
        "z-index:-1",
        `background-image:${dots("#fff", [[6, 30, 0.8], [18, 78, 0.6], [31, 12, 0.9], [44, 64, 0.6], [57, 26, 0.8], [69, 86, 0.7], [81, 40, 1], [94, 70, 0.6]])},${dots(white(i(2), 40), [[12, 55, 0.7], [38, 88, 0.6], [63, 8, 0.7], [88, 18, 0.8]])}`,
        "background-size:100% 100%,100% 100%",
        `animation:gcsNfxStars ${d(9)} linear infinite,gcsNfxTwinkleSoft ${d(2.6)} ease-in-out infinite alternate`,
      ],
    },
  },

  /** Țintă: o lunetă mică lângă nume care se rotește, ochește și „lovește” (un glitch scurt). */
  crosshair: {
    base: [`color:${i(1)}`, `text-shadow:0 0 6px ${g(45)}`, `animation:gcsNfxHit ${d(3.6)} steps(1) infinite`],
    rich: {
      after: [
        ...DECOR,
        "opacity:1",
        "left:100%",
        "top:50%",
        "width:.62em",
        "height:.62em",
        "margin-left:.3em",
        `border:.07em solid ${i(2)}`,
        "border-radius:50%",
        `background:linear-gradient(${i(2)},${i(2)}) 50% 0/.07em 30% no-repeat,linear-gradient(${i(2)},${i(2)}) 50% 100%/.07em 30% no-repeat,linear-gradient(${i(2)},${i(2)}) 0 50%/30% .07em no-repeat,linear-gradient(${i(2)},${i(2)}) 100% 50%/30% .07em no-repeat,radial-gradient(circle,${i(3)} 0 .07em,transparent .09em)`,
        `box-shadow:0 0 6px ${g(70, i(2))}`,
        "transform:translateY(-50%)",
        `animation:gcsNfxLock ${d(3.6)} ease-in-out infinite`,
      ],
    },
  },

  /** Val de dragoste: gradient roz care curge și inimioare care plutesc. */
  love: {
    base: [...GRAD_TEXT, `animation:gcsNfxFlow ${d(3)} linear infinite`],
    rich: {
      self: [dropGlow(5, 50)],
      before: [...DECOR, 'content:"\\2665"', 'content:"\\2665" / ""', "left:8%", "top:-.2em", "font-size:.5em", "font-style:normal", `color:${i(2)}`, "-webkit-text-fill-color:currentColor", `animation:gcsNfxFloat ${d(2.8)} ease-out infinite`],
      after: [...DECOR, 'content:"\\2665"', 'content:"\\2665" / ""', "right:4%", "top:-.1em", "font-size:.38em", "font-style:normal", `color:${white(i(1), 25)}`, "-webkit-text-fill-color:currentColor", `animation:gcsNfxFloat ${d(3.4)} ease-out 1.2s infinite`],
    },
  },

  /** Electric: neon care arde constant și scapără din când în când, cu un arc peste litere. */
  electric: {
    base: [`color:${white(i(1), 40)}`, `text-shadow:0 0 2px var(--nfx-cyg,${white(i(1), 60)}),0 0 8px ${gc(90)},0 0 18px ${gc(60)}`, `animation:gcsNfxZap ${d(3.2)} linear infinite,${cycle(8)}`],
    rich: {
      after: [
        ...DECOR,
        "left:-4%",
        "right:-4%",
        "top:20%",
        "height:60%",
        `background:linear-gradient(90deg,transparent,${white(i(1), 70)} 20%,#fff 50%,${white(i(1), 70)} 80%,transparent)`,
        "clip-path:polygon(0 50%,12% 30%,22% 62%,35% 20%,47% 70%,58% 28%,70% 66%,82% 32%,92% 58%,100% 45%,100% 52%,92% 66%,82% 40%,70% 74%,58% 36%,47% 78%,35% 28%,22% 70%,12% 38%,0 58%)",
        `filter:drop-shadow(0 0 3px ${g(100)})`,
        `animation:gcsNfxArc ${d(3.2)} linear infinite`,
      ],
    },
  },

  /** Reflex: numele se oglindește dedesubt, ca pe o suprafață lucioasă, cu o unduire. */
  mirror: {
    base: [...GRAD_TEXT, "background-size:100% 100%"],
    rich: {
      after: [
        ...TEXT_LAYER,
        "top:72%",
        `color:${i(2)}`,
        "transform:scaleY(-.75)",
        "transform-origin:50% 50%",
        "opacity:.32",
        "-webkit-mask-image:linear-gradient(0deg,#000 0%,transparent 75%)",
        "mask-image:linear-gradient(0deg,#000 0%,transparent 75%)",
        `animation:gcsNfxRipple ${d(3)} ease-in-out infinite`,
      ],
    },
  },

  /** Fulger: text albastru electric și un fulger mic lângă nume care scapără dublu. */
  lightning: {
    base: [`color:${white(i(1), 35)}`, `text-shadow:0 0 4px ${gc(90)},0 0 14px ${gc(55)}`, `animation:gcsNfxFlash ${d(4)} linear infinite,${cycle(8)}`],
    rich: {
      after: [
        ...DECOR,
        "opacity:1",
        "left:100%",
        "top:50%",
        "width:.42em",
        "height:.78em",
        "margin-left:.22em",
        `background:linear-gradient(180deg,#fff,${white(i(1), 30)})`,
        "clip-path:polygon(58% 0,8% 56%,44% 56%,30% 100%,92% 38%,54% 38%,74% 0)",
        `filter:drop-shadow(0 0 4px ${g(100)})`,
        "transform:translateY(-50%)",
        `animation:gcsNfxBolt ${d(4)} linear infinite`,
      ],
    },
  },

  /** Bani: verde strălucitor, cu simboluri de monede care urcă. */
  money: {
    base: [`color:${white(i(1), 15)}`, `text-shadow:0 0 6px ${g(70)},0 0 16px ${g(35)}`],
    rich: {
      before: [...DECOR, 'content:"$"', 'content:"$" / ""', "left:10%", "top:0", "font-size:.55em", "font-weight:800", "font-style:normal", `color:${i(2)}`, "-webkit-text-fill-color:currentColor", `text-shadow:0 0 6px ${g(80, i(2))}`, `animation:gcsNfxFloat ${d(2.6)} ease-out infinite`],
      after: [...DECOR, 'content:"\\20AC"', 'content:"\\20AC" / ""', "right:8%", "top:.1em", "font-size:.48em", "font-weight:800", "font-style:normal", `color:${i(2)}`, "-webkit-text-fill-color:currentColor", `text-shadow:0 0 6px ${g(80, i(2))}`, `animation:gcsNfxFloat ${d(3.1)} ease-out 1.1s infinite`],
    },
  },

  /** Tăietură: o lamă trece prin litere, jumătățile alunecă una pe lângă alta și revin. */
  razor: {
    base: [`background-image:linear-gradient(180deg,${white(i(1), 10)} 0 52%,${i(2)} 52% 100%)`, "-webkit-background-clip:text", "background-clip:text", "color:transparent", "-webkit-text-fill-color:transparent"],
    rich: {
      self: [
        "-webkit-background-clip:border-box",
        "background-clip:border-box",
        `background-image:linear-gradient(90deg,transparent,${i(3)},#fff,${i(3)},transparent)`,
        "background-repeat:no-repeat",
        "background-size:0% .08em",
        "background-position:0 52%",
        `animation:gcsNfxBlade ${d(4)} ease-in-out infinite`,
      ],
      before: [...TEXT_LAYER, `color:${white(i(1), 10)}`, "clip-path:inset(0 0 48% 0)", `animation:gcsNfxSlideA ${d(4)} ease-in-out infinite`],
      after: [...TEXT_LAYER, `color:${i(2)}`, "clip-path:inset(52% 0 0 0)", `animation:gcsNfxSlideB ${d(4)} ease-in-out infinite`],
    },
  },

  /** Umbre dansante: două umbre colorate care se rotesc în jurul literelor. */
  shadowdance: {
    base: [`color:${i(1)}`, `animation:gcsNfxOrbit ${d(2.8)} linear infinite`],
  },

  /** Acid: verde toxic, picături care se scurg din litere și bule care urcă. */
  toxic: {
    base: [
      `background-image:linear-gradient(180deg,${white(i(1), 35)} 0%,${i(1)} 55%,${i(2)} 100%)`,
      "-webkit-background-clip:text",
      "background-clip:text",
      "color:transparent",
      "-webkit-text-fill-color:transparent",
      dropGlow(5, 60),
    ],
    rich: {
      before: [...DECOR, "left:6%", "right:6%", "top:78%", "height:.55em", `background:${dots(i(1), [[12, 10, 1.9], [34, 12, 1.5], [57, 8, 2.1], [81, 14, 1.6]])}`, "transform-origin:50% 0", `animation:gcsNfxDrip ${d(3.2)} ease-in infinite`],
      after: [
        ...DECOR,
        "left:0",
        "right:0",
        "bottom:40%",
        "height:1.3em",
        `background:radial-gradient(circle at 20% 90%,transparent 0 1.4px,${i(2)} 1.6px 2.2px,transparent 2.6px),radial-gradient(circle at 70% 95%,transparent 0 1.8px,${i(1)} 2px 2.6px,transparent 3px),radial-gradient(circle at 45% 98%,transparent 0 1px,${i(2)} 1.2px 1.8px,transparent 2.2px)`,
        `animation:gcsNfxEmber ${d(3.6)} ease-out .6s infinite`,
      ],
    },
  },

  /** Scanare verticală: o bandă de lumină care coboară prin litere. */
  vscan: {
    base: [
      `background-image:linear-gradient(180deg,transparent 42%,${sheen(0.95)} 50%,transparent 58%),var(--nfx-grad)`,
      "background-size:100% 260%,200% 100%",
      "background-position:0 100%,0 0",
      "-webkit-background-clip:text",
      "background-clip:text",
      "color:transparent",
      "-webkit-text-fill-color:transparent",
      `animation:gcsNfxVscan ${d(2.2)} ease-in-out infinite`,
    ],
    rich: { self: [dropGlow(4, 45)] },
  },

  /** Aur: metal bogat cu sclipire și două stele care licăresc pe litere. */
  gold: {
    base: [
      `background-image:linear-gradient(100deg,transparent 38%,${sheen(0.9)} 50%,transparent 62%),linear-gradient(180deg,${white(i(1), 55)} 0%,${i(1)} 38%,${i(2)} 52%,${black(i(3), 5)} 70%,${i(1)} 100%)`,
      "background-size:250% 100%,100% 100%",
      "background-position:150% 0,0 0",
      "-webkit-background-clip:text",
      "background-clip:text",
      "color:transparent",
      "-webkit-text-fill-color:transparent",
      `animation:gcsNfxSheen ${d(3.6)} ease-in-out infinite`,
    ],
    rich: {
      self: [`filter:drop-shadow(0 1px 0 ${black(i(3), 45)}) drop-shadow(0 0 7px ${g(45)})`],
      before: [...DECOR, "left:14%", "top:-.12em", "width:.42em", "height:.42em", "background:#fff", "clip-path:polygon(50% 0,61% 39%,100% 50%,61% 61%,50% 100%,39% 61%,0 50%,39% 39%)", `animation:gcsNfxTwinkle ${d(2.4)} ease-in-out infinite`],
      after: [...DECOR, "right:10%", "bottom:.02em", "width:.3em", "height:.3em", "background:#fff", "clip-path:polygon(50% 0,61% 39%,100% 50%,61% 61%,50% 100%,39% 61%,0 50%,39% 39%)", `animation:gcsNfxTwinkle ${d(2.4)} ease-in-out 1.2s infinite`],
    },
  },

  /** Aură: o placă palidă de lumină care respiră în spatele numelui. */
  aura: {
    base: [`color:${white(i(1), 30)}`, `text-shadow:0 0 10px ${g(55)}`],
    rich: {
      self: ["isolation:isolate"],
      before: [
        ...DECOR,
        "inset:-.12em -.5em",
        "z-index:-1",
        "border-radius:.5em",
        `background:radial-gradient(closest-side,${g(55, i(2))},${g(18, i(2))} 60%,transparent)`,
        "filter:blur(2px)",
        `animation:gcsNfxAura ${d(3.2)} ease-in-out infinite`,
      ],
    },
  },

  /** Ploaie digitală: coloane de caractere verzi care cad prin spatele numelui. */
  matrix: {
    base: [`color:${white(i(1), 20)}`, `text-shadow:0 0 6px ${g(75)}`, `animation:gcsNfxDigital ${d(5)} steps(1) infinite`],
    rich: {
      self: ["isolation:isolate"],
      before: [
        ...DECOR,
        'content:"1\\30A2 0 1\\A 0 1\\30CB 0\\A 1 0 1\\30EB\\A \\30B5 1 0 1"',
        'content:"1\\30A2 0 1\\A 0 1\\30CB 0\\A 1 0 1\\30EB\\A \\30B5 1 0 1" / ""',
        "opacity:.55",
        "left:4%",
        "top:-.6em",
        "z-index:-1",
        "white-space:pre",
        "writing-mode:vertical-rl",
        "text-orientation:upright",
        'font:700 .4em/2.6 ui-monospace,Consolas,monospace',
        "font-style:normal",
        `color:${i(2)}`,
        "-webkit-text-fill-color:currentColor",
        "-webkit-mask-image:linear-gradient(180deg,transparent,#000 30%,#000 70%,transparent)",
        "mask-image:linear-gradient(180deg,transparent,#000 30%,#000 70%,transparent)",
        `animation:gcsNfxRain ${d(2.6)} linear infinite`,
      ],
      after: [
        ...DECOR,
        'content:"0 1\\30AB 1\\A 1 0\\30C4 0\\A 0\\30E2 1 1\\A 1 0 0\\30E8"',
        'content:"0 1\\30AB 1\\A 1 0\\30C4 0\\A 0\\30E2 1 1\\A 1 0 0\\30E8" / ""',
        "opacity:.4",
        "left:52%",
        "top:-.8em",
        "z-index:-1",
        "white-space:pre",
        "writing-mode:vertical-rl",
        "text-orientation:upright",
        'font:700 .4em/2.6 ui-monospace,Consolas,monospace',
        "font-style:normal",
        `color:${i(2)}`,
        "-webkit-text-fill-color:currentColor",
        "-webkit-mask-image:linear-gradient(180deg,transparent,#000 30%,#000 70%,transparent)",
        "mask-image:linear-gradient(180deg,transparent,#000 30%,#000 70%,transparent)",
        `animation:gcsNfxRain ${d(3.4)} linear .7s infinite`,
      ],
    },
  },

  /** Ger: gheață cu cristale care sclipesc și o strălucire rece. */
  frost: {
    base: [
      `background-image:linear-gradient(100deg,transparent 40%,${sheen(0.95)} 50%,transparent 60%),repeating-linear-gradient(60deg,rgba(255,255,255,.18) 0 1px,transparent 1px 7px),linear-gradient(180deg,${white(i(1), 65)},${i(1)} 55%,${i(2)})`,
      "background-size:250% 100%,100% 100%,100% 100%",
      "background-position:150% 0,0 0,0 0",
      "-webkit-background-clip:text",
      "background-clip:text",
      "color:transparent",
      "-webkit-text-fill-color:transparent",
      `animation:gcsNfxSheen ${d(4.2)} ease-in-out infinite`,
      dropGlow(4, 50),
    ],
    rich: {
      before: [...DECOR, "right:12%", "top:-.15em", "width:.38em", "height:.38em", `background:${white(i(1), 70)}`, "clip-path:polygon(50% 0,58% 42%,100% 50%,58% 58%,50% 100%,42% 58%,0 50%,42% 42%)", `animation:gcsNfxTwinkle ${d(3)} ease-in-out infinite`],
      after: [...DECOR, "left:20%", "bottom:0", "width:.26em", "height:.26em", "background:#fff", "clip-path:polygon(50% 0,58% 42%,100% 50%,58% 58%,50% 100%,42% 58%,0 50%,42% 42%)", `animation:gcsNfxTwinkle ${d(3)} ease-in-out 1.5s infinite`],
    },
  },

  /** Plasmă: două câmpuri de culoare care se amestecă și curg în sensuri opuse. */
  plasma: {
    base: [
      `background-image:radial-gradient(60% 120% at 30% 50%,${white(i(2), 20)},transparent 70%),linear-gradient(90deg,${i(1)},${i(3)},${i(2)},${i(1)})`,
      "background-size:200% 200%,200% 100%",
      "-webkit-background-clip:text",
      "background-clip:text",
      "color:transparent",
      "-webkit-text-fill-color:transparent",
      `animation:gcsNfxPlasma ${d(2.6)} linear infinite`,
      dropGlow(6, 55),
    ],
  },

  /** Contur: litere goale, cu marginea care își schimbă culoarea și o strălucire fină. */
  outline: {
    base: [
      "color:transparent",
      "-webkit-text-fill-color:transparent",
      `-webkit-text-stroke:max(1px,.045em) ${i(1)}`,
      `filter:drop-shadow(0 0 4px ${g(55)})`,
      `animation:gcsNfxStroke ${d(4.5)} linear infinite`,
    ],
  },

  /** 3D: litere ridicate, cu un relief în culoarea a doua care se înclină încet. */
  extrude: {
    base: [`color:${white(i(1), 10)}`, `animation:gcsNfxTilt ${d(5)} ease-in-out infinite`],
  },
};

const FX: Record<GcsNameEffect, Fx> = { ...CORE_FX, ...TEXT_FX };

/** Efectele desenate pe litere (componenta numelui separă literele doar pentru membrii care au ales unul). */
export const LETTER_EFFECTS: readonly GcsNameEffect[] = NAME_EFFECTS.filter((e) => FX[e].letter !== undefined);
export const nameEffectUsesLetters = (effect: string): boolean => (LETTER_EFFECTS as readonly string[]).includes(effect);

// ─── Cadrele-cheie (o singură dată, în CSS-ul static) ───

const e3d = (dir: 1 | -1) => {
  const c = black(i(2), 38);
  const steps = [1, 2, 3, 4, 5].map((n) => `${(dir * n * 0.024).toFixed(3)}em ${(n * 0.024).toFixed(3)}em 0 ${c}`).join(",");
  return `text-shadow:${steps},${(dir * 0.14).toFixed(2)}em .17em .22em rgba(0,0,0,.45)`;
};
const flame = (a: number, b: number, c: number) =>
  `text-shadow:0 0 .06em ${g(90, white(i(1), 60))},${a * 0.02}em -.05em .14em ${g(100, i(1))},${b * 0.03}em -.12em .3em ${g(95, i(2))},${c * 0.03}em -.22em .5em ${g(85, i(3))},0 -.3em .8em ${g(45, i(3))}`;
const city = (n: number) => `text-shadow:0 0 .05em ${white(i(n), 60)},0 0 .25em ${g(90, i(n))},0 0 .6em ${g(55, i(n))}`;

const KEYFRAMES = [
  "@keyframes gcsNfxFlow{to{background-position:200% 0}}",
  `@keyframes gcsNfxBreath{0%,100%{text-shadow:0 0 .08em ${gc(45)},0 0 .2em ${gc(20)}}50%{text-shadow:0 0 .2em ${gc(95)},0 0 .5em ${gc(70)},0 0 1em ${gc(40)}}}`,
  "@keyframes gcsNfxFlicker{0%,18%,21%,23%,54%,57%,100%{opacity:1}19.5%,22%{opacity:.4}55.5%{opacity:.75}}",
  `@keyframes gcsNfxGlitchShadow{0%,86%,100%{text-shadow:.06em 0 ${g(70, i(2))},-.06em 0 ${g(70, i(3))}}88%{text-shadow:-.12em .03em ${g(85, i(2))},.12em -.03em ${g(85, i(3))}}92%{text-shadow:.1em -.03em ${g(85, i(2))},-.08em .03em ${g(85, i(3))}}}`,
  "@keyframes gcsNfxJitter{0%,86%,100%{transform:none}88%{transform:translate(.04em,-.02em) skewX(-8deg)}90%{transform:translate(-.05em,.02em)}93%{transform:translate(.02em,0) skewX(5deg)}}",
  "@keyframes gcsNfxSliceA{0%,85%,100%{clip-path:inset(0 0 100% 0);transform:none}86%{clip-path:inset(8% 0 58% 0);transform:translateX(-.09em)}89%{clip-path:inset(55% 0 12% 0);transform:translateX(.1em)}92%{clip-path:inset(28% 0 44% 0);transform:translateX(-.06em)}95%{clip-path:inset(0 0 100% 0)}}",
  "@keyframes gcsNfxSliceB{0%,87%,100%{clip-path:inset(0 0 100% 0);transform:none}88%{clip-path:inset(62% 0 6% 0);transform:translateX(.09em)}91%{clip-path:inset(14% 0 66% 0);transform:translateX(-.1em)}94%{clip-path:inset(40% 0 30% 0);transform:translateX(.05em)}96%{clip-path:inset(0 0 100% 0)}}",
  "@keyframes gcsNfxScan{0%{background-position:0 0,0 100%,0 0}100%{background-position:0 6px,0 0%,200% 0}}",
  "@keyframes gcsNfxSheen{0%{background-position:150% 0,0 0}55%,100%{background-position:-50% 0,0 0}}",
  `@keyframes gcsNfxFlame{0%{${flame(0, 1, -1)}}33%{${flame(1, -1, 1)}}66%{${flame(-1, 0, 2)}}100%{${flame(1, 1, -2)}}}`,
  "@keyframes gcsNfxHolo{0%{background-position:150% 0,0% 50%}50%{background-position:-50% 0,100% 50%}100%{background-position:-50% 0,0% 50%}}",
  "@keyframes gcsNfxDigital{0%,92%,100%{opacity:1;transform:none}93%{opacity:.55}94%{opacity:1}96%{opacity:.8}}",
  "@keyframes gcsNfxBlink{50%{opacity:0}}",
  "@keyframes gcsNfxRise{to{background-position:0 -200%}}",
  "@keyframes gcsNfxEmber{0%{opacity:0;transform:translateY(.2em) scale(.7)}25%{opacity:1}100%{opacity:0;transform:translateY(-1.1em) scale(1)}}",
  "@keyframes gcsNfxEmber2{0%{opacity:0;transform:translate(0,.2em) scale(.6)}30%{opacity:.9}100%{opacity:0;transform:translate(.25em,-1.3em) scale(1)}}",
  "@keyframes gcsNfxType{0%{clip-path:inset(-.4em calc(100% - .2em) -.4em -.4em)}45%,82%{clip-path:inset(-.4em -.5em -.4em -.4em)}96%,100%{clip-path:inset(-.4em calc(100% - .2em) -.4em -.4em)}}",
  "@keyframes gcsNfxTypeCaret{0%{left:0}45%,82%{left:100%}96%,100%{left:0}}",
  "@keyframes gcsNfxReveal{0%{-webkit-mask-position:100% 0;mask-position:100% 0}100%{-webkit-mask-position:0 0;mask-position:0 0}}",
  "@keyframes gcsNfxShake{0%,90%,100%{transform:none}91%{transform:translate(.03em,-.02em) rotate(-.6deg)}93%{transform:translate(-.03em,.02em) rotate(.6deg)}95%{transform:translate(.02em,.01em)}}",
  "@keyframes gcsNfxShard{0%,89%,100%{transform:translate(.05em,-.04em)}91%{transform:translate(.12em,-.08em)}94%{transform:translate(.02em,-.01em)}}",
  `@keyframes gcsNfxCity{0%,100%{${city(1)}}33%{${city(2)}}66%{${city(3)}}}`,
  "@keyframes gcsNfxStars{0%{transform:translate(0,0)}50%{transform:translate(.12em,-.08em)}100%{transform:translate(0,0)}}",
  "@keyframes gcsNfxTwinkleSoft{from{opacity:.35}to{opacity:1}}",
  `@keyframes gcsNfxHit{0%,70%,76%,100%{text-shadow:0 0 6px ${g(45)}}71%{text-shadow:.08em 0 ${g(90, i(2))},-.08em 0 ${g(90, i(3))}}73%{text-shadow:-.06em 0 ${g(90, i(2))},.06em 0 ${g(90, i(3))}}}`,
  "@keyframes gcsNfxLock{0%{transform:translateY(-50%) rotate(0) scale(1.35);opacity:.35}35%,68%{transform:translateY(-50%) rotate(90deg) scale(1);opacity:1}71%{transform:translateY(-50%) translateX(.06em) rotate(90deg) scale(.9)}74%{transform:translateY(-50%) translateX(-.05em) rotate(90deg) scale(1.05)}100%{transform:translateY(-50%) rotate(180deg) scale(1.35);opacity:.35}}",
  "@keyframes gcsNfxFloat{0%{opacity:0;transform:translateY(.4em) scale(.7)}25%{opacity:1}100%{opacity:0;transform:translateY(-1.5em) scale(1.1)}}",
  `@keyframes gcsNfxZap{0%,44%,49%,53%,100%{opacity:1;text-shadow:0 0 2px var(--nfx-cyg,${white(i(1), 60)}),0 0 8px ${gc(90)},0 0 18px ${gc(60)}}45%,51%{opacity:1;text-shadow:0 0 2px #fff,0 0 10px #fff,0 0 22px ${gc(100)},0 0 42px ${gc(85)}}47%{opacity:.6}}`,
  "@keyframes gcsNfxArc{0%,44%,54%,100%{opacity:0}45%{opacity:1;transform:scaleY(1)}47%{opacity:.2;transform:scaleY(-1)}50%{opacity:.95;transform:scaleY(1)}}",
  "@keyframes gcsNfxRipple{0%,100%{transform:scaleY(-.75) translateX(0)}50%{transform:scaleY(-.75) translateX(.04em) skewX(-4deg)}}",
  `@keyframes gcsNfxFlash{0%,58%,64%,100%{text-shadow:0 0 4px ${gc(90)},0 0 14px ${gc(55)}}59%,62%{text-shadow:0 0 3px #fff,0 0 12px ${gc(100)},0 0 28px ${gc(80)}}}`,
  "@keyframes gcsNfxBolt{0%,57%,66%,100%{opacity:.22}58%,63%{opacity:1}60%{opacity:.3}}",
  "@keyframes gcsNfxBlade{0%,50%{background-size:0% .08em;background-position:0 52%}62%,80%{background-size:100% .08em;background-position:0 52%}92%,100%{background-size:0% .08em;background-position:100% 52%}}",
  "@keyframes gcsNfxSlideA{0%,58%,92%,100%{transform:none}66%,82%{transform:translateX(-.09em)}}",
  "@keyframes gcsNfxSlideB{0%,58%,92%,100%{transform:none}66%,82%{transform:translateX(.09em)}}",
  `@keyframes gcsNfxOrbit{0%,100%{text-shadow:.07em 0 ${g(85, i(2))},-.07em 0 ${g(85, i(3))}}25%{text-shadow:0 .07em ${g(85, i(2))},0 -.07em ${g(85, i(3))}}50%{text-shadow:-.07em 0 ${g(85, i(2))},.07em 0 ${g(85, i(3))}}75%{text-shadow:0 -.07em ${g(85, i(2))},0 .07em ${g(85, i(3))}}}`,
  "@keyframes gcsNfxDrip{0%{opacity:0;transform:scaleY(.2)}20%{opacity:1}70%{opacity:1;transform:scaleY(1)}100%{opacity:0;transform:scaleY(1) translateY(.3em)}}",
  "@keyframes gcsNfxVscan{0%{background-position:0 100%,0 0}100%{background-position:0 0%,0 0}}",
  "@keyframes gcsNfxTwinkle{0%,100%{opacity:0;transform:scale(.2) rotate(0)}50%{opacity:1;transform:scale(1) rotate(45deg)}}",
  "@keyframes gcsNfxAura{0%,100%{opacity:.45;transform:scale(.96)}50%{opacity:1;transform:scale(1.04)}}",
  "@keyframes gcsNfxRain{from{transform:translateY(-35%)}to{transform:translateY(35%)}}",
  "@keyframes gcsNfxPlasma{0%{background-position:0% 50%,0 0}100%{background-position:200% 50%,-200% 0}}",
  `@keyframes gcsNfxStroke{0%,100%{-webkit-text-stroke-color:${i(1)}}33%{-webkit-text-stroke-color:${i(2)}}66%{-webkit-text-stroke-color:${i(3)}}}`,
  `@keyframes gcsNfxTilt{0%,100%{${e3d(1)}}50%{${e3d(-1)}}}`,
  // Ciclul culorilor (curcubeul pe efectele cu o culoare plină): 2–5 culori, fiecare câte o parte egală din timp.
  ...[2, 3, 4, 5].map((n) => {
    const steps = Array.from({ length: n }, (_, k) => `${Math.round((k * 100) / n)}%{color:${white(i(k + 1), 30)}}`);
    return `@keyframes gcsNfxCycle${n}{${steps.join("")}100%{color:${white(i(1), 30)}}}`;
  }),
  ...TEXT_KEYFRAMES,
];

// ─── Compunerea ───

const HEX = /^#[0-9a-fA-F]{6}$/;
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Selectorul numelui unui membru (oriunde apare) și al locurilor mari (cu decorațiile efectului). */
export function nameSelectors(userId: string): { all: string; rich: string } {
  return {
    all: `${NAME_SCOPE} :is(.gcs-userLink[data-user-id="${userId}"],[data-name-user="${userId}"])`,
    // Locurile mari: numele în varianta „full” (postbit, profil, hover card, meniul userului), autorul din postbit și
    // numele fără link (`data-name-user`, din șabloanele vechi).
    // Componenta comună: varianta mare doar cu `data-name-fx="full"`; markup-ul vechi fără `.gcs-name` (șabloane
    // modificate): numele fără link erau mereu în locurile mari.
    rich: `${NAME_SCOPE} :is(.gcs-post__authorName .gcs-userLink[data-user-id="${userId}"],[data-name-fx="full"]:is([data-user-id="${userId}"],[data-name-user="${userId}"]),[data-name-user="${userId}"]:not(.gcs-name))[data-text]`,
  };
}

/** Clasa de previzualizare a unui efect (pluginurile o folosesc cu `gcs-nfx` și variabilele `--nfx-*`). */
export const nameEffectClass = (effect: GcsNameEffect) => `gcs-nfx--${effect}`;

/** Un nume stilizat, pentru CSS: selectorii lui, efectul și variabilele (culorile, viteza, grosimea). */
export type GcsStyledName = { all: string; rich: string; effect: GcsNameEffect; vars: string[] };

/**
 * Gradientul culorilor (cu prima repetată la final, ca animațiile să se reia fără salt), din cerneluri. Fără unghi:
 * `--nfx-ang` (previzualizările îl dau ca variabilă).
 */
export function nameGradient(count: number, angle?: number): string {
  const n = Math.min(Math.max(count, 1), 5);
  const stops = n === 1 ? [i(1), white(i(1), 45), i(1)] : [...Array.from({ length: n }, (_, k) => i(k + 1)), i(1)];
  return `linear-gradient(${angle === undefined ? "var(--nfx-ang,90deg)" : `${Math.round(angle)}deg`},${stops.join(",")})`;
}

/** Variabilele unui nume din culorile validate (`#RRGGBB`), strălucire, viteză și unghi. */
export function nameVars(opts: { colors: string[]; glow?: string; speed?: number; angle?: number; bold?: boolean; italic?: boolean }): string[] {
  const colors = opts.colors.filter((c) => HEX.test(c)).slice(0, 5);
  if (colors.length === 0) colors.push("#FFFFFF");
  const out = colors.map((c, k) => `--nfx-c${k + 1}:${c}`);
  if (opts.glow && HEX.test(opts.glow)) out.push(`--nfx-gc:${opts.glow}`, "--nfx-glow:1");
  if (opts.speed && opts.speed !== 1) out.push(`--nfx-sp:${opts.speed}`);
  // Mai multe culori: efectele cu o culoare plină trec prin ele (iar strălucirea le urmează, fără o strălucire aleasă).
  if (colors.length >= 2) out.push(`--nfx-cyc:gcsNfxCycle${colors.length}`, ...(opts.glow && HEX.test(opts.glow) ? [] : ["--nfx-cyg:currentColor"]));
  out.push(`--nfx-grad:${nameGradient(colors.length, opts.angle ?? 90)}`);
  if (opts.bold === false) out.push("font-weight:600");
  if (opts.italic) out.push("font-style:italic");
  return out;
}

/**
 * Pe textul cu umplere transparentă (gradient), umbra textului s-ar vedea prin litere: fără `text-shadow` propriu,
 * efectul o oprește (strălucirea vine atunci din `filter: drop-shadow`).
 */
function withoutShadowLeak(fx: Fx): Fx {
  const fix = (decls: string[] | undefined) =>
    decls && decls.includes("-webkit-text-fill-color:transparent") && !decls.some((x) => x.startsWith("text-shadow:")) ? [...decls, "text-shadow:none"] : decls;
  return { ...fx, base: fix(fx.base)!, ...(fx.rich ? { rich: { ...fx.rich, self: fix(fx.rich.self) } } : {}) };
}

const rule = (selectors: string[], decls: string[] | undefined) => (decls && decls.length && selectors.length ? `${selectors.join(",")}{${decls.join(";")}}` : "");
/** Literele desenate ale numelor (`.gcs-name__ls > b`), cu un sufix (`:nth-child(…)`, `::before`). */
const letters = (selectors: string[], suffix = "") => selectors.map((s) => `${s} .gcs-name__ls>b${suffix}`);
/** Ascuns vizual, dar citit de cititoarele de ecran (numele întreg, când se desenează pe litere). */
const SR_ONLY = ["position:absolute", "width:1px", "height:1px", "margin:-1px", "padding:0", "overflow:hidden", "clip-path:inset(50%)", "white-space:nowrap", "border:0"];
const pseudo = (selectors: string[], p: "::before" | "::after") => selectors.map((s) => `${s}${p}`);

/** Variabilele implicite (nivelul `:where`, ușor de suprascris) și cernelurile pe tema închisă / deschisă. */
function varsCss(targets: string[]): string {
  const list = `:where(${targets.join(",")})`;
  // Pe tema închisă, culorile prea închise se ridică (L ≥ 0,56); pe cea deschisă, cele prea deschise coboară (L ≤ 0,5),
  // păstrând nuanța. Fără sintaxa relativă (browsere vechi): amestecul cu negru, pe tema deschisă.
  const inks = (dark: boolean, relative: boolean) =>
    [1, 2, 3, 4, 5]
      .map((n) => {
        const c = `var(--nfx-c${n})`;
        if (relative) return `--nfx-i${n}:oklch(from ${c} ${dark ? "max(l,.56)" : "min(l,.5)"} c h)`;
        return `--nfx-i${n}:${dark ? c : `color-mix(in oklab,${c} 62%,#000)`}`;
      })
      .join(";") +
    `;--nfx-g:${dark ? "var(--nfx-gc,var(--nfx-i1))" : "var(--nfx-i1)"};--nfx-ga:${dark ? 1 : 0.38};--nfx-dk:${dark ? 1 : 0}`;
  const defaults = [
    "--nfx-c1:#FFFFFF",
    `--nfx-c2:${white("var(--nfx-c1)", 38)}`,
    `--nfx-c3:${black("var(--nfx-c1)", 30)}`,
    "--nfx-c4:var(--nfx-c2)",
    "--nfx-c5:var(--nfx-c3)",
    "--nfx-sp:1",
    "--nfx-glow:0",
    `--nfx-grad:${nameGradient(1, 90)}`,
  ].join(";");
  const light = (relative: boolean) => [`html[data-theme="light"] ${list}{${inks(false, relative)}}`, `@media (prefers-color-scheme: light){html[data-theme="auto"] ${list}{${inks(false, relative)}}}`];
  return [
    `${list}{${defaults};${inks(true, false)}}`,
    ...light(false),
    `@supports (color:oklch(from red l c h)){${list}{${inks(true, true)}}${light(true).join("")}}`,
  ].join("\n");
}

/** Declarațiile comune ale oricărui nume stilizat (resetează stilul grupului de dedesubt). */
const COMMON = [
  "position:relative",
  "font-weight:700",
  `color:${i(1)}`,
  "-webkit-text-fill-color:currentColor",
  "background:none",
  `text-shadow:0 0 .45em color-mix(in srgb,var(--nfx-g) calc(var(--nfx-glow,0)*var(--nfx-ga,1)*65%),transparent)`,
  "filter:none",
  "animation:none",
  "-webkit-text-stroke:0",
];

/**
 * CSS-ul efectelor: variabilele, regulile comune, fiecare efect (pentru clasele de previzualizare și pentru membrii care
 * îl au), cadrele-cheie și oprirea animațiilor sub `prefers-reduced-motion`. `names` = membrii cu stil.
 */
export function compileNameEffectsCss(names: GcsStyledName[], opts: { previews: boolean }): string {
  const parts: string[] = [];
  const preview = (e: GcsNameEffect) => (opts.previews ? [`${NAME_SCOPE} .gcs-nfx.${nameEffectClass(e)}`] : []);
  const previewRich = (e: GcsNameEffect) => (opts.previews ? [`${NAME_SCOPE} .gcs-nfx.${nameEffectClass(e)}[data-text]`] : []);
  const allTargets = [...(opts.previews ? [`${NAME_SCOPE} .gcs-nfx`] : []), ...names.map((n) => n.all)];
  if (allTargets.length === 0) return "";
  parts.push(varsCss(allTargets));
  parts.push(rule(allTargets, COMMON));
  if (opts.previews) {
    for (let n = 1; n <= 5; n++) parts.push(`${NAME_SCOPE} .gcs-nfx.gcs-nfx--n${n}{--nfx-grad:${nameGradient(n)}${n >= 2 ? `;--nfx-cyc:gcsNfxCycle${n};--nfx-cyg:currentColor` : ""}}`);
    parts.push(`${NAME_SCOPE} .gcs-nfx.gcs-nfx--light{font-weight:600}`, `${NAME_SCOPE} .gcs-nfx.gcs-nfx--italic{font-style:italic}`);
  }
  const letterTargets: string[] = [];
  for (const effect of NAME_EFFECTS) {
    const fx = withoutShadowLeak(FX[effect]);
    const users = names.filter((n) => n.effect === effect);
    const base = [...preview(effect), ...users.map((n) => n.all)];
    const rich = [...previewRich(effect), ...users.map((n) => n.rich)];
    if (base.length === 0) continue;
    parts.push(rule(base, fx.base));
    if (fx.rich) {
      parts.push(rule(rich, fx.rich.self));
      parts.push(rule(pseudo(rich, "::before"), fx.rich.before));
      parts.push(rule(pseudo(rich, "::after"), fx.rich.after));
    }
    if (fx.letter) {
      letterTargets.push(...base);
      parts.push(rule(letters(base), fx.letter));
      parts.push(rule(letters(rich), fx.letterRich));
      for (const [nth, decls] of Object.entries(fx.letterNth ?? {})) parts.push(rule(letters(base, `:nth-child(${nth})`), decls));
    }
  }
  // Literele separate: textul simplu rămâne pentru cititoarele de ecran (ascuns vizual), literele desenate apar.
  if (letterTargets.length > 0) {
    parts.push(rule(letterTargets.map((t) => `${t} .gcs-name__t`), SR_ONLY));
    parts.push(rule(letterTargets.map((t) => `${t} .gcs-name__ls`), ["display:inline", "white-space:nowrap"]));
    parts.push(rule(letters(letterTargets), ["display:inline-block", "font:inherit", "white-space:pre"]));
    parts.push(rule(letters(letterTargets, "::before"), ["content:attr(data-c)", 'content:attr(data-c) / ""']));
  }
  // Variabilele fiecărui membru: după regulile comune (aceeași specificitate, deci câștigă).
  for (const n of names) parts.push(rule([n.all], n.vars));
  // Doar cadrele-cheie folosite (pe un site, membrii aleg câteva efecte din zeci).
  const used = new Set([...parts.join("\n").matchAll(/\b(gcsNfx[A-Za-z0-9]+)\b/g)].map((m) => m[1]!));
  const cycles = parts.some((p) => p.includes("--nfx-cyc"));
  parts.push(...KEYFRAMES.filter((k) => {
    const name = /^@keyframes (gcsNfx[A-Za-z0-9]+)\{/.exec(k)?.[1] ?? "";
    return used.has(name) || (cycles && name.startsWith("gcsNfxCycle"));
  }));
  const moving = [...allTargets, ...allTargets.map((t) => `${t}::before`), ...allTargets.map((t) => `${t}::after`), ...letters(allTargets)];
  parts.push(`@media (prefers-reduced-motion: reduce){${moving.join(",")}{animation:none!important;transition:none!important}${allTargets.join(",")}{clip-path:none!important;-webkit-mask-image:none!important;mask-image:none!important}}`);
  return parts.filter(Boolean).join("\n");
}

/** Selectorii unui membru, doar pentru id-uri sigure. */
export function styledNameSelectors(userId: string): { all: string; rich: string } | null {
  return USER_ID.test(userId) ? nameSelectors(userId) : null;
}
