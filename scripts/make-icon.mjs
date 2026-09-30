/**
 * 零依赖生成应用图标 build/icon.ico（多尺寸，32 位 BGRA 位图格式）。
 *
 * 用超采样抗锯齿绘制：圆角渐变底色 + 白色「磁盘」图形，
 * 与界面左上角的 logo 保持一致。
 *
 * 运行： node scripts/make-icon.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'build');

/* ---------------- 基础几何 ---------------- */

function insideRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const inCornerX = x < x0 + r || x > x1 - r;
  const inCornerY = y < y0 + r || y > y1 - r;
  if (!inCornerX || !inCornerY) return true;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function insideCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/* ---------------- 逐像素着色 ---------------- */

const BRAND_TOP = [58, 123, 240];
const BRAND_BOTTOM = [28, 71, 184];

/** 返回该点的 [r,g,b,a]，a ∈ {0,1} */
function sample(u, v) {
  // 底色：圆角方块
  if (!insideRoundRect(u, v, 0.04, 0.04, 0.96, 0.96, 0.22)) {
    return [0, 0, 0, 0];
  }

  const t = Math.min(1, Math.max(0, (v - 0.04) / 0.92));
  let r = BRAND_TOP[0] + (BRAND_BOTTOM[0] - BRAND_TOP[0]) * t;
  let g = BRAND_TOP[1] + (BRAND_BOTTOM[1] - BRAND_TOP[1]) * t;
  let b = BRAND_TOP[2] + (BRAND_BOTTOM[2] - BRAND_TOP[2]) * t;

  // 顶部高光
  const gloss = Math.max(0, 1 - Math.abs(v - 0.24) / 0.24) * 0.16;
  r += (255 - r) * gloss;
  g += (255 - g) * gloss;
  b += (255 - b) * gloss;

  // 白色图形：外框 + 分隔线 + 指示灯
  const X0 = 0.185;
  const Y0 = 0.275;
  const X1 = 0.815;
  const Y1 = 0.725;
  const R = 0.085;
  const S = 0.052; // 线宽

  const outer = insideRoundRect(u, v, X0, Y0, X1, Y1, R);
  const inner = insideRoundRect(u, v, X0 + S, Y0 + S, X1 - S, Y1 - S, Math.max(0.01, R - S));
  const divider = v >= 0.535 && v <= 0.575 && u >= X0 + S && u <= X1 - S;
  const dot = insideCircle(u, v, 0.305, 0.637, 0.036);

  if ((outer && !inner) || divider || dot) {
    return [255, 255, 255, 1];
  }

  return [Math.round(r), Math.round(g), Math.round(b), 1];
}

/** 超采样渲染指定尺寸的 RGBA 图（返回 Uint8ClampedArray） */
function renderRGBA(size, ss = 4) {
  const S = size * ss;
  const acc = new Float64Array(size * size * 4);

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let ar = 0;
      let ag = 0;
      let ab = 0;
      let aa = 0;
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const u = (px * ss + sx + 0.5) / S;
          const v = (py * ss + sy + 0.5) / S;
          const [r, g, b, a] = sample(u, v);
          ar += r * a;
          ag += g * a;
          ab += b * a;
          aa += a;
        }
      }
      const n = ss * ss;
      const idx = (py * size + px) * 4;
      const alpha = aa / n;
      if (aa > 0) {
        acc[idx] = ar / aa;
        acc[idx + 1] = ag / aa;
        acc[idx + 2] = ab / aa;
      }
      acc[idx + 3] = alpha * 255;
    }
  }
  return acc;
}

/* ---------------- ICO 编码 ---------------- */

function encodeIconImage(size) {
  const rgba = renderRGBA(size);
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(size, 4); // biWidth
  header.writeInt32LE(size * 2, 8); // biHeight（含 AND 掩码）
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount
  header.writeUInt32LE(0, 16); // biCompression = BI_RGB
  header.writeUInt32LE(size * size * 4, 20); // biSizeImage

  // BGRA，自下而上
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const srcRow = size - 1 - y;
    for (let x = 0; x < size; x += 1) {
      const si = (srcRow * size + x) * 4;
      const di = (y * size + x) * 4;
      pixels[di] = Math.round(rgba[si + 2]); // B
      pixels[di + 1] = Math.round(rgba[si + 1]); // G
      pixels[di + 2] = Math.round(rgba[si]); // R
      pixels[di + 3] = Math.round(rgba[si + 3]); // A
    }
  }

  // AND 掩码：1bpp，行按 4 字节对齐，全 0（不透明由 alpha 决定）
  const maskRowBytes = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskRowBytes * size);

  return Buffer.concat([header, pixels, mask]);
}

function buildIco(sizes) {
  const images = sizes.map((s) => encodeIconImage(s));

  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2); // type = icon
  dir.writeUInt16LE(sizes.length, 4);

  const entries = [];
  let offset = 6 + sizes.length * 16;
  sizes.forEach((size, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(images[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += images[i].length;
    entries.push(e);
  });

  return Buffer.concat([dir, ...entries, ...images]);
}

/* ---------------- PNG 编码（用于预览与文档） ---------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(size) {
  const rgba = renderRGBA(size);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size * 4; x += 1) {
      raw[y * (size * 4 + 1) + 1 + x] = Math.round(rgba[y * size * 4 + x]);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- 主流程 ---------------- */

const sizes = [256, 128, 64, 48, 32, 16];
fs.mkdirSync(OUT_DIR, { recursive: true });

const ico = buildIco(sizes);
fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), ico);
fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), encodePng(256));

// 顺带输出一张 SVG 供文档使用
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a7bf0"/>
      <stop offset="1" stop-color="#1c47b8"/>
    </linearGradient>
  </defs>
  <rect x="10" y="10" width="236" height="236" rx="56" fill="url(#g)"/>
  <rect x="47" y="70" width="162" height="116" rx="22" fill="none" stroke="#fff" stroke-width="13"/>
  <path d="M47 137h162" stroke="#fff" stroke-width="13"/>
  <circle cx="78" cy="163" r="9" fill="#fff"/>
</svg>`;
fs.writeFileSync(path.join(OUT_DIR, 'icon.svg'), svg, 'utf8');

console.log(
  `icon.ico 已生成：${path.join(OUT_DIR, 'icon.ico')}（${(ico.length / 1024).toFixed(0)} KB，含 ${sizes.join('/')}）`
);
