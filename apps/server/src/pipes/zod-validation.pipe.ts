import { Injectable } from "@nestjs/common";
import type { PipeTransform } from "@nestjs/common";
import type { ZodError } from "zod";

import { ApiError } from "../api-error.js";
import type { JsonValue } from "../api-error.js";

export interface ZodBoundary<Output> {
  readonly safeParse: (data: JsonValue) => BoundaryResult<Output>;
}

export type BoundaryResult<Output> =
  | { readonly success: true; readonly data: Output }
  | { readonly success: false; readonly error: ZodError };

/**
 * Hand-rolled Zod request pipe. nestjs-zod 5.6.0 does not declare
 * `@nestjs/common` 12 peers and cannot be installed under
 * `strict-peer-dependencies`, so the boundary parse lives here (spec AK4
 * expects every request validated against the shared schemas; the behavior
 * matches nestjs-zod's ZodValidationPipe, but maps failures to the API error
 * envelope with 422 `validation_failed`).
 */
@Injectable()
export class ZodValidationPipe<Output> implements PipeTransform<JsonValue, Output> {
  public constructor(private readonly schema: ZodBoundary<Output>) {}

  public transform(value: JsonValue): Output {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new ApiError(422, "validation_failed", formatIssues(result.error.issues));
    }

    return result.data;
  }
}

function formatIssues(
  issues: readonly { readonly path: readonly (string | number)[]; readonly message: string }[],
): string {
  const parts = issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);

  return `request body failed validation (${parts.slice(0, 5).join("; ")})`;
}
