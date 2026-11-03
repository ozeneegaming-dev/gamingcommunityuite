import { describe, expect, test } from "vitest";
import { GcsContentRenderer } from "./renderer";
import { applyContentPolicy, domainListError, hostMatches, linkRel, normalizeLinkDomain, parseLinkDomains, remoteImageShown, type GcsContentPolicy } from "./outputPolicy";

const POLICY: GcsContentPolicy = { siteHost: "forum.exemplu.ro", nofollowExternal: true, nofollowExclude: [], remoteImages: "allow" };
const renderer = new GcsContentRenderer();
const OPTS = { embeds: [], siteHost: "forum.exemplu.ro", labels: { quoteWrote: "{name} a scris:", spoiler: "Spoiler" } };

/** HTML-ul unei postări, prin renderer-ul real (aceleași atribute ca în baza de date). */
function post(...content: unknown[]): string {
  return renderer.render({ type: "doc", content: [{ type: "paragraph", content }] }, OPTS).html;
}
const link = (href: string, text = "link") => ({ type: "text", text, marks: [{ type: "link", attrs: { href } }] });

describe("domeniile listei albe", () => {
  test("se normalizează (schema, www., calea, *.) și se validează", () => {
    expect(normalizeLinkDomain("https://www.Clanul-Meu.ro/servere?x=1")).toBe("clanul-meu.ro");
    expect(normalizeLinkDomain("*.cs.exemplu.com")).toBe("cs.exemplu.com");
    expect(normalizeLinkDomain("nu e domeniu")).toBeNull();
    expect(parseLinkDomains("clan.ro, https://srv.exemplu.com\nclan.ro")).toEqual(["clan.ro", "srv.exemplu.com"]);
    expect(domainListError("clan.ro\nsrv.exemplu.com")).toBeNull();
    expect(domainListError("clan.ro, <script>")).toBe("invalid_domain");
    expect(domainListError(Array.from({ length: 201 }, (_, i) => `d${i}.ro`).join(","))).toBe("too_many");
  });

  test("un domeniu acoperă și subdomeniile lui, nu și numele care doar se termină la fel", () => {
    expect(hostMatches("www.clan.ro", "clan.ro")).toBe(true);
    expect(hostMatches("cs.clan.ro", "clan.ro")).toBe(true);
    expect(hostMatches("altclan.ro", "clan.ro")).toBe(false);
  });
});

describe("linkRel", () => {
  test("nofollow ugc doar pentru externele neurmate; noopener pentru tab nou; restul cuvintelor rămân", () => {
    expect(linkRel("nofollow ugc noopener", { external: true, follow: false, blank: true })).toBe("nofollow ugc noopener");
    expect(linkRel("nofollow ugc noopener", { external: true, follow: true, blank: true })).toBe("noopener");
    expect(linkRel("nofollow ugc noopener", { external: false, follow: true, blank: true })).toBe("noopener");
    expect(linkRel(null, { external: false, follow: true, blank: false })).toBeNull();
    expect(linkRel("noreferrer", { external: true, follow: false, blank: false })).toBe("nofollow ugc noopener noreferrer");
  });
});

describe("applyContentPolicy: linkurile", () => {
  test("implicit: linkurile externe păstrează nofollow, cele interne îl pierd, mențiunile rămân neatinse", () => {
    const html = post(link("https://altsite.com/pagina"), { type: "text", text: " și " }, link("/topic/5-ghid"), { type: "text", text: " " }, { type: "mention", attrs: { id: "u1", label: "Ana" } });
    const out = applyContentPolicy(html, POLICY);
    expect(out).toContain('<a href="https://altsite.com/pagina" rel="nofollow ugc noopener" target="_blank">link</a>');
    expect(out).toContain('<a href="/topic/5-ghid" target="_blank" rel="noopener">link</a>');
    expect(out).toContain('<a class="gcs-userLink gcs-mention" href="/members/u1" data-user="u1" data-user-id="u1">@Ana</a>');
  });

  test("linkurile spre site (cu sau fără www., absolute) sunt interne", () => {
    const out = applyContentPolicy(post(link("https://www.forum.exemplu.ro/forum/1-x"), link("http://forum.exemplu.ro/a")), POLICY);
    expect(out).not.toContain("nofollow");
  });

  test("lista albă: domeniul și subdomeniile lui nu primesc nofollow; celelalte da", () => {
    const html = post(link("https://cs.clanul-meu.ro/servere", "srv"), link("https://clanul-meu.ro.evil.com/", "fals"), link("https://spam.com/", "spam"));
    const out = applyContentPolicy(html, { ...POLICY, nofollowExclude: ["clanul-meu.ro"] });
    expect(out).toContain('<a href="https://cs.clanul-meu.ro/servere" target="_blank" rel="noopener">srv</a>');
    expect(out).toContain('<a href="https://clanul-meu.ro.evil.com/" rel="nofollow ugc noopener" target="_blank">fals</a>');
    expect(out).toContain('<a href="https://spam.com/" rel="nofollow ugc noopener" target="_blank">spam</a>');
  });

  test("cu setarea oprită, linkurile externe nu au nofollow (rămâne noopener)", () => {
    const out = applyContentPolicy(post(link("https://altsite.com/")), { ...POLICY, nofollowExternal: false });
    expect(out).toBe('<p><a href="https://altsite.com/" target="_blank" rel="noopener">link</a></p>');
  });

  test("adresele cu entități (&amp;) și mailto: rămân corecte", () => {
    const out = applyContentPolicy(post(link("https://altsite.com/a?b=1&c=2"), link("mailto:ana@exemplu.ro", "mail")), { ...POLICY, nofollowExclude: ["altsite.com"] });
    expect(out).toContain('<a href="https://altsite.com/a?b=1&amp;c=2" target="_blank" rel="noopener">link</a>');
    expect(out).toContain('<a href="mailto:ana@exemplu.ro" rel="nofollow ugc noopener" target="_blank">mail</a>');
  });

  test("HTML fără linkuri sau imagini e întors neschimbat (aceeași referință de text)", () => {
    const html = "<p>Salut <strong>lume</strong></p>";
    expect(applyContentPolicy(html, POLICY)).toBe(html);
  });
});

describe("applyContentPolicy: imaginile externe", () => {
  const remote = (src: string) => renderer.render({ type: "doc", content: [{ type: "image", attrs: { src, alt: "Harta" } }] }, OPTS).html;

  test("allow: imaginile rămân; block: devin un link spre imagine (cu nofollow după politica linkurilor)", () => {
    const html = remote("https://cdn.altsite.com/harta.png");
    expect(applyContentPolicy(html, POLICY)).toBe(html);
    const blocked = applyContentPolicy(html, { ...POLICY, remoteImages: "block" });
    expect(blocked).toBe('<a class="gcs-remoteImage" href="https://cdn.altsite.com/harta.png" target="_blank" rel="nofollow ugc noopener">Harta</a>');
    expect(blocked).not.toContain("<img");
  });

  test("imaginile de pe site (atașamentele) rămân și cu block", () => {
    const local = renderer.render({ type: "doc", content: [{ type: "image", attrs: { attachmentId: "abc123", alt: "" } }] }, OPTS).html;
    expect(applyContentPolicy(local, { ...POLICY, remoteImages: "block" })).toBe(local);
    const own = '<img class="gcs-postImage" src="https://forum.exemplu.ro/files/x" alt="" />';
    expect(applyContentPolicy(own, { ...POLICY, remoteImages: "block" })).toBe(own);
  });

  test("https_only: doar imaginile http devin linkuri; fără alt, textul e adresa", () => {
    const http = '<p><img class="gcs-postImage" src="http://vechi.ro/a.jpg" alt="" loading="lazy" /></p>';
    expect(applyContentPolicy(http, { ...POLICY, remoteImages: "https_only" })).toBe('<p><a class="gcs-remoteImage" href="http://vechi.ro/a.jpg" target="_blank" rel="nofollow ugc noopener">http://vechi.ro/a.jpg</a></p>');
    const https = remote("https://cdn.altsite.com/b.png");
    expect(applyContentPolicy(https, { ...POLICY, remoteImages: "https_only" })).toBe(https);
  });

  test("embed-urile de imagini din chat urmează aceeași regulă", () => {
    expect(remoteImageShown("https://cdn.altsite.com/a.gif", POLICY)).toBe(true);
    expect(remoteImageShown("https://cdn.altsite.com/a.gif", { ...POLICY, remoteImages: "block" })).toBe(false);
    expect(remoteImageShown("https://forum.exemplu.ro/files/a", { ...POLICY, remoteImages: "block" })).toBe(true);
  });
});
