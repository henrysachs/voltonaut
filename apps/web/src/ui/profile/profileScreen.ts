import { RiderProfileSchema, type RiderProfile } from "@voltonaut/shared";

/** Raw string state of the profile form fields. */
export interface ProfileFormFields {
  readonly displayName: string;
  readonly massKg: string;
  readonly heightCm: string;
  readonly bikeMassKg: string;
  readonly chainringTeeth: string;
  readonly cogTeeth: string;
  readonly wheelCircM: string;
  readonly units: string;
}

/** Minimal structural view of an input element; the DOM satisfies it. */
export interface FormInput {
  value: string;
}

/** Fully readonly view of the form used for reading values. */
export interface ProfileFormReadView {
  readonly displayName: { readonly value: string };
  readonly massKg: { readonly value: string };
  readonly heightCm: { readonly value: string };
  readonly bikeMassKg: { readonly value: string };
  readonly chainringTeeth: { readonly value: string };
  readonly cogTeeth: { readonly value: string };
  readonly wheelCircM: { readonly value: string };
  readonly units: { readonly value: string };
}

export interface ProfileFormInputs {
  readonly displayName: FormInput;
  readonly massKg: FormInput;
  readonly heightCm: FormInput;
  readonly bikeMassKg: FormInput;
  readonly chainringTeeth: FormInput;
  readonly cogTeeth: FormInput;
  readonly wheelCircM: FormInput;
  readonly units: FormInput;
}

export type ProfileFormResult =
  | { readonly ok: true; readonly profile: RiderProfile }
  | { readonly ok: false };

const NUMERIC_FIELDS = [
  "massKg",
  "heightCm",
  "bikeMassKg",
  "chainringTeeth",
  "cogTeeth",
  "wheelCircM",
] as const;

function parseNumber(value: string): number {
  return Number(value.trim());
}

/** Reads the raw form state from the DOM adapter. */
export function readProfileForm(inputs: ProfileFormReadView): ProfileFormFields {
  return {
    displayName: inputs.displayName.value,
    massKg: inputs.massKg.value,
    heightCm: inputs.heightCm.value,
    bikeMassKg: inputs.bikeMassKg.value,
    chainringTeeth: inputs.chainringTeeth.value,
    cogTeeth: inputs.cogTeeth.value,
    wheelCircM: inputs.wheelCircM.value,
    units: inputs.units.value,
  };
}

/** Writes a profile back into the form (used on load). */
export function fillProfileForm(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM input's .value member is the write target; input elements are mutable by contract.
  inputs: ProfileFormInputs,
  profile: RiderProfile,
): void {
  inputs.displayName.value = profile.displayName;
  inputs.massKg.value = String(profile.massKg);
  inputs.heightCm.value = String(profile.heightCm);
  inputs.bikeMassKg.value = String(profile.bike.massKg);
  inputs.chainringTeeth.value = String(profile.bike.chainringTeeth);
  inputs.cogTeeth.value = String(profile.bike.cogTeeth);
  inputs.wheelCircM.value = String(profile.bike.wheelCircM);
  inputs.units.value = profile.units;
}

/**
 * Validates the form fields through the shared Zod schema (docs/03 section 2a
 * ranges: mass 30-200 kg, height 120-220 cm, chainring 28-60 teeth,
 * wheel circumference 1.9-2.4 m). Invalid input is rejected, never saved.
 */
export function parseProfileForm(fields: ProfileFormFields): ProfileFormResult {
  if (fields.units !== "metric" && fields.units !== "imperial") {
    return { ok: false };
  }

  for (const field of NUMERIC_FIELDS) {
    const value = parseNumber(fields[field]);

    if (!Number.isFinite(value)) {
      return { ok: false };
    }
  }

  const candidate = {
    displayName: fields.displayName.trim(),
    massKg: parseNumber(fields.massKg),
    heightCm: parseNumber(fields.heightCm),
    bike: {
      massKg: parseNumber(fields.bikeMassKg),
      chainringTeeth: parseNumber(fields.chainringTeeth),
      cogTeeth: parseNumber(fields.cogTeeth),
      wheelCircM: parseNumber(fields.wheelCircM),
    },
    gearPreset: "zwift-like-24" as const,
    units: fields.units,
  };

  const parsed = RiderProfileSchema.safeParse(candidate);

  return parsed.success ? { ok: true, profile: parsed.data } : { ok: false };
}
