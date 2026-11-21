/// <reference types="node" />
import type { CDPSession } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import { availableParallelism, cpus, loadavg } from "node:os";
import process from "node:process";

interface GpuScheduleSample {
  readonly elapsedMs: number;
  readonly pid: number;
  readonly processCpuTimeS: number;
  readonly mainThreadCpuNs: string;
  readonly mainThreadRunqueueNs: string;
  readonly threads: readonly GpuThreadCounter[];
}

interface GpuThreadCounter {
  readonly tid: number;
  readonly name: string;
  readonly cpuNs: string;
  readonly runqueueNs: string;
}

interface GpuSchedulingReport {
  readonly platform: string;
  readonly samples: readonly GpuScheduleSample[];
  readonly errors: readonly string[];
  readonly machine: {
    readonly cpuCount: number;
    readonly cpuModel: string;
    readonly loadAverage: readonly number[];
  };
}

function parseSchedstat(text: string) {
  if (!/^\d+\s+\d+\s+\d+$/u.test(text.trim())) throw new Error("Invalid browser GPU schedstat");
  const [cpuNs, runqueueNs] = text.trim().split(/\s+/u);

  if (cpuNs === undefined || runqueueNs === undefined) throw new Error("Missing GPU counters");

  return { cpuNs, runqueueNs };
}

async function readGpuThread(pid: number, tidText: string): Promise<GpuThreadCounter | null> {
  if (!/^\d+$/u.test(tidText)) return null;

  try {
    const root = `/proc/${pid}/task/${tidText}`;

    const [name, text] = await Promise.all([
      readFile(`${root}/comm`, "utf8"),
      readFile(`${root}/schedstat`, "utf8"),
    ]);

    return { tid: Number(tidText), name: name.trim(), ...parseSchedstat(text) };
  } catch {
    return null;
  }
}

async function readGpuThreads(pid: number): Promise<readonly GpuThreadCounter[]> {
  const ids = await readdir(`/proc/${pid}/task`);
  const entries = await Promise.all(ids.slice(0, 64).map((id) => readGpuThread(pid, id)));
  const threads: GpuThreadCounter[] = [];

  for (const entry of entries) if (entry !== null) threads.push(entry);

  return threads;
}

async function sampleGpu(
  session: Readonly<Pick<CDPSession, "send">>,
  startedMs: number,
): Promise<readonly GpuScheduleSample[]> {
  const { processInfo } = await session.send("SystemInfo.getProcessInfo");
  const gpu = processInfo.find((entry: Readonly<{ type: string }>) => entry.type === "GPU");

  if (gpu === undefined) return [];
  const counters = parseSchedstat(await readFile(`/proc/${gpu.id}/schedstat`, "utf8"));
  const threads = await readGpuThreads(gpu.id);

  return [
    {
      elapsedMs: performance.now() - startedMs,
      pid: gpu.id,
      processCpuTimeS: gpu.cpuTime,
      mainThreadCpuNs: counters.cpuNs,
      mainThreadRunqueueNs: counters.runqueueNs,
      threads,
    },
  ];
}

export function startGpuScheduling(
  session: Readonly<Pick<CDPSession, "send">>,
  startedMs: number,
): () => Promise<GpuSchedulingReport> {
  const samples: GpuScheduleSample[] = [];
  const errors: string[] = [];

  const machine = {
    cpuCount: availableParallelism(),
    cpuModel: cpus()[0]?.model ?? "unavailable",
    loadAverage: loadavg(),
  };

  if (process.platform !== "linux")
    return () => Promise.resolve({ platform: process.platform, samples, errors, machine });
  let closed = false;
  let count = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = Promise.resolve();

  const poll = async (): Promise<void> => {
    count += 1;

    try {
      samples.push(...(await sampleGpu(session, startedMs)));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "GPU scheduling unavailable");
    }

    if (!closed && count < 32)
      timer = setTimeout(() => {
        pending = poll();
      }, 250);
  };

  pending = poll();

  return async () => {
    closed = true;
    clearTimeout(timer);
    await pending;

    return { platform: process.platform, samples, errors, machine };
  };
}
