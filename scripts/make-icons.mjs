// Draws Pusar's icons from the logo mark in src/renderer/src/shell/Logo.tsx.
// Run `node scripts/make-icons.mjs` after changing the mark or the accent color.
//
// resources/tray.png  the mark alone, for the tray
// resources/icon.png  the mark on a dark tile, for the window and taskbar
// build/icon.ico      the same tile at every size Windows asks for, for the .exe and installer
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tokens = readFileSync(path.join(root, "src/renderer/src/styles/tokens.css"), "utf8");

function token(name) {
  const hex = new RegExp(`--${name}:\\s*#([0-9a-fA-F]{6})`).exec(tokens)?.[1];
  if (!hex) throw new Error(`No --${name} color in tokens.css`);
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

const ACCENT = token("accent");
const TILE = token("bg-raised");
const EDGE = token("line-strong");

// The mark, in the logo's own 24-unit coordinates: a 3.5-wide stroke with square caps.
const HALF = 1.75;
/** Square ends and the corner extend past the line; where it flows into the curve, it doesn't. */
function onStraight(x, y, [x1, y1, x2, y2], extendStart, extendEnd) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / length;
  const uy = (y2 - y1) / length;
  const along = (x - x1) * ux + (y - y1) * uy;
  const across = Math.abs((x - x1) * -uy + (y - y1) * ux);
  return along >= (extendStart ? -HALF : 0) && along <= length + (extendEnd ? HALF : 0) && across <= HALF;
}
function onMark(x, y) {
  if (onStraight(x, y, [5, 22, 5, 3], true, true)) return true;
  if (onStraight(x, y, [5, 3, 14.5, 3], true, false)) return true;
  if (onStraight(x, y, [14.5, 16, 10, 16], false, true)) return true;
  if (x >= 14.5 && Math.abs(Math.hypot(x - 14.5, y - 9.5) - 6.5) <= HALF) return true;
  return Math.hypot(x - 13.5, y - 9.5) <= 1.75;
}

/** Inside a rounded square covering 0..1, with corners of radius r. */
function inRoundedSquare(u, v, r) {
  const dx = Math.max(r - u, 0, u - (1 - r));
  const dy = Math.max(r - v, 0, v - (1 - r));
  return dx * dx + dy * dy <= r * r;
}

/** Returns RGBA rows for one image, sampling each pixel 8 x 8 times for smooth edges. */
function render(size, tiled) {
  const samples = 8;
  const pixels = Buffer.alloc(size * size * 4);
  // On a tile the mark keeps clear of the edges; alone it fills the space.
  const pad = tiled ? 4.5 : 0;
  const span = 24 + pad * 2;
  const edgeWidth = Math.max(1 / size, 0.008);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let mark = 0;
      let tile = 0;
      let edge = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const u = (px + (sx + 0.5) / samples) / size;
          const v = (py + (sy + 0.5) / samples) / size;
          if (onMark(u * span - pad, v * span - pad)) mark++;
          if (tiled && inRoundedSquare(u, v, 0.22)) {
            tile++;
            const inset = (w) => (w - edgeWidth) / (1 - 2 * edgeWidth);
            if (!inRoundedSquare(inset(u), inset(v), 0.22)) edge++;
          }
        }
      }
      const total = samples * samples;
      const i = (py * size + px) * 4;
      if (!tiled) {
        pixels.set([...ACCENT, Math.round((mark / total) * 255)], i);
        continue;
      }
      // Mark over edge over tile, mixed by how much of the pixel each covers.
      const markShare = Math.min(mark, tile) / Math.max(tile, 1);
      const edgeShare = edge / Math.max(tile, 1);
      const color = [0, 1, 2].map((c) => {
        const base = TILE[c] * (1 - edgeShare) + EDGE[c] * edgeShare;
        return Math.round(base * (1 - markShare) + ACCENT[c] * markShare);
      });
      pixels.set([...color, Math.round((tile / total) * 255)], i);
    }
  }
  return pixels;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, check]);
}

function png(size, tiled) {
  const pixels = render(size, tiled);
  const rows = [];
  for (let y = 0; y < size; y++) rows.push(Buffer.from([0]), pixels.subarray(y * size * 4, (y + 1) * size * 4));
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** An .ico holding PNG images, which Windows has read since Vista. */
function ico(sizes) {
  const images = sizes.map((size) => png(size, true));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map((image, index) => {
    const entry = Buffer.alloc(16);
    const size = sizes[index];
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images]);
}

mkdirSync(path.join(root, "resources"), { recursive: true });
mkdirSync(path.join(root, "build"), { recursive: true });
writeFileSync(path.join(root, "resources/tray.png"), png(32, false));
writeFileSync(path.join(root, "resources/icon.png"), png(256, true));
writeFileSync(path.join(root, "build/icon.ico"), ico([16, 20, 24, 32, 40, 48, 64, 128, 256]));
console.log("Wrote resources/tray.png, resources/icon.png and build/icon.ico");
