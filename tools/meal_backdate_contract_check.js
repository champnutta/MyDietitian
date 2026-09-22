#!/usr/bin/env node

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

async function main() {
  const {
    parseMealBackdateCommand,
    findRejectedBackdate,
    isBareBackdateCommand,
    validateLoggedAtDayKey,
    shiftBangkokDayKey,
    formatBangkokIsoDayKey,
    bangkokLoggedAtForDayKey,
    MAX_BACKDATE_DAYS
  } = await import("../services/backend/lib/meal-backdate.js");

  // Fixed "now" = Monday 21 Sep 2026 15:30 Bangkok (08:30 UTC).
  const now = new Date("2026-09-21T08:30:00.000Z");
  const todayKey = formatBangkokIsoDayKey(now);
  assert.equal(todayKey, "2026-09-21", `expected today key, got ${todayKey}`);

  const cases = [
    {
      name: "yesterday meal",
      text: "เมื่อวาน กินข้าวกะเพรา",
      expect: { dayKey: "2026-09-20", mealText: "ข้าวกะเพรา", daysAgo: 1 }
    },
    {
      name: "yesterday night meal",
      text: "เมื่อคืนกินส้มตำ",
      expect: { dayKey: "2026-09-20", mealText: "ส้มตำ", daysAgo: 1 }
    },
    {
      name: "day before yesterday",
      text: "เมื่อวานซืน ข้าวมันไก่",
      expect: { dayKey: "2026-09-19", mealText: "ข้าวมันไก่", daysAgo: 2 }
    },
    {
      name: "iso date",
      text: "2026-09-18 ผัดไทย",
      expect: { dayKey: "2026-09-18", mealText: "ผัดไทย", daysAgo: 3 }
    },
    {
      name: "slash date",
      text: "19/9/2026 กินส้มตำ",
      expect: { dayKey: "2026-09-19", mealText: "ส้มตำ", daysAgo: 2 }
    },
    {
      name: "thai month",
      text: "19 ก.ย. กินข้าวต้ม",
      expect: { dayKey: "2026-09-19", mealText: "ข้าวต้ม", daysAgo: 2 }
    },
    {
      name: "day-only recent",
      text: "วันที่ 20 กินไข่ต้ม",
      expect: { dayKey: "2026-09-20", mealText: "ไข่ต้ม", daysAgo: 1 }
    },
    {
      name: "bare yesterday command",
      text: "บันทึกเมื่อวาน",
      expect: { dayKey: "2026-09-20", mealText: "", daysAgo: 1 }
    },
    {
      name: "bare backdate command",
      text: "บันทึกย้อนหลัง",
      expect: { dayKey: "2026-09-20", mealText: "", daysAgo: 1 }
    },
    {
      name: "coach question is not a backdated meal",
      text: "เมื่อวานกินอะไรดี",
      expect: null
    },
    {
      name: "plain meal has no backdate",
      text: "ข้าวมันไก่ 1 จาน",
      expect: null
    },
    {
      name: "future date rejected by parse",
      text: "2026-09-22 กินข้าว",
      expect: null
    },
    {
      name: "too old rejected by parse",
      text: "2026-08-01 กินข้าว",
      expect: null
    },
    {
      name: "day/month with วันที่ cue",
      text: "วันที่ 19/9 ข้าวต้ม",
      expect: { dayKey: "2026-09-19", mealText: "ข้าวต้ม", daysAgo: 2 }
    },
    {
      name: "buddhist-era year (full)",
      text: "19 ก.ย. 2569 ข้าวมันไก่",
      expect: { dayKey: "2026-09-19", mealText: "ข้าวมันไก่", daysAgo: 2 }
    },
    {
      name: "buddhist-era year (2-digit)",
      text: "19/9/69 ข้าวมันไก่",
      expect: { dayKey: "2026-09-19", mealText: "ข้าวมันไก่", daysAgo: 2 }
    },
    {
      name: "remark about the day is not a meal",
      text: "เมื่อวานกินเยอะไปหน่อย",
      expect: null
    },
    // Portions must never read as dates, even when d/m lands inside the window.
    {
      name: "portion 1/2 in early February",
      text: "1/2 จาน ข้าวผัดกุ้ง",
      now: new Date("2026-02-10T05:00:00.000Z"),
      expect: null
    },
    {
      name: "portion range 2-3 in early March",
      text: "2-3 ชิ้น ไก่ทอด",
      now: new Date("2026-03-10T05:00:00.000Z"),
      expect: null
    },
    {
      name: "portion 3/4 in early April",
      text: "3/4 ถ้วย ข้าวสวย",
      now: new Date("2026-04-10T05:00:00.000Z"),
      expect: null
    }
  ];

  const results = cases.map((item) => {
    const actual = parseMealBackdateCommand(item.text, item.now ?? now);
    let ok = false;
    if (item.expect === null) {
      ok = actual === null;
    } else {
      ok = Boolean(
        actual &&
        actual.dayKey === item.expect.dayKey &&
        actual.mealText === item.expect.mealText &&
        actual.daysAgo === item.expect.daysAgo
      );
    }
    return { name: item.name, text: item.text, ok, expected: item.expect, actual };
  });

  const validationCases = [
    { dayKey: "2026-09-21", ok: true, isBackdated: false },
    { dayKey: "2026-09-20", ok: true, isBackdated: true },
    { dayKey: "2026-09-07", ok: true, isBackdated: true },
    { dayKey: "2026-09-06", ok: false }, // 15 days ago
    { dayKey: "2026-09-22", ok: false },
    { dayKey: "not-a-date", ok: false }
  ].map((item) => {
    const actual = validateLoggedAtDayKey(item.dayKey, now);
    const ok = item.ok
      ? actual.ok === true && actual.isBackdated === item.isBackdated
      : actual.ok === false;
    return { name: `validate ${item.dayKey}`, ok, expected: item, actual };
  });

  const rejectionCases = [
    { text: "2026-08-01 กินข้าว", expect: "day-too-old" },
    { text: "2026-09-22 กินข้าว", expect: "future-day-not-allowed" },
    { text: "1 ส.ค. ข้าวผัด", expect: "day-too-old" },
    { text: "วันที่ 31 ข้าวต้ม", expect: "day-too-old" }, // Sep 31 invalid → Aug 31
    { text: "2026-09-19 ไข่ต้ม", expect: null }, // in range → normal parse
    { text: "เมื่อวาน ข้าวมันไก่", expect: null },
    { text: "1/2 จาน ข้าวผัดกุ้ง", expect: null },
    { text: "ข้าวมันไก่", expect: null }
  ].map((item) => {
    const actual = findRejectedBackdate(item.text, now);
    const ok = item.expect === null ? actual === null : actual?.error === item.expect;
    return { name: `rejected: ${item.text}`, ok, expected: item.expect, actual };
  });

  const bare = isBareBackdateCommand("มื้อเก่า", now);
  const bareOk = Boolean(bare && bare.dayKey === "2026-09-20" && bare.mealText === "");

  const loggedAt = bangkokLoggedAtForDayKey("2026-09-19", now);
  const loggedKey = formatBangkokIsoDayKey(loggedAt);
  const timeOk = loggedKey === "2026-09-19" &&
    loggedAt.getUTCHours() === 8 &&
    loggedAt.getUTCMinutes() === 30;

  const shiftOk = shiftBangkokDayKey("2026-09-21", -MAX_BACKDATE_DAYS) === "2026-09-07";

  const all = [
    ...results,
    ...validationCases,
    ...rejectionCases,
    { name: "bare มื้อเก่า", ok: bareOk, expected: true, actual: bare },
    { name: "bangkokLoggedAt preserves clock", ok: timeOk, expected: "2026-09-19 08:30Z", actual: loggedAt.toISOString() },
    { name: "shift max backdate window", ok: shiftOk, expected: "2026-09-07", actual: shiftBangkokDayKey("2026-09-21", -MAX_BACKDATE_DAYS) }
  ];
  const failed = all.filter((item) => !item.ok);
  const report = {
    ok: failed.length === 0,
    generatedAt: new Date().toISOString(),
    summary: { total: all.length, passed: all.length - failed.length, failed: failed.length },
    results: all
  };
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exit(1);
}

const assert = {
  equal(actual, expected, message) {
    if (actual !== expected) throw new Error(message || `expected ${expected}, got ${actual}`);
  }
};
