/**
 * Parse natural-language backdated meal commands and validate calendar day
 * keys (Asia/Bangkok). Used by the LINE webhook and analyzeMeal HTTP API.
 */

export const MAX_BACKDATE_DAYS = 14;

export type MealBackdateParse = {
  dayKey: string;
  mealText: string;
  label: string;
  daysAgo: number;
};

export type DayKeyValidation =
  | { ok: true; dayKey: string; isBackdated: boolean; daysAgo: number }
  | { ok: false; error: string };

const THAI_MONTHS: Array<{ pattern: RegExp; month: number }> = [
  { pattern: /(?:มกราคม|ม\.?\s*ค\.?|มค)/i, month: 1 },
  { pattern: /(?:กุมภาพันธ์|ก\.?\s*พ\.?|กพ)/i, month: 2 },
  { pattern: /(?:มีนาคม|มี\.?\s*ค\.?|มีค)/i, month: 3 },
  { pattern: /(?:เมษายน|เม\.?\s*ย\.?|เมย)/i, month: 4 },
  { pattern: /(?:พฤษภาคม|พ\.?\s*ค\.?|พค)/i, month: 5 },
  { pattern: /(?:มิถุนายน|มิ\.?\s*ย\.?|มิย)/i, month: 6 },
  { pattern: /(?:กรกฎาคม|ก\.?\s*ค\.?|กค)/i, month: 7 },
  { pattern: /(?:สิงหาคม|ส\.?\s*ค\.?|สค)/i, month: 8 },
  { pattern: /(?:กันยายน|ก\.?\s*ย\.?|กย)/i, month: 9 },
  { pattern: /(?:ตุลาคม|ต\.?\s*ค\.?|ตค)/i, month: 10 },
  { pattern: /(?:พฤศจิกายน|พ\.?\s*ย\.?|พย)/i, month: 11 },
  { pattern: /(?:ธันวาคม|ธ\.?\s*ค\.?|ธค)/i, month: 12 }
];

const BARE_BACKDATE_COMMANDS: Array<{ pattern: RegExp; daysAgo: number | null }> = [
  { pattern: /^บันทึกเมื่อวาน$/i, daysAgo: 1 },
  { pattern: /^เมื่อวาน$/i, daysAgo: 1 },
  { pattern: /^บันทึกย้อนหลัง$/i, daysAgo: 1 },
  { pattern: /^มื้อเก่า$/i, daysAgo: 1 },
  { pattern: /^บันทึกมื้อเก่า$/i, daysAgo: 1 }
];

export function formatBangkokIsoDayKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

export function shiftBangkokDayKey(dayKey: string, deltaDays: number): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, -7, 0, 0, 0));
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return formatBangkokIsoDayKey(date);
}

export function isIsoDayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day, -7, 0, 0, 0));
  return formatBangkokIsoDayKey(probe) === value;
}

export function daysBetweenBangkokDayKeys(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKey.split("-").map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

export function validateLoggedAtDayKey(dayKey: string, now: Date = new Date()): DayKeyValidation {
  const trimmed = String(dayKey ?? "").trim();
  if (!isIsoDayKey(trimmed)) {
    return { ok: false, error: "invalid-day-key" };
  }
  const todayKey = formatBangkokIsoDayKey(now);
  const daysAgo = daysBetweenBangkokDayKeys(trimmed, todayKey);
  if (daysAgo < 0) {
    return { ok: false, error: "future-day-not-allowed" };
  }
  if (daysAgo > MAX_BACKDATE_DAYS) {
    return { ok: false, error: "day-too-old" };
  }
  return {
    ok: true,
    dayKey: trimmed,
    isBackdated: daysAgo > 0,
    daysAgo
  };
}

/** Map a Bangkok calendar day to a Timestamp using "now"s Bangkok clock time. */
export function bangkokLoggedAtForDayKey(dayKey: string, now: Date = new Date()): Date {
  if (!isIsoDayKey(dayKey)) {
    throw new Error("invalid-day-key");
  }
  const timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(now);
  let hour = Number(timeParts.find((part) => part.type === "hour")?.value ?? 12);
  // en-GB midnight can report as 24
  if (hour === 24) hour = 0;
  const minute = Number(timeParts.find((part) => part.type === "minute")?.value ?? 0);
  const second = Number(timeParts.find((part) => part.type === "second")?.value ?? 0);
  const ms = now.getMilliseconds();
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 7, minute, second, ms));
}

export function formatThaiShortDayLabel(dayKey: string): string {
  if (!isIsoDayKey(dayKey)) return dayKey;
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 5, 0, 0, 0));
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short"
  }).format(date);
}

export function isBareBackdateCommand(text: string, now: Date = new Date()): MealBackdateParse | null {
  const trimmed = text.trim();
  for (const command of BARE_BACKDATE_COMMANDS) {
    if (!command.pattern.test(trimmed)) continue;
    const daysAgo = command.daysAgo ?? 1;
    const dayKey = shiftBangkokDayKey(formatBangkokIsoDayKey(now), -daysAgo);
    return {
      dayKey,
      mealText: "",
      label: formatThaiShortDayLabel(dayKey),
      daysAgo
    };
  }
  return null;
}

/**
 * Detect a date prefix on a meal message and strip it from the food text.
 * Returns null when no backdate cue is present, or when the remaining text
 * is empty (caller should treat that as a bare command via isBareBackdateCommand).
 */
export function parseMealBackdateCommand(text: string, now: Date = new Date()): MealBackdateParse | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const bare = isBareBackdateCommand(trimmed, now);
  if (bare) return bare;

  const relative = matchRelativePrefix(trimmed, now);
  if (relative) return relative;

  const absolute = matchAbsolutePrefix(trimmed, now);
  if (absolute) return absolute;

  return null;
}

function matchRelativePrefix(text: string, now: Date): MealBackdateParse | null {
  const patterns: Array<{ regex: RegExp; daysAgo: number }> = [
    { regex: /^(?:เมื่อวานซืน|วันก่อน|day\s*before\s*yesterday)\s*[:\-–]?\s*/i, daysAgo: 2 },
    { regex: /^(?:เมื่อวานนี้|เมื่อวาน|เมื่อคืน|yesterday)\s*[:\-–]?\s*/i, daysAgo: 1 }
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    if (!match) continue;
    const mealText = cleanMealRemainder(text.slice(match[0].length));
    // Require leftover food text so empty "เมื่อวาน" stays a bare command, and
    // reject coach-like remainders ("เมื่อวานกินอะไรดี").
    if (!mealText || looksLikeNonMealRemainder(mealText)) return null;
    const dayKey = shiftBangkokDayKey(formatBangkokIsoDayKey(now), -pattern.daysAgo);
    return {
      dayKey,
      mealText,
      label: formatThaiShortDayLabel(dayKey),
      daysAgo: pattern.daysAgo
    };
  }
  return null;
}

function matchAbsolutePrefix(text: string, now: Date): MealBackdateParse | null {
  const todayKey = formatBangkokIsoDayKey(now);
  const todayParts = todayKey.split("-").map(Number);
  const todayYear = todayParts[0];
  const todayMonth = todayParts[1];

  // ISO: 2026-09-19 ...
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})\s*[:\-–]?\s*/);
  if (iso) {
    return finalizeAbsolute(iso[1], text.slice(iso[0].length), now);
  }

  // Numeric: 19/9/2026 or 19/9/26 or 19-9-2026
  const slash = text.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\s*[:\-–]?\s*/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    let year = slash[3] ? Number(slash[3]) : todayYear;
    if (year < 100) year += 2000;
    const dayKey = toDayKey(year, month, day);
    if (dayKey) return finalizeAbsolute(dayKey, text.slice(slash[0].length), now);
  }

  // Thai: วันที่ 19 ก.ย. 2026 / 19 ก.ย. / วันที่ 19 กันยายน
  for (const { pattern, month } of THAI_MONTHS) {
    const thai = text.match(
      new RegExp(`^(?:วันที่\\s*)?(\\d{1,2})\\s*${pattern.source}\\s*(\\d{2,4})?\\s*[:\\-–]?\\s*`, "i")
    );
    if (!thai) continue;
    const day = Number(thai[1]);
    let year = thai[2] ? Number(thai[2]) : todayYear;
    if (year < 100) year += 2000;
    const dayKey = toDayKey(year, month, day);
    if (dayKey) return finalizeAbsolute(dayKey, text.slice(thai[0].length), now);
  }

  // Day-only: วันที่ 19 / วันที่19
  const dayOnly = text.match(/^(?:วันที่)\s*(\d{1,2})\s*[:\-–]?\s*/);
  if (dayOnly) {
    const day = Number(dayOnly[1]);
    const dayKey = resolveRecentDayOfMonth(day, todayYear, todayMonth, todayKey);
    if (dayKey) return finalizeAbsolute(dayKey, text.slice(dayOnly[0].length), now);
  }

  return null;
}

function finalizeAbsolute(dayKey: string, remainder: string, now: Date): MealBackdateParse | null {
  const validation = validateLoggedAtDayKey(dayKey, now);
  if (!validation.ok) return null;
  const mealText = cleanMealRemainder(remainder);
  if (mealText && looksLikeNonMealRemainder(mealText)) return null;
  if (!mealText && validation.daysAgo === 0) return null;
  if (!mealText) {
    // Absolute date alone acts like a bare command for that day.
    return {
      dayKey: validation.dayKey,
      mealText: "",
      label: formatThaiShortDayLabel(validation.dayKey),
      daysAgo: validation.daysAgo
    };
  }
  return {
    dayKey: validation.dayKey,
    mealText,
    label: formatThaiShortDayLabel(validation.dayKey),
    daysAgo: validation.daysAgo
  };
}

function resolveRecentDayOfMonth(
  day: number,
  todayYear: number,
  todayMonth: number,
  todayKey: string
): string | null {
  // Prefer this month if that day is not in the future; else previous month.
  const candidates: string[] = [];
  const thisMonth = toDayKey(todayYear, todayMonth, day);
  if (thisMonth) candidates.push(thisMonth);
  const prevMonth = todayMonth === 1 ? 12 : todayMonth - 1;
  const prevYear = todayMonth === 1 ? todayYear - 1 : todayYear;
  const previous = toDayKey(prevYear, prevMonth, day);
  if (previous) candidates.push(previous);

  for (const candidate of candidates) {
    const daysAgo = daysBetweenBangkokDayKeys(candidate, todayKey);
    if (daysAgo >= 0 && daysAgo <= MAX_BACKDATE_DAYS) return candidate;
  }
  return null;
}

function toDayKey(year: number, month: number, day: number): string | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const key = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isIsoDayKey(key) ? key : null;
}

function cleanMealRemainder(text: string): string {
  return text
    .replace(/^(?:กิน|ทาน|ของ|เมนู|อาหาร)\s*/i, "")
    .replace(/^[:\-–]\s*/, "")
    .trim();
}

function looksLikeNonMealRemainder(text: string): boolean {
  return /อะไรดี|ดีไหม|ควร|แนะนำ|ไหม|มั้ย|\?|should i|what should/i.test(text);
}
