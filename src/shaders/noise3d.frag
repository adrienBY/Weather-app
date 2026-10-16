#version 300 es
/* ── Cloud noise volume, baked once on the GPU ──────────────────────────────
   64³ RGBA, tileable in all three axes, written one z-slice per draw:
     R   Perlin-Worley — Perlin fBm "dilated" by Worley fBm: billowy base shape
     GBA Worley fBm at rising frequencies — detail used to erode the edges
   This is the same family of noise volumes used by production real-time
   cloud renderers (Schneider, "The real-time volumetric cloudscapes of
   Horizon Zero Dawn", SIGGRAPH 2015) — generated here instead of shipped. */
precision highp float;
uniform float uZ;
uniform float uN;
out vec4 o;

vec3 hash33(vec3 p) {
  p = fract(p * vec3(.1031, .1030, .0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
// cellular noise, inverted (1 at feature points), periodic over `per` cells.
// A *smooth* minimum over the 27 neighbours (log-sum-exp) instead of min():
// plain F1 has straight creases along Voronoi borders, which turn into
// unnaturally straight cloud edges once the shape is thresholded.
float worley(vec3 p, float per) {
  vec3 id = floor(p), f = fract(p);
  float s = 0.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 c = vec3(float(x), float(y), float(z));
    vec3 r = c + hash33(mod(id + c, per)) - f;
    s += exp(-9.0 * sqrt(dot(r, r)));
  }
  float d = -log(s) / 9.0;
  return 1.0 - clamp(d, 0.0, 1.0);
}
// gradient noise, periodic
float fade(float t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
float grad(vec3 i, vec3 f, float per) { return dot(hash33(mod(i, per)) * 2.0 - 1.0, f); }
float perlin(vec3 p, float per) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = vec3(fade(f.x), fade(f.y), fade(f.z));
  float a = mix(mix(mix(grad(i, f, per), grad(i + vec3(1,0,0), f - vec3(1,0,0), per), u.x),
                    mix(grad(i + vec3(0,1,0), f - vec3(0,1,0), per), grad(i + vec3(1,1,0), f - vec3(1,1,0), per), u.x), u.y),
                mix(mix(grad(i + vec3(0,0,1), f - vec3(0,0,1), per), grad(i + vec3(1,0,1), f - vec3(1,0,1), per), u.x),
                    mix(grad(i + vec3(0,1,1), f - vec3(0,1,1), per), grad(i + vec3(1,1,1), f - vec3(1,1,1), per), u.x), u.y), u.z);
  return a;
}
float remap(float v, float l0, float h0, float l1, float h1) { return l1 + (v - l0) * (h1 - l1) / (h0 - l0); }

void main() {
  vec3 uvw = vec3(gl_FragCoord.xy, uZ) / uN;
  float pf = perlin(uvw * 4.0, 4.0) * 0.5 + perlin(uvw * 8.0, 8.0) * 0.25 + perlin(uvw * 16.0, 16.0) * 0.125;
  pf = clamp(pf * 0.9 + 0.5, 0.0, 1.0);
  float wf = worley(uvw * 4.0, 4.0) * 0.625 + worley(uvw * 8.0, 8.0) * 0.25 + worley(uvw * 16.0, 16.0) * 0.125;
  float pw = clamp(remap(pf, wf - 1.0, 1.0, 0.0, 1.0), 0.0, 1.0);
  // detail octaves stay ≥ 3 texels per cell — finer Worley aliases into a visible grid
  float d1 = worley(uvw * 4.0, 4.0) * 0.625 + worley(uvw * 8.0, 8.0) * 0.25 + worley(uvw * 16.0, 16.0) * 0.125;
  float d2 = worley(uvw * 6.0, 6.0) * 0.625 + worley(uvw * 12.0, 12.0) * 0.25 + worley(uvw * 18.0, 18.0) * 0.125;
  float d3 = worley(uvw * 10.0, 10.0) * 0.75 + worley(uvw * 20.0, 20.0) * 0.25;
  o = vec4(pw, d1, d2, d3);
}
