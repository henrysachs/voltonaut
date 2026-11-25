import { createEngine, createRoute, TEST_LOOP } from "@voltonaut/engine";
import { DEFAULT_RIDER_PROFILE } from "@voltonaut/shared";
import { expect, it } from "vitest";

import { createRenderLink, type RenderPort } from "./render-link.js";
import type { RenderControl, RenderReply, SceneDiagnostics } from "./render-protocol.js";

const snapshot = createEngine({
  route: createRoute(TEST_LOOP),
  profile: DEFAULT_RIDER_PROFILE,
}).snapshot();

function noop(): void {}

const diagnostics: SceneDiagnostics = {
  calls: 1,
  triangles: 100,
  distanceM: 1,
  rider: { x: 1, y: 1, z: 1 },
  headingRad: 1,
  crankRad: 1,
  camera: "chase",
  weather: "clear",
  timeOfDayS: 43_200,
  rainAmount: 0,
  cameraPosition: { x: 1, y: 1, z: 1 },
  widthPx: 800,
  heightPx: 400,
  billboardsInView: { left: 0, right: 0 },
};

class LinkFixture {
  readonly sent: RenderControl[] = [];
  private listener: (reply: RenderReply) => void = noop;
  private starts = 0;
  private terminations = 0;
  private unsubscribes = 0;
  private failures = 0;
  private frames = 0;
  private timeout: () => void = noop;
  private readonly port: RenderPort = {
    start: () => {
      this.starts += 1;
    },
    send: (command) => {
      this.sent.push(command);
    },
    subscribe: (next) => {
      this.listener = next;

      return () => {
        this.unsubscribes += 1;
      };
    },
    terminate: () => {
      this.terminations += 1;
    },
  };
  readonly link = createRenderLink(
    this.port,
    {
      failed: () => {
        this.failures += 1;
      },
      frame: () => {
        this.frames += 1;
      },
      camera: noop,
    },
    {
      schedule: (callback) => {
        this.timeout = callback;

        return 1;
      },
      cancel: noop,
    },
  );

  deliver(reply: RenderReply): void {
    this.listener(reply);
  }
  expire(): void {
    this.timeout();
  }
  counts() {
    return {
      starts: this.starts,
      terminations: this.terminations,
      unsubscribes: this.unsubscribes,
      failures: this.failures,
      frames: this.frames,
    };
  }
}

function fixture(): LinkFixture {
  return new LinkFixture();
}

it("starts once, retains only the latest snapshot until ready, and bounds unacknowledged snapshots", () => {
  const f = fixture();
  const second = { ...snapshot, distanceM: 2 };
  const third = { ...snapshot, distanceM: 3 };

  f.link.snapshot(snapshot);
  f.link.snapshot(second);
  expect(f.sent).toEqual([]);
  f.deliver({ type: "render.ready" });
  f.deliver({ type: "render.frame", stage: "after-render-task", diagnostics });
  f.deliver({ type: "render.ready" });
  f.link.snapshot(third);
  f.link.snapshot({ ...snapshot, distanceM: 4 });
  expect(f.sent).toEqual([{ type: "render.snapshot", sequence: 1, snapshot: second }]);
  f.deliver({ type: "render.accepted", sequence: 9 });
  expect(f.sent).toHaveLength(1);
  f.deliver({ type: "render.accepted", sequence: 1 });
  expect(f.sent.at(-1)).toEqual({
    type: "render.snapshot",
    sequence: 2,
    snapshot: { ...snapshot, distanceM: 4 },
  });
  f.deliver({ type: "render.accepted", sequence: 1 });
  expect(f.sent).toHaveLength(2);
  expect(f.counts().starts).toBe(1);
  expect(f.counts().frames).toBe(1);
});

it("forwards resize and camera controls, then ignores late ready/ACK/failure after disposal", () => {
  const f = fixture();
  const viewport = { widthCssPx: 800, heightCssPx: 400, devicePixelRatio: 2 };

  f.link.resize(viewport);
  f.link.toggleCamera();
  f.link.dispose();
  f.link.dispose();
  f.link.snapshot(snapshot);
  f.link.resize(viewport);
  f.link.toggleCamera();
  f.deliver({ type: "render.ready" });
  f.deliver({ type: "render.accepted", sequence: 1 });
  f.deliver({ type: "render.failed", reason: "context-lost" });
  f.deliver({ type: "render.frame", stage: "after-render-task", diagnostics });
  expect(f.sent).toEqual([
    { type: "render.resize", viewport },
    { type: "render.toggleCamera" },
    { type: "render.dispose" },
  ]);
  f.deliver({ type: "render.disposed" });
  f.expire();
  expect(f.counts()).toEqual({
    starts: 1,
    terminations: 1,
    unsubscribes: 1,
    failures: 0,
    frames: 0,
  });
});

it("does not expose early frames and treats unexpected worker EOF as failure", () => {
  const f = fixture();

  f.deliver({ type: "render.frame", stage: "after-render-task", diagnostics });
  expect(f.counts().frames).toBe(0);
  f.deliver({ type: "render.disposed" });
  expect(f.counts().failures).toBe(1);
  f.expire();
  expect(f.counts().terminations).toBe(1);
});

it("handles synchronous startup failure and stops an already running failed worker", () => {
  let failures = 0;
  let terminations = 0;

  const link = createRenderLink(
    {
      start() {
        throw new Error("transfer failed");
      },
      send() {
        throw new Error("closed port");
      },
      subscribe() {
        return noop;
      },
      terminate() {
        terminations += 1;
      },
    },
    {
      failed() {
        failures += 1;
      },
      frame: noop,
      camera: noop,
    },
    { schedule: () => 1, cancel: noop },
  );

  link.dispose();
  expect(failures).toBe(1);
  expect(terminations).toBe(1);
  const f = fixture();

  f.deliver({ type: "render.ready" });
  f.link.snapshot(snapshot);
  f.link.snapshot(snapshot);
  expect(f.sent).toHaveLength(1);
  f.deliver({ type: "render.failed", reason: "context-lost" });
  f.deliver({ type: "render.accepted", sequence: 1 });
  expect(f.counts().failures).toBe(1);
});

it("fails once on init error/EOF and terminates an unresponsive worker exactly once", () => {
  const f = fixture();

  f.deliver({ type: "render.failed", reason: "worker-error" });
  f.deliver({ type: "render.failed", reason: "worker-error" });
  f.deliver({ type: "render.ready" });
  f.expire();
  f.expire();
  f.link.dispose();
  expect(f.counts()).toEqual({
    starts: 1,
    terminations: 1,
    unsubscribes: 1,
    failures: 1,
    frames: 0,
  });
});
