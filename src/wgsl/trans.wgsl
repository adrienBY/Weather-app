// Transmittance LUT (256×64) — WGSL twin of trans.frag
#include atmos.wgsl
#include full.wgsl
struct U { a: vec4f };                                    // xy size, z haze
@group(0) @binding(0) var<uniform> u: U;
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let rm = transRMu(fc.xy / u.a.xy);
  let r = rm.x;
  let mu = rm.y;
  let d = distTop(r, mu);
  let dt = d / 40.0;
  var tau = vec3f(0.0);
  for (var i = 0; i < 40; i++) {
    let t = (f32(i) + 0.5) * dt;
    let h = sqrt(r * r + t * t + 2.0 * r * mu * t) - RG;
    let mie = exp(-h / MIE_H) * u.a.z;
    let oz = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
    tau += (RAY_S * exp(-h / RAY_H) + (MIE_S + MIE_A) * mie + OZO_A * oz) * dt;
  }
  return vec4f(exp(-tau), 1.0);
}
