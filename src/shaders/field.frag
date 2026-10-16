#version 300 es
/* Touch force field — 64×128 ping-pong texture. xy = displacement applied to
   the clouds (biased: 0.5 = none). Each frame it self-advects (wakes trail),
   diffuses, decays (clouds heal) and receives up to 4 velocity splats. */
precision mediump float;
uniform sampler2D uPrev;
uniform vec2  uSize;
uniform vec4  uSplat[4];
uniform float uDecay;
uniform float uAspect;
out vec4 o;
vec2 rd(vec2 uv) { return texture(uPrev, uv).xy * 2.0 - 1.0; }
void main() {
  vec2 uv = gl_FragCoord.xy / uSize, tx = 1.0 / uSize;
  vec2 v = rd(uv);
  vec2 adv = rd(uv - v * tx * 2.0);
  vec2 blur = (rd(uv + vec2(tx.x, 0.)) + rd(uv - vec2(tx.x, 0.)) + rd(uv + vec2(0., tx.y)) + rd(uv - vec2(0., tx.y))) * 0.25;
  vec2 nv = mix(adv, blur, 0.3) * uDecay;
  for (int i = 0; i < 4; i++) {
    vec2 d = uv - uSplat[i].xy; d.x *= uAspect;
    nv += uSplat[i].zw * exp(-dot(d, d) * 170.0);
  }
  nv = sign(nv) * max(abs(nv) - 0.004, 0.0);         // dead zone: no 8-bit creep
  o = vec4(clamp(nv, -1.0, 1.0) * 0.5 + 0.5, 0.0, 1.0);
}
