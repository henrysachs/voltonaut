import { afterEach } from "vitest";
import type { StravaStatus } from "@voltonaut/shared";
import { StravaSync } from "./stravaSync.js";
import type { StravaChannel, StravaLease, StravaPopup } from "./stravaBridge.js";
import { ScopeDriver, testBinding } from "./testdata/scopeDriver.js";
import { deferred } from "./testdata/deferred.js";

export const channelId = "00000000-0000-4000-8000-000000000001";
const authorizationUrl = `https://www.strava.com/oauth/authorize?client_id=123&redirect_uri=${encodeURIComponent("http://localhost:3000/v1/strava/callback")}&response_type=code&approval_prompt=force&scope=activity%3Awrite&state=${"s".repeat(43)}`;
const unexpected = (): Promise<never> => Promise.reject(new Error("unexpected account operation"));

export class StravaFixture {
  readonly starts: string[] = [];
  readonly confirmations: string[] = [];
  readonly uploads: string[] = [];
  readonly opens: string[] = [];
  readonly pending = deferred<StravaStatus>();
  #hold = false;
  #absent = false;
  #listener: Parameters<StravaChannel["listen"]>[0] | undefined;
  readonly session = new ScopeDriver<StravaLease>((userId, generation) =>
    this.lease(userId, generation),
  );
  readonly sync = new StravaSync(this.session.scope, this.popup());

  constructor() {
    afterEach(() => {
      this.sync.dispose();
    });
  }
  hold(): void {
    this.#hold = true;
  }
  absent(): void {
    this.#absent = true;
  }
  message(type: "ready" | "finish", channel = channelId): void {
    this.#listener?.(
      type === "ready"
        ? { v: 1, type, channel }
        : { v: 1, type, channel, result: { kind: "code", code: "c".repeat(43) } },
    );
  }
  private popup(): StravaPopup {
    return {
      origin: "http://localhost:5238",
      uuid: () => channelId,
      open: (path) => {
        this.opens.push(path);
      },
      channel: () => {
        if (this.#absent) throw new Error("denied");

        return {
          send: () => {},
          listen: (callback) => {
            this.#listener = callback;

            return () => {
              this.#listener = undefined;
            };
          },
          close: () => {},
        };
      },
    };
  }
  private lease(userId: string, generation: number): StravaLease {
    return {
      ...testBinding(userId, generation),
      strava: {
        disconnect: unexpected,
        ride: unexpected,
        status: () =>
          this.#hold && userId === "a"
            ? this.pending.promise
            : Promise.resolve({ status: "disconnected" }),
        start: () => {
          this.starts.push(userId);

          return Promise.resolve({ authorizationUrl });
        },
        confirm: () => {
          this.confirmations.push(userId);

          return Promise.resolve({
            status: "connected",
            athleteId: "42",
            scope: "activity:write",
            accessExpiresAt: "2027-01-01T00:00:00.000Z",
          });
        },
        upload: () => {
          this.uploads.push(userId);

          return unexpected();
        },
      },
    };
  }
}
