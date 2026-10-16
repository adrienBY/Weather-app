// Dual-Kawase downsample — WGSL twin of down.frag
#include full.wgsl
struct U { a: vec4f };                                    // xy destination size, zw 1 / source size
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tSrc: texture_2d<f32>;
@group(0) @binding(2) var sClamp: sampler;
fn tap(uv: vec2f) -> vec4f { return textureSampleLevel(tSrc, sClamp, uv, 0.0); }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / u.a.xy;
  let t = u.a.zw;
  var s = tap(uv) * 4.0;
  s += tap(uv - t);
  s += tap(uv + t);
  s += tap(uv + vec2f(t.x, -t.y));
  s += tap(uv - vec2f(t.x, -t.y));
  return s * 0.125;
}
