const fs = require("node:fs");
const path = require("node:path");

const args = parseArgs(process.argv.slice(2));
const configPath = path.resolve(args.config || "config/rich-menu-main-v2.json");
const imagePath = path.resolve(args.image || "apps/liff/public/assets/rich-menu-main-v2.png");
const publish = args.publish === true;

const richMenu = JSON.parse(fs.readFileSync(configPath, "utf8"));
const image = fs.readFileSync(imagePath);
validateRichMenu(richMenu, image);

if (!publish) {
  console.log(JSON.stringify({
    ok: true,
    mode: "dry-run",
    configPath,
    imagePath,
    imageBytes: image.length,
    areas: richMenu.areas.length,
    message: "Validation passed. Add --publish and LINE_CHANNEL_ACCESS_TOKEN to create and set this menu as default."
  }, null, 2));
  process.exit(0);
}

const token = String(process.env.LINE_CHANNEL_ACCESS_TOKEN || "").trim();
if (!token) {
  throw new Error("LINE_CHANNEL_ACCESS_TOKEN is required with --publish");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  const create = await lineRequest(
    "https://api.line.me/v2/bot/richmenu",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(richMenu) }
  );
  const richMenuId = String(create.richMenuId || "");
  if (!richMenuId) throw new Error("LINE did not return richMenuId");

  try {
    await lineRequest(
      `https://api-data.line.me/v2/bot/richmenu/${encodeURIComponent(richMenuId)}/content`,
      { method: "POST", headers: { "Content-Type": "image/png" }, body: image },
      false
    );
    await lineRequest(
      `https://api.line.me/v2/bot/user/all/richmenu/${encodeURIComponent(richMenuId)}`,
      { method: "POST" },
      false
    );
  } catch (error) {
    console.error(`Rich menu ${richMenuId} was created but could not be fully activated.`);
    throw error;
  }

  console.log(JSON.stringify({
    ok: true,
    mode: "published",
    richMenuId,
    setAsDefault: true,
    note: "The previous rich menu was not deleted, so it remains available for rollback."
  }, null, 2));
}

async function lineRequest(url, options, expectJson = true) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`LINE API ${response.status}: ${body || response.statusText}`);
  }
  return expectJson && body ? JSON.parse(body) : {};
}

function validateRichMenu(menu, png) {
  if (menu?.size?.width !== 2500 || menu?.size?.height !== 1686) {
    throw new Error("Rich menu must be 2500x1686");
  }
  if (!Array.isArray(menu.areas) || menu.areas.length !== 6) {
    throw new Error("Rich menu must define exactly 6 action areas");
  }
  if (!menu.chatBarText || Array.from(menu.chatBarText).length > 14) {
    throw new Error("chatBarText must contain 1-14 characters");
  }
  if (png.length > 1024 * 1024) {
    throw new Error(`PNG exceeds LINE's 1 MB limit (${png.length} bytes)`);
  }
  if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("Image is not a PNG file");
  }
  const pngWidth = png.readUInt32BE(16);
  const pngHeight = png.readUInt32BE(20);
  if (pngWidth !== menu.size.width || pngHeight !== menu.size.height) {
    throw new Error(`PNG is ${pngWidth}x${pngHeight}; expected ${menu.size.width}x${menu.size.height}`);
  }

  for (const [index, area] of menu.areas.entries()) {
    const b = area?.bounds;
    if (![b?.x, b?.y, b?.width, b?.height].every(Number.isInteger)) {
      throw new Error(`Area ${index + 1} has invalid bounds`);
    }
    if (b.x < 0 || b.y < 0 || b.width <= 0 || b.height <= 0 ||
        b.x + b.width > menu.size.width || b.y + b.height > menu.size.height) {
      throw new Error(`Area ${index + 1} is outside the canvas`);
    }
    if (!["message", "uri"].includes(area?.action?.type)) {
      throw new Error(`Area ${index + 1} has unsupported action`);
    }
  }
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--publish") {
      parsed.publish = true;
    } else if (value.startsWith("--") && values[index + 1]) {
      parsed[value.slice(2)] = values[index + 1];
      index += 1;
    }
  }
  return parsed;
}
