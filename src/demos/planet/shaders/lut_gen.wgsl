// src/shaders/lut_gen.wgsl
// Precompute atmosphere inscattering LUT.
// Each thread writes one texel of the 3D LUT: (muV, muS, r).

const PI: f32 = 3.14159265358979323846;

struct LUTParams {
  planetRadius     : f32,        // offset  0
  atmosphereRadius : f32,        // offset  4
  H_R              : f32,        // offset  8
  H_M              : f32,        // offset 12
  betaR            : vec3<f32>,  // offset 16 (align 16)
  betaM            : f32,        // offset 28
  mieG             : f32,        // offset 32
  numSamples       : u32,        // offset 36
  numLightSamples  : u32,        // offset 40
  lutResR          : u32,        // offset 44
  lutResMuS        : u32,        // offset 48
  lutResMuV        : u32,        // offset 52
  _pad             : vec2<f32>,  // offset 56 (pad to 64)
}

@group(0) @binding(0) var<uniform> params : LUTParams;
@group(0) @binding(1) var        lut    : texture_storage_3d<rgba16float, write>;

fn rayleigh_phase(cosTheta: f32) -> f32 {
  return (3.0 / (16.0 * PI)) * (1.0 + cosTheta * cosTheta);
}

fn mie_phase(cosTheta: f32, g: f32) -> f32 {
  let g2    = g * g;
  let denom = max((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5), 1e-7);
  return (3.0 / (8.0 * PI)) * ((1.0 - g2) * (1.0 + cosTheta * cosTheta)) / denom;
}

fn intersect_sphere(orig: vec3<f32>, dir: vec3<f32>, r: f32) -> vec2<f32> {
  let b    = dot(orig, dir);
  let c    = dot(orig, orig) - r * r;
  let disc = b * b - c;
  if (disc < 0.0) { return vec2(-1.0); }
  let s = sqrt(disc);
  return vec2(-b - s, -b + s);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.lutResMuV || gid.y >= params.lutResMuS || gid.z >= params.lutResR) {
    return;
  }

  // Map texel index → physical value
  let r   = params.planetRadius
          + (params.atmosphereRadius - params.planetRadius)
          * (f32(gid.z) + 0.5) / f32(params.lutResR);
  let mu_s = -1.0 + 2.0 * (f32(gid.y) + 0.5) / f32(params.lutResMuS);
  let mu_v = -1.0 + 2.0 * (f32(gid.x) + 0.5) / f32(params.lutResMuV);

  let h = r - params.planetRadius;
  if (h < 0.0) {
    textureStore(lut, vec3<i32>(gid), vec4(0.0));
    return;
  }

  // Density at this point
  let densR = exp(-h / params.H_R);
  let densM = exp(-h / params.H_M);

  // Reconstruct direction vectors at this point.
  // Place the point at (0, r, 0) in a local frame:
  //   up = (0, 1, 0) — radial direction
  //   mu_v = cos(viewZenith) = dot(viewDir, up)
  //   mu_s = cos(sunZenith)  = dot(sunDir, up)
  //
  // For the coplanar (azimuth=0) approximation, both view and sun lie in the XZ-plane.
  let sin_v = sqrt(max(1.0 - mu_v * mu_v, 0.0));
  let sin_s = sqrt(max(1.0 - mu_s * mu_s, 0.0));

  let viewDir = vec3(sin_v, mu_v, 0.0);
  let sunDir  = vec3(sin_s, mu_s, 0.0);

  let pos = vec3(0.0, r, 0.0);

  // Shadow ray: integrate optical depth toward the sun
  let sunHit  = intersect_sphere(pos, sunDir, params.atmosphereRadius);
  let sunDist = max(sunHit.y, 1e-6);

  let lightStep = sunDist / f32(params.numLightSamples);
  var odR : f32 = 0.0;
  var odM : f32 = 0.0;

  var lp = pos + sunDir * (lightStep * 0.5);
  for (var li = 0u; li < params.numLightSamples; li++) {
    // Planet occlusion: if the sample point is inside the planet, fully occluded
    if (length(lp) < params.planetRadius) {
      odR = 1e9; // effectively zero transmittance
      odM = 1e9;
      break;
    }
    let lh = max(length(lp) - params.planetRadius, 0.0);
    odR += exp(-lh / params.H_R) * lightStep;
    odM += exp(-lh / params.H_M) * lightStep;
    lp  += sunDir * lightStep;
  }

  // Sun transmittance to this point
  let sunT = exp(-(params.betaR * odR + vec3(params.betaM * odM)));

  // Phase functions at scattering angle (coplanar approximation)
  let cosTheta = mu_v * mu_s + sin_v * sin_s;
  let phaseR   = rayleigh_phase(cosTheta);
  let phaseM   = mie_phase(cosTheta, params.mieG);

  // Inscattered radiance per unit length at this (r, mu_s, mu_v)
  let scatter = (densR * params.betaR * phaseR + vec3(densM * params.betaM * phaseM)) * sunT;

  textureStore(lut, vec3<i32>(gid), vec4(scatter, 0.0));
}
