// @ts-check
/**
 * Patterns: behaviours that need a spec author to describe the action.
 *
 *   import { dialogAudit, focusAfter, expectAnnouncement, formErrorAudit } from "ramp-check/patterns";
 *
 * Each returns `{ findings, ... }` with findings of check "pattern". With the
 * fixtures, `await a11y.assert("checkout dialog", result.findings)` applies
 * the policy and the allowlist and fails the test on blocking findings.
 */
import { domRuntime } from "../checks/dom.js";

/** @typedef {import("@playwright/test").Page} Page */
/** @typedef {import("@playwright/test").Locator} Locator */
/** @typedef {import("../types.js").Finding} Finding */
/** @typedef {() => Promise<unknown> | unknown} Action */

const understanding = "https://www.w3.org/WAI/WCAG22/Understanding/";
const A = /** @type {const} */ ({ level: "A", version: "2.0" });

/** @param {Page} page */
const install = (page) => page.evaluate(domRuntime);

/** @param {Page} page @returns {Promise<string>} */
const activePath = (page) => page.evaluate(() => /** @type {any} */ (window).__rampCheckDom.activePath());

/**
 * Poll an in-page predicate.
 * @template T
 * @param {() => Promise<T>} probe
 * @param {(v: T) => boolean} ok
 * @param {number} timeout
 */
async function until(probe, ok, timeout) {
  const deadline = Date.now() + timeout;
  let last = await probe();
  while (!ok(last) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    last = await probe();
  }
  return last;
}

/**
 * Resolve a selector or Locator to a stable in-page reference by tagging it.
 * @param {Page} page
 * @param {string | Locator} target
 * @returns {Promise<string>} a `data-ramp-check-ref` token, "" if not found
 */
async function ref(page, target) {
  const token = `r${Math.random().toString(36).slice(2, 8)}`;
  if (typeof target === "string") {
    const found = await page.evaluate(([sel, t]) => {
      const dom = /** @type {any} */ (window).__rampCheckDom;
      // Prefer a visible match; fall back to any match, since the target may
      // be hidden until the action runs.
      const el = dom.find(sel) ?? dom.allElements().find((/** @type {Element} */ e) => e.matches(sel)) ?? null;
      if (el) el.setAttribute("data-ramp-check-ref", t);
      return !!el;
    }, [target, token]);
    return found ? token : "";
  }
  if ((await target.count()) === 0) return "";
  await target.first().evaluate((el, t) => el.setAttribute("data-ramp-check-ref", t), token);
  return token;
}

/** @param {Page} page @param {string} token */
const unref = (page, token) =>
  token ? page.evaluate((t) => document.querySelector(`[data-ramp-check-ref="${t}"]`)?.removeAttribute("data-ramp-check-ref"), token) : undefined;

/**
 * @typedef {{ on: string | Locator } | { within: string | Locator } | { returnsTo: "previous" | string | Locator }} FocusExpectation
 */

/**
 * After `action`, focus must land where the expectation says: on an element,
 * inside a region, or back on the previously focused element (2.4.3).
 * @param {Page} page
 * @param {Action} action
 * @param {FocusExpectation} expectation
 * @param {{ timeout?: number, label?: string }} [opts]
 * @returns {Promise<{ findings: Finding[], focused: string }>}
 */
export async function focusAfter(page, action, expectation, opts = {}) {
  await install(page);
  const timeout = opts.timeout ?? 2000;
  const before = await activePath(page);
  let token = "";
  if ("on" in expectation) token = await ref(page, expectation.on);
  else if ("within" in expectation) token = await ref(page, expectation.within);
  else if (expectation.returnsTo !== "previous") token = await ref(page, expectation.returnsTo);
  const mode = "on" in expectation ? "on" : "within" in expectation ? "within" : "returnsTo";

  await action();
  const ok = await until(
    () => page.evaluate(([t, m, prev]) => {
      const dom = /** @type {any} */ (window).__rampCheckDom;
      const active = dom.deepActive();
      if (!active) return false;
      if (m === "returnsTo" && !t) return dom.pathFor(active) === prev;
      const target = document.querySelector(`[data-ramp-check-ref="${t}"]`);
      if (!target) return false;
      return m === "within" ? dom.contains(target, active) : active === target;
    }, [token, mode, before]),
    (v) => v === true,
    timeout,
  );
  const focused = await activePath(page);
  await unref(page, token);
  /** @type {Finding[]} */
  const findings = [];
  if (!ok) {
    const want = mode === "on" ? "the named element" : mode === "within" ? "inside the named region" : "back on the element that had it";
    findings.push({
      check: "pattern",
      rule: "focus-not-managed",
      target: focused || "body",
      message: `after ${opts.label ?? "the action"}, focus is on ${focused || "nothing"}; expected it ${want}`,
      wcag: { criterion: "2.4.3", ...A },
      help: `${understanding}focus-order.html`,
      data: { before, focused, expectation: mode },
    });
  }
  return { findings, focused };
}

/**
 * @typedef {object} DialogAuditOptions
 * @property {string | Locator} [dialog]  the dialog element; default: the first visible <dialog open>, [role=dialog] or [role=alertdialog]
 * @property {Action} [close]            how to close it; default: press Escape
 * @property {boolean} [expectEscape]    report when Escape does not close (default true; set false for dialogs that must not be dismissable)
 * @property {number} [timeout]
 */

/**
 * Open a dialog and check the four things screen reader and keyboard users
 * need: focus moves inside, Tab stays inside, closing works, focus returns to
 * the trigger.
 * @param {Page} page
 * @param {Action} open
 * @param {DialogAuditOptions} [opts]
 * @returns {Promise<{ findings: Finding[], dialog: string, trigger: string }>}
 */
export async function dialogAudit(page, open, opts = {}) {
  await install(page);
  const timeout = opts.timeout ?? 2000;
  /** @type {Finding[]} */
  const findings = [];

  await open();
  const dialogSel = typeof opts.dialog === "string" ? opts.dialog : "dialog[open], [role=dialog], [role=alertdialog]";
  let token = "";
  if (opts.dialog && typeof opts.dialog !== "string") {
    await opts.dialog.waitFor({ timeout }).catch(() => {});
    token = await ref(page, opts.dialog);
  } else {
    await until(() => page.evaluate((s) => !!/** @type {any} */ (window).__rampCheckDom.find(s), dialogSel), (v) => v, timeout);
    token = await ref(page, dialogSel);
  }
  if (!token) throw new Error(`dialogAudit: no dialog appeared after the open action (looked for ${dialogSel})`);
  // In-page lookups. Evaluate callbacks are serialised, so each one resolves
  // the runtime and the dialog element itself.
  /** @param {string} t */
  const inDialog = (t) => page.evaluate((t) => {
    const dom = /** @type {any} */ (window).__rampCheckDom;
    return dom.contains(document.querySelector(`[data-ramp-check-ref="${t}"]`), dom.deepActive());
  }, t);
  const dialogPath = await page.evaluate((t) => /** @type {any} */ (window).__rampCheckDom.pathFor(document.querySelector(`[data-ramp-check-ref="${t}"]`)), token);
  const trigger = await page.evaluate((t) => {
    const dom = /** @type {any} */ (window).__rampCheckDom;
    return dom.pathFor(dom.lastFocusOutside(document.querySelector(`[data-ramp-check-ref="${t}"]`)));
  }, token);

  // 1. Focus moves inside.
  const inside = await until(() => inDialog(token), (v) => v === true, timeout);
  if (!inside) {
    findings.push({
      check: "pattern",
      rule: "dialog-focus-not-moved",
      target: dialogPath,
      message: `focus stayed on ${(await activePath(page)) || "nothing"} after the dialog opened; move it to the dialog or its first control`,
      wcag: { criterion: "2.4.3", ...A },
      help: `${understanding}focus-order.html`,
    });
    await page.evaluate((t) => {
      const dom = /** @type {any} */ (window).__rampCheckDom;
      const el = document.querySelector(`[data-ramp-check-ref="${t}"]`);
      const first = dom.tabbables(el)[0] ?? el;
      first.focus?.();
    }, token);
  }

  // 2. Tab stays inside.
  const count = await page.evaluate((t) => /** @type {any} */ (window).__rampCheckDom.tabbables(document.querySelector(`[data-ramp-check-ref="${t}"]`)).length, token);
  let escaped = "";
  for (let i = 0; i < count + 2 && !escaped; i++) {
    await page.keyboard.press("Tab");
    if (!(await inDialog(token))) escaped = await activePath(page);
  }
  if (!escaped) {
    await page.keyboard.press("Shift+Tab");
    if (!(await inDialog(token))) escaped = `${await activePath(page)} (Shift+Tab)`;
  }
  if (escaped) {
    findings.push({
      check: "pattern",
      rule: "dialog-focus-escapes",
      target: dialogPath,
      message: `Tab moved focus out of the dialog to ${escaped || "body"}; make the background inert or wrap focus`,
      wcag: { criterion: "2.4.3", ...A },
      help: "https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/",
    });
  }

  // 3. Close.
  if (opts.close) await opts.close();
  else await page.keyboard.press("Escape");
  const closed = await until(
    () => page.evaluate((t) => {
      const dom = /** @type {any} */ (window).__rampCheckDom;
      const el = document.querySelector(`[data-ramp-check-ref="${t}"]`);
      return !el || !el.isConnected || !dom.visible(el) || (el.localName === "dialog" && !el.hasAttribute("open"));
    }, token),
    (v) => v === true,
    timeout,
  );
  if (!closed) {
    if (!opts.close && opts.expectEscape !== false) {
      findings.push({
        check: "pattern",
        rule: "dialog-escape-does-not-close",
        target: dialogPath,
        message: "Escape did not close the dialog",
        wcag: { criterion: "", level: "best-practice", version: "2.0" },
        help: "https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/",
      });
    } else if (opts.close) {
      findings.push({
        check: "pattern",
        rule: "dialog-does-not-close",
        target: dialogPath,
        message: "the close action left the dialog open",
        wcag: { criterion: "", level: "best-practice", version: "2.0" },
      });
    }
    await unref(page, token);
    return { findings, dialog: dialogPath, trigger };
  }

  // 4. Focus returns to the trigger.
  const returned = await until(() => activePath(page), (p) => p === trigger && trigger !== "", timeout);
  if (returned !== trigger || !trigger) {
    findings.push({
      check: "pattern",
      rule: "dialog-focus-not-returned",
      target: dialogPath,
      message: `after closing, focus is on ${returned || "nothing"}; expected the trigger ${trigger || "(unknown)"}`,
      wcag: { criterion: "2.4.3", ...A },
      help: `${understanding}focus-order.html`,
      data: { trigger, returned },
    });
  }
  await unref(page, token);
  return { findings, dialog: dialogPath, trigger };
}

/**
 * The action must produce text in a live region that matches `pattern`
 * (4.1.3 Status Messages). Live regions are observed before the action, since
 * a region that is created together with its content is often not announced.
 * @param {Page} page
 * @param {Action} action
 * @param {string | RegExp} pattern
 * @param {{ timeout?: number, label?: string }} [opts]
 * @returns {Promise<{ findings: Finding[], announcements: { region: string, text: string, late: boolean }[] }>}
 */
export async function expectAnnouncement(page, action, pattern, opts = {}) {
  await install(page);
  const timeout = opts.timeout ?? 3000;
  await page.evaluate(() => {
    const w = /** @type {any} */ (window);
    const dom = w.__rampCheckDom;
    const LIVE = "[aria-live]:not([aria-live=off]), [role=status], [role=alert], [role=log], output";
    /** @type {{ region: string, text: string, late: boolean }[]} */
    const log = (w.__rampCheckAnnouncements = []);
    const existing = new Set(dom.allElements().filter((/** @type {Element} */ el) => el.matches(LIVE)));
    const observer = new MutationObserver(() => {
      for (const el of dom.allElements()) {
        if (!el.matches(LIVE)) continue;
        const text = (el.textContent ?? "").trim();
        if (!text) continue;
        const late = !existing.has(el);
        if (!log.some((e) => e.region === dom.pathFor(el) && e.text === text)) log.push({ region: dom.pathFor(el), text, late });
      }
    });
    observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["aria-live", "role"] });
    for (const el of dom.allElements()) if (el.shadowRoot) observer.observe(el.shadowRoot, { childList: true, characterData: true, subtree: true });
    w.__rampCheckAnnouncementObserver = observer;
  });
  const source = typeof pattern === "string" ? { s: pattern } : { re: pattern.source, flags: pattern.flags };

  await action();
  /** @type {{ region: string, text: string, late: boolean }[]} */
  const log = await until(
    () => page.evaluate(() => /** @type {{ region: string, text: string, late: boolean }[]} */ (/** @type {any} */ (window).__rampCheckAnnouncements ?? [])),
    (entries) => entries.some((/** @type {{ text: string }} */ e) => matches(e.text, source)),
    timeout,
  );
  await page.evaluate(() => /** @type {any} */ (window).__rampCheckAnnouncementObserver?.disconnect());

  /** @type {Finding[]} */
  const findings = [];
  const hit = log.find((e) => matches(e.text, source));
  if (!hit) {
    const seen = log.length ? log.map((e) => `${e.region}: "${e.text}"`).join("; ") : "no live region changed";
    findings.push({
      check: "pattern",
      rule: "announcement-missing",
      target: "live regions",
      message: `after ${opts.label ?? "the action"}, no live region received text matching ${String(pattern)} (${seen})`,
      wcag: { criterion: "4.1.3", level: "AA", version: "2.1" },
      help: `${understanding}status-messages.html`,
      data: { announcements: log },
    });
  } else if (hit.late) {
    findings.push({
      check: "pattern",
      rule: "live-region-added-late",
      target: hit.region,
      message: `the matching text appeared in a live region created at the same time; screen readers often skip those. Render the region empty up front and fill it later`,
      wcag: { criterion: "4.1.3", level: "best-practice", version: "2.1" },
      help: `${understanding}status-messages.html`,
      data: { announcement: hit },
    });
  }
  return { findings, announcements: log };
}

/** @param {string} text @param {{ s?: string, re?: string, flags?: string }} src */
function matches(text, src) {
  return src.s !== undefined ? text.includes(src.s) : new RegExp(src.re ?? "", src.flags).test(text);
}

/**
 * Submit a form invalidly and check the errors are identified, described in
 * text, and that focus goes somewhere useful (3.3.1).
 * @param {Page} page
 * @param {Action} submit
 * @param {{ form?: string | Locator, timeout?: number }} [opts]
 * @returns {Promise<{ findings: Finding[], invalid: string[] }>}
 */
export async function formErrorAudit(page, submit, opts = {}) {
  await install(page);
  const timeout = opts.timeout ?? 2000;
  const formToken = opts.form ? await ref(page, opts.form) : "";
  await submit();
  const probe = () =>
    page.evaluate((t) => {
      const dom = /** @type {any} */ (window).__rampCheckDom;
      const scope = t ? document.querySelector(`[data-ramp-check-ref="${t}"]`) ?? document : document;
      /** @type {Element[]} */
      const fields = dom.allElements().filter((/** @type {Element} */ el) =>
        dom.contains(scope === document ? document.documentElement : scope, el) &&
        el.matches("input, select, textarea, [role=textbox], [role=combobox], [role=checkbox], [role=radio]") &&
        (el.getAttribute("aria-invalid") === "true" || el.matches(":user-invalid")));
      return fields.map((el) => {
        const ids = `${el.getAttribute("aria-describedby") ?? ""} ${el.getAttribute("aria-errormessage") ?? ""}`.split(/\s+/).filter(Boolean);
        const described = ids.map((id) => (document.getElementById(id)?.textContent ?? "").trim()).filter(Boolean);
        const native = /** @type {HTMLInputElement} */ (el).validationMessage ?? "";
        return { path: dom.pathFor(el), described, native, focused: dom.deepActive() === el };
      });
    }, formToken);
  const fields = await until(probe, (f) => f.length > 0, timeout);
  const focusedPath = await activePath(page);
  const focusOnAlert = await page.evaluate(() => {
    const dom = /** @type {any} */ (window).__rampCheckDom;
    const el = dom.deepActive();
    return !!el && !!el.closest("[role=alert], [role=alertdialog], [aria-live=assertive]");
  });
  await unref(page, formToken);

  /** @type {Finding[]} */
  const findings = [];
  if (!fields.length) {
    findings.push({
      check: "pattern",
      rule: "form-error-not-identified",
      target: "form",
      message: "after an invalid submit, no field is marked invalid (aria-invalid=\"true\" or :user-invalid)",
      wcag: { criterion: "3.3.1", ...A },
      help: `${understanding}error-identification.html`,
    });
    return { findings, invalid: [] };
  }
  for (const f of fields) {
    if (!f.described.length && !f.native) {
      findings.push({
        check: "pattern",
        rule: "form-error-not-described",
        target: f.path,
        message: "marked invalid but no text describes the error; point aria-describedby or aria-errormessage at the message",
        wcag: { criterion: "3.3.1", ...A },
        help: `${understanding}error-identification.html`,
      });
    }
  }
  if (!fields[0].focused && !focusOnAlert) {
    findings.push({
      check: "pattern",
      rule: "form-error-focus",
      target: fields[0].path,
      message: `focus is on ${focusedPath || "nothing"} after the invalid submit; move it to the first invalid field or an error summary`,
      wcag: { criterion: "2.4.3", level: "best-practice", version: "2.0" },
      help: "https://www.w3.org/WAI/WCAG22/Techniques/general/G83",
    });
  }
  return { findings, invalid: fields.map((f) => f.path) };
}
