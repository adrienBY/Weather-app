// Dual-Kawase upsample — WGSL twin of up.frag
#include full.wgsl
struct U { a: vec4f };                                    // xy destination size, zw 1 / source size
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tSrc: texture_2d<f32>;
@group(0) @binding(2) var sClamp: sampler;
fn tap(uv: vec2f) -> vec4f { return textureSampleLevel(tSrc, sClamp, uv, 0.0); }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / u.a.xy;
  let h = u.a.zw * 0.5;
  var s = tap(uv + vec2f(-h.x * 2.0, 0.0));
  s += tap(uv + vec2f(-h.x, h.y)) * 2.0;
  s += tap(uv + vec2f(0.0, h.y * 2.0));
  s += tap(uv + vec2f(h.x, h.y)) * 2.0;
  s += tap(uv + vec2f(h.x * 2.0, 0.0));
  s += tap(uv + vec2f(h.x, -h.y)) * 2.0;
  s += tap(uv + vec2f(0.0, -h.y * 2.0));
  s += tap(uv + vec2f(-h.x, -h.y)) * 2.0;
  return s / 12.0;
}
