#version 300 es
/* ═══════════════════════════════════════════════════════════════════════════
   CIEL — sky compositor (renders into a texture; final.frag adds the glass)
   Every pixel builds its real view ray from the camera, so the sun, moon,
   stars, Milky Way and lake reflection are geometrically consistent:
     0. refraction      rain drops on the glass, touch ripples, lake splashes
     1. view ray        pinhole camera aimed like a photographer (app.js
                        aimCamera); below the horizon the ray is reflected
     2. atmosphere      physically based sky radiance from the sky-view LUTs
                        (sun + moon) — blue hour, golden hour, the Earth's
                        shadow and the belt of Venus all fall out of the
                        physics, at any latitude and season
     3. night           stars and the real Milky Way (ESO/S. Brunier
                        panorama), fixed to the celestial sphere and turned by
                        sidereal time
     4. sun & moon      limb-darkened sun reddened by the transmittance LUT;
                        moon with its true phase
     5. clouds          the volumetric buffer (premultiplied linear radiance)
     → exposure, ACES filmic tone curve, sRGB
     6. lightning, water, fog
     7. rain & snow     real 3-D precipitation: drops on six cylinders around
                        the camera at true depths (1.4 – 32 m), so near drops
                        are big, soft and fast, far ones are fine threads; they
                        lean and drift with the wind, shift with parallax when
                        the phone tilts, and end at the lake surface
     8. drops on the glass, dither
   No dynamic loops; one uniform branch (precipitation). highp only where
   angles/coordinates need it.
   ═══════════════════════════════════════════════════════════════════════════ */
precision mediump float;
precision mediump sampler2D;
#define HZ __HZ__
#define ATMOS_MEDIUMP
#include atmos.glsl

uniform highp vec2  uRes;
uniform highp float uTime;
uniform sampler2D   uNoise;
uniform sampler2D   uField;
uniform sampler2D   uClouds;    // volumetric history (covers screen y ∈ uBand)
uniform highp vec2  uBand;
uniform sampler2D   uGlass;     // drops: rg refraction map, a coverage
uniform sampler2D   uTrans;     // transmittance LUT
uniform sampler2D   uSkyS, uSkyM;   // sky-view LUTs: sun, moon
uniform sampler2D   uMilky;     // Milky Way, galactic plate carrée
uniform highp vec3  uCamF, uCamU, uCamR;
uniform highp vec2  uTan;
uniform highp mat3  uEqRot;     // local → equatorial (turns with sidereal time)
uniform highp mat3  uGalRot;    // local → galactic
uniform highp vec3  uSunDir;
uniform highp vec3  uMoonDir, uMoonR, uMoonU;
uniform vec4  uSun;             // x disk visibility, y sin(elevation)
uniform vec4  uMoon;            // x visibility, y illuminated fraction
uniform vec3  uMoonL;           // light direction on the moon's disk (phase)
uniform vec3  uLight;           // x sun illuminance, y moon illuminance
uniform float uExposure;
uniform vec3  uNight;           // linear night-sky floor (airglow / city glow)
uniform highp vec4 uDrift2;     // zw fog drift (wrapped to [0,1))
uniform vec4  uCloud;           // x low, y mid, z high cover, w precipitation darkness
uniform vec4  uWx;              // x rain, y snow, z fog, w storm
uniform vec4  uWind;            // x rain slant, y snow slant
uniform vec4  uFlash;           // xy screen centre, z intensity, w bolt
uniform highp vec2 uBolt;
uniform highp vec4 uRip[6];
uniform vec4  uW;               // light regime weights: night, twilight, golden, day
uniform highp vec3  uEye;       // eye offset in metres (x right, y up) for parallax; z camera yaw
out vec4 outColor;

// ACES filmic curve (Narkowicz 2015) — highlights roll off instead of clipping
vec3 aces(vec3 x) { return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
// + a photographic saturation lift (a camera's look, not the eye's: physically
//   the sky is paler than we remember it)
vec3 toDisplay(vec3 lin) { vec3 c = pow(aces(lin), vec3(1.0 / 2.2)); float l = dot(c, vec3(.2126, .7152, .0722)); return clamp(mix(vec3(l), c, 1.32), 0.0, 1.0); }
// cubic B-spline in 4 bilinear taps (Sigg & Hadwiger 2005)
vec4 bsplineRGBA(sampler2D t, highp vec2 uv) {
  highp vec2 ts = vec2(textureSize(t, 0));
  highp vec2 st = uv * ts - .5;
  highp vec2 i = floor(st);
  vec2 f = vec2(st - i), f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1. - 3. * f + 3. * f2 - f3) / 6., w1 = (4. - 6. * f2 + 3. * f3) / 6.;
  vec2 w2 = (1. + 3. * f + 3. * f2 - 3. * f3) / 6., w3 = f3 / 6.;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  highp vec2 h0 = (i - .5 + w1 / g0) / ts, h1 = (i + 1.5 + w3 / g1) / ts;
  return (texture(t, vec2(h0.x, h0.y)) * g0.x + texture(t, vec2(h1.x, h0.y)) * g1.x) * g0.y
       + (texture(t, vec2(h0.x, h1.y)) * g0.x + texture(t, vec2(h1.x, h1.y)) * g1.x) * g1.y;
}
vec3 skyAt(highp vec3 d) { return skyLookup(uSkyS, d, uSunDir) * uLight.x + skyLookup(uSkyM, d, uMoonDir) * uLight.y; }

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
  float s1 = starFace(fx + sign(d.x) * 3.1, 90., .972, pxr) * mx + starFace(fy + sign(d.y) * 5.7, 90., .972, pxr) * my + starFace(fz + sign(d.z) * 7.3, 90., .972, pxr) * mz;
  float s2 = starFace(fx + 1.3, 38., .984, pxr) * mx + starFace(fy + 2.9, 38., .984, pxr) * my + starFace(fz + 4.1, 38., .984, pxr) * mz;
  return s1 + s2 * 1.5;
}
// ── 3-D precipitation ───────────────────────────────────────────────────────
// The view ray meets a cylinder of radius R (metres) around the camera at
// height v = tan(elevation)·R and arc length u = azimuth·R. Drops live on a
// grid in (u, v) that falls at the real speed, so their size, speed and
// spacing on screen all follow from their depth.
// ang: azimuth of the ray (radians, world), el: tan(elevation), pxm: one pixel (radians)
float rainCyl(highp float ang, highp float el, float R, float slant, float dens, float pxm) {
  float cw = R * .05, chh = R * .26 + .3;                  // ~ the same number of drops per screen area per layer
  highp float u = ang * R - uEye.x, v = el * R - uEye.y;   // an eye offset shifts near layers more: parallax
  u += v * slant;                                         // drops lean with the wind, and drift with it as they fall
  highp vec2 st = vec2(u / cw, (v + uTime * 9.) / chh);   // 9 m/s
  highp vec2 id = floor(st);
  vec2 f = vec2(fract(st));
  id.y = mod(id.y, 256.);
  vec2 h = hash22(id + R * 1.7);
  float pres = step(hash12(id + 7.7 + R), dens);
  float len = .16 / chh;                                  // ~1/60 s of motion blur
  float wid = max(.0022 + .005 / R, pxm * R * .65);       // 2 mm, defocused up close, never under a pixel
  float x = abs(f.x - (.12 + .76 * h.x)) * cw;
  float y = (f.y - h.y * (1. - len)) / len;
  float body = smoothstep(0., .25, y) * (1. - smoothstep(.55, 1., y));
  float k = clamp(.0045 / wid, .12, 1.);                  // energy: wide (far or defocused) drops are fainter
  return (1. - smoothstep(wid * .25, wid, x)) * body * pres * k * step(-1.6, v);   // they end at the lake (eye 1.6 m up)
}
float snowCyl(highp float ang, highp float el, float R, float slant, float dens, float pxm) {
  float cs = R * .13 + .05;
  highp float u = ang * R - uEye.x, v = el * R - uEye.y;
  u += v * slant;
  highp vec2 st = vec2(u / cs, (v + uTime * 1.1) / cs);    // 1.1 m/s
  st.x += sin(st.y * .9 + uTime * .8 + R) * .22;          // flutter
  highp vec2 id = floor(st);
  vec2 f = vec2(fract(st));
  id.y = mod(id.y, 256.);
  vec2 h = hash22(id + R * 3.1);
  float pres = step(hash12(id + 3.3 + R), dens);
  float rad = max(.006 + .012 / R, pxm * R * .7);
  float d = length((f - (.5 + (h - .5) * .6)) * cs);
  float k = clamp(.008 / rad, .2, 1.) * (.55 + .45 * h.y);
  return smoothstep(rad, rad * .2, d) * pres * k * step(-1.6, v);
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
  highp vec3 rv = rd;                                      // the true view ray (precipitation is in front of the lake)
  rd.y = mix(rd.y, max(-rd.y, .0015), water);
  rd.y = max(rd.y, .0015);
  rd = normalize(rd);
  // where that ray lands in the cloud buffer (exact reflection for the lake)
  highp float cz = max(dot(rd, uCamF), 1e-3);
  highp vec2 cn = vec2(dot(rd, uCamR) / (cz * uTan.x), dot(rd, uCamU) / (cz * uTan.y));
  highp vec2 cuv = vec2(cn.x * .5 + .5, ((cn.y * .5 + .5) - uBand.x) / (uBand.y - uBand.x));

  // ── 2. atmosphere (linear radiance × exposure) ───────────────────────────
  float wN = uW.x, wT = uW.y, wG = uW.z, wD = uW.w, e = uSun.y;
  float dayL = wD + wG * .75 + wT * .3;
  float moonLight = uMoon.x * uMoon.y;
  float cover = max(uCloud.x, uCloud.y * .85);
  vec3 Ls = skyAt(rd);
  float lum0 = dot(Ls, vec3(.2126, .7152, .0722));
  // a deck greys the sky; a dry cloudy sky only pales a little (the blue stays, as in a photograph)
  Ls = mix(Ls, vec3(lum0) * vec3(.95, .97, 1.) * (1. - .5 * uCloud.w), smoothstep(.55, 1., cover) * (.22 + .38 * smoothstep(.05, .35, uCloud.w)));
  vec3 col = Ls * uExposure + uNight * (1. - dayL);

  // ── 3. stars + Milky Way ────────────────────────────────────────────────────────
  float pxr = 2.2 * uTan.y / uRes.y;                       // one pixel, in radians-ish
  float dark = clamp(1. - lum0 * uExposure * 30., 0., 1.); // stars come out only once the sky is truly dark
  float starVis = dark * smoothstep(.0, .12, float(rd.y)) * (1. - uWx.z) * (1. - smoothstep(.45, .9, cover));
  highp vec3 g = uGalRot * rd;
  highp vec2 guv = vec2(.5 - atan(g.y, g.x) / (2. * PI), .5 - asin(clamp(g.z, -1., 1.)) / PI);
  vec3 mw = pow(texture(uMilky, vec2(guv)).rgb, vec3(2.2));
  col += (vec3(.82, .88, 1.) * stars(uEqRot * rd, pxr) * .8 + mw * .7) * starVis;

  // ── 4. sun & moon ────────────────────────────────────────────────────────────────────
  highp float cs = dot(rd, uSunDir);
  highp float ds = 1. - cs;
  vec3 sunT = transmit(uTrans, RG + CAM_H, e) * uLight.x;
  float dr = float(ds) / 1.25e-4;                          // 0 at the centre, 1 at the rim (~0.9°)
  float disk = (1. - smoothstep(.85, 1., dr)) * (.55 + .45 * sqrt(max(1. - dr, 0.)));   // limb darkening
  float glare = exp(-float(ds) * 900.) * .9 + exp(-float(ds) * 90.) * .08;
  col += sunT * (disk * 60. * uSun.x * (1. - smoothstep(.7, 1., cover)) + glare * (1. - cover * .7)) * uExposure * .1;

  highp float cm = dot(rd, uMoonDir);
  highp vec2 md = vec2(dot(rd, uMoonR), dot(rd, uMoonU)) / .0245;   // disk radius ≈ 1.4°
  float mr2 = float(dot(md, md));
  // a thin crescent is lost in daylight glare (and hugs the sun anyway)
  float inMoon = smoothstep(1.06, .94, mr2) * step(0., float(cm)) * uMoon.x * (1. - smoothstep(.7, 1., cover))
               * mix(1., smoothstep(.10, .30, uMoon.y), dayL);
  vec3 mn = vec3(vec2(md), sqrt(max(1. - mr2, 0.)));
  float mlit = smoothstep(-.06, .10, dot(mn, uMoonL));
  float mare = texture(uNoise, vec2(md) * .11 + vec2(.43, .17)).r;
  vec3 moonT = transmit(uTrans, RG + CAM_H, uMoonDir.y);
  col = mix(col, col * (1. - dark) + vec3(.95, .93, .88) * moonT * (.70 + (mare - .5) * .9) * mlit * 1.1, inMoon);
  col += vec3(.75, .80, .95) * exp(-float(1. - cm) * 60.) * .06 * moonLight * dark * (1. - cover * .7);

  // ── 5. volumetric clouds ─────────────────────────────────────────────────────
  // cubic B-spline upscale of the cloud buffer (4 bilinear taps): smooth, with
  // no texel squares — and it folds the 4 interleaved sub-pixels together
  vec4 cl = bsplineRGBA(uClouds, cuv);
  cl *= step(float(cuv.y), 1.);                             // above the band there are no clouds
  col = col * (1. - cl.a) + cl.rgb * uExposure;

  // ── → display: filmic tone curve + sRGB ──────────────────────────────────
  col = toDisplay(col);
  vec3 hzD = toDisplay(skyAt(normalize(vec3(rd.x, .02, rd.z))) * uExposure + uNight);

  // ── 6. lightning, water, precipitation, fog ──────────────────────────────
  highp vec2 q = vec2(ps.x, mix(ps.y, 2. * HZ - ps.y, water));
  col += vec3(.72, .78, 1.) * uFlash.z * (.25 + 1.4 * exp(-length(vec2(q - uFlash.xy)) * 4.5)) * (.2 + cl.a * .8);
  highp float by = q.y;
  highp float bx = uBolt.x + .055 * sin(by * 13. + uBolt.y) + .025 * sin(by * 37. + uBolt.y * 2.3) + .010 * sin(by * 97. + uBolt.y * 5.1);
  float bd = abs(float(q.x - bx));
  col += vec3(.85, .88, 1.) * (exp(-bd * uRes.y * .45) + exp(-bd * 40.) * .25) * smoothstep(.70, .52, float(by)) * smoothstep(HZ, HZ + .02, float(by)) * uFlash.z * uFlash.w;

  // the lake darkens with depth, but starts out nearly as bright as the sky it
  // mirrors, and a band of horizon haze straddles the waterline — no hard seam
  float depth = clamp(float((HZ - p.y) / HZ), 0., 1.);
  col = mix(col, col * mix(.86, .16, sqrt(depth)) * vec3(.92, .96, 1.), water);
  float band = exp(-abs(float(p.y - HZ)) * 34.);
  col = mix(col, hzD, band * .55) + hzD * exp(-abs(float(p.y - HZ)) * 260.) * .06;
  float lum = dot(col, vec3(.299, .587, .114));

  float fogN = texture(uNoise, vec2(p.x * .9, p.y * 2.2) + uDrift2.zw).g;
  float fogA = uWx.z * (.50 + .50 * fogN) * (1. - .55 * smoothstep(HZ, .95, float(p.y)));
  col = mix(col, mix(vec3(.025, .027, .032), vec3(.74, .76, .80), dayL) * .85 + hzD * .2, clamp(fogA, 0., .92));

  // ── 7. rain & snow in 3-D ────────────────────────────────────────────────
  float rain = uWx.x, snow = uWx.y;
  if (rain + snow > .01) {
    highp vec3 fh = normalize(vec3(uCamF.x, 0., uCamF.z));
    highp float ang = atan(dot(rv, uCamR), dot(rv, fh)) + uEye.z;   // world azimuth, seam behind the camera
    highp float el = rv.y / max(length(rv.xz), 1e-3);
    float pxm = 2. * uTan.y / uRes.y;
    float sl = uWind.x * 1.4;
    if (rain > .01) {
      float ra = rainCyl(ang, el, 1.4, sl, rain * .35, pxm) * .55 + rainCyl(ang, el, 2.6, sl, rain * .5, pxm) * .8
               + rainCyl(ang, el, 4.8, sl, rain * .7, pxm) + rainCyl(ang, el, 9., sl, rain * .85, pxm)
               + rainCyl(ang, el, 17., sl, rain, pxm) * .9 + rainCyl(ang, el, 32., sl, rain, pxm) * .8;
      // the air itself greys with depth in a downpour; drops catch the sky's light
      col = mix(col, hzD * .85, rain * .16 * (1. - water * .5));
      col += (.07 + .55 * lum) * vec3(.82, .88, 1.) * clamp(ra, 0., 1.4) * .55;
    }
    if (snow > .01) {
      float ss = snowCyl(ang, el, 1.2, sl * .6, snow * .4, pxm) * .7 + snowCyl(ang, el, 2.4, sl * .6, snow * .6, pxm)
               + snowCyl(ang, el, 4.5, sl * .6, snow * .8, pxm) + snowCyl(ang, el, 8.5, sl * .6, snow, pxm) * .85
               + snowCyl(ang, el, 16., sl * .6, snow, pxm) * .7;
      col = mix(col, vec3(.93, .95, 1.) * (.18 + .82 * max(dayL, moonLight * .5)), clamp(ss, 0., 1.) * .92);
    }
  }

  // ── 8. drops on the glass ────────────────────────────────────────────────
  float lowRim = smoothstep(.40, .08, gw.r) * ga, spec = smoothstep(.70, .97, gw.g) * smoothstep(.35, .55, gw.r) * ga;
  col = col * (1. - lowRim * .28) * (1. + ga * .06) + spec * (.12 + lum * .45);
  col += rGlow * .07 * (.15 + lum);

  float mx = max(col.r, max(col.g, col.b));
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 91.7) - .5) * (1.5 / 255.) * step(.006, mx);
  outColor = vec4(clamp(col, 0., 1.), 1.);
}
