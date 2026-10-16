// ═══ CIEL — sky compositor, WGSL twin of sky.frag (see there for the full notes) ═══
// refraction (drops, ripples, splashes) → view ray (reflected below the horizon)
// → atmosphere LUTs → stars + Milky Way → sun & moon → volumetric clouds →
// ACES + sRGB → lightning, water, fog → 3-D rain & snow → drops on the glass
#include atmos.wgsl
#include full.wgsl
const HZ = __HZ__;
struct U {
  resTime: vec4f,      // xy res, z time
  band: vec4f,         // xy cloud band
  camF: vec4f, camU: vec4f, camR: vec4f,
  tanv: vec4f,
  eqRot: mat3x3f,      // local → equatorial
  galRot: mat3x3f,     // local → galactic
  sunDir: vec4f, moonDir: vec4f, moonR: vec4f, moonU: vec4f,
  sun: vec4f,          // x disk visibility, y sin(elevation)
  moon: vec4f,         // x visibility, y illuminated fraction
  moonL: vec4f,        // light direction on the moon's disk
  light: vec4f,        // x sun, y moon illuminance; w exposure
  night: vec4f,        // linear night-sky floor
  drift2: vec4f,       // zw fog drift
  cloud: vec4f,        // low, mid, high cover, precipitation darkness
  wx: vec4f,           // rain, snow, fog, storm
  wind: vec4f,         // x rain slant
  flash: vec4f,        // xy screen centre, z intensity, w bolt
  bolt: vec4f,
  rip: array<vec4f, 6>,
  w: vec4f,            // light regimes: night, twilight, golden, day
  eye: vec4f,          // eye offset (m) for parallax; z camera yaw
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tNoise: texture_2d<f32>;
@group(0) @binding(2) var tField: texture_2d<f32>;
@group(0) @binding(3) var tClouds: texture_2d<f32>;
@group(0) @binding(4) var tGlass: texture_2d<f32>;
@group(0) @binding(5) var tTrans: texture_2d<f32>;
@group(0) @binding(6) var tSkyS: texture_2d<f32>;
@group(0) @binding(7) var tSkyM: texture_2d<f32>;
@group(0) @binding(8) var tMilky: texture_2d<f32>;
@group(0) @binding(9) var sClamp: sampler;
@group(0) @binding(10) var sRep: sampler;
@group(0) @binding(11) var sMilky: sampler;

fn aces(x: vec3f) -> vec3f { return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0)); }
fn toDisplay(lin: vec3f) -> vec3f {
  let c = pow(aces(lin), vec3f(1.0 / 2.2));
  let l = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  return clamp(mix(vec3f(l), c, 1.32), vec3f(0.0), vec3f(1.0));
}
fn bsplineRGBA(uv: vec2f) -> vec4f {
  let ts = vec2f(textureDimensions(tClouds));
  let st = uv * ts - 0.5;
  let i = floor(st);
  let f = st - i;
  let f2 = f * f;
  let f3 = f2 * f;
  let w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  let w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  let w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  let w3 = f3 / 6.0;
  let g0 = w0 + w1;
  let g1 = w2 + w3;
  let h0 = (i - 0.5 + w1 / g0) / ts;
  let h1 = (i + 1.5 + w3 / g1) / ts;
  return (textureSampleLevel(tClouds, sClamp, vec2f(h0.x, h0.y), 0.0) * g0.x + textureSampleLevel(tClouds, sClamp, vec2f(h1.x, h0.y), 0.0) * g1.x) * g0.y
       + (textureSampleLevel(tClouds, sClamp, vec2f(h0.x, h1.y), 0.0) * g0.x + textureSampleLevel(tClouds, sClamp, vec2f(h1.x, h1.y), 0.0) * g1.x) * g1.y;
}
fn skyAt(d: vec3f) -> vec3f { return skyLookup(tSkyS, sClamp, d, u.sunDir.xyz) * u.light.x + skyLookup(tSkyM, sClamp, d, u.moonDir.xyz) * u.light.y; }
fn hash12(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
fn hash22(p: vec2f) -> vec2f {
  var p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
fn starFace(f: vec2f, scale: f32, thresh: f32, pxr: f32) -> f32 {
  let sp = f * scale;
  let id = floor(sp);
  let c = fract(sp) - 0.5;
  let h = hash22(id);
  let pres = step(thresh, hash12(id + 19.19));
  let r = pxr * scale;
  let d = length(c - (h - 0.5) * 0.7);
  let tw = 0.62 + 0.38 * sin(u.resTime.z * (1.1 + h.y * 2.6) + h.x * 40.0);
  return ss(r * 1.9, r * 0.25, d) * pres * tw * (0.35 + 0.65 * h.y);
}
fn stars(d: vec3f, pxr: f32) -> f32 {
  let a = abs(d);
  let mx = step(a.y, a.x) * step(a.z, a.x);
  let my = (1.0 - mx) * step(a.x, a.y) * step(a.z, a.y);
  let mz = 1.0 - mx - my;
  let fx = d.yz / a.x;
  let fy = d.xz / a.y;
  let fz = d.xy / a.z;
  let s1 = starFace(fx + sign(d.x) * 3.1, 90.0, 0.972, pxr) * mx + starFace(fy + sign(d.y) * 5.7, 90.0, 0.972, pxr) * my + starFace(fz + sign(d.z) * 7.3, 90.0, 0.972, pxr) * mz;
  let s2 = starFace(fx + 1.3, 38.0, 0.984, pxr) * mx + starFace(fy + 2.9, 38.0, 0.984, pxr) * my + starFace(fz + 4.1, 38.0, 0.984, pxr) * mz;
  return s1 + s2 * 1.5;
}
fn rainCyl(ang: f32, el: f32, R: f32, slant: f32, dens: f32, pxm: f32) -> f32 {
  let cw = R * 0.05;
  let chh = R * 0.26 + 0.3;
  var uu = ang * R - u.eye.x;
  let v = el * R - u.eye.y;
  uu += v * slant;
  let st = vec2f(uu / cw, (v + u.resTime.z * 9.0) / chh);
  var id = floor(st);
  let f = fract(st);
  id.y = fmod(id.y, 256.0);
  let h = hash22(id + R * 1.7);
  let pres = step(hash12(id + 7.7 + R), dens);
  let len = 0.16 / chh;
  let wid = max(0.0022 + 0.005 / R, pxm * R * 0.65);
  let x = abs(f.x - (0.12 + 0.76 * h.x)) * cw;
  let y = (f.y - h.y * (1.0 - len)) / len;
  let body = ss(0.0, 0.25, y) * (1.0 - ss(0.55, 1.0, y));
  let k = clamp(0.0045 / wid, 0.12, 1.0);
  return (1.0 - ss(wid * 0.25, wid, x)) * body * pres * k * step(-1.6, v);
}
fn snowCyl(ang: f32, el: f32, R: f32, slant: f32, dens: f32, pxm: f32) -> f32 {
  let cs = R * 0.13 + 0.05;
  var uu = ang * R - u.eye.x;
  let v = el * R - u.eye.y;
  uu += v * slant;
  var st = vec2f(uu / cs, (v + u.resTime.z * 1.1) / cs);
  st.x += sin(st.y * 0.9 + u.resTime.z * 0.8 + R) * 0.22;
  var id = floor(st);
  let f = fract(st);
  id.y = fmod(id.y, 256.0);
  let h = hash22(id + R * 3.1);
  let pres = step(hash12(id + 3.3 + R), dens);
  let rad = max(0.006 + 0.012 / R, pxm * R * 0.7);
  let d = length((f - (0.5 + (h - 0.5) * 0.6)) * cs);
  let k = clamp(0.008 / rad, 0.2, 1.0) * (0.55 + 0.45 * h.y);
  return ss(rad, rad * 0.2, d) * pres * k * step(-1.6, v);
}

@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let res = u.resTime.xy;
  let time = u.resTime.z;
  let uv = fc.xy / res;
  let aspect = res.x / res.y;
  let p = vec2f((uv.x - 0.5) * aspect, uv.y);
  let water = step(p.y, HZ);
  let camF = u.camF.xyz;
  let camU = u.camU.xyz;
  let camR = u.camR.xyz;
  let tanv = u.tanv.xy;
  let exposure = u.light.w;
  let uNight = u.night.xyz;

  // 0. refraction
  let gw = textureSampleLevel(tGlass, sClamp, uv, 0.0);
  let ga = clamp(gw.a * 6.0 - 3.0, 0.0, 1.0);
  var rOff = vec2f(gw.g - 0.5, 0.5 - gw.r) * 2.0 * ga * 0.045;
  var rGlow = 0.0;
  for (var i = 0; i < 6; i++) {
    let r = u.rip[i];
    var d = p - r.xy;
    d.y *= 1.0 + water * 1.8;
    let dist = length(d) + 1e-4;
    let k = dist - r.z * 0.30;
    let env = exp(-k * k * 500.0) * r.w * exp(-r.z * 1.5);
    let wv = sin(k * 150.0);
    rOff += d / dist * wv * env * 0.010;
    rGlow += env * (0.5 + 0.5 * wv);
  }
  {
    let wp = vec2f(p.x, 1.0) / max(HZ - p.y, 0.015) * 6.0;
    let id = floor(wp);
    let f = fract(wp) - 0.5;
    let h = hash22(id + 31.7);
    let t = fract(time * (0.6 + h.x * 0.8) + h.y);
    let pres = step(h.x * 0.7 + h.y * 0.3, u.wx.x * 0.9);
    let rk = (length(f - (h - 0.5) * 0.5) - t * 0.45) * 22.0;
    let ring = exp(-rk * rk) * (1.0 - t) * (1.0 - t) * pres * water;
    rOff.y += ring * 0.004;
    rGlow += ring * 0.8;
  }
  let ps = p + rOff;

  // 1. view ray (reflected below the horizon)
  let ndc = vec2f(ps.x / (aspect * 0.5), ps.y * 2.0 - 1.0);
  var rd = normalize(camF + camR * (ndc.x * tanv.x) + camU * (ndc.y * tanv.y));
  let rv = rd;
  rd.y = mix(rd.y, max(-rd.y, 0.0015), water);
  rd.y = max(rd.y, 0.0015);
  rd = normalize(rd);
  let cz = max(dot(rd, camF), 1e-3);
  let cn = vec2f(dot(rd, camR) / (cz * tanv.x), dot(rd, camU) / (cz * tanv.y));
  let cuv = vec2f(cn.x * 0.5 + 0.5, ((cn.y * 0.5 + 0.5) - u.band.x) / (u.band.y - u.band.x));

  // 2. atmosphere
  let wN = u.w.x; let wT = u.w.y; let wG = u.w.z; let wD = u.w.w;
  let e = u.sun.y;
  let dayL = wD + wG * 0.75 + wT * 0.3;
  let moonLight = u.moon.x * u.moon.y;
  let cover = max(u.cloud.x, u.cloud.y * 0.85);
  var Ls = skyAt(rd);
  let lum0 = dot(Ls, vec3f(0.2126, 0.7152, 0.0722));
  Ls = mix(Ls, vec3f(lum0) * vec3f(0.95, 0.97, 1.0) * (1.0 - 0.5 * u.cloud.w), ss(0.55, 1.0, cover) * (0.22 + 0.38 * ss(0.05, 0.35, u.cloud.w)));
  var col = Ls * exposure + uNight * (1.0 - dayL);

  // 3. stars + Milky Way
  let pxr = 2.2 * tanv.y / res.y;
  let dark = clamp(1.0 - lum0 * exposure * 30.0, 0.0, 1.0);
  let starVis = dark * ss(0.0, 0.12, rd.y) * (1.0 - u.wx.z) * (1.0 - ss(0.45, 0.9, cover));
  let g = u.galRot * rd;
  let guv = vec2f(0.5 - atan2(g.y, g.x) / (2.0 * PI), 0.5 - asin(clamp(g.z, -1.0, 1.0)) / PI);
  let mw = pow(textureSampleLevel(tMilky, sMilky, guv, 0.0).rgb, vec3f(2.2));
  col += (vec3f(0.82, 0.88, 1.0) * stars(u.eqRot * rd, pxr) * 0.8 + mw * 0.7) * starVis;

  // 4. sun & moon
  let cs = dot(rd, u.sunDir.xyz);
  let ds = 1.0 - cs;
  let sunT = transmit(tTrans, sClamp, RG + CAM_H, e) * u.light.x;
  let dr = ds / 1.25e-4;
  let disk = (1.0 - ss(0.85, 1.0, dr)) * (0.55 + 0.45 * sqrt(max(1.0 - dr, 0.0)));
  let glare = exp(-ds * 900.0) * 0.9 + exp(-ds * 90.0) * 0.08;
  col += sunT * (disk * 60.0 * u.sun.x * (1.0 - ss(0.7, 1.0, cover)) + glare * (1.0 - cover * 0.7)) * exposure * 0.1;

  let cm = dot(rd, u.moonDir.xyz);
  let md = vec2f(dot(rd, u.moonR.xyz), dot(rd, u.moonU.xyz)) / 0.0245;
  let mr2 = dot(md, md);
  let inMoon = ss(1.06, 0.94, mr2) * step(0.0, cm) * u.moon.x * (1.0 - ss(0.7, 1.0, cover)) * mix(1.0, ss(0.10, 0.30, u.moon.y), dayL);
  let mn = vec3f(md, sqrt(max(1.0 - mr2, 0.0)));
  let mlit = ss(-0.06, 0.10, dot(mn, u.moonL.xyz));
  let mare = textureSample(tNoise, sRep, md * 0.11 + vec2f(0.43, 0.17)).r;
  let moonT = transmit(tTrans, sClamp, RG + CAM_H, u.moonDir.y);
  col = mix(col, col * (1.0 - dark) + vec3f(0.95, 0.93, 0.88) * moonT * (0.70 + (mare - 0.5) * 0.9) * mlit * 1.1, inMoon);
  col += vec3f(0.75, 0.80, 0.95) * exp(-(1.0 - cm) * 60.0) * 0.06 * moonLight * dark * (1.0 - cover * 0.7);

  // 5. volumetric clouds (cubic B-spline upscale)
  var cl = bsplineRGBA(cuv);
  cl *= step(cuv.y, 1.0);
  col = col * (1.0 - cl.a) + cl.rgb * exposure;

  // → display
  col = toDisplay(col);
  let hzD = toDisplay(skyAt(normalize(vec3f(rd.x, 0.02, rd.z))) * exposure + uNight);

  // 6. lightning, water, fog
  let q = vec2f(ps.x, mix(ps.y, 2.0 * HZ - ps.y, water));
  col += vec3f(0.72, 0.78, 1.0) * u.flash.z * (0.25 + 1.4 * exp(-length(q - u.flash.xy) * 4.5)) * (0.2 + cl.a * 0.8);
  let by = q.y;
  let bx = u.bolt.x + 0.055 * sin(by * 13.0 + u.bolt.y) + 0.025 * sin(by * 37.0 + u.bolt.y * 2.3) + 0.010 * sin(by * 97.0 + u.bolt.y * 5.1);
  let bd = abs(q.x - bx);
  col += vec3f(0.85, 0.88, 1.0) * (exp(-bd * res.y * 0.45) + exp(-bd * 40.0) * 0.25) * ss(0.70, 0.52, by) * ss(HZ, HZ + 0.02, by) * u.flash.z * u.flash.w;

  let depth = clamp((HZ - p.y) / HZ, 0.0, 1.0);
  col = mix(col, col * mix(0.86, 0.16, sqrt(depth)) * vec3f(0.92, 0.96, 1.0), water);
  let band = exp(-abs(p.y - HZ) * 34.0);
  col = mix(col, hzD, band * 0.55) + hzD * exp(-abs(p.y - HZ) * 260.0) * 0.06;
  let lum = dot(col, vec3f(0.299, 0.587, 0.114));

  let fogN = textureSample(tNoise, sRep, vec2f(p.x * 0.9, p.y * 2.2) + u.drift2.zw).g;
  let fogA = u.wx.z * (0.50 + 0.50 * fogN) * (1.0 - 0.55 * ss(HZ, 0.95, p.y));
  col = mix(col, mix(vec3f(0.025, 0.027, 0.032), vec3f(0.74, 0.76, 0.80), dayL) * 0.85 + hzD * 0.2, clamp(fogA, 0.0, 0.92));

  // 7. rain & snow in 3-D
  let rain = u.wx.x;
  let snow = u.wx.y;
  if (rain + snow > 0.01) {
    let fh = normalize(vec3f(camF.x, 0.0, camF.z));
    let ang = atan2(dot(rv, camR), dot(rv, fh)) + u.eye.z;
    let el = rv.y / max(length(rv.xz), 1e-3);
    let pxm = 2.0 * tanv.y / res.y;
    let sl = u.wind.x * 1.4;
    if (rain > 0.01) {
      let ra = rainCyl(ang, el, 1.4, sl, rain * 0.35, pxm) * 0.55 + rainCyl(ang, el, 2.6, sl, rain * 0.5, pxm) * 0.8
             + rainCyl(ang, el, 4.8, sl, rain * 0.7, pxm) + rainCyl(ang, el, 9.0, sl, rain * 0.85, pxm)
             + rainCyl(ang, el, 17.0, sl, rain, pxm) * 0.9 + rainCyl(ang, el, 32.0, sl, rain, pxm) * 0.8;
      col = mix(col, hzD * 0.85, rain * 0.16 * (1.0 - water * 0.5));
      col += (0.07 + 0.55 * lum) * vec3f(0.82, 0.88, 1.0) * clamp(ra, 0.0, 1.4) * 0.55;
    }
    if (snow > 0.01) {
      let s = snowCyl(ang, el, 1.2, sl * 0.6, snow * 0.4, pxm) * 0.7 + snowCyl(ang, el, 2.4, sl * 0.6, snow * 0.6, pxm)
            + snowCyl(ang, el, 4.5, sl * 0.6, snow * 0.8, pxm) + snowCyl(ang, el, 8.5, sl * 0.6, snow, pxm) * 0.85
            + snowCyl(ang, el, 16.0, sl * 0.6, snow, pxm) * 0.7;
      col = mix(col, vec3f(0.93, 0.95, 1.0) * (0.18 + 0.82 * max(dayL, moonLight * 0.5)), clamp(s, 0.0, 1.0) * 0.92);
    }
  }

  // 8. drops on the glass
  let lowRim = ss(0.40, 0.08, gw.r) * ga;
  let spec = ss(0.70, 0.97, gw.g) * ss(0.35, 0.55, gw.r) * ga;
  col = col * (1.0 - lowRim * 0.28) * (1.0 + ga * 0.06) + spec * (0.12 + lum * 0.45);
  col += rGlow * 0.07 * (0.15 + lum);

  let mxc = max(col.r, max(col.g, col.b));
  col += (hash12(fc.xy + fract(time) * 91.7) - 0.5) * (1.5 / 255.0) * step(0.006, mxc);
  return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
