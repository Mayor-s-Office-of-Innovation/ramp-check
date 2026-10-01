// @ts-check
import { test, expect } from "@playwright/test";
import { keyboardAudit, runChecks } from "../src/index.js";

/** @param {import("../src/index.js").Finding[]} findings */
const keys = (findings) => findings.map((f) => `${f.rule} ${f.target}`).sort();

test.describe("keyboard audit", () => {
  test("stays quiet on the clean page and restores focus and URL", async ({ page }) => {
    await page.goto("/keyboard-clean.html");
    await page.locator("#plain").focus();
    const result = await keyboardAudit(page);
    expect(keys(result.findings)).toEqual([]);
    expect(result.terminated).toBe("end");
    expect(result.skipLink).toEqual({ present: true, path: "a.skip", works: true });
    // Composite members with tabindex=-1 and the radio siblings are exempt, the shadow button is reached.
    expect(result.sequence.map((s) => s.path)).toEqual([
      "a.skip",
      "a:nth-of-type(1)", "a:nth-of-type(2)", "a:nth-of-type(3)", "a:nth-of-type(4)", "a:nth-of-type(5)",
      "button#tab-a",
      "input",
      "li:nth-of-type(1)",
      "fancy-button >>> button#shadow-btn",
      "button#plain",
    ]);
    await expect(page.locator("#plain")).toBeFocused();
    expect(new URL(page.url()).hash).toBe("");
  });

  test("the clean page also passes the full check set at AAA", async ({ page }) => {
    await page.goto("/keyboard-clean.html");
    const result = await runChecks(page, { policy: "wcag-aaa" });
    expect(keys(result.blocking)).toEqual([]);
    expect(keys(result.warnings)).toEqual([]);
    expect(result.ran).toEqual(["axe", "reflow", "textSpacing", "keyboard"]);
  });

  test("reports unreachable controls with the reason", async ({ page }) => {
    await page.goto("/keyboard-unreachable.html");
    const result = await keyboardAudit(page);
    expect(keys(result.findings)).toEqual([
      "keyboard-unreachable a#minus-one",
      "keyboard-unreachable div#click-div",
      "keyboard-unreachable span#role-span",
      "positive-tabindex button#jumps-queue",
    ]);
    // Positive tabindex comes first in the sequence, found on the wrap pass.
    expect(result.sequence.map((s) => s.path)).toContain("button#jumps-queue");
    expect(result.findings.find((f) => f.rule === "positive-tabindex")?.wcag.criterion).toBe("2.4.3");
    const byTarget = Object.fromEntries(result.findings.map((f) => [f.target, f.message]));
    expect(byTarget["div#click-div"]).toMatch(/onclick/);
    expect(byTarget["span#role-span"]).toMatch(/role="button"/);
    expect(byTarget["a#minus-one"]).toMatch(/tabindex="-1"/);
    expect(result.findings.find((f) => f.rule === "keyboard-unreachable")?.wcag).toEqual({ criterion: "2.1.1", level: "A", version: "2.0" });
  });

  test("detects a Tab-swallowing trap and does not blame the elements behind it", async ({ page }) => {
    await page.goto("/keyboard-trap.html");
    const result = await keyboardAudit(page);
    expect(result.terminated).toBe("trap");
    expect(keys(result.findings)).toEqual(["keyboard-trap input#tags"]);
    expect(result.findings[0].wcag.criterion).toBe("2.1.2");
  });

  test("invisible focus fails AA; a thin outline is an AAA heuristic; a shadow ring passes", async ({ page }) => {
    await page.goto("/keyboard-focus-invisible.html");
    const result = await keyboardAudit(page);
    expect(keys(result.findings)).toEqual([
      "focus-indicator-thin button#thin",
      "focus-not-visible button#none",
    ]);
    const none = result.findings.find((f) => f.rule === "focus-not-visible");
    expect(none?.wcag).toEqual({ criterion: "2.4.7", level: "AA", version: "2.0" });
    const thin = result.findings.find((f) => f.rule === "focus-indicator-thin");
    expect(thin?.wcag).toEqual({ criterion: "2.4.13", level: "AAA", version: "2.2" });
  });

  test("focus hidden under a fixed banner, fully and partly", async ({ page }) => {
    await page.goto("/keyboard-focus-obscured.html");
    const result = await keyboardAudit(page);
    expect(keys(result.findings)).toEqual([
      "focus-obscured a#hidden",
      "focus-partially-obscured a#half",
    ]);
    expect(result.findings.find((f) => f.rule === "focus-obscured")?.wcag).toEqual({
      criterion: "2.4.11", level: "AA", version: "2.2",
    });
  });

  test("a skip link whose target does not exist", async ({ page }) => {
    await page.goto("/keyboard-skip-link.html");
    const result = await keyboardAudit(page);
    expect(keys(result.findings)).toEqual(["skip-link-broken a.skip"]);
    expect(result.findings[0].message).toMatch(/no element has that id/);
    expect(result.skipLink.works).toBe(false);
  });

  test("no skip link ahead of a long nav is a best-practice finding", async ({ page }) => {
    await page.goto("/keyboard-no-skip-link.html");
    const result = await keyboardAudit(page);
    expect(keys(result.findings)).toEqual(["skip-link-missing a:nth-of-type(1)"]);
    expect(result.findings[0].wcag.level).toBe("best-practice");
    // One nav link, as on clean.html, is below the threshold.
    await page.goto("/clean.html");
    expect((await keyboardAudit(page)).findings).toEqual([]);
  });

  test("the policy decides: under 2.1 AA, obscured focus and thin outlines warn", async ({ page }) => {
    await page.goto("/keyboard-focus-obscured.html");
    const result = await runChecks(page, { policy: "wcag21-aa", checks: { axe: "off", reflow: "off" } });
    expect(keys(result.blocking)).toEqual([]);
    expect(keys(result.warnings)).toEqual(["focus-obscured a#hidden", "focus-partially-obscured a#half"]);
  });

  test("tabbing through an iframe's contents is not a trap", async ({ page }) => {
    await page.goto("/keyboard-iframe.html");
    const result = await keyboardAudit(page);
    expect(keys(result.findings)).toEqual([]);
    expect(result.sequence.map((s) => s.path)).toEqual(["button#before", "iframe#frame", "button#after"]);
    expect(result.terminated).toBe("end");
  });

  test("an element that navigates on focus is reported and stops the audit", async ({ page }) => {
    await page.goto("/keyboard-focus-navigates.html");
    const result = await keyboardAudit(page);
    // Whether the select itself gets recorded before the document is torn down is a race.
    expect(result.findings.map((f) => f.rule)).toEqual(["focus-changes-context"]);
    expect(result.findings[0].target).toMatch(/^(button#first|select#jump)$/);
    expect(result.findings[0].wcag).toEqual({ criterion: "3.2.1", level: "A", version: "2.0" });
    expect(result.findings[0].message).toMatch(/clean\.html/);
    expect(page.url()).toMatch(/clean\.html$/);
  });

  test("restores scroll position", async ({ page }) => {
    await page.goto("/keyboard-focus-obscured.html");
    await page.evaluate(() => window.scrollTo(0, 600));
    await keyboardAudit(page);
    expect(await page.evaluate(() => window.scrollY)).toBe(600);
  });

  test("scopes to an aria-modal dialog that is not a native <dialog>", async ({ page }) => {
    await page.goto("/keyboard-clean.html");
    await page.evaluate(() => {
      const d = document.createElement("div");
      d.setAttribute("role", "dialog");
      d.setAttribute("aria-modal", "true");
      d.id = "custom";
      d.innerHTML = '<p>Modal</p><button id="ok">OK</button><button id="cancel">Cancel</button>';
      document.body.append(d);
      document.getElementById("ok")?.focus();
    });
    const result = await keyboardAudit(page);
    expect(result.modal).toBe("div#custom");
    expect(result.candidates.map((c) => c.path)).toEqual(["button#ok", "button#cancel"]);
    expect(keys(result.findings)).toEqual([]);
  });

  test("scopes to an open modal dialog", async ({ page }) => {
    await page.goto("/keyboard-clean.html");
    await page.evaluate(() => {
      const d = document.createElement("dialog");
      d.innerHTML = '<p>Modal</p><button id="ok">OK</button><button id="cancel">Cancel</button>';
      document.body.append(d);
      d.showModal();
    });
    const result = await keyboardAudit(page);
    expect(result.modal).toBe("dialog");
    expect(result.candidates.map((c) => c.path)).toEqual(["button#ok", "button#cancel"]);
    expect(keys(result.findings)).toEqual([]);
    expect(result.sequence.map((s) => s.path)).toEqual(["button#ok", "button#cancel"]);
    expect(["end", "cycle"]).toContain(result.terminated);
  });
});
