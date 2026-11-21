/// <reference types="node" />
import type { CDPSession } from "@playwright/test";
import { readFile } from "node:fs/promises";
import process from "node:process";

interface GpuScheduleSample {
  readonly elapsedMs: number;
  readonly pid: number;
  readonly processCpuTimeS: number;
  readonly mainThreadCpuNs: string;
  readonly mainThreadRunqueueNs: string;
}

async function sampleGpu(
  session: Readonly<Pick<CDPSession, "send">>,
  startedMs: number,
): Promise<readonly GpuScheduleSample[]> {
  const { processInfo } = await session.send("SystemInfo.getProcessInfo");
  const gpu = processInfo.find((entry: Readonly<{ type: string }>) => entry.type === "GPU");

  if (gpu === undefined) return [];
  const text = (await readFile(`/proc/${gpu.id}/schedstat`, "utf8")).trim();

  if (!/^\d+\s+\d+\s+\d+$/u.test(text)) throw new Error("Invalid browser GPU schedstat");
  const [mainThreadCpuNs, mainThreadRunqueueNs] = text.split(/\s+/u);

  if (mainThreadCpuNs === undefined || mainThreadRunqueueNs === undefined) return [];

  return [
    {
      elapsedMs: performance.now() - startedMs,
      pid: gpu.id,
      processCpuTimeS: gpu.cpuTime,
      mainThreadCpuNs,
      mainThreadRunqueueNs,
    },
  ];
}

export function startGpuScheduling(
  session: Readonly<Pick<CDPSession, "send">>,
  startedMs: number,
): () => Promise<{
  readonly platform: string;
  readonly samples: readonly GpuScheduleSample[];
  readonly errors: readonly string[];
}> {
  const samples: GpuScheduleSample[] = [];
  const errors: string[] = [];

  if (process.platform !== "linux")
    return () => Promise.resolve({ platform: process.platform, samples, errors });
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

    return { platform: process.platform, samples, errors };
  };
}
