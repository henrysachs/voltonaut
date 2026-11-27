import { DEFAULT_AVATAR_CONFIG } from "@voltonaut/rules";
import { expect, it } from "vitest";

import { createPreviewLink, type PreviewPort } from "./previewLink.js";
import { DEFAULT_PREVIEW_ORBIT } from "./previewOrbit.js";
import type { PreviewControl, PreviewReply } from "./previewProtocol.js";

function noop(): void {}

const draw = { calls: 4, triangles: 9000 };

class LinkFixture {
  readonly sent: PreviewControl[] = [];
  starts = 0;
  terminations = 0;
  unsubscribes = 0;
  failures = 0;
  readonly draws: (typeof draw)[] = [];
  private listener: (reply: Readonly<PreviewReply>) => void = noop;
  private timeout: () => void = noop;
  private readonly port: PreviewPort = {
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
  readonly link = createPreviewLink(
    this.port,
    {
      failed: () => {
        this.failures += 1;
      },
      drawn: (next) => {
        this.draws.push(next);
      },
    },
    {
      schedule: (callback) => {
        this.timeout = callback;

        return 1;
      },
      cancel: noop,
    },
  );

  deliver(reply: Readonly<PreviewReply>): void {
    this.listener(reply);
  }

  expire(): void {
    this.timeout();
  }
}

it("starts the port once and forwards view commands in order", () => {
  const f = new LinkFixture();

  f.link.send({ type: "preview.autoRotate", enabled: false });
  f.link.send({ type: "preview.look", look: DEFAULT_AVATAR_CONFIG });
  f.link.send({ type: "preview.orbit", orbit: DEFAULT_PREVIEW_ORBIT });
  f.deliver({ type: "preview.ready" });

  expect(f.starts).toBe(1);
  expect(f.sent).toEqual([
    { type: "preview.autoRotate", enabled: false },
    { type: "preview.look", look: DEFAULT_AVATAR_CONFIG },
    { type: "preview.orbit", orbit: DEFAULT_PREVIEW_ORBIT },
  ]);
});

it("reports readiness only from a worker draw", () => {
  const f = new LinkFixture();

  f.deliver({ type: "preview.ready" });
  expect(f.draws).toEqual([]);
  f.deliver({ type: "preview.drawn", draw });
  expect(f.draws).toEqual([draw]);
});

it("resolves a capture with the matching worker blob", async () => {
  const f = new LinkFixture();
  const blob = new Blob(["png"], { type: "image/png" });
  const capture = f.link.capture(41);

  f.deliver({ type: "preview.captured", requestId: 40, blob: new Blob(["wrong"]) });
  f.deliver({ type: "preview.captured", requestId: 41, blob });

  await expect(capture).resolves.toBe(blob);
  expect(f.sent).toEqual([{ type: "preview.capture", requestId: 41 }]);
});

it("rejects pending captures once on worker failure", async () => {
  const f = new LinkFixture();
  const first = f.link.capture(1);
  const second = f.link.capture(2);

  f.deliver({ type: "preview.failed", reason: "capture-error" });
  await expect(first).rejects.toThrow("Preview capture failed");
  await expect(second).rejects.toThrow("Preview capture failed");
  expect(f.failures).toBe(1);
});

it("rejects pending captures when disposed and ignores a late capture reply", async () => {
  const f = new LinkFixture();
  const capture = f.link.capture(5);

  f.link.dispose();
  await expect(capture).rejects.toThrow("Preview capture failed");
  f.deliver({ type: "preview.captured", requestId: 5, blob: new Blob(["late"]) });
  f.deliver({ type: "preview.disposed" });
  f.expire();
  expect({ terminations: f.terminations, failures: f.failures }).toEqual({
    terminations: 1,
    failures: 0,
  });
});

it("terminates after the dispose ack and ignores late messages", () => {
  const f = new LinkFixture();

  f.link.dispose();
  f.link.dispose();
  f.link.send({ type: "preview.orbit", orbit: DEFAULT_PREVIEW_ORBIT });
  f.deliver({ type: "preview.drawn", draw });
  f.deliver({ type: "preview.failed", reason: "context-lost" });
  expect(f.sent).toEqual([{ type: "preview.dispose" }]);
  expect(f.terminations).toBe(0);
  f.deliver({ type: "preview.disposed" });
  f.expire();
  expect({ terminations: f.terminations, failures: f.failures, draws: f.draws.length }).toEqual({
    terminations: 1,
    failures: 0,
    draws: 0,
  });
  expect(f.unsubscribes).toBe(1);
});

it("terminates an unresponsive worker after the timer exactly once", () => {
  const f = new LinkFixture();

  f.link.dispose();
  f.expire();
  f.expire();
  f.deliver({ type: "preview.disposed" });
  expect(f.terminations).toBe(1);
});

it("fails once on worker failure or unexpected EOF and stops the worker", () => {
  const failed = new LinkFixture();

  failed.deliver({ type: "preview.failed", reason: "initialization" });
  failed.deliver({ type: "preview.failed", reason: "worker-error" });
  failed.link.send({ type: "preview.orbit", orbit: DEFAULT_PREVIEW_ORBIT });
  expect(failed.failures).toBe(1);
  expect(failed.sent).toEqual([{ type: "preview.dispose" }]);
  failed.deliver({ type: "preview.disposed" });
  expect(failed.terminations).toBe(1);

  const eof = new LinkFixture();

  eof.deliver({ type: "preview.disposed" });
  expect(eof.failures).toBe(1);
  eof.expire();
  expect(eof.terminations).toBe(1);
});

it("handles a synchronous start failure without a second transfer attempt", () => {
  let starts = 0;
  let failures = 0;
  let terminations = 0;

  const link = createPreviewLink(
    {
      start() {
        starts += 1;
        throw new Error("transfer failed");
      },
      send() {
        throw new Error("closed port");
      },
      subscribe: () => noop,
      terminate() {
        terminations += 1;
      },
    },
    {
      failed() {
        failures += 1;
      },
      drawn: noop,
    },
    { schedule: () => 1, cancel: noop },
  );

  link.send({ type: "preview.orbit", orbit: DEFAULT_PREVIEW_ORBIT });
  link.dispose();
  expect({ starts, failures, terminations }).toEqual({ starts: 1, failures: 1, terminations: 1 });
});
