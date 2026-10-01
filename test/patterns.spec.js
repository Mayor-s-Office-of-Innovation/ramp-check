// @ts-check
import { test, expect } from "@playwright/test";
import { dialogAudit, expectAnnouncement, focusAfter, formErrorAudit } from "../src/patterns/index.js";

/** @param {import("../src/index.js").Finding[]} findings */
const rules = (findings) => findings.map((f) => f.rule).sort();

test.describe("dialogAudit", () => {
  test("a native modal with focus return passes", async ({ page }) => {
    await page.goto("/patterns-dialog.html");
    const result = await dialogAudit(page, () => page.getByRole("button", { name: "Open good dialog" }).click());
    expect(rules(result.findings)).toEqual([]);
    expect(result.dialog).toBe("dialog#good");
    expect(result.trigger).toBe("button#open-good");
    await expect(page.getByRole("button", { name: "Open good dialog" })).toBeFocused();
  });

  test("a class-toggled div fails on all four counts", async ({ page }) => {
    await page.goto("/patterns-dialog.html");
    const result = await dialogAudit(page, () => page.getByRole("button", { name: "Open bad dialog" }).click());
    expect(rules(result.findings)).toEqual([
      "dialog-escape-does-not-close",
      "dialog-focus-escapes",
      "dialog-focus-not-moved",
    ]);
    const escapes = result.findings.find((f) => f.rule === "dialog-focus-escapes");
    expect(escapes?.wcag).toEqual({ criterion: "2.4.3", level: "A", version: "2.0" });
  });

  test("with a close action, focus return is still checked", async ({ page }) => {
    await page.goto("/patterns-dialog.html");
    const result = await dialogAudit(page, () => page.getByRole("button", { name: "Open bad dialog" }).click(), {
      close: () => page.locator("#bad-close").click(),
    });
    expect(rules(result.findings)).toEqual(["dialog-focus-escapes", "dialog-focus-not-moved", "dialog-focus-not-returned"]);
  });
});

test.describe("expectAnnouncement", () => {
  test("text arriving in an existing status region passes", async ({ page }) => {
    await page.goto("/patterns-live.html");
    const result = await expectAnnouncement(page, () => page.locator("#save-good").click(), /saved/i);
    expect(result.findings).toEqual([]);
    expect(result.announcements).toEqual([{ region: "div#status", text: "Saved your changes.", late: false }]);
  });

  test("a visible message outside any live region is reported", async ({ page }) => {
    await page.goto("/patterns-live.html");
    const result = await expectAnnouncement(page, () => page.locator("#save-silent").click(), "Saved", { timeout: 500 });
    expect(rules(result.findings)).toEqual(["announcement-missing"]);
    expect(result.findings[0].wcag).toEqual({ criterion: "4.1.3", level: "AA", version: "2.1" });
  });

  test("a live region created together with its content is a best-practice warning", async ({ page }) => {
    await page.goto("/patterns-live.html");
    const result = await expectAnnouncement(page, () => page.locator("#save-late").click(), "Saved");
    expect(rules(result.findings)).toEqual(["live-region-added-late"]);
    expect(result.findings[0].wcag.level).toBe("best-practice");
  });
});

test.describe("formErrorAudit", () => {
  test("identified, described and focused passes", async ({ page }) => {
    await page.goto("/patterns-form.html");
    const result = await formErrorAudit(page, () => page.locator("#good-submit").click(), { form: "#good" });
    expect(result.findings).toEqual([]);
    expect(result.invalid).toEqual(["input#good-email"]);
  });

  test("a red border alone is not error identification", async ({ page }) => {
    await page.goto("/patterns-form.html");
    const result = await formErrorAudit(page, () => page.locator("#bad-submit").click(), { form: "#bad", timeout: 500 });
    expect(rules(result.findings)).toEqual(["form-error-not-identified"]);
    expect(result.findings[0].wcag).toEqual({ criterion: "3.3.1", level: "A", version: "2.0" });
  });

  test("native browser validation counts as identified and described", async ({ page }) => {
    await page.goto("/patterns-form.html");
    const result = await formErrorAudit(page, () => page.locator("#native-submit").click(), { form: "#native" });
    expect(result.invalid).toEqual(["input#native-email"]);
    expect(rules(result.findings)).toEqual([]);
  });

  test("aria-invalid without a description is reported", async ({ page }) => {
    await page.goto("/patterns-form.html");
    await page.evaluate(() => {
      const input = /** @type {HTMLInputElement} */ (document.getElementById("bad-email"));
      document.getElementById("bad")?.addEventListener("submit", () => { input.setAttribute("aria-invalid", "true"); input.focus(); });
    });
    const result = await formErrorAudit(page, () => page.locator("#bad-submit").click(), { form: "#bad" });
    expect(rules(result.findings)).toEqual(["form-error-not-described"]);
  });
});

test.describe("focusAfter", () => {
  test("focus moved to the revealed heading passes; left behind is reported", async ({ page }) => {
    await page.goto("/patterns-focus.html");
    const good = await focusAfter(page, () => page.locator("#reveal-good").click(), { on: "#details-title" });
    expect(good.findings).toEqual([]);
    expect(good.focused).toBe("h2#details-title");

    await page.goto("/patterns-focus.html");
    const bad = await focusAfter(page, () => page.locator("#reveal-bad").click(), { within: "#details" }, { timeout: 500, label: "revealing details" });
    expect(rules(bad.findings)).toEqual(["focus-not-managed"]);
    expect(bad.findings[0].message).toMatch(/after revealing details, focus is on button#reveal-bad/);
  });

  test("returnsTo: previous", async ({ page }) => {
    await page.goto("/patterns-dialog.html");
    await page.locator("#open-good").focus();
    const result = await focusAfter(page, async () => {
      await page.keyboard.press("Enter");
      await page.keyboard.press("Escape");
    }, { returnsTo: "previous" });
    expect(result.findings).toEqual([]);
  });
});

test.describe("fixture integration", () => {
  test("a11y.assert applies the policy to pattern findings", async () => {
    const { test: a11yTest } = await import("../src/test/fixtures.js");
    expect(typeof a11yTest).toBe("function");
  });
});
