import { describe, expect, test } from "vitest";
import { excerpt, inWindow, parseFeed, parseFeedLines, parseWindow, postHtml, steamItems, steamMarkupToHtml, steamNewsUrl } from "../src/feeds";

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">
<channel><title>Știri jocuri</title>
  <item>
    <title>Patch nou &amp; reparații</title>
    <link>https://news.example.com/patch</link>
    <guid isPermaLink="false">news-42</guid>
    <pubDate>Sun, 25 Oct 2026 10:00:00 GMT</pubDate>
    <description><![CDATA[<p>Un <b>patch</b> nou cu multe reparații.</p><img src="https://cdn.example.com/a.jpg"><script>alert(1)</script>]]></description>
  </item>
  <item>
    <title>Știre veche</title>
    <link>https://news.example.com/old</link>
    <pubDate>Sat, 24 Oct 2026 10:00:00 GMT</pubDate>
    <description>Text simplu</description>
    <enclosure url="https://cdn.example.com/old.png" type="image/png" length="1"/>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Blog</title>
  <entry>
    <title type="html">Turneu &lt;sâmbătă&gt;</title>
    <link rel="alternate" href="https://blog.example.com/turneu"/>
    <link rel="self" href="https://blog.example.com/feed"/>
    <id>tag:blog.example.com,2026:1</id>
    <updated>2026-10-26T08:00:00Z</updated>
    <summary>Înscrierile sunt deschise.</summary>
  </entry>
</feed>`;

describe("fluxurile din setări", () => {
  test("rândurile: sursa RSS sau steam:<id>, intervalul limitat, opțiunile în română sau engleză, comentariile ignorate", () => {
    const { feeds, errors } = parseFeedLines(
      [
        "# Nume | Sursă | Forum | Minute | Eticheta | Opțiuni",
        "Counter-Strike 2 | steam:730 | Știri | 30 | UPDATE CS2 | traduce, fixat",
        "Blog | https://blog.example.com/feed | 7 | 2 |  | complet lock",
        "",
        "Fără forum | https://x.example.com/rss",
        "Greșit | ftp://x | Știri",
        "Mare | https://y.example.com/rss | Știri | 99999",
      ].join("\n"),
    );
    expect(feeds).toHaveLength(3);
    expect(feeds[0]).toMatchObject({ name: "Counter-Strike 2", source: { kind: "steam", appId: 730 }, forum: "Știri", minutes: 30, label: "UPDATE CS2", options: { translate: true, pin: true, full: false, lock: false } });
    expect(feeds[1]).toMatchObject({ source: { kind: "rss", url: "https://blog.example.com/feed" }, forum: "7", minutes: 5, label: "", options: { full: true, lock: true } });
    expect(feeds[2]!.minutes).toBe(1440);
    expect(errors).toEqual([
      { line: 5, reason: "columns" },
      { line: 6, reason: "source" },
    ]);
    // Același id pentru aceeași sursă (redenumirea fluxului nu republică știrile).
    expect(parseFeedLines("Alt nume | steam:730 | Altul").feeds[0]!.id).toBe(feeds[0]!.id);
  });
});

describe("RSS / Atom", () => {
  test("RSS 2.0: titlul decodat, linkul, guid-ul, conținutul (CDATA), imaginea (din conținut sau enclosure), cele mai noi întâi", () => {
    const items = parseFeed(RSS);
    expect(items.map((i) => i.title)).toEqual(["Patch nou & reparații", "Știre veche"]);
    expect(items[0]).toMatchObject({ guid: "news-42", link: "https://news.example.com/patch", image: "https://cdn.example.com/a.jpg" });
    expect(items[0]!.html).toContain("<b>patch</b>");
    expect(items[1]).toMatchObject({ guid: "https://news.example.com/old", image: "https://cdn.example.com/old.png" });
  });

  test("Atom: linkul alternate, id-ul, rezumatul; un document necunoscut → nimic", () => {
    const [entry] = parseFeed(ATOM);
    expect(entry).toMatchObject({ title: "Turneu <sâmbătă>", link: "https://blog.example.com/turneu", guid: "tag:blog.example.com,2026:1", html: "Înscrierile sunt deschise." });
    expect(parseFeed("<html><body>nu e un flux</body></html>")).toEqual([]);
  });

  test("extrasul implicit (drepturi de autor): text fără scripturi, tăiat la un cuvânt, plus imaginea; „complet” păstrează HTML-ul", () => {
    const [item] = parseFeed(RSS);
    const html = postHtml(item!, { full: false, excerptChars: 25 });
    expect(html).toBe('<p>Un patch nou cu multe…</p><p><img src="https://cdn.example.com/a.jpg" alt=""></p>');
    expect(html).not.toContain("alert");
    expect(postHtml(item!, { full: true, excerptChars: 25 })).toContain("<b>patch</b>");
    expect(excerpt("scurt", 100)).toBe("scurt");
  });
});

describe("Steam", () => {
  test("doar anunțurile oficiale; marcajul Steam devine HTML (liste, îngroșat, linkuri, imagini)", () => {
    const json = {
      appnews: {
        newsitems: [
          {
            gid: "5001",
            title: "Counter-Strike 2 Update",
            url: "https://store.steampowered.com/news/app/730/view/5001",
            feedname: "steam_community_announcements",
            date: 1_793_000_000,
            contents: "[ MISC ]\n[list][*]Agents now wear gloves.[*]Fixed [b]grenade[/b] crosshair.[/list][img]{STEAM_CLAN_IMAGE}/1/a.png[/img]",
          },
          { gid: "5002", title: "Articol extern", feedname: "pcgamer", contents: "<p>altceva</p>", date: 1_793_000_100 },
        ],
      },
    };
    const items = steamItems(json);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ guid: "5001", title: "Counter-Strike 2 Update", link: "https://store.steampowered.com/news/app/730/view/5001", date: 1_793_000_000_000 });
    expect(items[0]!.html).toContain("<li>Agents now wear gloves.</li>");
    expect(items[0]!.html).toContain("<b>grenade</b>");
    expect(items[0]!.image).toBe("https://clan.cloudflare.steamstatic.com/images/1/a.png");
    expect(steamItems({ nope: true })).toEqual([]);
    expect(steamNewsUrl(730)).toBe("https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=730&count=10&maxlength=0&format=json");
  });

  test("formatul real al notelor de patch: `[*]text[/*]` și antetele `[ SECȚIUNE ]` (fără resturi de marcaj)", () => {
    const html = steamMarkupToHtml("[ MAP SCRIPTING ]\n[list][*]Added Instance.Precache[/*][*]Added CSPrecache.Release[/*][/list]");
    expect(html).toContain("<li>Added Instance.Precache</li>");
    expect(html).toContain("<li>Added CSPrecache.Release</li>");
    expect(html).toContain("[ MAP SCRIPTING ]");
    expect(html).not.toContain("[/*]");
  });

  test("HTML-ul din marcaj e escapat (un <script> din text rămâne text)", () => {
    expect(steamMarkupToHtml("[b]<script>x</script>[/b]")).toBe("<p><b>&lt;script&gt;x&lt;/script&gt;</b></p>");
  });
});

describe("orele de publicare", () => {
  test("08-23, peste miezul nopții 22-06; gol sau invalid = oricând", () => {
    const day = parseWindow("08-23");
    expect([inWindow(7, day), inWindow(8, day), inWindow(22, day), inWindow(23, day)]).toEqual([false, true, true, false]);
    const night = parseWindow("22-06");
    expect([inWindow(23, night), inWindow(3, night), inWindow(12, night)]).toEqual([true, true, false]);
    expect(parseWindow("")).toBeNull();
    expect(parseWindow("25-3")).toBeNull();
    expect(inWindow(4, null)).toBe(true);
  });
});
