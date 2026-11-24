import { OidcExchangeRequestSchema, OidcFinishErrorSchema } from "@voltonaut/shared";
import type { OidcFinishError } from "@voltonaut/shared";

export type AuthHandoff =
  | { readonly kind: "none" }
  | { readonly kind: "invalid" }
  | { readonly kind: "code"; readonly code: string }
  /** One-time code of an explicit account link; the signed-in session must complete it. */
  | { readonly kind: "link"; readonly code: string }
  | { readonly kind: "error"; readonly error: OidcFinishError };

const HANDOFF_ERROR_TEXT = {
  email_not_verified:
    "Anmeldung abgelehnt: Der Anbieter hat die E-Mail-Adresse nicht bestätigt. Adresse dort bestätigen und erneut anmelden.",
  identity_conflict:
    "Anmeldung abgelehnt: Zu dieser E-Mail-Adresse gibt es bereits ein Voltonaut-Konto mit anderer Anmeldung. Automatisch verknüpft wird nicht.",
} as const satisfies Readonly<Record<OidcFinishError, string>>;

export function handoffErrorText(error: OidcFinishError): string {
  return HANDOFF_ERROR_TEXT[error];
}

export function takeAuthHandoff(href: string, replace: (path: string) => void): AuthHandoff {
  const url = new URL(href);

  if (url.pathname !== "/auth/finish") return { kind: "none" };
  replace("/");
  const errors = url.searchParams.getAll("error");
  const failure = OidcFinishErrorSchema.safeParse(errors.length === 1 ? errors[0] : undefined);

  if (failure.success && !url.searchParams.has("code"))
    return { kind: "error", error: failure.data };
  const links = url.searchParams.getAll("link");

  if (links.length > 0 && !url.searchParams.has("code")) {
    const link = OidcExchangeRequestSchema.safeParse({
      code: links.length === 1 ? links[0] : undefined,
    });

    return link.success ? { kind: "link", code: link.data.code } : { kind: "invalid" };
  }

  const codes = url.searchParams.getAll("code");

  const parsed = OidcExchangeRequestSchema.safeParse({
    code: codes.length === 1 ? codes[0] : undefined,
  });

  return parsed.success ? { kind: "code", code: parsed.data.code } : { kind: "invalid" };
}
