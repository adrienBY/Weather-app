#version 300 es
/* Transmittance LUT (256×64): optical depth from radius r along cos-zenith
   mu to the top of the atmosphere, stored as exp(−τ). Baked once, and again
   only when the haze (humidity / fog → Mie density) changes noticeably. */
precision highp float;
precision mediump sampler2D;
#include atmos.glsl
uniform vec2  uSize;
uniform float uHaze;         // Mie multiplier (1 = clear standard atmosphere)
out vec4 o;
void main() {
  float r, mu;
  transRMu(gl_FragCoord.xy / uSize, r, mu);
  float d = distTop(r, mu), dt = d / 40.0;
  vec3 tau = vec3(0.0);
  for (int i = 0; i < 40; i++) {
    float t = (float(i) + 0.5) * dt;
    float h = sqrt(r * r + t * t + 2.0 * r * mu * t) - RG;
    float mie = exp(-h / MIE_H) * uHaze;
    float oz = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
    tau += (RAY_S * exp(-h / RAY_H) + (MIE_S + MIE_A) * mie + OZO_A * oz) * dt;
  }
  o = vec4(exp(-tau), 1.0);
}
