import { OidcExchangeRequestSchema, OidcFinishErrorSchema } from "@voltonaut/shared";
import type { OidcFinishError } from "@voltonaut/shared";

export type AuthHandoff =
  | { readonly kind: "none" }
  | { readonly kind: "invalid" }
  | { readonly kind: "code"; readonly code: string }
  | { readonly kind: "error"; readonly error: OidcFinishError };

export function handoffErrorText(error: OidcFinishError): string {
  return error === "email_not_verified"
    ? "Anmeldung abgelehnt: Der Anbieter hat die E-Mail-Adresse nicht bestätigt. Adresse dort bestätigen und erneut anmelden."
    : "Anmeldung abgelehnt: Zu dieser E-Mail-Adresse gibt es bereits ein Voltonaut-Konto mit anderer Anmeldung. Automatisch verknüpft wird nicht.";
}

export function takeAuthHandoff(href: string, replace: (path: string) => void): AuthHandoff {
  const url = new URL(href);

  if (url.pathname !== "/auth/finish") return { kind: "none" };
  replace("/");
  const errors = url.searchParams.getAll("error");
  const failure = OidcFinishErrorSchema.safeParse(errors.length === 1 ? errors[0] : undefined);

  if (failure.success && !url.searchParams.has("code"))
    return { kind: "error", error: failure.data };
  const codes = url.searchParams.getAll("code");

  const parsed = OidcExchangeRequestSchema.safeParse({
    code: codes.length === 1 ? codes[0] : undefined,
  });

  return parsed.success ? { kind: "code", code: parsed.data.code } : { kind: "invalid" };
}
