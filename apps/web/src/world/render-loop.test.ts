import { createEngine, createRoute, TEST_LOOP } from "@voltonaut/engine";
import { DEFAULT_RIDER_PROFILE } from "@voltonaut/shared";
import { expect, it } from "vitest";

import { createRenderLoop } from "./render-loop.js";
import { createRenderViewport, type RenderReply } from "./render-protocol.js";
import { resolveRenderRoute, type SceneCore } from "./scene-core.js";

const snapshot = createEngine({
  route: createRoute(TEST_LOOP),
  profile: DEFAULT_RIDER_PROFILE,
}).snapshot();

function noop(): void {}

class LoopFixture {
  readonly replies: RenderReply[] = [];
  private frameCallback: (nowMs: number) => void = noop;
  private taskCallback: () => void = noop;
  private disposals = 0;
  private renders = 0;
  private resizes = 0;
  readonly loop = createRenderLoop(
    {
      nowMs: () => 100,
      requestFrame: (callback) => {
        this.frameCallback = callback;

        return 1;
      },
      cancelFrame: noop,
      schedule: (callback) => {
        this.taskCallback = callback;

        return 2;
      },
      cancel: noop,
    },
    (reply) => {
      this.replies.push(reply);
    },
  );
  readonly core: SceneCore = {
    render: () => {
      this.renders += 1;

      return {
        calls: 123,
        triangles: 123456,
        distanceM: 3,
        rider: { x: 1, y: 2, z: 3 },
        headingRad: 1,
        crankRad: 2,
        camera: "chase",
        weather: "clear",
        timeOfDayS: 43_200,
        rainAmount: 0,
        cameraPosition: { x: 3, y: 4, z: 5 },
        widthPx: 800,
        heightPx: 400,
        billboardsInView: { left: 0, right: 0 },
      };
    },
    resize: () => {
      this.resizes += 1;
    },
    toggleCamera: () => "overview",
    dispose: () => {
      this.disposals += 1;
    },
  };

  frame(): void {
    this.frameCallback(100);
  }
  task(): void {
    this.taskCallback();
  }
  counts() {
    return { disposals: this.disposals, renders: this.renders, resizes: this.resizes };
  }
}

function fixture(): LoopFixture {
  return new LoopFixture();
}

it("resolves every supported actual route and rejects unknown IDs", () => {
  expect(createRenderViewport(0, 0, 2)).toEqual({
    widthCssPx: 1,
    heightCssPx: 1,
    devicePixelRatio: 2,
  });
  expect(resolveRenderRoute("test-loop").lengthM).toBe(TEST_LOOP.lengthM);
  expect(resolveRenderRoute("flat-loop").lengthM).toBeGreaterThan(0);
  expect(resolveRenderRoute("kom-climb").lengthM).toBeGreaterThan(0);
  expect(() => resolveRenderRoute("not-a-route")).toThrow("Unsupported render route");
});

it("disposes a started core before its scheduled first frame and never restarts it", () => {
  const f = fixture();

  f.loop.start(() => f.core);
  f.loop.start(() => {
    throw new Error("duplicate init");
  });
  f.loop.snapshot(1, snapshot);
  f.loop.dispose();
  f.loop.resize({ widthCssPx: 1, heightCssPx: 1, devicePixelRatio: 1 });
  f.frame();
  f.task();
  expect(f.counts()).toEqual({ disposals: 1, renders: 0, resizes: 0 });
  expect(f.replies.at(-1)).toEqual({ type: "render.disposed" });
});

it("releases a core when rendering throws", () => {
  const f = fixture();

  f.loop.start(() => ({
    ...f.core,
    render() {
      throw new Error("GPU failure");
    },
  }));
  f.loop.snapshot(1, snapshot);
  f.frame();
  f.frame();
  expect(f.counts().disposals).toBe(1);
  expect(f.replies.at(-1)).toEqual({ type: "render.failed", reason: "render-error" });
});

it("does not report a frame before a real render and an after-render task", () => {
  const f = fixture();

  f.loop.start(() => f.core);
  f.frame();
  f.task();
  expect(f.replies).toEqual([{ type: "render.ready" }]);
  f.loop.snapshot(1, snapshot);
  f.frame();
  expect(f.replies.at(-1)).toEqual({ type: "render.accepted", sequence: 1 });
  f.task();
  expect(f.replies.at(-1)).toMatchObject({
    type: "render.frame",
    diagnostics: { calls: 123, triangles: 123456 },
    stage: "after-render-task",
  });
  f.loop.toggleCamera();
  f.loop.resize({ widthCssPx: 800, heightCssPx: 400, devicePixelRatio: 1 });
  expect(f.replies.at(-1)).toEqual({ type: "render.camera", mode: "overview" });
  expect(f.counts()).toEqual({ disposals: 0, renders: 1, resizes: 1 });
});

it("disposes before init and ignores all late work, including a scheduled frame/task", () => {
  const f = fixture();

  f.loop.dispose();
  f.loop.start(() => f.core);
  f.loop.snapshot(1, snapshot);
  f.loop.toggleCamera();
  f.frame();
  f.task();
  expect(f.replies).toEqual([{ type: "render.disposed" }]);
  expect(f.counts().renders).toBe(0);
});

it("disposes resources once on context loss and suppresses late frames and failures", () => {
  const f = fixture();

  f.loop.start(() => f.core);
  f.loop.snapshot(1, snapshot);
  f.frame();
  f.loop.fail("context-lost");
  f.task();
  f.frame();
  f.loop.fail("worker-error");
  f.loop.dispose();
  f.loop.dispose();
  expect(f.replies.filter((reply) => reply.type === "render.frame")).toEqual([]);
  expect(f.replies.filter((reply) => reply.type === "render.failed")).toEqual([
    { type: "render.failed", reason: "context-lost" },
  ]);
  expect(f.counts().disposals).toBe(1);
});

it("reports failed initialization, not a misleading ready frame", () => {
  const f = fixture();

  f.loop.start(() => {
    throw new Error("no GL");
  });
  f.frame();
  expect(f.replies).toEqual([{ type: "render.failed", reason: "initialization" }]);
});
