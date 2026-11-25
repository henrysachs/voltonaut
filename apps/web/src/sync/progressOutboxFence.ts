/* oxlint-disable typescript/prefer-readonly-parameter-types -- Fence and owner inputs are readonly contracts; Oxlint does not follow imported aliases. */
import { JournalIdSchema } from "@voltonaut/shared";

import {
  ProgressOutboxError,
  type ProgressOutboxFailure,
  type ProgressWriteFence,
} from "./progressOutbox.js";
import type { ProgressAccountOwner } from "./progressOutboxSchema.js";

export function progressError(cause: ProgressOutboxFailure, message: string): ProgressOutboxError {
  return new ProgressOutboxError(cause, message);
}

export function asProgressError(cause: unknown): Error {
  return cause instanceof Error ? cause : progressError("storage", "Progress-Speicherfehler.");
}

export function progressSessionError(): ProgressOutboxError {
  return progressError("session", "Progress-Sitzung widerrufen. Keine Daten geändert.");
}

export function checkProgressFence(fence: Readonly<ProgressWriteFence>, consent = false): void {
  if (fence.signal.aborted || !fence.current()) throw progressSessionError();

  if (consent && fence.consentVersion <= 0) {
    throw progressError("consent", "Progress-Zustimmung fehlt.");
  }
}

export function normalizeProgressOwner(
  owner: Readonly<ProgressAccountOwner>,
): ProgressAccountOwner {
  return {
    apiOrigin: new URL(owner.apiOrigin).origin,
    userId: owner.userId.toLowerCase(),
  };
}

export function normalizeProgressFence(fence: Readonly<ProgressWriteFence>): ProgressWriteFence {
  return {
    ...fence,
    ...normalizeProgressOwner(fence),
    journalId: JournalIdSchema.parse(fence.journalId),
  };
}
