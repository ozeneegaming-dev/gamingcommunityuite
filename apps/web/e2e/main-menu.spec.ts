import { expect, test, type APIRequestContext } from "@playwright/test";
import { fixture, forumTree, member, topicWithReplies, typeInEditor, uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, useFreshIp } from "./helpers";

/** Datele profilului prin ruta de test (`/api/_test/profile`, doar cu `GCS_TEST_ROUTES=1`). */
async function profileFixture(request: APIRequestContext, data: Record<string, unknown>): Promise<void> {
  const res = await request.post("/api/_test/profile", { data });
  expect(res.ok(), await res.text()).toBe(true);
}

const WIDE = { width: 1600, height: 900 };

test.describe("meniul principal", () => {
  test("pe desktop: Forum · Servere · Clanuri · Activitate · Chat · Membri ▾, apoi Clasament și VIP în „Mai mult”; submeniul Membri merge din tastatură", async ({ page, context }) => {
    await useFreshIp(context, "100.71.0");
    await page.setViewportSize(WIDE);
    const id = uid();
    await member(page, `Meniu${id}`, `meniu-${id}@example.com`);
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Principal" });
    // Bara a măsurat ce încape (după hidratare).
    await expect(nav).toHaveAttribute("data-ready", "");
    for (const name of ["Forum", "Clanuri", "Activitate", "Chat"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    // Servere are submeniu (paginile punții, `nav:v6`): e un buton.
    await expect(nav.getByRole("button", { name: "Servere", exact: true })).toBeVisible();
    // Staff a trecut în submeniul Membri. Cu aplicațiile Gaming (Servere, Clanuri), bara implicită are 8 itemi: ultimii
    // (Clasament, VIP) trec în „Mai mult” la lățimea paginii.
    await expect(nav.getByRole("link", { name: "Staff" })).toHaveCount(0);
    await expect(page.getByTestId("gcs-nav-more")).toBeVisible();
    await page.getByTestId("gcs-nav-more").click();
    await expect(page.getByRole("menu", { name: "Mai mult" }).getByRole("menuitem", { name: "VIP" })).toBeVisible();
    await page.keyboard.press("Escape");

    const trigger = nav.getByRole("button", { name: "Membri" });
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    const menu = page.getByRole("menu", { name: "Membri" });
    await expect(menu.getByRole("menuitem")).toHaveText(["Toți membrii", "Online acum", "Staff", "Clasament"]);
    await expect(menu.getByRole("menuitem", { name: "Toți membrii" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "Online acum" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/members\?online=1$/);

    // Starea activă: butonul Membri și, în submeniu, „Online acum” (nu și „Toți membrii”).
    await expect(nav.getByRole("button", { name: "Membri" })).toHaveClass(/gcs-nav__link--active/);
    await nav.getByRole("button", { name: "Membri" }).click();
    await expect(page.getByRole("menuitem", { name: "Online acum" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("menuitem", { name: "Toți membrii" })).not.toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Escape");

    // Clasament (din „Mai mult”) aprinde doar „Mai mult”, nu și Membri.
    await page.getByTestId("gcs-nav-more").click();
    await page.getByRole("menu", { name: "Mai mult" }).getByRole("menuitem", { name: "Clasament" }).click();
    await expect(page).toHaveURL(/\/leaderboard$/);
    await expect(page.getByTestId("gcs-nav-more")).toHaveClass(/gcs-nav__link--active/);
    await expect(nav.getByRole("button", { name: "Membri" })).not.toHaveClass(/gcs-nav__link--active/);
  });

  test("pe lățimi medii, butoanele care nu încap trec în „Mai mult”", async ({ page, context }) => {
    await useFreshIp(context, "100.71.1");
    const id = uid();
    await member(page, `Lat${id}`, `lat-${id}@example.com`);
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Principal" });
    await expect(nav).toHaveAttribute("data-ready", "");
    const more = page.getByTestId("gcs-nav-more");
    await expect(more).toBeVisible();
    await expect(nav.getByRole("link", { name: "VIP", exact: true })).toBeHidden();
    await more.click();
    const menu = page.getByRole("menu", { name: "Mai mult" });
    await expect(menu.getByRole("menuitem", { name: "VIP" })).toBeVisible();
    await menu.getByRole("menuitem", { name: "VIP" }).click();
    await expect(page).toHaveURL(/\/vip$/);
    // Pagina curentă e în „Mai mult”: butonul lui e activ.
    await expect(page.getByTestId("gcs-nav-more")).toHaveClass(/gcs-nav__link--active/);

    // Mai lat: încap mai mulți itemi în bară (VIP rămâne în „Mai mult”: bara implicită are 8 itemi).
    const narrow = await nav.getByRole("link").count();
    await page.setViewportSize(WIDE);
    await expect.poll(() => nav.getByRole("link").count()).toBeGreaterThan(narrow);
    await expect(nav.getByRole("link", { name: "Chat", exact: true })).toBeVisible();
  });

  test("pe mobil: sertarul cu submeniul Membri ca dezvăluire, fără dubluri, închis cu Escape", async ({ page, context }) => {
    await useFreshIp(context, "100.71.2");
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/");
    const opener = page.getByTestId("gcs-mobile-nav");
    await opener.click();
    const drawer = page.getByRole("dialog", { name: "Principal" });
    const group = drawer.getByRole("button", { name: "Membri" });
    await expect(group).toHaveAttribute("aria-expanded", "false");
    await expect(drawer.getByRole("link", { name: "Staff" })).toBeHidden();
    await group.click();
    await expect(group).toHaveAttribute("aria-expanded", "true");
    for (const name of ["Toți membrii", "Online acum", "Staff"]) await expect(drawer.getByRole("link", { name })).toBeVisible();
    // Clasament e pe primul nivel; sub Membri nu se mai repetă.
    await expect(drawer.getByRole("link", { name: "Clasament" })).toHaveCount(1);

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(opener).toBeFocused();

    await opener.click();
    await drawer.getByRole("button", { name: "Membri" }).click();
    await drawer.getByRole("link", { name: "Staff" }).click();
    await expect(page).toHaveURL(/\/staff$/);
    await opener.click();
    // Pagina curentă e în submeniu: grupul e deschis din start, cu linkul activ.
    await expect(drawer.getByRole("button", { name: "Membri" })).toHaveAttribute("aria-expanded", "true");
    await expect(drawer.getByRole("link", { name: "Staff" })).toHaveAttribute("aria-current", "page");
  });
});

test.describe("paginile noi", () => {
  test("Activitate: conținutul unui forum ascuns nu apare; filtrele; „Doar necitite” doar pentru membri", async ({ page, context, request }) => {
    await useFreshIp(context, "100.71.3");
    const id = uid();
    const email = `activ-${id}@example.com`;
    await member(page, `Activ${id}`, email);
    const open = await forumTree(request);
    const secret = await forumTree(request);
    await topicWithReplies(request, open.forum.id, email, `Public ${id}`, 1);
    await topicWithReplies(request, secret.forum.id, email, `Secret ${id}`, 1);
    // Forumul devine ascuns membrilor și vizitatorilor: nici propriile postări de acolo nu mai apar.
    for (const groupKey of ["guest", "member", "new_member"]) await fixture(request, { action: "permissions", forumId: secret.forum.id, groupKey, actions: [] });

    await page.goto("/activity");
    const stream = page.getByTestId("gcs-activity");
    await expect(stream).toContainText(`Public ${id}`);
    await expect(stream).not.toContainText(`Secret ${id}`);
    await expect(stream.getByTestId("gcs-activity-item").first()).toContainText("a răspuns în");

    await page.getByTestId("gcs-activity-filter-topics").click();
    await expect(page).toHaveURL(/type=topics/);
    await expect(stream.getByTestId("gcs-activity-item").first()).toContainText("a deschis topicul");
    await expect(stream).not.toContainText("a răspuns în");

    // Propriile postări nu sunt necitite.
    await page.getByTestId("gcs-activity-unread").click();
    await expect(page).toHaveURL(/unread=1/);
    await expect(stream).not.toContainText(`Public ${id}`);

    const guest = await (await context.browser()!.newContext()).newPage();
    await guest.goto("/activity");
    await expect(guest.getByTestId("gcs-activity")).toContainText(`Public ${id}`);
    await expect(guest.getByTestId("gcs-activity")).not.toContainText(`Secret ${id}`);
    await expect(guest.getByTestId("gcs-activity-unread")).toHaveCount(0);
    await guest.context().close();
  });

  test("Clasament: podiumul cu primele trei locuri, tabelul, perioadele; fără membrii banați", async ({ page, context }) => {
    await useFreshIp(context, "100.71.4");
    const id = uid();
    const names = ["Aur", "Argint", "Bronz", "Patru", "Banat"].map((n) => `${n}${id}`);
    await member(page, names[3]!, `lb-4-${id}@example.com`);
    for (const [i, name] of names.entries()) {
      if (i === 3) continue;
      await sql(
        `INSERT INTO users (id, name, "nameNormalized", email, "primaryGroupId", "createdAt", "updatedAt")
         VALUES ($1, $2, lower($2), $3, (SELECT id FROM groups WHERE key = $4), now(), now())`,
        [`lb${i}${id}`, name, `lb-x${i}-${id}@example.com`, i === 4 ? "banned" : "member"],
      );
    }
    const points = [9_000_004, 9_000_003, 9_000_002, 9_000_001, 9_000_009];
    for (const [i, value] of points.entries()) await sql(`UPDATE users SET points = $1 WHERE name = $2`, [value, names[i]]);

    await page.goto("/leaderboard?metric=xp&period=all");
    const podium = page.getByTestId("gcs-podium");
    await expect(podium.getByTestId("gcs-podium-place")).toHaveCount(3);
    await expect(podium.getByTestId("gcs-podium-place").nth(0)).toContainText(names[0]!);
    await expect(podium.getByTestId("gcs-podium-place").nth(1)).toContainText(names[1]!);
    await expect(podium.getByTestId("gcs-podium-place").nth(2)).toContainText(names[2]!);
    const me = page.getByTestId("gcs-leaderboard-row").first();
    await expect(me).toContainText(names[3]!);
    await expect(me).toContainText("Tu");
    await expect(page.locator("main")).not.toContainText(names[4]!);

    await page.getByRole("link", { name: "Săptămâna" }).click();
    await expect(page).toHaveURL(/metric=xp&period=week/);
    await expect(page.locator("main")).not.toContainText(names[0]!);
  });

  test("VIP: planurile cu beneficii și butonul de contact; viewer-ul VIP își vede planul și expirarea", async ({ page, context, request }) => {
    await useFreshIp(context, "100.71.5");
    const id = uid();
    const email = `vip-${id}@example.com`;
    await member(page, `Vip${id}`, email);
    await page.goto("/vip");
    await expect(page.getByTestId("gcs-vip-plan")).toHaveCount(4);
    const gold = page.locator('[data-plan="vip_gold"]');
    await expect(gold).toContainText("VIP Gold");
    await expect(gold).toContainText("Nume stilizat");
    await expect(gold.locator(".gcs-name--vip_gold")).toHaveText(`Vip${id}`);
    await expect(gold.getByTestId("gcs-vip-action")).toHaveAttribute("href", "/staff");
    await expect(page.getByTestId("gcs-vip-mine")).toHaveCount(0);

    await profileFixture(request, { action: "vip", email, groupKey: "vip_gold", days: 30 });
    await page.reload();
    await expect(page.getByTestId("gcs-vip-mine")).toContainText("VIP Gold");
    await expect(page.getByTestId("gcs-vip-mine")).toContainText(/expiră pe .*\(încă (29|30) de zile\)/);
    await expect(gold).toContainText("Planul tău");
  });

  test("Reguli: goale, pagina are o stare goală și itemul lipsește din meniu; scrise în ACP, apar peste tot", async ({ page, context }) => {
    await useFreshIp(context, "100.71.6");
    await page.setViewportSize(WIDE);
    const id = uid();
    await enterAcpAsRoot(page, `Reguli${id}`, `reguli-${id}@example.com`);
    const nav = page.getByRole("navigation", { name: "Principal" });

    await page.goto("/rules");
    await expect(page.getByTestId("gcs-rules-empty")).toContainText("Regulile nu au fost publicate încă.");
    await expect(nav.locator('a[href="/rules"]')).toHaveCount(0);
    await page.getByRole("link", { name: "Scrie regulile" }).click();
    await expect(page).toHaveURL(/\/admin\/settings\/rules$/);

    const form = page.getByTestId("gcs-rules-form");
    await typeInEditor(page, `Fără spam. Regula ${id}.`, form);
    await page.getByTestId("gcs-rules-save").click();
    await expect(form.getByText("Regulile au fost salvate.")).toBeVisible();

    await page.goto("/rules");
    await expect(page.getByTestId("gcs-rules")).toContainText(`Fără spam. Regula ${id}.`);
    await expect(page.getByTestId("gcs-rules")).toContainText("Actualizate pe");
    // Pe bară sau, dacă nu încape lângă numele lung al adminului, în „Mai mult”.
    await expect(nav.locator('a[href="/rules"]')).toHaveAttribute("aria-current", "page");

    // Ștergerea le scoate din nou (și din meniu); celelalte teste pornesc fără reguli.
    await page.goto("/admin/settings/rules");
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Șterge regulile" }).click();
    await expect(page.getByTestId("gcs-rules-form").getByText("Regulile au fost șterse.")).toBeVisible();
    await page.goto("/rules");
    await expect(page.getByTestId("gcs-rules-empty")).toBeVisible();
    await expect(nav.locator('a[href="/rules"]')).toHaveCount(0);
  });
});
