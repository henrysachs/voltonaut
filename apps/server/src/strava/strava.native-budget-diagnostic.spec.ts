import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { onTestFailed, onTestFinished } from "vitest";
import type { TestContext } from "vitest";
import { z } from "zod";
import type { schedulerFixture } from "./strava.scheduler-fixture.spec.js";

type Fixture = Awaited<ReturnType<typeof schedulerFixture>>;

type Phase = "start" | "setup" | "tick" | "reopen_accepted" | "late_poll" | "failed" | "finished";

const tickCheckpoints: ReadonlySet<number> = new Set([1, 499, 500, 1000]);

const integer = z.number().int().nonnegative().safe();

const digits = z.string().regex(/^\d+$/u).pipe(z.coerce.number().int().nonnegative().safe());
const schedstat = z.tuple([digits, digits, digits]);

const compileOption = z
  .string()
  .max(128)
  .regex(/^[A-Z0-9_]+(?:=[A-Za-z0-9_.,+-]+)?$/u);

function linuxScheduler() {
  if (process.platform !== "linux") return { kind: "non_linux" };

  try {
    const result = schedstat.safeParse(
      readFileSync("/proc/thread-self/schedstat", "utf8").trim().split(/\s+/u),
    );

    if (!result.success) return { kind: "invalid" };

    const [runNs, runqueueWaitNs, slices] = result.data;

    return { kind: "available", runNs, runqueueWaitNs, slices };
  } catch {
    return { kind: "unavailable" };
  }
}

type CompileOptions =
  | { readonly kind: "available"; readonly options: readonly string[] }
  | { readonly kind: "unavailable" };

function sqliteCompileOptions(client: Readonly<Fixture["a"]["db"]["$client"]>): CompileOptions {
  try {
    const options = z
      .array(z.object({ compile_options: compileOption }))
      .max(128)
      .parse(client.pragma("compile_options"))
      .map((option) => option.compile_options);

    return { kind: "available", options };
  } catch {
    return { kind: "unavailable" };
  }
}

function sqliteMetadata(client: Readonly<Fixture["a"]["db"]["$client"]>) {
  try {
    return {
      kind: "available",
      journalMode: z
        .enum(["wal", "delete", "truncate", "persist", "memory", "off"])
        .parse(client.pragma("journal_mode", { simple: true })),
      synchronous: integer.max(3).parse(client.pragma("synchronous", { simple: true })),
      walAutocheckpoint: integer.parse(client.pragma("wal_autocheckpoint", { simple: true })),
      version: z
        .object({ version: z.string().regex(/^\d+\.\d+\.\d+$/u) })
        .parse(client.prepare("SELECT sqlite_version() AS version").get()).version,
      compileOptions: sqliteCompileOptions(client),
    };
  } catch {
    return { kind: "unavailable" };
  }
}

type Resources = Readonly<
  Pick<Fixture["peer"]["resources"], "refreshCalls" | "athleteCalls" | "pollCalls" | "submitCalls">
>;

function counters(resources: Resources, policy: Readonly<Pick<Fixture["policy"], "athleteCalls">>) {
  return {
    proofs: policy.athleteCalls,
    refresh: resources.refreshCalls,
    httpAthlete: resources.athleteCalls,
    httpPoll: resources.pollCalls,
    httpSubmit: resources.submitCalls,
  };
}

function emptyCounts() {
  return { proofs: 0, refresh: 0, httpAthlete: 0, httpPoll: 0, httpSubmit: 0 };
}

type Checkpoint = Readonly<{
  phase: Phase;
  completedTicks: number;
  hints: number;
  elapsedMs: number;
  processCpuUs: Readonly<ReturnType<typeof process.cpuUsage>>;
  threadCpuUs: Readonly<ReturnType<typeof process.threadCpuUsage>>;
  scheduler: Readonly<ReturnType<typeof linuxScheduler>>;
  counts: Readonly<ReturnType<typeof counters>>;
}>;

type HookOutcome = {
  readonly task: {
    readonly result?: Readonly<Pick<NonNullable<TestContext["task"]["result"]>, "state">>;
  };
};

function registerReport(
  snapshot: () => {
    readonly sqlite: ReturnType<typeof sqliteMetadata>;
    readonly checkpoints: readonly Checkpoint[];
  },
  checkpoint: (phase: Phase) => void,
) {
  const emit = (failed: boolean) => {
    process.stderr.write(
      `[strava-native-budget-v1] ${JSON.stringify({
        kind: "temporary_test_diagnostic",
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.versions.node,
        failed,
        observation: "hook_observed_not_exact_deadline",
        ...snapshot(),
      })}\n`,
    );
  };

  onTestFailed(() => {
    checkpoint("failed");
    emit(true);
  });
  onTestFinished(({ task }: HookOutcome) => {
    if (task.result?.state === "fail") return;

    checkpoint("finished");
    emit(false);
  });
}

// TEMPORARY: native CI attribution only; remove after the residual timeout is attributed.
export function nativeBudgetDiagnostic() {
  const start = performance.now();
  const processStart = process.cpuUsage();
  const threadStart = process.threadCpuUsage();
  let completedTicks = 0;
  let hints = 0;
  let counts = emptyCounts;
  let sqlite: ReturnType<typeof sqliteMetadata> = { kind: "unavailable" };
  const checkpoints: ReturnType<typeof sample>[] = [];

  function sample(phase: Phase) {
    return {
      phase,
      completedTicks,
      hints,
      elapsedMs: performance.now() - start,
      processCpuUs: process.cpuUsage(processStart),
      threadCpuUs: process.threadCpuUsage(threadStart),
      scheduler: linuxScheduler(),
      counts: counts(),
    };
  }

  const checkpoint = (phase: Phase) => {
    checkpoints.push(sample(phase));
  };

  checkpoint("start");
  registerReport(() => ({ sqlite, checkpoints }), checkpoint);

  return {
    checkpoint,
    setup(
      client: Readonly<Fixture["a"]["db"]["$client"]>,
      observe: () => ReturnType<typeof counters>,
    ) {
      counts = observe;
      sqlite = sqliteMetadata(client);
      checkpoint("setup");
    },
    hinted() {
      hints += 1;
    },
    ticked() {
      completedTicks += 1;

      if (tickCheckpoints.has(completedTicks)) checkpoint("tick");
    },
  };
}

export async function nativeBudgetAttack(
  setup: () => Promise<Fixture>,
  diagnostic: Readonly<ReturnType<typeof nativeBudgetDiagnostic>>,
) {
  const state = await setup();
  const { time, hints, scheduler } = state;
  diagnostic.setup(state.a.db.$client, () => counters(state.peer.resources, state.policy));

  for (let minute = 0; minute < 1000; minute += 1) {
    time.nowMs = 20000 + minute * 60000;
    hints.hint("42");
    diagnostic.hinted();
    // oxlint-disable-next-line no-await-in-loop -- Advance legitimate scheduler time between authorization proofs.
    await scheduler.tick();
    diagnostic.ticked();
  }

  return state;
}
