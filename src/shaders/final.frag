#version 300 es
/* ═══════════════════════════════════════════════════════════════════════════
   Widget material — the final pass. Every widget's rounded rectangle is drawn
   here, in the same frame as the sky, so the material and the HTML on top of
   it never drift apart (the page scroll is driven by the same rAF).
   A frosted material in the manner of Apple's system materials:
     • blur      a wide (~30 pt) dual-Kawase blur of the live sky, read with a
                 bicubic B-spline filter so it is perfectly smooth — no texels,
                 no lensing, no distortion
     • vibrancy  saturation lifted (≈ 160 %), as the system materials do, so
                 the blur keeps the colour of the sky instead of turning grey
     • adaptive  a dark tint that deepens over bright clouds, so white text on
                 the material always reads; an open sheet is a step denser
     • edge      a hairline that catches the light from above (follows tilt)
     • grain     a fine dither: the gradient never bands, the surface reads as
                 a material rather than a flat fill
     • depth     soft contact shadows; the page dims while a sheet is open
     • materialise  blur and opacity arrive together (slot opacity m)
   ═══════════════════════════════════════════════════════════════════════════ */
precision mediump float;
#define N 10
uniform sampler2D uSky;
uniform sampler2D uBlur;        // ¼ res, heavy blur (half-float when available)
uniform highp vec2  uRes;
uniform highp vec4  uRect[N];   // centre xy, half size xy — GL pixels, y up
uniform vec4  uRectP[N];        // radius px, materialise 0..1, thickness 0..1, seed
uniform highp vec4  uPress;     // xy px, amount, slot
uniform vec2  uLight;           // highlight direction (screen, unit)
uniform highp float uTime;
uniform float uDim;             // background dim while a sheet is open (slot N-1)
out vec4 o;

float sdRBox(highp vec2 p, highp vec2 b, float r) {
  highp vec2 q = abs(p) - b + r;
  return float(length(max(q, 0.0)) + min(max(q.x, q.y), 0.0)) - r;
}
// cubic B-spline in 4 bilinear taps (Sigg & Hadwiger 2005): a smooth, texel-free magnification
vec3 bspline(sampler2D t, highp vec2 uv) {
  highp vec2 ts = vec2(textureSize(t, 0));
  highp vec2 st = uv * ts - 0.5;
  highp vec2 i = floor(st);
  vec2 f = vec2(st - i);
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  highp vec2 h0 = (i - 0.5 + w1 / g0) / ts, h1 = (i + 1.5 + w3 / g1) / ts;
  return (texture(t, vec2(h0.x, h0.y)).rgb * g0.x + texture(t, vec2(h1.x, h0.y)).rgb * g1.x) * g0.y
       + (texture(t, vec2(h0.x, h1.y)).rgb * g0.x + texture(t, vec2(h1.x, h1.y)).rgb * g1.x) * g1.y;
}
float hash12(highp vec2 p) {
  highp vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  highp vec2 px = gl_FragCoord.xy;
  highp vec2 uv = px / uRes;
  vec3 base = texture(uSky, vec2(uv)).rgb;

  // pick the top-most widget under this pixel (later slots win) + accumulate shadows
  highp vec4 R = vec4(0.0, 0.0, 1.0, 1.0);
  vec4 RP = vec4(0.0);
  float sd = 1e4, sel = -1.0, shadow = 0.0;
  for (int i = 0; i < N; i++) {
    highp vec4 r = uRect[i];
    vec4 rp = uRectP[i];
    float d = sdRBox(px - r.xy, r.zw, rp.x);
    float on = step(d, 0.75) * step(0.002, rp.y);
    float ds = sdRBox(px - r.xy + vec2(0.0, 6.0 + 14.0 * rp.z), r.zw, rp.x);
    shadow = max(shadow, (1.0 - smoothstep(-10.0, 34.0 + 46.0 * rp.z, ds)) * rp.y * (0.10 + 0.16 * rp.z));
    R = mix(R, r, on); RP = mix(RP, rp, on); sd = mix(sd, d, on); sel = mix(sel, float(i), on);
  }
  float isSheet = step(float(N) - 1.5, sel);
  vec3 col = base * (1.0 - uDim * 0.55) * (1.0 - shadow);

  float m = RP.y, rad = RP.x;
  highp vec2 lp = px - R.xy;
  float inD = -sd;
  // rim normal from the SDF gradient (for the light-catching hairline)
  vec2 n = normalize(vec2(sdRBox(lp + vec2(1.0, 0.0), R.zw, rad) - sdRBox(lp - vec2(1.0, 0.0), R.zw, rad),
                          sdRBox(lp + vec2(0.0, 1.0), R.zw, rad) - sdRBox(lp - vec2(0.0, 1.0), R.zw, rad)) + 1e-5);

  // the material: wide blur, materialising from the sharp sky as it appears
  vec3 g = mix(base, bspline(uBlur, uv), smoothstep(0.0, 0.6, m));
  float lum = dot(g, vec3(0.2126, 0.7152, 0.0722));
  g = clamp(mix(vec3(lum), g, 1.6), 0.0, 1.0);                       // vibrancy
  float tint = 0.20 + 0.30 * smoothstep(0.22, 0.85, lum) + 0.16 * isSheet;
  g = mix(g, vec3(0.032, 0.040, 0.070), tint);                       // adaptive dark tint
  g += 0.022;                                                        // a breath of frost
  g *= 1.0 - uDim * 0.55 * (1.0 - isSheet);
  // pressed: the whole surface lifts a touch, brightest under the finger
  float pr = uPress.z * step(abs(sel - uPress.w), 0.5);
  highp vec2 pd = px - uPress.xy;
  g += vec3(0.92, 0.96, 1.0) * pr * (0.035 + 0.07 * exp(-float(dot(pd, pd)) / 26000.0));
  // hairline edge, lit from above
  float facing = max(dot(n, uLight), 0.0);
  float rim = (1.0 - smoothstep(0.0, 1.25, inD)) * (0.10 + 0.32 * facing * facing);
  g += vec3(1.0) * rim * m;
  // grain
  g += (hash12(px + fract(float(uTime)) * 113.0) - 0.5) * (2.2 / 255.0);

  float w = (1.0 - smoothstep(-0.75, 0.75, sd)) * smoothstep(0.0, 0.3, m);
  o = vec4(mix(col, g, w), 1.0);
}
