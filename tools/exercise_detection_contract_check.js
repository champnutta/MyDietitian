const assert = require("node:assert/strict");
const { isDeleteExerciseCommand, looksLikeExerciseLog } = require("../services/backend/lib/exercise-detection.js");

const exerciseLogs = [
  "ออกกำลังกาย 30 นาที",
  "บันทึกออกกำลังกาย เดินเร็ว 45 นาที",
  "เล่นแบดมินตัน 1 ชั่วโมง",
  "ปั่นจักรยาน 12 กม.",
  "เวท 4 เซต",
  "burn 300 kcal",
  "เพิ่งออกกำลังกายเสร็จแล้ว"
];

const nonExerciseLogs = [
  "ออกกำลังกาย",
  "วันนี้ควรออกกำลังกายไหม",
  "แนะนำออกกำลังกาย 30 นาที",
  "ออกกำลังกายกี่นาทีดี?",
  "ข้าวมันไก่ 1 จาน"
];

for (const text of exerciseLogs) {
  assert.equal(looksLikeExerciseLog(text), true, `expected exercise log: ${text}`);
}

for (const text of nonExerciseLogs) {
  assert.equal(looksLikeExerciseLog(text), false, `expected non-exercise text: ${text}`);
}

for (const text of ["ลบออกกำลังกาย", "ลบการออกกำลังกาย", "ลบกิจกรรม", "undo exercise", "delete exercise"]) {
  assert.equal(isDeleteExerciseCommand(text), true, `expected exercise delete command: ${text}`);
}

for (const text of ["ลบ", "ยกเลิก", "undo", "ลบอาหาร"] ) {
  assert.equal(isDeleteExerciseCommand(text), false, `expected non-exercise delete command: ${text}`);
}

console.log(`Exercise detection contract passed (${exerciseLogs.length + nonExerciseLogs.length + 9} cases).`);
