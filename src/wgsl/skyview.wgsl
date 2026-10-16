// Sky-view LUT (192×108) — WGSL twin of skyview.frag (Hillaire 2020 + scattering octaves)
#include atmos.wgsl
#include full.wgsl
struct U { a: vec4f };                                    // xy size, z light cos zenith, w haze
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tTrans: texture_2d<f32>;
@group(0) @binding(2) var sClamp: sampler;
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / u.a.xy;
  let lightZ = u.a.z;
  let haze = u.a.w;
  let r = RG + CAM_H;
  let Vh = sqrt(r * r - RG * RG);
  let beta = acos(Vh / r);
  let zha = PI - beta;
  var ca = 1.0 - 2.0 * uv.y; ca = 1.0 - ca * ca;
  var cb = 2.0 * uv.y - 1.0; cb *= cb;
  let za = mix(zha * clamp(ca, 0.0, 1.0), zha + beta * cb, step(0.5, uv.y));
  let lv = -(uv.x * uv.x * 2.0 - 1.0);
  let vz = cos(za);
  let vs = sin(za);
  let rd = vec3f(vs * lv, vz, vs * sqrt(max(1.0 - lv * lv, 0.0)));
  let ld = vec3f(sqrt(max(1.0 - lightZ * lightZ, 0.0)), lightZ, 0.0);
  let b = r * vz;
  let disc = b * b - r * r + RG * RG;
  var dG = 1e9;
  if (disc > 0.0 && vz < 0.0) { dG = -b - sqrt(disc); }
  let d = min(distTop(r, vz), dG);
  let dt = d / 32.0;
  let c = dot(rd, ld);
  let pr0 = rayPhase(c);          let pm0 = hgPhase(MIE_G, c);
  let pr1 = rayPhase(c * 0.7);    let pm1 = hgPhase(MIE_G * 0.7, c * 0.7);
  let pr2 = rayPhase(c * 0.49);   let pm2 = hgPhase(MIE_G * 0.49, c * 0.49);
  let pr3 = rayPhase(c * 0.343);  let pm3 = hgPhase(MIE_G * 0.343, c * 0.343);
  var L = vec3f(0.0);
  var Tv = vec3f(1.0);
  let p0 = vec3f(0.0, r, 0.0);
  for (var i = 0; i < 32; i++) {
    let t = (f32(i) + 0.5) * dt;
    let p = p0 + rd * t;
    let rp = length(p);
    let h = rp - RG;
    let dr = exp(-h / RAY_H);
    let dm = exp(-h / MIE_H) * haze;
    let oz = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
    let sr = RAY_S * dr;
    let sm = MIE_S * dm;
    let ext = sr + (MIE_S + MIE_A) * dm + OZO_A * oz;
    let Tl = transmit(tTrans, sClamp, rp, dot(p, ld) / rp);
    let S = (sr * pr0 + sm * pm0) * Tl
          + 0.53   * (sr * pr1 + sm * pm1) * pow(Tl, vec3f(0.35))
          + 0.2809 * (sr * pr2 + sm * pm2) * pow(Tl, vec3f(0.1225))
          + 0.1489 * (sr * pr3 + sm * pm3) * pow(Tl, vec3f(0.0429));
    let Ts = exp(-ext * dt);
    L += Tv * (S - S * Ts) / max(ext, vec3f(1e-7));
    Tv *= Ts;
  }
  return vec4f(L, 1.0);
}
