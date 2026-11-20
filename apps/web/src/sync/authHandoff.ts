import { OidcExchangeRequestSchema } from "@voltonaut/shared";

export type AuthHandoff =
  | { readonly kind: "none" }
  | { readonly kind: "invalid" }
  | { readonly kind: "code"; readonly code: string };

export function takeAuthHandoff(href: string, replace: (path: string) => void): AuthHandoff {
  const url = new URL(href);

  if (url.pathname !== "/auth/finish") return { kind: "none" };
  replace("/");
  const codes = url.searchParams.getAll("code");

  const parsed = OidcExchangeRequestSchema.safeParse({
    code: codes.length === 1 ? codes[0] : undefined,
  });

  return parsed.success ? { kind: "code", code: parsed.data.code } : { kind: "invalid" };
}
