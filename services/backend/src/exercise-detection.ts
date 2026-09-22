const EXERCISE_KEYWORDS =
  /ออกกำลังกาย|เผาผลาญ|เบิร์น|วิ่ง|จ็อกกิ้ง|เดิน|เดินชัน|เวท|ยกน้ำหนัก|ปั่น|จักรยาน|ว่ายน้ำ|โยคะ|พิลาทิส|แอโรบิก|เต้น|กระโดดเชือก|แบดมินตัน|ตีแบด|ฟุตบอล|ฟุตซอล|บาสเกตบอล|เทนนิส|มวย|ปีนเขา|พายเรือ|กีฬา|hiit|cardio|run|running|jog|jogging|walk|walking|bike|cycling|swim|weight|workout|exercise|aerobic|dance|badminton|football|soccer|futsal|basketball|tennis|boxing|hiking|rowing|sport|burn/i;

const EXERCISE_MEASURE =
  /\d+(?:\.\d+)?\s*(?:นาที|ชม\.?|ชั่วโมง|วินาที|กม\.?|กิโลเมตร|กิโล|เมตร|รอบ|เซต|ครั้ง|ก้าว|แคล(?:อรี่)?|กิโลแคลอรี่|hr|hrs|hour|hours|min|mins|minute|minutes|sec|secs|second|seconds|km|kilometers?|m|meters?|sets?|reps?|steps?|kcal|calories?)(?:\b|\s|$)/i;

const COMPLETED_EXERCISE =
  /บันทึก|ทำแล้ว|เล่นแล้ว|ซ้อมแล้ว|เสร็จแล้ว|เพิ่ง.*(?:ทำ|เล่น|ซ้อม|ออกกำลังกาย)|(?:ทำ|เล่น|ซ้อม|ออกกำลังกาย).*มา(?:แล้ว)?|logged|completed|finished|did|burned/i;

const EXERCISE_QUESTION =
  /ดีไหม|อะไรดี|แนะนำ|ควร|ไหม|มั้ย|ได้ไหม|ได้มั้ย|หรือยัง|กี่(?:นาที|ชั่วโมง|ครั้ง)|เท่าไหร่|อย่างไร|ยังไง|ทำไง|\?|should|recommend|how (?:much|long|often)/i;

/**
 * Distinguishes a completed exercise log from food text and exercise advice.
 * Keep this deterministic because unmatched LINE text is treated as a meal.
 */
export function looksLikeExerciseLog(text: string): boolean {
  const normalized = text.trim();
  if (!normalized || normalized === "ออกกำลังกาย") return false;

  return EXERCISE_KEYWORDS.test(normalized) &&
    (EXERCISE_MEASURE.test(normalized) || COMPLETED_EXERCISE.test(normalized)) &&
    !EXERCISE_QUESTION.test(normalized);
}

export function isDeleteExerciseCommand(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized === "ลบออกกำลังกาย" ||
    normalized === "ลบการออกกำลังกาย" ||
    normalized === "ลบกิจกรรม" ||
    normalized === "undo exercise" ||
    normalized === "delete exercise";
}
