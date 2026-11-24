import { afterEach } from "vitest";
import type { StravaStatus } from "@voltonaut/shared";
import { ApplicationSession } from "./applicationSession.js";
import { StravaSync } from "./stravaSync.js";
import type { PrivateAuthTransport } from "./privateAuthTransport.js";
import type { StravaPopup, StravaChannel } from "./stravaBridge.js";
import { deferred } from "./testdata/deferred.js";
import {
  unusedStravaLease,
  unexpectedAccountData,
  unexpectedMembership,
} from "./testdata/unusedStravaLease.js";

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
  readonly session = new ApplicationSession({
    privateTransport: this.transport(),
    persistence: { load: () => {}, save: () => false, clear: () => true },
    navigate: () => {
      throw new Error("no automatic login");
    },
    transport: {
      mode: () => Promise.resolve({ mode: "oidc" }),
      exchange: (code) =>
        Promise.resolve({
          sessionToken: `token-${code}`,
          user: { id: code, email: `${code}@example.test`, createdAt: "2026-11-20T00:00:00.000Z" },
        }),
      me: unexpected,
      logout: () => Promise.resolve(),
    },
  });
  readonly sync = new StravaSync(this.session, this.popup());

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
  private transport(): PrivateAuthTransport {
    return {
      authorize: (authorization) => ({
        ...unexpectedMembership,
        ...unexpectedAccountData,
        apiOrigin: "http://localhost:3000",
        userId: authorization.userId,
        generation: authorization.generation,
        signal: authorization.signal,
        current: authorization.current,
        profile: unexpected,
        saveProfile: unexpected,
        history: unexpected,
        detail: unexpected,
        upload: unexpected,
        strava: {
          ...unusedStravaLease,
          status: () =>
            this.#hold && authorization.userId === "a"
              ? this.pending.promise
              : Promise.resolve({ status: "disconnected" }),
          start: () => {
            this.starts.push(authorization.userId);

            return Promise.resolve({ authorizationUrl });
          },
          confirm: () => {
            this.confirmations.push(authorization.userId);

            return Promise.resolve({
              status: "connected",
              athleteId: "42",
              scope: "activity:write",
              accessExpiresAt: "2027-01-01T00:00:00.000Z",
            });
          },
          upload: (consent) => {
            this.uploads.push(authorization.userId);

            return unusedStravaLease.upload(consent);
          },
        },
      }),
    };
  }
}
