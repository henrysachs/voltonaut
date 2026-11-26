import type { Page } from "@playwright/test";

function noop(): void {}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page and route contracts.
export async function holdRenderWorker(page: Page, check: () => Promise<void>): Promise<void> {
  let release: () => void = noop;

  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns response continuation.
  await page.route("**/src/world/render-worker.ts*", async (route) => {
    await held;
    await route.continue();
  });

  try {
    await check();
  } finally {
    release();
  }
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
export async function countCanvasTransfers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // oxlint-disable-next-line typescript/unbound-method -- Preserve the native method, then invoke with the original canvas receiver.
    const transfer = HTMLCanvasElement.prototype.transferControlToOffscreen;

    HTMLCanvasElement.prototype.transferControlToOffscreen = function () {
      this.dataset["transferCount"] = String(Number(this.dataset["transferCount"] ?? 0) + 1);

      return transfer.call(this);
    };
  });
}

/** Injects only into the real render-worker entry, never the main canvas or engine worker. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page and route contracts.
export async function renderWorkerPrelude(page: Page, source: string): Promise<void> {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's route owns response fulfillment.
  await page.route("**/src/world/render-worker.ts*", async (route) => {
    const response = await route.fetch();
    const body = await response.text();

    await route.fulfill({ response, body: `${source}\n${body}` });
  });
}

/** Injects only into the real garage preview worker, which owns the preview's WebGL (ADR-032). */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page and route contracts.
export async function previewWorkerPrelude(page: Page, source: string): Promise<void> {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's route owns response fulfillment.
  await page.route("**/src/ui/garage/previewWorker.ts*", async (route) => {
    const response = await route.fetch();
    const body = await response.text();

    await route.fulfill({ response, body: `${source}\n${body}` });
  });
}

export const LOSE_RENDER_CONTEXT = `
const nativeGetContext = OffscreenCanvas.prototype.getContext;
OffscreenCanvas.prototype.getContext = function (...args) {
  const gl = nativeGetContext.apply(this, args);
  if (args[0] === "webgl2" && gl) {
    self.addEventListener("message", event => {
      if (event.data?.type === "test.loseRenderContext") {
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
    });
  }
  return gl;
};
`;

/** Capture the actual worker solely for the test's native context-loss fault injection. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the mutable page fixture.
export async function captureRenderWorker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const NativeWorker = Worker;

    window.Worker = class extends NativeWorker {
      private readonly renderWorker: boolean;

      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The native WorkerOptions is forwarded unchanged to the browser.
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.renderWorker = options?.name === "ride-render";

        if (options?.name === "ride-render") {
          this.addEventListener(
            "message",
            (event: { readonly data: { readonly type: string } }) => {
              if (event.data.type === "render.ready") document.body.dataset["renderReady"] = "true";
            },
          );
          window.addEventListener("test-lose-render-context", () => {
            // oxlint-disable-next-line unicorn/require-post-message-target-origin -- This is a dedicated Worker, not Window.
            this.postMessage({ type: "test.loseRenderContext" });
          });
        }
      }

      override terminate(): void {
        if (this.renderWorker)
          document.body.dataset["renderTerminations"] = String(
            Number(document.body.dataset["renderTerminations"] ?? 0) + 1,
          );
        super.terminate();
      }
    };
  });
}
