// ── Shared: a physically based Earth atmosphere (WGSL twin of atmos.glsl) ──
// Bruneton 2017 / Hillaire 2020 parameters, in km.
const PI = 3.14159265;
const RG = 6360.0;                                        // ground radius
const RT = 6460.0;                                        // top of the atmosphere
const CAM_H = 0.25;                                       // viewer altitude
const RAY_S = vec3f(5.802, 13.558, 33.1) * 1e-3;          // Rayleigh scattering /km
const RAY_H = 8.0;
const MIE_S = 3.996e-3;
const MIE_A = 4.40e-3;
const MIE_H = 1.2;
const MIE_G = 0.8;
const OZO_A = vec3f(0.650, 1.881, 0.085) * 1e-3;          // ozone absorption /km (tent 10–40 km)

// GLSL's smoothstep (edges may be reversed) and mod (floored)
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
fn fmod(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }

fn rayPhase(c: f32) -> f32 { return 3.0 / (16.0 * PI) * (1.0 + c * c); }
fn hgPhase(g: f32, c: f32) -> f32 { let g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5)); }

// distance from radius r along mu (cos zenith) to the top of the atmosphere
fn distTop(r: f32, mu: f32) -> f32 { return max(0.0, -r * mu + sqrt(max(r * r * (mu * mu - 1.0) + RT * RT, 0.0))); }

// transmittance LUT parametrisation (Bruneton): uv ↔ (r, mu)
fn transUV(r: f32, mu: f32) -> vec2f {
  let H = sqrt(RT * RT - RG * RG);
  let rho = sqrt(max(r * r - RG * RG, 0.0));
  let d = distTop(r, mu);
  let dmin = RT - r;
  let dmax = rho + H;
  return vec2f((d - dmin) / max(dmax - dmin, 1e-3), rho / H);
}
fn transRMu(uv: vec2f) -> vec2f {                         // → (r, mu)
  let H = sqrt(RT * RT - RG * RG);
  let rho = H * uv.y;
  let r = sqrt(rho * rho + RG * RG);
  let dmin = RT - r;
  let dmax = rho + H;
  let d = dmin + uv.x * (dmax - dmin);
  var mu = 1.0;
  if (d >= 1e-3) { mu = clamp((H * H - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0); }
  return vec2f(r, mu);
}
// sun/moon light reaching radius r from a light at cos zenith mu (0 past the planet's shadow line)
fn transmit(T: texture_2d<f32>, s: sampler, r: f32, mu: f32) -> vec3f {
  let muH = -sqrt(max(1.0 - (RG * RG) / (r * r), 0.0));
  return textureSampleLevel(T, s, transUV(r, mu), 0.0).rgb * ss(muH - 0.01, muH + 0.004, mu);
}
// sky-view LUT parametrisation (Hillaire 2020)
fn skyUV(vz: f32, lv: f32) -> vec2f {
  let r = RG + CAM_H;
  let Vh = sqrt(r * r - RG * RG);
  let beta = acos(Vh / r);
  let zha = PI - beta;
  let za = acos(clamp(vz, -1.0, 1.0));
  let va = (1.0 - sqrt(max(1.0 - za / zha, 0.0))) * 0.5;
  let vb = sqrt(max((za - zha) / beta, 0.0)) * 0.5 + 0.5;
  return vec2f(sqrt(clamp(-lv * 0.5 + 0.5, 0.0, 1.0)), mix(va, vb, step(zha, za)));
}
// radiance of the sky in direction rd for a light at ld (both world space, y up)
fn skyLookup(S: texture_2d<f32>, s: sampler, rd: vec3f, ld: vec3f) -> vec3f {
  let h = rd.xz;
  let l = ld.xz;
  let lh = length(h) * length(l);
  var lv = 1.0;
  if (lh > 1e-5) { lv = dot(h, l) / lh; }
  return textureSampleLevel(S, s, skyUV(rd.y, lv), 0.0).rgb;
}
