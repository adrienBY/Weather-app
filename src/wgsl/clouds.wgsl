// ── Volumetric clouds — WGSL twin of clouds.frag (see there for the full notes) ──
// Spherical cloud shell above a curved Earth; real Perlin-Worley shape + Worley
// erosion volumes (lightest/clouds, MIT); adaptive march with back-up/refine;
// atmosphere-attenuated sun/moon, 5-sample shadow rays + a detailed short one,
// beer-powder, dual-lobe HG, multiple-scattering octaves, aerial perspective.
// Traced at a quarter of the band buffer per frame; resolve.wgsl accumulates.
#include atmos.wgsl
#include full.wgsl
const STEPS = __STEPS__;
struct U {
  resJit: vec4f,       // xy this (quarter) buffer, zw traced sub-pixel (0/1, 0/1)
  bandClear: vec4f,    // xy screen-y band (bottom, top), zw clear radius overhead + soft edge (km)
  camF: vec4f,         // xyz, w frame number
  camU: vec4f,
  camR: vec4f,
  tanv: vec4f,         // xy tan half-fov
  sunDir: vec4f,
  moonDir: vec4f,
  lightDir: vec4f,     // shadowing direction
  light: vec4f,        // x sun illuminance, y moon illuminance, z sun share of lightDir
  weather: vec4f,      // coverage, stratiform, density, darkness
  windOff: vec4f,      // xy weather drift (km), z evolution, w erosion drift
  flash: vec4f,        // xyz direction, w intensity
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tShape: texture_3d<f32>;
@group(0) @binding(2) var tErosion: texture_3d<f32>;
@group(0) @binding(3) var tWeather: texture_2d<f32>;
@group(0) @binding(4) var tField: texture_2d<f32>;
@group(0) @binding(5) var tTrans: texture_2d<f32>;
@group(0) @binding(6) var tSkyS: texture_2d<f32>;
@group(0) @binding(7) var tSkyM: texture_2d<f32>;
@group(0) @binding(8) var sRep: sampler;
@group(0) @binding(9) var sClamp: sampler;

fn remap(v: f32, l0: f32, h0: f32, l1: f32, h1: f32) -> f32 { return l1 + (v - l0) * (h1 - l1) / (h0 - l0); }
fn shell(roc: vec3f, rd: vec3f, r: f32) -> f32 { let b = dot(roc, rd); let c = dot(roc, roc) - r * r; return -b + sqrt(max(b * b - c, 0.0)); }
fn profile(h: f32, strat: f32) -> f32 {
  var cu = mix(ss(0.0, 0.08, h * h), 1.0 - ss(0.25, 1.0, h), h);
  cu *= ss(0.0, 0.04, h) * (1.0 - ss(0.92, 1.0, h));
  let st = ss(0.0, 0.10, h) * (1.0 - ss(0.26, 0.48, h));
  return mix(cu, st, strat);
}
fn cloudPhase(c: f32, k: f32) -> f32 { return mix(hgPhase(0.85 * k, c), hgPhase(-0.2 * k, c), 0.5); }
fn transmitSoft(r: f32, mu: f32) -> vec3f {
  let muH = -sqrt(max(1.0 - (RG * RG) / (r * r), 0.0));
  return textureSampleLevel(tTrans, sClamp, transUV(r, max(mu, muH + 0.004)), 0.0).rgb * ss(muH - 0.03, muH + 0.012, mu);
}
var<private> gCov: f32;
var<private> gStrat: f32;
var<private> gDens: f32;
var<private> gHB: f32;
var<private> gTh: f32;
var<private> gLod: f32;
fn cellAt(wp: vec2f, horiz: f32) -> vec3f {
  let wm2 = textureSampleLevel(tWeather, sRep, wp * 0.032, 0.0).rg;
  let wm = wm2.r * 0.78 + textureSampleLevel(tWeather, sRep, wp * 0.079 + 0.37, 0.0).r * 0.22;
  let cc = mix(min(gCov, 0.62), gCov, gStrat);
  var cell = ss(1.0 - cc - 0.10, 1.0 - cc + 0.14, wm);
  cell *= ss(u.bandClear.z - u.bandClear.w, u.bandClear.z + u.bandClear.w, horiz);
  let lc = cell * mix(0.62, 0.95, gCov);
  let tow = mix(mix(0.45, 0.75, gCov) + 0.55 * wm2.g, 1.0, gStrat);
  return vec3f(lc, tow, wm);
}
fn coarse(q: vec3f, h: f32, lc: f32, tow: f32) -> f32 {
  return clamp(remap(textureSampleLevel(tShape, sRep, q * 0.22, gLod).r * profile(clamp(h / tow, 0.0, 1.0), gStrat), 1.0 - lc, 1.0, 0.0, 1.0), 0.0, 1.0);
}
fn skyAt(rd: vec3f) -> vec3f {
  return skyLookup(tSkyS, sClamp, rd, u.sunDir.xyz) * u.light.x + skyLookup(tSkyM, sClamp, rd, u.moonDir.xyz) * u.light.y;
}

@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let jitv = u.resJit.zw;
  let hres = u.resJit.xy * 2.0;
  let hv = (floor(fc.xy) * 2.0 + jitv + 0.5) / hres;
  let band = u.bandClear.xy;
  let sy = band.x + hv.y * (band.y - band.x);
  var ndc = vec2f(hv.x * 2.0 - 1.0, sy * 2.0 - 1.0);
  ndc += (textureSampleLevel(tField, sClamp, vec2f(hv.x, sy), 0.0).xy * 2.0 - 1.0) * 0.07;
  var rd = normalize(u.camF.xyz + u.camR.xyz * (ndc.x * u.tanv.x) + u.camU.xyz * (ndc.y * u.tanv.y));
  rd = normalize(vec3f(rd.x, max(rd.y, 0.006), rd.z));
  let hl = max(length(rd.xz), 1e-3);
  let pxAng = 2.0 * u.tanv.y * (band.y - band.x) / hres.y;
  let sunDir = u.sunDir.xyz;
  let moonDir = u.moonDir.xyz;
  let lightDir = u.lightDir.xyz;

  gCov = u.weather.x; gStrat = u.weather.y; gDens = u.weather.z;
  gHB = mix(1.4, 0.8, gStrat); gTh = mix(3.2, 1.2, gStrat);
  let C = vec3f(0.0, -RG, 0.0);
  let ro = vec3f(0.0, CAM_H, 0.0);
  let roc = ro - C;
  var t0 = shell(roc, rd, RG + gHB);
  var t1 = shell(roc, rd, RG + gHB + gTh);
  t0 = max(t0, (u.bandClear.z - u.bandClear.w) / hl);
  t1 = min(t1, min(t0 + 34.0, 41.0 / hl));
  let bandFade = 1.0 - ss(0.80, 1.0, hv.y) * step(band.y, 0.999);

  var j3 = fract(vec3f(fc.xy, jitv.x + 2.0 * jitv.y) * vec3f(0.1031, 0.1030, 0.0973));
  j3 += dot(j3, j3.yzx + 33.33);
  let jit = fract((j3.x + j3.y) * j3.z + floor(u.camF.w / 4.0) * 0.6180340);

  let ct = dot(rd, lightDir);
  let flat_ = mix(1.0, 0.45, gStrat);
  let ph0 = cloudPhase(ct, flat_);
  let ph1 = cloudPhase(ct, 0.7 * flat_);
  let ph2 = cloudPhase(ct, 0.49 * flat_);
  let up = vec3f(0.0, 1.0, 0.0);
  let skyZ = skyLookup(tSkyS, sClamp, up, sunDir) * u.light.x + skyLookup(tSkyM, sClamp, up, moonDir) * u.light.y;
  let skyH = skyLookup(tSkyS, sClamp, normalize(vec3f(-sunDir.x, 0.15, -sunDir.z)), sunDir) * u.light.x;
  let skyHs = skyLookup(tSkyS, sClamp, normalize(vec3f(sunDir.x, 0.10, sunDir.z)), sunDir) * u.light.x;
  let ambTop = (skyZ * 1.1 + skyH * 0.4 + skyHs * 0.35) * (1.0 - 0.45 * gCov * gStrat);
  let sunZ = sunDir.y;
  let ground = transmit(tTrans, sClamp, RG, sunZ) * max(sunZ, 0.0) * u.light.x + transmit(tTrans, sClamp, RG, moonDir.y) * max(moonDir.y, 0.0) * u.light.y;
  let ambBot = ground * (0.08 / PI) * (1.0 - 0.6 * gCov) + ambTop * 0.10;
  var SD5 = array<f32, 5>(0.12, 0.38, 0.85, 1.7, 3.1);
  var SW5 = array<f32, 5>(0.24, 0.36, 0.60, 1.10, 1.90);

  var L = vec3f(0.0);
  var T = 1.0;
  var tw = 0.0;
  var aw = 0.0;
  var t = t0 + clamp(t0 * 0.0055, 0.05, 0.36) * jit;
  var nIn = 0.0;
  var emp = 0.0;
  var tSafe = t0;
  var ref_ = 0.0;
  for (var i = 0; i < STEPS; i++) {
    if (t > t1 || T < 0.02) { break; }
    let p = ro + rd * t;
    let pc = p - C;
    let rp = length(pc);
    let h = clamp((rp - RG - gHB) / gTh, 0.0, 1.0);
    let wp = p.xz + u.windOff.xy;
    gLod = max(0.0, log2(t * pxAng / 0.071));
    let cl = cellAt(wp, t * hl);
    let lc = cl.x * bandFade * (1.0 - ss(26.0, 40.0, t * hl));
    let tow = cl.y;
    let q = vec3f(wp.x, p.y + u.windOff.z, wp.y);
    var dtS = clamp(t * 0.0055, 0.05, 0.36);
    if (nIn < 3.0) { dtS *= 0.5; }
    var c = 0.0;
    if (lc > 0.004) { c = coarse(q, h, lc, tow); }
    if (c <= 0.0) {
      tSafe = t; emp += 1.0;
      if (ref_ > 0.0) { t += dtS; } else { t += dtS * min(1.0 + 0.5 * emp, 6.0) * (0.85 + 0.3 * jit); }
      ref_ = max(ref_ - 1.0, 0.0);
      continue;
    }
    if (emp > 1.5 && ref_ <= 0.0) { t = tSafe + dtS * (0.5 + 0.5 * jit); emp = 0.0; nIn = 0.0; ref_ = 12.0; continue; }
    emp = 0.0; ref_ = 0.0;
    var er = textureSampleLevel(tErosion, sRep, q * 0.32 + u.windOff.w, gLod).r;
    er = mix(er, 1.0 - er, clamp(h * 4.0, 0.0, 1.0));
    let ew = 0.18 * (1.0 - 0.7 * ss(14.0, 45.0, t));
    let lk = 0.65 + 0.35 * lc;
    let d = ss(0.0, 0.34, clamp(remap(c, er * ew, 1.0, 0.0, 1.0), 0.0, 1.0)) * lk * gDens;
    if (d > 0.0005) {
      var od = 0.0;
      for (var k = 0; k < 5; k++) {
        let sd = SD5[k];
        let lq = q + lightDir * sd;
        let lh = clamp((h + lightDir.y * sd / gTh) / tow, 0.0, 1.0);
        let sc = clamp(remap(textureSampleLevel(tShape, sRep, lq * 0.22, gLod + 1.0 + f32(k) * 0.6).r * profile(lh, gStrat), 1.0 - lc, 1.0, 0.0, 1.0), 0.0, 1.0);
        od += sc * SW5[k];
      }
      {
        let lq = q + lightDir * 0.12;
        let lh = clamp((h + lightDir.y * 0.12 / gTh) / tow, 0.0, 1.0);
        let sc = clamp(remap(textureSampleLevel(tShape, sRep, lq * 0.22, gLod).r * profile(lh, gStrat), 1.0 - lc, 1.0, 0.0, 1.0), 0.0, 1.0);
        let le = textureSampleLevel(tErosion, sRep, lq * 0.32 + u.windOff.w, gLod).r;
        let ed = clamp(remap(sc, mix(le, 1.0 - le, clamp(lh * 4.0, 0.0, 1.0)) * 0.22, 1.0, 0.0, 1.0), 0.0, 1.0);
        od += (ed - sc) * 0.6;
      }
      od = od * lk * gDens * 22.0 + gStrat * gCov * 3.5;
      let nUp = pc / rp;
      let Lc = transmitSoft(rp, dot(nUp, sunDir)) * (u.light.x * u.light.z) + transmitSoft(rp, dot(nUp, moonDir)) * (u.light.y * (1.0 - u.light.z));
      let ms = ph0 * exp(-od) + 0.50 * ph1 * exp(-od * 0.40) + 0.25 * ph2 * exp(-od * 0.15);
      let powder = mix(1.0 - exp(-d * 9.0), 1.0, clamp(ct * 0.5 + 0.5, 0.0, 1.0) * 0.6 + 0.2);
      let amb = mix(ambBot, ambTop, h) * (0.30 + 0.70 * pow(h, 0.7));
      let S = Lc * ms * powder * 4.6 + amb * 0.9;
      let dtE = dtS * mix(3.0, 1.0, ss(0.0, 0.25, d));
      let Ts = exp(-d * 16.0 * dtE);
      let w = T * (1.0 - Ts);
      L += w * S;
      tw += w * t; aw += w; nIn += 1.0;
      T *= Ts;
    }
    t += dtS * mix(3.0, 1.0, ss(0.0, 0.25, d));
  }
  L += u.flash.w * vec3f(0.75, 0.80, 1.0) * 0.08 * (1.0 - T) * (0.35 + 1.8 * pow(max(dot(rd, u.flash.xyz), 0.0), 6.0));
  let a = 1.0 - T;
  var depth = t0;
  if (aw > 1e-4) { depth = tw / aw; }
  let skyRd = skyAt(rd);
  let fog = exp(-depth * 0.018) * ss(0.0, 0.10, rd.y);
  L = mix(skyRd * a, L, fog);
  return vec4f(min(L, vec3f(2000.0)), a);
}
