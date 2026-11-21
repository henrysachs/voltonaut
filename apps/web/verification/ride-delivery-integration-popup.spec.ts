/// <reference types="node" />
// oxlint-disable typescript/prefer-readonly-parameter-types -- This observer reads native document-start browser state without replacing APIs.
import { expect, type BrowserContext } from "@playwright/test";
import { z } from "../../../packages/shared/node_modules/zod/index.js";

const prefix = "VOLTONAUT_VERIFICATION_NATIVE_POPUP ";

const PopupSchema = z
  .object({ origin: z.string().url(), path: z.string(), noopener: z.boolean() })
  .readonly();

export const popupObservations: z.infer<typeof PopupSchema>[] = [];

export async function observePopups(context: BrowserContext): Promise<void> {
  popupObservations.length = 0;
  context.on("console", (message) => {
    const text = message.text();

    if (text.startsWith(prefix))
      popupObservations.push(PopupSchema.parse(JSON.parse(text.slice(prefix.length))));
  });
  await context.addInitScript((marker) => {
    if (location.pathname.startsWith("/strava/")) {
      console.warn(
        marker +
          JSON.stringify({
            origin: location.origin,
            path: location.pathname,
            noopener: window.opener === null,
          }),
      );
    }
  }, prefix);
}

export async function assertNativeNoopener(origin: string): Promise<void> {
  await expect
    .poll(() => {
      const bridge = popupObservations.filter(
        (entry) => entry.origin === origin && entry.path === "/strava/bridge",
      );

      return bridge.length > 0 && bridge.every((entry) => entry.noopener);
    })
    .toBe(true);
}
