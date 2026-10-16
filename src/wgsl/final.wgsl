// ═══ Widget material — WGSL twin of final.frag (the pass that draws to the screen) ═══
// A frosted material in the manner of Apple's system materials: wide dual-Kawase
// blur read through a bicubic B-spline, vibrancy, adaptive tint, a hairline lit
// from above, grain, soft contact shadows; the page dims under an open sheet.
#include full.wgsl
const N = 10;
struct U {
  resTime: vec4f,      // xy res, z time, w background dim (slot N-1)
  press: vec4f,        // xy px (y up), amount, slot
  light: vec4f,        // xy highlight direction
  rect: array<vec4f, 10>,    // centre xy, half size xy — pixels, y up
  rectP: array<vec4f, 10>,   // radius px, materialise 0..1, thickness 0..1, seed
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tSky: texture_2d<f32>;
@group(0) @binding(2) var tBlur: texture_2d<f32>;
@group(0) @binding(3) var sClamp: sampler;

fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
fn sdRBox(p: vec2f, b: vec2f, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}
fn bspline(uv: vec2f) -> vec3f {
  let ts = vec2f(textureDimensions(tBlur));
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
  return (textureSampleLevel(tBlur, sClamp, vec2f(h0.x, h0.y), 0.0).rgb * g0.x + textureSampleLevel(tBlur, sClamp, vec2f(h1.x, h0.y), 0.0).rgb * g1.x) * g0.y
       + (textureSampleLevel(tBlur, sClamp, vec2f(h0.x, h1.y), 0.0).rgb * g0.x + textureSampleLevel(tBlur, sClamp, vec2f(h1.x, h1.y), 0.0).rgb * g1.x) * g1.y;
}
fn hash12(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let res = u.resTime.xy;
  let dim = u.resTime.w;
  let px = vec2f(pos.x, res.y - pos.y);       // the screen, in GL's frame (y up)
  let uv = px / res;
  let base = textureSampleLevel(tSky, sClamp, uv, 0.0).rgb;

  var R = vec4f(0.0, 0.0, 1.0, 1.0);
  var RP = vec4f(0.0);
  var sd = 1e4;
  var sel = -1.0;
  var shadow = 0.0;
  for (var i = 0; i < N; i++) {
    let r = u.rect[i];
    let rp = u.rectP[i];
    let d = sdRBox(px - r.xy, r.zw, rp.x);
    let on = step(d, 0.75) * step(0.002, rp.y);
    let ds = sdRBox(px - r.xy + vec2f(0.0, 6.0 + 14.0 * rp.z), r.zw, rp.x);
    shadow = max(shadow, (1.0 - ss(-10.0, 34.0 + 46.0 * rp.z, ds)) * rp.y * (0.10 + 0.16 * rp.z));
    R = mix(R, r, on); RP = mix(RP, rp, on); sd = mix(sd, d, on); sel = mix(sel, f32(i), on);
  }
  let isSheet = step(f32(N) - 1.5, sel);
  let col = base * (1.0 - dim * 0.55) * (1.0 - shadow);

  let m = RP.y;
  let rad = RP.x;
  let k = RP.z;
  let lp = px - R.xy;
  let inD = -sd;
  let n = normalize(vec2f(sdRBox(lp + vec2f(1.0, 0.0), R.zw, rad) - sdRBox(lp - vec2f(1.0, 0.0), R.zw, rad),
                          sdRBox(lp + vec2f(0.0, 1.0), R.zw, rad) - sdRBox(lp - vec2f(0.0, 1.0), R.zw, rad)) + 1e-5);

  var g = mix(base, bspline(uv), ss(0.0, 0.6, m));
  let lum = dot(g, vec3f(0.2126, 0.7152, 0.0722));
  g = clamp(mix(vec3f(lum), g, 1.6), vec3f(0.0), vec3f(1.0));
  let tint = 0.20 + 0.30 * ss(0.22, 0.85, lum) + 0.16 * isSheet * ss(0.25, 1.0, k);
  g = mix(g, vec3f(0.032, 0.040, 0.070), tint);
  g += 0.022;
  g *= 1.0 - dim * 0.55 * (1.0 - isSheet);
  let pr = u.press.z * step(abs(sel - u.press.w), 0.5);
  let pd = px - u.press.xy;
  g += vec3f(0.92, 0.96, 1.0) * pr * (0.035 + 0.07 * exp(-dot(pd, pd) / 26000.0));
  let facing = max(dot(n, u.light.xy), 0.0);
  let rim = (1.0 - ss(0.0, 1.25, inD)) * (0.10 + 0.32 * facing * facing);
  g += vec3f(1.0) * rim * m;
  g += (hash12(px + fract(u.resTime.z) * 113.0) - 0.5) * (2.2 / 255.0);

  let w = (1.0 - ss(-0.75, 0.75, sd)) * ss(0.0, 0.3, m);
  return vec4f(mix(col, g, w), 1.0);
}
