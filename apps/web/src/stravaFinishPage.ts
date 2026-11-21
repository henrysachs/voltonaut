import {
  StravaBridgeMessageSchema,
  StravaChannelSchema,
  StravaConfirmRequestSchema,
} from "@voltonaut/shared";

const FINISH_QUERY_FIELDS = new Set(["channel", "code", "result"]);

declare const takeStravaFinishQuery: () => string;

function finishPayload(query: string) {
  const params = new URLSearchParams(query);

  if ([...params.keys()].some((key) => !FINISH_QUERY_FIELDS.has(key)))
    throw new Error("invalid finish query");

  const id = StravaChannelSchema.parse(
    params.getAll("channel").length === 1 ? params.get("channel") : undefined,
  );

  const result =
    params.get("result") === "denied" && !params.has("code") && params.getAll("result").length === 1
      ? ({ kind: "denied" } satisfies { readonly kind: "denied" })
      : ({
          kind: "code",
          code: StravaConfirmRequestSchema.shape.code.parse(
            params.getAll("code").length === 1 && !params.has("result")
              ? params.get("code")
              : undefined,
          ),
        } satisfies { readonly kind: "code"; readonly code: string });

  return { id, result };
}

export function finishStrava(query: string): void {
  const host = document.querySelector("#strava-finish-status");

  const report = (message: string) => {
    if (host !== null) host.textContent = message;
  };

  try {
    const { id, result } = finishPayload(query);

    const channel = new BroadcastChannel(`voltonaut-strava:${id}`);

    const timer = setTimeout(() => {
      channel.close();
      report(
        "Bestätigung nicht bestätigt. Im ursprünglichen Tab den Status prüfen. Kein automatischer Login.",
      );
    }, 30000);

    channel.addEventListener("message", (event: { readonly data: unknown }) => {
      const parsed = StravaBridgeMessageSchema.safeParse(event.data);

      if (parsed.success && parsed.data.channel === id && parsed.data.type === "ack") {
        clearTimeout(timer);
        channel.close();
        report("Strava-Verbindung bestätigt. Fenster kann geschlossen werden.");
        window.close();
      }
    });
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Native BroadcastChannel is same-origin scoped and has no targetOrigin argument.
    channel.postMessage({ v: 1, type: "finish", channel: id, result });
    report(
      result.kind === "denied"
        ? "Zustimmung abgelehnt. Fenster schließen und ursprünglichen Tab prüfen."
        : "Ursprünglicher Tab prüft Browsercookie und Konto …",
    );
  } catch {
    report("Rücksprung ungültig oder Kanal nicht verfügbar. Im ursprünglichen Tab Status prüfen.");
  }
}

finishStrava(takeStravaFinishQuery());
