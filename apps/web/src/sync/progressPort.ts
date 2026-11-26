import {
  ProgressCheckpointBatchSchema,
  ProgressConsentStateSchema,
  ProgressConsentUpdateSchema,
  ProgressHistoryResponseSchema,
  ProgressRangeResponseSchema,
  type ProgressCheckpointBatch,
  type ProgressConsentState,
  type ProgressHistoryResponse,
  type VoltsRideRangeReceipt,
} from "@voltonaut/shared";
import { PrivateRequestError, privateRoute, type PrivateSend } from "./apiRoute.js";

/** Progress consent of this session generation and checkpoint delivery (specs E6-08, E6-10). */
export interface ProgressPort {
  readonly status: () => Promise<ProgressConsentState>;
  readonly update: (enabled: boolean) => Promise<ProgressConsentState>;
  readonly submit: (batch: ProgressCheckpointBatch) => Promise<VoltsRideRangeReceipt>;
  /** Newest server-confirmed journals (spec E6-11). */
  readonly history: () => Promise<ProgressHistoryResponse>;
}

export const progressRoutes = {
  status: privateRoute({
    method: "GET",
    path: () => "/v1/me/progress-consent",
    response: ProgressConsentStateSchema,
    credentials: "omit",
  }),
  update: privateRoute({
    method: "PUT",
    path: () => "/v1/me/progress-consent",
    body: (update: Readonly<{ enabled: boolean; sessionGeneration: number }>) =>
      JSON.stringify(ProgressConsentUpdateSchema.parse(update)),
    response: ProgressConsentStateSchema,
    credentials: "omit",
  }),
  history: privateRoute({
    method: "GET",
    path: () => "/v1/me/progress-history",
    response: ProgressHistoryResponseSchema,
    credentials: "omit",
  }),
  submit: privateRoute({
    method: "POST",
    path: () => "/v1/progress/checkpoints",
    body: (batch: ProgressCheckpointBatch) => JSON.stringify(batch),
    response: ProgressRangeResponseSchema,
    credentials: "omit",
  }),
};

export function progressPort(send: PrivateSend, generation: number): ProgressPort {
  return {
    status: () => send(progressRoutes.status, null),
    update: (enabled) => send(progressRoutes.update, { enabled, sessionGeneration: generation }),
    history: () => send(progressRoutes.history, null),
    async submit(batch) {
      const payload = ProgressCheckpointBatchSchema.parse(batch);
      const response = await send(progressRoutes.submit, payload);

      if (
        !payload.checkpoints.every(
          (checkpoint) => response.range.journalId === checkpoint.journalId,
        )
      )
        throw new PrivateRequestError("contract");

      return response.range;
    },
  };
}
