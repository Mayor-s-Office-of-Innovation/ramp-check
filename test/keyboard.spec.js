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
      "summary#more-summary",
    ]);
    // The link inside the closed disclosure is not rendered, so it is not a candidate at all.
    expect(result.candidates.map((c) => c.path)).not.toContain("a#folded");
    await expect(page.locator("#plain")).toBeFocused();
    expect(new URL(page.url()).hash).toBe("");
  });

  test("a link inside a disclosure counts once the disclosure is open", async ({ page }) => {
    await page.goto("/keyboard-clean.html");
    await page.evaluate(() => { document.querySelector("#more")?.setAttribute("open", ""); });
    const result = await keyboardAudit(page);
    expect(keys(result.findings)).toEqual([]);
    expect(result.candidates.map((c) => c.path)).toContain("a#folded");
    expect(result.sequence.map((s) => s.path).slice(-2)).toEqual(["summary#more-summary", "a#folded"]);
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

  test("a delegated-focus widget's surrogate ring is a visible indicator; missing ring still fails", async ({ page }) => {
    await page.goto("/keyboard-delegated-focus.html");
    const result = await keyboardAudit(page);
    // The two widgets with :host(:focus-within) rings pass even though Tab
    // lands on a 1×1 invisible proxy input; the ringless quiet-field fails —
    // its only "change" is the UA's never-rendered 1px outline on the proxy,
    // which the pixel layer refutes (host region identical) → thin, not
    // not-visible, is the honest verdict.
    expect(keys(result.findings)).toEqual(["focus-indicator-thin quiet-field >>> input#proxy"]);
    expect(result.findings[0].wcag).toEqual({ criterion: "2.4.13", level: "AAA", version: "2.2" });
    // The audit observed the surrogate (host) region changed with focus even
    // though the proxy's own styles never moved.
    const steps = result.sequence.filter((s) => s.path.includes("otp-field"));
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps.every((s) => s.styleDiff.length > 0 || s.screenshotChanged || s.hostStyleDiff)).toBe(true);
    expect(steps.every((s) => s.obscured === "none")).toBe(true);
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

  test("no skip link ahead of a long nav is not reported; axe's bypass covers it", async ({ page }) => {
    await page.goto("/keyboard-clean.html");
    // clean.html itself has five nav links after its skip link — here the
    // audit must stay quiet regardless, since the missing-skip-link rule
    // was retired (multi-site sweep FP: consent banners occupy early Tab
    // stops and read as a missing skip link on fresh profiles).
    expect((await keyboardAudit(page)).findings).toEqual([]);
    await page.goto("/clean.html");
    expect((await keyboardAudit(page)).findings).toEqual([]);
  });

  test("a banner that swallows Tab into a closed ring yields one ring finding", async ({ page }) => {
    await page.goto("/keyboard-banner-ring.html");
    const result = await keyboardAudit(page, { screenshotFallback: false });
    // The banner's ring cut the traversal off after 2 stops; the page behind
    // it (5 nav links + button) was never offered focus.
    const ku = result.findings.filter((f) => f.rule === "keyboard-unreachable");
    expect(ku).toHaveLength(1);
    expect(ku[0].target).toBe("button#accept");
    expect(ku[0].message).toMatch(/Tab loop closed after 2 stops/);
    expect(ku[0].wcag).toEqual({ criterion: "2.1.1", level: "A", version: "2.0" });
    expect(result.ring).toEqual({ path: "button#accept", size: 2 });
    // No per-element blame for the never-reached page content.
    expect(ku[0].target).not.toMatch(/a:nth|button#btn/);
    expect(result.findings.filter((f) => f.target.includes("btn"))).toEqual([]);
  });

  test("roving-tabindex tabs: unselected siblings are exempt once the holder is reached", async ({ page }) => {
    await page.goto("/keyboard-roving-tabs.html");
    const result = await keyboardAudit(page, { screenshotFallback: false });
    // Correct tabs pattern: the selected tab is the only Tab stop; arrow keys
    // move between tabs (MDN's about page and Angular docs tablists).
    expect(result.findings.filter((f) => f.rule === "keyboard-unreachable")).toEqual([]);
    expect(result.sequence.map((s) => s.path)).toEqual(["a", "button#t1"]);
  });

  test("roving-tabindex tabs with no reachable holder stay reportable", async ({ page }) => {
    await page.setContent(
      `<main><button role="tab" aria-selected="false" tabindex="-1" id="t1">A</button>` +
      `<button role="tab" aria-selected="false" tabindex="-1" id="t2">B</button></main>`,
    );
    const result = await keyboardAudit(page, { screenshotFallback: false });
    // No tabindex=0/selected holder exists: a keyboard user has no way in at
    // all — this IS a 2.1.1 defect, not a pattern.
    expect(result.findings.map((f) => f.target).sort()).toEqual(["button#t1", "button#t2"]);
  });

  test("candidates replaced by a re-render mid-audit are not blamed", async ({ page }) => {
    await page.goto("/keyboard-rerender.html");
    // Ghost links are in the inventory; a timeout swaps the subtree while the
    // audit settles/traverses, so the originals are gone before Tab arrives.
    const result = await keyboardAudit(page, { screenshotFallback: false });
    const ku = result.findings.filter((f) => f.rule === "keyboard-unreachable");
    // The replaced candidates are dropped (connected() = false), summarized by
    // one annotation finding — not nine ghost-blame findings.
    expect(ku.every((f) => f.message.includes("replaced or removed") || f.message.includes("Tab loop") || f.message.includes("ended early"))).toBe(true);
    expect(ku.filter((f) => f.message.includes("replaced or removed")).length).toBeLessThanOrEqual(1);
    expect(ku.filter((f) => f.target.includes("ghost"))).toEqual([]);
  });

  test("a transparent stretched-link overlay does not read as obscured", async ({ page }) => {
    await page.goto("/keyboard-overlay-transparent.html");
    const result = await keyboardAudit(page, { screenshotFallback: false });
    // nuxt.com-class card: the whole-card stretched link wins elementFromPoint
    // but paints nothing, so the CTA's focus ring stays visible. Only the
    // PAINTED overlay card (2.4.11 for real) may fire — and its selector
    // collides with the transparent card's CTA, so assert via the rect.
    const fired = result.findings.filter((f) => f.rule === "focus-obscured");
    expect(fired).toHaveLength(1);
    expect(fired[0].data.rect.y).toBeGreaterThan(300); // the opaque card
    const steps = result.sequence.filter((s) => s.path.includes("cta"));
    expect(steps.filter((s) => s.path === "a.cta:nth-of-type(1)" && s.index === 0).every((s) => s.obscured === "none")).toBe(true);
  });

  test("a hidden checkbox toggled by a reachable card button is a state-holder, not unreachable", async ({ page }) => {
    await page.goto("/keyboard-state-holder.html");
    const result = await keyboardAudit(page, { screenshotFallback: false });
    const ku = result.findings.filter((f) => f.rule === "keyboard-unreachable");
    // The techcrunch-class input is exempt (Enter on the visible card button
    // flips it — probed with the real keyboard); the annotation finding
    // records the exemption instead of per-element blame. The orphan hidden
    // checkbox (no working driver) stays a finding.
    expect(ku.map((f) => f.target)).toEqual(["html", "input#mystery-opt"]);
    expect(ku[0].data.stateHolderExempt).toBe(1);
    expect(ku[0].data.via).toEqual(["card-button"]);
    // The audit restored the toggled state.
    expect(await page.evaluate(() => document.getElementById("news-daily").checked)).toBe(false);
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
