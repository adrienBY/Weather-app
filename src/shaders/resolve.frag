#version 300 es
/* Temporal accumulation for the clouds: the history pixel traced this frame
   takes the fresh sample (blended, to average the jitter); the other three
   lean gently toward the bilinear fresh image so drifting clouds don't smear. */
precision mediump float;
uniform sampler2D uFresh;
uniform sampler2D uHist;
uniform vec2  uFreshRes;
uniform vec2  uJit;
uniform float uFill;         // 1 right after a resize / first frame
out vec4 o;
void main() {
  vec2 px = floor(gl_FragCoord.xy);
  vec2 par = mod(px, 2.0);
  float mine = step(abs(par.x - uJit.x) + abs(par.y - uJit.y), 0.5);
  vec4 fresh = texelFetch(uFresh, ivec2(px * 0.5), 0);
  vec4 freshB = texture(uFresh, ((px - uJit) * 0.5 + 0.5) / uFreshRes);
  vec4 hist = texelFetch(uHist, ivec2(px), 0);
  // the traced pixel takes its own sample half-and-half with the bilinear
  // neighbourhood (4 rays with 4 different jitters) — a cheap spatial filter
  // that removes the variance floor a pure EMA would leave at hard cloud rims
  vec4 r = mix(mix(hist, freshB, 0.05), mix(hist, mix(fresh, freshB, 0.5), 0.25), mine);
  o = mix(r, freshB, uFill);
}
