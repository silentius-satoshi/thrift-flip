// Generates the PWA icons from the four-dot mark. No dependencies — a PNG is a
// handful of length-prefixed chunks around a zlib stream, and adding an image
// library to draw four circles would be the larger cost.
//
//   node scripts/gen-icons.mjs
//
// The mark is a 1x4 row in the app (ui/FourDotMark); at icon sizes that reads as
// a thin stripe, so the icon lays the same four colors out as a 2x2 block.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const BG = [0x0f, 0x0f, 0x0f];                 // --bg
const DOTS = [
  [0xe9, 0x40, 0x3b], // --red
  [0x36, 0x65, 0xf3], // --blue
  [0xf5, 0xaf, 0x02], // --yellow
  [0x86, 0xb8, 0x17], // --green
];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // truecolour RGB
  // rows are filter-byte prefixed; filter 0 (None) keeps this trivially simple
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 3 + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * size * 3, (y + 1) * size * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 4x supersampled coverage, so the circle edges are smooth without any AA pass
function render(size) {
  const px = Buffer.alloc(size * size * 3);
  const radius = size * 0.155;
  const offset = size * 0.205;
  const centers = [
    [size / 2 - offset, size / 2 - offset],
    [size / 2 + offset, size / 2 - offset],
    [size / 2 - offset, size / 2 + offset],
    [size / 2 + offset, size / 2 + offset],
  ];
  const SS = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      let color = null;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px_ = x + (sx + 0.5) / SS;
          const py_ = y + (sy + 0.5) / SS;
          for (let i = 0; i < 4; i++) {
            const dx = px_ - centers[i][0];
            const dy = py_ - centers[i][1];
            if (dx * dx + dy * dy <= radius * radius) { hits++; color = DOTS[i]; break; }
          }
        }
      }
      const a = hits / (SS * SS);
      const idx = (y * size + x) * 3;
      for (let c = 0; c < 3; c++) {
        px[idx + c] = Math.round((color ? color[c] : BG[c]) * a + BG[c] * (1 - a));
      }
    }
  }
  return px;
}

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(join(OUT, name), png(size, render(size)));
  console.log(`wrote public/${name} (${size}x${size})`);
}
