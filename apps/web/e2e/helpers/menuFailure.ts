/// <reference types="node" />
import type { Page, Worker } from "@playwright/test";
import process from "node:process";

export type FirstDrawPoll =
  | { readonly kind: "not-polled" }
  | { readonly kind: "polled"; readonly rawCalls: string | null };

function publicUrl(value: string): string {
  if (!URL.canParse(value)) return "unavailable";

  const url = new URL(value);

  return url.protocol === "http:" || url.protocol === "https:"
    ? `${url.origin}${url.pathname}`.slice(0, 240)
    : url.protocol;
}

function menuFailureDom() {
  const diagnostics = document.querySelector<HTMLElement>('[aria-label="Render diagnostics"]');
  const scene = document.querySelector("#ride-scene");
  const canvas = scene?.querySelector("canvas");
  const bounds = canvas?.getBoundingClientRect();
  const style = canvas === null || canvas === undefined ? null : getComputedStyle(canvas);

  return {
    readyState: document.readyState,
    visibilityState: document.visibilityState,
    focused: document.hasFocus(),
    hudStatus:
      document.querySelector('[data-testid="hud-status"]')?.textContent?.slice(0, 160) ?? null,
    diagnosticsPresent: diagnostics !== null,
    rawCalls: diagnostics?.dataset["calls"] ?? null,
    rawTriangles: diagnostics?.dataset["triangles"] ?? null,
    rawDistanceM: diagnostics?.dataset["distanceM"] ?? null,
    frameStage: diagnostics?.dataset["frameStage"] ?? null,
    camera: diagnostics?.dataset["camera"] ?? null,
    scenePresent: scene !== null,
    sceneHidden: scene?.hasAttribute("hidden") ?? null,
    canvasPresent: canvas !== null && canvas !== undefined,
    canvasBusy: canvas?.getAttribute("aria-busy") ?? null,
    canvasDisplay: style?.display ?? null,
    canvasVisibility: style?.visibility ?? null,
    canvasWidth: canvas?.width ?? null,
    canvasHeight: canvas?.height ?? null,
    canvasBounds: bounds === undefined ? null : { width: bounds.width, height: bounds.height },
    resources: performance
      .getEntriesByType("resource")
      .slice(-24)
      .map((entry: Readonly<PerformanceEntry>) => ({
        url: entry.name,
        startTimeMs: entry.startTime,
        durationMs: entry.duration,
        responseStatus: entry instanceof PerformanceResourceTiming ? entry.responseStatus : null,
      })),
  };
}

async function boundedSnapshot(page: Readonly<Pick<Page, "evaluate">>) {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      page.evaluate(menuFailureDom).catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          resolve(null);
        }, 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function reportMenuFailure(
  page: Readonly<Pick<Page, "evaluate" | "workers">>,
  firstDrawPoll: FirstDrawPoll,
): Promise<void> {
  const snapshot = await boundedSnapshot(page);

  if (snapshot === null) {
    process.stderr.write(
      `${JSON.stringify({ event: "menu-world-hud-failure", observation: "snapshot-unavailable", firstDrawPoll })}\n`,
    );

    return;
  }

  process.stderr.write(
    `${JSON.stringify({
      event: "menu-world-hud-failure",
      observation: "after-test-failure",
      firstDrawPoll,
      ...snapshot,
      resources: snapshot.resources.map(
        (resource: Readonly<(typeof snapshot.resources)[number]>) => ({
          url: publicUrl(resource.url),
          startTimeMs: resource.startTimeMs,
          durationMs: resource.durationMs,
          responseStatus: resource.responseStatus,
        }),
      ),
      workersAtFailure: page
        .workers()
        .slice(0, 8)
        .map((worker: Readonly<Pick<Worker, "url">>) => publicUrl(worker.url())),
    })}\n`,
  );
}
