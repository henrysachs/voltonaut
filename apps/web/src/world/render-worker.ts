import * as THREE from "three";

import { createRenderLoop } from "./render-loop.js";
import type { RenderCommand, RenderReply } from "./render-protocol.js";
import { resolveRenderWorld } from "./render-world.js";
import { createSceneCore, resolveRenderRoute, type SceneCore } from "./scene-core.js";

interface RenderScope {
  readonly postMessage: (reply: RenderReply) => void;
  readonly addEventListener: (
    type: "message",
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The message carries the native transferred canvas.
    listener: (event: Readonly<{ readonly data: RenderCommand }>) => void,
  ) => void;
}

function initialize(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The worker owns the transferred native canvas and its GL lifecycle.
  command: Extract<RenderCommand, { type: "render.init" }>,
  lost: () => void,
): SceneCore {
  const route = resolveRenderRoute(command.routeId);
  const world = resolveRenderWorld(command.routeId);

  const context = command.canvas.getContext("webgl2", { antialias: true, alpha: false });

  if (context === null) throw new Error("Worker WebGL2 unavailable");
  const renderer = new THREE.WebGLRenderer({ canvas: command.canvas, context, antialias: true });
  let core: SceneCore | undefined;

  const onLost = (event: { readonly preventDefault: () => void }): void => {
    event.preventDefault();
    lost();
  };

  try {
    core = createSceneCore(renderer, route, world, command.wheelCircM, command.environment);
    core.resize(command.viewport);
    command.canvas.addEventListener("webglcontextlost", onLost);
    const owned = core;

    return {
      render: owned.render,
      resize: owned.resize,
      toggleCamera: owned.toggleCamera,
      setLook: owned.setLook,
      dispose() {
        command.canvas.removeEventListener("webglcontextlost", onLost);
        owned.dispose();
      },
    };
  } catch (error) {
    if (core === undefined) {
      renderer.dispose();

      if (!context.isContextLost()) renderer.forceContextLoss();
    } else core.dispose();
    throw error;
  }
}

type RenderLoop = ReturnType<typeof createRenderLoop>;

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The init message owns a transferred native canvas; the loop is the worker's own mutable state.
function handleCommand(loop: RenderLoop, data: RenderCommand): void {
  switch (data.type) {
    case "render.init":
      loop.start(() =>
        initialize(data, () => {
          loop.fail("context-lost");
        }),
      );

      return;
    case "render.snapshot":
      loop.snapshot(data.sequence, data.snapshot);

      return;
    case "render.resize":
      loop.resize(data.viewport);

      return;
    case "render.toggleCamera":
      loop.toggleCamera();

      return;
    case "render.look":
      loop.look(data.look);

      return;
    case "render.dispose":
      loop.dispose();
      break;
  }
}

export function startRenderWorker(scope: RenderScope): void {
  const loop = createRenderLoop(
    {
      nowMs: () => performance.now(),
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

if (typeof self !== "undefined") startRenderWorker(self);
