# Ciel

A weather app whose background is a live, ray-marched volumetric sky driven by real Open-Meteo data, built for the Nothing Phone (4a) Pro (AMOLED, 120 Hz) and shipped as **one `index.html`** (font, shaders and textures inlined) plus a tiny `sw.js`.

- **Volumetric clouds**: ray-marched through a curved cloud shell using the real Perlin-Worley shape (64³) and Worley erosion (32³) noise volumes and the tileable weather map from [lightest/clouds](https://github.com/lightest/clouds). Framed like a photograph: in fair weather the sky overhead stays clear and the cumulus stand as a distant bank (9–40 km) under the temperature, melting into the horizon haze; the more cloud in the forecast, the more and the taller the towers, each cell with a height of its own so the skyline is ragged rather than a wall. Unsettled warm weather and thunderstorms grow real cumulonimbus: discrete columns (flared foot, cauliflower sides) of different heights, each capped by a flat elliptical anvil, with the cumulus standing back so the trunks show (`CONFIG.sky.towers` scales it, 0 turns it off; `towerRise` lifts the render band to fit them). Rain, snow and fog bring a deck overhead. Adaptive march (fine strides in cloud, geometric strides through clear air, distance-scaled), its own band buffer for resolution, B-spline upscale. Lighting: sunlight attenuated through the atmosphere per sample (tops catch the last light at dusk), 5-sample shadow rays out to 3 km (dark, flat bases), beer-powder, dual-lobe Henyey-Greenstein, multiple-scattering octaves. Traced at a quarter of the buffer per frame, ~20-sample temporal history when steady.
- **3-D rain and snow**: drops on six cylinders around the camera at real depths (1.4–32 m) — near drops big, soft and fast, far ones fine threads; they lean and drift with the wind, shift with parallax when the phone tilts, and end at the lake surface.
- **Atmosphere**: a physically based sky after Hillaire 2020 — a transmittance LUT and a sky-view LUT (for the sun and the moon) give real blue hour, golden hour, the Earth's shadow and the belt of Venus at any latitude; humidity and fog thicken the haze. Exposure, ACES filmic curve, sRGB.
- **Night**: stars placed on the celestial sphere and turned by sidereal time — verified against the sun's ephemeris (`ciel.sky()`). (The Milky Way was dropped: the only freely reusable panorama within reach was too low-resolution to hold up on a phone.)
- **Camera**: frames the sky like a photographer — by day with the sun behind (front-lit clouds), toward the sun through golden hour and twilight, toward the equator at night.
- **Frosted widgets**: each card is a slot in a WebGL pass — a wide (~30 pt) half-float dual-Kawase blur of the live sky read through a bicubic filter, vibrancy, an adaptive tint that deepens over bright clouds, a light-catching hairline that follows tilt, fine grain.
- **Tap any widget to expand it**: a transform-only zoom (springs, interruptible) into a full sheet with charts and details — 48 h, 7 days, UV, wind, sun & moon, feels-like, humidity, pressure, air quality. Every sheet is built ahead of time in idle moments and kept laid out in memory, so a tap only reveals it. Drag down from the header or anywhere at the top of the sheet to dismiss; the zoom back continues the finger's velocity. Android back closes it.
- **Shared-element morphs**: what is shown in two places travels between them instead of fading out and in — scrolling, the hero's city, temperature and condition fly up into the compact title bar (and back); opening a widget, its title and main value fly into the sheet's title and big number. Scroll- or spring-driven, so it tracks the finger and reverses.
- **Scrub the charts**: drag along any chart — the dot rides the curve, the readout follows, the whole sky morphs to that hour, and on release it settles on the hour (the 48 h card follows).
- **Touch**: dragging stirs the clouds and leaves ripples; tilt adds parallax; scrolling the 48 h card morphs the whole sky to that hour, with a haptic tick per hour.
- **120 Hz**: custom scroll physics in the same frame as the GL (no glass lag), allocation-free frame loop, render-scale governor (0.35×–1.0×), 30 fps after 20 s idle, paused when hidden. Triple-tap the sky (or ⋮ → stats) for fps / frame ms / scale.

`CONFIG` at the top of `src/app.js` controls quality (render scale, cloud steps/resolution), units, sky exposure and haze, cumulonimbus (`sky.towers`, `sky.towerRise`), the night-sky colour and the glass widgets.

## Layout

| Path | What |
|---|---|
| `src/index.html` | Page skeleton + SVG icon sprite |
| `src/styles.css` | All styling (iOS type scale, glass fallbacks, sheets) |
| `src/shaders/*` | GLSL ES 3.00: `atmos.glsl` (shared atmosphere), `trans` + `skyview` (atmosphere LUTs), `clouds`, `resolve` (temporal), `field` (touch), `drop`, `sky`, `down`/`up` (Kawase blur), `final` (glass widgets) |
| `src/app.js` | CONFIG, astronomy, data model, WebGL pipeline |
| `src/ui.js` | Scroll physics, widgets, expand transitions, data fetching, PWA |
| `scripts/build-web.mjs` | Assembles everything into `www/index.html`; fetches the cloud noise, weather map and rain-drop assets from their pinned GitHub sources, processes them with sharp and inlines them (and the font) as base64 |
| `www/sw.js` | Offline shell (browsers only run service workers from a real `.js` file) |
| `scripts/patch-android.mjs` | Patches the generated Android project (permissions, 120 Hz, icons, splash, version) |
| `.github/workflows/android.yml` | Builds the APK on every push to `main` and publishes it as a Release |

## Build the APK (no PC needed)

Push to `main` → GitHub Actions builds the web app, runs `npx cap add android`, patches it, builds `assembleDebug`, and attaches `Ciel-1.0.<run>.apk` (plus the built `index.html`) to a new Release. Open the Release on the phone and install.

The first run generates a debug signing key and stores it on an orphan `signing` branch; later runs reuse it, so every build installs over the previous one. It's a debug key — fine for sideloading your own builds, not for a store release.

### Locally

```bash
npm install
npm run build:web          # → www/index.html
npx cap add android        # first time only
npm run android:patch
npx cap sync android
npm run android:apk        # → android/app/build/outputs/apk/debug/app-debug.apk
```

## Install as a PWA

Enable **Settings → Pages → Source: GitHub Actions** once; the workflow then also deploys `www/` and Chrome can "Install app" from `https://<user>.github.io/Weather-app/`.

## Credits

- Weather, geocoding, air quality: [Open-Meteo](https://open-meteo.com) (CC BY 4.0)
- Cloud noise volumes, weather map and the multiple-scattering / height-signal approach: [lightest/clouds](https://github.com/lightest/clouds) by Nikita Agafonov (MIT), pinned at `a3984d6`. Techniques after Schneider (*Horizon Zero Dawn*, SIGGRAPH 2015), Hillaire (Frostbite 2016; *A Scalable and Production Ready Sky and Atmosphere Rendering Technique*, EGSR 2020) and Wrenninge (multiple-scattering octaves). [FarazzShaikh/three-volumetric-clouds](https://github.com/FarazzShaikh/three-volumetric-clouds) and [tkchanat/webgl-volumetric-cloud](https://github.com/tkchanat/webgl-volumetric-cloud) were studied for technique only — they carry no licence, so none of their code or assets is used.
- Rain drop textures: `drop-alpha.png`, `drop-color.png` from [Codrops RainEffect](https://github.com/codrops/RainEffect) — free to integrate in personal or commercial projects, not to redistribute as-is
- Font: [Inter](https://github.com/rsms/inter) variable, with optical sizes (SIL OFL 1.1), tracked with Apple's SF tracking curve. On Apple devices the system San Francisco font is used instead; SF itself can't be bundled in an Android app under its licence.
- Sun/moon formulas after [SunCalc](https://github.com/mourner/suncalc) (BSD-2)
- Reverse geocoding: BigDataCloud free client API
