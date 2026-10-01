#!/usr/bin/env node
// @ts-check
/**
 * ramp-check CLI.
 *
 *   ramp-check [run] [--config path] [--base-url url] [--policy name] [--out dir]
 *   ramp-check baseline [same options]   (re)write the baseline from current findings
 *   ramp-check init                      scaffold a config and allowlist
 *
 * Exit codes: 0 clean, 1 findings or expired exceptions, 2 usage or config error.
 */
import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { findConfig, loadConfig } from "./config.js";
import { runSite } from "./run.js";
import { consoleReport } from "./report-console.js";
import { markdownReport } from "./report-markdown.js";
import { init } from "./init.js";

const HELP = `ramp-check: automated accessibility checks for the pages you name.

Usage:
  ramp-check [run]        run the checks from ramp-check.config.js
  ramp-check baseline     (re)write the baseline from the current findings
  ramp-check init         create ramp-check.config.js and a11y-allowlist.json

Options:
  --config <path>     config file (default: ramp-check.config.js in the cwd)
  --base-url <url>    override baseURL (preview deployments)
  --policy <name>     wcag-aaa | wcag22-aa | wcag21-aa
  --out <dir>         where to write ramp-check.json and ramp-check.md
  --no-report         skip writing report files
  --quiet             only print failures
  -h, --help

Exit codes: 0 clean, 1 findings or expired exceptions, 2 usage or config error.
`;

/**
 * @param {string[]} argv
 * @param {{ cwd?: string, stdout?: (s: string) => void, stderr?: (s: string) => void }} [io]
 * @returns {Promise<number>}
 */
export async function main(argv, io = {}) {
  const cwd = io.cwd ?? process.cwd();
  const out = io.stdout ?? ((s) => process.stdout.write(s + "\n"));
  const err = io.stderr ?? ((s) => process.stderr.write(s + "\n"));
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        config: { type: "string" },
        "base-url": { type: "string" },
        policy: { type: "string" },
        out: { type: "string" },
        "no-report": { type: "boolean" },
        quiet: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    err(HELP);
    return 2;
  }
  const { values, positionals } = parsed;
  const command = positionals[0] ?? "run";
  if (values.help) {
    out(HELP);
    return 0;
  }
  if (command === "init") {
    init(cwd, { log: out });
    return 0;
  }
  if (command !== "run" && command !== "baseline") {
    err(`Unknown command "${command}"`);
    err(HELP);
    return 2;
  }

  let config;
  try {
    config = await loadConfig(findConfig(values.config, cwd));
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    return 2;
  }
  if (values["base-url"]) config.baseURL = values["base-url"];
  if (values.policy) config.policy = /** @type {any} */ (values.policy);
  if (values.out) config.out = resolve(cwd, values.out);

  let report;
  try {
    report = await runSite(config, {
      writeBaseline: command === "baseline",
      log: values.quiet ? undefined : out,
    });
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    return 2;
  }

  out(consoleReport(report));
  if (!values["no-report"] && config.out) {
    mkdirSync(config.out, { recursive: true });
    writeFileSync(resolve(config.out, "ramp-check.json"), JSON.stringify(report, null, 2) + "\n");
    writeFileSync(resolve(config.out, "ramp-check.md"), markdownReport(report));
    out(`Reports: ${resolve(config.out, "ramp-check.json")}, ${resolve(config.out, "ramp-check.md")}`);
  }
  return report.ok ? 0 : 1;
}

// Run when invoked directly (bin), not when imported by tests.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
