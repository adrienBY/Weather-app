/* =============================================================================
   Touching the sky: velocity splats into the force field + ripples
   ============================================================================= */
let taps = [0, 0, 0];
const tch = { x: 0, y: 0, t: 0, sx: 0, sy: 0, on: false };
function spawnRipple(cx, cy, amp) {
  const o = ripHead * 4; ripHead = (ripHead + 1) % 6;
  RIP[o] = (cx / cssW - 0.5) * (cssW / cssH); RIP[o + 1] = 1 - cy / cssH; RIP[o + 2] = 0; RIP[o + 3] = amp * (calm ? 0.4 : 1);
}
function addSplat(u, v, du, dv) {
  const i = splatN < 4 ? splatN++ : 3, o = i * 4;
  SPL[o] = u; SPL[o + 1] = v;
  SPL[o + 2] = clamp(SPL[o + 2] + du, -0.4, 0.4); SPL[o + 3] = clamp(SPL[o + 3] + dv, -0.4, 0.4);
  fieldEnergy += Math.abs(du) + Math.abs(dv);
}
function skyDown(x, y, ts) {
  tch.on = true;
  taps[0] = taps[1]; taps[1] = taps[2]; taps[2] = ts;
  if (taps[2] - taps[0] < 550) { toggleDebug(); taps[0] = taps[1] = taps[2] = 0; }
  tch.x = tch.sx = x; tch.y = tch.sy = y; tch.t = ts;
  spawnRipple(x, y, 1);
}
function skyMove(x, y, ts) {
  const dtE = Math.max((ts - tch.t) / 1000, 1 / 240);
  addSplat(x / cssW, 1 - y / cssH, (x - tch.x) / cssW / dtE * 0.03, -(y - tch.y) / cssH / dtE * 0.03);
  tch.x = x; tch.y = y; tch.t = ts;
  if (Math.hypot(x - tch.sx, y - tch.sy) > 46) { spawnRipple(x, y, 0.45 + 0.4 * P[I_RAIN]); tch.sx = x; tch.sy = y; }
}
let tiltOn = false, b0 = null, g0 = null;
function onOrient(e) {
  if (e.beta == null) return;
  if (b0 === null) { b0 = e.beta; g0 = e.gamma; }
  b0 += (e.beta - b0) * 0.004; g0 += (e.gamma - g0) * 0.004;
  tiltTX = clamp((e.gamma - g0) / 25, -1, 1); tiltTY = clamp((e.beta - b0) / 25, -1, 1);
}
function enableTilt() {
  if (tiltOn || !window.DeviceOrientationEvent) return;
  const D = window.DeviceOrientationEvent;
  if (typeof D.requestPermission === 'function') {
    D.requestPermission().then(s => { if (s === 'granted' && !tiltOn) { tiltOn = true; addEventListener('deviceorientation', onOrient); } }).catch(() => { });
  } else { tiltOn = true; addEventListener('deviceorientation', onOrient); }
}

/* =============================================================================
   Formatting
   ============================================================================= */
let units = store.get('ciel:units') || CONFIG.units;
const fT = c => Math.round(units === 'F' ? c * 1.8 + 32 : c);
const fW = k => CONFIG.windUnit === 'mph' ? [Math.round(k * 0.621371), 'mph'] : CONFIG.windUnit === 'ms' ? [Math.round(k / 3.6), 'm/s'] : [Math.round(k), 'km/h'];
const hourStart = t => Math.floor((t + TZOFF) / 3600) * 3600 - TZOFF;
const fmt = (f, t) => f ? f.format(new Date(t * 1000)) : '';
const dayName = t => cap(fmt(fmtDay, t)).replace('.', '') + (LANG === 'fr' ? '.' : '');
const TSTOPS = [[-10, [120, 150, 255]], [0, [110, 190, 255]], [8, [100, 220, 200]], [14, [140, 225, 110]], [20, [240, 215, 80]], [26, [255, 160, 70]], [34, [255, 90, 80]]];
function tColor(c) {
  if (c <= TSTOPS[0][0]) return 'rgb(' + TSTOPS[0][1] + ')';
  for (let i = 1; i < TSTOPS.length; i++) if (c <= TSTOPS[i][0]) {
    const [t0, a] = TSTOPS[i - 1], [t1, b] = TSTOPS[i], k = (c - t0) / (t1 - t0);
    return 'rgb(' + a.map((v, j) => Math.round(lerp(v, b[j], k))).join(',') + ')';
  }
  return 'rgb(' + TSTOPS[TSTOPS.length - 1][1] + ')';
}
const uvLevel = uv => uv < 3 ? 0 : uv < 6 ? 1 : uv < 8 ? 2 : uv < 11 ? 3 : 4;
const UV_COL = ['#7ee08a', '#ffd25e', '#ff9a4c', '#ff5a5a', '#c77dff'];
const AQI_COL = ['#50f0e6', '#50ccaa', '#f0e641', '#ff5050', '#c4314b', '#9a3fb0'];
const aqiLevel = v => v < 20 ? 0 : v < 40 ? 1 : v < 60 ? 2 : v < 80 ? 3 : v < 100 ? 4 : 5;
function makeFormatters() {
  const tz = DATA && DATA.timezone;
  const mk = o => { try { return new Intl.DateTimeFormat(LANG, tz ? Object.assign({ timeZone: tz }, o) : o); } catch (e) { return new Intl.DateTimeFormat(LANG, o); } };
  fmtHour = mk({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  fmtDay = mk({ weekday: 'short' });
  fmtDate = mk({ year: 'numeric', month: '2-digit', day: '2-digit' });
  fmtDM = mk({ day: '2-digit', month: '2-digit' });
  fmtLong = mk({ weekday: 'long', day: 'numeric', month: 'long' });
  fmtClock = new Intl.DateTimeFormat(LANG, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}
function dayIndex(t) {
  if (!DATA) return -1;
  const dt = DATA.daily.time;
  for (let i = dt.length - 1; i >= 0; i--) if (t >= toUnix(dt[i], TZOFF)) return i;
  return 0;
}

/* =============================================================================
   Page scroll — our own physics so the HTML and the GL glass move in the same
   frame. Follows the platform feel: 1:1 tracking with a grab offset, rubber-
   banding past the ends, momentum with iOS's 0.998/ms deceleration, a spring
   back at the edges, and it can be grabbed mid-flight at any moment.
   ============================================================================= */
const vp = $('viewport'), content = $('content'), heroEl = $('hero'), bar = $('bar');
const SC = { y: 0, v: 0, max: 0, mode: 0, bound: 0, id: -1, lastMove: 0, sx: 0, sy: 0, start: 0, axis: 0, ht: new Float64Array(8), hy: new Float64Array(8), hn: 0 };
const SCR = new Float32Array(1);
let suppressClick = false, heroH = 600, heroShift = 0, heroAlpha = 1, contentH = 0;
const RB = 0.55;
const rubber = (o, d) => (o * d * RB) / (d + RB * Math.abs(o));
const unrubber = (r, d) => (r * d) / (RB * (d - Math.abs(r)));
function scrollFromRaw(raw) { return raw < 0 ? -rubber(-raw, cssH) : raw > SC.max ? SC.max + rubber(raw - SC.max, cssH) : raw; }
function rawFromScroll(y) { return y < 0 ? -unrubber(Math.min(-y, cssH * 0.9), cssH) : y > SC.max ? SC.max + unrubber(Math.min(y - SC.max, cssH * 0.9), cssH) : y; }
function histPush(t, y) {
  if (SC.hn === 8) { SC.ht.copyWithin(0, 1); SC.hy.copyWithin(0, 1); SC.hn = 7; }
  SC.ht[SC.hn] = t; SC.hy[SC.hn] = y; SC.hn++;
}
function releaseVelocity(now) {   // px/s over the last ~90 ms of samples
  if (SC.hn < 2) return 0;
  const tEnd = SC.ht[SC.hn - 1];
  if (now - tEnd > 90) return 0;
  let i = SC.hn - 1;
  while (i > 0 && tEnd - SC.ht[i - 1] < 90) i--;
  const dt = (tEnd - SC.ht[i]) / 1000;
  return dt > 0.004 ? (SC.hy[SC.hn - 1] - SC.hy[i]) / dt : 0;
}
let pressW = null, pressX = 0, pressY = 0;
function releasePress() { if (pressW) pressW.pressT = 0; MF.down = false; }
vp.addEventListener('pointerdown', e => {
  if (EX.active) return;
  markInteraction(); enableTilt();
  SC.id = e.pointerId; SC.sx = e.clientX; SC.sy = e.clientY; SC.axis = 0; SC.lastMove = performance.now(); suppressClick = false;
  SC.start = rawFromScroll(SC.y);                       // continue from what's on screen
  let caught = false;
  if (SC.mode === 2 || SC.mode === 3) { caught = Math.abs(SC.v) > 60; SC.mode = 0; SC.v = 0; }   // catch it mid-flight
  if (caught) suppressClick = true;                    // like iOS: the tap that stops a fling doesn't also open a card
  SC.hn = 0; histPush(e.timeStamp, e.clientY);
  const wEl = caught ? null : e.target.closest('.w');
  pressW = wEl ? WG.find(w => w.el === wEl) || null : null;
  if (pressW && !e.target.closest('#hscroll')) { pressW.pressT = 1; pressX = e.clientX; pressY = e.clientY; } else pressW = null;
  tch.on = false;
  if (!e.target.closest('.w,button,a')) skyDown(e.clientX, e.clientY, e.timeStamp);
});
vp.addEventListener('pointermove', e => {
  if (e.pointerId !== SC.id) return;
  markInteraction();
  const dx = e.clientX - SC.sx, dy = e.clientY - SC.sy;
  if (!SC.axis) {
    if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx) * 1.1) {
      SC.axis = 1; SC.mode = 1; releasePress();
      try { vp.setPointerCapture(e.pointerId); } catch (err) { }
    } else if (Math.abs(dx) > 8) { SC.axis = 2; releasePress(); }
  }
  if (SC.axis === 1) { SC.y = scrollFromRaw(SC.start - dy); histPush(e.timeStamp, e.clientY); SC.lastMove = performance.now(); }
  if (tch.on) skyMove(e.clientX, e.clientY, e.timeStamp);
  if (pressW) { pressX = e.clientX; pressY = e.clientY; }
});
function endPointer(e) {
  if (e.pointerId !== SC.id) return;
  SC.id = -1; tch.on = false; releasePress();
  if (SC.axis === 1) {
    suppressClick = true;
    SC.v = -releaseVelocity(e.timeStamp);
    if (SC.y < 0 || SC.y > SC.max) { SC.mode = 3; SC.bound = SC.y < 0 ? 0 : SC.max; }
    else SC.mode = 2;
  }
}
vp.addEventListener('pointerup', endPointer);
vp.addEventListener('pointercancel', endPointer);
vp.addEventListener('click', e => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; } }, true);
vp.addEventListener('wheel', e => { markInteraction(); SC.mode = 0; SC.v = 0; SC.y = clamp(SC.y + e.deltaY, 0, SC.max); }, { passive: true });
function scrollUpdate(dt) {
  if (SC.mode === 2) {
    SC.v *= Math.pow(0.998, dt * 1000);
    SC.y += SC.v * dt;
    if (SC.y < 0 || SC.y > SC.max) { SC.mode = 3; SC.bound = SC.y < 0 ? 0 : SC.max; }
    else if (Math.abs(SC.v) < 6) { SC.mode = 0; SC.v = 0; }
  } else if (SC.mode === 3) {
    SC.v = springTo(SC.y, SC.v, SC.bound, 0.42, 1, dt, SCR, 0); SC.y = SCR[0];
    if (Math.abs(SC.y - SC.bound) < 0.3 && Math.abs(SC.v) < 4) { SC.y = SC.bound; SC.v = 0; SC.mode = 0; }
  } else if (SC.mode === 0 && (SC.y > SC.max || SC.y < 0)) { SC.mode = 3; SC.bound = SC.y < 0 ? 0 : SC.max; }
}

/* =============================================================================
   Widgets — each .w element is a material slot in final.frag. Layout is measured
   when it changes (never per frame); per frame we only offset by the scroll.
   ============================================================================= */
const WG = [];
let LIGHT_X = -0.45, LIGHT_Y = 0.89, UI_DIM = 0, PUSH = 1;
const SHEET_SLOT = 9;
function registerWidgets() {
  WG.length = 0;
  document.querySelectorAll('.w').forEach((el, i) => {
    const key = el.dataset.w;
    WG.push({ el, key, slot: i, x: 0, y: 0, w: 0, h: 0, r: 24, vis: false, inHero: !!el.closest('#hero'),
      press: 0, pressV: 0, pressT: 0, seed: (i * 0.1379 + 0.21) % 1, thick: el.classList.contains('card') ? 0.2 : el.classList.contains('pill') ? 0.04 : 0.12, lastS: -1 });
    el.addEventListener('click', e => {
      if (e.target.closest('#hscroll') && key === 'hours') return;
      openDetail(WG[i]);
    });
  });
}
function measureWidgets() {
  for (const w of WG) {
    let x = 0, y = 0, n = w.el;
    while (n && n !== content) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    w.x = x; w.y = y; w.w = w.el.offsetWidth; w.h = w.el.offsetHeight; w.vis = w.w > 0 && w.h > 0;
    w.r = w.el.classList.contains('pill') ? w.h / 2 : (parseFloat(getComputedStyle(w.el).borderTopLeftRadius) || 24);
  }
  heroH = heroEl.offsetHeight || 600;
  contentH = content.offsetHeight;
  SC.max = Math.max(0, contentH - cssH);
  if (MF.items.length) measureMorph();
}
let lastCT = '', lastHT = '', lastHO = '', lastBar = '';
function uiUpdate(dt) {
  scrollUpdate(dt);
  expandUpdate(dt);
  chartUpdate(dt);
  // press: the material flexes and glows under the finger
  let pressAmt = 0, pressSlot = -1;
  for (const w of WG) {
    if (w.press !== w.pressT || Math.abs(w.pressV) > 1e-3) {
      // asymmetric: the press lands instantly and without overshoot (feedback on
      // touch-down); the release is the material springing back, a touch of bounce
      const down = w.pressT > w.press;
      w.pressV = springTo(w.press, w.pressV, w.pressT, down ? 0.09 : 0.26, down ? 1 : 0.72, dt, SCR, 0); w.press = SCR[0];
      if (Math.abs(w.press - w.pressT) < 1e-3 && Math.abs(w.pressV) < 1e-3) { w.press = w.pressT; w.pressV = 0; }
    }
    const s = 1 - 0.03 * w.press;
    if (EX.w !== w && Math.abs(s - w.lastS) > 1e-4) { w.el.style.transform = 'scale(' + s.toFixed(4) + ')'; w.lastS = s; }   // (the zooming widget's transform belongs to the transition)
    if (w.press > pressAmt) { pressAmt = w.press; pressSlot = w.slot; }
  }
  // hero parallax, compact title, page push-back while a sheet is open
  const y = SC.y;
  heroShift = y > 0 ? y * 0.32 : 0;
  const p = clamp(y / (heroH * 0.65), 0, 1);
  morphTick(dt, y);
  // the rest of the hero (high/low, pills) leaves with the collapse, or with the scroll
  heroAlpha = Math.min(clamp(1 - p * 1.15, 0, 1), 1 - sstep(0, 0.55, MF.p));
  const ht = 'translate3d(0,' + heroShift.toFixed(1) + 'px,0)', ho = heroAlpha.toFixed(3);
  if (ht !== lastHT) { heroEl.style.transform = ht; lastHT = ht; }
  if (ho !== lastHO) { heroEl.style.opacity = ho; heroEl.style.pointerEvents = heroAlpha < 0.05 ? 'none' : ''; lastHO = ho; }
  const bv = sstep(0.55, 0.95, p).toFixed(3);
  if (bv !== lastBar) { bar.style.setProperty('--bar', bv); lastBar = bv; }
  const s = PUSH, cx = cssW / 2, cy = cssH / 2;
  const ct = 'translate3d(' + ((1 - s) * cx).toFixed(2) + 'px,' + (-s * y + (1 - s) * cy).toFixed(2) + 'px,0) scale(' + s.toFixed(4) + ')';
  const ck = ct + UI_DIM.toFixed(3);
  if (ck !== lastCT) {
    // The glass is composed in WebGL *under* the DOM, so it cannot blur page
    // text. Instead the page recedes (scale + fade) as the sheet grows over it.
    const fade = (1 - sstep(0, 0.5, UI_DIM)).toFixed(3);
    content.style.transform = ct; content.style.opacity = fade; bar.style.opacity = fade; lastCT = ck;
  }
  morphUpdate(dt, y, s, 1 - sstep(0, 0.5, UI_DIM));
  // glass slots
  const kx = cw / cssW, ky = ch / cssH;
  for (let i = 0; i < SHEET_SLOT; i++) {
    const o = i * 4, w = WG[i];
    if (!w || !w.vis || !CONFIG.glassWidgets) { RECTP[o + 1] = 0; continue; }
    const ps = 1 - 0.03 * w.press;
    let ww = w.w * ps, hh = w.h * ps;
    let x = w.x + (w.w - ww) / 2, yy = w.y - y + (w.inHero ? heroShift : 0) + (w.h - hh) / 2;
    x = (1 - s) * cx + s * x; yy = (1 - s) * cy + s * yy; ww *= s; hh *= s;
    // while it zooms, the widget's own glass is off: the sheet slot is drawn with exactly
    // its material at rest, so the swap at either end of the transition is invisible
    let m = (w.inHero ? heroAlpha : 1) * (EX.w === w ? 0 : 1);
    if (yy + hh < -30 || yy > cssH + 30) m = 0;
    RECT[o] = (x + ww / 2) * kx; RECT[o + 1] = ch - (yy + hh / 2) * ky; RECT[o + 2] = ww / 2 * kx; RECT[o + 3] = hh / 2 * ky;
    RECTP[o] = w.r * ps * s * kx; RECTP[o + 1] = m; RECTP[o + 2] = w.thick; RECTP[o + 3] = w.seed;
  }
  {
    const o = SHEET_SLOT * 4, e = EX.s;
    if (EX.active) {
      RECT[o] = (e[0] + e[2] / 2) * kx; RECT[o + 1] = ch - (e[1] + e[3] / 2) * ky; RECT[o + 2] = e[2] / 2 * kx; RECT[o + 3] = e[3] / 2 * ky;
      RECTP[o] = e[4] * kx; RECTP[o + 1] = EX.fade; RECTP[o + 2] = lerp(EX.w ? EX.w.thick : 0.2, 1, clamp(EX.prog, 0, 1)); RECTP[o + 3] = 0.77;
    } else RECTP[o + 1] = 0;
  }
  PRESS[0] = pressX * kx; PRESS[1] = ch - pressY * ky; PRESS[2] = pressAmt; PRESS[3] = pressSlot;
  // highlight direction follows device tilt (the light "moves" across the glass)
  const lx = -0.45 + tiltX * 0.55, ly = 0.89 - tiltY * 0.35, ll = Math.hypot(lx, ly) || 1;
  LIGHT_X = lx / ll; LIGHT_Y = ly / ll;
}
function uiBusy() { return SC.mode !== 0 || EX.active || CS.on || (pressW && pressW.press > 0.001); }

/* =============================================================================
   Shared-element morphs ("matched geometry"). When the same information is
   shown in two places, it travels from one to the other instead of fading out
   here and in there:
     • scrolling: the hero's city, temperature and condition fly up into the
       compact title of the top bar (and back down)
     • opening a widget: its title and its main value fly into the sheet's
       title and big number (and back on the way out)
   Both copies follow one interpolated rectangle — left edge, vertical centre,
   scale (geometric) — and cross-fade on the way, so a light 170 px numeral can
   become a 17 px semibold one without a pop. Everything is scroll- or spring-
   driven: it tracks the finger, reverses, and can be grabbed mid-way.
   ============================================================================= */
const MF = { layer: null, items: [], key: '', lk: '', down: false, downIt: null, dv: 0, p: 0, v: 0, tgt: 0, lastY: 0 };
// The hero ⇄ title-bar morph is a little state machine on its own clock, not scroll-linked:
// any scroll down starts the collapse and it plays through to the end even if the page
// stops; scrolling back up near the top expands it again. The only thing that pauses it
// is a finger held still on the screen — it waits there, and carries on when the finger
// moves or lifts. Past the hero it is always collapsed, at the very top always expanded.
function morphTick(dt, y) {
  const dy = y - MF.lastY; MF.lastY = y;
  if (y <= 0.5) MF.tgt = 0;
  else if (y >= heroH * 0.5) MF.tgt = 1;
  else if (dy > 0.3) MF.tgt = 1;
  else if (dy < -0.3 && y < heroH * 0.3) MF.tgt = 0;
  const held = SC.id !== -1 && SC.axis !== 2 && performance.now() - SC.lastMove > 70;
  if (held) { MF.v = 0; return; }
  if (MF.p === MF.tgt && MF.v === 0) return;
  MF.v = springTo(MF.p, MF.v, MF.tgt, calm ? 0.3 : 0.55, 1, dt, SCR, 0); MF.p = SCR[0];
  if (Math.abs(MF.p - MF.tgt) < 1e-3 && Math.abs(MF.v) < 1e-3) { MF.p = MF.tgt; MF.v = 0; }
}
function setupMorph() {
  const layer = document.createElement('div'); layer.id = 'morph'; layer.setAttribute('aria-hidden', 'true');
  document.body.insertBefore(layer, bar);
  const mini = $('mini'); mini.textContent = '';
  const mk = (src, cls) => {
    const c = document.createElement('div'); c.className = 'mf ' + cls; layer.append(c);
    const d = document.createElement('span'); d.className = cls; mini.append(d);
    return { src, clone: c, dst: d, sx: 0, sy: 0, cw: 0, ch: 0, dx: 0, dy: 0, dh: 0, k: 1, ft: '', fo: '', tt: '', to: '' };
  };
  // the originals stay in the page, invisible: they hold the layout and still take the taps
  MF.items = [mk($('cityName'), 'n'), mk($('temp'), 't'), mk($('cond'), 'c')];
  MF.layer = layer;
  setHTML(MF.items[1].clone, '--<i>°</i>');
  document.body.classList.add('mf-on');
  $('city').addEventListener('pointerdown', () => { MF.down = true; MF.downIt = MF.items[0]; });
  $('temp').addEventListener('pointerdown', () => { MF.down = true; MF.downIt = MF.items[1]; });
  addEventListener('pointerup', () => { MF.down = false; });
  addEventListener('pointercancel', () => { MF.down = false; });
}
function heroText(i, t, html) {
  const it = MF.items[i]; if (!it) return;
  if (html) setHTML(it.clone, html); else setText(it.clone, t);
  setText(it.dst, t);
}
function measureMorph() {
  for (const it of MF.items) {
    let x = 0, y = 0, n = it.src;
    while (n && n !== content) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    it.sx = x; it.sy = y;                                     // where the original sits at rest (screen, unscrolled)
    it.cw = it.clone.offsetWidth; it.ch = it.clone.offsetHeight;
    it.dx = it.dst.offsetLeft; it.dy = it.dst.offsetTop; it.dh = it.dst.offsetHeight;   // the bar is fixed at 0,0
    it.k = (parseFloat(getComputedStyle(it.dst).fontSize) || 17) / (parseFloat(getComputedStyle(it.clone).fontSize) || 17);
    it.ft = it.tt = '';
  }
}
function morphUpdate(dt, y, s, fade) {
  if (!MF.layer) return;
  // the flying copies recede with the page when a sheet opens over it
  const lk = s.toFixed(4) + fade.toFixed(3);
  if (lk !== MF.lk) {
    MF.layer.style.transform = s === 1 ? '' : 'translate(' + ((1 - s) * cssW / 2).toFixed(2) + 'px,' + ((1 - s) * cssH / 2).toFixed(2) + 'px) scale(' + s.toFixed(4) + ')';
    MF.layer.style.opacity = fade < 1 ? fade.toFixed(3) : ''; MF.lk = lk;
  }
  // press feedback for the city and the temperature (their originals are invisible hit targets)
  MF.dv += ((MF.down ? 1 : 0) - MF.dv) * (1 - Math.exp(-dt * (MF.down ? 45 : 16)));
  if (!MF.down && MF.dv < 0.002) { MF.dv = 0; MF.downIt = null; }
  const ny = y - heroShift, e = clamp(MF.p, 0, 1);       // how far the page has carried the hero; the morph's progress
  for (const it of MF.items) {
    const scy = it.sy + it.ch / 2, dcy = it.dy + it.dh / 2;
    let fx, fy, fs, tx = 0, ty = 0, ts = 1;
    if (calm) {        // reduced motion: no flight — the copy stays with the page and cross-fades
      fx = it.sx; fy = it.sy - ny; fs = 1;
    } else {
      // expanded, the copy rides with the page; collapsing, it leaves from wherever it is
      const rx = lerp(it.sx, it.dx, e), rcy = lerp(scy - ny, dcy, e);
      fs = Math.pow(it.k, e); ts = fs / it.k;
      fx = rx; fy = rcy - fs * it.ch / 2;
      tx = rx - it.dx; ty = rcy - ts * it.dh / 2 - it.dy;
    }
    let fo = 1 - sstep(0.35, 0.65, e);
    if (MF.downIt === it && MF.dv > 0) { const q = 1 - 0.03 * MF.dv; fx += (1 - q) * fs * it.cw / 2; fy += (1 - q) * fs * it.ch / 2; fs *= q; fo *= 1 - 0.18 * MF.dv; }
    const ft = 'translate(' + fx.toFixed(2) + 'px,' + fy.toFixed(2) + 'px) scale(' + fs.toFixed(4) + ')', fos = fo.toFixed(3);
    const tt = calm ? '' : 'translate(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px) scale(' + ts.toFixed(4) + ')', tos = sstep(0.35, 0.65, e).toFixed(3);
    if (ft !== it.ft) { it.clone.style.transform = ft; it.ft = ft; }
    if (fos !== it.fo) { it.clone.style.opacity = fos; it.fo = fos; }
    if (tt !== it.tt) { it.dst.style.transform = tt; it.tt = tt; }
    if (tos !== it.to) { it.dst.style.opacity = tos; it.to = tos; }
  }
}
// widget ↔ sheet: pairs of (element in the widget, element in the sheet), measured in each
// one's own layout (both containers are uniform zooms anchored at the moving rectangle)
const SMP = [];
function sheetPairs(w) {
  for (const q of SMP) q.b.style.transform = '';
  SMP.length = 0;
  if (calm || !activePane || !w) return;
  const fz = el => parseFloat(getComputedStyle(el).fontSize) || 16;
  const pair = (qa, fa, b, fb, bx, by) => {
    const a = w.el.querySelector(qa); if (!a || !b) return;
    SMP.push({ qa, b, ax: a.offsetLeft, ay: a.offsetTop, ah: a.offsetHeight, bx, by, bh: b.offsetHeight, k: fz(fb) / fz((fa && a.querySelector(fa)) || a) });
  };
  const dt = dh.querySelector('.dtitle');
  pair('.wh', 'span', dt, $('dTitle'), dh.offsetLeft + dt.offsetLeft, dh.offsetTop + dt.offsetTop);
  const big = activePane.el.querySelector('.big');
  if (big) {
    const by = db.offsetTop + activePane.el.offsetTop + big.offsetTop - db.scrollTop;
    if (by + big.offsetHeight > db.offsetTop) pair('.v', null, big, big.querySelector('b') || big, db.offsetLeft + activePane.el.offsetLeft + big.offsetLeft, by);
  }
}
function sheetPairsUpdate(p) {
  if (!SMP.length) return;
  const w = EX.w, s = EX.s, Zw = s[2] / w.w, Zs = s[2] / EX.dst[2];
  for (const q of SMP) {
    // where each copy is right now (on screen), and the rectangle they share at progress p
    const al = s[0] + q.ax * Zw, acy = s[1] + (q.ay + q.ah / 2) * Zw;
    const bl = s[0] + q.bx * Zs, bcy = s[1] + (q.by + q.bh / 2) * Zs;
    const rl = lerp(al, bl, p), rcy = lerp(acy, bcy, p);
    const sa = Math.pow(Zw, 1 - p) * Math.pow(Zs * q.k, p), sb = sa / q.k;
    const a = w.el.querySelector(q.qa);
    if (a) a.style.transform = 'translate(' + ((rl - al) / Zw).toFixed(2) + 'px,' + ((rcy - sa * q.ah / 2 - s[1]) / Zw - q.ay).toFixed(2) + 'px) scale(' + (sa / Zw).toFixed(4) + ')';
    q.b.style.transform = 'translate(' + ((rl - bl) / Zs).toFixed(2) + 'px,' + ((rcy - sb * q.bh / 2 - s[1]) / Zs - q.by).toFixed(2) + 'px) scale(' + (sb / Zs).toFixed(4) + ')';
  }
}

/* =============================================================================
   Expanding a widget — a zoom transition: the sheet is laid out once at full
   size, then scaled + clipped (transforms only) so it grows out of the tapped
   widget, while its material rectangle (slot 9) follows the same springs in
   the same frame. The page pushes back and dims. Interruptible; dragged down
   it dismisses with velocity hand-off (Apple's projection decides).
   ============================================================================= */
const EX = { active: false, open: false, w: null, s: new Float32Array(5), v: new Float32Array(5), t: new Float32Array(5),
  src: new Float32Array(5), dst: new Float32Array(5), prog: 0, hide: 0, resp: 0.5, zeta: 0.86, drag: false, dy0: 0, dyl: 0, fade: 1, lastF: '',
  ht: new Float64Array(8), hy: new Float64Array(8), hn: 0, lastT: '', fresh: 0, rest: false };
// sheet springs (response s, damping ratio): open and close are critically damped
// or nearly so — the zoom lands without wobble; a throw back up keeps a little life
const SP_OPEN = [0.40, 0.9], SP_CLOSE = [0.36, 0.96], SP_BACK = [0.32, 0.82];
const detail = $('detail'), dp = $('dp'), dpi = $('dpi'), dh = $('dh'), db = $('db');
let safeT = 0, safeB = 0, safeL = 0, safeR = 0;
function measureSafe() {
  const cs = getComputedStyle(document.documentElement);
  const px = v => parseFloat(cs.getPropertyValue(v)) || 0;
  const sp = $('safe'); safeT = sp.offsetHeight || 0; safeB = parseFloat(getComputedStyle(sp).paddingBottom) || 0;
  safeL = px('--sal'); safeR = px('--sar');
}
// the widget as it is on screen right now, including the press scale (so the zoom
// starts exactly where the pressed card is — no jump on the first frame)
function widgetScreenRect(w, out) {
  const ps = 1 - 0.03 * w.press;
  out[2] = w.w * ps; out[3] = w.h * ps; out[4] = w.r * ps;
  out[0] = w.x + (w.w - out[2]) / 2; out[1] = w.y - SC.y + (w.inHero ? heroShift : 0) + (w.h - out[3]) / 2;
}
function openDetail(w) {
  if (EX.open || !DATA || (EX.active && EX.w !== w)) return;
  const p = buildPane(w.key);            // normally already built and laid out in memory: nothing to do
  if (!p) return;
  markInteraction();
  setText($('dTitle'), p.title);
  setHTML($('dIcon'), '<use href="#i-' + p.icon + '"/>');
  if (activePane !== p) { if (activePane) activePane.el.classList.remove('on'); p.el.classList.add('on'); activePane = p; }
  db.scrollTop = 0;
  CS.c = null;
  if (p.chart && CH[p.chart]) chartBind(p.chart, clamp(heroCol, 0, nCols - 1));
  const dst = EX.dst;
  dst[0] = 8 + safeL; dst[1] = safeT + 8; dst[2] = cssW - 16 - safeL - safeR; dst[3] = cssH - dst[1] - 8; dst[4] = 34;
  dp.style.left = dst[0] + 'px'; dp.style.top = dst[1] + 'px'; dp.style.width = dst[2] + 'px'; dp.style.height = dst[3] + 'px';
  widgetScreenRect(w, EX.src);
  if (!EX.active) { EX.s.set(calm ? dst : EX.src); EX.v.fill(0); EX.fade = calm ? 0 : 1; }
  EX.t.set(dst); EX.w = w; EX.open = true; EX.active = true; EX.resp = SP_OPEN[0]; EX.zeta = SP_OPEN[1];
  EX.lastT = ''; EX.fresh = 2;           // if the sheet had to be built now, that frame is long: don't let the springs jump over it
  EX.w.el.style.transformOrigin = '0 0';
  syncTouchAction();
  void dp.offsetHeight;                  // lay it out now, in the tap, not in the first animated frame
  sheetPairs(w);
  expandUpdate(0);                       // and write frame 0 now, so nothing shows a stale state
  detail.classList.add('on', 'live'); detail.setAttribute('aria-hidden', 'false');
  try { history.pushState({ ciel: 'detail' }, ''); } catch (e) { }
}
function closeDetail(fromPop) {
  if (!EX.open) return;
  EX.open = false; EX.drag = false;
  widgetScreenRect(EX.w, EX.src);
  EX.t.set(calm ? EX.dst : EX.src); EX.resp = SP_CLOSE[0]; EX.zeta = SP_CLOSE[1];   // reduced motion: stay put and cross-fade
  sheetPairs(EX.w);                      // the sheet may have been scrolled: measure again
  detail.classList.remove('live'); detail.setAttribute('aria-hidden', 'true');
  if (!fromPop && history.state && history.state.ciel) { try { history.back(); } catch (e) { } }
}
addEventListener('popstate', () => closeDetail(true));
$('dClose').addEventListener('click', () => closeDetail(false));
function expandUpdate(dt) {
  if (!EX.active) return;
  const s = EX.s, v = EX.v, t = EX.t, src = EX.src, dst = EX.dst;
  if (EX.fresh) { dt = Math.min(dt, 1 / 120); EX.fresh--; }
  if (!EX.drag) for (let i = 0; i < 5; i++) v[i] = springTo(s[i], v[i], t[i], EX.resp, EX.zeta, dt, s, i);
  // progress from the summed growth of both sides: a full-width card barely grows
  // in width, so a per-axis average would read a small pull-down as "closed"
  EX.prog = clamp((s[2] - src[2] + s[3] - src[3]) / Math.max(1, dst[2] - src[2] + dst[3] - src[3]), 0, 1.05);
  // reduced motion: no zoom, no push-back — a 200 ms cross-fade carries the change
  EX.fade = calm ? clamp(EX.fade + (EX.open ? dt : -dt) / 0.2, 0, 1) : 1;
  const p = clamp(EX.prog, 0, 1) * EX.fade;
  EX.hide = sstep(0, 0.22, p);
  PUSH = 1 - (calm ? 0 : 0.06 * p); UI_DIM = p;
  const fo = EX.fade.toFixed(3);
  if (fo !== EX.lastF) { dp.style.opacity = fo === '1.000' ? '' : fo; EX.lastF = fo; }
  // transform-only zoom (compositor, no repaint): the clip box scales non-uniformly
  // to the moving rectangle, the content inside counter-scales to a uniform zoom
  const sx = Math.max(0.02, s[2] / dst[2]), sy = Math.max(0.02, s[3] / dst[3]);
  const tf = 'translate3d(' + (s[0] - dst[0]).toFixed(2) + 'px,' + (s[1] - dst[1]).toFixed(2) + 'px,0) scale(' + sx.toFixed(5) + ',' + sy.toFixed(5) + ')';
  const key = tf + p.toFixed(3);                       // p carries the reduced-motion fade too
  if (key !== EX.lastT) {
    dp.style.transform = tf;
    dpi.style.transform = 'scale(1,' + (sx / sy).toFixed(5) + ')';
    dp.style.borderRadius = (s[4] / sx).toFixed(1) + 'px/' + (s[4] / sy).toFixed(1) + 'px';
    // the sheet's own content fades in as it grows; what it shares with the widget (title,
    // main value) does not fade in from nowhere: it flies from the widget (sheetPairsUpdate)
    const co = sstep(0.15, 0.6, p).toFixed(3), bo = sstep(0, 0.25, p).toFixed(3);
    for (const c of dh.children) c.style.opacity = SMP.some(q => q.b === c) ? bo : co;
    if (activePane) for (const c of activePane.el.children) c.style.opacity = SMP.some(q => q.b === c) ? bo : co;
    sheetPairsUpdate(p);
    // the widget's own content rides inside the moving glass (FLIP: a transform from its
    // layout box to the rectangle on screen), so on the way back it lands with the glass
    // instead of popping in at its final place while the glass is still flying
    const w = EX.w, ps = PUSH, ccx = cssW / 2, ccy = cssH / 2;
    const bx = (1 - ps) * ccx + ps * w.x, by = (1 - ps) * ccy + ps * (w.y - SC.y + (w.inHero ? heroShift : 0)), bw = ps * w.w;
    w.el.style.transform = 'translate3d(' + ((s[0] - bx) / ps).toFixed(2) + 'px,' + ((s[1] - by) / ps).toFixed(2) + 'px,0) scale(' + (s[2] / bw).toFixed(5) + ')';
    w.el.style.opacity = (1 - sstep(0, 0.2, p)).toFixed(3);
    EX.lastT = key;
  }
  let still = !EX.drag;
  for (let i = 0; i < 5 && still; i++) if (Math.abs(v[i]) > 1 || Math.abs(s[i] - t[i]) > 0.5) still = false;
  EX.rest = EX.open && still;
  if (!EX.open) {
    let done = true;
    for (let i = 0; i < 5; i++) if (Math.abs(s[i] - t[i]) > 0.5 || Math.abs(v[i]) > 6) done = false;
    if (calm) done = EX.fade <= 0;
    if (done) {
      EX.active = false; EX.rest = false; detail.classList.remove('on');
      const w = EX.w;
      w.el.style.opacity = '1'; w.el.style.transformOrigin = ''; w.el.style.transform = 'scale(' + (1 - 0.03 * w.press).toFixed(4) + ')'; w.lastS = 1 - 0.03 * w.press;
      for (const q of SMP) { const a = w.el.querySelector(q.qa); if (a) a.style.transform = ''; q.b.style.transform = ''; }
      SMP.length = 0;
      EX.w = null; PUSH = 1; UI_DIM = 0; EX.prog = 0; EX.hide = 0; EX.lastT = ''; EX.fade = 1; EX.lastF = ''; dp.style.opacity = '';
      CS.c = null;                         // the sheet stays built (and laid out) for next time
    }
  }
}
// Drag down to dismiss — from the header, or anywhere on the body once it is
// scrolled to the top (like an iOS sheet). The sheet tracks the finger 1:1;
// on release every edge of the rectangle inherits the finger's velocity, so
// the zoom back into the widget continues the throw without a seam.
const DRAG_K = 0.38;                                   // the sheet shrinks by 38 % over a full-screen pull
function dragStart(y, ts) {
  EX.drag = true; EX.dy0 = y; EX.dyl = 0; EX.hn = 0; EX.v.fill(0);
  dragHist(ts, y); markInteraction();
}
function dragHist(ts, y) {
  if (EX.hn === 8) { EX.ht.copyWithin(0, 1); EX.hy.copyWithin(0, 1); EX.hn = 7; }
  EX.ht[EX.hn] = ts; EX.hy[EX.hn] = y; EX.hn++;
}
function dragMove(y, ts) {
  markInteraction();
  let dy = y - EX.dy0;
  dy = dy < 0 ? -rubber(-dy, cssH) * 0.4 : dy;
  EX.dyl = dy; dragHist(ts, y);
  const dst = EX.dst, s = EX.s, f = 1 - clamp(dy / cssH, 0, 1) * DRAG_K;
  s[2] = dst[2] * f; s[3] = dst[3] * f; s[0] = dst[0] + (dst[2] - s[2]) / 2; s[1] = dst[1] + dy * 0.92; s[4] = dst[4];
}
function dragEnd(ts) {
  if (!EX.drag) return;
  EX.drag = false;
  let vy = 0;
  if (EX.hn > 1 && ts - EX.ht[EX.hn - 1] < 90) {
    let i = EX.hn - 1; while (i > 0 && EX.ht[EX.hn - 1] - EX.ht[i - 1] < 90) i--;
    const dtv = (EX.ht[EX.hn - 1] - EX.ht[i]) / 1000; if (dtv > 0.004) vy = (EX.hy[EX.hn - 1] - EX.hy[i]) / dtv;
  }
  // velocity of every component of the rectangle, from the finger's (chain rule through dragMove)
  const dst = EX.dst, k = EX.dyl >= 0 ? 1 : 0, ds2 = -dst[2] * DRAG_K / cssH * k;
  const projected = EX.dyl + (vy / 1000) * 0.998 / (1 - 0.998);   // where the flick is heading (Apple's projection)
  const close = projected > cssH * 0.22;
  if (close) closeDetail(false);
  else { EX.t.set(dst); EX.resp = SP_BACK[0]; EX.zeta = SP_BACK[1]; }
  EX.v[0] = -ds2 / 2 * vy; EX.v[1] = vy * (k ? 0.92 : 0.4); EX.v[2] = ds2 * vy; EX.v[3] = -dst[3] * DRAG_K / cssH * k * vy; EX.v[4] = 0;
}
dh.addEventListener('pointerdown', e => {
  if (!EX.open || e.target.closest('#dClose')) return;
  dragStart(e.clientY, e.timeStamp);
  try { dh.setPointerCapture(e.pointerId); } catch (err) { }
});
dh.addEventListener('pointermove', e => { if (EX.drag) dragMove(e.clientY, e.timeStamp); });
dh.addEventListener('pointerup', e => dragEnd(e.timeStamp));
dh.addEventListener('pointercancel', e => dragEnd(e.timeStamp));
// body: no blocking touch listener (it would make every scroll wait for JS). At the
// top of its scroll the body is `touch-action: pan-down`: the browser only scrolls for
// gestures that start upward, and a pull downward arrives here as pointer events —
// the sheet follows it. Anywhere else it is a plain native scroller.
function syncTouchAction() { const ta = db.scrollTop <= 0 ? 'pan-down' : 'pan-y'; if (db.style.touchAction !== ta) db.style.touchAction = ta; }
db.addEventListener('scroll', syncTouchAction, { passive: true });
let bp = null;
db.addEventListener('pointerdown', e => {
  bp = EX.open ? { id: e.pointerId, x: e.clientX, y: e.clientY, top: db.scrollTop <= 0, mode: 0 } : null;
});
db.addEventListener('pointermove', e => {
  if (!bp || e.pointerId !== bp.id) return;
  const dx = e.clientX - bp.x, dy = e.clientY - bp.y;
  if (bp.mode === 0) {
    if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    if (bp.top && dy > 0 && dy >= Math.abs(dx) && !CS.on) {
      bp.mode = 1; dragStart(bp.y, e.timeStamp);
      try { db.setPointerCapture(e.pointerId); } catch (err) { }
    } else bp.mode = 2;
  }
  if (bp.mode === 1) dragMove(e.clientY, e.timeStamp);
});
const bodyEnd = e => { if (bp && e.pointerId === bp.id && bp.mode === 1) dragEnd(e.timeStamp); if (bp && e.pointerId === bp.id) bp = null; };
db.addEventListener('pointerup', bodyEnd);
db.addEventListener('pointercancel', bodyEnd);

/* =============================================================================
   Hero, 48 h card, 7 days, tiles
   Writes are diffed: rewriting identical HTML still tears down and re-rasterises
   every icon in it (a visible flicker if it lands during a transition).
   ============================================================================= */
function setHTML(el, html) { if (el._h !== html) { el.innerHTML = html; el._h = html; } }
function setText(el, t) { t = String(t); if (el.textContent !== t) el.textContent = t; }
let heroCol = 0;
function renderHero() {
  sampleAt(colS[heroCol] || 0, H);
  const name = LOC ? (LOC.name || STR.myLoc) : '…';
  setText($('cityName'), name); heroText(0, name);
  $('city').classList.toggle('gps', !!(LOC && LOC.src === 'gps'));
  const when = $('when'), whenWas = when.hidden;
  when.hidden = heroCol === 0;
  if (heroCol) setText($('whenT'), dayName(H.t) + ' ' + fmt(fmtHour, H.t));
  if (!DATA) { if (when.hidden !== whenWas && WG.length) measureWidgets(); return; }
  setText($('tempN'), fT(H.temp)); heroText(1, fT(H.temp) + '°', fT(H.temp) + '<i>°</i>');
  setText($('cond'), WMO[H.code] || ''); heroText(2, WMO[H.code] || '');
  const mk = name + '|' + fT(H.temp) + '|' + (WMO[H.code] || '');
  if (MF.key !== mk) { MF.key = mk; if (MF.items.length) measureMorph(); }   // a new width moves the bar's targets
  const di = dayIndex(H.t), d = DATA.daily;
  setText($('hl'), di >= 0 ? fT(d.temperature_2m_max[di]) + '° / ' + fT(d.temperature_2m_min[di]) + '°' : '');
  setText($('hNote'), H.pp >= 10 ? STR.precip + ' ' + Math.round(H.pp) + ' %' : '');
  const aqi = $('aqi'), wasHidden = aqi.hidden;
  if (AQ && AQ.aqi != null) { aqi.hidden = false; setText($('aqiT'), STR.aqi + ' ' + Math.round(AQ.aqi)); } else aqi.hidden = true;
  renderTiles();
  // the AQI pill's glass follows the pill as the scrub pill appears / changes width
  // (one layout read per hour tick — never per frame)
  if ((wasHidden !== aqi.hidden || heroCol || when.hidden !== whenWas) && WG.length) measureWidgets();
}

const hscroll = $('hscroll'), htrack = $('htrack'), phead = $('phead');
let colW = 60, colS = [0], colEls = [], curveYs = [], nCols = 1, HOURS = [];
const CURVE_TOP = 30, CURVE_H = 30;
function smoothPath(xs, ys) {
  let d = 'M' + xs[0].toFixed(1) + ' ' + ys[0].toFixed(1);
  for (let k = 0; k < xs.length - 1; k++) {
    const y0 = ys[Math.max(0, k - 1)], y1 = ys[k], y2 = ys[k + 1], y3 = ys[Math.min(xs.length - 1, k + 2)];
    const dx = (xs[k + 1] - xs[k]) / 3;
    d += 'C' + (xs[k] + dx).toFixed(1) + ' ' + (y1 + (y2 - y0) / 6).toFixed(1) + ' ' + (xs[k + 1] - dx).toFixed(1) + ' ' + (y2 - (y3 - y1) / 6).toFixed(1) + ' ' + xs[k + 1].toFixed(1) + ' ' + y2.toFixed(1);
  }
  return d;
}
function renderHours() {
  if (!DATA) return;
  paneGen++;                                            // new hours: every prebuilt sheet is stale
  const now = Date.now() / 1000, h = DATA.hourly, h0 = hourStart(now), last = h.time[h.time.length - 1];
  colS = [0];
  for (let k = 1; k < 48; k++) { const t = h0 + k * 3600; if (t > last) break; colS.push((t - now) / 3600); }
  nCols = colS.length;
  HOURS = [];
  let mn = 1e9, mx = -1e9;
  for (let k = 0; k < nCols; k++) {
    sampleAt(colS[k], TMP);
    HOURS.push(Object.assign({}, TMP));
    mn = Math.min(mn, TMP.temp); mx = Math.max(mx, TMP.temp);
  }
  const rng = Math.max(3, mx - mn);
  curveYs = HOURS.map(s => CURVE_TOP + (1 - (s.temp - mn) / rng) * CURVE_H);
  const xs = HOURS.map((s, k) => k * colW + colW / 2);
  const W = nCols * colW;
  let stops = '';
  for (let k = 0; k < nCols; k += 3) stops += '<stop offset="' + (xs[k] / W).toFixed(3) + '" stop-color="' + tColor(HOURS[k].temp) + '"/>';
  let html = '<svg id="hsvg" width="' + W + '" viewBox="0 0 ' + W + ' 76"><defs><linearGradient id="gT" gradientUnits="userSpaceOnUse" x1="0" x2="' + W + '" y1="0" y2="0">' + stops +
    '</linearGradient></defs><path d="M0 ' + curveYs[0].toFixed(1) + 'L' + xs[0] + ' ' + curveYs[0].toFixed(1) + smoothPath(xs, curveYs).slice(1).replace(/^[^C]*/, '') +
    'L' + W + ' ' + curveYs[nCols - 1].toFixed(1) + '" fill="none" stroke="url(#gT)" stroke-width="2.25" stroke-linecap="round"/></svg>';
  let prevDate = fmt(fmtDate, now);
  for (let k = 0; k < nCols; k++) {
    const s = HOURS[k], date = fmt(fmtDate, s.t);
    const isNewDay = k > 0 && date !== prevDate;
    const label = k === 0 ? STR.nowS : (isNewDay ? fmt(fmtDM, s.t) : fmt(fmtHour, s.t));
    prevDate = date;
    const w = fW(s.wspd);
    html += '<div class="col' + (k === lastCol ? ' on' : '') + '" data-k="' + k + '"><span class="t" style="top:' + (curveYs[k] - 26).toFixed(1) + 'px">' + fT(s.temp) + '°</span>' +
      ic(glyph(s.code, s.isDay)) + '<span class="pp">' + (s.pp >= 20 ? Math.round(s.pp) + '%' : '') + '</span><span class="wv">' + w[0] + ' ' + w[1] + '</span>' +
      '<span class="h' + (isNewDay ? ' day' : '') + '">' + label + '</span></div>';
  }
  html += '<div class="col-end"></div>';
  htrack.innerHTML = html;
  colEls = htrack.querySelectorAll('.col');
  layoutHours();
  onHScroll();
}
function layoutHours() {
  const vw = hscroll.clientWidth || 360;
  colW = vw < 340 ? 54 : 60;
  document.documentElement.style.setProperty('--colw', colW + 'px');
  const end = htrack.querySelector('.col-end');
  if (end) end.style.width = Math.max(0, vw - 16 - colW) + 'px';
}
let scrubIdle = 0, lastCol = 0;
function onHScroll() {
  if (!nCols) return;
  const f = clamp(hscroll.scrollLeft / colW, 0, nCols - 1);
  const k = Math.floor(f), fr = f - k, k1 = Math.min(nCols - 1, k + 1);
  scrubTarget = lerp(colS[k], colS[k1], fr);
  updateTargets();
  phead.style.setProperty('--py', lerp(curveYs[k] || 30, curveYs[k1] || 30, fr).toFixed(1) + 'px');
  const c = Math.round(f);
  if (c !== lastCol) {
    if (colEls[lastCol]) colEls[lastCol].classList.remove('on');
    if (colEls[c]) colEls[c].classList.add('on');
    if (scrubbing && navigator.vibrate) navigator.vibrate(5);         // haptic tick per hour, same frame as the change
    lastCol = c; heroCol = c; renderHero(); prewarm(600);
  }
}
hscroll.addEventListener('scroll', () => {
  markInteraction(); scrubbing = true;
  clearTimeout(scrubIdle); scrubIdle = setTimeout(() => { scrubbing = false; }, 160);
  onHScroll();
}, { passive: true });
htrack.addEventListener('click', e => {
  const c = e.target.closest('.col'); if (!c) return;
  hscroll.scrollTo({ left: (+c.dataset.k) * colW, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
});
$('when').addEventListener('click', () => { markInteraction(); hscroll.scrollTo({ left: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' }); });

function renderDays() {
  if (!DATA) return;
  const d = DATA.daily, today = fmt(fmtDate, Date.now() / 1000), n = Math.min(7, d.time.length);
  let wmin = 1e9, wmax = -1e9;
  for (let i = 0; i < n; i++) { wmin = Math.min(wmin, num(d.temperature_2m_min[i])); wmax = Math.max(wmax, num(d.temperature_2m_max[i])); }
  const span = Math.max(1, wmax - wmin), cur = sampleAt(0, TMP).temp;
  let html = '<h2 class="wh">' + sym('cal') + '<span>' + STR.days + '</span></h2>';
  for (let i = 0; i < n; i++) {
    const t = toUnix(d.time[i], TZOFF) + 43200, isToday = fmt(fmtDate, t) === today;
    const lo = num(d.temperature_2m_min[i]), hi = num(d.temperature_2m_max[i]);
    const ws = num(d.wind_speed_10m_max && d.wind_speed_10m_max[i]), wd = num(d.wind_direction_10m_dominant && d.wind_direction_10m_dominant[i]);
    const w = fW(ws);
    const left = ((lo - wmin) / span * 100).toFixed(1), width = Math.max(6, (hi - lo) / span * 100).toFixed(1);
    const dot = isToday ? '<b style="left:' + clamp((cur - wmin) / span * 100, 0, 100).toFixed(1) + '%"></b>' : '';
    html += '<div class="row"><span class="d">' + (isToday ? STR.today : dayName(t)) + '</span>' +
      '<span class="wd"><svg viewBox="0 0 24 24" style="transform:rotate(' + Math.round(wd + 180) + 'deg)"><use href="#i-arrow"/></svg>' + STR.dirs[dir8(wd)] + ' ' + w[0] + ' ' + w[1] + '</span>' +
      ic(glyph(num(d.weather_code[i]), true)) + '<span class="lo">' + fT(lo) + '°</span>' +
      '<span class="rbar"><i style="left:' + left + '%;width:' + width + '%;background:linear-gradient(90deg,' + tColor(lo) + ',' + tColor(hi) + ')"></i>' + dot + '</span>' +
      '<span class="hi">' + fT(hi) + '°</span></div>';
  }
  setHTML($('wDays'), html);
}

function arcPath(cx, cy, r, a0, a1) {
  const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
  return 'M' + x0.toFixed(2) + ' ' + y0.toFixed(2) + 'A' + r + ' ' + r + ' 0 ' + (a1 - a0 > Math.PI ? 1 : 0) + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2);
}
const GA0 = Math.PI * 0.75, GA1 = Math.PI * 2.25;
function uvGauge(uv, size) {
  const av = GA0 + (GA1 - GA0) * clamp(uv / 11, 0, 1);
  return '<svg class="g" viewBox="0 0 76 76"' + (size ? ' width="' + size + '" height="' + size + '"' : '') + '><defs><linearGradient id="gU" x1="0" x2="1"><stop offset="0" stop-color="#7ee08a"/><stop offset=".45" stop-color="#ffd25e"/><stop offset=".75" stop-color="#ff8a4c"/><stop offset="1" stop-color="#c77dff"/></linearGradient></defs>' +
    '<path d="' + arcPath(38, 40, 28, GA0, GA1) + '" stroke="rgba(255,255,255,.14)" stroke-width="6" fill="none" stroke-linecap="round"/>' +
    '<path d="' + arcPath(38, 40, 28, GA0, Math.max(GA0 + 0.02, av)) + '" stroke="url(#gU)" stroke-width="6" fill="none" stroke-linecap="round"/>' +
    '<text x="38" y="47" text-anchor="middle" font-size="20" font-weight="500">' + Math.round(uv) + '</text></svg>';
}
function compass(dirFrom, size, cls) {
  const ticks = [];
  for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2, r0 = i % 12 ? 32 : 29; ticks.push('M' + (38 + Math.sin(a) * r0).toFixed(1) + ' ' + (38 - Math.cos(a) * r0).toFixed(1) + 'L' + (38 + Math.sin(a) * 35).toFixed(1) + ' ' + (38 - Math.cos(a) * 35).toFixed(1)); }
  const L4 = LANG === 'fr' ? ['N', 'E', 'S', 'O'] : ['N', 'E', 'S', 'W'];
  return '<svg class="' + (cls || 'g') + '" viewBox="0 0 76 76"' + (size ? ' width="' + size + '" height="' + size + '"' : '') + '><path d="' + ticks.join('') + '" stroke="rgba(255,255,255,.35)" stroke-width="1"/>' +
    '<g font-size="7" font-weight="600" fill="rgba(255,255,255,.7)" text-anchor="middle"><text x="38" y="22">' + L4[0] + '</text><text x="56" y="40.5">' + L4[1] + '</text><text x="38" y="59">' + L4[2] + '</text><text x="20" y="40.5">' + L4[3] + '</text></g>' +
    '<g transform="rotate(' + Math.round(dirFrom + 180) + ' 38 38)"><path d="M38 6l4 9h-8z" fill="#fff"/><path d="M38 15v16M38 45v25" stroke="#fff" stroke-width="1.6"/><circle cx="38" cy="70" r="2.2" fill="none" stroke="#fff" stroke-width="1.4"/></g>' +
    '<circle cx="38" cy="38" r="8.5" fill="rgba(255,255,255,.16)"/></svg>';
}
function sunInfo(t) {
  const d = DATA.daily, di = dayIndex(t);
  if (di < 0) return null;
  const rise = toUnix(d.sunrise[di], TZOFF), set = toUnix(d.sunset[di], TZOFF);
  let evL, evT;
  if (t < rise) { evL = STR.rise; evT = rise; } else if (t < set) { evL = STR.set; evT = set; }
  else { evL = STR.rise; evT = di + 1 < d.sunrise.length ? toUnix(d.sunrise[di + 1], TZOFF) : rise + 86400; }
  return { rise, set, evL, evT, frac: clamp((t - rise) / Math.max(1, set - rise), 0, 1), up: t >= rise && t <= set };
}
function sunArc(si, w, h) {
  const x0 = 8, x1 = w - 8, base = h - 14, top = 10;
  const sx = x0 + si.frac * (x1 - x0), sy = base - Math.sin(si.frac * Math.PI) * (base - top);
  return '<path d="M2 ' + base + 'H' + (w - 2) + '" stroke="rgba(255,255,255,.25)" stroke-dasharray="2 3"/>' +
    '<path d="M' + x0 + ' ' + base + 'Q' + (w / 2) + ' ' + (top - (base - top)) + ' ' + x1 + ' ' + base + '" stroke="rgba(255,255,255,.55)" stroke-width="2" fill="none"/>' +
    (si.up ? '<circle cx="' + sx.toFixed(1) + '" cy="' + sy.toFixed(1) + '" r="5.5" fill="#ffd25e"/><circle cx="' + sx.toFixed(1) + '" cy="' + sy.toFixed(1) + '" r="11" fill="#ffd25e" opacity=".22"/>' : '');
}
function renderTiles() {
  if (!DATA) return;
  // UV
  const uv = Math.max(0, H.uv);
  setHTML($('tUV'), '<h3 class="wh">' + sym('uv') + '<span>' + STR.uvT + '</span></h3><div class="v">' + STR.uv[uvLevel(uv)] + '</div>' + uvGauge(uv));
  // wind
  const w = fW(H.wspd);
  setHTML($('tWind'), '<h3 class="wh">' + sym('wind') + '<span>' + STR.wind + '</span></h3><div class="v">' + w[0] + '<small>' + w[1] + '</small></div><div class="s">' + STR.dirsL[dir8(H.wdir)] + '</div>' + compass(H.wdir));
  // sun
  const si = sunInfo(H.t);
  setHTML($('tSun'), '<h3 class="wh">' + sym('sunrise') + '<span>' + (si ? si.evL : STR.rise) + '</span></h3><div class="v">' + (si ? fmt(fmtHour, si.evT) : '–') + '</div>' +
    (si ? '<svg class="g wide" viewBox="0 0 106 64">' + sunArc(si, 106, 54) + '<g font-size="8.5" fill="rgba(255,255,255,.65)" text-anchor="middle"><text x="12" y="63">' + fmt(fmtHour, si.rise) + '</text><text x="94" y="63">' + fmt(fmtHour, si.set) + '</text></g></svg>' : ''));
  // feels like
  const dlt = H.app - H.temp;
  setHTML($('tFeels'), '<h3 class="wh">' + sym('therm') + '<span>' + STR.feels + '</span></h3><div class="v">' + fT(H.app) + '°</div><div class="s">' + (dlt < -1.5 ? STR.feelsColder : dlt > 1.5 ? STR.feelsWarmer : STR.feelsSame) + '</div>');
  // humidity
  const hum = clamp(H.hum, 0, 100);
  setHTML($('tHum'), '<h3 class="wh">' + sym('drop') + '<span>' + STR.hum + '</span></h3><div class="v">' + Math.round(hum) + '<small>%</small></div><div class="s">' + STR.dew + ' ' + fT(H.dew) + '°</div>' +
    '<svg class="g" viewBox="0 0 76 76"><rect x="30" y="8" width="16" height="60" rx="8" fill="rgba(255,255,255,.12)"/><rect x="30" y="' + (8 + 60 * (1 - hum / 100)).toFixed(1) + '" width="16" height="' + (60 * hum / 100).toFixed(1) + '" rx="8" fill="#7cc4ff"/></svg>');
  // pressure
  sampleAt((colS[heroCol] || 0) + 3, TMP);
  const trd = TMP.pres - H.pres, pa = GA0 + (GA1 - GA0) * clamp((H.pres - 960) / 100, 0, 1);
  setHTML($('tPres'), '<h3 class="wh">' + sym('gauge') + '<span>' + STR.pres + '</span></h3><div class="v">' + Math.round(H.pres) + '<small>hPa</small></div><div class="s">' + (trd > 0.6 ? STR.up : trd < -0.6 ? STR.down : STR.steady) + '</div>' +
    '<svg class="g" viewBox="0 0 76 76"><path d="' + arcPath(38, 40, 28, GA0, GA1) + '" stroke="rgba(255,255,255,.18)" stroke-width="6" fill="none" stroke-linecap="round" stroke-dasharray="1.2 3.2"/>' +
    '<line x1="38" y1="40" x2="' + (38 + Math.cos(pa) * 24).toFixed(1) + '" y2="' + (40 + Math.sin(pa) * 24).toFixed(1) + '" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><circle cx="38" cy="40" r="3.5" fill="#fff"/></svg>');
}

/* =============================================================================
   Detail sheets
   Every sheet is built ahead of time, in idle moments, and kept in memory as a
   pane of the sheet body: laid out once, then put to sleep with
   content-visibility:hidden (the browser keeps its layout and paints nothing).
   Opening a widget only wakes its pane — no HTML to parse, no layout in the tap.
   A pane is rebuilt (again in idle time) when what it shows changes: new data,
   units, the scrubbed hour, the screen size.
   ============================================================================= */
const SHEETS = ['hours', 'days', 'uv', 'wind', 'sun', 'feels', 'hum', 'pres', 'aqi'];
const PANES = {};                                       // key → { el, k, title, icon, chart }
let activePane = null, paneGen = 0, warmTimer = 0, warmQ = [];
const whenIdle = window.requestIdleCallback ? f => requestIdleCallback(f, { timeout: 1500 }) : f => setTimeout(f, 50);
const paneKey = () => paneGen + '|' + units + '|' + heroCol + '|' + cssW + '|' + (AQ ? AQ.aqi : '-');
function buildPane(key) {
  const k = paneKey();
  let p = PANES[key];
  if (p && p.k === k) return p;
  pendingMark = null;
  const d = renderDetail(key);
  if (!d) return p && p.k ? p : null;
  if (!p) { const el = document.createElement('div'); el.className = 'pane'; db.append(el); p = PANES[key] = { el, k: '', title: '', icon: '', chart: null }; }
  if (p.chart) delete CH[p.chart];
  p.chart = pendingMark ? pendingMark[0] : null; pendingMark = null;
  p.el.innerHTML = d.html; p.title = d.title; p.icon = d.icon; p.k = k;
  // lay it out now (unpainted: the sheet is hidden, or this pane is), then let it sleep with its layout kept
  p.el.classList.add('on'); void p.el.offsetHeight;
  if (p !== activePane) p.el.classList.remove('on');
  return p;
}
function prewarm(delay) {
  clearTimeout(warmTimer);
  warmTimer = setTimeout(() => { warmQ = SHEETS.slice(); whenIdle(warmStep); }, delay || 0);
}
function warmStep(dl) {
  if (!DATA) return;
  // never during a gesture or a transition: building is main-thread work
  const busy = SC.mode !== 0 || CS.on || scrubbing || (EX.active && !EX.rest) || (pressW && pressW.press > 0.001);
  if (busy) { clearTimeout(warmTimer); warmTimer = setTimeout(() => whenIdle(warmStep), 250); return; }
  while (warmQ.length) {
    const key = warmQ.shift(), p = PANES[key];
    if (!(EX.active && p === activePane)) buildPane(key);        // the open sheet is left as it is
    if (!dl || dl.didTimeout || dl.timeRemaining() < 10) break;  // one pane per idle slice at least
  }
  if (warmQ.length) whenIdle(warmStep);
}
let chartId = 0, pendingMark = null;
const CH = {};                                          // scrubbable charts of the open sheet
/* Chart scrubbing — drag along the chart: the lollipop rides the exact curve
   (the path's Bézier segments are linear in x, so t = the fraction between two
   hours), the readout follows, and the whole sky morphs to that hour live.
   On release it settles on the nearest hour with a soft spring, and the 48 h
   card underneath is moved there too. */
const CS = { c: null, id: '', g: null, line: null, dot: null, txt: null, f: 0, ft: 0, v: 0, on: false, pid: -1, x0: 0, y0: 0, last: -1, el: null };
function chartBind(id, f) {
  const g = document.getElementById(id + 'm');
  if (!g) return;
  CS.c = CH[id]; CS.id = id; CS.g = g; CS.line = g.querySelector('line'); CS.dot = g.querySelector('circle'); CS.txt = g.querySelector('text');
  CS.el = g.ownerSVGElement; CS.f = CS.ft = f; CS.v = 0; CS.last = Math.round(f);
  chartDraw();
}
function chartDraw() {
  const c = CS.c; if (!c) return;
  const f = clamp(CS.f, 0, c.n - 1), k = Math.min(c.n - 2, Math.floor(f)), t = k < 0 ? 0 : f - k, ys = c.ys;
  const x = c.pl + f * c.iw / Math.max(1, c.n - 1);
  let y = ys[0];
  if (k >= 0) {   // the same cubic as smoothPath()
    const y0 = ys[Math.max(0, k - 1)], y1 = ys[k], y2 = ys[k + 1], y3 = ys[Math.min(c.n - 1, k + 2)];
    const p1 = y1 + (y2 - y0) / 6, p2 = y2 - (y3 - y1) / 6, u = 1 - t;
    y = u * u * u * y1 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * y2;
  }
  CS.line.setAttribute('x1', x.toFixed(1)); CS.line.setAttribute('x2', x.toFixed(1));
  CS.dot.setAttribute('cx', x.toFixed(1)); CS.dot.setAttribute('cy', y.toFixed(1));
  const i = Math.round(f), h = HOURS[i];
  const val = k >= 0 ? lerp(c.v[k], c.v[k + 1], t) : c.v[0];
  CS.txt.textContent = (h ? (i === 0 ? STR.nowS : fmt(fmtHour, h.t)) : '') + '  ' + c.yl(val);
  CS.txt.setAttribute('x', clamp(x, 36, c.W - 84).toFixed(1));
}
function chartScrubTo(clientX) {
  const c = CS.c, r = CS.el.getBoundingClientRect();
  const vx = (clientX - r.left) / Math.max(1, r.width) * c.W;
  CS.ft = CS.f = clamp((vx - c.pl) / c.iw * (c.n - 1), 0, c.n - 1); CS.v = 0;
  chartDraw();
  // the sky follows the finger, continuously between hours
  const k = Math.min(nCols - 1, Math.floor(CS.f)), k1 = Math.min(nCols - 1, k + 1), fr = CS.f - k;
  scrubTarget = lerp(colS[k] || 0, colS[k1] || 0, fr); scrubbing = true; updateTargets();
  clearTimeout(scrubIdle); scrubIdle = setTimeout(() => { scrubbing = false; }, 160);
  const i = Math.round(CS.f);
  if (i !== CS.last) { CS.last = i; if (navigator.vibrate) navigator.vibrate(5); }   // a tick per hour
}
function chartRelease() {
  CS.on = false; CS.pid = -1;
  CS.ft = Math.round(CS.f);
  hscroll.scrollLeft = CS.ft * colW;          // the 48 h card (and the hero) settle on that hour too
}
db.addEventListener('pointerdown', e => {
  const el = e.target.closest('.chart[data-ch]');
  if (!el || !CS.c || el.dataset.ch !== CS.id || !EX.open) return;
  CS.pid = e.pointerId; CS.x0 = e.clientX; CS.y0 = e.clientY; CS.on = false; markInteraction();
});
db.addEventListener('pointermove', e => {
  if (e.pointerId !== CS.pid) return;
  if (!CS.on) {
    const dx = Math.abs(e.clientX - CS.x0), dy = Math.abs(e.clientY - CS.y0);
    if (dx > 4 && dx > dy) { CS.on = true; try { CS.el.setPointerCapture(e.pointerId); } catch (err) { } }
    else return;
  }
  markInteraction(); chartScrubTo(e.clientX);
});
db.addEventListener('pointerup', e => {
  if (e.pointerId !== CS.pid) return;
  if (!CS.on && Math.hypot(e.clientX - CS.x0, e.clientY - CS.y0) < 8) chartScrubTo(e.clientX);   // a tap jumps there
  chartRelease();
});
db.addEventListener('pointercancel', e => { if (e.pointerId === CS.pid) { CS.pid = -1; if (CS.on) chartRelease(); } });
function chartUpdate(dt) {
  if (!CS.c || CS.on || CS.f === CS.ft) return;
  CS.v = springTo(CS.f, CS.v, CS.ft, 0.24, 1, dt, SCR, 0); CS.f = SCR[0];
  if (Math.abs(CS.f - CS.ft) < 0.002 && Math.abs(CS.v) < 0.01) { CS.f = CS.ft; CS.v = 0; }
  chartDraw();
}
function chart(o) {
  const W = o.w, Hh = o.h, pl = 2, pr = 40, pt = o.mark != null ? 26 : 14, pb = 24, iw = W - pl - pr, ih = Hh - pt - pb, n = o.n;
  let mn = o.min, mx = o.max; if (mx - mn < 1e-6) mx = mn + 1;
  const X = i => pl + i * iw / Math.max(1, n - 1), Y = v => pt + (1 - (v - mn) / (mx - mn)) * ih;
  const id = 'ch' + (chartId++);
  const scrub = o.mark != null;
  let s = '<svg class="chart"' + (scrub ? ' data-ch="' + id + '"' : '') + ' viewBox="0 0 ' + W + ' ' + Hh + '" height="' + Hh + '"><defs>';
  o.series.forEach((sr, si) => {
    if (sr.temp) { let st = ''; for (let i = 0; i < n; i += 3) st += '<stop offset="' + (X(i) / W).toFixed(3) + '" stop-color="' + tColor(sr.v[i]) + '"/>'; s += '<linearGradient id="' + id + 's' + si + '" gradientUnits="userSpaceOnUse" x1="0" x2="' + W + '" y1="0" y2="0">' + st + '</linearGradient>'; }
    if (sr.area) s += '<linearGradient id="' + id + 'a' + si + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="' + sr.area + '" stop-opacity=".38"/><stop offset="1" stop-color="' + sr.area + '" stop-opacity="0"/></linearGradient>';
  });
  s += '</defs>';
  if (o.night) {
    let run = -1;
    for (let i = 0; i <= n; i++) {
      const dark = i < n && !o.night[i];
      if (dark && run < 0) run = i;
      if (!dark && run >= 0) { s += '<rect x="' + X(Math.max(0, run - 0.5)).toFixed(1) + '" y="' + pt + '" width="' + (X(Math.min(n - 1, i - 0.5)) - X(Math.max(0, run - 0.5))).toFixed(1) + '" height="' + ih + '" fill="rgba(255,255,255,.045)"/>'; run = -1; }
    }
  }
  for (let k = 0; k <= 2; k++) {
    const v = mn + (mx - mn) * k / 2, y = Y(v).toFixed(1);
    s += '<line x1="' + pl + '" x2="' + (pl + iw) + '" y1="' + y + '" y2="' + y + '" stroke="rgba(255,255,255,.10)"/><text x="' + (W - 2) + '" y="' + (+y + 4) + '" text-anchor="end">' + o.yl(v) + '</text>';
  }
  if (o.bars) {
    const bw = Math.max(2, iw / n * 0.55);
    for (let i = 0; i < n; i++) {
      const bh = clamp(o.bars.v[i] / o.bars.max, 0, 1) * ih * (o.bars.full ? 1 : 0.42);
      if (bh > 0.5) s += '<rect x="' + (X(i) - bw / 2).toFixed(1) + '" y="' + (pt + ih - bh).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="' + Math.min(2, bw / 2) + '" fill="' + o.bars.color(i) + '"/>';
    }
  }
  o.series.forEach((sr, si) => {
    const xs = [], ys = [];
    for (let i = 0; i < n; i++) { xs.push(X(i)); ys.push(Y(sr.v[i])); }
    const d = smoothPath(xs, ys);
    if (sr.area) s += '<path d="' + d + 'L' + xs[n - 1].toFixed(1) + ' ' + (pt + ih) + 'L' + xs[0].toFixed(1) + ' ' + (pt + ih) + 'Z" fill="url(#' + id + 'a' + si + ')"/>';
    s += '<path d="' + d + '" fill="none" stroke="' + (sr.temp ? 'url(#' + id + 's' + si + ')' : sr.color) + '" stroke-width="' + (sr.width || 2.25) + '"' + (sr.dash ? ' stroke-dasharray="' + sr.dash + '"' : '') + ' stroke-linecap="round" stroke-linejoin="round"/>';
  });
  for (let i = 0; i < n; i++) { const lab = o.xl(i); if (lab) s += '<text x="' + X(i).toFixed(1) + '" y="' + (Hh - 6) + '" text-anchor="middle">' + lab + '</text>'; }
  if (scrub && o.mark < n) {
    // the selection: a lollipop you can drag along the curve (see chartDraw)
    const ys0 = [], sv = o.series[0].v;
    for (let i = 0; i < n; i++) ys0.push(Y(sv[i]));
    CH[id] = { n, pl, iw, W, pt, ih, ys: ys0, v: sv, yl: o.rl || o.yl };
    s += '<g id="' + id + 'm"><line x1="0" x2="0" y1="' + pt + '" y2="' + (pt + ih) + '" stroke="rgba(255,255,255,.45)" stroke-dasharray="2 3"/>' +
      '<circle r="4.5" fill="#fff" stroke="rgba(0,0,0,.25)" stroke-width="1"/><text class="rd" y="' + (pt - 3) + '" text-anchor="middle"></text></g>';
    s += '</svg>';
    pendingMark = [id, o.mark];
    return s;
  }
  return s + '</svg>';
}
const hoursX = i => { const t = HOURS[i] && HOURS[i].t; if (!t) return ''; const lh = Math.floor(((t + TZOFF) / 3600) % 24 + 24) % 24; return (i > 1 && lh % 6 === 0) ? fmt(fmtHour, t) : ''; };
const field = k => HOURS.map(h => h[k]);
const span = (arr, pad) => { let a = Math.min(...arr), b = Math.max(...arr); const p = (b - a) * (pad || 0.12) + 0.5; return [a - p, b + p]; };
function moonSVG(phase, size, south) {
  const r = size / 2 - 2, c = size / 2, k = Math.cos(phase * 2 * Math.PI), rx = Math.abs(k) * r;
  const waxing = phase < 0.5;
  const outer = waxing ? 'A' + r + ' ' + r + ' 0 0 1 ' + c + ' ' + (c + r) : 'A' + r + ' ' + r + ' 0 0 0 ' + c + ' ' + (c + r);
  const sweep = waxing ? (k > 0 ? 0 : 1) : (k > 0 ? 1 : 0);
  const lit = 'M' + c + ' ' + (c - r) + outer + 'A' + rx.toFixed(2) + ' ' + r + ' 0 0 ' + sweep + ' ' + c + ' ' + (c - r) + 'Z';
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '"' + (south ? ' style="transform:scaleX(-1)"' : '') + '><circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="rgba(255,255,255,.10)"/><path d="' + lit + '" fill="#f1efe6"/></svg>';
}
function renderDetail(key) {
  if (!DATA || !HOURS.length) return null;
  const W = Math.round(Math.max(240, cssW - 16 - safeL - safeR - 40)), n = HOURS.length;
  const mark = clamp(heroCol, 0, n - 1);
  const stat = (i, b) => '<div class="stat"><i>' + i + '</i><b>' + b + '</b></div>';
  const xl = hoursX, night = HOURS.map(h => h.isDay);
  if (key === 'hours') {
    const temps = field('temp'), pp = field('pp');
    const next = HOURS.slice(0, Math.min(n, 25));
    let hi = next[0], lo = next[0];
    next.forEach(h => { if (h.temp > hi.temp) hi = h; if (h.temp < lo.temp) lo = h; });
    const rainAt = HOURS.find(h => h.pp >= 50);
    const rain24 = next.reduce((a, h) => a + h.precip, 0), maxW = next.reduce((a, h) => Math.max(a, h.wspd), 0);
    const [mn, mx] = span(temps);
    let html = '<p class="lede">' + tr(STR.maxAt, fT(hi.temp) + '°', fmt(fmtHour, hi.t), fT(lo.temp) + '°', fmt(fmtHour, lo.t)) + ' ' + (rainAt ? tr(STR.rainAt, fmt(fmtHour, rainAt.t)) : STR.noRain) + '</p>' +
      chart({ w: W, h: 200, n, min: mn, max: mx, series: [{ v: temps, temp: true, area: '#9fd3ff', width: 2.5 }], bars: { v: pp, max: 100, color: () => 'rgba(120,190,255,.55)' }, night, xl, yl: v => fT(v) + '°', mark }) +
      '<div class="stats">' + stat(STR.high, fT(hi.temp) + '°') + stat(STR.low, fT(lo.temp) + '°') + stat(STR.rain24, rain24.toFixed(1) + ' mm') + stat(STR.maxWind, fW(maxW).join(' ')) + '</div>' +
      '<div class="sect">' + STR.hourly + '</div><div class="list">';
    HOURS.forEach((h, i) => {
      html += '<div class="li"><span class="a">' + (i === 0 ? STR.nowS : fmt(fmtHour, h.t)) + '</span>' + ic(glyph(h.code, h.isDay)) +
        '<span class="m"><b>' + esc(WMO[h.code] || '') + '</b><i>' + fW(h.wspd).join(' ') + (h.pp >= 20 ? '<s>' + Math.round(h.pp) + ' %</s>' : '') + '</i></span><span class="z">' + fT(h.temp) + '°</span></div>';
    });
    return { title: STR.hours, icon: 'clock', html: html + '</div>' };
  }
  if (key === 'days') {
    const d = DATA.daily, today = fmt(fmtDate, Date.now() / 1000);
    let html = '<div class="list">';
    for (let i = 0; i < Math.min(7, d.time.length); i++) {
      const t = toUnix(d.time[i], TZOFF) + 43200, code = num(d.weather_code[i]);
      const name = fmt(fmtDate, t) === today ? STR.todayL : cap(fmt(fmtLong, t));
      const wsp = fW(num(d.wind_speed_10m_max && d.wind_speed_10m_max[i])), wd = num(d.wind_direction_10m_dominant && d.wind_direction_10m_dominant[i]);
      html += '<div class="dayrow"><div class="top">' + ic(glyph(code, true)) + '<div><b>' + esc(name) + '</b><br><span>' + esc(WMO[code] || '') + '</span></div><em>' + fT(d.temperature_2m_max[i]) + '° <span>' + fT(d.temperature_2m_min[i]) + '°</span></em></div>' +
        '<div class="sub"><span>' + STR.precip + ' ' + Math.round(num(d.precipitation_probability_max && d.precipitation_probability_max[i])) + ' %</span><span>' + num(d.precipitation_sum && d.precipitation_sum[i]).toFixed(1) + ' mm</span>' +
        '<span>' + STR.wind + ' ' + STR.dirs[dir8(wd)] + ' ' + wsp.join(' ') + '</span><span>UV ' + Math.round(num(d.uv_index_max && d.uv_index_max[i])) + '</span>' +
        '<span>' + STR.rise + ' ' + fmt(fmtHour, toUnix(d.sunrise[i], TZOFF)) + '</span><span>' + STR.set + ' ' + fmt(fmtHour, toUnix(d.sunset[i], TZOFF)) + '</span></div></div>';
    }
    return { title: STR.days, icon: 'cal', html: html + '</div>' };
  }
  if (key === 'uv') {
    const uvs = field('uv'), lv = uvLevel(H.uv);
    let pk = HOURS[0]; HOURS.slice(0, 24).forEach(h => { if (h.uv > pk.uv) pk = h; });
    const tm = DATA.daily.uv_index_max && DATA.daily.uv_index_max[1];
    return { title: STR.uvT, icon: 'uv', html: '<div class="big"><b>' + Math.round(H.uv) + '</b><span>' + STR.uv[lv] + '</span></div><p class="lede">' + STR.uvAdv[lv] + '</p>' +
      chart({ w: W, h: 190, n, min: 0, max: Math.max(6, Math.max(...uvs) + 1), series: [{ v: uvs, color: 'rgba(255,255,255,.0)', width: 0.01 }], bars: { v: uvs, max: Math.max(6, Math.max(...uvs) + 1), full: true, color: i => UV_COL[uvLevel(uvs[i])] }, night, xl, yl: v => Math.round(v), rl: v => 'UV ' + Math.round(v), mark }) +
      '<div class="stats">' + stat(STR.peak, Math.round(pk.uv) + ' ' + STR.at + ' ' + fmt(fmtHour, pk.t)) + stat(STR.tomorrow, tm != null ? Math.round(tm) : '–') + '</div>' };
  }
  if (key === 'wind') {
    const sp = field('wspd'), gu = field('gust'), w = fW(H.wspd), [, mx] = span(gu.concat(sp));
    const maxG = HOURS.slice(0, 24).reduce((a, h) => Math.max(a, h.gust), 0);
    return { title: STR.wind, icon: 'wind', html: '<div class="big"><b>' + w[0] + '</b><span>' + w[1] + '</span><span class="dir">' + STR.dirsL[dir8(H.wdir)] + '</span></div>' +
      '<div style="display:flex;justify-content:center;margin:.6rem 0 .2rem">' + compass(H.wdir, 170, 'cmp') + '</div>' +
      chart({ w: W, h: 180, n, min: 0, max: mx, series: [{ v: sp, color: '#9fd3ff', area: '#9fd3ff' }, { v: gu, color: 'rgba(255,255,255,.65)', dash: '3 4', width: 1.6 }], night, xl, yl: v => fW(v)[0], rl: v => fW(v).join(' '), mark }) +
      '<div class="stats">' + stat(STR.gusts, fW(H.gust).join(' ')) + stat(STR.gust24, fW(maxG).join(' ')) + '</div>' };
  }
  if (key === 'sun') {
    const si = sunInfo(H.t), lat = LOC ? LOC.lat : CONFIG.defaultLocation.lat, lon = LOC ? LOC.lon : CONFIG.defaultLocation.lon;
    const dayMs = (si.set - si.rise) * 1000, hh = Math.floor(dayMs / 3600000), mm = Math.round(dayMs / 60000 - hh * 60);
    const gs = sunCross((si.set - 3 * 3600) * 1000, 6, false, lat, lon), ge = sunCross((si.set - 3 * 3600) * 1000, -4, false, lat, lon);
    astro(H.t * 1000, lat, lon);
    const phase = A.moonPhase, frac = A.moonFrac, pi = Math.round(phase * 8) % 8;
    return { title: STR.sunT, icon: 'sunrise', html: '<div class="big"><b>' + fmt(fmtHour, si.evT) + '</b><span>' + si.evL + '</span></div>' +
      '<svg class="chart" viewBox="0 0 ' + W + ' 150" height="150">' + sunArc(si, W, 140) + '<g font-size="12" fill="rgba(255,255,255,.65)"><text x="6" y="148">' + fmt(fmtHour, si.rise) + '</text><text x="' + (W - 6) + '" y="148" text-anchor="end">' + fmt(fmtHour, si.set) + '</text></g></svg>' +
      '<div class="stats">' + stat(STR.dayLen, hh + ' h ' + String(mm).padStart(2, '0')) + stat(STR.golden, gs && ge ? fmt(fmtHour, gs / 1000) + '–' + fmt(fmtHour, ge / 1000) : '–') + '</div>' +
      '<div class="sect">' + STR.moon + '</div><div style="display:flex;align-items:center;gap:1rem;margin-top:.7rem">' + moonSVG(phase, 72, lat < 0) +
      '<div><div style="font-size:1.25rem;font-weight:600">' + STR.phases[pi] + '</div><div class="lede" style="margin:.2rem 0 0">' + Math.round(frac * 100) + ' % ' + STR.illum + '</div></div></div>' };
  }
  if (key === 'feels') {
    const ap = field('app'), tp = field('temp'), [mn, mx] = span(ap.concat(tp));
    return { title: STR.feels, icon: 'therm', html: '<div class="big"><b>' + fT(H.app) + '°</b><span>' + STR.actual + ' ' + fT(H.temp) + '°</span></div><p class="lede">' + STR.feelsExpl + '</p>' +
      chart({ w: W, h: 200, n, min: mn, max: mx, series: [{ v: ap, temp: true, width: 2.5 }, { v: tp, color: 'rgba(255,255,255,.55)', dash: '3 4', width: 1.5 }], night, xl, yl: v => fT(v) + '°', mark }) };
  }
  if (key === 'hum') {
    const hm = field('hum'), dw = H.dew, ci = dw < 10 ? 0 : dw < 16 ? 1 : dw < 20 ? 2 : 3;
    const next = hm.slice(0, 24);
    return { title: STR.hum, icon: 'drop', html: '<div class="big"><b>' + Math.round(H.hum) + '%</b><span>' + STR.dew + ' ' + fT(dw) + '°</span></div><p class="lede">' + tr(STR.comfortTxt, fT(dw) + '°', STR.comfort[ci]) + '</p>' +
      chart({ w: W, h: 190, n, min: 0, max: 100, series: [{ v: hm, color: '#7cc4ff', area: '#7cc4ff' }], night, xl, yl: v => Math.round(v) + '%', mark }) +
      '<div class="stats">' + stat(STR.max24, Math.round(Math.max(...next)) + '%') + stat(STR.min24, Math.round(Math.min(...next)) + '%') + '</div>' };
  }
  if (key === 'pres') {
    const pr = field('pres'), [mn, mx] = span(pr, 0.25);
    sampleAt((colS[heroCol] || 0) + 3, TMP);
    const d3 = TMP.pres - H.pres;
    return { title: STR.pres, icon: 'gauge', html: '<div class="big"><b>' + Math.round(H.pres) + '</b><span>hPa</span></div><p class="lede">' + (d3 > 0.6 ? STR.presUp : d3 < -0.6 ? STR.presDown : STR.presSteady) + '</p>' +
      chart({ w: W, h: 190, n, min: mn, max: mx, series: [{ v: pr, color: '#d9c3ff', area: '#d9c3ff' }], night, xl, yl: v => Math.round(v), rl: v => Math.round(v) + ' hPa', mark }) +
      '<div class="stats">' + stat(STR.change3, (d3 >= 0 ? '+' : '−') + Math.abs(d3).toFixed(1) + ' hPa') + stat(STR.range48, Math.round(Math.min(...pr)) + '–' + Math.round(Math.max(...pr))) + '</div>' };
  }
  if (key === 'aqi' && AQ) {
    const v = AQ.aqi, lv = aqiLevel(v), pos = clamp(v / 120, 0, 1) * 100;
    const pol = (k, lab) => AQ[k] != null ? stat(lab, Math.round(AQ[k]) + ' µg/m³') : '';
    return { title: STR.aqiT, icon: 'leaf', html: '<div class="big"><b>' + Math.round(v) + '</b><span>' + STR.aqiLv[lv] + '</span></div>' +
      '<div class="scale" style="background:linear-gradient(90deg,' + AQI_COL.join(',') + ')"><b style="left:' + pos.toFixed(1) + '%"></b></div><div class="legend"><span>0</span><span>50</span><span>100+</span></div>' +
      '<p class="lede" style="margin-top:1rem">' + STR.aqiAdv[lv] + '</p><div class="stats">' + pol('pm2_5', 'PM2.5') + pol('pm10', 'PM10') + pol('o3', 'O₃') + pol('no2', 'NO₂') + '</div>' };
  }
  return null;
}

/* =============================================================================
   Menu, status
   ============================================================================= */
const menu = $('menu');
$('uLbl').textContent = STR.units; $('mRefreshL').textContent = STR.refresh; $('mDebugL').textContent = STR.stats;
function syncUnits() { menu.querySelectorAll('[data-u]').forEach(el => el.classList.toggle('on', el.dataset.u === units)); }
function setUnits(u) { units = u; store.set('ciel:units', u); syncUnits(); renderAll(); }
$('menuBtn').addEventListener('click', e => { e.stopPropagation(); menu.classList.toggle('open'); setStatus(); });
menu.addEventListener('click', e => { e.stopPropagation(); const u = e.target.closest('[data-u]'); if (u) setUnits(u.dataset.u); });
document.addEventListener('click', () => menu.classList.remove('open'));
$('mRefresh').addEventListener('click', () => { menu.classList.remove('open'); refresh(); });
$('mDebug').addEventListener('click', () => { menu.classList.remove('open'); toggleDebug(); });
$('temp').addEventListener('click', e => { e.stopPropagation(); setUnits(units === 'C' ? 'F' : 'C'); });
function toggleDebug() { $('dbg').hidden = !$('dbg').hidden; }
let statusKind = '';
function setStatus(kind) {
  if (kind !== undefined) statusKind = kind;
  const t = FETCHED && fmtClock ? fmtClock.format(new Date(FETCHED)) : '';
  const txt = statusKind === 'updating' ? STR.updating : statusKind === 'offline' ? STR.offline : statusKind === 'error' ? STR.error : statusKind === 'locErr' ? STR.locErr : '';
  $('mStatus').textContent = (txt ? txt + ' · ' : '') + (t ? STR.updated + ' ' + t : '');
  const bad = statusKind === 'offline' || statusKind === 'error' || statusKind === 'locErr';
  if ($('net').hidden === bad) { $('net').hidden = !bad; measureWidgets(); }
  $('netT').textContent = txt + (t && statusKind !== 'locErr' ? ' · ' + t : '');
  $('foot').innerHTML = (t ? STR.updated + ' ' + t + '<br>' : '') + STR.credits;
}

/* =============================================================================
   Fetching
   ============================================================================= */
const CUR = 'temperature_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m';
const HRS = 'temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,pressure_msl,precipitation_probability,precipitation,rain,showers,snowfall,weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,is_day';
const DLY = 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_direction_10m_dominant';
async function fetchForecast(lat, lon) {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4) +
    '&current=' + CUR + '&hourly=' + HRS + '&daily=' + DLY + '&timezone=auto&timeformat=unixtime&forecast_days=7&forecast_hours=48';
  const r = await fetch(url);
  if (!r.ok) throw new Error('forecast ' + r.status);
  const j = await r.json();
  if (!j.hourly || !j.hourly.time || !j.daily) throw new Error('bad payload');
  return j;
}
async function fetchAQ(lat, lon) {
  try {
    const r = await fetch('https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4) + '&current=european_aqi,pm2_5,pm10,ozone,nitrogen_dioxide&timezone=auto');
    const c = (await r.json()).current || {};
    return typeof c.european_aqi === 'number' ? { aqi: c.european_aqi, pm2_5: c.pm2_5, pm10: c.pm10, o3: c.ozone, no2: c.nitrogen_dioxide } : null;
  } catch (e) { return null; }
}
async function reverseName(lat, lon) {
  try {
    const r = await fetch('https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' + lat + '&longitude=' + lon + '&localityLanguage=' + LANG);
    const j = await r.json();
    return j.city || j.locality || j.principalSubdivision || STR.myLoc;
  } catch (e) { return STR.myLoc; }
}
function locate() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('no geolocation'));
    navigator.geolocation.getCurrentPosition(p => res(p.coords), rej, { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 });
  });
}
function renderAll() { renderHours(); renderDays(); renderHero(); measureWidgets(); prewarm(800); }
function applyData(loc, data, fetchedAt, snap) {
  LOC = loc; DATA = data; FETCHED = fetchedAt; TZOFF = num(data.utc_offset_seconds); hemi = loc.lat < 0 ? -1 : 1;
  makeFormatters();
  renderAll();
  updateTargets(); setStatus('');
  if (snap) { P.set(T); V.fill(0); }
}
let busy = false;
async function refresh(useGps) {
  if (busy) return; busy = true; setStatus('updating');
  try {
    let loc = LOC;
    if (useGps || !loc || loc.src === 'gps') {
      try {
        const c = await locate();
        const moved = !loc || loc.src !== 'gps' || Math.abs(c.latitude - loc.lat) + Math.abs(c.longitude - loc.lon) > 0.02;
        loc = { lat: c.latitude, lon: c.longitude, name: moved ? null : loc.name, src: 'gps' };
        if (!loc.name) loc.name = await reverseName(loc.lat, loc.lon);
      } catch (e) {
        if (!loc || useGps) { setStatus('locErr'); if (!LOC) openSheet(); return; }
      }
    }
    const [data, aq] = await Promise.all([fetchForecast(loc.lat, loc.lon), fetchAQ(loc.lat, loc.lon)]);
    AQ = aq;
    applyData(loc, data, Date.now(), !DATA);
    store.set('ciel:v3', { loc, data, aq, t: FETCHED });
  } catch (e) {
    setStatus(navigator.onLine === false ? 'offline' : 'error');
  } finally { busy = false; }
}

/* ── city search ── */
const sheet = $('sheet'), qIn = $('q'), results = $('results');
qIn.placeholder = STR.search; $('gpsLbl').textContent = STR.useLoc;
let searchTimer = 0, searchSeq = 0;
function openSheet() {
  sheet.hidden = false; qIn.value = ''; results.innerHTML = '';
  requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('open')));
  setTimeout(() => qIn.focus(), 60);
}
function closeSheet() {
  sheet.classList.remove('open'); qIn.blur();
  setTimeout(() => { if (!sheet.classList.contains('open')) sheet.hidden = true; }, 320);
}
$('addBtn').addEventListener('click', e => { e.stopPropagation(); openSheet(); });
$('city').addEventListener('click', e => { e.stopPropagation(); openSheet(); });
$('close').addEventListener('click', closeSheet);
sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
addEventListener('keydown', e => { if (e.key === 'Escape') { if (!sheet.hidden) closeSheet(); else if (EX.open) closeDetail(false); menu.classList.remove('open'); } });
$('gps').addEventListener('click', () => { $('gpsLbl').textContent = STR.locating; refresh(true).then(() => { $('gpsLbl').textContent = STR.useLoc; if (LOC && LOC.src === 'gps') closeSheet(); }); });
qIn.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = qIn.value.trim();
  if (q.length < 2) { results.innerHTML = ''; return; }
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    try {
      const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(q) + '&count=8&language=' + LANG + '&format=json');
      const j = await r.json();
      if (seq !== searchSeq) return;
      const list = j.results || [];
      results.innerHTML = list.length ? '' : '<div class="empty">' + STR.noRes + '</div>';
      for (const p of list) {
        const b = document.createElement('button');
        b.append(p.name);
        const sm = document.createElement('small'); sm.textContent = [p.admin1, p.country].filter(Boolean).join(', ');
        b.append(sm);
        b.addEventListener('click', () => { closeSheet(); LOC = { name: p.name, lat: p.latitude, lon: p.longitude, src: 'manual' }; $('cityName').textContent = p.name; refresh(); });
        results.append(b);
      }
    } catch (e) { if (seq === searchSeq) results.innerHTML = '<div class="empty">' + STR.offline + '</div>'; }
  }, 220);
});

/* =============================================================================
   PWA — manifest + icons generated in-page; sw.js for the offline shell
   ============================================================================= */
function iconSVG(maskable) {
  const s = maskable ? 0.78 : 1, o = (1 - s) * 256;
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs>' +
    '<linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2a55"/><stop offset="1" stop-color="#0a1024"/></linearGradient>' +
    '<radialGradient id="s" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#ffe08a"/><stop offset="1" stop-color="#ffb338"/></radialGradient>' +
    '<linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#cfd8e6"/></linearGradient></defs>' +
    '<rect width="512" height="512" fill="url(#b)"/><g transform="translate(' + o + ' ' + o + ') scale(' + s + ')">' +
    '<circle cx="205" cy="200" r="92" fill="url(#s)"/>' +
    '<path d="M168 392h196a78 78 0 0 0 9-155.5A110 110 0 0 0 162 260a68 68 0 0 0 6 132z" fill="url(#c)"/></g></svg>';
}
async function rasterize(svg, size) {
  const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await img.decode();
  const c = document.createElement('canvas'); c.width = c.height = size; c.getContext('2d').drawImage(img, 0, 0, size, size);
  return c.toDataURL('image/png');
}
async function installManifest() {
  try {
    const [p192, p512, m512] = await Promise.all([rasterize(iconSVG(false), 192), rasterize(iconSVG(false), 512), rasterize(iconSVG(true), 512)]);
    const start = location.href.split('#')[0].split('?')[0], scope = start.replace(/[^/]*$/, '');
    const manifest = { name: 'Ciel — weather', short_name: 'Ciel', id: scope, start_url: start, scope, display: 'standalone', orientation: 'portrait',
      background_color: '#000000', theme_color: '#000000', description: 'A live, ray-marched sky driven by real weather.',
      icons: [{ src: p192, sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: p512, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: m512, sizes: '512x512', type: 'image/png', purpose: 'maskable' }] };
    const add = (rel, href) => { const l = document.createElement('link'); l.rel = rel; l.href = href; document.head.append(l); };
    add('manifest', 'data:application/manifest+json;charset=utf-8,' + encodeURIComponent(JSON.stringify(manifest)));
    add('icon', p192); add('apple-touch-icon', p192);
  } catch (e) { }
}
function registerSW() {
  const okOrigin = location.protocol === 'https:' || location.hostname === 'localhost';
  if ('serviceWorker' in navigator && okOrigin && !window.Capacitor) navigator.serviceWorker.register('sw.js').catch(() => { });
}

/* debug overlay (triple-tap the sky, or ⋮ → stats) */
setInterval(() => {
  const n = frames; frames = 0;
  const d = $('dbg');
  if (d.hidden) return;
  d.textContent = (gpu ? 'WebGPU' : gl ? 'WebGL2' : 'no GPU') + ' · ' + (n * 2) + ' fps\n' + (emaMs ? emaMs.toFixed(2) : '–') + ' ms ' + (gpuTimed ? '(gpu)' : '(vsync ' + (refreshMs ? refreshMs.toFixed(1) : '–') + ')') +
    '\nscale ' + STEPS[stepIdx].toFixed(2) + '× · ' + cw + '×' + ch + (cHist[0] ? '\nclouds ' + cHist[0].w + '×' + cHist[0].h + ' · ' + CONFIG.quality.cloudSteps + ' steps' : '') +
    '\ndrops ' + dropsAlive + (idle ? ' · idle ' + CONFIG.quality.idleFps : ' · active') + (calm ? ' · calm' : '');
}, 500);

/* =============================================================================
   Boot
   ============================================================================= */
function onResize() {
  cssW = innerWidth; cssH = innerHeight;
  dpr = Math.min(devicePixelRatio || 1, CONFIG.quality.maxDpr);
  applyScale();
  measureSafe(); layoutHours(); measureWidgets(); prewarm(600);
}
function boot() {
  // Reduce Transparency: solid panels instead of see-through glass (HIG)
  if (matchMedia('(prefers-reduced-transparency: reduce)').matches) CONFIG.glassWidgets = false;
  if (!CONFIG.glassWidgets) document.body.classList.add('noglass');
  startRenderer();                       // WebGPU, else WebGL2 (async: the UI runs meanwhile)
  registerWidgets();
  setupMorph();
  $('hTitle').textContent = STR.hours;
  syncUnits();
  makeFormatters();
  onResize();
  addEventListener('resize', onResize);
  new ResizeObserver(() => { layoutHours(); onHScroll(); measureWidgets(); }).observe(content);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureWidgets);
  reduceMotion.addEventListener('change', e => { calm = e.matches; });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else { markInteraction(); start(); if (Date.now() - FETCHED > 10 * 60000) refresh(); }
  });
  enableTilt();
  const cached = store.get('ciel:v3');
  if (cached && cached.data && cached.loc) { AQ = cached.aq; applyData(cached.loc, cached.data, cached.t, true); }
  else { renderHero(); setStatus(''); }
  start();
  refresh();
  setInterval(() => {
    if (document.hidden) return;
    if (DATA && !scrubbing && !EX.active) { const keep = hscroll.scrollLeft; renderAll(); hscroll.scrollLeft = keep; updateTargets(); setStatus(); }
    if (Date.now() - FETCHED > CONFIG.refreshMinutes * 60000) refresh();
  }, 60000);
  installManifest();
  registerSW();
  window.ciel = { CONFIG, P, T, SC, scrubTo: k => hscroll.scrollTo({ left: k * colW }), open: key => openDetail(WG.find(w => w.key === key)), close: () => closeDetail(false), refresh, pause: stop, resume: start, scrollTo: y => { SC.y = y; SC.mode = 0; }, get frames() { return frameNo; }, get morph() { return MF.p; }, get ex() { return { open: EX.open, active: EX.active, drag: EX.drag, prog: EX.prog, dim: UI_DIM, s: Array.from(EX.s).map(v => +v.toFixed(1)) }; },
    step: dt => { uiUpdate(dt); drawFrame(dt); }, get renderer() { return gpu ? 'webgpu' : gl ? 'webgl2' : 'none'; },   // deterministic stepping for frame-by-frame tests
    // self-check of the celestial frame: the sun's RA/dec recovered from the local→equatorial matrix vs. the ephemeris
    sky: () => { const e = [0, 1, 2].map(i => EQM[i] * SUND[0] + EQM[3 + i] * SUND[1] + EQM[6 + i] * SUND[2]); return { ra: Math.atan2(e[1], e[0]), dec: Math.asin(e[2]), sra: A.sra, sdec: A.sdec }; } };
}
boot();
