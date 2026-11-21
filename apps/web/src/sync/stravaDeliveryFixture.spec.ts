import { afterEach } from "vitest";
import {
  StravaConsentSchema,
  StravaDeliverySchema,
  StravaRideViewSchema,
  StravaStatusSchema,
  type StravaConsent,
  type StravaDelivery,
  type StravaRideView,
  type StravaStatus,
} from "@voltonaut/shared";
import { ApplicationSession } from "./applicationSession.js";
import type { AccountLease, PrivateAuthTransport } from "./privateAuthTransport.js";
import { StravaSync } from "./stravaSync.js";
import type { StravaChannel, StravaPopup } from "./stravaBridge.js";

export const rideA = "00000000-0000-4000-8000-000000000001";
export const rideB = "00000000-0000-4000-8000-000000000002";
export const deliveryChannel = "00000000-0000-4000-8000-000000000003";

export interface DeliveryControls {
  readonly session: Readonly<ApplicationSession>;
  readonly sync: Readonly<StravaSync>;
  readonly message: StravaDeliveryFixture["message"];
}

export function pendingResponse<T>() {
  let settle: ((value: T) => void) | undefined;
  let fail: ((error: Readonly<Error>) => void) | undefined;

  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });

  return {
    promise,
    resolve: (value: T) => {
      settle?.(value);
    },
    reject: (error: Readonly<Error>) => {
      fail?.(error);
    },
  };
}

export function consentFor(rideId = rideA): StravaConsent {
  return StravaConsentSchema.parse({
    rideId,
    payloadHash: "a".repeat(64),
    exportHash: "b".repeat(64),
    exportVersion: "tcx-1",
    connectionGeneration: "connection-a",
    athleteId: "42",
    sourcePolicy: "declared_ble_v1",
    noticeRevision: "virtual-ride-1",
  });
}

export function offerFor(rideId = rideA): StravaRideView {
  return StravaRideViewSchema.parse({
    kind: "offer",
    consent: consentFor(rideId),
    assurance: "client_declared",
  });
}

export function deliveryFor(progress: StravaDelivery["progress"], stopped = false): StravaDelivery {
  const consent = consentFor();

  return StravaDeliverySchema.parse({
    deliveryId: rideB,
    rideId: rideA,
    authority: stopped
      ? { kind: "stopped", consent, stoppedAtMs: 20, reason: "disconnect" }
      : { kind: "consented", consent, consentedAtMs: 10 },
    progress,
  });
}

const unexpected = (): Promise<never> => Promise.reject(new Error("unexpected account operation"));

export class StravaDeliveryFixture {
  readonly requests: {
    readonly userId: string;
    readonly method: string;
    readonly rideId?: string;
  }[] = [];
  readonly consents: StravaConsent[] = [];
  readonly opens: string[] = [];
  readonly sent: Parameters<StravaChannel["send"]>[0][] = [];
  closed = 0;
  #listener: Parameters<StravaChannel["listen"]>[0] | undefined;
  status: () => Promise<StravaStatus> = () =>
    Promise.resolve(StravaStatusSchema.parse({ status: "disconnected" }));
  ride: (rideId: string) => Promise<StravaRideView> = (rideId) => Promise.resolve(offerFor(rideId));
  upload: (consent: StravaConsent) => Promise<StravaDelivery> = () =>
    Promise.resolve(deliveryFor({ kind: "queued", notBeforeMs: 0 }));
  disconnect: () => Promise<StravaStatus> = () =>
    Promise.resolve(StravaStatusSchema.parse({ status: "disconnected" }));
  start: () => Promise<{ readonly authorizationUrl: string }> = () =>
    Promise.resolve({
      authorizationUrl: `https://www.strava.com/oauth/authorize?client_id=123&redirect_uri=${encodeURIComponent("http://localhost:3000/v1/strava/callback")}&response_type=code&approval_prompt=force&scope=activity%3Awrite&state=${"s".repeat(43)}`,
    });
  confirm: () => Promise<StravaStatus> = () => Promise.resolve({ status: "disconnected" });
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

  message(message: Parameters<StravaChannel["send"]>[0]): void {
    this.#listener?.(message);
  }

  private popup(): StravaPopup {
    return {
      origin: "http://localhost:5238",
      uuid: () => deliveryChannel,
      open: (path) => {
        this.opens.push(path);
      },
      channel: () => ({
        send: (message) => {
          this.sent.push(message);
        },
        listen: (listener) => {
          this.#listener = listener;

          return () => {
            this.#listener = undefined;
          };
        },
        close: () => {
          this.closed += 1;
        },
      }),
    };
  }

  private transport(): PrivateAuthTransport {
    return {
      authorize: (authorization): AccountLease => ({
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
          status: () => {
            this.requests.push({ userId: authorization.userId, method: "status" });

            return this.status();
          },
          ride: (rideId) => {
            this.requests.push({ userId: authorization.userId, method: "GET", rideId });

            return this.ride(rideId);
          },
          upload: (consent) => {
            this.requests.push({
              userId: authorization.userId,
              method: "POST",
              rideId: consent.rideId,
            });
            this.consents.push(consent);

            return this.upload(consent);
          },
          disconnect: () => {
            this.requests.push({ userId: authorization.userId, method: "disconnect" });

            return this.disconnect();
          },
          start: () => this.start(),
          confirm: () => this.confirm(),
        },
      }),
    };
  }
}
