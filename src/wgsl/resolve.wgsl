// Temporal accumulation for the clouds — WGSL twin of resolve.frag
#include full.wgsl
struct U { a: vec4f, b: vec4f };                          // a: xy fresh res, zw jitter; b: x fill, y blend
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tFresh: texture_2d<f32>;
@group(0) @binding(2) var tHist: texture_2d<f32>;
@group(0) @binding(3) var sClamp: sampler;
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let px = floor(fc.xy);
  let jit = u.a.zw;
  let par = px - 2.0 * floor(px * 0.5);
  let mine = step(abs(par.x - jit.x) + abs(par.y - jit.y), 0.5);
  let fresh = textureLoad(tFresh, vec2i(px * 0.5), 0);
  let freshB = textureSampleLevel(tFresh, sClamp, ((px - jit) * 0.5 + 0.5) / u.a.xy, 0.0);
  let hist = textureLoad(tHist, vec2i(px), 0);
  let blend = u.b.y;
  let r = mix(mix(hist, freshB, blend * 0.2), mix(hist, mix(fresh, freshB, 0.5), blend), mine);
  return mix(r, freshB, u.b.x);
}
