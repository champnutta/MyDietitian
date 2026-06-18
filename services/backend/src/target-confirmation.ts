export type ConfirmedNutritionTarget = {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
};

export function parseConfirmUpdateTargetCommand(text: string): ConfirmedNutritionTarget | null {
  const parts = text.trim().split(/\s+/);
  if (!/^CONFIRM_UPDATE_TARGET$/i.test(parts[0] || "")) return null;

  const calories = Number(parts[1]);
  const macros = parts[2]?.split("-").map((part) => Number(part)) ?? [];
  if (
    !Number.isFinite(calories) ||
    calories < 800 ||
    calories > 6000 ||
    macros.length !== 3 ||
    macros.some((value) => !Number.isFinite(value) || value <= 0)
  ) {
    return null;
  }

  const [proteinG, carbsG, fatG] = macros;
  return {
    calories: Math.round(calories),
    proteinG: Math.round(proteinG),
    carbsG: Math.round(carbsG),
    fatG: Math.round(fatG),
    fiberG: 25
  };
}
