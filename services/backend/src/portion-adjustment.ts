export type PortionAdjustment = {
  ratio: number;
  label: string;
};

const THAI_NUMBER_WORDS: Record<string, number> = {
  "หนึ่ง": 1,
  "นึง": 1,
  "สอง": 2,
  "สาม": 3,
  "สี่": 4,
  "ห้า": 5,
  "หก": 6,
  "เจ็ด": 7,
  "แปด": 8,
  "เก้า": 9
};

const THAI_DENOMINATOR_WORDS: Record<string, number> = {
  "สอง": 2,
  "สาม": 3,
  "สี่": 4,
  "ห้า": 5,
  "หก": 6,
  "เจ็ด": 7,
  "แปด": 8,
  "เก้า": 9
};

export function parsePortionAdjustmentCommand(text: string): PortionAdjustment | null {
  const lower = text.toLowerCase().trim();
  const hasAdjustmentVerb = /กิน|เหลือ|แค่|เอา|ปรับ|ลด|ทาน|ate|left|only|half|third|quarter|portion/.test(lower);
  if (!hasAdjustmentVerb) return null;

  const slashFraction = lower.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (slashFraction) {
    return buildPortionAdjustment(
      ratioFromNumbers(slashFraction[1], slashFraction[2]),
      `${slashFraction[1]}/${slashFraction[2]}`
    );
  }

  const numericInFraction = lower.match(/(\d+(?:\.\d+)?)\s*(?:ใน|จาก|of)\s*(\d+(?:\.\d+)?)/);
  if (numericInFraction) {
    return buildPortionAdjustment(
      ratioFromNumbers(numericInFraction[1], numericInFraction[2]),
      `${numericInFraction[1]}/${numericInFraction[2]}`
    );
  }

  const explicitPercent = lower.match(/(\d+(?:\.\d+)?)\s*%/);
  if (explicitPercent) {
    return buildPortionAdjustment(Number(explicitPercent[1]) / 100, `${explicitPercent[1]}%`);
  }

  const thaiFraction = parseThaiFraction(lower);
  if (thaiFraction) return thaiFraction;

  if (/ครึ่ง|half/.test(lower)) return buildPortionAdjustment(0.5, "ครึ่งจาน");
  if (/นิดเดียว|นิดหน่อย|a little|small portion/.test(lower)) return buildPortionAdjustment(0.25, "นิดเดียว");
  if (/two\s*thirds?|2\s*thirds?/.test(lower)) return buildPortionAdjustment(2 / 3, "2/3");
  if (/third/.test(lower)) return buildPortionAdjustment(1 / 3, "1/3");
  if (/quarter/.test(lower)) return buildPortionAdjustment(0.25, "1/4");

  return null;
}

function parseThaiFraction(lowerText: string): PortionAdjustment | null {
  for (const [numeratorWord, numerator] of Object.entries(THAI_NUMBER_WORDS)) {
    for (const [denominatorWord, denominator] of Object.entries(THAI_DENOMINATOR_WORDS)) {
      const patterns = [
        new RegExp(`${numeratorWord}\\s*ส่วน\\s*${denominatorWord}`),
        new RegExp(`${numeratorWord}\\s*ใน\\s*${denominatorWord}`),
        new RegExp(`${numeratorWord}\\s*จาก\\s*${denominatorWord}`)
      ];
      if (patterns.some((pattern) => pattern.test(lowerText))) {
        return buildPortionAdjustment(numerator / denominator, `${numeratorWord}/${denominatorWord}`);
      }
    }
  }
  return null;
}

function ratioFromNumbers(numeratorValue: string, denominatorValue: string): number {
  const numerator = Number(numeratorValue);
  const denominator = Number(denominatorValue);
  return denominator > 0 ? numerator / denominator : 0;
}

function buildPortionAdjustment(ratio: number, rawLabel: string): PortionAdjustment | null {
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) return null;
  const normalizedRatio = Number(ratio.toFixed(4));
  const percent = Math.round(normalizedRatio * 100);
  return {
    ratio: normalizedRatio,
    label: `${percent}% (${rawLabel})`
  };
}
