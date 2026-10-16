// One oversized triangle covers the target; no vertex buffers needed.
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
// Conventions: every off-screen pass works in GL's frame (y up): it uses the
// fragment position as gl_FragCoord would be, so its texture is simply stored
// upside down, and every pass reading it uses the same convention. Only the
// pass that draws to the screen (final.wgsl) flips y.
