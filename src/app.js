'use strict';
/* =============================================================================
   CONFIG — the knobs you're meant to touch
   ============================================================================= */
const CONFIG = {
  units: 'C',                 // 'C' | 'F' — default; also in the ⋮ menu (remembered)
  windUnit: 'kmh',            // 'kmh' | 'mph' | 'ms'
  lang: 'auto',               // 'auto' | 'en' | 'fr'
  refreshMinutes: 15,
  defaultLocation: { name: 'Paris', lat: 48.8566, lon: 2.3522 },
  quality: {
    scale: 0.6,               // starting render scale (× devicePixelRatio)
    minScale: 0.35,
    maxScale: 1.0,
    maxDpr: 3,
    downMs: 7.5,              // averaged GPU frame time above this → step resolution down
    upMs: 5.0,                // below this for upHoldMs → step up
    upHoldMs: 2000,
    cloudRes: 0.6,            // volumetric cloud buffer, relative to the sky buffer
    cloudSteps: 128,          // max ray-march iterations (adaptive strides; fewer = faster, may miss far clouds)
    idleAfterMs: 20000,       // no touch for this long → idle frame rate
    idleFps: 30,
  },
  glassWidgets: true,         // shader glass behind widgets (false → flat CSS panels)
  renderer: 'auto',           // 'auto' (WebGPU, else WebGL2) | 'webgl' — also ?renderer=webgl
  sky: {
    horizon: 0.24,            // horizon height (fraction of the screen)
    fov: 76,                  // vertical field of view, degrees
    exposure: 10,             // camera exposure for the physically based sky (higher = brighter)
    haze: 0.6,                // aerosol (Mie) density (lower = deeper blue); humidity and fog add to it
    bankTop: 0.64,            // fair weather: the cloud bank stays below this screen height (under the temperature)
    clearKm: 9,               // fair weather: clear sky overhead out to this distance, so the clouds stand far off
  },
  colors: {
    night: '#020409',         // night-sky floor (airglow, distant city glow) — '#000000' for pure AMOLED black
  },
};
// Real assets, fetched from their pinned GitHub sources and inlined at build time (see README):
const ASSETS = {
  drop: 'data:image/png;base64,__DROP_B64__',         // Codrops RainEffect drop (refraction + shape)
  shape: 'data:image/png;base64,__SHAPE_B64__',       // lightest/clouds 64³ Perlin-Worley shape volume (MIT)
  erosion: 'data:image/png;base64,__EROSION_B64__',   // lightest/clouds 32³ Worley erosion volume (MIT)
  weather: 'data:image/png;base64,__WEATHER_B64__',   // lightest/clouds tileable weather map (MIT)
  milky: 'data:image/jpeg;base64,__MILKY_B64__',      // ESO/S. Brunier Milky Way panorama (CC BY 4.0)
};

/* =============================================================================
   helpers
   ============================================================================= */
const $ = id => document.getElementById(id);
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrap1 = x => x - Math.floor(x);
const num = v => (typeof v === 'number' && isFinite(v)) ? v : 0;
const hexRGB = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const cap = x => x ? x.charAt(0).toUpperCase() + x.slice(1) : x;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const HZ = CONFIG.sky.horizon;

/* =============================================================================
   i18n
   ============================================================================= */
const LANG = ((CONFIG.lang === 'auto' ? (navigator.language || 'en') : CONFIG.lang).slice(0, 2) === 'fr') ? 'fr' : 'en';
document.documentElement.lang = LANG;
const STR = {
  en: { now: 'Now', nowS: 'Now', feels: 'Feels like', updated: 'Updated', updating: 'Updating…', offline: 'Offline', error: 'Couldn’t refresh',
    today: 'Today', todayL: 'Today', search: 'Search a city', useLoc: 'Use my location', locating: 'Locating…', myLoc: 'My location', noRes: 'No results',
    locErr: 'Location unavailable', rise: 'Sunrise', set: 'Sunset', hours: '48-hour forecast', days: '7-day forecast', units: 'Units',
    refresh: 'Refresh', stats: 'Performance stats', wind: 'Wind', hum: 'Humidity', pres: 'Pressure', dew: 'Dew point', uvT: 'UV index',
    sunT: 'Sun & Moon', aqiT: 'Air quality', aqi: 'AQI', up: 'Rising', down: 'Falling', steady: 'Steady', back: 'Back to now', precip: 'Precip.',
    gusts: 'Gusts', dayLen: 'Daylight', golden: 'Golden hour', moon: 'Moon', illum: 'illuminated', hourly: 'Hour by hour', high: 'High', low: 'Low',
    rain24: 'Rain, next 24 h', maxWind: 'Strongest wind', peak: 'Peak today', tomorrow: 'Tomorrow', change3: '3-hour change', range48: '48-hour range',
    actual: 'Actual', close: 'Close', dir: 'Direction',
    feelsColder: 'Wind makes it feel colder.', feelsWarmer: 'Humidity makes it feel warmer.', feelsSame: 'Similar to the actual temperature.',
    rainAt: 'Rain likely around %s.', noRain: 'No rain expected in the next 48 hours.', maxAt: 'High %s at %s, low %s at %s.',
    presUp: 'Pressure is rising — usually a sign of settling, drier weather.', presDown: 'Pressure is falling — clouds and rain often follow.',
    presSteady: 'Pressure is steady — expect little change.',
    feelsExpl: 'Feels-like blends temperature with wind chill and humidity to estimate how the air actually feels on skin.',
    uv: ['Low', 'Moderate', 'High', 'Very high', 'Extreme'],
    uvAdv: ['No protection needed.', 'Sunglasses on bright days; sunscreen if you’re out for long.', 'Shade around midday, sunscreen and a hat.',
      'Avoid the midday sun — protection is essential.', 'Stay out of the sun around midday.'],
    comfort: ['Dry', 'Comfortable', 'Humid', 'Muggy'], comfortTxt: 'The dew point is %s, so the air feels %s.',
    aqiLv: ['Good', 'Fair', 'Moderate', 'Poor', 'Very poor', 'Extremely poor'],
    aqiAdv: ['Air quality is ideal for outdoor activities.', 'Fine for almost everyone outdoors.', 'Sensitive people may want to shorten intense outdoor effort.',
      'Consider reducing intense outdoor activity.', 'Avoid strenuous activity outdoors.', 'Stay indoors where possible.'],
    phases: ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'],
    dirs: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], dirsL: ['North', 'North-east', 'East', 'South-east', 'South', 'South-west', 'West', 'North-west'],
    credits: 'Weather from <a href="https://open-meteo.com">Open-Meteo</a><br>Clouds ray-marched live with noise from lightest/clouds<br>Milky Way ESO/S. Brunier · Rain drops Codrops RainEffect',
    at: 'at', max24: 'Highest, next 24 h', min24: 'Lowest, next 24 h', gust24: 'Strongest gust, 24 h' },
  fr: { now: 'Maintenant', nowS: 'Maint.', feels: 'Ressenti', updated: 'Mis à jour', updating: 'Mise à jour…', offline: 'Hors ligne', error: 'Échec de la mise à jour',
    today: 'Auj.', todayL: 'Aujourd’hui', search: 'Chercher une ville', useLoc: 'Utiliser ma position', locating: 'Localisation…', myLoc: 'Ma position', noRes: 'Aucun résultat',
    locErr: 'Position indisponible', rise: 'Lever', set: 'Coucher', hours: 'Prévisions sur 48 heures', days: 'Prévisions sur 7 jours', units: 'Unités',
    refresh: 'Actualiser', stats: 'Statistiques de rendu', wind: 'Vent', hum: 'Humidité', pres: 'Pression', dew: 'Point de rosée', uvT: 'Indice UV',
    sunT: 'Soleil et Lune', aqiT: 'Qualité de l’air', aqi: 'IQA', up: 'En hausse', down: 'En baisse', steady: 'Stable', back: 'Revenir à maintenant', precip: 'Précip.',
    gusts: 'Rafales', dayLen: 'Durée du jour', golden: 'Heure dorée', moon: 'Lune', illum: 'éclairée', hourly: 'Heure par heure', high: 'Max', low: 'Min',
    rain24: 'Pluie, 24 h', maxWind: 'Vent le plus fort', peak: 'Pic du jour', tomorrow: 'Demain', change3: 'Variation sur 3 h', range48: 'Amplitude 48 h',
    actual: 'Réelle', close: 'Fermer', dir: 'Direction',
    feelsColder: 'Le vent rend la sensation plus fraîche.', feelsWarmer: 'L’humidité rend la sensation plus chaude.', feelsSame: 'Proche de la température réelle.',
    rainAt: 'Pluie probable vers %s.', noRain: 'Pas de pluie prévue dans les 48 prochaines heures.', maxAt: 'Max %s à %s, min %s à %s.',
    presUp: 'La pression monte — signe habituel d’un temps plus sec et plus calme.', presDown: 'La pression baisse — nuages et pluie suivent souvent.',
    presSteady: 'La pression est stable — peu de changement à attendre.',
    feelsExpl: 'Le ressenti combine température, refroidissement éolien et humidité pour estimer la sensation réelle sur la peau.',
    uv: ['Faible', 'Modéré', 'Élevé', 'Très élevé', 'Extrême'],
    uvAdv: ['Aucune protection nécessaire.', 'Lunettes de soleil par beau temps ; crème si vous restez longtemps dehors.', 'Ombre vers midi, crème solaire et chapeau.',
      'Évitez le soleil de midi — protection indispensable.', 'Restez à l’abri du soleil autour de midi.'],
    comfort: ['sec', 'agréable', 'humide', 'étouffant'], comfortTxt: 'Le point de rosée est de %s : l’air est %s.',
    aqiLv: ['Bon', 'Correct', 'Moyen', 'Médiocre', 'Très mauvais', 'Extrêmement mauvais'],
    aqiAdv: ['Qualité idéale pour les activités en plein air.', 'Convient à presque tout le monde.', 'Les personnes sensibles peuvent écourter les efforts intenses dehors.',
      'Envisagez de réduire les activités intenses en extérieur.', 'Évitez les efforts soutenus en extérieur.', 'Restez à l’intérieur si possible.'],
    phases: ['Nouvelle lune', 'Premier croissant', 'Premier quartier', 'Gibbeuse croissante', 'Pleine lune', 'Gibbeuse décroissante', 'Dernier quartier', 'Dernier croissant'],
    dirs: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'], dirsL: ['Nord', 'Nord-est', 'Est', 'Sud-est', 'Sud', 'Sud-ouest', 'Ouest', 'Nord-ouest'],
    credits: 'Météo fournie par <a href="https://open-meteo.com">Open-Meteo</a><br>Nuages calculés en direct, bruit de lightest/clouds<br>Voie lactée ESO/S. Brunier · Gouttes Codrops RainEffect',
    at: 'à', max24: 'Max sur 24 h', min24: 'Min sur 24 h', gust24: 'Rafale max sur 24 h' },
}[LANG];
const WMO = {
  en: { 0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle',
    55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain',
    67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Showers', 81: 'Showers', 82: 'Violent showers',
    85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Thunderstorm, hail' },
  fr: { 0: 'Dégagé', 1: 'Plutôt dégagé', 2: 'Partiellement nuageux', 3: 'Nuageux', 45: 'Brouillard', 48: 'Brouillard givrant',
    51: 'Bruine légère', 53: 'Bruine', 55: 'Bruine dense', 56: 'Bruine verglaçante', 57: 'Bruine verglaçante', 61: 'Pluie faible', 63: 'Pluie',
    65: 'Forte pluie', 66: 'Pluie verglaçante', 67: 'Pluie verglaçante', 71: 'Neige faible', 73: 'Neige', 75: 'Forte neige', 77: 'Grains de neige',
    80: 'Averses', 81: 'Averses', 82: 'Averses violentes', 85: 'Averses de neige', 86: 'Fortes averses de neige', 95: 'Orage',
    96: 'Orage et grêle', 99: 'Orage et grêle' },
}[LANG];
const tr = (s, ...a) => a.reduce((r, v) => r.replace('%s', v), s);
function glyph(code, day) {
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 51) return 'rain';
  if (code === 45 || code === 48) return 'fog';
  if (code === 3) return 'cloud';
  if (code === 2 || code === 1) return day ? 'psun' : 'pmoon';
  return day ? 'sun' : 'moon';
}
const ic = name => '<svg class="ic" viewBox="0 0 32 32"><use href="#i-' + name + '"/></svg>';
const sym = (name, cls) => '<svg' + (cls ? ' class="' + cls + '"' : '') + ' viewBox="0 0 24 24"><use href="#i-' + name + '"/></svg>';
const dir8 = deg => Math.round(((deg % 360) + 360) % 360 / 45) % 8;

/* =============================================================================
   Astronomy — real sun & moon positions, lunar phase, sidereal time
   (compact form of SunCalc's formulas, V. Agafonkin, BSD-2). Writes into A.
   ============================================================================= */
const RAD = Math.PI / 180, DAYMS = 864e5, J1970 = 2440588, J2000 = 2451545, OBL = RAD * 23.4397;
const A = { sunAz: 0, sunAlt: 0, moonAz: 0, moonAlt: 0, moonFrac: 0, moonPhase: 0, lst: 0 };
const rightAsc = (l, b) => Math.atan2(Math.sin(l) * Math.cos(OBL) - Math.tan(b) * Math.sin(OBL), Math.cos(l));
const declin = (l, b) => Math.asin(Math.sin(b) * Math.cos(OBL) + Math.cos(b) * Math.sin(OBL) * Math.sin(l));
const azim = (H, phi, dec) => Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
const alti = (H, phi, dec) => Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
function astro(ms, lat, lon) {
  const lw = RAD * -lon, phi = RAD * lat, d = ms / DAYMS - 0.5 + J1970 - J2000;
  const sid = RAD * (280.16 + 360.9856235 * d) - lw;
  A.lst = sid;
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const Ls = M + C + RAD * 102.9372 + Math.PI;
  const sdec = declin(Ls, 0), sra = rightAsc(Ls, 0);
  A.sunAz = azim(sid - sra, phi, sdec); A.sunAlt = alti(sid - sra, phi, sdec); A.sra = sra; A.sdec = sdec;
  const L = RAD * (218.316 + 13.176396 * d), Mm = RAD * (134.963 + 13.064993 * d), F = RAD * (93.272 + 13.229350 * d);
  const l = L + RAD * 6.289 * Math.sin(Mm), b = RAD * 5.128 * Math.sin(F), dist = 385001 - 20905 * Math.cos(Mm);
  const mra = rightAsc(l, b), mdec = declin(l, b);
  A.moonAz = azim(sid - mra, phi, mdec); A.moonAlt = alti(sid - mra, phi, mdec);
  const sdist = 149598000;
  const pa = Math.acos(Math.sin(sdec) * Math.sin(mdec) + Math.cos(sdec) * Math.cos(mdec) * Math.cos(sra - mra));
  const inc = Math.atan2(sdist * Math.sin(pa), dist - sdist * Math.cos(pa));
  const ang = Math.atan2(Math.cos(sdec) * Math.sin(sra - mra), Math.sin(sdec) * Math.cos(mdec) - Math.cos(sdec) * Math.sin(mdec) * Math.cos(sra - mra));
  A.moonFrac = (1 + Math.cos(inc)) / 2;
  A.moonPhase = 0.5 + 0.5 * inc * (ang < 0 ? -1 : 1) / Math.PI;
}
// World frame: x = right, y = up, z = forward toward the equator (south in the
// northern hemisphere, so the sun rises on the left). aimCamera() turns the view.
function dirAzAlt(az, alt, south, out) {
  const ca = Math.cos(alt);
  let x = Math.sin(az) * ca, z = Math.cos(az) * ca;
  if (south) { x = -x; z = -z; }
  out[0] = x; out[1] = Math.sin(alt); out[2] = z;
}
// first time after t0 (ms) when the sun crosses `alt` (rising or setting), scanning in 5-minute steps
function sunCross(t0, altDeg, rising, lat, lon) {
  const target = altDeg * RAD;
  astro(t0, lat, lon); let prev = A.sunAlt;
  for (let t = t0 + 300000; t < t0 + DAYMS; t += 300000) {
    astro(t, lat, lon);
    if (rising ? (prev < target && A.sunAlt >= target) : (prev > target && A.sunAlt <= target)) return t;
    prev = A.sunAlt;
  }
  return 0;
}

/* =============================================================================
   Visual state — critically damped springs (P current, V velocity, T target)
   ============================================================================= */
const I_CL = 0, I_CM = 1, I_CH = 2, I_DARK = 3, I_RAIN = 4, I_SNOW = 5, I_FOG = 6, I_STORM = 7, I_WX = 8, I_WY = 9, I_WS = 10, I_SCRUB = 11, NP = 12;
const P = new Float32Array(NP), V = new Float32Array(NP), T = new Float32Array(NP);
T[I_CL] = 0.2; T[I_CM] = 0.25; T[I_CH] = 0.2; T[I_WX] = 0.15; T[I_WS] = 0.3; P.set(T);
function spring(i, w, dt) {   // exact closed-form critically damped step: stable for any dt
  const x = P[i] - T[i], v = V[i], ex = Math.exp(-w * dt), tmp = (v + w * x) * dt;
  P[i] = T[i] + (x + tmp) * ex;
  V[i] = (v - w * tmp) * ex;
}
// generic damped spring for UI (Apple's two parameters: response + damping ratio)
function springTo(x, v, target, response, zeta, dt, out, i) {
  const w = 2 * Math.PI / response;
  let p = x, q = v;
  for (let t = 0; t < dt; t += 1 / 480) {
    const h = Math.min(1 / 480, dt - t);
    q += (-w * w * (p - target) - 2 * zeta * w * q) * h;
    p += q * h;
  }
  out[i] = p; return q;
}

/* =============================================================================
   Weather data
   ============================================================================= */
let LOC = null, DATA = null, FETCHED = 0, TZOFF = 0, hemi = 1, AQ = null;
let fmtHour = null, fmtDay = null, fmtDate = null, fmtDM = null, fmtClock = null, fmtLong = null;
const blank = () => ({ t: 0, temp: 0, app: 0, low: 0, mid: 0, high: 0, cover: 0, rain: 0, snow: 0, precip: 0, pp: 0, code: 0,
  wu: 0, wv: 0, wspd: 0, wdir: 0, gust: 0, uv: 0, isDay: 1, hum: 0, dew: 0, pres: 0 });
const S = blank(), H = blank(), TMP = blank();
let _i0 = 0, _i1 = 0, _a = 0;
const li = arr => arr ? lerp(num(arr[_i0]), num(arr[_i1]), _a) : 0;
const toUnix = (v, off) => typeof v === 'number' ? v : (Date.parse(v + 'Z') / 1000 - off);

// Conditions `s` hours from now: hourly data interpolated, blended into `current` near s = 0.
function sampleAt(s, out) {
  const now = Date.now() / 1000, t = now + s * 3600;
  out.t = t;
  if (!DATA) return out;
  const h = DATA.hourly, n = h.time.length;
  const f = clamp((t - h.time[0]) / 3600, 0, n - 1);
  _i0 = Math.floor(f); _i1 = Math.min(_i0 + 1, n - 1); _a = f - _i0;
  out.temp = li(h.temperature_2m); out.app = li(h.apparent_temperature);
  out.low = li(h.cloud_cover_low); out.mid = li(h.cloud_cover_mid); out.high = li(h.cloud_cover_high);
  out.cover = li(h.cloud_cover); out.rain = li(h.rain) + li(h.showers); out.snow = li(h.snowfall);
  out.precip = li(h.precipitation); out.pp = li(h.precipitation_probability); out.uv = li(h.uv_index);
  out.hum = li(h.relative_humidity_2m); out.dew = li(h.dew_point_2m); out.pres = li(h.pressure_msl); out.gust = li(h.wind_gusts_10m);
  const k = _a < 0.5 ? _i0 : _i1;
  out.code = num(h.weather_code[k]); out.isDay = num(h.is_day && h.is_day[k]);
  const d0 = num(h.wind_direction_10m[_i0]) * RAD, d1 = num(h.wind_direction_10m[_i1]) * RAD;
  const s0 = num(h.wind_speed_10m[_i0]), s1 = num(h.wind_speed_10m[_i1]);
  out.wu = lerp(s0 * Math.sin(d0), s1 * Math.sin(d1), _a); out.wv = lerp(s0 * Math.cos(d0), s1 * Math.cos(d1), _a);
  const c = DATA.current;
  const cw = (c && (now - c.time) < 5400) ? 1 - sstep(0, 1, s) : 0;
  if (cw > 0) {
    out.temp = lerp(out.temp, num(c.temperature_2m), cw); out.app = lerp(out.app, num(c.apparent_temperature), cw);
    out.cover = lerp(out.cover, num(c.cloud_cover), cw);
    out.rain = lerp(out.rain, num(c.rain) + num(c.showers), cw); out.snow = lerp(out.snow, num(c.snowfall), cw);
    out.precip = lerp(out.precip, num(c.precipitation), cw);
    const cd = num(c.wind_direction_10m) * RAD, cs = num(c.wind_speed_10m);
    out.wu = lerp(out.wu, cs * Math.sin(cd), cw); out.wv = lerp(out.wv, cs * Math.cos(cd), cw);
    if (cw > 0.5) { out.code = num(c.weather_code); out.isDay = num(c.is_day); }
  }
  out.wspd = Math.hypot(out.wu, out.wv);
  out.wdir = (Math.atan2(out.wu, out.wv) / RAD + 360) % 360;
  return out;
}

const RAIN_FLOOR = { 51: .15, 53: .25, 55: .35, 56: .25, 57: .35, 61: .35, 63: .55, 65: .85, 66: .4, 67: .7, 80: .4, 81: .6, 82: .9, 95: .7, 96: .75, 99: .9 };
const SNOW_FLOOR = { 71: .3, 73: .55, 75: .85, 77: .25, 85: .5, 86: .85 };
function deriveTargets(s) {
  const code = s.code;
  let low = s.low / 100, mid = s.mid / 100, high = s.high / 100;
  if (low + mid + high < 0.05 && s.cover > 10) mid = s.cover / 100;
  const isSnow = SNOW_FLOOR[code] !== undefined;
  const rainI = (code >= 51 || s.rain > 0.05) && !isSnow ? Math.max(RAIN_FLOOR[code] || 0, 1 - Math.exp(-s.rain / 2.2)) : 0;
  const snowI = (isSnow || s.snow > 0.02) ? Math.max(SNOW_FLOOR[code] || 0, 1 - Math.exp(-s.snow / 0.6)) : 0;
  const storm = code >= 95 ? 1 : 0;
  if (code === 2) mid = Math.max(mid, 0.35);
  if (code === 3) { low = Math.max(low, 0.75); mid = Math.max(mid, 0.6); }
  if (rainI > 0 || snowI > 0) low = Math.max(low, 0.75 + 0.25 * Math.max(rainI, snowI));
  if (storm) low = Math.max(low, 0.95);
  T[I_CL] = low; T[I_CM] = mid; T[I_CH] = high;
  T[I_RAIN] = rainI; T[I_SNOW] = snowI; T[I_STORM] = storm;
  T[I_FOG] = (code === 45 || code === 48) ? 0.85 : (code >= 51 && code <= 57 ? 0.18 : 0);
  T[I_DARK] = clamp(0.15 * low + 0.55 * rainI + 0.25 * snowI + 0.35 * storm, 0, 1);
  const sp = clamp(s.wspd / 40, 0, 1.6), to = (s.wdir + 180) * RAD;
  T[I_WX] = -Math.sin(to) * hemi * sp; T[I_WY] = -Math.cos(to) * hemi * sp; T[I_WS] = sp;
}
let scrubTarget = 0, scrubbing = false;
function updateTargets() { sampleAt(scrubTarget, S); deriveTargets(S); T[I_SCRUB] = scrubTarget; }

/* =============================================================================
   WebGL2 — passes per frame:
     field → atmosphere LUTs (when the light moves) → clouds (¼ of the band
     buffer) → resolve (temporal) → drops → sky → material blur (5 down,
     3 up) → widgets
   ============================================================================= */
let canvas = $('sky');
let gl = null, tq = null, gpuTimed = false;
const PR = {}, UL = {};
let vaoEmpty, vaoDrop, dropBuf, texNoise, texDrop = null, texShape = null, texErosion = null, texWeather = null, texMilky = null, texBlack = null;
let transT, skySunT, skyMoonT, HDR = false, lutHaze = -1, transHaze = -1;
const LUT_SUN = new Float32Array(3), LUT_MOON = new Float32Array(3);
let fieldT = [], fieldIdx = 0, fieldEnergy = 0;
let cFresh, cHist = [], histIdx = 0, glassT, skyT, BDN = [], BUP = [], fillFrames = 3, cloudsOn = false, glassDirty = true;
const RIP = new Float32Array(24), SPL = new Float32Array(16), WTS = new Float32Array(4), LDIR = new Float32Array(3), LGT = new Float32Array(3);
const EQM = new Float32Array(9), GALM = new Float32Array(9), EQ_M = new Float32Array(3), EQ_W = new Float32Array(3), EQ_P = new Float32Array(3);
const CAMF = new Float32Array(3), CAMU = new Float32Array(3), CAMR = new Float32Array(3), CTAN = new Float32Array(2);
const SUND = new Float32Array(3), MOOND = new Float32Array(3), MOONR = new Float32Array(3), MOONU = new Float32Array(3);
const FLD = new Float32Array(4), RECT = new Float32Array(40), RECTP = new Float32Array(40), PRESS = new Float32Array(4);
const JIT = [0, 0, 1, 1, 1, 0, 0, 1];
let splatN = 0, ripHead = 0, frameNo = 0;

function src(id) {
  return $(id).textContent.trim().replace(/^#include (\S+)\s*$/gm, (m, f) => $(f).textContent.trim()).replace(/__HZ__/g, HZ.toFixed(4)).replace(/__STEPS__/g, String(CONFIG.quality.cloudSteps | 0));
}
function program(name, vs, fs, uniforms) {
  const mk = (type, id) => {
    const s = gl.createShader(type); gl.shaderSource(s, src(id)); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(id + ': ' + gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(name + ': ' + gl.getProgramInfoLog(p));
  PR[name] = p; const u = UL[name] = {};
  uniforms.forEach(n => u[n] = gl.getUniformLocation(p, n));
}
// Tileable 256² Perlin, 4 independent channels (fog, moon mare).
function bakeNoise(size, period) {
  const data = new Uint8Array(size * size * 4);
  const gx = new Float32Array(period * period), gy = new Float32Array(period * period);
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10), cell = size / period;
  for (let ch = 0; ch < 4; ch++) {
    let seed = 1337 + ch * 7919;
    for (let i = 0; i < period * period; i++) { seed = (seed * 16807) % 2147483647; const a = seed / 2147483647 * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = (x + 0.5) / cell, fy = (y + 0.5) / cell, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
      const k00 = y0 * period + x0, k10 = y0 * period + x1, k01 = y1 * period + x0, k11 = y1 * period + x1;
      const u = fade(tx), v = fade(ty);
      const n = lerp(lerp(gx[k00] * tx + gy[k00] * ty, gx[k10] * (tx - 1) + gy[k10] * ty, u), lerp(gx[k01] * tx + gy[k01] * (ty - 1), gx[k11] * (tx - 1) + gy[k11] * (ty - 1), u), v);
      data[(y * size + x) * 4 + ch] = clamp(Math.round((n * 0.72 + 0.5) * 255), 0, 255);
    }
  }
  return data;
}
function params(target, wrap, minF) {
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, minF || gl.LINEAR);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(target, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(target, gl.TEXTURE_WRAP_T, wrap);
  if (target === gl.TEXTURE_3D) gl.texParameteri(target, gl.TEXTURE_WRAP_R, wrap);
}
function rt(w, h, internal, type, init) {   // render target: texture + framebuffer
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal || gl.RGBA8, w, h, 0, gl.RGBA, type || gl.UNSIGNED_BYTE, init || null);
  params(gl.TEXTURE_2D, gl.CLAMP_TO_EDGE);
  const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { t, f, w, h, fmt: internal || gl.RGBA8, type: type || gl.UNSIGNED_BYTE };
}
function rtSize(r, w, h) {
  r.w = w; r.h = h; gl.bindTexture(gl.TEXTURE_2D, r.t);
  gl.texImage2D(gl.TEXTURE_2D, 0, r.fmt, w, h, 0, gl.RGBA, r.type, null);
}
// Assets arrive as data: URIs (inlined by the build). 3-D noise volumes are
// packed as horizontal strips of N slices of N×N; they are unpacked once.
function decode(url) {
  return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = url; });
}
function pixels(img) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
  return x.getImageData(0, 0, img.width, img.height).data;
}
function volumeFromStrip(img, N) {
  const px = pixels(img), W = img.width, out = new Uint8Array(N * N * N);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) out[x + y * N + z * N * N] = px[(y * W + z * N + x) * 4];
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, t);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, N, N, N, 0, gl.RED, gl.UNSIGNED_BYTE, out);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.generateMipmap(gl.TEXTURE_3D); params(gl.TEXTURE_3D, gl.REPEAT, gl.LINEAR_MIPMAP_LINEAR);
  return t;
}
function tex2D(img, wrapS, wrapT, mip) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
  if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
  return t;
}
async function loadAssets() {
  try {
    const [shape, erosion, weather, milky] = await Promise.all([ASSETS.shape, ASSETS.erosion, ASSETS.weather, ASSETS.milky].map(decode));
    if (gpu) { gpuAssets(shape, erosion, weather, milky); return; }
    if (!gl) return;
    texShape = volumeFromStrip(shape, 64); texErosion = volumeFromStrip(erosion, 32);
    texWeather = tex2D(weather, gl.REPEAT, gl.REPEAT, true);
    texMilky = tex2D(milky, gl.REPEAT, gl.CLAMP_TO_EDGE, false);   // no mips: the atan seam would pick a blurry level
    fillFrames = 3;
  } catch (e) { console.error('assets', e); }
}

function initGL() {
  gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false,
    premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL2 unavailable');
  program('field', 'full.vert', 'field.frag', ['uPrev', 'uSize', 'uSplat', 'uDecay', 'uAspect']);
  program('trans', 'full.vert', 'trans.frag', ['uSize', 'uHaze']);
  program('skyview', 'full.vert', 'skyview.frag', ['uTrans', 'uSize', 'uLightZ', 'uHaze']);
  program('clouds', 'full.vert', 'clouds.frag', ['uShape', 'uErosion', 'uWeatherMap', 'uField', 'uTrans', 'uSkyS', 'uSkyM', 'uRes', 'uJit', 'uBand', 'uClear',
    'uCamF', 'uCamU', 'uCamR', 'uTan', 'uSunDir', 'uMoonDir', 'uLightDir', 'uLight', 'uWeather', 'uWindOff', 'uFrame', 'uFlash']);
  program('resolve', 'full.vert', 'resolve.frag', ['uFresh', 'uHist', 'uFreshRes', 'uJit', 'uFill', 'uBlend']);
  program('drop', 'drop.vert', 'drop.frag', ['uAspect', 'uDrop']);
  program('sky', 'full.vert', 'sky.frag', ['uRes', 'uTime', 'uNoise', 'uField', 'uClouds', 'uGlass', 'uTrans', 'uSkyS', 'uSkyM', 'uMilky',
    'uCamF', 'uCamU', 'uCamR', 'uTan', 'uEqRot', 'uGalRot', 'uSunDir', 'uMoonDir', 'uMoonR', 'uMoonU', 'uSun', 'uMoon', 'uMoonL', 'uLight',
    'uExposure', 'uNight', 'uDrift2', 'uCloud', 'uWx', 'uWind', 'uFlash', 'uBolt', 'uRip', 'uW', 'uBand', 'uEye']);
  program('down', 'full.vert', 'down.frag', ['uSrc', 'uDst', 'uTex']);
  program('up', 'full.vert', 'up.frag', ['uSrc', 'uDst', 'uTex']);
  program('final', 'full.vert', 'final.frag', ['uSky', 'uBlur', 'uRes', 'uRect', 'uRectP', 'uPress', 'uLight', 'uTime', 'uDim', 'uBgBlur']);

  vaoEmpty = gl.createVertexArray();
  const corner = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corner);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  vaoDrop = gl.createVertexArray(); gl.bindVertexArray(vaoDrop);
  gl.bindBuffer(gl.ARRAY_BUFFER, corner); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  dropBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, dropBuf); gl.bufferData(gl.ARRAY_BUFFER, DROP.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(1, 1);
  gl.bindVertexArray(null);

  texNoise = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texNoise);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, bakeNoise(256, 16));
  gl.generateMipmap(gl.TEXTURE_2D); params(gl.TEXTURE_2D, gl.REPEAT, gl.LINEAR_MIPMAP_LINEAR);
  texDrop = null;
  const img = new Image();
  img.onload = () => {
    if (!gl) return;
    texDrop = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texDrop);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    params(gl.TEXTURE_2D, gl.CLAMP_TO_EDGE);
  };
  img.src = ASSETS.drop;

  const half = HDR = !!gl.getExtension('EXT_color_buffer_float');
  fieldT = [0, 1].map(() => half
    ? rt(FW, FH, gl.RGBA16F, gl.HALF_FLOAT, new Uint16Array(FW * FH * 4).fill(0x3800))
    : rt(FW, FH, gl.RGBA8, gl.UNSIGNED_BYTE, new Uint8Array(FW * FH * 4).fill(128)));
  // radiance buffers (atmosphere LUTs, clouds) are half-float where the GPU can render to it
  const hf = half ? [gl.RGBA16F, gl.HALF_FLOAT] : [gl.RGBA8, gl.UNSIGNED_BYTE];
  transT = rt(256, 64, hf[0], hf[1]); skySunT = rt(192, 108, hf[0], hf[1]); skyMoonT = rt(192, 108, hf[0], hf[1]);
  lutHaze = transHaze = -1;
  texBlack = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texBlack);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  cFresh = rt(2, 2, hf[0], hf[1]); cHist = [rt(2, 2, hf[0], hf[1]), rt(2, 2, hf[0], hf[1])]; glassT = rt(2, 2); skyT = rt(2, 2);
  // material blur chain: ½ … 1/32 down, back up to ¼ — half-float so a wide blur of a smooth sky never bands
  BDN = [0, 1, 2, 3, 4].map(() => rt(2, 2, hf[0], hf[1])); BUP = [0, 1, 2].map(() => rt(2, 2, hf[0], hf[1]));

  loadAssets();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  tq = ext ? { ext, q: [gl.createQuery(), gl.createQuery(), gl.createQuery(), gl.createQuery()], busy: [false, false, false, false], head: 0 } : null;
  gpuTimed = !!tq;
  glassDirty = true; fillFrames = 3;
}
const FW = 64, FH = 128;

/* =============================================================================
   Resolution + governor (GPU timer queries when available, else missed-vsync
   inference with a remembered ceiling so it doesn't oscillate)
   ============================================================================= */
const STEPS = [];
for (let s = CONFIG.quality.minScale; s <= CONFIG.quality.maxScale + 1e-6; s += 0.05) STEPS.push(Math.round(s * 100) / 100);
let stepIdx = 0;
{ let best = 1e9; STEPS.forEach((s, i) => { const d = Math.abs(s - CONFIG.quality.scale); if (d < best) { best = d; stepIdx = i; } }); }
let cssW = innerWidth, cssH = innerHeight, dpr = 1, cw = 2, ch = 2;
let emaMs = 0, underSince = 0, lastStep = 0, lastUpAt = -1e9, ceilIdx = 1e9, ceilUntil = 0;
let refreshMs = 0, winMin = 1e9, winStart = 0, halfRate = false;

function applyScale() {
  const s = STEPS[stepIdx];
  cw = Math.max(8, Math.round(cssW * dpr * s)); ch = Math.max(8, Math.round(cssH * dpr * s));
  canvas.width = cw; canvas.height = ch;
  if (gpu) { gpuApplyScale(); return; }
  if (!gl) return;
  sizeClouds();
  rtSize(glassT, Math.max(2, Math.round(cw / 2)), Math.max(2, Math.round(ch / 2)));
  rtSize(skyT, cw, ch);
  BDN.forEach((r, k) => rtSize(r, Math.max(2, cw >> (k + 1)), Math.max(2, ch >> (k + 1))));
  BUP.forEach((r, j) => rtSize(r, Math.max(2, cw >> (4 - j)), Math.max(2, ch >> (4 - j))));
  glassDirty = true; fillFrames = 3;
}
// the cloud buffer covers only the band of sky the clouds can occupy, at a uniform pixel density
const BAND = new Float32Array([HZ, CONFIG.sky.bankTop]);
function sizeClouds() {
  const q = CONFIG.quality;
  const hw = 2 * Math.max(2, Math.ceil(cw * q.cloudRes / 2)), hh = 2 * Math.max(2, Math.ceil(ch * (BAND[1] - BAND[0]) * q.cloudRes / 2));
  if (gpu) gpuSizeClouds(hw, hh);
  else { rtSize(cHist[0], hw, hh); rtSize(cHist[1], hw, hh); rtSize(cFresh, hw / 2, hh / 2); }
  fillFrames = 3;
}
function governor(now, ms) {
  // never resize mid-gesture or mid-transition: a resize reallocates every buffer (a
  // hitch) and restarts the cloud history (a flicker) right when motion is most visible
  emaMs = emaMs ? emaMs + (ms - emaMs) * 0.08 : ms;
  // while the UI is moving: never resize; relieve the GPU instead by tracing the sky every other frame
  // (the UI transforms still run at full rate). Hysteresis so it does not flap.
  const lim = gpuTimed ? CONFIG.quality.downMs : refreshMs * 1.2;
  halfRate = emaMs > lim * (halfRate ? 0.85 : 1);
  if (uiBusy() || MF.p !== MF.tgt || MF.v !== 0 || scrubbing) { underSince = 0; return; }
  if (now - lastStep < 700) return;
  const q = CONFIG.quality;
  const down = gpuTimed ? q.downMs : refreshMs * 1.18, up = gpuTimed ? q.upMs : refreshMs * 1.04;
  if (emaMs > down && stepIdx > 0) {
    if (now - lastUpAt < 4000) { ceilIdx = stepIdx - 1; ceilUntil = now + 30000; }
    stepIdx--; lastStep = now; emaMs = 0; underSince = 0; applyScale();
  } else if (emaMs < up) {
    if (!underSince) underSince = now;
    else if (now - underSince > q.upHoldMs && stepIdx < STEPS.length - 1 && (stepIdx < ceilIdx || now > ceilUntil)) {
      stepIdx++; lastStep = now; lastUpAt = now; emaMs = 0; underSince = now; applyScale();
    }
  } else underSince = 0;
}

/* =============================================================================
   Rain on the glass — tiny drop simulation (fixed pool, no allocations)
   ============================================================================= */
const DN = 96;
const DROP = new Float32Array(DN * 4), DJIT = new Float32Array(DN);
let dropAcc = 0, dropsAlive = 0;
function updateDrops(dt, aspect) {
  const rain = clamp(P[I_RAIN], 0, 1);
  dropAcc += (rain > 0.25 ? Math.pow(rain, 1.5) * (calm ? 3 : 8) : 0) * dt;   // a few on the lens; the rain itself is 3-D
  while (dropAcc >= 1) {
    dropAcc -= 1;
    let slot = 0, smallest = 1e9;
    for (let i = 0; i < DN; i++) { const r = DROP[i * 4 + 2]; if (r < smallest) { smallest = r; slot = i; } if (r === 0) break; }
    const o = slot * 4, u = Math.random();
    DROP[o] = (Math.random() - 0.5) * aspect; DROP[o + 1] = 0.06 + Math.random() * 0.94;
    DROP[o + 2] = 0.0035 + u * u * u * 0.024; DROP[o + 3] = 1.05; DJIT[slot] = 0.6 + Math.random() * 0.8;
  }
  dropsAlive = 0;
  for (let i = 0; i < DN; i++) {
    const o = i * 4; let r = DROP[o + 2];
    if (r <= 0) continue;
    if (rain < 0.04) r -= dt * 0.005;
    if (r > 0.013) {
      const vy = (r - 0.011) * 4.2 * DJIT[i];
      DROP[o + 1] -= vy * dt; DROP[o] += Math.sin(DROP[o + 1] * 90 + i) * 0.004 * dt;
      DROP[o + 3] = 1.1 + vy * 6;
    }
    if (DROP[o + 1] < -0.05 || r < 0.0012) r = 0;
    DROP[o + 2] = r > 0 ? r : 0;
    if (r > 0) dropsAlive++;
  }
}

/* =============================================================================
   Frame loop — the sky and the UI share one clock. No allocations in the
   sky path; the UI writes a transform only when a value actually changed.
   ============================================================================= */
let rafId = 0, lastT = 0, idleAcc = 0, lastInteract = performance.now(), idle = false, frames = 0;
let calm = reduceMotion.matches;
let skyClock = 0, wX = 0, wZ = 0, wEv = 0, wDet = 0, dHx = Math.random(), dHy = Math.random(), evX = 0, evY = 0;
let tiltX = 0, tiltY = 0, tiltTX = 0, tiltTY = 0;
let flashT = -1, nextFlash = 3, flashX = 0, flashY = 0.6, boltOn = 0, boltX = 0, boltSeed = 0, flashI = 0;
let sunVis = 0, sunE = 0, moonVis = 0, moonLx = 0, moonLz = 1;
const NIGHT = hexRGB(CONFIG.colors.night).map(v => Math.pow(v, 2.2));
const MOON_E = 1 / 110;          // moonlight relative to sunlight (artistic: ~1/400 000 in reality, invisible on a phone)
// galactic ← equatorial (J2000), rows = galactic x (centre), y (l = 90°), z (north galactic pole)
const GAL = [-0.0548755604, -0.8734370902, -0.4838350155, 0.4941094279, -0.4448296300, 0.7469822445, -0.8676661490, -0.1980763734, 0.4559837762];

let nativeVel = 0;
function frame(now) {
  rafId = requestAnimationFrame(frame);
  let dt = lastT ? (now - lastT) * 0.001 : 1 / 120;
  lastT = now;
  if (dt > 0.1) dt = 0.1;
  idle = now - lastInteract > CONFIG.quality.idleAfterMs && !uiBusy() && MF.p === MF.tgt;
  if (idle) {
    idleAcc += dt;
    if (idleAcc < 1 / CONFIG.quality.idleFps - 0.004) return;
    dt = idleAcc; idleAcc = 0;
  } else {
    idleAcc = 0;
    if ((gl || gpu) && !gpuTimed) {
      if (now - winStart > 1000) { if (winMin < 1e8) refreshMs = refreshMs ? Math.min(refreshMs, Math.max(winMin, 4)) : Math.max(winMin, 4); winMin = 1e9; winStart = now; }   // ratchet: once a 120 Hz frame was seen, that stays the target
      const ms = dt * 1000; if (ms < winMin) winMin = ms;
      if (refreshMs) governor(now, ms);
    }
  }
  uiUpdate(dt);
  if (window.CielNative) {   // tell Android how fast the (custom-scrolled) content moves, so it keeps the high refresh rate
    const v = Math.min(4000, Math.abs(SC.v) + Math.abs(MF.v) * heroH) | 0;
    if (v !== nativeVel && (v > 0 || nativeVel > 0)) { nativeVel = v; try { window.CielNative.velocity(v); } catch (e) { window.CielNative = null; } }
  }
  drawFrame(dt);
  frames++;
}
function drawFrame(dt) {
  if (gpu) { update(dt); gpuRender(dt); }
  else if (gl) { update(dt); render(dt); }
}

// light regime weights from the sun's elevation (used for snow / fog / moon tint)
function regimes(e) {
  let wN = 1 - sstep(-.30, -.10, e), wT = sstep(-.30, -.10, e) * (1 - sstep(-.03, .08, e)), wG = sstep(-.06, .03, e) * (1 - sstep(.10, .32, e)), wD = sstep(.10, .32, e);
  const s = 1 / (wN + wT + wG + wD + 1e-4);
  WTS[0] = wN * s; WTS[1] = wT * s; WTS[2] = wG * s; WTS[3] = wD * s;
}
// local frame (x right, y up, z forward) → equatorial frame, turned by sidereal time; then → galactic
function skyFrames(lat, south) {
  dirAzAlt(0, (90 - lat) * RAD, south, EQ_M);          // celestial equator on the meridian
  dirAzAlt(Math.PI / 2, 0, south, EQ_W);              // due west
  dirAzAlt(Math.PI, lat * RAD, south, EQ_P);           // north celestial pole
  const cl = Math.cos(A.lst), sl = Math.sin(A.lst);
  for (let j = 0; j < 3; j++) {                         // column-major: column j = (ex[j], ey[j], ez[j])
    EQM[j * 3] = cl * EQ_M[j] + sl * EQ_W[j]; EQM[j * 3 + 1] = sl * EQ_M[j] - cl * EQ_W[j]; EQM[j * 3 + 2] = EQ_P[j];
  }
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++)
    GALM[j * 3 + i] = GAL[i * 3] * EQM[j * 3] + GAL[i * 3 + 1] * EQM[j * 3 + 1] + GAL[i * 3 + 2] * EQM[j * 3 + 2];
}
// Where the camera looks, like a photographer would: by day with the sun at
// its back (front-lit clouds, the way they are photographed), toward the sun
// through golden hour and twilight (the sunset is the show), toward the
// equator at night. Pans slowly on a critically damped spring.
let camYaw = 0, camYawV = 0, camAimed = false;
const wrapPi = a => a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;
function aimCamera(dt) {
  const aSun = Math.atan2(SUND[0], SUND[2]);
  let target = wrapPi(aSun * sstep(-0.20, -0.05, sunE));                    // night → twilight: swing to the sun
  target = wrapPi(target + wrapPi(aSun + Math.PI - target) * sstep(0.30, 0.50, sunE));   // high sun → behind us
  if (!camAimed) { camYaw = target; camYawV = 0; camAimed = true; }          // no pan on launch
  const x = wrapPi(camYaw - target), w = calm ? 0.8 : 1.3, ex = Math.exp(-w * dt), tmp = (camYawV + w * x) * dt;
  camYaw = wrapPi(target + (x + tmp) * ex); camYawV = (camYawV - w * tmp) * ex;
}
function camera(aspect) {
  const ty = Math.tan(CONFIG.sky.fov * RAD / 2), tx = ty * aspect;
  const pitch = -Math.atan((HZ - 0.5) * 2 * ty);         // so that y = HZ is exactly the horizon
  const yaw = camYaw + (calm ? 0 : tiltX) * 0.035;        // + tilt → gentle look-around parallax
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  CAMF[0] = sy * cp; CAMF[1] = sp; CAMF[2] = cy * cp;
  CAMR[0] = cy; CAMR[1] = 0; CAMR[2] = -sy;
  CAMU[0] = CAMF[1] * CAMR[2] - CAMF[2] * CAMR[1]; CAMU[1] = CAMF[2] * CAMR[0] - CAMF[0] * CAMR[2]; CAMU[2] = CAMF[0] * CAMR[1] - CAMF[1] * CAMR[0];
  CTAN[0] = tx; CTAN[1] = ty;
}
function update(dt) {
  const ts = calm ? 0.45 : 1, sdt = dt * ts;
  skyClock += sdt; if (skyClock > 3600) skyClock -= 3600;
  const w = scrubbing ? 7 : (calm ? 1.1 : 1.8);
  for (let i = 0; i < I_SCRUB; i++) spring(i, w, dt);
  spring(I_SCRUB, scrubbing ? 14 : 5, dt);

  const lat = LOC ? LOC.lat : CONFIG.defaultLocation.lat, lon = LOC ? LOC.lon : CONFIG.defaultLocation.lon;
  const south = lat < 0, aspect = cssW / cssH;
  astro(Date.now() + P[I_SCRUB] * 3600000, lat, lon);
  dirAzAlt(A.sunAz, A.sunAlt, south, SUND); dirAzAlt(A.moonAz, A.moonAlt, south, MOOND);
  sunE = SUND[1]; sunVis = sstep(-0.015, 0.01, sunE); moonVis = sstep(-0.01, 0.03, MOOND[1]);
  // moon disk basis + phase light
  let mx = MOOND[2], mz = -MOOND[0]; const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
  MOONR[0] = mx; MOONR[1] = 0; MOONR[2] = mz;
  MOONU[0] = MOOND[1] * MOONR[2] - MOOND[2] * MOONR[1]; MOONU[1] = MOOND[2] * MOONR[0] - MOOND[0] * MOONR[2]; MOONU[2] = MOOND[0] * MOONR[1] - MOOND[1] * MOONR[0];
  const ph = A.moonPhase * Math.PI * 2;
  moonLx = Math.sin(ph) * (south ? -1 : 1); moonLz = -Math.cos(ph);
  // stars and the Milky Way live on the celestial sphere
  skyFrames(lat, south);
  // light for the clouds: the sun, handing over to the moon through twilight
  const sm = sstep(-0.16, -0.04, sunE);
  LDIR[0] = lerp(MOOND[0], SUND[0], sm); LDIR[1] = lerp(MOOND[1], SUND[1], sm); LDIR[2] = lerp(MOOND[2], SUND[2], sm);
  const ll = Math.hypot(LDIR[0], LDIR[1], LDIR[2]) || 1; LDIR[0] /= ll; LDIR[1] /= ll; LDIR[2] /= ll;
  regimes(sunE);
  const dk = clamp(P[I_DARK], 0, 1);
  LGT[0] = 1 - 0.6 * dk;                                          // sun illuminance (the LUTs do the colour)
  LGT[1] = A.moonFrac * moonVis * MOON_E * (1 - 0.6 * dk);         // moonlight
  LGT[2] = sm;                                                    // sun's share of the shadowing direction
  aimCamera(dt); camera(aspect);

  // wind: weather drift in km of world space (sped up ×60 so motion reads); fog drift & evolution wrap at 1
  const wx = P[I_WX], wy = P[I_WY], wsp = P[I_WS];
  wX -= (0.010 + wx * 0.12) * sdt; wZ -= wy * 0.12 * sdt;
  if (wX < -1e4 || wX > 1e4) wX = 0; if (wZ < -1e4 || wZ > 1e4) wZ = 0;
  wEv += sdt * 0.004; wDet += sdt * 0.006; if (wEv > 1e3) wEv = 0; if (wDet > 1e3) wDet = 0;
  dHx = wrap1(dHx - (0.010 + wx * 0.045) * 0.45 * sdt - 0.003 * sdt); dHy = wrap1(dHy - wy * 0.012 * sdt);
  evX = wrap1(evX + sdt * 0.0045); evY = wrap1(evY - sdt * 0.003);

  const tk = 1 - Math.exp(-dt * 6);
  tiltX += ((calm ? 0 : tiltTX) - tiltX) * tk; tiltY += ((calm ? 0 : tiltTY) - tiltY) * tk;

  const storm = P[I_STORM];
  if (!calm && storm > 0.4 && flashT < 0 && (nextFlash -= dt) <= 0) {
    flashT = 0; flashX = (Math.random() - 0.5) * aspect * 0.8; flashY = 0.55 + Math.random() * 0.3;
    boltOn = Math.random() < 0.55 ? 1 : 0; boltX = (Math.random() - 0.5) * aspect * 0.7; boltSeed = Math.random() * 100;
    nextFlash = (2 + Math.random() * 7) / storm;
    // direction of the flash for the clouds
    const nx = flashX / (aspect * 0.5), ny = flashY * 2 - 1;
    FLD[0] = CAMF[0] + CAMR[0] * nx * CTAN[0] + CAMU[0] * ny * CTAN[1];
    FLD[1] = CAMF[1] + CAMR[1] * nx * CTAN[0] + CAMU[1] * ny * CTAN[1];
    FLD[2] = CAMF[2] + CAMR[2] * nx * CTAN[0] + CAMU[2] * ny * CTAN[1];
    const fl = Math.hypot(FLD[0], FLD[1], FLD[2]); FLD[0] /= fl; FLD[1] /= fl; FLD[2] /= fl;
  }
  if (flashT >= 0) { flashT += dt; if (flashT > 1.2) flashT = -1; }
  flashI = flashT < 0 ? 0 : (Math.exp(-flashT * 16) + (flashT > 0.13 ? 0.7 * Math.exp(-(flashT - 0.13) * 14) : 0)) * storm;
  FLD[3] = flashI;

  for (let i = 0; i < 6; i++) { const o = i * 4; RIP[o + 2] += dt; if (RIP[o + 2] > 3) RIP[o + 3] = 0; }
  updateDrops(dt, aspect);
}

function bindTex(unit, target, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target, tex); }
function toRT(r) { gl.bindFramebuffer(gl.FRAMEBUFFER, r ? r.f : null); if (r) gl.viewport(0, 0, r.w, r.h); else gl.viewport(0, 0, cw, ch); }

function render(dt) {
  const aspect = cssW / cssH;
  if (tq) timerBegin();
  gl.bindVertexArray(vaoEmpty);
  // 1. touch field
  fieldEnergy *= Math.exp(-dt * 1.8);
  if (splatN > 0 || fieldEnergy > 0.002) {
    const dst = fieldT[1 - fieldIdx];
    toRT(dst); gl.useProgram(PR.field); const u = UL.field;
    bindTex(1, gl.TEXTURE_2D, fieldT[fieldIdx].t);
    gl.uniform1i(u.uPrev, 1); gl.uniform2f(u.uSize, FW, FH);
    gl.uniform4fv(u.uSplat, SPL); gl.uniform1f(u.uDecay, Math.exp(-dt / 1.4)); gl.uniform1f(u.uAspect, aspect);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    fieldIdx = 1 - fieldIdx; splatN = 0; SPL.fill(0);
  }
  // 2. atmosphere LUTs — transmittance when the haze changes, sky-view when a light moves
  const haze = CONFIG.sky.haze * (1 + 1.4 * sstep(55, 100, S.hum) + 3 * clamp(P[I_FOG], 0, 1));
  if (Math.abs(haze - transHaze) > 0.04) {
    toRT(transT); gl.useProgram(PR.trans);
    gl.uniform2f(UL.trans.uSize, transT.w, transT.h); gl.uniform1f(UL.trans.uHaze, haze);
    gl.drawArrays(gl.TRIANGLES, 0, 3); transHaze = haze; lutHaze = -1;
  }
  const sunMoved = SUND[0] * LUT_SUN[0] + SUND[1] * LUT_SUN[1] + SUND[2] * LUT_SUN[2] < 0.9999996;
  const moonMoved = MOOND[0] * LUT_MOON[0] + MOOND[1] * LUT_MOON[1] + MOOND[2] * LUT_MOON[2] < 0.9999996;
  if (sunMoved || moonMoved || lutHaze !== transHaze) {
    gl.useProgram(PR.skyview); const u = UL.skyview;
    bindTex(0, gl.TEXTURE_2D, transT.t); gl.uniform1i(u.uTrans, 0);
    gl.uniform2f(u.uSize, skySunT.w, skySunT.h); gl.uniform1f(u.uHaze, transHaze);
    if (sunMoved || lutHaze !== transHaze) { toRT(skySunT); gl.uniform1f(u.uLightZ, SUND[1]); gl.drawArrays(gl.TRIANGLES, 0, 3); LUT_SUN.set(SUND); }
    if (moonMoved || lutHaze !== transHaze) { toRT(skyMoonT); gl.uniform1f(u.uLightZ, MOOND[1]); gl.drawArrays(gl.TRIANGLES, 0, 3); LUT_MOON.set(MOOND); }
    lutHaze = transHaze;
  }
  // 3. volumetric clouds at ¼ res + temporal resolve
  // every layer of the forecast feeds the volumetric clouds (no flat cirrus layer any more):
  // combined cover = 1 − Π(1 − layer), mid and high layers weighted lower
  const cov = clamp(1 - (1 - clamp(P[I_CL], 0, 1)) * (1 - 0.7 * clamp(P[I_CM], 0, 1)) * (1 - 0.25 * clamp(P[I_CH], 0, 1)), 0, 1);
  // stratiform only when it rains/snows or fogs: a cloudy dry sky stays a bank of 3-D cumulus
  const strat = clamp(Math.max(P[I_RAIN], P[I_SNOW]) * 0.85 + sstep(0.9, 1, cov) * 0.2 + P[I_FOG] * 0.4, 0, 1);
  // fair weather: a distant bank under the temperature; a deck (rain, snow, fog) fills the sky
  const deck = sstep(0.25, 0.6, strat);
  const top = deck > 0.5 ? 1 : (deck < 0.35 ? CONFIG.sky.bankTop : BAND[1]);
  if (top !== BAND[1]) { BAND[1] = top; sizeClouds(); }
  // under a sheet that is zooming, being dragged or resting, the clouds are only seen
  // dimmed through a heavy blur: keep the last traced clouds and give the frame budget
  // to the transition. Live again as soon as the sky has to follow a scrub, and from
  // the last third of the way back, so the history has converged when the sheet lands
  const skipSky = halfRate && (frameNo & 1) && cloudsOn && !scrubbing && !CS.on;
  const freeze = (EX.active && EX.prog > 0.35 && !scrubbing && !CS.on && cloudsOn) || skipSky;
  if (freeze) { /* history kept as it is */ }
  else if (cov > 0.008 && texShape) {
    cloudsOn = true;
    const j = (frameNo & 3) * 2, jx = JIT[j], jy = JIT[j + 1];
    toRT(cFresh); gl.useProgram(PR.clouds); let u = UL.clouds;
    bindTex(0, gl.TEXTURE_3D, texShape); bindTex(1, gl.TEXTURE_3D, texErosion); bindTex(2, gl.TEXTURE_2D, texWeather);
    bindTex(3, gl.TEXTURE_2D, fieldT[fieldIdx].t); bindTex(4, gl.TEXTURE_2D, transT.t); bindTex(5, gl.TEXTURE_2D, skySunT.t); bindTex(6, gl.TEXTURE_2D, skyMoonT.t);
    gl.uniform1i(u.uShape, 0); gl.uniform1i(u.uErosion, 1); gl.uniform1i(u.uWeatherMap, 2); gl.uniform1i(u.uField, 3);
    gl.uniform1i(u.uTrans, 4); gl.uniform1i(u.uSkyS, 5); gl.uniform1i(u.uSkyM, 6);
    gl.uniform2f(u.uRes, cFresh.w, cFresh.h); gl.uniform2f(u.uJit, jx, jy);
    gl.uniform3fv(u.uCamF, CAMF); gl.uniform3fv(u.uCamU, CAMU); gl.uniform3fv(u.uCamR, CAMR); gl.uniform2fv(u.uTan, CTAN);
    gl.uniform3fv(u.uSunDir, SUND); gl.uniform3fv(u.uMoonDir, MOOND); gl.uniform3fv(u.uLightDir, LDIR); gl.uniform3fv(u.uLight, LGT);
    const clear = CONFIG.sky.clearKm * (1 - 0.18 * cov) * (1 - deck);
    gl.uniform2f(u.uBand, BAND[0], BAND[1]); gl.uniform2f(u.uClear, clear, Math.max(0.5, clear * 0.3));
    gl.uniform4f(u.uWeather, cov, strat, 0.85 + 0.7 * clamp(P[I_DARK], 0, 1), clamp(P[I_DARK], 0, 1));
    gl.uniform4f(u.uWindOff, wX, wZ, wEv, wDet);
    gl.uniform1f(u.uFrame, frameNo & 1023);
    gl.uniform4fv(u.uFlash, FLD);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const dst = cHist[1 - histIdx];
    toRT(dst); gl.useProgram(PR.resolve); u = UL.resolve;
    bindTex(0, gl.TEXTURE_2D, cFresh.t); bindTex(1, gl.TEXTURE_2D, cHist[histIdx].t);
    gl.uniform1i(u.uFresh, 0); gl.uniform1i(u.uHist, 1);
    gl.uniform2f(u.uFreshRes, cFresh.w, cFresh.h); gl.uniform2f(u.uJit, jx, jy); gl.uniform1f(u.uFill, fillFrames > 0 ? 1 : 0);
    // ~20 samples per pixel when the sky is steady; quick to follow while scrubbing or when the weather moves
    gl.uniform1f(u.uBlend, scrubbing || Math.abs(P[I_SCRUB] - T[I_SCRUB]) > 0.05 ? 0.4 : 0.11);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    histIdx = 1 - histIdx; if (fillFrames > 0) fillFrames--;
  } else if (cloudsOn) {
    cloudsOn = false;
    for (const r of cHist) { toRT(r); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
    fillFrames = 3;
  }
  frameNo++;
  // 4. rain drops on the glass
  if (dropsAlive > 0 || glassDirty) {
    toRT(glassT); gl.clearColor(0.5, 0.5, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (dropsAlive > 0 && texDrop) {
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(PR.drop); gl.bindVertexArray(vaoDrop);
      gl.bindBuffer(gl.ARRAY_BUFFER, dropBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, DROP);
      bindTex(0, gl.TEXTURE_2D, texDrop); gl.uniform1i(UL.drop.uDrop, 0); gl.uniform1f(UL.drop.uAspect, aspect);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, DN);
      gl.disable(gl.BLEND); gl.bindVertexArray(vaoEmpty);
    }
    glassDirty = dropsAlive > 0;
  }
  // 5. sky → texture — behind a sheet at rest only its blur shows: every other frame is enough
  const reuse = (EX.rest && !scrubbing && !CS.on && (frameNo & 1)) || skipSky;
  let u;
  if (!reuse) {
    toRT(skyT); gl.useProgram(PR.sky); u = UL.sky;
    bindTex(0, gl.TEXTURE_2D, texNoise); bindTex(1, gl.TEXTURE_2D, fieldT[fieldIdx].t);
    bindTex(2, gl.TEXTURE_2D, cHist[histIdx].t); bindTex(3, gl.TEXTURE_2D, glassT.t);
    bindTex(4, gl.TEXTURE_2D, transT.t); bindTex(5, gl.TEXTURE_2D, skySunT.t); bindTex(6, gl.TEXTURE_2D, skyMoonT.t); bindTex(7, gl.TEXTURE_2D, texMilky || texBlack);
    gl.uniform1i(u.uNoise, 0); gl.uniform1i(u.uField, 1); gl.uniform1i(u.uClouds, 2); gl.uniform1i(u.uGlass, 3);
    gl.uniform1i(u.uTrans, 4); gl.uniform1i(u.uSkyS, 5); gl.uniform1i(u.uSkyM, 6); gl.uniform1i(u.uMilky, 7);
    gl.uniform2f(u.uRes, cw, ch); gl.uniform1f(u.uTime, skyClock);
    gl.uniform3fv(u.uCamF, CAMF); gl.uniform3fv(u.uCamU, CAMU); gl.uniform3fv(u.uCamR, CAMR); gl.uniform2fv(u.uTan, CTAN);
    gl.uniformMatrix3fv(u.uEqRot, false, EQM); gl.uniformMatrix3fv(u.uGalRot, false, GALM);
    gl.uniform3fv(u.uLight, LGT); gl.uniform1f(u.uExposure, CONFIG.sky.exposure); gl.uniform3f(u.uNight, NIGHT[0], NIGHT[1], NIGHT[2]);
    gl.uniform3fv(u.uSunDir, SUND); gl.uniform3fv(u.uMoonDir, MOOND); gl.uniform3fv(u.uMoonR, MOONR); gl.uniform3fv(u.uMoonU, MOONU);
    gl.uniform4f(u.uSun, sunVis, sunE, 0, 0); gl.uniform4f(u.uMoon, moonVis, A.moonFrac, 0, 0); gl.uniform3f(u.uMoonL, moonLx, 0, moonLz);
    gl.uniform4f(u.uDrift2, dHx, dHy, evX, evY); gl.uniform2f(u.uBand, BAND[0], BAND[1]);
    gl.uniform3f(u.uEye, (calm ? 0 : tiltX) * 0.12, (calm ? 0 : -tiltY) * 0.07, camYaw + (calm ? 0 : tiltX) * 0.035);
    gl.uniform4f(u.uCloud, clamp(P[I_CL], 0, 1), clamp(P[I_CM], 0, 1), clamp(P[I_CH], 0, 1), clamp(P[I_DARK], 0, 1));
    gl.uniform4f(u.uWx, clamp(P[I_RAIN], 0, 1), clamp(P[I_SNOW], 0, 1), clamp(P[I_FOG], 0, 1), clamp(P[I_STORM], 0, 1));
    gl.uniform4f(u.uWind, clamp(P[I_WX] * 0.4, -0.55, 0.55), clamp(P[I_WX] * 0.15, -0.3, 0.3), P[I_WS], 0);
    gl.uniform4f(u.uFlash, flashX, flashY, flashI, boltOn); gl.uniform2f(u.uBolt, boltX, boltSeed);
    gl.uniform4fv(u.uRip, RIP); gl.uniform4fv(u.uW, WTS);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // 6. the material's blur: dual-Kawase ½ → 1/32 and back up to ¼ (a ~30 pt radius)
    gl.useProgram(PR.down); u = UL.down; gl.uniform1i(u.uSrc, 0);
    let srcT = skyT;
    for (let k = 0; k < 5; k++) {
      const dst = BDN[k];                                // preallocated chain: no per-frame arrays
      toRT(dst); bindTex(0, gl.TEXTURE_2D, srcT.t);
      gl.uniform2f(u.uDst, dst.w, dst.h); gl.uniform2f(u.uTex, 1 / srcT.w, 1 / srcT.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3); srcT = dst;
    }
    gl.useProgram(PR.up); u = UL.up; gl.uniform1i(u.uSrc, 0);
    for (let k = 0; k < 3; k++) {
      const dst = BUP[k];
      toRT(dst); bindTex(0, gl.TEXTURE_2D, srcT.t);
      gl.uniform2f(u.uDst, dst.w, dst.h); gl.uniform2f(u.uTex, 1 / srcT.w, 1 / srcT.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3); srcT = dst;
    }
  }
  // 7. widget material → screen
  toRT(null); gl.useProgram(PR.final); u = UL.final;
  bindTex(0, gl.TEXTURE_2D, skyT.t); bindTex(1, gl.TEXTURE_2D, BUP[2].t);
  gl.uniform1i(u.uSky, 0); gl.uniform1i(u.uBlur, 1);
  gl.uniform2f(u.uRes, cw, ch); gl.uniform4fv(u.uRect, RECT); gl.uniform4fv(u.uRectP, RECTP); gl.uniform4fv(u.uPress, PRESS);
  gl.uniform2f(u.uLight, LIGHT_X, LIGHT_Y); gl.uniform1f(u.uTime, skyClock); gl.uniform1f(u.uDim, UI_DIM); gl.uniform1f(u.uBgBlur, bgBlur());
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  if (tq) timerEnd();
}

let tqActive = -1;
function timerBegin() {
  for (let i = 0; i < 4; i++) {
    if (!tq.busy[i]) continue;
    if (gl.getQueryParameter(tq.q[i], gl.QUERY_RESULT_AVAILABLE)) {
      if (!gl.getParameter(tq.ext.GPU_DISJOINT_EXT) && !idle) governor(performance.now(), gl.getQueryParameter(tq.q[i], gl.QUERY_RESULT) / 1e6);
      tq.busy[i] = false;
    }
  }
  tqActive = -1;
  for (let k = 0; k < 4; k++) { const i = (tq.head + k) & 3; if (!tq.busy[i]) { tqActive = i; tq.head = (i + 1) & 3; break; } }
  if (tqActive >= 0) gl.beginQuery(tq.ext.TIME_ELAPSED_EXT, tq.q[tqActive]);
}
function timerEnd() { if (tqActive >= 0) { gl.endQuery(tq.ext.TIME_ELAPSED_EXT); tq.busy[tqActive] = true; } }

function start() { if (!rafId && !document.hidden) { lastT = 0; rafId = requestAnimationFrame(frame); } }
function stop() { if (rafId) cancelAnimationFrame(rafId); rafId = 0; }
function markInteraction() { lastInteract = performance.now(); }

//@@GPU@@
//@@UI@@
