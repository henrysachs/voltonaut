import { z } from "zod";

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This boundary consumes the native mutable response stream once.
export async function boundedBody(response: Readonly<Response>): Promise<string> {
  const reader = response.body?.getReader();

  if (reader === undefined) return "";
  const chunks: Uint8Array[] = [];
  let length = 0;

  try {
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- Sequential reads enforce the response byte bound.
      const item = await reader.read();

      if (item.done) break;
      const chunk = z.instanceof(Uint8Array).parse(item.value);
      length += chunk.byteLength;

      if (length > 16384) throw new Error("provider response exceeds byte limit");
      chunks.push(chunk);
    }

    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await reader.cancel();
  }
}

export function isJsonResponse(response: {
  readonly headers: { readonly get: (name: string) => string | null };
}): boolean {
  return (
    response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() === "application/json"
  );
}

export function stravaMultipart(tcx: string, externalId: string): FormData {
  const form = new FormData();
  form.set("file", new Blob([tcx], { type: "application/vnd.garmin.tcx+xml" }), externalId);
  form.set("data_type", "tcx");
  form.set("sport_type", "VirtualRide");
  form.set("trainer", "1");
  form.set("external_id", externalId);
  form.set("visibility", "only_me");
  form.set(
    "description",
    "Virtuelle Distanz. Quelle vom Client als BLE deklariert, nicht hardwareattestiert.",
  );

  return form;
}
