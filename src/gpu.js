/* =============================================================================
   WebGPU pipeline — the renderer of choice. The same passes as the WebGL2 path
   in render() (field → atmosphere LUTs → clouds + temporal resolve → drops on
   the glass → sky → dual-Kawase blur → widget material), with a WGSL twin of
   every shader in src/wgsl. The frame's state (springs, camera, uniforms) is
   computed once in update() and shared by both paths.

   Why WebGPU: one command buffer per frame instead of hundreds of individual
   GL calls, pipelines compiled once and validated up front (no state
   re-validation on every draw), explicit render targets and bind groups —
   less CPU per frame on the phone, so more of the 120 Hz budget goes to the
   sky and the UI.

   WebGL2 stays as the fallback: if the browser (or the Android WebView) has no
   WebGPU, the adapter is refused, or a pipeline fails to compile, the app
   starts on WebGL2 exactly as before. `?renderer=webgl` forces it.
   Triple-tap the sky (or ⋮ → stats) to see which one is running.
   ============================================================================= */
let gpu = null;

async function initGPU() {
  const want = new URLSearchParams(location.search).get('renderer') || CONFIG.renderer;
  if (want === 'webgl' || !navigator.gpu) return false;
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null);
  if (!adapter) return false;
  const dev = await adapter.requestDevice();
  const g = { dev, ctx: null, fmt: navigator.gpu.getPreferredCanvasFormat(), pl: {}, rt: {}, u: {}, bgc: new Map(), gen: 1, tex: {} };
  const TU = GPUTextureUsage, BU = GPUBufferUsage;
  g.sClamp = dev.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  g.sRep = dev.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat' });

  // pipelines — compiled together and checked before the canvas is committed to WebGPU
  const HF = 'rgba16float', U8 = 'rgba8unorm';
  const mod = async id => {
    const m = dev.createShaderModule({ code: src(id), label: id });
    const info = await m.getCompilationInfo();
    const errs = info.messages.filter(x => x.type === 'error');
    if (errs.length) throw new Error(id + ': ' + errs.map(x => x.lineNum + ':' + x.linePos + ' ' + x.message).join('; '));
    return m;
  };
  const full = async (id, fmt) => {
    const m = await mod(id);
    return dev.createRenderPipelineAsync({ label: id, layout: 'auto', vertex: { module: m, entryPoint: 'vs' },
      fragment: { module: m, entryPoint: 'fs', targets: [{ format: fmt }] }, primitive: { topology: 'triangle-list' } });
  };
  const dropPipe = async () => {
    const m = await mod('drop.wgsl');
    return dev.createRenderPipelineAsync({ label: 'drop', layout: 'auto',
      vertex: { module: m, entryPoint: 'vs', buffers: [
        { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
        { arrayStride: 16, stepMode: 'instance', attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x4' }] }] },
      fragment: { module: m, entryPoint: 'fs', targets: [{ format: U8, blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] },
      primitive: { topology: 'triangle-strip' } });
  };
  [g.pl.field, g.pl.trans, g.pl.skyview, g.pl.clouds, g.pl.resolve, g.pl.drop, g.pl.sky, g.pl.down, g.pl.up, g.pl.final] = await Promise.all([
    full('field.wgsl', HF), full('trans.wgsl', HF), full('skyview.wgsl', HF), full('clouds.wgsl', HF), full('resolve.wgsl', HF),
    dropPipe(), full('sky.wgsl', U8), full('down.wgsl', HF), full('up.wgsl', HF), full('final.wgsl', g.fmt)]);

  if (gpuAbandoned) { dev.destroy(); return false; }
  const ctx = canvas.getContext('webgpu');
  if (!ctx) return false;
  canvasHasGPU = true;
  ctx.configure({ device: dev, format: g.fmt, alphaMode: 'opaque' });
  g.ctx = ctx;

  // render targets (half-float radiance, like the GL path on GPUs that can render to it)
  const rt = (w, h, fmt) => { const t = dev.createTexture({ size: [w, h], format: fmt, usage: TU.TEXTURE_BINDING | TU.RENDER_ATTACHMENT | TU.COPY_DST }); return { t, v: t.createView(), w, h, fmt }; };
  g.mkRT = rt;
  g.rt.field = [rt(FW, FH, HF), rt(FW, FH, HF)];
  const half = new Uint16Array(FW * FH * 4).fill(0x3800);                  // 0.5 = no displacement
  for (const r of g.rt.field) dev.queue.writeTexture({ texture: r.t }, half, { bytesPerRow: FW * 8 }, [FW, FH]);
  g.rt.trans = rt(256, 64, HF); g.rt.skyS = rt(192, 108, HF); g.rt.skyM = rt(192, 108, HF);
  g.rt.fresh = rt(2, 2, HF); g.rt.hist = [rt(2, 2, HF), rt(2, 2, HF)];
  g.rt.glass = rt(2, 2, U8); g.rt.sky = rt(2, 2, U8);
  g.rt.bdn = [0, 1, 2, 3, 4].map(() => rt(2, 2, HF)); g.rt.bup = [0, 1, 2].map(() => rt(2, 2, HF));

  // static textures: the baked noise now, the decoded assets when they arrive (gpuAssets)
  g.tex.noise = gpuTex2D(dev, 256, 256, bakeNoise(256, 16), true);
  g.tex.black = gpuTex2D(dev, 1, 1, new Uint8Array([0, 0, 0, 255]), false);
  g.tex.drop = g.tex.black;
  decode(ASSETS.drop).then(img => {
    if (gpu !== g) return;
    const px = pixels(img), w = img.width, h = img.height, fl = new Uint8Array(px.length);
    for (let y = 0; y < h; y++) fl.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);   // flipped, as the GL path uploads it
    g.tex.drop = gpuTex2D(dev, w, h, fl, false); g.gen++;
  }).catch(() => { });

  // vertex data for the drops, uniform buffers (one per draw: writes land before the frame is submitted)
  g.corner = dev.createBuffer({ size: 32, usage: BU.VERTEX | BU.COPY_DST });
  dev.queue.writeBuffer(g.corner, 0, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
  g.drops = dev.createBuffer({ size: DROP.byteLength, usage: BU.VERTEX | BU.COPY_DST });
  const ub = n => ({ f: new Float32Array(n), b: dev.createBuffer({ size: n * 4, usage: BU.UNIFORM | BU.COPY_DST }) });
  g.u.field = ub(20); g.u.trans = ub(4); g.u.skyS = ub(4); g.u.skyM = ub(4); g.u.clouds = ub(52); g.u.resolve = ub(8);
  g.u.drop = ub(4); g.u.sky = ub(128); g.u.down = [0, 1, 2, 3, 4].map(() => ub(4)); g.u.up = [0, 1, 2].map(() => ub(4)); g.u.final = ub(92);

  // any error while drawing (a driver that compiles but misbehaves): drop WebGPU, carry on in WebGL2
  dev.addEventListener('uncapturederror', e => {
    console.error('WebGPU error — switching to WebGL2:', e.error && e.error.message);
    if (gpu === g) { gpu = null; dev.destroy(); fallbackGL(); }
  });
  dev.lost.then(info => {
    if (gpu !== g) return;
    console.warn('WebGPU device lost:', info.message);
    gpu = null;
    if (info.reason !== 'destroyed') startRenderer();     // e.g. the GPU process was reset while in the background
  });
  if (gpuAbandoned) { dev.destroy(); return false; }
  gpu = g;
  return true;
}

// RGBA8 2-D texture, with a box-filtered mip chain when asked (GL's generateMipmap)
function gpuTex2D(dev, w, h, data, mips) {
  const levels = mips ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
  const t = dev.createTexture({ size: [w, h], format: 'rgba8unorm', mipLevelCount: levels, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  let cur = data, cw_ = w, ch_ = h;
  for (let l = 0; l < levels; l++) {
    dev.queue.writeTexture({ texture: t, mipLevel: l }, cur, { bytesPerRow: cw_ * 4 }, [cw_, ch_]);
    if (l === levels - 1) break;
    const nw = Math.max(1, cw_ >> 1), nh = Math.max(1, ch_ >> 1), nx = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let c = 0; c < 4; c++) {
      const x0 = Math.min(2 * x, cw_ - 1), x1 = Math.min(2 * x + 1, cw_ - 1), y0 = Math.min(2 * y, ch_ - 1), y1 = Math.min(2 * y + 1, ch_ - 1);
      nx[(y * nw + x) * 4 + c] = (cur[(y0 * cw_ + x0) * 4 + c] + cur[(y0 * cw_ + x1) * 4 + c] + cur[(y1 * cw_ + x0) * 4 + c] + cur[(y1 * cw_ + x1) * 4 + c] + 2) >> 2;
    }
    cur = nx; cw_ = nw; ch_ = nh;
  }
  return t;
}
// R8 3-D noise volume from its strip of N slices of N×N, with a box-filtered mip chain
function gpuVolume(dev, img, N) {
  const px = pixels(img), W = img.width;
  let cur = new Uint8Array(N * N * N);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) cur[x + y * N + z * N * N] = px[(y * W + z * N + x) * 4];
  const levels = Math.floor(Math.log2(N)) + 1;
  const t = dev.createTexture({ size: [N, N, N], dimension: '3d', format: 'r8unorm', mipLevelCount: levels, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  let n = N;
  for (let l = 0; l < levels; l++) {
    dev.queue.writeTexture({ texture: t, mipLevel: l }, cur, { bytesPerRow: n, rowsPerImage: n }, [n, n, n]);
    if (n === 1) break;
    const m = n >> 1, nx = new Uint8Array(m * m * m);
    for (let z = 0; z < m; z++) for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
      let s = 0;
      for (let k = 0; k < 8; k++) s += cur[(2 * x + (k & 1)) + (2 * y + (k >> 1 & 1)) * n + (2 * z + (k >> 2)) * n * n];
      nx[x + y * m + z * m * m] = (s + 4) >> 3;
    }
    cur = nx; n = m;
  }
  return t;
}
function gpuAssets(shape, erosion, weather) {
  const g = gpu, dev = g.dev;
  g.tex.shape = gpuVolume(dev, shape, 64); g.tex.erosion = gpuVolume(dev, erosion, 32);
  g.tex.weather = gpuTex2D(dev, weather.width, weather.height, pixels(weather), true);
  g.gen++; fillFrames = 3;
}

// resizing a render target keeps its object (bind groups are rebuilt from it)
function gpuResize(r, w, h) {
  if (r.w === w && r.h === h) return;
  r.t.destroy();
  const n = gpu.mkRT(w, h, r.fmt); r.t = n.t; r.v = n.v; r.w = w; r.h = h;
  gpu.gen++;
}
function gpuApplyScale() {
  const R = gpu.rt;
  sizeClouds();
  gpuResize(R.glass, Math.max(2, Math.round(cw / 2)), Math.max(2, Math.round(ch / 2)));
  gpuResize(R.sky, cw, ch);
  R.bdn.forEach((r, k) => gpuResize(r, Math.max(2, cw >> (k + 1)), Math.max(2, ch >> (k + 1))));
  R.bup.forEach((r, j) => gpuResize(r, Math.max(2, cw >> (4 - j)), Math.max(2, ch >> (4 - j))));
  glassDirty = true; fillFrames = 3;
}
function gpuSizeClouds(hw, hh) {
  const R = gpu.rt;
  gpuResize(R.hist[0], hw, hh); gpuResize(R.hist[1], hw, hh); gpuResize(R.fresh, hw / 2, hh / 2);
}

// bind groups are cached and rebuilt only when a texture they use was (re)created
function gbg(key, pipe, res) {
  const c = gpu.bgc.get(key);
  if (c && c.gen === gpu.gen) return c.bg;
  const bg = gpu.dev.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: res.map((r, i) => ({ binding: i, resource: r })) });
  gpu.bgc.set(key, { gen: gpu.gen, bg });
  return bg;
}
const gub = u => { gpu.dev.queue.writeBuffer(u.b, 0, u.f); return { buffer: u.b }; };
function gpass(enc, view, pipe, bg, clear) {
  const p = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', clearValue: clear || [0, 0, 0, 0], storeOp: 'store' }] });
  p.setPipeline(pipe); p.setBindGroup(0, bg); p.draw(3); p.end();
}
// how far the page has scrolled over the sky: the sky softens into its blurred colour (shared by both renderers)
function bgBlur() { return sstep(0.08, 0.95, clamp(SC.y / (heroH * 0.85), 0, 1)); }
function v4(f, o, a, b, c, d) { f[o] = a; f[o + 1] = b; f[o + 2] = c; f[o + 3] = d || 0; }
function v3(f, o, s) { f[o] = s[0]; f[o + 1] = s[1]; f[o + 2] = s[2]; f[o + 3] = 0; }

function gpuRender(dt) {
  const g = gpu, R = g.rt, P_ = g.pl, enc = g.dev.createCommandEncoder(), aspect = cssW / cssH;
  // 1. touch field
  fieldEnergy *= Math.exp(-dt * 1.8);
  if (splatN > 0 || fieldEnergy > 0.002) {
    const u = g.u.field; v4(u.f, 0, FW, FH, Math.exp(-dt / 1.4), aspect); u.f.set(SPL, 4);
    gpass(enc, R.field[1 - fieldIdx].v, P_.field, gbg('field' + fieldIdx, P_.field, [gub(u), R.field[fieldIdx].v, g.sClamp]));
    fieldIdx = 1 - fieldIdx; splatN = 0; SPL.fill(0);
  }
  // 2. atmosphere LUTs
  const haze = CONFIG.sky.haze * (1 + 1.4 * sstep(55, 100, S.hum) + 3 * clamp(P[I_FOG], 0, 1));
  if (Math.abs(haze - transHaze) > 0.04) {
    const u = g.u.trans; v4(u.f, 0, R.trans.w, R.trans.h, haze);
    gpass(enc, R.trans.v, P_.trans, gbg('trans', P_.trans, [gub(u)]));
    transHaze = haze; lutHaze = -1;
  }
  const sunMoved = SUND[0] * LUT_SUN[0] + SUND[1] * LUT_SUN[1] + SUND[2] * LUT_SUN[2] < 0.9999996;
  const moonMoved = MOOND[0] * LUT_MOON[0] + MOOND[1] * LUT_MOON[1] + MOOND[2] * LUT_MOON[2] < 0.9999996;
  if (sunMoved || lutHaze !== transHaze) {
    const u = g.u.skyS; v4(u.f, 0, R.skyS.w, R.skyS.h, SUND[1], transHaze);
    gpass(enc, R.skyS.v, P_.skyview, gbg('skyS', P_.skyview, [gub(u), R.trans.v, g.sClamp])); LUT_SUN.set(SUND);
  }
  if (moonMoved || lutHaze !== transHaze) {
    const u = g.u.skyM; v4(u.f, 0, R.skyM.w, R.skyM.h, MOOND[1], transHaze);
    gpass(enc, R.skyM.v, P_.skyview, gbg('skyM', P_.skyview, [gub(u), R.trans.v, g.sClamp])); LUT_MOON.set(MOOND);
  }
  lutHaze = transHaze;
  // 3. volumetric clouds + temporal resolve (same weather → cloud mapping as render())
  const cov = clamp(1 - (1 - clamp(P[I_CL], 0, 1)) * (1 - 0.7 * clamp(P[I_CM], 0, 1)) * (1 - 0.25 * clamp(P[I_CH], 0, 1)), 0, 1);
  const strat = clamp(Math.max(P[I_RAIN], P[I_SNOW]) * 0.85 + sstep(0.9, 1, cov) * 0.2 + P[I_FOG] * 0.4, 0, 1);
  const deck = sstep(0.25, 0.6, strat), conv = convection(cov);
  const top = skyBandTop(deck, conv);
  if (top !== BAND[1]) { BAND[1] = top; sizeClouds(); }
  // while a sheet zooms or is dragged, the sky is exactly what it was when the finger landed: nothing behind
  // the transition is re-traced (clouds, sky, blur chain all kept), the whole frame goes to the zoom
  const hold = EX.active && !EX.rest && !scrubbing && !CS.on;
  const skipSky = hold || (halfRate && (frameNo & 1) && cloudsOn && !scrubbing && !CS.on);
  const freeze = (EX.active && EX.prog > 0.35 && !scrubbing && !CS.on && cloudsOn) || skipSky;
  if (freeze) { /* history kept as it is */ }
  else if (cov > 0.008 && g.tex.shape) {
    cloudsOn = true;
    const j = (frameNo & 3) * 2, jx = JIT[j], jy = JIT[j + 1], f = g.u.clouds.f;
    const clear = CONFIG.sky.clearKm * (1 - 0.18 * cov) * (1 - deck), dk = clamp(P[I_DARK], 0, 1);
    v4(f, 0, R.fresh.w, R.fresh.h, jx, jy); v4(f, 4, BAND[0], BAND[1], clear, Math.max(0.5, clear * 0.3));
    v3(f, 8, CAMF); f[11] = frameNo & 1023; v3(f, 12, CAMU); v3(f, 16, CAMR); v4(f, 20, CTAN[0], CTAN[1], 0, 0);
    v3(f, 24, SUND); v3(f, 28, MOOND); v3(f, 32, LDIR); v3(f, 36, LGT);
    v4(f, 40, cov, strat, 0.85 + 0.7 * dk, conv); v4(f, 44, wX, wZ, wEv, wDet); f.set(FLD, 48);
    gpass(enc, R.fresh.v, P_.clouds, gbg('clouds' + fieldIdx, P_.clouds, [gub(g.u.clouds), gpuView(g.tex.shape), gpuView(g.tex.erosion), gpuView(g.tex.weather),
      R.field[fieldIdx].v, R.trans.v, R.skyS.v, R.skyM.v, g.sRep, g.sClamp]));
    const r = g.u.resolve.f;
    v4(r, 0, R.fresh.w, R.fresh.h, jx, jy);
    v4(r, 4, fillFrames > 0 ? 1 : 0, scrubbing || Math.abs(P[I_SCRUB] - T[I_SCRUB]) > 0.05 ? 0.4 : 0.11);
    gpass(enc, R.hist[1 - histIdx].v, P_.resolve, gbg('resolve' + histIdx, P_.resolve, [gub(g.u.resolve), R.fresh.v, R.hist[histIdx].v, g.sClamp]));
    histIdx = 1 - histIdx; if (fillFrames > 0) fillFrames--;
  } else if (cloudsOn) {
    cloudsOn = false;
    for (const h of R.hist) enc.beginRenderPass({ colorAttachments: [{ view: h.v, loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' }] }).end();
    fillFrames = 3;
  }
  frameNo++;
  // 4. rain drops on the glass
  if (dropsAlive > 0 || glassDirty) {
    const p = enc.beginRenderPass({ colorAttachments: [{ view: R.glass.v, loadOp: 'clear', clearValue: [0.5, 0.5, 0, 0], storeOp: 'store' }] });
    if (dropsAlive > 0 && g.tex.drop !== g.tex.black) {
      g.dev.queue.writeBuffer(g.drops, 0, DROP);
      v4(g.u.drop.f, 0, aspect, 0, 0, 0);
      p.setPipeline(P_.drop); p.setBindGroup(0, gbg('drop', P_.drop, [gub(g.u.drop), gpuView(g.tex.drop), g.sClamp]));
      p.setVertexBuffer(0, g.corner); p.setVertexBuffer(1, g.drops); p.draw(4, DN);
    }
    p.end();
    glassDirty = dropsAlive > 0;
  }
  // 5. sky → texture (behind a sheet at rest, every other frame) + 6. the material's blur
  const reuse = (EX.rest && !scrubbing && !CS.on && (frameNo & 1)) || skipSky;
  if (!reuse) {
    const f = g.u.sky.f;
    v4(f, 0, cw, ch, skyClock); v4(f, 4, BAND[0], BAND[1]);
    v3(f, 8, CAMF); v3(f, 12, CAMU); v3(f, 16, CAMR); v4(f, 20, CTAN[0], CTAN[1]);
    for (let c = 0; c < 3; c++) v3(f, 24 + c * 4, EQM.subarray(c * 3, c * 3 + 3));
    v3(f, 36, SUND); v3(f, 40, MOOND); v3(f, 44, MOONR); v3(f, 48, MOONU);
    v4(f, 52, sunVis, sunE); v4(f, 56, moonVis, A.moonFrac); v4(f, 60, moonLx, 0, moonLz);
    v4(f, 64, LGT[0], LGT[1], LGT[2], CONFIG.sky.exposure); v4(f, 68, NIGHT[0], NIGHT[1], NIGHT[2]);
    v4(f, 72, dHx, dHy, evX, evY);
    v4(f, 76, clamp(P[I_CL], 0, 1), clamp(P[I_CM], 0, 1), clamp(P[I_CH], 0, 1), clamp(P[I_DARK], 0, 1));
    v4(f, 80, clamp(P[I_RAIN], 0, 1), clamp(P[I_SNOW], 0, 1), clamp(P[I_FOG], 0, 1), clamp(P[I_STORM], 0, 1));
    v4(f, 84, clamp(P[I_WX] * 0.4, -0.55, 0.55), clamp(P[I_WX] * 0.15, -0.3, 0.3), P[I_WS], 0);
    v4(f, 88, flashX, flashY, flashI, boltOn); v4(f, 92, boltX, boltSeed);
    f.set(RIP, 96); f.set(WTS, 120);
    v4(f, 124, (calm ? 0 : tiltX) * 0.12, (calm ? 0 : -tiltY) * 0.07, camYaw + (calm ? 0 : tiltX) * 0.035);
    gpass(enc, R.sky.v, P_.sky, gbg('sky' + fieldIdx + histIdx, P_.sky, [gub(g.u.sky), gpuView(g.tex.noise), R.field[fieldIdx].v, R.hist[histIdx].v, R.glass.v,
      R.trans.v, R.skyS.v, R.skyM.v, g.sClamp, g.sRep]));
    let srcT = R.sky;
    for (let k = 0; k < 5; k++) {
      const dst = R.bdn[k], u = g.u.down[k];
      v4(u.f, 0, dst.w, dst.h, 1 / srcT.w, 1 / srcT.h);
      gpass(enc, dst.v, P_.down, gbg('down' + k, P_.down, [gub(u), srcT.v, g.sClamp])); srcT = dst;
    }
    for (let k = 0; k < 3; k++) {
      const dst = R.bup[k], u = g.u.up[k];
      v4(u.f, 0, dst.w, dst.h, 1 / srcT.w, 1 / srcT.h);
      gpass(enc, dst.v, P_.up, gbg('up' + k, P_.up, [gub(u), srcT.v, g.sClamp])); srcT = dst;
    }
  }
  // 7. widget material → screen
  const f = g.u.final.f;
  v4(f, 0, cw, ch, skyClock, UI_DIM); f.set(PRESS, 4); v4(f, 8, LIGHT_X, LIGHT_Y, bgBlur()); f.set(RECT, 12); f.set(RECTP, 52);
  gpass(enc, g.ctx.getCurrentTexture().createView(), P_.final, gbg('final', P_.final, [gub(g.u.final), R.sky.v, R.bup[2].v, g.sClamp]), [0, 0, 0, 1]);
  g.dev.queue.submit([enc.finish()]);
}
// one view per static texture, made once
function gpuView(t) { return t._v || (t._v = t.createView()); }

// Picks the renderer: WebGPU when it can be had, WebGL2 otherwise (and if neither, flat CSS panels)
async function startRenderer() {
  try {
    // never wait on WebGPU for long: if it isn't up in 4 s, start on WebGL2 instead
    gpuAbandoned = false;
    const ok = await Promise.race([initGPU(), new Promise(r => setTimeout(() => r('timeout'), 4000))]);
    if (ok === true) { gpuTimed = false; applyScale(); loadAssets(); return; }
    if (ok === 'timeout') { gpuAbandoned = true; console.warn('WebGPU did not start in 4 s — using WebGL2'); }
  } catch (e) {
    console.warn('WebGPU unavailable — using WebGL2:', e && e.message || e);
    if (gpu) { gpu.dev.destroy(); gpu = null; }
  }
  fallbackGL();
}
function fallbackGL() {
  // a canvas that once had a WebGPU context can't give a WebGL2 one: take a fresh one
  if (canvasHasGPU) { const c = canvas.cloneNode(false); canvas.replaceWith(c); canvas = c; canvasHasGPU = false; }
  try {
    initGL(); applyScale(); start();
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); stop(); });
    canvas.addEventListener('webglcontextrestored', () => { try { initGL(); applyScale(); start(); } catch (err) { } });
  } catch (e) { gl = null; document.body.classList.add('nogl'); console.error(e); }
}
let canvasHasGPU = false, gpuAbandoned = false;
