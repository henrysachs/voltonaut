import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../../..");

const DECISIONS = join(ROOT, "docs/decisions");

/**
 * The decision state an ADR status text starts with (after leading symbols such as "⛔"). The rest
 * of a status (dates, scope, open pilots) is free text and is not compared. The prefixes are the
 * ones the 34 ADRs and their index rows used on 2026-11-27; a new wording must be added here
 * deliberately, so an unknown prefix fails instead of silently counting as decided.
 */
type Decision = "proposed" | "superseded" | "decided";

const PREFIXES: readonly (readonly [prefix: string, decision: Decision])[] = [
  ["Vorgeschlagen", "proposed"],
  ["Ersetzt", "superseded"],
  ["Abgelöst", "superseded"],
  ["Angenommen", "decided"],
  // Also matches "Gewählte Form …", "Gewählte Softwareform …".
  ["Gewählt", "decided"],
  ["Für E10-02 gewählt", "decided"],
  ["Umsetzung", "decided"],
  ["Von Henry", "decided"],
  // Index rows only: they summarize the decided ADR with its delivery state.
  ["Hosting angenommen", "decided"],
  ["App und Pilot-Policy eingerichtet", "decided"],
  ["Softwaregeprüft", "decided"],
];

function decisionOf(status: string): Decision | undefined {
  const text = status.replace(/^[^\p{L}]+/u, "");

  return PREFIXES.find(([prefix]) => text.startsWith(prefix))?.[1];
}

function unknownPrefix(where: string, status: string): readonly string[] {
  return decisionOf(status) === undefined
    ? [
        `${where}: status "${status}" starts with no known prefix (${PREFIXES.map(([prefix]) => prefix).join(", ")}); add it to PREFIXES in apps/web/src/consistency/adr-index.test.ts with its decision`,
      ]
    : [];
}

interface Adr {
  readonly file: string;
  readonly number: string;
  readonly heading: string;
  readonly status: string | undefined;
}

interface IndexRow {
  readonly number: string;
  readonly file: string;
  readonly status: string;
}

function readAdrs(): readonly Adr[] {
  const adrs: Adr[] = [];

  for (const file of readdirSync(DECISIONS).toSorted()) {
    const number = /^ADR-(\d{3})-[\w-]+\.md$/u.exec(file)?.[1];

    if (number === undefined) continue;

    const text = readFileSync(join(DECISIONS, file), "utf8");

    adrs.push({
      file,
      number,
      heading: text.split("\n", 1)[0] ?? "",
      status: /^(?:- )?(?:\*\*)?Status:(?:\*\*)?\s*(.+)$/mu.exec(text)?.[1],
    });
  }

  return adrs;
}

/** Index rows: `| [NNN](ADR-NNN-slug.md) | Titel | Status |`. */
function readIndex(): readonly IndexRow[] {
  const rows: IndexRow[] = [];
  const pattern = /^\| \[(\d{3})\]\(([^)]+)\) \|.*\| ([^|]+?) \|$/gmu;

  for (const row of readFileSync(join(DECISIONS, "README.md"), "utf8").matchAll(pattern)) {
    rows.push({ number: row[1] ?? "", file: row[2] ?? "", status: row[3] ?? "" });
  }

  return rows;
}

const ADRS = readAdrs();

const INDEX = readIndex();

function markdownOutsideDecisions(directory: string): readonly string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "decisions") files.push(...markdownOutsideDecisions(path));
    } else if (entry.name.endsWith(".md")) {
      files.push(path);
    }
  }

  return files;
}

function numberingFindings(): readonly string[] {
  const findings: string[] = [];
  const numbers = ADRS.map((adr) => adr.number);

  for (const adr of ADRS) {
    if (numbers.indexOf(adr.number) !== numbers.lastIndexOf(adr.number)) {
      findings.push(`${adr.file}: ADR-${adr.number} is taken twice; take the next free number`);
    }

    if (!adr.heading.startsWith(`# ADR-${adr.number} `)) {
      findings.push(`${adr.file}: heading "${adr.heading}" does not name ADR-${adr.number}`);
    }

    if (adr.status === undefined) findings.push(`${adr.file}: no "Status:" line`);
    else findings.push(...unknownPrefix(adr.file, adr.status));
  }

  return findings;
}

function indexFindings(): readonly string[] {
  const findings: string[] = [];
  const files = ADRS.map((adr) => adr.file);
  const indexed = INDEX.map((row) => row.file);

  for (const file of files) {
    const rows = indexed.filter((entry) => entry === file).length;

    if (rows !== 1) findings.push(`README.md lists ${file} ${rows} times instead of once`);
  }

  for (const row of INDEX) {
    if (!files.includes(row.file)) findings.push(`README.md links ${row.file}, which is missing`);

    if (!row.file.startsWith(`ADR-${row.number}-`)) {
      findings.push(`README.md row ${row.number} links ${row.file}`);
    }
  }

  return findings;
}

function indexStatusFindings(): readonly string[] {
  const findings: string[] = [];

  for (const row of INDEX) {
    findings.push(...unknownPrefix(`README.md row ${row.number}`, row.status));

    const status = ADRS.find((adr) => adr.file === row.file)?.status;
    const indexed = decisionOf(row.status);
    const filed = status === undefined ? undefined : decisionOf(status);

    if (indexed !== undefined && filed !== undefined && indexed !== filed) {
      findings.push(
        `README.md row ${row.number} says ${indexed} ("${row.status}"), ${row.file} says ${filed} ("${status ?? ""}")`,
      );
    }
  }

  return findings;
}

/**
 * Approval mentions outside docs/decisions:
 * `[ADR-033](…) §6 (angenommen am …)`, `[ ] ADR-033 Freigabe`, `[x] ADR-033 von Henry freigegeben`.
 */
function mentionFindings(): readonly string[] {
  const findings: string[] = [];
  const decisions = new Map<string, Decision>();

  for (const adr of ADRS) {
    const decision = adr.status === undefined ? undefined : decisionOf(adr.status);

    if (decision !== undefined) decisions.set(adr.number, decision);
  }

  const linked = /\[ADR-(\d{3})\]\([^)]*\)[^()\n]*\((vorgeschlagen|angenommen)/gu;
  const checkbox = /\[([ x])\] ADR-(\d{3}) (?:Freigabe|von Henry freigegeben)/gu;

  for (const path of markdownOutsideDecisions(join(ROOT, "docs"))) {
    for (const [index, line] of readFileSync(path, "utf8").split("\n").entries()) {
      const mentions: { readonly number: string; readonly claims: Decision }[] = [];

      for (const match of line.matchAll(linked)) {
        mentions.push({
          number: match[1] ?? "",
          claims: match[2] === "vorgeschlagen" ? "proposed" : "decided",
        });
      }

      for (const match of line.matchAll(checkbox)) {
        mentions.push({
          number: match[2] ?? "",
          claims: match[1] === "x" ? "decided" : "proposed",
        });
      }

      for (const mention of mentions) {
        const actual = decisions.get(mention.number);

        if (actual !== undefined && actual !== mention.claims) {
          findings.push(
            `${path.slice(ROOT.length + 1)}:${index + 1}: treats ADR-${mention.number} as ${mention.claims}, the ADR is ${actual}`,
          );
        }
      }
    }
  }

  return findings;
}

it("gives every ADR its own number and repeats it in the heading", () => {
  expect(numberingFindings()).toEqual([]);
});

it("lists every ADR exactly once in docs/decisions/README.md, and nothing else", () => {
  expect(indexFindings()).toEqual([]);
});

it("keeps the index status in line with each ADR's Status line", () => {
  expect(indexStatusFindings()).toEqual([]);
});

it("keeps approval mentions in the other docs in line with each ADR's Status line", () => {
  expect(mentionFindings()).toEqual([]);
});

it("maps the known status prefixes and rejects an unknown one", () => {
  expect(decisionOf("⛔ Ersetzt durch ADR-005")).toBe("superseded");
  expect(decisionOf("Vorgeschlagen. Henrys Freigabe steht aus.")).toBe("proposed");
  expect(decisionOf("Gewählte Form für Henrys Auftrag")).toBe("decided");
  expect(unknownPrefix("probe", "Verworfen am 2026-12-01")).toEqual([
    expect.stringMatching(/^probe: status "Verworfen am 2026-12-01" starts with no known prefix/u),
  ]);
});
