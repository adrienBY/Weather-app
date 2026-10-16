// Touch force field (64×128 ping-pong) — WGSL twin of field.frag
#include full.wgsl
struct U { a: vec4f, splat: array<vec4f, 4> };           // a: xy size, z decay, w aspect
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tPrev: texture_2d<f32>;
@group(0) @binding(2) var sClamp: sampler;
fn rd(uv: vec2f) -> vec2f { return textureSampleLevel(tPrev, sClamp, uv, 0.0).xy * 2.0 - 1.0; }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / u.a.xy;
  let tx = 1.0 / u.a.xy;
  let v = rd(uv);
  let adv = rd(uv - v * tx * 2.0);
  let blur = (rd(uv + vec2f(tx.x, 0.0)) + rd(uv - vec2f(tx.x, 0.0)) + rd(uv + vec2f(0.0, tx.y)) + rd(uv - vec2f(0.0, tx.y))) * 0.25;
  var nv = mix(adv, blur, 0.3) * u.a.z;
  for (var i = 0; i < 4; i++) {
    var d = uv - u.splat[i].xy;
    d.x *= u.a.w;
    nv += u.splat[i].zw * exp(-dot(d, d) * 170.0);
  }
  nv = sign(nv) * max(abs(nv) - vec2f(0.004), vec2f(0.0));
  return vec4f(clamp(nv, vec2f(-1.0), vec2f(1.0)) * 0.5 + 0.5, 0.0, 1.0);
}
