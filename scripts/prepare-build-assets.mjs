import { mkdir, cp, copyFile, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import pngToIco from 'png-to-ico';
import { PNG } from 'pngjs';

const root = resolve(import.meta.dirname, '..');
const logoPng = resolve(root, 'src/renderer/src/assets/iFi.png');
const buildDir = resolve(root, 'build');
const iconIco = resolve(buildDir, 'icon.ico');
const phoneSrc = resolve(root, 'src/phone');
const phoneOut = resolve(root, 'out/phone');
const rendererFav = resolve(root, 'src/renderer/favicon.png');
const installerSidebar = resolve(buildDir, 'installer-sidebar.bmp');
const installerHeader = resolve(buildDir, 'installer-header.bmp');

await mkdir(buildDir, { recursive: true });
await mkdir(dirname(iconIco), { recursive: true });

if (!existsSync(logoPng)) {
  throw new Error(`Missing logo PNG at ${logoPng}`);
}

const ico = await pngToIco(logoPng);
await copyFile(logoPng, resolve(buildDir, 'icon.png'));
await copyFile(logoPng, rendererFav);
await writeFile(iconIco, ico);

const logo = PNG.sync.read(await readFile(logoPng));

const makeCanvas = (width, height) => ({ width, height, data: Buffer.alloc(width * height * 4) });
const setPixel = (canvas, x, y, r, g, b, a = 255) => {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const i = (y * canvas.width + x) * 4;
  canvas.data[i] = r;
  canvas.data[i + 1] = g;
  canvas.data[i + 2] = b;
  canvas.data[i + 3] = a;
};
const blendPixel = (canvas, x, y, r, g, b, a = 255) => {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const i = (y * canvas.width + x) * 4;
  const alpha = a / 255;
  canvas.data[i] = Math.round(r * alpha + canvas.data[i] * (1 - alpha));
  canvas.data[i + 1] = Math.round(g * alpha + canvas.data[i + 1] * (1 - alpha));
  canvas.data[i + 2] = Math.round(b * alpha + canvas.data[i + 2] * (1 - alpha));
  canvas.data[i + 3] = 255;
};
const fillGradient = (canvas, top, bottom) => {
  for (let y = 0; y < canvas.height; y++) {
    const t = y / Math.max(1, canvas.height - 1);
    for (let x = 0; x < canvas.width; x++) {
      const vignette = Math.hypot((x / canvas.width) - 0.5, (y / canvas.height) - 0.42) * 42;
      setPixel(
        canvas,
        x,
        y,
        Math.max(0, Math.round(top[0] * (1 - t) + bottom[0] * t - vignette)),
        Math.max(0, Math.round(top[1] * (1 - t) + bottom[1] * t - vignette)),
        Math.max(0, Math.round(top[2] * (1 - t) + bottom[2] * t - vignette)),
      );
    }
  }
};
const drawRoundedRect = (canvas, x, y, w, h, radius, color, alpha = 255) => {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const dx = Math.max(x - xx, 0, xx - (x + w - 1));
      const dy = Math.max(y - yy, 0, yy - (y + h - 1));
      const cx = xx < x + radius ? x + radius : xx >= x + w - radius ? x + w - radius - 1 : xx;
      const cy = yy < y + radius ? y + radius : yy >= y + h - radius ? y + h - radius - 1 : yy;
      if (Math.hypot(xx - cx, yy - cy) <= radius || (xx >= x + radius && xx < x + w - radius) || (yy >= y + radius && yy < y + h - radius)) {
        blendPixel(canvas, xx, yy, color[0], color[1], color[2], alpha);
      }
    }
  }
};
const drawLogo = (canvas, cx, cy, size) => {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = Math.floor((x / size) * logo.width);
      const sy = Math.floor((y / size) * logo.height);
      const si = (sy * logo.width + sx) * 4;
      const a = logo.data[si + 3];
      if (a > 8) blendPixel(canvas, Math.round(cx - size / 2 + x), Math.round(cy - size / 2 + y), logo.data[si], logo.data[si + 1], logo.data[si + 2], a);
    }
  }
};
const writeBmp = async (canvas, file) => {
  const rowStride = Math.ceil((canvas.width * 3) / 4) * 4;
  const imageSize = rowStride * canvas.height;
  const header = Buffer.alloc(54);
  header.write('BM', 0);
  header.writeUInt32LE(54 + imageSize, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(canvas.width, 18);
  header.writeInt32LE(canvas.height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  header.writeUInt32LE(imageSize, 34);
  const pixels = Buffer.alloc(imageSize);
  for (let y = 0; y < canvas.height; y++) {
    const srcY = canvas.height - 1 - y;
    for (let x = 0; x < canvas.width; x++) {
      const src = (srcY * canvas.width + x) * 4;
      const dst = y * rowStride + x * 3;
      pixels[dst] = canvas.data[src + 2];
      pixels[dst + 1] = canvas.data[src + 1];
      pixels[dst + 2] = canvas.data[src];
    }
  }
  await writeFile(file, Buffer.concat([header, pixels]));
};

const sidebar = makeCanvas(164, 314);
fillGradient(sidebar, [20, 22, 27], [4, 5, 6]);
drawRoundedRect(sidebar, 32, 42, 100, 100, 28, [255, 255, 255], 18);
drawLogo(sidebar, 82, 92, 66);
for (let x = 26; x < 138; x++) blendPixel(sidebar, x, 176, 34, 211, 238, Math.round(160 * (1 - Math.abs(x - 82) / 70)));
for (let x = 42; x < 122; x++) blendPixel(sidebar, x, 184, 255, 255, 255, Math.round(70 * (1 - Math.abs(x - 82) / 52)));
await writeBmp(sidebar, installerSidebar);

const header = makeCanvas(150, 57);
fillGradient(header, [246, 247, 249], [231, 235, 239]);
drawRoundedRect(header, 8, 8, 41, 41, 12, [6, 7, 9], 230);
drawLogo(header, 28, 28, 30);
for (let x = 60; x < 136; x++) blendPixel(header, x, 27, 34, 211, 238, Math.round(95 * (1 - Math.abs(x - 98) / 46)));
await writeBmp(header, installerHeader);

await mkdir(phoneOut, { recursive: true });
await cp(phoneSrc, phoneOut, { recursive: true, force: true });

console.log('Prepared iFicam build assets: icon.ico, installer artwork, and phone client.');
