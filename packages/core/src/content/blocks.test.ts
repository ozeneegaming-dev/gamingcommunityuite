import { describe, expect, test } from "vitest";
import { GcsValidationError } from "../errors";
import { GCS_BLOCK_TYPES } from "./blocks";
import { ratingStars, roundHalf } from "./ratingStars";
import { GcsContentRenderer, type GcsRenderOptions } from "./renderer";

const renderer = new GcsContentRenderer();
const base: GcsRenderOptions = { embeds: [], siteHost: "forum.test", labels: { quoteWrote: "{name} a scris:", spoiler: "Spoiler" } };
const all = { ...base, blocks: GCS_BLOCK_TYPES, icon: (name: string) => (name === "fa-solid fa-gift" ? '<svg class="gcs-icon" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>' : null) };
const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (...content: unknown[]) => ({ type: "doc", content });

describe("nota cu stele: jumătățile de stea", () => {
  test("media se rotunjește la jumătate de stea", () => {
    expect([4.24, 4.25, 4.6, 4.76, 0, 5.2, -1].map(roundHalf)).toEqual([4, 4.5, 4.5, 5, 0, 5, 0]);
    expect(ratingStars(3.6)).toEqual(["full", "full", "full", "half", "empty"]);
    expect(ratingStars(4.8)).toEqual(["full", "full", "full", "full", "full"]);
    expect(ratingStars(0)).toEqual(["empty", "empty", "empty", "empty", "empty"]);
  });
});

describe("blocurile sigure", () => {
  test("secțiunea, caseta, cardurile, butonul, coloanele, pașii și progresul se desenează în clasele temei", () => {
    const out = renderer.render(
      doc(
        { type: "gcsSection", attrs: { title: "Big giveaway", icon: "fa-solid fa-gift", tone: "accent" }, content: [p("5 premii")] },
        { type: "gcsCallout", attrs: { kind: "warning", title: "Atenție" }, content: [p("Doar membrii activi")] },
        { type: "gcsCardGrid", attrs: { columns: 2 }, content: [{ type: "gcsCard", attrs: { title: "AK-47", subtitle: "Redline", value: "120 €", badge: "Top", highlight: "1" } }, { type: "gcsCard", attrs: { title: "M4" } }] },
        { type: "gcsButton", attrs: { label: "Participă", href: "/register", variant: "primary" } },
        { type: "gcsColumns", content: [{ type: "gcsColumn", content: [p("Stânga")] }, { type: "gcsColumn", content: [p("Dreapta")] }] },
        { type: "gcsSteps", content: [{ type: "gcsStep", attrs: { title: "Intră" }, content: [p("pe server")] }] },
        { type: "gcsProgress", attrs: { label: "Participanți", value: 412, max: 500 } },
      ),
      all,
    );
    expect(out.html).toContain('<section class="gcs-block gcs-block--section gcs-blockTone--accent">');
    expect(out.html).toContain('<span class="gcs-blockIcon gcs-block__icon" aria-hidden="true"><svg class="gcs-icon" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg></span>');
    expect(out.html).toContain('class="gcs-block gcs-block--callout gcs-callout--warning" role="note"');
    expect(out.html).toContain('<div class="gcs-block gcs-block--cards" data-columns="2">');
    expect(out.html).toContain('<div class="gcs-blockCard gcs-blockCard--highlight"><span class="gcs-blockCard__badge">Top</span><strong class="gcs-blockCard__title">AK-47</strong>');
    expect(out.html).toContain('<a class="gcs-btn gcs-btn--primary gcs-blockBtn" href="/register"><span>Participă</span></a>');
    expect(out.html).toContain('<div class="gcs-block gcs-block--columns" data-columns="2">');
    expect(out.html).toContain('<li class="gcs-blockStep"><strong class="gcs-blockStep__title">Intră</strong>');
    expect(out.html).toContain('<span class="gcs-progress__fill" style="width:82.4%"></span>');
    expect(out.text).toContain("Big giveaway");
    expect(out.text).toContain("Participanți 412 / 500");
  });

  test("un bloc nepermis grupului autorului e refuzat (`block_forbidden`), la fel fără nicio listă (mesaje, semnături)", () => {
    const content = doc({ type: "gcsCallout", attrs: { kind: "info" }, content: [p("x")] });
    const expectForbidden = (opts: GcsRenderOptions) => {
      try {
        renderer.render(content, opts);
        throw new Error("nu a refuzat");
      } catch (error) {
        expect(error).toBeInstanceOf(GcsValidationError);
        expect((error as GcsValidationError).fields).toEqual({ content: "block_forbidden" });
        expect((error as GcsValidationError).params).toEqual({ block: "callout" });
      }
    };
    expectForbidden({ ...base, blocks: ["section"] });
    expectForbidden(base);
    expect(renderer.render(content, { ...base, blocks: ["callout"] }).html).toContain("gcs-callout--info");
  });

  test("atributele blocurilor se verifică: linkuri sigure, iconițe, valori întregi", () => {
    const bad = [
      { type: "gcsButton", attrs: { label: "x", href: "javascript:alert(1)" } },
      { type: "gcsSection", attrs: { icon: "<img onerror=x>" }, content: [p("x")] },
      { type: "gcsProgress", attrs: { label: "x", value: "5", max: 10 } },
      { type: "gcsCardGrid", content: [] },
      { type: "gcsHidden", attrs: { mode: "everyone" }, content: [p("x")] },
    ];
    for (const node of bad) expect(() => renderer.render(doc(node), all), JSON.stringify(node)).toThrow(GcsValidationError);
  });

  test("conținutul ascuns iese din HTML și din text (căutarea nu-l vede), cu un marcaj gol în loc", () => {
    const out = renderer.render(doc(p("Vizibil"), { type: "gcsHidden", attrs: { mode: "reply", label: "Codul" }, content: [p("COD-SECRET-123")] }, { type: "gcsHidden", attrs: { mode: "groups", groups: "5,7" }, content: [p("Doar VIP")] }), all);
    expect(out.html).not.toContain("COD-SECRET-123");
    expect(out.text).not.toContain("COD-SECRET-123");
    expect(out.html).toContain('<div class="gcs-hiddenBlock" data-hidden-id="h1" data-hidden-mode="reply"></div>');
    expect(out.hiddenParts).toEqual([
      { id: "h1", mode: "reply", groups: [], label: "Codul", html: "<p>COD-SECRET-123</p>" },
      { id: "h2", mode: "groups", groups: [5, 7], label: null, html: "<p>Doar VIP</p>" },
    ]);
  });

  test("blocul HTML (doar Root): lista albă scoate scripturile, evenimentele, stilurile libere și formularele", () => {
    const out = renderer.render(
      doc({
        type: "gcsHtml",
        attrs: {
          html: '<table class="gcs-x evil"><tr><td style="color:#ff0000;position:fixed">A</td></tr></table><script>alert(1)</script><img src="https://x.example/a.png" onerror="alert(1)"><form action="/x"><input></form><a href="javascript:alert(1)">j</a>',
        },
      }),
      all,
    );
    expect(out.html).toContain('<div class="gcs-block gcs-block--html"><table class="gcs-x"><tr><td style="color:#ff0000">A</td></tr></table>');
    for (const bad of ["<script", "onerror", "<form", "<input", "javascript:", "position:fixed", "evil"]) expect(out.html).not.toContain(bad);
  });
});
