import { z } from "zod";
import { boundedBody, isJsonResponse } from "./strava.provider-http.js";

export type AuthorizationProof =
  | { readonly kind: "valid" }
  | { readonly kind: "deferred"; readonly unauthorized: boolean };

export async function verifyAthlete(input: {
  readonly providerOrigin: string;
  readonly athleteId: string;
  readonly accessToken: string;
  readonly signal: Readonly<AbortSignal>;
  readonly onHeaders: (headers: Readonly<Headers>, status: number) => void;
}): Promise<AuthorizationProof> {
  try {
    const response = await fetch(new URL("/api/v3/athlete", input.providerOrigin), {
      headers: { Authorization: `Bearer ${input.accessToken}`, Accept: "application/json" },
      signal: input.signal,
      redirect: "error",
    });

    input.onHeaders(response.headers, response.status);

    if (response.status !== 200 || !isJsonResponse(response)) {
      await response.body?.cancel();

      return { kind: "deferred", unauthorized: response.status === 401 };
    }

    const athlete = z
      .object({ id: z.number().int().positive().safe() })
      .safeParse(JSON.parse(await boundedBody(response)));

    return athlete.success && String(athlete.data.id) === input.athleteId
      ? { kind: "valid" }
      : { kind: "deferred", unauthorized: false };
  } catch {
    return { kind: "deferred", unauthorized: false };
  }
}
