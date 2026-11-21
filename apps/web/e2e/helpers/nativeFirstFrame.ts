/// <reference types="node" />
import type { CDPSession, Page, TestInfo } from "@playwright/test";
import type { RenderReply } from "../../src/world/render-protocol.js";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { reportMenuFailure } from "./menuFailure.js";
import type { FirstDrawPoll } from "./menuFailure.js";

export async function captureFirstFrameFailure(
  page: Readonly<Pick<Page, "evaluate" | "workers" | "screenshot">>,
  testInfo: Readonly<Pick<TestInfo, "outputPath">>,
  firstDrawPoll: FirstDrawPoll,
): Promise<void> {
  await reportMenuFailure(page, firstDrawPoll).catch(() => null);
  await page.screenshot({ path: testInfo.outputPath("failure-retained.png") }).catch(() => null);
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

function observePage(page: Readonly<Pick<Page, "on">>) {
  const observations: {
    readonly event: string;
    readonly elapsedMs: number;
    readonly value: string;
  }[] = [];

  const started = performance.now();

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
    constructor(url: string | Readonly<URL>, options?: Readonly<WorkerOptions>) {
      super(url, options);

      if (options?.name !== "ride-render") return;
      const seen = new Set<RenderReply["type"]>();

      console.warn("FIRST-FRAME-PIPELINE", performance.now(), "constructed");
      this.addEventListener("message", (event: Readonly<{ data: RenderReply }>) => {
        const { type } = event.data;

        if (seen.has(type)) return;
        seen.add(type);
        console.warn("FIRST-FRAME-PIPELINE", performance.now(), type);
      });
    }
  };
}

export async function startNativeCapture(
  page: Readonly<Pick<Page, "context" | "on" | "addInitScript">>,
  testInfo: Readonly<Pick<TestInfo, "outputPath" | "title" | "status">>,
): Promise<() => Promise<void>> {
  const browser = page.context().browser();

  if (browser === null) throw new Error("Native capture requires Chromium");

  const session = await browser.newBrowserCDPSession();
  const observations = observePage(page);

  await page.addInitScript(observeRenderReplies);

  await session.send("Tracing.start", {
    categories:
      "toplevel,devtools.timeline,v8,v8.execute,blink,gpu,disabled-by-default-v8.cpu_profiler,disabled-by-default-devtools.timeline",
    options: "sampling-frequency=1000",
    transferMode: "ReturnAsStream",
  });

  return async () => {
    const path = testInfo.outputPath("native-first-frame.json");

    await writeFile(path, await finishTrace(session));
    process.stderr.write(
      `${JSON.stringify({
        event: "native-first-frame-run",
        title: testInfo.title,
        status: testInfo.status,
        architecture: process.arch,
        observations,
      })}\n`,
    );
    process.stderr.write(
      execFileSync("python3", [fileURLToPath(new URL("./nativeTrace.py", import.meta.url)), path], {
        encoding: "utf8",
      }),
    );
  };
}
