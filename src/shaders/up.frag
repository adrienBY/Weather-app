#version 300 es
/* Dual-Kawase upsample: 8 taps in a diamond — climbs the blur back from
   1/32 to 1/4 with no blocky texels. */
precision mediump float;
uniform sampler2D uSrc;
uniform vec2 uDst;
uniform vec2 uTex;      // 1 / source size
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uDst, h = uTex * 0.5;
  vec4 s = texture(uSrc, uv + vec2(-h.x * 2.0, 0.0));
  s += texture(uSrc, uv + vec2(-h.x, h.y)) * 2.0;
  s += texture(uSrc, uv + vec2(0.0, h.y * 2.0));
  s += texture(uSrc, uv + vec2(h.x, h.y)) * 2.0;
  s += texture(uSrc, uv + vec2(h.x * 2.0, 0.0));
  s += texture(uSrc, uv + vec2(h.x, -h.y)) * 2.0;
  s += texture(uSrc, uv + vec2(0.0, -h.y * 2.0));
  s += texture(uSrc, uv + vec2(-h.x, -h.y)) * 2.0;
  o = s / 12.0;
}
