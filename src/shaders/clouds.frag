#version 300 es
/* ── Volumetric clouds ───────────────────────────────────────────────────────
   Ray-marched through a spherical cloud shell above a curved Earth.

   Framing a photographer would choose: in fair weather the sky overhead stays
   clear and the cumulus stand as a distant bank, 9 – 40 km out: tops under
   the temperature, bases melting into the haze. Only rain, snow and fog
   bring the deck overhead. The bank lives in its own buffer band (uBand),
   so every pixel of the buffer is spent on cloud.

   Shape   real Perlin-Worley noise volumes from lightest/clouds (Nikita
           Agafonov, MIT): a 64³ billow "shape" volume, eroded at the edges
           by a 32³ Worley "erosion" volume, both tileable. The weather map
           (same repo, histogram-equalised at build time) places cloud cells:
           the forecast's cover sets how much of the bank they fill, and the
           cloudier it gets the more and the taller they grow. Height signal
           after lightest/clouds: flat bases, rounded tops.

   March   adaptive: fine strides where there is cloud, growing geometrically
           through empty air, with a single back-up and refine on each hit
           (after Schneider 2015). Strides scale with distance: the same
           sampling per pixel near and far — smooth surfaces, no stipple.

   Light   the sun (or moon) attenuated by the physical atmosphere
           (transmittance LUT) per sample and per altitude. Shadow rays: 5
           samples out to ~3 km (dark, flat bases) plus a detailed short one
           (billows shading billows). Beer-powder, dual-lobe Henyey-Greenstein,
           two octaves of multiple scattering, sky ambient occluded toward
           the base. Aerial perspective fades by the transmittance-weighted
           depth into the real horizon radiance.

   Cost    traced at a QUARTER of the band buffer per frame (4 rotating
           sub-pixels, jittered start); resolve.frag folds them into a
           temporal history. Output: premultiplied linear radiance. */
precision highp float;
precision highp sampler3D;
precision mediump sampler2D;
#define STEPS __STEPS__
#include atmos.glsl
uniform sampler3D uShape;
uniform sampler3D uErosion;
uniform sampler2D uWeatherMap;
uniform sampler2D uField;
uniform sampler2D uTrans;
uniform sampler2D uSkyS, uSkyM;   // sky-view LUTs for the sun and the moon
uniform vec2  uRes;              // this (quarter) buffer
uniform vec2  uJit;              // which history sub-pixel is traced this frame (0/1, 0/1)
uniform vec2  uBand;             // screen-y range the buffer covers (bottom, top)
uniform vec2  uClear;            // x clear radius overhead (km), y its soft edge (km)
uniform vec3  uCamF, uCamU, uCamR;
uniform vec2  uTan;
uniform vec3  uSunDir, uMoonDir;
uniform vec3  uLightDir;         // shadowing direction: the sun, handing over to the moon
uniform vec3  uLight;            // x sun illuminance, y moon illuminance, z sun share of uLightDir
uniform vec4  uWeather;          // coverage, stratiform, density, darkness
uniform vec4  uWindOff;          // xy weather drift (km), z evolution, w erosion drift
uniform float uFrame;
uniform vec4  uFlash;            // xyz direction, w intensity
out vec4 o;

float remap(float v, float l0, float h0, float l1, float h1) { return l1 + (v - l0) * (h1 - l1) / (h0 - l0); }
float shell(vec3 roc, vec3 rd, float r) { float b = dot(roc, rd), c = dot(roc, roc) - r * r; return -b + sqrt(max(b * b - c, 0.0)); }
// lightest/clouds height signal (squared base ramp, soft top) blended with a flat stratus slab
float profile(float h, float strat) {
  float cu = mix(smoothstep(0.0, 0.08, h * h), 1.0 - smoothstep(0.25, 1.0, h), h);
  cu *= smoothstep(0.0, 0.04, h) * (1.0 - smoothstep(0.92, 1.0, h));
  float st = smoothstep(0.0, 0.10, h) * (1.0 - smoothstep(0.26, 0.48, h));
  return mix(cu, st, strat);
}
// dual-lobe HG (forward 0.85, back −0.2), 50/50 — the lightest/clouds cloud phase
float cloudPhase(float c, float k) { return mix(hgPhase(0.85 * k, c), hgPhase(-0.2 * k, c), 0.5); }

// sunlight reaching radius r, with a soft Earth-shadow edge (~2°): at dusk the
// last light climbs the towers as a gradient instead of flickering across billows
vec3 transmitSoft(sampler2D Tr, float r, float mu) {
  float muH = -sqrt(max(1.0 - (RG * RG) / (r * r), 0.0));
  return texture(Tr, transUV(r, max(mu, muH + 0.004))).rgb * smoothstep(muH - 0.03, muH + 0.012, mu);
}
float gCov, gStrat, gDens, gHB, gTh, gLod;   // gLod: shape-volume mip for the current sample's pixel footprint
// local coverage and tower height at a point (weather map only — cheap)
vec3 cellAt(vec2 wp, float horiz) {
  // explicit LODs everywhere in the march: inside its branches implicit
  // derivatives are undefined and would pick random (blocky) mip levels
  vec2 wm2 = textureLod(uWeatherMap, wp * 0.032, 0.0).rg;
  float wm = wm2.r * 0.78 + textureLod(uWeatherMap, wp * 0.079 + 0.37, 0.0).r * 0.22;
  // cells never close completely (≤ 62 % of the bank) unless it rains: a cloudy
  // sky stays sculpted — more and taller masses, darker gaps — not a grey lid
  float cc = mix(min(gCov, 0.62), gCov, gStrat);
  float cell = smoothstep(1.0 - cc - 0.10, 1.0 - cc + 0.14, wm);
  cell *= smoothstep(uClear.x - uClear.y, uClear.x + uClear.y, horiz);     // clear sky overhead
  float lc = cell * mix(0.62, 0.95, gCov);
  float tow = mix(mix(0.45, 0.75, gCov) + 0.55 * wm2.g, 1.0, gStrat);     // cloudier → taller (congestus)
  return vec3(lc, tow, wm);
}
float coarse(vec3 q, float h, float lc, float tow) {
  return clamp(remap(textureLod(uShape, q * 0.22, gLod).r * profile(clamp(h / tow, 0.0, 1.0), gStrat), 1.0 - lc, 1.0, 0.0, 1.0), 0.0, 1.0);
}

void main() {
  vec2 hres = uRes * 2.0;
  vec2 hv = (floor(gl_FragCoord.xy) * 2.0 + uJit + 0.5) / hres;
  float sy = uBand.x + hv.y * (uBand.y - uBand.x);
  vec2 ndc = vec2(hv.x * 2.0 - 1.0, sy * 2.0 - 1.0);
  ndc += (texture(uField, vec2(hv.x, sy)).xy * 2.0 - 1.0) * 0.07;   // fingers push the clouds around
  vec3 rd = normalize(uCamF + uCamR * (ndc.x * uTan.x) + uCamU * (ndc.y * uTan.y));
  rd = normalize(vec3(rd.x, max(rd.y, 0.006), rd.z));
  float hl = max(length(rd.xz), 1e-3);
  float pxAng = 2.0 * uTan.y * (uBand.y - uBand.x) / hres.y;   // one history pixel, in radians

  gCov = uWeather.x; gStrat = uWeather.y; gDens = uWeather.z;
  gHB = mix(1.4, 0.8, gStrat); gTh = mix(3.2, 1.2, gStrat);
  vec3 C = vec3(0.0, -RG, 0.0), ro = vec3(0.0, CAM_H, 0.0), roc = ro - C;
  float t0 = shell(roc, rd, RG + gHB), t1 = shell(roc, rd, RG + gHB + gTh);
  t0 = max(t0, (uClear.x - uClear.y) / hl);                  // skip the clear zone overhead
  t1 = min(t1, min(t0 + 34.0, 41.0 / hl));                   // and the far haze
  // the bank fades out toward the top of its band, never cut by the buffer edge
  float bandFade = 1.0 - smoothstep(0.80, 1.0, hv.y) * step(uBand.y, 0.999);

  // jitter: a random start per pixel, advanced by the golden ratio each time this
  // sub-pixel is traced (every 4th frame) — the samples of every pixel cover the
  // stride evenly, so the history converges to the same unbiased mean everywhere
  vec3 j3 = fract(vec3(gl_FragCoord.xy, uJit.x + 2.0 * uJit.y) * vec3(0.1031, 0.1030, 0.0973));
  j3 += dot(j3, j3.yzx + 33.33);
  float jit = fract((j3.x + j3.y) * j3.z + floor(uFrame / 4.0) * 0.6180340);

  // per-ray constants: phase per scattering octave, ambient light
  float ct = dot(rd, uLightDir);
  float flat_ = mix(1.0, 0.45, gStrat);                       // decks diffuse the silver lining
  float ph0 = cloudPhase(ct, flat_), ph1 = cloudPhase(ct, 0.7 * flat_), ph2 = cloudPhase(ct, 0.49 * flat_);
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 skyZ = skyLookup(uSkyS, up, uSunDir) * uLight.x + skyLookup(uSkyM, up, uMoonDir) * uLight.y;
  vec3 skyH = skyLookup(uSkyS, normalize(vec3(-uSunDir.x, 0.15, -uSunDir.z)), uSunDir) * uLight.x;
  vec3 skyHs = skyLookup(uSkyS, normalize(vec3(uSunDir.x, 0.10, uSunDir.z)), uSunDir) * uLight.x;
  vec3 ambTop = (skyZ * 1.1 + skyH * 0.4 + skyHs * 0.35) * (1.0 - 0.45 * gCov * gStrat);
  float sunZ = uSunDir.y;
  vec3 ground = transmit(uTrans, RG, sunZ) * max(sunZ, 0.0) * uLight.x + transmit(uTrans, RG, uMoonDir.y) * max(uMoonDir.y, 0.0) * uLight.y;
  vec3 ambBot = ground * (0.08 / PI) * (1.0 - 0.6 * gCov) + ambTop * 0.10;
  const float SD5[5] = float[5](0.12, 0.38, 0.85, 1.7, 3.1);
  const float SW5[5] = float[5](0.24, 0.36, 0.60, 1.10, 1.90);

  vec3 L = vec3(0.0);
  float T = 1.0, tw = 0.0, aw = 0.0;
  float t = t0 + clamp(t0 * 0.0055, 0.05, 0.36) * jit;
  // nIn: lit samples since entering a cloud; emp: empty samples in a row;
  // ref: fine-stride countdown after a back-up
  float nIn = 0.0, emp = 0.0, tSafe = t0, ref = 0.0;
  for (int i = 0; i < STEPS; i++) {
    if (t > t1 || T < 0.02) break;
    vec3 p = ro + rd * t;
    vec3 pc = p - C;
    float rp = length(pc);
    float h = clamp((rp - RG - gHB) / gTh, 0.0, 1.0);
    vec2 wp = p.xz + uWindOff.xy;
    // shape texel ≈ 71 m: the mip whose texel matches one pixel — never coarser,
    // since a thresholded trilinear grid draws boxy contours once texels exceed a pixel
    gLod = max(0.0, log2(t * pxAng / 0.071));
    vec3 cl = cellAt(wp, t * hl);
    // one readable group: the bank ends by ~40 km (beyond, clouds shrink below a
    // few pixels and only muddy it); the far edge fades, never cuts
    float lc = cl.x * bandFade * (1.0 - smoothstep(26.0, 40.0, t * hl)), tow = cl.y;
    vec3 q = vec3(wp.x, p.y + uWindOff.z, wp.y);
    // one march: the stride is fine where there is cloud, and grows
    // geometrically (to ~6×) through empty air — inside or between cells — so a
    // ray never runs out of iterations; on a hit after a long stride it backs up
    // once and refines. Strides scale with distance: the same angular sampling
    // near and far.
    float dtS = clamp(t * 0.0055, 0.05, 0.36) * (nIn < 3.0 ? 0.5 : 1.0);
    float c = lc > 0.004 ? coarse(q, h, lc, tow) : 0.0;
    if (c <= 0.0) {
      tSafe = t; emp += 1.0;
      t += ref > 0.0 ? dtS : dtS * min(1.0 + 0.5 * emp, 6.0) * (0.85 + 0.3 * jit);
      ref = max(ref - 1.0, 0.0);
      continue;
    }
    // a hit after a long stride: back up and walk in fine strides until the
    // surface itself is found (never land past it — that would bias the shading)
    if (emp > 1.5 && ref <= 0.0) { t = tSafe + dtS * (0.5 + 0.5 * jit); emp = 0.0; nIn = 0.0; ref = 12.0; continue; }
    emp = 0.0; ref = 0.0;
    float er = textureLod(uErosion, q * 0.32 + uWindOff.w, gLod).r;
    er = mix(er, 1.0 - er, clamp(h * 4.0, 0.0, 1.0));                // wispy bases, billowy (cauliflower) tops
    float ew = 0.18 * (1.0 - 0.7 * smoothstep(14.0, 45.0, t));        // detail fades where a pixel can't hold it
    float lk = 0.65 + 0.35 * lc;
    float d = smoothstep(0.0, 0.34, clamp(remap(c, er * ew, 1.0, 0.0, 1.0), 0.0, 1.0)) * lk * gDens;
    if (d > 0.0005) {
      // optical depth toward the light: 5 samples at geometrically growing distances
      float od = 0.0;
      // (coarser mips further along the light ray: light diffuses over those
      //  distances anyway, and a low sun no longer lights the clouds in specks)
      for (int k = 0; k < 5; k++) {
        float sd = SD5[k];
        vec3 lq = q + uLightDir * sd;
        float lh = clamp((h + uLightDir.y * sd / gTh) / tow, 0.0, 1.0);
        float sc = clamp(remap(textureLod(uShape, lq * 0.22, gLod + 1.0 + float(k) * 0.6).r * profile(lh, gStrat), 1.0 - lc, 1.0, 0.0, 1.0), 0.0, 1.0);
        od += sc * SW5[k];
      }
      {
        vec3 lq = q + uLightDir * 0.12;
        float lh = clamp((h + uLightDir.y * 0.12 / gTh) / tow, 0.0, 1.0);
        float sc = clamp(remap(textureLod(uShape, lq * 0.22, gLod).r * profile(lh, gStrat), 1.0 - lc, 1.0, 0.0, 1.0), 0.0, 1.0);
        float le = textureLod(uErosion, lq * 0.32 + uWindOff.w, gLod).r;
        float ed = clamp(remap(sc, mix(le, 1.0 - le, clamp(lh * 4.0, 0.0, 1.0)) * 0.22, 1.0, 0.0, 1.0), 0.0, 1.0);
        od += (ed - sc) * 0.6;
      }
      od = od * lk * gDens * 22.0 + gStrat * gCov * 3.5;
      vec3 nUp = pc / rp;
      vec3 Lc = transmitSoft(uTrans, rp, dot(nUp, uSunDir)) * (uLight.x * uLight.z) + transmitSoft(uTrans, rp, dot(nUp, uMoonDir)) * (uLight.y * (1.0 - uLight.z));
      float ms = ph0 * exp(-od) + 0.50 * ph1 * exp(-od * 0.40) + 0.25 * ph2 * exp(-od * 0.15);
      float powder = mix(1.0 - exp(-d * 9.0), 1.0, clamp(ct * 0.5 + 0.5, 0.0, 1.0) * 0.6 + 0.2);
      vec3 amb = mix(ambBot, ambTop, h) * (0.30 + 0.70 * pow(h, 0.7));
      vec3 S = Lc * ms * powder * 4.6 + amb * 0.9;           // strong key light, restrained fill: deep, readable shadow sides
      float dtE = dtS * mix(3.0, 1.0, smoothstep(0.0, 0.25, d));
      float Ts = exp(-d * 16.0 * dtE);                                 // σ = 16 /km at density 1
      float w = T * (1.0 - Ts);
      L += w * S;
      tw += w * t; aw += w; nIn += 1.0;
      T *= Ts;
    }
    t += dtS * mix(3.0, 1.0, smoothstep(0.0, 0.25, d));      // thin wisps: longer strides
  }
  // lightning lights the deck from inside
  L += uFlash.w * vec3(0.75, 0.80, 1.0) * 0.08 * (1.0 - T) * (0.35 + 1.8 * pow(max(dot(rd, uFlash.xyz), 0.0), 6.0));
  // aerial perspective at the cloud's own (transmittance-weighted) depth, plus a
  // fade by elevation, so the bank melts into the haze above the waterline
  float a = 1.0 - T;
  float depth = aw > 1e-4 ? tw / aw : t0;
  vec3 skyRd = skyLookup(uSkyS, rd, uSunDir) * uLight.x + skyLookup(uSkyM, rd, uMoonDir) * uLight.y;
  float fog = exp(-depth * 0.018) * smoothstep(0.0, 0.10, rd.y);
  L = mix(skyRd * a, L, fog);
  o = vec4(L, a);
}
