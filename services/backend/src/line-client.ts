import { LINE_CHANNEL_ACCESS_TOKEN } from "./runtime.js";

export async function replyToLine(replyToken: string, text: string): Promise<void> {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${LINE_CHANNEL_ACCESS_TOKEN.value()}`
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text: text.slice(0, 4900) }]
    })
  });

  if (!res.ok) {
    throw new Error(`LINE reply failed: ${res.status} ${await res.text()}`);
  }
}

export async function pushMessage(userId: string, text: string): Promise<void> {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${LINE_CHANNEL_ACCESS_TOKEN.value()}`
    },
    body: JSON.stringify({
      to: userId,
      messages: [{ type: "text", text: text.slice(0, 4900) }]
    })
  });

  if (!res.ok) {
    throw new Error(`LINE push failed: ${res.status} ${await res.text()}`);
  }
}

export async function downloadLineContent(messageId: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: {
      "Authorization": `Bearer ${LINE_CHANNEL_ACCESS_TOKEN.value()}`
    }
  });

  if (!res.ok) {
    throw new Error(`LINE content download failed: ${res.status} ${await res.text()}`);
  }

  const mimeType = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  const buffer = Buffer.from(await res.arrayBuffer());
  return {
    base64: buffer.toString("base64"),
    mimeType
  };
}

export async function getLineProfile(userId: string): Promise<{ displayName: string }> {
  const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
    headers: {
      "Authorization": `Bearer ${LINE_CHANNEL_ACCESS_TOKEN.value()}`
    }
  });

  if (!res.ok) {
    return { displayName: "Member" };
  }

  const profile = await res.json() as { displayName?: string };
  return { displayName: profile.displayName || "Member" };
}

export async function showLoadingAnimation(chatId: string, seconds: number): Promise<void> {
  try {
    await fetch("https://api.line.me/v2/bot/chat/loading/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LINE_CHANNEL_ACCESS_TOKEN.value()}`
      },
      body: JSON.stringify({
        chatId,
        loadingSeconds: Math.max(5, Math.min(60, seconds))
      })
    });
  } catch {
    // Loading animation is nice-to-have; reply flow must continue if LINE ignores it.
  }
}
