// Rain on the glass — WGSL twin of drop.vert / drop.frag
struct U { a: vec4f };                                    // x aspect
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tDrop: texture_2d<f32>;
@group(0) @binding(2) var sClamp: sampler;
struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) a: f32 };
@vertex fn vs(@location(0) corner: vec2f, @location(1) d: vec4f) -> V {
  let pos = d.xy + corner * vec2f(d.z, d.z * d.w) * 1.7;
  var o: V;
  // y negated: the glass buffer is kept in GL's frame (see full.wgsl)
  o.pos = vec4f(pos.x / (u.a.x * 0.5), -(pos.y * 2.0 - 1.0), 0.0, 1.0);
  o.uv = corner * 0.5 + 0.5;
  let t = clamp((d.z - 0.0012) / (0.004 - 0.0012), 0.0, 1.0);
  o.a = t * t * (3.0 - 2.0 * t);
  return o;
}
@fragment fn fs(i: V) -> @location(0) vec4f {
  let t = textureSample(tDrop, sClamp, i.uv);
  return vec4f(t.rg, 0.0, t.a * i.a);
}
