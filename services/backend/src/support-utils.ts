export type SupportReplyControl =
  | { action: "start"; ticketId: string }
  | { action: "cancel" };

export function normalizeSupportText(value: unknown, maxLength = 2000): string | null {
  const text = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text || text.length > maxLength) return null;
  return text;
}

export function parseSupportReplyControl(value: unknown): SupportReplyControl | null {
  const text = String(value ?? "").trim();
  if (text === "ยกเลิกตอบแอดมิน") return { action: "cancel" };
  const match = /^ตอบแอดมิน\s+([A-Za-z0-9_-]{6,120})$/.exec(text);
  return match ? { action: "start", ticketId: match[1] } : null;
}
