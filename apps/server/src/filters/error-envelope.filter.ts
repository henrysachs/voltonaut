import type { ExceptionFilter } from "@nestjs/common";
import { Catch, HttpException } from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import { z, ZodError } from "zod";

import { ErrorEnvelopeSchema, errorEnvelope } from "@voltonaut/shared";
import type { HttpArgumentsPort } from "../api-error.js";
import type { ErrorCode, ErrorEnvelope } from "@voltonaut/shared";

import { ApiError } from "../api-error.js";

interface EnvelopeResponse {
  readonly status: (code: number) => EnvelopeResponse;
  readonly json: (body: ErrorEnvelope) => void;
  readonly set: (name: string, value: string) => void;
}

const NonEmptyStringSchema = z.string().min(1);

function isNonEmptyString(value: unknown): value is string {
  return NonEmptyStringSchema.safeParse(value).success;
}

function statusToCode(status: number): ErrorCode {
  if (status === 401) {
    return "unauthorized";
  }

  if (status === 404) {
    return "not_found";
  }

  if (status === 400 || status === 422) {
    return "validation_failed";
  }

  return "internal_error";
}

/**
 * Serializes every error into the API envelope `{ error: { code, message } }`.
 * `Retry-After` rides on 429s (rate limits, spec AK9). HttpExceptions that
 * already carry an envelope-shaped body (e.g. from the guards) keep it.
 */
interface ArgumentsHostPort {
  readonly switchToHttp: () => HttpArgumentsPort;
}

@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  public catch(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- instanceof narrowing needs the real error classes; Error subtypes are deep-mutable by design.
    exception: ApiError | ThrottlerException | ZodError | HttpException | Error,
    host: ArgumentsHostPort,
  ): void {
    const response = host.switchToHttp().getResponse<EnvelopeResponse>();
    const resolved = resolveError(exception);
    response.set("Cache-Control", "no-store");

    if (resolved.retryAfterS !== undefined) {
      response.set("Retry-After", `${resolved.retryAfterS}`);
    }

    response.status(resolved.status).json(resolved.envelope);
  }
}

interface ResolvedError {
  readonly status: number;
  readonly envelope: ErrorEnvelope;
  readonly retryAfterS: number | undefined;
}

function resolveError(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- instanceof narrowing needs the real error classes; Error subtypes are deep-mutable by design.
  exception: ApiError | ThrottlerException | ZodError | HttpException | Error,
): ResolvedError {
  const parserError = resolveParserError(exception);

  if (parserError !== undefined) {
    return parserError;
  }

  if (exception instanceof ApiError) {
    return {
      status: exception.getStatus(),
      envelope: errorEnvelope(exception.code, exception.message),
      retryAfterS: exception.retryAfterS,
    };
  }

  if (exception instanceof ThrottlerException) {
    return {
      status: 429,
      envelope: errorEnvelope("rate_limited", "too many requests"),
      retryAfterS: 60,
    };
  }

  if (exception instanceof HttpException) {
    return httpExceptionError(exception);
  }

  if (exception instanceof ZodError) {
    return {
      status: 500,
      envelope: errorEnvelope("internal_error", "internal server error"),
      retryAfterS: undefined,
    };
  }

  return {
    status: 500,
    envelope: errorEnvelope("internal_error", "internal server error"),
    retryAfterS: undefined,
  };
}

function resolveParserError(exception: Readonly<Error>): ResolvedError | undefined {
  const parsed = z
    .object({ type: z.enum(["entity.too.large", "entity.parse.failed", "encoding.unsupported"]) })
    .safeParse(exception.cause ?? exception);

  if (!parsed.success) {
    return undefined;
  }

  const errors = {
    "entity.too.large": {
      status: 413,
      code: "payload_too_large",
      message: "JSON body exceeds 8 MiB",
    },
    "entity.parse.failed": {
      status: 400,
      code: "validation_failed",
      message: "malformed JSON body",
    },
    "encoding.unsupported": {
      status: 415,
      code: "unsupported_media_type",
      message: "uncompressed JSON required",
    },
  } satisfies {
    readonly [key: string]: {
      readonly status: number;
      readonly code: ErrorCode;
      readonly message: string;
    };
  };

  const error = errors[parsed.data.type];

  return {
    status: error.status,
    envelope: errorEnvelope(error.code, error.message),
    retryAfterS: undefined,
  };
}

function httpExceptionError(exception: Readonly<HttpException>): ResolvedError {
  const status = exception.getStatus();
  const body = exception.getResponse();
  const parsed = ErrorEnvelopeSchema.safeParse(body);
  const message = isNonEmptyString(body) ? body : exception.message;

  return {
    status,
    envelope: parsed.success ? parsed.data : errorEnvelope(statusToCode(status), message),
    retryAfterS: undefined,
  };
}
