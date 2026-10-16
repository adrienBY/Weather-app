#version 300 es
/* ── Volumetric clouds ───────────────────────────────────────────────────────
   Ray-marched through a spherical cloud shell above a curved Earth.

   Shape   real Perlin-Worley noise volumes from lightest/clouds (Nikita
           Agafonov, MIT): a 64³ billow "shape" volume, eroded at the edges
           by a 32³ Worley "erosion" volume, both tileable. The weather map
           (same repo, histogram-equalised at build time) places cloud cells:
           the forecast's cover sets how much of the sky they fill, and the
           cloudier it gets the more and the taller they grow. Height signal
           after lightest/clouds: flat bases, rounded tops; rain, snow and
           fog morph it into a flat stratus deck.

   Light   the sun (or moon) is attenuated by a physically based atmosphere
           (transmittance LUT), per sample and per altitude — at sunset the
           tops of towering clouds catch pink light while their bases already
           sit in the Earth's shadow. Shadow rays: 5 samples out to ~3 km
           (dark, flat bases) plus a detailed short one (billows shading
           billows). Beer-powder, dual-lobe Henyey-Greenstein, two octaves of
           the multiple-scattering approximation (kept short so shadows stay
           deep), blue sky ambient occluded toward the base. Energy-conserving
           integration (Hillaire 2016); aerial perspective fades distant and
           low clouds into the real horizon radiance.

   Cost    traced at a QUARTER of the cloud buffer: each fragment is one of 4
           sub-pixels, rotated every frame, with a jittered start;
           resolve.frag folds the samples into a temporal history. Fixed-
           count loops, no data-dependent branches. Output: premultiplied
           linear radiance (exposure is applied in sky.frag). */
precision highp float;
precision highp sampler3D;
precision mediump sampler2D;
#define HZ __HZ__
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

void main() {
  vec2 hres = uRes * 2.0;
  vec2 hv = (floor(gl_FragCoord.xy) * 2.0 + uJit + 0.5) / hres;
  float sy = HZ + hv.y * (1.0 - HZ);                     // the buffer only covers the sky above the horizon
  vec2 ndc = vec2(hv.x * 2.0 - 1.0, sy * 2.0 - 1.0);
  ndc += (texture(uField, vec2(hv.x, sy)).xy * 2.0 - 1.0) * 0.07;   // fingers push the clouds around
  vec3 rd = normalize(uCamF + uCamR * (ndc.x * uTan.x) + uCamU * (ndc.y * uTan.y));
  rd = normalize(vec3(rd.x, max(rd.y, 0.006), rd.z));

  float cov = uWeather.x, strat = uWeather.y, dens = uWeather.z;
  float hB = mix(1.4, 0.8, strat), th = mix(3.2, 1.2, strat);
  vec3 C = vec3(0.0, -RG, 0.0), ro = vec3(0.0, CAM_H, 0.0), roc = ro - C;
  float t0 = shell(roc, rd, RG + hB), t1 = min(shell(roc, rd, RG + hB + th), t0 + 40.0);
  float dt = (t1 - t0) / float(STEPS);
  // white-noise jitter, re-rolled every frame: interleaved-gradient noise leaves a
  // regular stipple once the temporal history converges; random offsets don't
  vec3 j3 = fract(vec3(gl_FragCoord.xy, uFrame) * vec3(0.1031, 0.1030, 0.0973));
  j3 += dot(j3, j3.yzx + 33.33);
  float jit = fract((j3.x + j3.y) * j3.z);
  float t = t0 + dt * jit;

  // per-ray constants: phase per scattering octave, ambient light
  float ct = dot(rd, uLightDir);
  float flat_ = mix(1.0, 0.45, strat);                    // decks diffuse the silver lining
  float ph0 = cloudPhase(ct, flat_), ph1 = cloudPhase(ct, 0.7 * flat_), ph2 = cloudPhase(ct, 0.49 * flat_);
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 skyZ = skyLookup(uSkyS, up, uSunDir) * uLight.x + skyLookup(uSkyM, up, uMoonDir) * uLight.y;
  vec3 skyH = skyLookup(uSkyS, normalize(vec3(-uSunDir.x, 0.15, -uSunDir.z)), uSunDir) * uLight.x;
  vec3 skyHs = skyLookup(uSkyS, normalize(vec3(uSunDir.x, 0.10, uSunDir.z)), uSunDir) * uLight.x;   // the bright horizon under the sun
  vec3 ambTop = (skyZ * 1.1 + skyH * 0.4 + skyHs * 0.35) * (1.0 - 0.45 * cov * strat);   // sky light on the tops
  float sunZ = uSunDir.y;
  vec3 ground = transmit(uTrans, RG, sunZ) * max(sunZ, 0.0) * uLight.x + transmit(uTrans, RG, uMoonDir.y) * max(uMoonDir.y, 0.0) * uLight.y;
  vec3 ambBot = ground * (0.08 / PI) * (1.0 - 0.6 * cov) + ambTop * 0.10;  // dim bounce light under the bases
  // shadow-ray sample distances (km) grow geometrically to ~3 km, so light that
  // reaches a cloud's base has really crossed the whole tower → dark, flat bases
  const float SD5[5] = float[5](0.12, 0.38, 0.85, 1.7, 3.1);
  const float SW5[5] = float[5](0.24, 0.36, 0.60, 1.10, 1.90);

  vec3 L = vec3(0.0);
  float T = 1.0;
  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * t;
    vec3 pc = p - C;
    float rp = length(pc);
    float h = clamp((rp - RG - hB) / th, 0.0, 1.0);
    vec2 wp = p.xz + uWindOff.xy;
    // weather map (histogram-equalised): thresholding at 1 − cover leaves exactly
    // `cover` of the sky inside cloud cells; inside a cell the shape noise is
    // allowed to fill most of the volume, so clouds are whole masses with
    // billowing edges rather than scattered puffs
    vec2 wm2 = texture(uWeatherMap, wp * 0.032).rg;
    float wm = wm2.r * 0.78 + texture(uWeatherMap, wp * 0.079 + 0.37).r * 0.22;
    // cells never close completely (≤ 62 % of the sky) unless it rains: a cloudy
    // sky stays sculpted — more and taller masses, darker gaps — not a grey lid
    float cc = mix(min(cov, 0.62), cov, strat);
    float cell = smoothstep(1.0 - cc - 0.10, 1.0 - cc + 0.14, wm);
    float lc = cell * mix(0.62, 0.95, cov);                            // local coverage
    float tow = mix(mix(0.45, 0.75, cov) + 0.55 * wm2.g, 1.0, strat);   // cloudier → taller (congestus)
    vec3 q = vec3(wp.x, p.y + uWindOff.z, wp.y);
    float lk = 0.65 + 0.35 * lc;
    float c = clamp(remap(texture(uShape, q * 0.22).r * profile(clamp(h / tow, 0.0, 1.0), strat), 1.0 - lc, 1.0, 0.0, 1.0), 0.0, 1.0);
    float er = texture(uErosion, q * 0.32 + uWindOff.w).r;
    er = mix(er, 1.0 - er, clamp(h * 4.0, 0.0, 1.0));                  // wispy bases, billowy (cauliflower) tops
    float d = smoothstep(0.0, 0.30, clamp(remap(c, er * 0.18, 1.0, 0.0, 1.0), 0.0, 1.0)) * lk * dens;

    // optical depth toward the light: 5 samples at geometrically growing distances
    // out to ~3 km. The two short ones also see the erosion detail: neighbouring
    // billows shade each other, which is what gives a cumulus its cauliflower relief
    float od = 0.0;
    for (int k = 0; k < 5; k++) {
      float sd = SD5[k];
      vec3 lq = q + uLightDir * sd;
      float lh = clamp((h + uLightDir.y * sd / th) / tow, 0.0, 1.0);
      float sc = clamp(remap(texture(uShape, lq * 0.22).r * profile(lh, strat), 1.0 - lc, 1.0, 0.0, 1.0), 0.0, 1.0);
      od += sc * SW5[k];
    }
    {
      vec3 lq = q + uLightDir * 0.12;
      float lh = clamp((h + uLightDir.y * 0.12 / th) / tow, 0.0, 1.0);
      float sc = clamp(remap(texture(uShape, lq * 0.22).r * profile(lh, strat), 1.0 - lc, 1.0, 0.0, 1.0), 0.0, 1.0);
      float le = texture(uErosion, lq * 0.32 + uWindOff.w).r;
      float ed = clamp(remap(sc, mix(le, 1.0 - le, clamp(lh * 4.0, 0.0, 1.0)) * 0.22, 1.0, 0.0, 1.0), 0.0, 1.0);
      od += (ed - sc) * 0.6;                                             // replace the coarse first sample by the detailed one
    }
    od = od * lk * dens * 22.0 + strat * cov * 3.5;                     // + the layers above an overcast deck
    // light arriving at this altitude through the atmosphere (Earth shadow at dusk)
    vec3 nUp = pc / rp;
    vec3 Lc = transmit(uTrans, rp, dot(nUp, uSunDir)) * (uLight.x * uLight.z) + transmit(uTrans, rp, dot(nUp, uMoonDir)) * (uLight.y * (1.0 - uLight.z));
    // single scattering + 2 octaves of multiple scattering — kept short on purpose:
    // generous octaves flatten a cumulus into grey felt; these keep its shadows deep
    float ms = ph0 * exp(-od) + 0.50 * ph1 * exp(-od * 0.40) + 0.25 * ph2 * exp(-od * 0.15);
    // beer-powder (Schneider 2015): in-scattering builds up a few hundred metres
    // in, so the sun-facing billows glow while their crevices stay dark — fades
    // out looking toward the sun, where the silver lining wins
    float powder = mix(1.0 - exp(-d * 9.0), 1.0, clamp(ct * 0.5 + 0.5, 0.0, 1.0) * 0.6 + 0.2);
    // ambient: blue from above, occluded toward the base
    vec3 amb = mix(ambBot, ambTop, h) * (0.30 + 0.70 * pow(h, 0.7));
    vec3 S = Lc * ms * powder * 4.2 + amb * 1.05;

    float Ts = exp(-d * 22.0 * dt);                                      // σ = 22 /km at density 1: crisp edges
    L += T * S * (1.0 - Ts);                                             // σs = σt (white clouds): ∫ = S·(1−Ts)
    T *= Ts;
    t += dt;
  }
  // lightning lights the deck from inside
  L += uFlash.w * vec3(0.75, 0.80, 1.0) * 0.08 * (1.0 - T) * (0.35 + 1.8 * pow(max(dot(rd, uFlash.xyz), 0.0), 6.0));
  // aerial perspective: distant clouds dissolve into the real horizon radiance
  float a = 1.0 - T;
  vec3 skyRd = skyLookup(uSkyS, rd, uSunDir) * uLight.x + skyLookup(uSkyM, rd, uMoonDir) * uLight.y;
  // fade toward the horizon by distance and by elevation, so the deck melts
  // into the haze above the waterline instead of ending on a line
  float fog = exp(-t0 * 0.028) * smoothstep(0.0, 0.16, rd.y);
  L = mix(skyRd * a, L, fog);
  o = vec4(L, a);
}
