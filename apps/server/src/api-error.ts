import { HttpException } from "@nestjs/common";

import type { ErrorCode } from "@voltonaut/shared";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface HttpArgumentsPort {
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- Nest exposes caller-selected request types at this framework boundary.
  readonly getRequest: <T>() => T;
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- Nest exposes caller-selected response types at this framework boundary.
  readonly getResponse: <T>() => T;
}

export interface ExecutionContextPort {
  readonly switchToHttp: () => HttpArgumentsPort;
}

export interface ThrottleDetailPort {
  readonly ttl: number;
  readonly limit: number;
  readonly key: string;
  readonly tracker: string;
  readonly totalHits: number;
  readonly timeToExpire: number;
  readonly isBlocked: boolean;
  readonly timeToBlockExpire: number;
}

/**
 * Domain error that the global filter serializes into the API error envelope
 * `{ error: { code, message } }`. Carries the HTTP status alongside the code.
 */
export class ApiError extends HttpException {
  public readonly code: ErrorCode;
  public readonly retryAfterS: number | undefined;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    options?: { readonly retryAfterS?: number },
  ) {
    super(message, status);

    this.code = code;
    this.retryAfterS = options?.retryAfterS;
  }
}
