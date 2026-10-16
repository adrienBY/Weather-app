#version 300 es
/* ── Volumetric clouds ───────────────────────────────────────────────────────
   Ray-marched through a spherical cloud shell 1–5 km above a curved Earth,
   sampling the baked 64³ noise volume. Density = Perlin-Worley base shape ×
   height profile, thresholded by weather-driven coverage (a 2-D "weather
   map" makes it patchy), then eroded by Worley detail — wispy bottoms,
   billowy tops. Cumulus morph into a flat stratus deck as rain/overcast rise.

   Lighting per step: 3 cone samples toward the sun (or moon) for optical
   depth → Beer–Lambert × powder ("dark edges" of dense clouds), dual-lobe
   Henyey-Greenstein phase (silver lining toward the sun), height-graded
   ambient from the sky. Integration is energy-conserving (Hillaire 2016).

   Cost control for 120 Hz: this pass runs at a QUARTER of the cloud buffer
   (each output pixel = one of 4 sub-pixels, rotated every frame), with a
   per-pixel jittered ray start. resolve.frag folds the samples into the
   temporally accumulated history, so every pixel is re-traced every 4th
   frame and the noise integrates away. Fixed-count loop, no branches. */
precision highp float;
precision highp sampler3D;
precision mediump sampler2D;
#define HZ __HZ__
#define STEPS __STEPS__
uniform sampler3D uVol;
uniform sampler2D uNoise;
uniform sampler2D uField;
uniform vec2  uRes;          // this (quarter) buffer
uniform vec2  uJit;          // sub-pixel of the history we trace this frame (0/1, 0/1)
uniform vec3  uCamF, uCamU, uCamR;
uniform vec2  uTan;
uniform vec3  uLightDir;     // sun by day, moon by night
uniform vec3  uLightCol;
uniform vec3  uAmbTop, uAmbBot, uHorizon;
uniform vec4  uWeather;      // coverage, stratiform, density, —
uniform vec4  uWindOff;      // xy weather drift (km), z vertical evolution, w detail drift
uniform float uFrame;
uniform vec4  uFlash;        // xyz direction, w intensity
out vec4 o;

const float RE = 6371.0;
float remap(float v, float l0, float h0, float l1, float h1) { return l1 + (v - l0) * (h1 - l1) / (h0 - l0); }
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5); }   // ×4π-normalised
float shell(vec3 roc, vec3 rd, float r) { float b = dot(roc, rd), c = dot(roc, roc) - r * r; return -b + sqrt(max(b * b - c, 0.0)); }
float profile(float h, float strat) {
  float cu = smoothstep(0.0, 0.10, h) * smoothstep(1.0, 0.55, h);   // cumulus: flat base, rounded towers
  float st = smoothstep(0.0, 0.12, h) * smoothstep(0.50, 0.28, h);  // stratus: thin, flat
  return mix(cu, st, strat);
}

void main() {
  // which history pixel this fragment traces
  vec2 hres = uRes * 2.0;
  vec2 hv = (floor(gl_FragCoord.xy) * 2.0 + uJit + 0.5) / hres;
  float sy = HZ + hv.y * (1.0 - HZ);                     // buffer only covers the sky above the horizon
  vec2 ndc = vec2(hv.x * 2.0 - 1.0, sy * 2.0 - 1.0);
  ndc += (texture(uField, vec2(hv.x, sy)).xy * 2.0 - 1.0) * 0.07;   // fingers push the clouds around
  vec3 rd = normalize(uCamF + uCamR * (ndc.x * uTan.x) + uCamU * (ndc.y * uTan.y));
  rd = normalize(vec3(rd.x, max(rd.y, 0.006), rd.z));

  float strat = uWeather.y, cov = uWeather.x, dens = uWeather.z;
  float hB = mix(1.5, 0.9, strat), th = mix(3.4, 1.3, strat);
  vec3 C = vec3(0.0, -RE, 0.0), ro = vec3(0.0, 0.25, 0.0), roc = ro - C;
  float t0 = shell(roc, rd, RE + hB), t1 = min(shell(roc, rd, RE + hB + th), t0 + 36.0);
  float dt = (t1 - t0) / float(STEPS);
  // interleaved-gradient jitter, rotated per frame (golden ratio) → no banding after accumulation
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uFrame * 0.6180339);
  float t = t0 + dt * jit;

  float ct = dot(rd, uLightDir);
  // forward lobe softens as the sky closes in: multiple scattering in a deck
  // diffuses the sun's silver lining into a flat, even grey
  float gF = mix(0.72, 0.35, strat);
  float phase = min(mix(hg(ct, gF), hg(ct, -0.20), 0.40), 7.0) * 0.85 + 0.15;

  vec3 L = vec3(0.0);
  float T = 1.0;
  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * t;
    float h = clamp((length(p - C) - RE - hB) / th, 0.0, 1.0);
    vec2 wp = p.xz + uWindOff.xy;
    float wm = texture(uNoise, wp * 0.016).r * 0.65 + texture(uNoise, wp * 0.043 + 0.37).g * 0.35;
    float lc = clamp(cov * (0.40 + 1.15 * wm), 0.0, 1.0);          // local coverage (patchy)
    vec3 q = vec3(wp.x, p.y + uWindOff.z, wp.y);
    float base = texture(uVol, q * 0.065).r;
    float lk = 0.55 + 0.45 * lc;                                   // sparse skies → opaque puffs, not haze
    float c = clamp(remap(base * profile(h, strat), 1.0 - lc, 1.0, 0.0, 1.0), 0.0, 1.0);
    vec3 dn = texture(uVol, q * 0.42 + uWindOff.w).gba;
    float df = dot(dn, vec3(0.625, 0.25, 0.125));
    df = mix(df, 1.0 - df, clamp(h * 5.0, 0.0, 1.0));
    // erode the edges with detail, then a soft knee: crisp cauliflower rims,
    // dense cores (cumulus are optically thick a few hundred metres in)
    float d = smoothstep(0.0, 0.42, clamp(remap(c, df * 0.30, 1.0, 0.0, 1.0), 0.0, 1.0)) * lk * dens;

    // optical depth toward the light: 3 cone samples on the base shape
    float od = 0.0;
    vec3 lq = q + uLightDir * 0.30;
    od += clamp(remap(texture(uVol, lq * 0.065).r * profile(h + uLightDir.y * 0.30 / th, strat), 1.0 - lc, 1.0, 0.0, 1.0), 0.0, 1.0) * lk * 0.9;
    lq = q + uLightDir * 0.95;
    od += clamp(remap(texture(uVol, lq * 0.065).r * profile(h + uLightDir.y * 0.95 / th, strat), 1.0 - lc, 1.0, 0.0, 1.0), 0.0, 1.0) * lk * 1.4;
    lq = q + uLightDir * 2.10;
    od += clamp(remap(texture(uVol, lq * 0.065).r * profile(h + uLightDir.y * 2.10 / th, strat), 1.0 - lc, 1.0, 0.0, 1.0), 0.0, 1.0) * lk * 1.8;
    // the layers *above* a stratiform deck (mid/high overcast) shade it too
    od = od * dens + strat * cov * 2.2;
    float beer = exp(-od * 2.1);
    float powder = 1.0 - exp(-od * 3.0 - d * 2.0);
    vec3 Ls = uLightCol * beer * mix(1.0, powder, 0.6) * phase;
    vec3 La = mix(uAmbBot, uAmbTop, h);                        // bases sit in their own shade

    float Ts = exp(-d * 7.0 * dt);                        // σ = 7 /km at density 1
    L += T * (Ls + La) * (1.0 - Ts);                      // ∫ scattering, energy-conserving
    T *= Ts;
    t += dt;
  }
  // lightning lights the deck from inside
  L += uFlash.w * vec3(0.75, 0.80, 1.0) * (1.0 - T) * (0.35 + 1.8 * pow(max(dot(rd, uFlash.xyz), 0.0), 6.0));
  // aerial perspective: distant clouds dissolve into the horizon haze
  float a = 1.0 - T;
  float fog = exp(-t0 * 0.024);
  L = mix(uHorizon * a, L, fog);
  o = vec4(L, a);
}
