#version 300 es
/* ═══════════════════════════════════════════════════════════════════════════
   CIEL — sky compositor (renders into a texture; final.frag adds the glass)
   Every pixel builds its real view ray from the camera, so the sun, moon,
   stars, cirrus and lake reflection are all geometrically consistent:
     0. refraction      rain drops on the glass, touch ripples, lake splashes
     1. view ray        pinhole camera facing the equator; below the horizon
                        the ray is reflected (a still lake)
     2. gradient        4 lighting regimes from the real solar elevation
     3. stars           fixed to the celestial sphere, rotated by sidereal
                        time around the pole — they wheel across the night
     4. sun & moon      angular disks + Mie-ish glow; true lunar phase
     5. cirrus          procedural streaks on a high plane
     6. clouds          the volumetric buffer (premultiplied), re-projected
     7. lightning, water, rain streaks, snow, fog, dither
   No dynamic loops or branches. highp only where angles/coordinates need it.
   ═══════════════════════════════════════════════════════════════════════════ */
precision mediump float;
precision mediump sampler2D;
#define HZ __HZ__

uniform highp vec2  uRes;
uniform highp float uTime;
uniform sampler2D   uNoise;
uniform sampler2D   uField;
uniform sampler2D   uClouds;    // volumetric history (covers y ∈ [HZ, 1])
uniform sampler2D   uGlass;     // drops: rg refraction map, a coverage
uniform highp vec3  uCamF, uCamU, uCamR;
uniform highp vec2  uTan;
uniform highp mat3  uStarRot;
uniform highp vec3  uSunDir;
uniform highp vec3  uMoonDir, uMoonR, uMoonU;
uniform vec4  uSun;             // x visibility, y sin(elevation), z −, w −
uniform vec4  uMoon;            // x visibility, y illuminated fraction
uniform vec3  uMoonL;           // light direction on the moon's disk (phase)
uniform highp vec4 uDrift2;     // xy cirrus drift, zw evolve (wrapped to [0,1))
uniform highp vec4 uPhase;      // rain near, rain far, snow near, snow far (wrapped to [0,64))
uniform vec4  uCloud;           // x low, y mid, z high cover, w precipitation darkness
uniform vec4  uWx;              // x rain, y snow, z fog, w storm
uniform vec4  uWind;            // x rain slant, y snow slant
uniform vec4  uFlash;           // xy screen centre, z intensity, w bolt
uniform highp vec2 uBolt;
uniform highp vec4 uRip[6];
uniform vec3  uPal[5];          // dayZenith, dayHorizon, golden, dusk, nightHorizon
uniform vec4  uW;               // regime weights: night, twilight, golden, day
uniform vec3  uLit, uShade, uHorizon;
out vec4 outColor;

float hash12(highp vec2 p) {
  highp vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(highp vec2 p) {
  highp vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float fbm3(highp vec2 q) {
  float s = texture(uNoise, q).b * .5;
  s += texture(uNoise, q * 2. + vec2(.71, .53)).a * .25;
  s += texture(uNoise, q * 4. + vec2(.19, .83)).r * .125;
  return s * (1. / .875);
}
// one star candidate per cell of a cube-face grid; ~1 px wide at any resolution
float starFace(highp vec2 f, float scale, float thresh, float pxr) {
  highp vec2 sp = f * scale;
  highp vec2 id = floor(sp);
  vec2 c = vec2(fract(sp)) - .5;
  vec2 h = hash22(id);
  float pres = step(thresh, hash12(id + 19.19));
  float r = pxr * scale;
  float d = length(c - (h - .5) * .7);
  highp float tw = .62 + .38 * sin(uTime * (1.1 + h.y * 2.6) + h.x * 40.);
  return smoothstep(r * 1.9, r * .25, d) * pres * float(tw) * (.35 + .65 * h.y);
}
float stars(highp vec3 d, float pxr) {
  highp vec3 a = abs(d);
  float mx = step(a.y, a.x) * step(a.z, a.x), my = (1. - mx) * step(a.x, a.y) * step(a.z, a.y), mz = 1. - mx - my;
  highp vec2 fx = d.yz / a.x, fy = d.xz / a.y, fz = d.xy / a.z;
  float s1 = starFace(fx + sign(d.x) * 3.1, 90., .94, pxr) * mx + starFace(fy + sign(d.y) * 5.7, 90., .94, pxr) * my + starFace(fz + sign(d.z) * 7.3, 90., .94, pxr) * mz;
  float s2 = starFace(fx + 1.3, 38., .975, pxr) * mx + starFace(fy + 2.9, 38., .975, pxr) * my + starFace(fz + 4.1, 38., .975, pxr) * mz;
  return s1 + s2 * 1.5;
}
float rainLayer(highp vec2 p, float cols, float rows, highp float phase, float slant, float dens, float len, float wid) {
  highp vec2 st = vec2((p.x + p.y * slant) * cols, p.y * rows + phase);
  highp vec2 cell = floor(st);
  vec2 f = vec2(fract(st));
  cell.y = mod(cell.y, 64.);
  vec2 h = hash22(cell);
  float pres = step(hash12(cell + 7.77), dens);
  float x = abs(f.x - (.15 + .7 * h.x));
  float y = (f.y - h.y * (1. - len)) / len;
  float body = smoothstep(0., .08, y) * (1. - smoothstep(.15, 1., y));
  return smoothstep(wid, wid * .2, x) * body * pres;
}
float snowLayer(highp vec2 p, float scale, highp float phase, float size, float dens, float slant) {
  highp vec2 st = vec2((p.x + p.y * slant) * scale, p.y * scale + phase);
  st.x += sin(st.y * .58904862 + uTime * .7) * .15;       // 2π·6/64: periodic over the 64-row wrap
  highp vec2 cell = floor(st);
  vec2 f = vec2(fract(st));
  cell.y = mod(cell.y, 64.);
  vec2 h = hash22(cell);
  float pres = step(hash12(cell + 3.33), dens);
  float d = length(f - (.5 + (h - .5) * .4));
  return smoothstep(size, size * .3, d) * pres * (.45 + .55 * h.y);
}

void main() {
  highp vec2 uv = gl_FragCoord.xy / uRes;
  highp float aspect = uRes.x / uRes.y;
  highp vec2 p = vec2((uv.x - .5) * aspect, uv.y);
  float water = step(p.y, HZ);

  // ── 0. refraction: drops on the glass, ripples, lake splashes ────────────
  vec4 gw = texture(uGlass, uv);
  float ga = clamp(gw.a * 6. - 3., 0., 1.);               // RainEffect's alpha sharpening → crisp drop edges
  highp vec2 rOff = vec2(gw.g - .5, .5 - gw.r) * 2. * ga * .045;
  float rGlow = 0.;
  for (int i = 0; i < 6; i++) {
    highp vec4 r = uRip[i];
    highp vec2 d = p - r.xy;
    d.y *= 1. + water * 1.8;
    highp float dist = length(d) + 1e-4;
    highp float k = dist - r.z * .30;
    float env = exp(-float(k * k) * 500.) * r.w * exp(-r.z * 1.5);
    float wv = sin(float(k) * 150.);
    rOff += d / dist * wv * env * .010;
    rGlow += env * (.5 + .5 * wv);
  }
  {
    highp vec2 wp = vec2(p.x, 1.) / max(HZ - p.y, .015) * 6.;
    highp vec2 id = floor(wp);
    vec2 f = vec2(fract(wp)) - .5;
    vec2 h = hash22(id + 31.7);
    float t = float(fract(uTime * (.6 + h.x * .8) + h.y));
    float pres = step(h.x * .7 + h.y * .3, uWx.x * .9);
    float rk = (length(f - (h - .5) * .5) - t * .45) * 22.;
    float ring = exp(-rk * rk) * (1. - t) * (1. - t) * pres * water;
    rOff.y += ring * .004;
    rGlow += ring * .8;
  }
  highp vec2 ps = p + rOff;

  // ── 1. view ray (reflected below the horizon) ────────────────────────────
  highp vec2 ndc = vec2(ps.x / (aspect * .5), ps.y * 2. - 1.);
  highp vec3 rd = normalize(uCamF + uCamR * (ndc.x * uTan.x) + uCamU * (ndc.y * uTan.y));
  rd.y = mix(rd.y, max(-rd.y, .0015), water);
  rd.y = max(rd.y, .0015);
  rd = normalize(rd);
  // where that ray lands in the cloud buffer (exact reflection for the lake)
  highp float cz = max(dot(rd, uCamF), 1e-3);
  highp vec2 cn = vec2(dot(rd, uCamR) / (cz * uTan.x), dot(rd, uCamU) / (cz * uTan.y));
  highp vec2 cuv = vec2(cn.x * .5 + .5, ((cn.y * .5 + .5) - HZ) / (1. - HZ));

  // ── 2. gradient ──────────────────────────────────────────────────────────
  float wN = uW.x, wT = uW.y, wG = uW.z, wD = uW.w, e = uSun.y;
  float g = clamp(float(rd.y) / .87, 0., 1.);
  vec2 hs = normalize(vec2(uSunDir.xz) + 1e-4), hr = normalize(vec2(rd.xz) + 1e-4);
  float side = exp((dot(hr, hs) - 1.) * 1.8);
  vec3 hG = mix(vec3(.80, .74, .74), uPal[2], .35 + .65 * side);
  vec3 hT = mix(vec3(.30, .21, .40), uPal[3], side);
  vec3 sky = wD * mix(uPal[1], uPal[0], pow(g, .50))
           + wG * mix(hG, vec3(.24, .38, .72), pow(g, .38))
           + wT * mix(hT, vec3(.05, .07, .20), pow(g, .28))
           + wN * mix(uPal[4], vec3(0.), pow(g, .20));
  float dayL = wD + wG * .75 + wT * .3;
  float moonLight = uMoon.x * uMoon.y;
  float cover = max(uCloud.x, uCloud.y * .85);
  float lum0 = dot(sky, vec3(.299, .587, .114));
  sky = mix(sky, vec3(lum0) * vec3(.92, .95, 1.) * (1. - .5 * uCloud.w), cover * .45);
  vec3 col = sky;

  // ── 3. stars ─────────────────────────────────────────────────────────────
  float pxr = 2.2 * uTan.y / uRes.y;                       // one pixel, in radians-ish
  float starVis = wN * (1. - .7 * moonLight) * smoothstep(.0, .12, float(rd.y)) * (1. - uWx.z) * (1. - smoothstep(.45, .9, cover));
  col += vec3(.82, .88, 1.) * stars(uStarRot * rd, pxr) * starVis;

  // ── 4. sun & moon ────────────────────────────────────────────────────────
  highp float cs = dot(rd, uSunDir);
  highp float ds = 1. - cs;
  vec3 sunC = mix(vec3(1., .52, .24), vec3(1., .96, .88), smoothstep(-.02, .3, e));
  float glow = (exp(-float(ds) * 18.) * .30 + exp(-float(ds) * 420.) * .55) * smoothstep(-.12, 0., e);
  float disk = smoothstep(1.35e-4, .95e-4, float(ds)) * uSun.x;
  col += sunC * (glow * (1. - cover * .6) + disk * 2.2 * (1. - smoothstep(.7, 1., cover)));

  highp float cm = dot(rd, uMoonDir);
  highp vec2 md = vec2(dot(rd, uMoonR), dot(rd, uMoonU)) / .0245;   // disk radius ≈ 1.4°
  float mr2 = float(dot(md, md));
  // a thin crescent is lost in daylight glare (and hugs the sun anyway)
  float inMoon = smoothstep(1.06, .94, mr2) * step(0., float(cm)) * uMoon.x * (1. - smoothstep(.7, 1., cover))
               * mix(1., smoothstep(.10, .30, uMoon.y), dayL);
  vec3 mn = vec3(vec2(md), sqrt(max(1. - mr2, 0.)));
  float mlit = smoothstep(-.06, .10, dot(mn, uMoonL));
  float mare = texture(uNoise, vec2(md) * .11 + vec2(.43, .17)).r;
  col = mix(col, col * dayL + vec3(.93, .94, .98) * (.70 + (mare - .5) * .9) * mlit, inMoon);
  col += vec3(.55, .62, .80) * exp(-float(1. - cm) * 60.) * .10 * moonLight * (1. - dayL) * (1. - cover * .7);

  // ── 5. cirrus (high plane, true perspective) ─────────────────────────────
  vec2 disp = texture(uField, vec2(uv.x, ps.y)).xy * 2. - 1.;
  highp vec2 pl = rd.xz / max(rd.y, .03);
  highp vec2 qh = pl * vec2(.10, .32) + disp * .05 + uDrift2.xy;
  float thH = mix(.70, .36, uCloud.z);
  float aH = smoothstep(thH, thH + .22, fbm3(qh)) * .55 * smoothstep(.0, .08, float(rd.y));
  vec3 cH = mix(mix(uLit, uShade, .25) + (wG + wT) * vec3(.25, .10, .08), uHorizon, (1. - smoothstep(.0, .25, float(rd.y))) * .5);
  col = mix(col, cH, aH);

  // ── 6. volumetric clouds ─────────────────────────────────────────────────
  vec4 cl = texture(uClouds, cuv);
  col = col * (1. - cl.a) + cl.rgb;

  // ── 7. lightning, water, precipitation, fog ──────────────────────────────
  highp vec2 q = vec2(ps.x, mix(ps.y, 2. * HZ - ps.y, water));
  col += vec3(.72, .78, 1.) * uFlash.z * (.25 + 1.4 * exp(-length(vec2(q - uFlash.xy)) * 4.5)) * (.2 + cl.a * .8);
  highp float by = q.y;
  highp float bx = uBolt.x + .055 * sin(by * 13. + uBolt.y) + .025 * sin(by * 37. + uBolt.y * 2.3) + .010 * sin(by * 97. + uBolt.y * 5.1);
  float bd = abs(float(q.x - bx));
  col += vec3(.85, .88, 1.) * (exp(-bd * uRes.y * .45) + exp(-bd * 40.) * .25) * smoothstep(.70, .52, float(by)) * smoothstep(HZ, HZ + .02, float(by)) * uFlash.z * uFlash.w;

  float depth = clamp(float((HZ - p.y) / HZ), 0., 1.);
  col = mix(col, col * mix(.62, .18, depth) * vec3(.92, .96, 1.), water);
  col += uHorizon * exp(-abs(float(p.y - HZ)) * 260.) * .10;
  float lum = dot(col, vec3(.299, .587, .114));

  float rain = uWx.x;
  float rs = rainLayer(p, 95., 2.3, uPhase.x, uWind.x, rain * .55, .55, .08)
           + rainLayer(p, 200., 4.6, uPhase.y, uWind.x * .9, rain * .75, .45, .07) * .6
           + rainLayer(p + vec2(.13, 0.), 360., 8., uPhase.y, uWind.x * .8, rain, .35, .07) * .3;
  col = col * (1. - rain * .10) + (.30 + lum * .9) * vec3(.80, .86, .96) * rs * .38;

  float snow = uWx.y;
  float sn = snowLayer(p, 9., uPhase.z, .13, snow * .8, uWind.y)
           + snowLayer(p + vec2(.31, .17), 17., uPhase.w, .11, snow * .9, uWind.y) * .7
           + snowLayer(p + vec2(.71, .53), 30., uPhase.w, .10, snow, uWind.y * .8) * .45;
  col = mix(col, vec3(.93, .95, 1.) * (.18 + .82 * max(dayL, moonLight * .5)), clamp(sn, 0., 1.) * .9);

  float fogN = texture(uNoise, vec2(p.x * .9, p.y * 2.2) + uDrift2.zw).g;
  float fogA = uWx.z * (.50 + .50 * fogN) * (1. - .55 * smoothstep(HZ, .95, float(p.y)));
  col = mix(col, mix(vec3(.025, .027, .032), vec3(.74, .76, .80), dayL) + uHorizon * .15, clamp(fogA, 0., .92));

  float lowRim = smoothstep(.40, .08, gw.r) * ga, spec = smoothstep(.70, .97, gw.g) * smoothstep(.35, .55, gw.r) * ga;
  col = col * (1. - lowRim * .28) * (1. + ga * .06) + spec * (.12 + lum * .45);
  col += rGlow * .07 * (.15 + lum);

  // soft highlight shoulder: glare compresses towards 0.96 instead of clipping
  // to flat white, so the hero type stays readable over a bright sky
  vec3 hi = max(col - .72, 0.);
  col = min(col, .72) + hi / (1. + hi * 4.2);
  float mx = max(col.r, max(col.g, col.b));
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 91.7) - .5) * (1.5 / 255.) * step(.006, mx);
  outColor = vec4(clamp(col, 0., 1.), 1.);
}
