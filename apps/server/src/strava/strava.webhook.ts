import { timingSafeEqual } from "node:crypto";
import { Body, Controller, Get, Post, Inject, Req, Header, HttpCode } from "@nestjs/common";
import { StravaWebhookEventSchema } from "@voltonaut/shared";
import type { StravaWebhookEvent } from "@voltonaut/shared";
import { Public } from "../auth/auth-request.js";
import { SERVER_CONFIG } from "../config.module.js";
import type { ServerConfig } from "../config.module.js";
import { ApiError } from "../api-error.js";
import { StravaAuthorizationStore } from "./strava.authorization-store.js";

export type WebhookHint =
  | { readonly kind: "ignored" }
  | { readonly kind: "authorization"; readonly athleteId: string };

function webhookHint(
  event: Readonly<StravaWebhookEvent>,
  subscriptionId: string | null,
): WebhookHint {
  return String(event.subscription_id) === subscriptionId &&
    event.object_type === "athlete" &&
    event.aspect_type === "update" &&
    event.updates.authorized === "false" &&
    event.object_id === event.owner_id
    ? { kind: "authorization", athleteId: String(event.owner_id) }
    : { kind: "ignored" };
}

function webhookChallenge(originalUrl: string, verifyToken: string) {
  const query = new URL(originalUrl, "http://webhook.invalid").searchParams;
  const keys = ["hub.mode", "hub.challenge", "hub.verify_token"];

  if (
    [...query.keys()].length !== 3 ||
    keys.some((key) => query.getAll(key).length !== 1) ||
    query.get("hub.mode") !== "subscribe"
  )
    throw new ApiError(400, "validation_failed", "invalid webhook query");
  const challenge = query.get("hub.challenge") ?? "";
  const supplied = query.get("hub.verify_token") ?? "";

  if (!/^[\u0021-\u007E]{1,256}$/u.test(challenge) || supplied.length > 256)
    throw new ApiError(400, "validation_failed", "invalid webhook query");
  const actual = Buffer.from(supplied);
  const expected = Buffer.from(verifyToken);

  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new ApiError(403, "unauthorized", "webhook verification failed");

  return { "hub.challenge": challenge };
}

@Controller("v1/strava/webhook")
@Public()
export class StravaWebhookController {
  public constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(StravaAuthorizationStore) private readonly store: Readonly<StravaAuthorizationStore>,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  public challenge(@Req() req: { readonly originalUrl: string }) {
    if (this.config.strava.mode === "disabled") throw new ApiError(404, "not_found", "not found");

    return webhookChallenge(req.originalUrl, this.config.strava.webhook.verifyToken);
  }

  @Post()
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  public event(
    @Body() body: Readonly<StravaWebhookEvent>,
    @Req() req: { readonly headers: { readonly "content-type"?: string } },
  ): void {
    if (this.config.strava.mode === "disabled") throw new ApiError(404, "not_found", "not found");

    if (req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json")
      throw new ApiError(415, "unsupported_media_type", "JSON required");
    const parsed = StravaWebhookEventSchema.safeParse(body);

    if (!parsed.success) throw new ApiError(400, "validation_failed", "invalid webhook event");
    const hint = webhookHint(parsed.data, this.config.strava.webhook.subscriptionId);

    if (hint.kind === "ignored") return;

    try {
      this.store.hint(hint.athleteId);
    } catch {
      throw new ApiError(503, "internal_error", "webhook persistence unavailable");
    }
  }
}
