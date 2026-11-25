import { HealthResponseSchema, MeResponseSchema } from "@voltonaut/shared";

const text = HealthResponseSchema.shape.version;

export const AccountDataOwnerSchema = HealthResponseSchema.pick({})
  .extend({
    apiOrigin: text.max(512).regex(/^https?:\/\/[^\s/?#@]+$/iu),
    userId: MeResponseSchema.shape.user.shape.id,
  })
  .strict();

export type AccountDataOwner = (typeof AccountDataOwnerSchema)["_output"];

const STORAGE_PREFIX = "voltonaut.account-deletion-cleanup:";

export type DeletionOwner = Readonly<AccountDataOwner>;

export interface DeletionStorage {
  readonly length: number;
  readonly key: (index: number) => string | null;
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
}

export interface DeletionIntents {
  readonly load: () => readonly DeletionOwner[];
  readonly remember: (owner: DeletionOwner) => boolean;
  readonly forget: (owner: DeletionOwner) => boolean;
}

export function deletionOwnerKey(owner: DeletionOwner): string {
  return JSON.stringify([owner.apiOrigin, owner.userId]);
}

function intentKey(owner: DeletionOwner): string {
  return `${STORAGE_PREFIX}${deletionOwnerKey(owner)}`;
}

function loadIntents(target: DeletionStorage): readonly DeletionOwner[] {
  const pending: DeletionOwner[] = [];

  for (let index = 0; index < target.length; index += 1) {
    const key = target.key(index);

    if (key === null || !key.startsWith(STORAGE_PREFIX)) continue;

    try {
      const raw = target.getItem(key);

      if (raw === null) continue;
      const parsed = AccountDataOwnerSchema.safeParse(JSON.parse(raw));

      if (parsed.success) pending.push(parsed.data);
    } catch {
      continue;
    }
  }

  return pending;
}

export function accountDeletionIntents(storage: () => DeletionStorage): DeletionIntents {
  return {
    load() {
      try {
        return loadIntents(storage());
      } catch {
        return [];
      }
    },
    remember(owner) {
      try {
        const parsed = AccountDataOwnerSchema.parse(owner);
        storage().setItem(intentKey(parsed), JSON.stringify(parsed));

        return true;
      } catch {
        return false;
      }
    },
    forget(owner) {
      try {
        const parsed = AccountDataOwnerSchema.parse(owner);
        storage().removeItem(intentKey(parsed));

        return true;
      } catch {
        return false;
      }
    },
  };
}
