// Patches the freshly generated Capacitor Android project (android/ is not
// committed — CI runs `npx cap add android` and then this script).
//  • location + vibration permissions (geolocation fallback, haptic ticks)
//  • MainActivity asks the display for its 120 Hz mode (WebView rAF follows it)
//  • launcher icons rendered from assets/icon.svg, black splash (no white flash)
//  • versionCode = CI run number, so every build installs over the last one
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
const app = path.join(root, 'android/app');
const main = path.join(app, 'src/main');
const res = path.join(main, 'res');
const edit = (file, fn) => { const p = path.join(root, file); fs.writeFileSync(p, fn(fs.readFileSync(p, 'utf8'))); };

// 1. permissions
edit('android/app/src/main/AndroidManifest.xml', s => {
  const perms = ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'VIBRATE']
    .filter(p => !s.includes('android.permission.' + p))
    .map(p => `    <uses-permission android:name="android.permission.${p}" />`).join('\n');
  return perms ? s.replace('<uses-permission android:name="android.permission.INTERNET" />', '<uses-permission android:name="android.permission.INTERNET" />\n' + perms) : s;
});

// 2. 120 Hz
const pkg = cfg.appId;
const activity = path.join(main, 'java', ...pkg.split('.'), 'MainActivity.java');
fs.writeFileSync(activity, `package ${pkg};

import android.os.Bundle;
import android.view.Display;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestHighRefreshRate();
    }

    /** Pick the 120 Hz mode at the current resolution (or the fastest one available). */
    @SuppressWarnings("deprecation")
    private void requestHighRefreshRate() {
        Display display = getWindowManager().getDefaultDisplay();
        if (display == null) return;
        Display.Mode current = display.getMode();
        Display.Mode best = current;
        for (Display.Mode m : display.getSupportedModes()) {
            if (m.getPhysicalWidth() != current.getPhysicalWidth() || m.getPhysicalHeight() != current.getPhysicalHeight()) continue;
            boolean bestIs120 = Math.abs(best.getRefreshRate() - 120f) < 1f;
            boolean mIs120 = Math.abs(m.getRefreshRate() - 120f) < 1f;
            if (mIs120 && !bestIs120) best = m;
            else if (!bestIs120 && m.getRefreshRate() > best.getRefreshRate()) best = m;
        }
        WindowManager.LayoutParams lp = getWindow().getAttributes();
        lp.preferredDisplayModeId = best.getModeId();
        getWindow().setAttributes(lp);
    }
}
`);

// 3. icons
const svg = fs.readFileSync(path.join(root, 'assets/icon.svg'), 'utf8');
const artOnly = svg.replace(/<rect id="bg"[^>]*\/>/, '');
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const circle = s => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><circle cx="${s / 2}" cy="${s / 2}" r="${s / 2}"/></svg>`);
for (const [d, k] of Object.entries(densities)) {
  const dir = path.join(res, 'mipmap-' + d);
  const legacy = Math.round(48 * k), fg = Math.round(108 * k), inner = Math.round(72 * k);
  const full = await sharp(Buffer.from(svg), { density: 300 }).resize(legacy, legacy).png().toBuffer();
  fs.writeFileSync(path.join(dir, 'ic_launcher.png'), full);
  fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'),
    await sharp(full).composite([{ input: circle(legacy), blend: 'dest-in' }]).png().toBuffer());
  // adaptive foreground: artwork in the 72dp safe zone of a 108dp transparent canvas
  const art = await sharp(Buffer.from(artOnly), { density: 300 }).resize(inner, inner).png().toBuffer();
  fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'),
    await sharp({ create: { width: fg, height: fg, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: art, gravity: 'center' }]).png().toBuffer());
}
edit('android/app/src/main/res/values/ic_launcher_background.xml', s => s.replace(/#[0-9A-Fa-f]{6}/, '#121B3A'));

// 4. black splash
for (const dir of fs.readdirSync(res).filter(d => d.startsWith('drawable'))) {
  const f = path.join(res, dir, 'splash.png');
  if (!fs.existsSync(f)) continue;
  const { width, height } = await sharp(f).metadata();
  fs.writeFileSync(f, await sharp({ create: { width, height, channels: 3, background: '#000000' } }).png().toBuffer());
}
edit('android/app/src/main/res/values/styles.xml', s => s.includes('windowSplashScreenBackground') ? s :
  s.replace('<item name="android:background">@drawable/splash</item>',
    '<item name="android:background">@drawable/splash</item>\n        <item name="windowSplashScreenBackground">#000000</item>\n        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>'));

// 5. version
const run = parseInt(process.env.GITHUB_RUN_NUMBER || '1', 10);
edit('android/app/build.gradle', s => s.replace(/versionCode \d+/, `versionCode ${run}`).replace(/versionName "[^"]*"/, `versionName "1.0.${run}"`));

console.log(`patched ${pkg}: permissions, 120 Hz, icons, splash, version 1.0.${run}`);
