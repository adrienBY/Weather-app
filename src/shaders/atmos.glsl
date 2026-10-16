// ── Shared: a physically based Earth atmosphere ─────────────────────────────
// Bruneton 2017 / Hillaire 2020 ("A Scalable and Production Ready Sky and
// Atmosphere Rendering Technique") parameters, in km. Pulled into the LUT,
// cloud and sky passes with `#include atmos.glsl`.
// km² values overflow mediump: everything in here is highp; the includer's
// default precision is restored at the end (precision is lexically scoped).
precision highp float;
const float PI = 3.14159265;
const float RG = 6360.0;                                  // ground radius
const float RT = 6460.0;                                  // top of the atmosphere
const float CAM_H = 0.25;                                 // viewer altitude
const vec3  RAY_S = vec3(5.802, 13.558, 33.1) * 1e-3;     // Rayleigh scattering /km
const float RAY_H = 8.0;
const float MIE_S = 3.996e-3, MIE_A = 4.40e-3, MIE_H = 1.2, MIE_G = 0.8;
const vec3  OZO_A = vec3(0.650, 1.881, 0.085) * 1e-3;     // ozone absorption /km (tent 10–40 km)

float rayPhase(float c) { return 3.0 / (16.0 * PI) * (1.0 + c * c); }
float hgPhase(float g, float c) { float g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5)); }

// distance from radius r along mu (cos zenith) to the top of the atmosphere
float distTop(float r, float mu) { return max(0.0, -r * mu + sqrt(max(r * r * (mu * mu - 1.0) + RT * RT, 0.0))); }

// transmittance LUT parametrisation (Bruneton): uv ↔ (r, mu)
vec2 transUV(float r, float mu) {
  float H = sqrt(RT * RT - RG * RG), rho = sqrt(max(r * r - RG * RG, 0.0));
  float d = distTop(r, mu), dmin = RT - r, dmax = rho + H;
  return vec2((d - dmin) / max(dmax - dmin, 1e-3), rho / H);
}
void transRMu(vec2 uv, out float r, out float mu) {
  float H = sqrt(RT * RT - RG * RG), rho = H * uv.y;
  r = sqrt(rho * rho + RG * RG);
  float dmin = RT - r, dmax = rho + H, d = dmin + uv.x * (dmax - dmin);
  mu = d < 1e-3 ? 1.0 : clamp((H * H - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0);
}
// sun/moon light reaching radius r from a light at cos zenith mu (0 past the planet's shadow line)
vec3 transmit(sampler2D T, float r, float mu) {
  float muH = -sqrt(max(1.0 - (RG * RG) / (r * r), 0.0));
  return texture(T, transUV(r, mu)).rgb * smoothstep(muH - 0.01, muH + 0.004, mu);
}

// sky-view LUT parametrisation (Hillaire 2020): x = azimuth to the light (sqrt-
// packed toward the light), y = zenith angle, densest at the horizon
vec2 skyUV(float vz, float lv) {
  float r = RG + CAM_H, Vh = sqrt(r * r - RG * RG), beta = acos(Vh / r), zha = PI - beta;
  float za = acos(clamp(vz, -1.0, 1.0));
  float va = (1.0 - sqrt(max(1.0 - za / zha, 0.0))) * 0.5;          // above the horizon
  float vb = sqrt(max((za - zha) / beta, 0.0)) * 0.5 + 0.5;         // below (ground)
  return vec2(sqrt(clamp(-lv * 0.5 + 0.5, 0.0, 1.0)), mix(va, vb, step(zha, za)));
}
// radiance of the sky in direction rd for a light at ld (both world space, y up)
vec3 skyLookup(sampler2D S, vec3 rd, vec3 ld) {
  vec2 h = rd.xz, l = ld.xz;
  float lh = length(h) * length(l);
  float lv = lh > 1e-5 ? dot(h, l) / lh : 1.0;
  return texture(S, skyUV(rd.y, lv)).rgb;
}
#ifdef ATMOS_MEDIUMP
precision mediump float;
#endif
