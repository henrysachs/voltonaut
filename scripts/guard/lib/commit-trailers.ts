import { execFileSync } from "node:child_process";

interface CommitTrailer {
  readonly key: string;
  readonly value: string;
}

export interface CommitRecord {
  readonly sha: string;
  readonly authorEmail: string;
  readonly subject: string;
  readonly trailers: readonly CommitTrailer[];
}

const fieldSeparator = "\u001F";
const trailerSeparator = "\u001D";
const recordSeparator = "\u001E";

/** Git parses the trailer block itself, so GitHub's squash bodies with inline sign-offs read the same as `git interpret-trailers --parse`. */
const logFormat = `%H%x1f%ae%x1f%s%x1f%(trailers:only=true,unfold=true,separator=%x1d)%x1e`;

const aiIdentityPattern = /claude|anthropic/iu;

function parseTrailer(line: string): CommitTrailer | undefined {
  const colon = line.indexOf(":");

  if (colon <= 0) {
    return undefined;
  }

  return { key: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() };
}

function parseRecord(record: string): CommitRecord | undefined {
  const [sha, authorEmail, subject, trailerBlock] = record
    .replace(/^\n/u, "")
    .split(fieldSeparator);

  if (sha === undefined || sha.length === 0 || authorEmail === undefined || subject === undefined) {
    return undefined;
  }

  const trailers: CommitTrailer[] = [];

  for (const line of (trailerBlock ?? "").split(trailerSeparator)) {
    const trailer = parseTrailer(line);

    if (trailer !== undefined) {
      trailers.push(trailer);
    }
  }

  return { sha, authorEmail, subject, trailers };
}

/** Non-merge commits in `base..head`; merge commits (GitHub's PR merge ref, main merged into a branch) carry no author intent. */
export function readCommitRange(
  base: string,
  head: string = "HEAD",
  cwd: string = process.cwd(),
): readonly CommitRecord[] {
  const output = execFileSync(
    "git",
    ["log", "--no-merges", `--format=${logFormat}`, `${base}..${head}`],
    { cwd, encoding: "utf8" },
  );

  const records: CommitRecord[] = [];

  for (const chunk of output.split(recordSeparator)) {
    const record = parseRecord(chunk);

    if (record !== undefined) {
      records.push(record);
    }
  }

  return records;
}

function keyIs(trailer: CommitTrailer, key: string): boolean {
  return trailer.key.toLowerCase() === key.toLowerCase();
}

export function checkCommitTrailers(commits: readonly CommitRecord[]): readonly string[] {
  const findings: string[] = [];

  for (const commit of commits) {
    const label = `commit ${commit.sha.slice(0, 7)} "${commit.subject}"`;

    if (!commit.trailers.some((trailer) => keyIs(trailer, "Signed-off-by"))) {
      findings.push(`${label}: missing Signed-off-by trailer (commit with -s)`);
    }

    // GitHub turns every PR commit author into a `Co-authored-by:` line of the squash commit.
    if (aiIdentityPattern.test(commit.authorEmail)) {
      findings.push(`${label}: author ${commit.authorEmail} is an AI identity; commit as a person`);
    }

    for (const trailer of commit.trailers) {
      const isAiCoAuthor =
        keyIs(trailer, "Co-Authored-By") && aiIdentityPattern.test(trailer.value);

      if (isAiCoAuthor || keyIs(trailer, "Claude-Session")) {
        findings.push(`${label}: forbidden trailer '${trailer.key}: ${trailer.value}'`);
      }
    }
  }

  return findings;
}
