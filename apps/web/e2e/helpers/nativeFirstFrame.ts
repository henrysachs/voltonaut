/// <reference types="node" />
import type { CDPSession, Page, TestInfo } from "@playwright/test";
import type { RenderReply } from "../../src/world/render-protocol.js";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { startGpuScheduling } from "./gpuScheduling.js";
import { nativeSourceStamp } from "./nativeSource.js";

export async function retainNativeFailureImage(
  page: Readonly<Pick<Page, "screenshot">>,
  testInfo: Readonly<Pick<TestInfo, "outputPath" | "title" | "status">>,
): Promise<void> {
  const image = await page
    .screenshot({ path: testInfo.outputPath("failure-retained.png") })
    .catch(() => null);

  if (image === null) return;
  process.stderr.write(
    `${JSON.stringify({
      event: "native-first-frame-failure-image",
      title: testInfo.title,
      verdict: testInfo.status,
      observation: "after-failure-and-after-native-trace",
      sha256: createHash("sha256").update(image).digest("hex"),
      bytes: image.byteLength,
      pngBase64: image.byteLength <= 128_000 ? image.toString("base64") : null,
    })}\n`,
  );
}

async function readTrace(
  session: Readonly<Pick<CDPSession, "send">>,
  handle: string,
): Promise<string> {
  let text = "";
  let eof = false;

  while (!eof) {
    // oxlint-disable-next-line no-await-in-loop -- CDP streams require each sequential chunk before EOF is known.
    const part = await session.send("IO.read", { handle });

    text += part.data;
    eof = part.eof;
  }

  await session.send("IO.close", { handle });

  return text;
}

async function finishTrace(
  session: Readonly<Pick<CDPSession, "send" | "once" | "detach">>,
): Promise<string> {
  const complete = new Promise<string>((resolve, reject) => {
    session.once("Tracing.tracingComplete", (payload: Readonly<{ stream?: string }>) => {
      if (payload.stream === undefined) reject(new Error("Missing native trace stream"));
      else resolve(payload.stream);
    });
  });

  await session.send("Tracing.end");
  const text = await readTrace(session, await complete);
  await session.detach();

  return text;
}

function observePage(page: Readonly<Pick<Page, "on">>, started: number) {
  const observations: {
    readonly event: string;
    readonly elapsedMs: number;
    readonly value: string;
  }[] = [];

  const note = (event: string, value: string): void => {
    if (observations.length < 40)
      observations.push({ event, elapsedMs: performance.now() - started, value });
  };

  page.on("worker", (worker: Readonly<{ url: () => string }>) => {
    note("worker", worker.url().split("?")[0] ?? "");
  });
  page.on("pageerror", (error: Readonly<Error>) => {
    note("pageerror", error.message.slice(0, 300));
  });
  page.on("console", (message: Readonly<{ text: () => string }>) => {
    const text = message.text();

    if (text.startsWith("FIRST-FRAME-PIPELINE ")) note("pipeline", text);
  });

  return observations;
}

function observeRenderReplies(): void {
  const NativeWorker = window.Worker;

  window.Worker = class extends NativeWorker {
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The native Worker constructor accepts URL with mutable searchParams; this observer only forwards it.
    constructor(url: string | Readonly<URL>, options?: Readonly<WorkerOptions>) {
      super(url, options);

      if (options?.name !== "ride-render") return;
      const seen = new Set<RenderReply["type"]>();

      performance.mark("FIRST-FRAME-PIPELINE constructed");
      console.warn("FIRST-FRAME-PIPELINE", performance.now(), "constructed");
      this.addEventListener("message", (event: Readonly<{ data: RenderReply }>) => {
        const { type } = event.data;

        if (seen.has(type)) return;
        seen.add(type);
        performance.mark(`FIRST-FRAME-PIPELINE ${type}`);
        console.warn("FIRST-FRAME-PIPELINE", performance.now(), type);
      });
    }
  };
}

export async function startNativeCapture(
  page: Readonly<Pick<Page, "context" | "on" | "addInitScript">>,
  testInfo: Readonly<Pick<TestInfo, "outputPath" | "title" | "status">>,
): Promise<() => Promise<void>> {
  const source = await nativeSourceStamp();
  const browser = page.context().browser();

  if (browser === null) throw new Error("Native capture requires Chromium");

  const session = await browser.newBrowserCDPSession();
  const startedMs = performance.now();
  const observations = observePage(page, startedMs);
  const stopGpuScheduling = startGpuScheduling(session, startedMs);
  const { gpu } = await session.send("SystemInfo.getInfo");
  const gpuDevices = gpu.devices;

  await page.addInitScript(observeRenderReplies);

  await session.send("Tracing.start", {
    categories:
      "toplevel,devtools.timeline,v8,v8.execute,blink,gpu,blink.user_timing,disabled-by-default-v8.cpu_profiler,disabled-by-default-devtools.timeline",
    options: "sampling-frequency=1000",
    transferMode: "ReturnAsStream",
  });

  return async () => {
    const path = testInfo.outputPath("native-first-frame.json");
    const gpuScheduling = await stopGpuScheduling();

    await writeFile(path, await finishTrace(session));
    process.stderr.write(
      `${JSON.stringify({
        event: "native-first-frame-run",
        title: testInfo.title,
        verdict: "see-final-playwright-result",
        architecture: process.arch,
        observations,
        gpuScheduling,
        gpuDevices,
        source,
      })}\n`,
    );
    process.stderr.write(
      execFileSync("python3", [fileURLToPath(new URL("./nativeTrace.py", import.meta.url)), path], {
        encoding: "utf8",
      }),
    );
  };
}
