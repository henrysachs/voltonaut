import { SessionResponseSchema } from "@voltonaut/shared";

const CachedSessionSchema = SessionResponseSchema.pick({ sessionToken: true });

export interface SessionPersistence {
  readonly load: () => string | undefined;
  readonly save: (sessionToken: string) => boolean;
  readonly clear: () => boolean;
}

interface SessionStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
}

export function sessionPersistence(
  origin: string,
  storage: () => SessionStorage,
): SessionPersistence {
  const key = `voltonaut.application-session:${origin}`;

  return {
    load(): string | undefined {
      let token: string | undefined;

      try {
        const raw: unknown = JSON.parse(storage().getItem(key) ?? "null");
        const parsed = CachedSessionSchema.safeParse(raw);

        token = parsed.success ? parsed.data.sessionToken : undefined;
      } catch {
        return token;
      }

      return token;
    },
    save(sessionToken) {
      try {
        storage().setItem(key, JSON.stringify({ sessionToken }));

        return true;
      } catch {
        return false;
      }
    },
    clear() {
      try {
        storage().removeItem(key);

        return true;
      } catch {
        return false;
      }
    },
  };
}
