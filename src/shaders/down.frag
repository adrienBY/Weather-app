#version 300 es
/* Dual-Kawase downsample (Marius Bjørge, SIGGRAPH 2015): 5 bilinear taps
   average ~16 source texels while halving resolution. Five of these (down
   to 1/32) and three up.frag passes give the widget material its wide,
   smooth ~30 pt blur. */
precision mediump float;
uniform sampler2D uSrc;
uniform vec2 uDst;      // destination size
uniform vec2 uTex;      // 1 / source size
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uDst;
  vec4 s = texture(uSrc, uv) * 4.0;
  s += texture(uSrc, uv - uTex);
  s += texture(uSrc, uv + uTex);
  s += texture(uSrc, uv + vec2(uTex.x, -uTex.y));
  s += texture(uSrc, uv - vec2(uTex.x, -uTex.y));
  o = s * 0.125;
}
