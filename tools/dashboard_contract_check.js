#!/usr/bin/env node

const args = parseArgs(process.argv.slice(2));

const endpoint = args.endpoint || "https://asia-southeast1-mydietitian.cloudfunctions.net/getDashboardData";
const userId = args.user || "test-readiness-audit";
const option = args.option ? Number(args.option) : 7;

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://mydietitian.web.app" },
    body: JSON.stringify({ userId, option })
  });
  const json = await response.json();
  const checks = validateDashboardContract(json, option);
  const failed = checks.filter((check) => !check.ok);
  const report = {
    ok: response.ok && failed.length === 0,
    status: response.status,
    endpoint,
    userId,
    option,
    canonicalUserId: json?.canonicalUserId || null,
    labels: Array.isArray(json?.labels) ? json.labels.length : 0,
    checks
  };

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

function validateDashboardContract(data, expectedDays) {
  const labels = Array.isArray(data?.labels) ? data.labels : [];
  const expectedLength = Number.isFinite(expectedDays) && expectedDays > 0 ? expectedDays : labels.length;
  const checks = [
    check("ok flag", data?.ok === true),
    check("canonical user id", typeof data?.canonicalUserId === "string" && data.canonicalUserId.length > 0),
    check("range", isIsoDate(data?.range?.start) && isIsoDate(data?.range?.end) && data?.range?.timezone === "Asia/Bangkok"),
    check("profile target", isFiniteNumber(data?.profile?.target?.cal) && isFiniteNumber(data?.profile?.target?.p)),
    check("current object", data?.current && typeof data.current === "object"),
    check("labels length", labels.length === expectedLength),
    check("calories length", sameLength(data?.calories, labels)),
    check("tdeeLine length", sameLength(data?.tdeeLine, labels)),
    check("macro p length", sameLength(data?.macros?.p, labels)),
    check("macro c length", sameLength(data?.macros?.c, labels)),
    check("macro f length", sameLength(data?.macros?.f, labels)),
    check("macro fiber length", sameLength(data?.macros?.fib, labels)),
    check("body weight length", sameLength(data?.bodyData?.weight, labels)),
    check("body fat length", sameLength(data?.bodyData?.fat, labels)),
    check("body muscle length", sameLength(data?.bodyData?.muscle, labels)),
    check("body devices length", sameLength(data?.bodyData?.devices, labels)),
    check("stats", isFiniteNumber(data?.stats?.avgCal) && isFiniteNumber(data?.stats?.totalDays) && isFiniteNumber(data?.stats?.successDays)),
    check("daily length", sameLength(data?.daily, labels)),
    check("daily shape", Array.isArray(data?.daily) && data.daily.every(isDailyRow)),
    check("history meals array", Array.isArray(data?.history?.meals)),
    check("history exercises array", Array.isArray(data?.history?.exercises)),
    check("history weights array", Array.isArray(data?.history?.weights)),
    check("history adjustments array", Array.isArray(data?.history?.adjustments))
  ];

  return checks;
}

function check(name, ok) {
  return { name, ok: Boolean(ok) };
}

function sameLength(value, labels) {
  return Array.isArray(value) && value.length === labels.length;
}

function isDailyRow(row) {
  return row &&
    typeof row.date === "string" &&
    isFiniteNumber(row.calories) &&
    isFiniteNumber(row.proteinG) &&
    isFiniteNumber(row.carbsG) &&
    isFiniteNumber(row.fatG) &&
    isFiniteNumber(row.fiberG) &&
    isFiniteNumber(row.burnedCalories) &&
    isFiniteNumber(row.dynamicTargetCalories) &&
    isFiniteNumber(row.remainingCalories);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = value;
        index += 1;
      }
    }
  }
  return out;
}
