const assert = require("node:assert/strict");

const {
  normalizeSupportText,
  parseSupportReplyControl
} = require("../services/backend/lib/support-utils.js");

assert.equal(normalizeSupportText("  ขอความช่วยเหลือครับ  "), "ขอความช่วยเหลือครับ");
assert.equal(normalizeSupportText(" \r\n "), null);
assert.equal(normalizeSupportText("12345", 4), null);

assert.deepEqual(
  parseSupportReplyControl("ตอบแอดมิน AbC123_ticket"),
  { action: "start", ticketId: "AbC123_ticket" }
);
assert.deepEqual(parseSupportReplyControl("ยกเลิกตอบแอดมิน"), { action: "cancel" });
assert.equal(parseSupportReplyControl("ตอบแอดมิน"), null);
assert.equal(parseSupportReplyControl("ตอบแอดมิน bad/id"), null);
assert.equal(parseSupportReplyControl("ข้าวมันไก่"), null);

console.log("support ticket contract check passed");
