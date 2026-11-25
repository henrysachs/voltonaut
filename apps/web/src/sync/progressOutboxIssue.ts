/* oxlint-disable typescript/prefer-readonly-parameter-types -- Zod issue callbacks require mutable path arrays. */
export interface ProgressIssueContext {
  readonly addIssue: (
    issue: Readonly<{
      readonly code: "custom";
      readonly message: string;
      readonly path: (string | number)[];
    }>,
  ) => void;
}

export function rowIssue(
  ctx: Readonly<ProgressIssueContext>,
  message: string,
  path: ReadonlyArray<string | number>,
): void {
  ctx.addIssue({ code: "custom", message, path: [...path] });
}
