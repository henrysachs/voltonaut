import type { Profiler, Runtime } from "node:inspector";
import { Session } from "node:inspector/promises";
import { pathToFileURL } from "node:url";

const sampleIntervalUs = 1000;

const functionNames: ReadonlySet<string> = new Set([
  "(root)",
  "(program)",
  "(idle)",
  "(garbage collector)",
  "run",
  "get",
  "all",
  "values",
  "is",
  "prepare",
  "exec",
  "step",
  "tick",
  "hint",
  "parse",
  "safeParse",
  "decode",
  "encode",
  "mapResultRow",
  "mapUpdateSet",
  "buildQueryFromSourceParams",
  "toQuery",
  "sqlToQuery",
  "buildSelectQuery",
  "buildUpdateQuery",
  "getSQL",
  "getSelectedFields",
  "orderSelectedFields",
  "mapToDriverValue",
  "mapFromDriverValue",
  "getTableColumns",
  "eq",
  "and",
  "or",
  "bindIfParam",
  "fillPlaceholders",
  "transaction",
  "reserve",
  "observe",
  "connection",
  "claimWork",
  "releaseWork",
  "own",
  "proof",
  "refresh",
  "decryptTokens",
  "encryptTokens",
  "stringify",
  "assign",
  "create",
  "abort",
  "timeout",
  "addEventListener",
  "removeEventListener",
  "dispatchEvent",
  "post",
  "emit",
]);

function moduleLabel(url: string) {
  if (url === "") return "v8_or_anonymous";

  if (/[?#%\r\n]/u.test(url)) return "other_or_redacted";

  if (url.split("/").includes("..")) return "other_or_redacted";

  if (/^node:[a-z_/-]{1,120}$/u.test(url)) return url.slice(5);

  const dependency = url.lastIndexOf("/node_modules/");
  const module = dependency < 0 ? "" : url.slice(dependency + 14);

  if (
    /^(?:drizzle-orm|zod|better-sqlite3|vitest|vite|@vitest\/(?:runner|coverage-v8))\/[a-zA-Z0-9_./-]{1,140}$/u.test(
      module,
    )
  ) {
    return module;
  }

  const root = pathToFileURL(`${process.cwd()}/`).href;

  const relative = url.startsWith(root)
    ? url.slice(root.length)
    : url.startsWith(`${process.cwd()}/`)
      ? url.slice(process.cwd().length + 1)
      : "";

  if (
    /^(?:apps\/server\/src|packages\/(?:shared|engine|rules)\/src)\/[a-zA-Z0-9_./-]{1,140}\.(?:ts|js)$/u.test(
      relative,
    )
  ) {
    return relative;
  }

  return "other_or_redacted";
}

function frameLabel(frame: Readonly<Runtime.CallFrame>) {
  return {
    module: moduleLabel(frame.url),
    function: functionNames.has(frame.functionName) ? frame.functionName : "redacted_or_anonymous",
    runtimeLine: frame.lineNumber + 1,
    runtimeColumn: frame.columnNumber + 1,
  };
}

type SampledProfile = Readonly<Pick<Profiler.Profile, "startTime" | "endTime">> & {
  readonly nodes: readonly (Readonly<Pick<Profiler.ProfileNode, "id">> & {
    readonly callFrame: Readonly<Runtime.CallFrame>;
  })[];
  readonly samples?: readonly number[] | undefined;
};

function descendingSamples(
  a: Readonly<{ selfSamples: number }>,
  b: Readonly<{ selfSamples: number }>,
) {
  return b.selfSamples - a.selfSamples;
}

function sampleRows(profile: SampledProfile) {
  const nodes = new Map(
    profile.nodes.map((node: SampledProfile["nodes"][number]) => [
      node.id,
      frameLabel(node.callFrame),
    ]),
  );

  const functions = new Map<string, ReturnType<typeof frameLabel> & { selfSamples: number }>();
  const modules = new Map<string, { module: string; selfSamples: number }>();
  const samples = profile.samples ?? [];

  for (const id of samples) {
    const frame = nodes.get(id) ?? {
      module: "other_or_redacted",
      function: "redacted_or_anonymous",
      runtimeLine: 0,
      runtimeColumn: 0,
    };

    const key = JSON.stringify(frame);
    const row = functions.get(key) ?? { ...frame, selfSamples: 0 };
    const module = modules.get(frame.module) ?? { module: frame.module, selfSamples: 0 };
    row.selfSamples += 1;
    module.selfSamples += 1;
    functions.set(key, row);
    modules.set(frame.module, module);
  }

  return {
    functions: [...functions.values()],
    modules: [...modules.values()],
    totalSamples: samples.length,
  };
}

export function summarizeCpuProfile(profile: SampledProfile) {
  const { functions, modules, totalSamples } = sampleRows(profile);
  const topFunctions = functions.toSorted(descendingSamples).slice(0, 20);
  const topModules = modules.toSorted(descendingSamples).slice(0, 12);

  return Object.freeze({
    kind: "available",
    scope: "current_test_worker",
    metric: "sampled_self_hits_not_cpu_ms",
    lines: "runtime_1_based_source_ts_mapping_unverified",
    interval: "requested_not_guaranteed",
    observerOverhead: "profiled_run_not_unprofiled_latency",
    sampleIntervalUs,
    totalSamples,
    durationUs: profile.endTime - profile.startTime,
    excludedSamples: 0,
    omittedFunctionSamples:
      totalSamples -
      topFunctions.reduce(
        (sum, row: Readonly<{ selfSamples: number }>) => sum + row.selfSamples,
        0,
      ),
    omittedModuleSamples:
      totalSamples -
      topModules.reduce((sum, row: Readonly<{ selfSamples: number }>) => sum + row.selfSamples, 0),
    topFunctions,
    topModules,
  });
}

export type CpuProfiler = {
  readonly connect: () => void;
  readonly enable: () => Promise<void>;
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<Profiler.Profile>;
  readonly disconnect: () => void;
};

function inspectorProfiler(): CpuProfiler {
  const session = new Session();

  return {
    connect() {
      session.connect();
    },
    async enable() {
      await session.post("Profiler.enable");
      await session.post("Profiler.setSamplingInterval", { interval: sampleIntervalUs });
    },
    async start() {
      await session.post("Profiler.start");
    },
    async stop() {
      return (await session.post("Profiler.stop")).profile;
    },
    disconnect() {
      session.disconnect();
    },
  };
}

type CpuSummary = ReturnType<typeof summarizeCpuProfile> | { readonly kind: "unavailable" };

function disconnect(profiler: Readonly<CpuProfiler>) {
  try {
    profiler.disconnect();
  } catch {
    // Optional observer cleanup must not replace the canonical test outcome.
  }
}

async function stop(profiler: Readonly<CpuProfiler>): Promise<CpuSummary> {
  try {
    return summarizeCpuProfile(await profiler.stop());
  } catch {
    return { kind: "unavailable" };
  } finally {
    disconnect(profiler);
  }
}

async function start(createProfiler: () => CpuProfiler) {
  let profiler: CpuProfiler;

  try {
    profiler = createProfiler();
  } catch {
    return { kind: "unavailable" } satisfies CpuSummary;
  }

  try {
    profiler.connect();
    await profiler.enable();
    await profiler.start();

    return { kind: "ready", profiler } satisfies {
      readonly kind: "ready";
      readonly profiler: CpuProfiler;
    };
  } catch {
    await stop(profiler);

    return { kind: "unavailable" } satisfies CpuSummary;
  }
}

// TEMPORARY: no listening inspector, raw profile files or coordinator-thread attachment.
export function cpuProfile(createProfiler: () => CpuProfiler = inspectorProfiler) {
  const starting = start(createProfiler);
  let finished: Promise<CpuSummary> | undefined;

  return {
    async ready() {
      await starting;
    },
    finish() {
      finished ??= starting.then((state: Readonly<Awaited<typeof starting>>) =>
        state.kind === "ready" ? stop(state.profiler) : state,
      );

      return finished;
    },
  };
}
