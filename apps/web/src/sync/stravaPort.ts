import {
  RideIdSchema,
  StravaConfirmRequestSchema,
  StravaDeliverySchema,
  StravaDisconnectRequestSchema,
  StravaRideViewSchema,
  StravaStartRequestSchema,
  StravaStartResponseSchema,
  StravaStatusSchema,
  StravaUploadRequestSchema,
  type StravaConsent,
  type StravaDelivery,
  type StravaRideView,
  type StravaStartResponse,
  type StravaStatus,
} from "@voltonaut/shared";
import { privateRoute, type PrivateSend } from "./apiRoute.js";

/** Strava connection and explicit ride delivery; every call sends cookie and bearer (ADR-017/018). */
export interface StravaPort {
  readonly status: () => Promise<StravaStatus>;
  readonly start: (channel: string) => Promise<StravaStartResponse>;
  readonly confirm: (code: string) => Promise<StravaStatus>;
  readonly disconnect: () => Promise<StravaStatus>;
  readonly ride: (rideId: string) => Promise<StravaRideView>;
  readonly upload: (consent: StravaConsent) => Promise<StravaDelivery>;
}

export const stravaRoutes = {
  status: privateRoute({
    method: "GET",
    path: () => "/v1/strava/connection",
    response: StravaStatusSchema,
    credentials: "include",
  }),
  start: privateRoute({
    method: "POST",
    path: () => "/v1/strava/connect-start",
    body: (channel: string) =>
      JSON.stringify(StravaStartRequestSchema.parse({ action: "connect", channel })),
    response: StravaStartResponseSchema,
    credentials: "include",
  }),
  confirm: privateRoute({
    method: "POST",
    path: () => "/v1/strava/confirm",
    body: (code: string) => JSON.stringify(StravaConfirmRequestSchema.parse({ code })),
    response: StravaStatusSchema,
    credentials: "include",
  }),
  disconnect: privateRoute({
    method: "POST",
    path: () => "/v1/strava/disconnect",
    body: () => JSON.stringify(StravaDisconnectRequestSchema.parse({ action: "disconnect" })),
    response: StravaStatusSchema,
    credentials: "include",
  }),
  ride: privateRoute({
    method: "GET",
    path: (rideId: string) => `/v1/strava/rides/${RideIdSchema.parse(rideId)}`,
    response: StravaRideViewSchema,
    credentials: "include",
  }),
  upload: privateRoute({
    method: "POST",
    path: (consent: StravaConsent) => `/v1/strava/rides/${RideIdSchema.parse(consent.rideId)}`,
    body: (consent) =>
      JSON.stringify(StravaUploadRequestSchema.parse({ action: "upload", consent })),
    response: StravaDeliverySchema,
    credentials: "include",
  }),
};

export function stravaPort(send: PrivateSend): StravaPort {
  return {
    status: () => send(stravaRoutes.status, null),
    start: (channel) => send(stravaRoutes.start, channel),
    confirm: (code) => send(stravaRoutes.confirm, code),
    disconnect: () => send(stravaRoutes.disconnect, null),
    ride: (rideId) => send(stravaRoutes.ride, rideId),
    upload: (consent) => send(stravaRoutes.upload, consent),
  };
}
