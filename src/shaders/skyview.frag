#version 300 es
/* Sky-view LUT (192×108) — Hillaire 2020. For every (azimuth to the light,
   zenith angle) the single-scattered Rayleigh + Mie radiance is integrated
   from the viewer to the top of the atmosphere, with light reaching each
   sample through the transmittance LUT. Higher scattering orders use the
   octave approximation from lightest/clouds (Nikita Agafonov, MIT): each
   octave is dimmer, sees a thinner atmosphere and a flatter phase function.
   Rendered for the sun and (dimmer) for the moon; only re-rendered when the
   light direction or the haze changes. Radiance is for a light of
   illuminance 1 — exposure happens in sky.frag. */
precision highp float;
precision mediump sampler2D;
#include atmos.glsl
uniform sampler2D uTrans;
uniform vec2  uSize;
uniform float uLightZ;       // cos zenith of the light
uniform float uHaze;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  // invert skyUV
  float r = RG + CAM_H, Vh = sqrt(r * r - RG * RG), beta = acos(Vh / r), zha = PI - beta;
  float ca = 1.0 - 2.0 * uv.y; ca = 1.0 - ca * ca;
  float cb = 2.0 * uv.y - 1.0; cb *= cb;
  float za = mix(zha * clamp(ca, 0.0, 1.0), zha + beta * cb, step(0.5, uv.y));
  float lv = -(uv.x * uv.x * 2.0 - 1.0);
  float vz = cos(za), vs = sin(za);
  vec3 rd = vec3(vs * lv, vz, vs * sqrt(max(1.0 - lv * lv, 0.0)));
  vec3 ld = vec3(sqrt(max(1.0 - uLightZ * uLightZ, 0.0)), uLightZ, 0.0);
  // march to the top of the atmosphere or the ground
  float b = r * vz, disc = b * b - r * r + RG * RG;
  float dG = disc > 0.0 && vz < 0.0 ? -b - sqrt(disc) : 1e9;
  float d = min(distTop(r, vz), dG), dt = d / 32.0;
  float c = dot(rd, ld);
  float pr0 = rayPhase(c), pm0 = hgPhase(MIE_G, c);
  float pr1 = rayPhase(c * 0.7), pm1 = hgPhase(MIE_G * 0.7, c * 0.7);
  float pr2 = rayPhase(c * 0.49), pm2 = hgPhase(MIE_G * 0.49, c * 0.49);
  float pr3 = rayPhase(c * 0.343), pm3 = hgPhase(MIE_G * 0.343, c * 0.343);
  vec3 L = vec3(0.0), Tv = vec3(1.0);
  vec3 p0 = vec3(0.0, r, 0.0);
  for (int i = 0; i < 32; i++) {
    float t = (float(i) + 0.5) * dt;
    vec3 p = p0 + rd * t;
    float rp = length(p), h = rp - RG;
    float dr = exp(-h / RAY_H), dm = exp(-h / MIE_H) * uHaze, oz = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
    vec3 sr = RAY_S * dr; float sm = MIE_S * dm;
    vec3 ext = sr + (MIE_S + MIE_A) * dm + OZO_A * oz;
    vec3 Tl = transmit(uTrans, rp, dot(p, ld) / rp);
    // single scattering + 3 octaves of approximated multiple scattering
    vec3 S = (sr * pr0 + sm * pm0) * Tl
           + 0.53   * (sr * pr1 + sm * pm1) * pow(Tl, vec3(0.35))
           + 0.2809 * (sr * pr2 + sm * pm2) * pow(Tl, vec3(0.1225))
           + 0.1489 * (sr * pr3 + sm * pm3) * pow(Tl, vec3(0.0429));
    vec3 Ts = exp(-ext * dt);
    L += Tv * (S - S * Ts) / max(ext, vec3(1e-7));
    Tv *= Ts;
  }
  o = vec4(L, 1.0);
}
