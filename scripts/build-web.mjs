// Builds www/index.html — the single-file app — from the split sources in src/:
//   src/index.html     skeleton with @@STYLES@@ / @@SHADERS@@ / @@APP@@
//   src/styles.css     all CSS (font inlined at __FONT_B64__)
//   src/shaders/*      GLSL ES 3.00 (WebGL2 fallback), each inlined as <script type="x-shader" id="<file name>">
//   src/wgsl/*         WGSL twins of every shader (WebGPU, preferred), inlined the same way
//                      (*.glsl are shared chunks, pulled in by `#include` at compile time)
//   src/app.js         CONFIG, astronomy, data model, WebGL2 pipeline   (…//@@GPU@@ //@@UI@@)
//   src/gpu.js         WebGPU pipeline
//   src/ui.js          scrolling, widgets, expand transitions, data fetching, PWA
//
// Real assets are fetched from their pinned upstream sources, processed with
// sharp and inlined as base64, so the repo itself holds no binaries:
//   • rain drop  — Codrops RainEffect drop-color.png (refraction) + drop-alpha.png (shape)
//   • clouds     — lightest/clouds (Nikita Agafonov, MIT): 128³ Perlin-Worley shape
//                  volume (box-filtered to 64³), 32³ Worley erosion volume, tileable
//                  weather map (box-filtered to 256²)
//   • font       — Inter variable (opsz + wght), SIL OFL 1.1, from @fontsource-variable/inter
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const rd = p => fs.readFileSync(path.join(root, p), 'utf8');
const SRC = {
  dropColor: 'https://raw.githubusercontent.com/codrops/RainEffect/5270be663903883ae585858216b656120d8d4cd5/demo/img/drop-color.png',
  dropAlpha: 'https://raw.githubusercontent.com/codrops/RainEffect/5270be663903883ae585858216b656120d8d4cd5/demo/img/drop-alpha.png',
};
const LIGHTEST = 'https://raw.githubusercontent.com/lightest/clouds/a3984d653838330c836aaaaaa441b4fbc01fdc21/';
Object.assign(SRC, {
  shape: LIGHTEST + 'noise_shape_packed128.png',
  erosion: LIGHTEST + 'noise_erosion_packed.png',
  weather: LIGHTEST + 'weather_turbulent.png',
});
const cacheDir = path.join(root, 'assets/.cache');
fs.mkdirSync(cacheDir, { recursive: true });

async function get(name, url) {
  const file = path.join(cacheDir, name + path.extname(url));
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(file, buf);
  return buf;
}

// rain drop → 64² RGBA: rgb = refraction map (drop-color), a = shape (drop-alpha)
const color = await sharp(await get('drop-color', SRC.dropColor)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const alpha = await sharp(await get('drop-alpha', SRC.dropAlpha)).ensureAlpha().extractChannel(3).raw().toBuffer();
const n = color.info.width * color.info.height, rgba = Buffer.alloc(n * 4);
for (let i = 0; i < n; i++) {
  rgba[i * 4] = color.data[i * 3]; rgba[i * 4 + 1] = color.data[i * 3 + 1]; rgba[i * 4 + 2] = color.data[i * 3 + 2]; rgba[i * 4 + 3] = alpha[i];
}
const drop = await sharp(rgba, { raw: { width: color.info.width, height: color.info.height, channels: 4 } })
  .resize(64, 64, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();

// cloud shape: 128 slices of 128² side by side → box-filter to 64³, stretch to the full 8-bit range
async function grayStrip(buf) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const g = new Uint8Array(info.width * info.height);
  for (let i = 0; i < g.length; i++) g[i] = data[i * info.channels];
  return { g, w: info.width, h: info.height };
}
function stretch(a) {
  let mn = 255, mx = 0; for (const v of a) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const k = 255 / Math.max(1, mx - mn); return a.map(v => Math.round((v - mn) * k));
}
const sh = await grayStrip(await get('shape128', SRC.shape));
const N = 64, sh64 = new Float32Array(N * N * N);
for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  let s = 0;
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++)
    s += sh.g[(2 * y + dy) * sh.w + (2 * z + dz) * 128 + 2 * x + dx];
  sh64[x + y * N + z * N * N] = s / 8;
}
const shStrip = new Uint8Array(N * N * N), shS = stretch(Array.from(sh64));
for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) shStrip[y * N * N + z * N + x] = shS[x + y * N + z * N * N];
const shape = await sharp(Buffer.from(shStrip), { raw: { width: N * N, height: N, channels: 1 } }).png({ compressionLevel: 9 }).toBuffer();
// erosion: 32³, just stretched
const er = await grayStrip(await get('erosion32', SRC.erosion));
const erosion = await sharp(Buffer.from(Uint8Array.from(stretch(Array.from(er.g)))), { raw: { width: er.w, height: er.h, channels: 1 } }).png({ compressionLevel: 9 }).toBuffer();
// weather map: 512² → 256² by exact 2×2 box filter (keeps it tileable); R coverage, G cell height
const wm = await sharp(await get('weather', SRC.weather)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const WW = wm.info.width / 2, wbuf = Buffer.alloc(WW * WW * 3);
for (let y = 0; y < WW; y++) for (let x = 0; x < WW; x++) for (let c = 0; c < 2; c++) {
  let s = 0; for (let k = 0; k < 4; k++) s += wm.data[((2 * y + (k >> 1)) * wm.info.width + 2 * x + (k & 1)) * wm.info.channels + c];
  wbuf[(y * WW + x) * 3 + c] = Math.round(s / 4);
}
// histogram-equalise both channels: a threshold of (1 − cover) then covers exactly that fraction of the sky
for (let c = 0; c < 2; c++) {
  const hist = new Float64Array(256); for (let i = 0; i < WW * WW; i++) hist[wbuf[i * 3 + c]]++;
  const cdf = new Uint8Array(256); let acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; cdf[v] = Math.round(255 * (acc - hist[v] / 2) / (WW * WW)); }
  for (let i = 0; i < WW * WW; i++) wbuf[i * 3 + c] = cdf[wbuf[i * 3 + c]];
}
const weather = await sharp(wbuf, { raw: { width: WW, height: WW, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();

const font = fs.readFileSync(path.join(root, 'node_modules/@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2'));

// shaders → inline script blocks (text is read back by app.js via textContent)
const shaderFiles = [['src/shaders', /\.(vert|frag|glsl)$/], ['src/wgsl', /\.wgsl$/]].flatMap(([d, re]) =>
  fs.readdirSync(path.join(root, d)).filter(f => re.test(f)).sort().map(f => path.join(root, d, f)));
const shaders = shaderFiles.map(file => {
  const f = path.basename(file), code = fs.readFileSync(file, 'utf8');
  if (code.includes('</script')) throw new Error(f + ' contains </script');
  return `<script type="x-shader" id="${f}">\n${code.trim()}\n</script>`;
}).join('\n');

const css = rd('src/styles.css').replace('__FONT_B64__', font.toString('base64'));
const app = rd('src/app.js').replace('//@@GPU@@', () => rd('src/gpu.js')).replace('//@@UI@@', () => rd('src/ui.js'))
  .replace('__DROP_B64__', drop.toString('base64'))
  .replace('__SHAPE_B64__', shape.toString('base64')).replace('__EROSION_B64__', erosion.toString('base64'))
  .replace('__WEATHER_B64__', weather.toString('base64'));
if (app.includes('</script')) throw new Error('app contains </script');

// functions as replacers so `$&`-style patterns in the sources are left alone
const html = rd('src/index.html')
  .replace('@@STYLES@@', () => css)
  .replace('@@SHADERS@@', () => shaders)
  .replace('@@APP@@', () => app);
if (/__(FONT|DROP|SHAPE|EROSION|WEATHER)_B64__|@@(STYLES|SHADERS|APP|UI)@@/.test(html)) throw new Error('placeholder left in output');
fs.writeFileSync(path.join(root, 'www/index.html'), html);
const kb = b => (b.length / 1024).toFixed(0) + ' KB';
console.log(`www/index.html ${kb(html)} — drop ${kb(drop)}, shape ${kb(shape)}, erosion ${kb(erosion)}, weather ${kb(weather)}, font ${kb(font)}, ${shaders.match(/<script/g).length} shader sources`);
