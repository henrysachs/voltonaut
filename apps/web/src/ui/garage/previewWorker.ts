import { createPreviewLoop } from "./previewLoop.js";
import type { PreviewCommand, PreviewReply } from "./previewProtocol.js";
import { createPreviewScene } from "./previewScene.js";

interface PreviewScope {
  readonly postMessage: (reply: PreviewReply) => void;
  readonly addEventListener: (
    type: "message",
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The message carries the native transferred canvas.
    listener: (event: Readonly<{ readonly data: PreviewCommand }>) => void,
  ) => void;
}

type PreviewLoop = ReturnType<typeof createPreviewLoop>;

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The init message owns a transferred native canvas; the loop is the worker's own mutable state.
function handleCommand(loop: PreviewLoop, data: PreviewCommand): void {
  switch (data.type) {
    case "preview.init":
      loop.start(() =>
        createPreviewScene(data.canvas, data.wheelCircM, data.viewport, () => {
          loop.fail("context-lost");
        }),
      );

      return;
    case "preview.look":
      loop.look(data.look);

      return;
    case "preview.autoRotate":
      loop.setAutoRotate(data.enabled);

      return;
    case "preview.rotate":
      loop.rotateBy(data.angleRad);

      return;
    case "preview.resize":
      loop.resize(data.viewport);

      return;
    case "preview.dispose":
      loop.dispose();
      break;
  }
}

export function startPreviewWorker(scope: PreviewScope): void {
  const loop = createPreviewLoop(
    {
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (id) => {
        cancelAnimationFrame(id);
      },
      schedule: (callback, delayMs) => self.setTimeout(callback, delayMs),
      cancel: (id) => {
        self.clearTimeout(id);
      },
    },
    (reply) => {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Dedicated worker postMessage has no targetOrigin.
      scope.postMessage(reply);
    },
  );

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The init message owns a transferred native canvas; other messages are read-only.
  scope.addEventListener("message", ({ data }) => {
    handleCommand(loop, data);
  });
}

if (typeof self !== "undefined") startPreviewWorker(self);
