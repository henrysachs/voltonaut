import { DEFAULT_AVATAR_CONFIG } from "@voltonaut/rules";
import type { AvatarConfig } from "@voltonaut/shared";
import { expect, it } from "vitest";

import { createPreviewLoop, type PreviewScene } from "./previewLoop.js";
import type { PreviewDraw, PreviewReply, PreviewViewport } from "./previewProtocol.js";

function noop(): void {}

const VISIBLE: PreviewViewport = { widthCssPx: 320, heightCssPx: 240, devicePixelRatio: 2 };

class LoopFixture {
  readonly replies: PreviewReply[] = [];
  readonly angles: number[] = [];
  readonly looks: AvatarConfig[] = [];
  readonly viewports: PreviewViewport[] = [];
  disposals = 0;
  draw: PreviewDraw | undefined = { calls: 4, triangles: 9000 };
  private frameCallback: ((nowMs: number) => void) | undefined;
  private taskCallback: () => void = noop;
  readonly loop = createPreviewLoop(
    {
      requestFrame: (callback) => {
        this.frameCallback = callback;

        return 1;
      },
      cancelFrame: () => {
        this.frameCallback = undefined;
      },
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
  readonly scene: PreviewScene = {
    render: (angleRad) => {
      this.angles.push(angleRad);

      return this.draw;
    },
    resize: (viewport) => {
      this.viewports.push(viewport);
    },
    setLook: (look) => {
      this.looks.push(look);
    },
    dispose: () => {
      this.disposals += 1;
    },
  };

  frame(nowMs: number): void {
    this.frameCallback?.(nowMs);
  }

  task(): void {
    this.taskCallback();
  }
}

it("reports drawn only after a real draw and a following task, once", () => {
  const f = new LoopFixture();

  f.draw = undefined;
  f.loop.start(() => f.scene);
  f.frame(0);
  f.task();
  expect(f.replies).toEqual([{ type: "preview.ready" }]);

  f.draw = { calls: 0, triangles: 0 };
  f.frame(16);
  f.task();
  expect(f.replies).toEqual([{ type: "preview.ready" }]);

  f.draw = { calls: 4, triangles: 9000 };
  f.frame(32);
  expect(f.replies).toEqual([{ type: "preview.ready" }]);
  f.task();
  f.frame(48);
  f.task();
  expect(f.replies).toEqual([
    { type: "preview.ready" },
    { type: "preview.drawn", draw: { calls: 4, triangles: 9000 } },
  ]);
});

it("auto-rotates with capped frame steps and applies manual rotation", () => {
  const f = new LoopFixture();

  f.loop.start(() => f.scene);
  f.loop.setAutoRotate(true);
  f.frame(1000);
  f.frame(2000);
  f.loop.setAutoRotate(false);
  f.loop.rotateBy(Math.PI / 6);
  f.loop.rotateBy(Number.NaN);
  f.frame(3000);

  expect(f.angles[0]).toBeCloseTo(-0.65);
  expect(f.angles[1]).toBeCloseTo(-0.65 + 0.1 * 0.22);
  expect(f.angles[2]).toBeCloseTo(-0.65 + 0.1 * 0.22 + Math.PI / 6);
});

it("parses looks at the worker boundary and fails on an invalid look", () => {
  const f = new LoopFixture();

  f.loop.look(DEFAULT_AVATAR_CONFIG);
  f.loop.start(() => f.scene);
  f.loop.look(DEFAULT_AVATAR_CONFIG);
  expect(f.looks).toEqual([DEFAULT_AVATAR_CONFIG]);

  f.loop.look({
    ...DEFAULT_AVATAR_CONFIG,
    bike: { ...DEFAULT_AVATAR_CONFIG.bike, frameColor: "red" },
  });
  expect(f.replies.at(-1)).toEqual({ type: "preview.failed", reason: "invalid-look" });
  expect(f.disposals).toBe(1);
});

it("forwards resizes to a running scene only", () => {
  const f = new LoopFixture();

  f.loop.resize(VISIBLE);
  f.loop.start(() => f.scene);
  f.loop.resize(VISIBLE);
  expect(f.viewports).toEqual([VISIBLE]);
});

it("disposes once, acknowledges and ignores late frames and tasks", () => {
  const f = new LoopFixture();

  f.loop.start(() => f.scene);
  f.frame(0);
  f.loop.dispose();
  f.loop.dispose();
  f.task();
  f.frame(16);
  f.loop.fail("context-lost");
  expect(f.disposals).toBe(1);
  expect(f.angles).toHaveLength(1);
  expect(f.replies).toEqual([{ type: "preview.ready" }, { type: "preview.disposed" }]);
});

it("reports initialization and render failures and releases the scene", () => {
  const init = new LoopFixture();

  init.loop.start(() => {
    throw new Error("no WebGL2");
  });
  init.loop.start(() => init.scene);
  expect(init.replies).toEqual([{ type: "preview.failed", reason: "initialization" }]);

  const render = new LoopFixture();

  render.loop.start(() => ({
    ...render.scene,
    render() {
      throw new Error("GPU failure");
    },
  }));
  render.frame(0);
  render.frame(16);
  expect(render.replies.at(-1)).toEqual({ type: "preview.failed", reason: "render-error" });
  expect(render.disposals).toBe(1);

  const lost = new LoopFixture();

  lost.loop.start(() => lost.scene);
  lost.loop.fail("context-lost");
  lost.loop.fail("worker-error");
  lost.loop.dispose();
  expect(lost.replies.filter((reply) => reply.type === "preview.failed")).toEqual([
    { type: "preview.failed", reason: "context-lost" },
  ]);
  expect(lost.disposals).toBe(1);
});
