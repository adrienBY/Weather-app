#version 300 es
/* ═══════════════════════════════════════════════════════════════════════════
   Glass widgets — the final pass. Every widget's rounded rectangle is drawn
   here, in the same frame as the sky, so the material and the HTML on top of
   it never drift apart (the page scroll is driven by the same rAF).
   Inside a widget the sky is seen through "liquid glass":
     • swirl     the blurred sky rotates around the widget centre with a slow,
                 ever-changing angle and drifts with a noise flow field
     • blur      two dual-Kawase levels; bigger/thicker glass blurs more
     • lensing   near the rim the lookup bends inward like a thick lens;
                 it ramps with "materialise", so glass appears by bending
                 light rather than fading (WWDC25 "Meet Liquid Glass")
     • adaptive  tint deepens over bright backdrops for legibility; a large,
                 expanded sheet turns more opaque to hold focus
     • light     a specular rim that follows device tilt, an inner edge glow,
                 and a soft glow that blooms under the fingertip
     • depth     soft shadows; the page dims while a sheet is open
   ═══════════════════════════════════════════════════════════════════════════ */
precision mediump float;
#define N 10
uniform sampler2D uSky;
uniform sampler2D uBlurA;       // 1/4 res
uniform sampler2D uBlurB;       // 1/4 res, built from 1/8 (wider)
uniform sampler2D uNoise;
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

void main() {
  highp vec2 px = gl_FragCoord.xy;
  vec2 uv = vec2(px / uRes);
  vec3 base = texture(uSky, uv).rgb;

  // pick the top-most widget under this pixel (later slots win) + accumulate shadows
  highp vec4 R = vec4(0.0, 0.0, 1.0, 1.0);
  vec4 RP = vec4(0.0);
  float sd = 1e4, sel = -1.0, shadow = 0.0;
  for (int i = 0; i < N; i++) {
    highp vec4 r = uRect[i];
    vec4 rp = uRectP[i];
    float d = sdRBox(px - r.xy, r.zw, rp.x);
    float on = step(d, 0.75) * step(0.002, rp.y);
    float ds = sdRBox(px - r.xy + vec2(0.0, 8.0 + 16.0 * rp.z), r.zw, rp.x);
    shadow = max(shadow, (1.0 - smoothstep(-6.0, 30.0 + 40.0 * rp.z, ds)) * rp.y * (0.14 + 0.22 * rp.z));
    R = mix(R, r, on); RP = mix(RP, rp, on); sd = mix(sd, d, on); sel = mix(sel, float(i), on);
  }
  float isSheet = step(float(N) - 1.5, sel);
  vec3 col = base * (1.0 - uDim * 0.55) * (1.0 - shadow);

  float m = RP.y, k = RP.z, rad = RP.x;
  highp vec2 lp = px - R.xy;
  float inD = -sd;
  // rim normal from the SDF gradient
  vec2 n = normalize(vec2(sdRBox(lp + vec2(1.0, 0.0), R.zw, rad) - sdRBox(lp - vec2(1.0, 0.0), R.zw, rad),
                          sdRBox(lp + vec2(0.0, 1.0), R.zw, rad) - sdRBox(lp - vec2(0.0, 1.0), R.zw, rad)) + 1e-5);
  // lensing: the lookup bends inward near the rim (thicker glass → wider, stronger)
  float L = (10.0 + 26.0 * k) * m;
  float bend = 1.0 - clamp(inD / max(L, 1e-3), 0.0, 1.0);
  bend *= bend;
  highp vec2 warp = -vec2(n) * bend * L * 0.85;
  // swirl around the centre — angle changes forever, strongest in the middle
  vec2 ln = vec2(lp / max(R.zw, vec2(1.0)));
  float seed = RP.w;
  float ang = (0.45 + 0.55 * k) * (0.7 * sin(float(uTime) * 0.23 + seed * 6.283) + 0.3 * sin(float(uTime) * 0.37 + seed * 3.1)) * exp(-dot(ln, ln) * 0.9);
  float ca = cos(ang), sa = sin(ang);
  highp vec2 sw = mat2(ca, sa, -sa, ca) * lp - lp;
  // flow: a drifting noise field displaces the view through the glass
  vec2 fl = (texture(uNoise, ln * 0.35 + vec2(float(uTime) * 0.011, -float(uTime) * 0.008) + seed).rg - 0.5) * (36.0 + 70.0 * k);
  vec2 suv = vec2((px + warp + sw + fl) / uRes);
  vec3 g = mix(texture(uBlurA, suv).rgb, texture(uBlurB, suv).rgb, 0.45 + 0.5 * k);
  // vibrancy + adaptive tint
  float lum = dot(g, vec3(0.299, 0.587, 0.114));
  g = mix(vec3(lum), g, 1.28);
  float tint = 0.14 + 0.36 * smoothstep(0.20, 0.80, lum) + 0.30 * k * isSheet;
  g = mix(g, vec3(0.030, 0.040, 0.075), tint);
  g *= 1.0 - uDim * 0.55 * (1.0 - isSheet);
  // light: specular rim following tilt, faint inner rim, fingertip bloom
  float facing = max(dot(n, uLight), 0.0);
  float rim = (1.0 - smoothstep(0.0, 1.5, inD)) * (0.20 + 0.80 * facing * facing);
  float rim2 = smoothstep(0.0, 1.5, inD) * (1.0 - smoothstep(1.5, 6.0, inD)) * max(dot(-n, uLight), 0.0);
  g += vec3(1.0) * (rim * 0.55 + rim2 * 0.08 + bend * 0.035) * m;
  highp vec2 pd = px - uPress.xy;
  g += vec3(0.90, 0.95, 1.0) * exp(-float(dot(pd, pd)) / (7000.0 + 40000.0 * k)) * uPress.z * step(abs(sel - uPress.w), 0.5) * 0.20;

  float w = (1.0 - smoothstep(-0.75, 0.75, sd)) * smoothstep(0.0, 0.25, m);
  o = vec4(mix(col, g, w), 1.0);
}
