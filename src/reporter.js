// @ts-check
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { HtmlReport } from "./report/html.js";

/** @typedef {import('@playwright/test/reporter').Reporter} Reporter */
/** @implements {Reporter} */
export default class RampCheckReporter {
  /** @param {{outputFolder?: string}} [options] */
  constructor(options = {}) {
    this.outputFolder = resolve(options.outputFolder ?? "ramp-check-report");
    this.report = new HtmlReport();
  }
  /** @param {import('@playwright/test/reporter').TestCase} test
   * @param {import('@playwright/test/reporter').TestResult} result */
  onTestEnd(test, result) {
    this.report.addResult(
      test.titlePath().filter(Boolean).join(" / "),
      result,
      test.annotations,
    );
  }
  /** @param {import('@playwright/test/reporter').TestError} error */
  onError(error) {
    this.report.addError(error);
  }
  /** @param {import('@playwright/test/reporter').FullResult} result */
  onEnd(result) {
    mkdirSync(this.outputFolder, { recursive: true });
    writeFileSync(
      resolve(this.outputFolder, "index.html"),
      this.report.render(result.status),
    );
  }
  printsToStdio() {
    return false;
  }
}
