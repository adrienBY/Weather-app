#version 300 es
/* ── Rain on the glass ───────────────────────────────────────────────────────
   Drops simulated in JS (spawn, slide, evaporate) and drawn with the Codrops
   RainEffect drop textures into a half-res "glass" buffer: rg = refraction
   map, a = drop shape. The sky shader bends its lookup through it. */
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aD;           // x, y (sky space), radius, vertical stretch
uniform float uAspect;
out vec2 vUv;
out float vA;
void main() {
  vec2 pos = aD.xy + aCorner * vec2(aD.z, aD.z * aD.w) * 1.7;   // ×1.7: alpha sharpening keeps the inner ~60%
  gl_Position = vec4(pos.x / (uAspect * 0.5), pos.y * 2.0 - 1.0, 0.0, 1.0);
  vUv = aCorner * 0.5 + 0.5;
  vA = smoothstep(0.0012, 0.004, aD.z);
}
