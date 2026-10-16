import { describe, expect, test } from "vitest";
import { formatDuration, formatText } from "../src/html";
import { pageNumber, parseCategories, readBody, readNewTicket, readSettings, statusAfterReply, ticketId } from "../src/model";

const settings = readSettings({ categories: "Suport\nUnban", memberPriority: true });

describe("setările", () => {
  test("categoriile: câte una pe rând, fără goluri și duplicate; lipsă = o categorie implicită", () => {
    expect(parseCategories("  Suport \n\nsuport\nUnban\n")).toEqual(["Suport", "Unban"]);
    expect(parseCategories("")).toEqual(["Suport general"]);
    expect(parseCategories(undefined)).toEqual(["Suport general"]);
  });

  test("valorile stricate primesc valorile implicite, numerele rămân în interval", () => {
    expect(readSettings({ maxOpen: "x", autoCloseDays: 500, pageSize: 1 })).toMatchObject({ maxOpen: 3, autoCloseDays: 90, pageSize: 5, allowReopen: true, memberPriority: true });
    expect(readSettings({ maxOpen: 0, allowReopen: false })).toMatchObject({ maxOpen: 0, allowReopen: false });
  });
});

describe("formularul de ticket nou", () => {
  const valid = { subject: "  Nu pot intra   pe server ", category: "Unban", priority: "high", body: "Salut,\r\n\r\n\r\nam primit ban.  \n" };

  test("curăță subiectul și mesajul; categoria trebuie să fie din setări", () => {
    expect(readNewTicket(valid, settings)).toEqual({ ok: true, value: { subject: "Nu pot intra pe server", category: "Unban", priority: "high", body: "Salut,\n\nam primit ban." } });
    expect(readNewTicket({ ...valid, category: "Altceva" }, settings)).toEqual({ ok: false, error: "category" });
    expect(readNewTicket({ ...valid, subject: "ab" }, settings)).toEqual({ ok: false, error: "subject" });
    expect(readNewTicket({ ...valid, body: " " }, settings)).toEqual({ ok: false, error: "body" });
    expect(readNewTicket({ ...valid, priority: "mega" }, settings)).toEqual({ ok: false, error: "priority" });
  });

  test("membrii nu pot alege „urgent”; fără setare, prioritatea e mereu normală", () => {
    expect(readNewTicket({ ...valid, priority: "urgent" }, settings)).toMatchObject({ ok: true, value: { priority: "high" } });
    expect(readNewTicket(valid, readSettings({ categories: "Unban", memberPriority: false }))).toMatchObject({ ok: true, value: { priority: "normal" } });
  });

  test("caracterele de control dispar; textul prea lung e refuzat", () => {
    expect(readBody({ body: "a\u0000b\u0007c" })).toBe("abc");
    expect(readBody({ body: "x".repeat(8001) })).toBeNull();
  });
});

describe("fluxul stărilor", () => {
  test("staff-ul răspunde → „Răspuns”; membrul → „În așteptare” (rămâne „În lucru” dacă e preluat); nota internă nu schimbă nimic", () => {
    expect(statusAfterReply("open", true, false)).toBe("answered");
    expect(statusAfterReply("answered", false, false)).toBe("open");
    expect(statusAfterReply("in_progress", false, false)).toBe("in_progress");
    expect(statusAfterReply("in_progress", true, true)).toBe("in_progress");
  });

  test("id-urile și paginile din adrese", () => {
    expect(ticketId("12")).toBe(12);
    expect(ticketId("012")).toBeNull();
    expect(ticketId("1; DROP")).toBeNull();
    expect(ticketId("99999999999")).toBeNull();
    expect(pageNumber("3")).toBe(3);
    expect(pageNumber("-1")).toBe(1);
  });
});

describe("HTML-ul mesajelor", () => {
  test("textul e escapat, paragrafele și linkurile https sunt păstrate", () => {
    expect(formatText('Salut <b>staff</b>\nvezi https://ex.ro/a?b=1&c=2.\n\nmulțumesc "mult"')).toBe(
      '<p>Salut &lt;b&gt;staff&lt;/b&gt;<br>vezi <a href="https://ex.ro/a?b=1&amp;c=2">https://ex.ro/a?b=1&amp;c=2</a>.</p><p>mulțumesc &quot;mult&quot;</p>',
    );
    expect(formatText("javascript:alert(1)")).toBe("<p>javascript:alert(1)</p>");
  });

  test("durata medie de răspuns", () => {
    expect(formatDuration(0)).toBe("—");
    expect(formatDuration(30)).toBe("1 min");
    expect(formatDuration(8100)).toBe("2 h 15 min");
    expect(formatDuration(3 * 86400)).toBe("3 d");
  });
});
