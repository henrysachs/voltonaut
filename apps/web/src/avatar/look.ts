import type { AvatarConfig } from "@voltonaut/shared";

export interface AvatarLook {
  readonly frameRadiusM: number;
  readonly rimColor: number;
  readonly rimRoughness: number;
  readonly shoeColor: number;
  readonly glassesVisible: boolean;
  readonly jerseyAccentRadiusM: number;
  readonly jerseyAccentRoughness: number;
}

export function avatarLook(config: Readonly<AvatarConfig>): AvatarLook {
  const frameRadiusM =
    config.bike.frameId === "frame.aero"
      ? 0.032
      : config.bike.frameId === "frame.gravel"
        ? 0.023
        : 0.025;

  const rimColor =
    config.bike.wheelsId === "wheels.alloy"
      ? 0xd3dadb
      : config.bike.wheelsId === "wheels.carbon-flat"
        ? 0x58666b
        : config.bike.wheelsId === "wheels.carbon-deep"
          ? 0x263238
          : 0x7d898d;

  return {
    frameRadiusM,
    rimColor,
    rimRoughness: config.bike.wheelsId === "wheels.alloy" ? 0.25 : 0.5,
    shoeColor: config.rider.shoesId === "shoes.white" ? 0xf5ebca : 0x18272e,
    glassesVisible: config.rider.glassesId !== "glasses.none",
    ...jerseyAccentLook(config.rider.jerseyId),
  };
}

function jerseyAccentLook(
  jerseyId: string,
): Pick<AvatarLook, "jerseyAccentRadiusM" | "jerseyAccentRoughness"> {
  switch (jerseyId) {
    case "jersey.stripe":
      return { jerseyAccentRadiusM: 0.158, jerseyAccentRoughness: 0.65 };
    case "jersey.tempo":
      return { jerseyAccentRadiusM: 0.148, jerseyAccentRoughness: 0.9 };
    case "jersey.kom":
      return { jerseyAccentRadiusM: 0.162, jerseyAccentRoughness: 0.55 };
    case "jersey.century":
      return { jerseyAccentRadiusM: 0.155, jerseyAccentRoughness: 0.8 };
    case "jersey.aurora":
      return { jerseyAccentRadiusM: 0.17, jerseyAccentRoughness: 0.45 };
    default:
      return { jerseyAccentRadiusM: 0.152, jerseyAccentRoughness: 0.85 };
  }
}
