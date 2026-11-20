import { DEFAULT_RIDER_PROFILE, ProfileInputSchema, type RiderProfile } from "@voltonaut/shared";

import { openProfileDatabase } from "./sync/profile-database.js";
import {
  createProfileStore,
  PROFILE_SCHEMA_VERSION,
  type ProfileStore,
  type ProfileWriteLease,
} from "./sync/profile-store.js";
import {
  fillProfileForm,
  parseProfileForm,
  readProfileForm,
  type FormInput,
  type ProfileFormInputs,
} from "./ui/profile/profileScreen.js";

function input(selector: string): FormInput | undefined {
  const element = document.querySelector(selector);

  return element instanceof HTMLInputElement || element instanceof HTMLSelectElement
    ? element
    : undefined;
}

function profileInputs(): ProfileFormInputs | undefined {
  const displayName = input("#profile-displayName");
  const massKg = input("#profile-massKg");
  const heightCm = input("#profile-heightCm");
  const bikeMassKg = input("#profile-bikeMassKg");
  const chainringTeeth = input("#profile-chainringTeeth");
  const cogTeeth = input("#profile-cogTeeth");
  const wheelCircM = input("#profile-wheelCircM");
  const units = input("#profile-units");

  if (
    displayName === undefined ||
    massKg === undefined ||
    heightCm === undefined ||
    bikeMassKg === undefined ||
    chainringTeeth === undefined ||
    cogTeeth === undefined ||
    wheelCircM === undefined ||
    units === undefined
  )
    return undefined;

  return { displayName, massKg, heightCm, bikeMassKg, chainringTeeth, cogTeeth, wheelCircM, units };
}

function text(selector: string, value: string): void {
  const element = document.querySelector(selector);

  if (element !== null) element.textContent = value;
}

function mountProfile(store: ProfileStore, profile: RiderProfile): void {
  const inputs = profileInputs();

  if (inputs === undefined) return;
  fillProfileForm(inputs, profile);
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- DOM delivers a native mutable SubmitEvent; this adapter prevents submission.
  document.querySelector("#profile-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const result = parseProfileForm(readProfileForm(inputs));

    if (!result.ok) {
      text("#profile-error", "Profile rejected: values out of range.");
      text("#profile-status", "Not saved");

      return;
    }

    void saveProfile(store, result.profile);
  });
}

async function saveProfile(store: ProfileStore, profile: RiderProfile): Promise<void> {
  try {
    await store.save(profile);
    text("#profile-error", "");
    text("#profile-status", "Saved locally");
  } catch {
    text("#profile-status", "Save failed");
  }
}

export interface ProfileBootstrap {
  readonly initialProfile: Readonly<Omit<RiderProfile, "bike">> & {
    readonly bike: Readonly<RiderProfile["bike"]>;
  };
  readonly saved: () => Promise<RiderProfile | undefined>;
  readonly apply: (
    profile: Readonly<Omit<RiderProfile, "bike">> & {
      readonly bike: Readonly<RiderProfile["bike"]>;
    },
    lease: ProfileWriteLease,
  ) => Promise<void>;
}

export async function setupProfile(): Promise<ProfileBootstrap> {
  const database = Promise.resolve().then(() => openProfileDatabase(indexedDB));

  const store: ProfileStore = {
    load: async () => (await database).loadRecord().then((record) => record?.profile),
    save: async (profile) => createProfileStore(await database).save(profile),
  };

  let profile = DEFAULT_RIDER_PROFILE;

  try {
    profile = (await store.load()) ?? DEFAULT_RIDER_PROFILE;
  } catch {
    text("#profile-status", "Local storage unavailable. Default profile; changes cannot be saved.");
  }

  mountProfile(store, profile);

  return {
    initialProfile: profile,
    saved: store.load,
    async apply(next, lease) {
      const validated = ProfileInputSchema.parse(next);

      await (
        await database
      ).saveRecord({ schemaVersion: PROFILE_SCHEMA_VERSION, profile: validated }, lease);

      if (!lease.current()) return;
      const inputs = profileInputs();

      if (inputs !== undefined) fillProfileForm(inputs, validated);
      text("#profile-error", "");
      text("#profile-status", "Serverprofil lokal gespeichert. Gilt erst für die nächste Fahrt.");
    },
  };
}
