// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { galleryOf, isViewerTarget, viewerImageOf } from "./image-viewer";

function html(markup: string): HTMLElement {
  const box = document.createElement("div");
  box.innerHTML = markup;
  document.body.replaceChildren(box);
  return box;
}

describe("ce deschide vizualizatorul de imagini", () => {
  test("galeria topicului: imaginile tuturor postărilor, în ordine, cu legenda postării fiecăreia", () => {
    const box = html(`
      <section data-gcs-gallery="topic">
        <article data-gcs-caption-author="Ana" data-gcs-caption-date="2026-10-01T10:00:00Z" data-gcs-caption-href="/topic/1#post-1">
          <div class="gcs-postBody"><img class="gcs-postImage" src="/files/a" alt="a"><img class="gcs-postImage" src="/files/b" alt="b"></div>
        </article>
        <article data-gcs-caption-author="Dan" data-gcs-caption-href="/topic/1#post-2">
          <div class="gcs-postBody"><p><img class="gcs-postImage" src="https://cdn.example/c.png" alt=""></p></div>
        </article>
      </section>`);
    const third = box.querySelectorAll("img")[2]!;
    const { images, index } = galleryOf(third);
    expect(images.map((i) => i.src.replace(location.origin, ""))).toEqual(["/files/a", "/files/b", "https://cdn.example/c.png"]);
    expect(index).toBe(2);
    expect(images[0]!.caption).toEqual({ author: "Ana", date: "2026-10-01T10:00:00Z", href: "/topic/1#post-1" });
    expect(images[2]!.caption).toEqual({ author: "Dan", date: null, href: "/topic/1#post-2" });
  });

  test("fără galerie: imaginile aceleiași postări; `data-gcs-viewer` dă adresa mare și originalul", () => {
    const box = html(`
      <div class="gcs-postBody"><img class="gcs-postImage" src="/files/x"></div>
      <button data-gcs-viewer="/files/cover-full" data-gcs-viewer-original="/files/cover-orig" aria-label="Coperta"><img src="/files/cover-small"></button>`);
    expect(galleryOf(box.querySelector("img")!).images).toHaveLength(1);
    const cover = viewerImageOf(box.querySelector("button")!)!;
    expect(cover.src).toBe("/files/cover-full");
    expect(cover.original).toBe("/files/cover-orig");
    expect(cover.thumb).toContain("/files/cover-small");
    expect(cover.alt).toBe("Coperta");
  });

  test("nu se deschid: imaginile din editor și cele dintr-un link spre altă pagină", () => {
    const box = html(`
      <div contenteditable="true"><img class="gcs-postImage" src="/files/e"></div>
      <a href="https://site.example/pagina"><img class="gcs-postImage" src="/files/l"></a>
      <a href="/files/s"><img class="gcs-postImage" src="/files/s"></a>`);
    const [inEditor, linked, self] = [...box.querySelectorAll("img")];
    expect(isViewerTarget(inEditor!)).toBe(false);
    expect(isViewerTarget(linked!)).toBe(false);
    expect(isViewerTarget(self!)).toBe(true);
  });
});
