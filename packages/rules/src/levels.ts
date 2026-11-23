import { LevelSchema, TotalXpSchema, type Level, type TotalXp } from "@voltonaut/shared";

export function xpForLevel(level: Level): TotalXp {
  const parsedLevel = LevelSchema.parse(level);

  return TotalXpSchema.parse(parsedLevel === 1 ? 0 : Math.round(500 * parsedLevel ** 1.6));
}

export function levelForXp(xp: TotalXp): Level {
  const parsedXp = TotalXpSchema.parse(xp);

  for (let level = 50; level >= 2; level -= 1) {
    const candidate = LevelSchema.parse(level);

    if (parsedXp >= xpForLevel(candidate)) return candidate;
  }

  return LevelSchema.parse(1);
}
