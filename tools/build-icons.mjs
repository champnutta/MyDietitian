// Generates the คู่มือ (help-guide) Flex icon set: white line icons on a
// transparent ground, rasterized SVG -> PNG (LINE Flex accepts PNG/JPEG, not
// SVG). The solid green chip is drawn by Flex around the image, so the PNG is
// white-on-transparent and the chip color stays a Flex token. Style: single
// 2px rounded line weight, 24-unit grid. Run: `npm run icons:build`.
//
// Source of truth for the icon glyphs lives here; PNGs are build output under
// apps/liff/public/assets/icons/ and are served from
// https://mydietitian.web.app/assets/icons/<name>.png
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../apps/liff/public/assets/icons");
const previewPath = resolve(here, "../.icon-preview.png");

// Inner SVG for each glyph, drawn on a 24x24 grid.
const ICONS = {
  camera:
    '<path d="M3 9a2 2 0 0 1 2-2h2.4l1.3-2h6.6l1.3 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>' +
    '<circle cx="12.5" cy="13" r="3.3"/>',
  edit:
    '<path d="M16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1 1-4z"/>' +
    '<path d="M14.5 6.5l3 3"/>',
  check:
    '<circle cx="12" cy="12" r="8.5"/>' +
    '<path d="M8.4 12.4l2.6 2.6 4.6-5.2"/>',
  dumbbell:
    '<path d="M6.5 9v6M4 10.5v3M17.5 9v6M20 10.5v3M6.5 12h11"/>',
  scale:
    '<path d="M4.5 17a7.5 7.5 0 0 1 15 0z"/>' +
    '<path d="M12 17l4.2-3.4"/>' +
    '<circle cx="12" cy="17" r="1"/>',
  report:
    '<path d="M6 3h8l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/>' +
    '<path d="M14 3v4h4"/>' +
    '<path d="M8.5 13v3M12 11v5M15.5 14.5v1.5"/>',
  summary:
    '<path d="M12 4.5a7.5 7.5 0 1 1-5.3 2.2"/>' +
    '<circle cx="12" cy="12" r="3.1"/>',
  trend:
    '<path d="M4 4v16h16"/>' +
    '<path d="M7 15l3-3 3 2 4.5-5.5"/>' +
    '<path d="M15 8.5h2.5V11"/>',
  target:
    '<circle cx="12" cy="12" r="8.5"/>' +
    '<circle cx="12" cy="12" r="4.7"/>' +
    '<circle cx="12" cy="12" r="1.3"/>',
  bowl:
    '<path d="M4 11h16a8 8 0 0 1-16 0z"/>' +
    '<path d="M9 11c-1-3 1-5 3-5.5"/>' +
    '<path d="M13 11c0-2.6 2-4 4-4"/>',
  ticket:
    '<path d="M4 7a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v3a2 2 0 0 0 0 4v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3a2 2 0 0 0 0-4z"/>' +
    '<path d="M14 6.5v11" stroke-dasharray="2 2"/>',
  chat:
    '<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H10l-4 3.5V15H6a2 2 0 0 1-2-2z"/>' +
    '<path d="M8.5 9.8h7M8.5 12.3h4"/>',
};

const STROKE = '#FFFFFF';
const ATTRS = `fill="none" stroke="${STROKE}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
const RENDER_PX = 144;

function iconSvg(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ${ATTRS}>${inner}</svg>`;
}

mkdirSync(outDir, { recursive: true });
const names = Object.keys(ICONS);
for (const name of names) {
  const png = new Resvg(iconSvg(ICONS[name]), { fitTo: { mode: "width", value: RENDER_PX } })
    .render()
    .asPng();
  writeFileSync(resolve(outDir, `${name}.png`), png);
}
console.log(`Wrote ${names.length} icons -> ${outDir}`);

// Contact sheet on the brand green so white glyphs are visible for review.
// Opt-in only (`node tools/build-icons.mjs --preview`) so a normal build does
// not write a non-source PNG into the repo.
if (process.argv.includes("--preview")) {
const cols = 4;
const chip = 120;
const gap = 26;
const rows = Math.ceil(names.length / cols);
const W = cols * chip + (cols + 1) * gap;
const H = rows * chip + (rows + 1) * gap;
const iconArea = 70;
const s = iconArea / 24;
const pad = (chip - iconArea) / 2;
let cells = "";
names.forEach((name, i) => {
  const cx = gap + (i % cols) * (chip + gap);
  const cy = gap + Math.floor(i / cols) * (chip + gap);
  cells +=
    `<rect x="${cx}" y="${cy}" width="${chip}" height="${chip}" rx="26" fill="#1F8A43"/>` +
    `<g transform="translate(${cx + pad} ${cy + pad}) scale(${s})" ${ATTRS}>${ICONS[name]}</g>`;
});
const preview = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#0E2A18"/>${cells}</svg>`;
writeFileSync(previewPath, new Resvg(preview).render().asPng());
console.log(`Wrote preview -> ${previewPath}`);
}
