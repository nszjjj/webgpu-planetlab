// src/shaders/atmosphere.wgsl
// Nishita (1993) single-scattering atmosphere.
// Planet is centered at world origin. Planet radius = 1.0 scene unit.

const PI  : f32 = 3.14159265358979323846;
const H_R : f32 = 0.025;   // Rayleigh scale height (fraction of planet radius)
const H_M : f32 = 0.008;   // Mie scale height
const SCATTER_SCALE : f32 = 5.0;   // artistic scale; tune if atmosphere is too faint/bright

struct AtmosphereUniforms {
  sunDir           : vec3<f32>,   // offset  0
  planetRadius     : f32,         // offset 12
  atmosphereRadius : f32,         // offset 16
  _pad0            : f32,         // offset 20
  _pad1            : f32,         // offset 24
  _pad2            : f32,         // offset 28
  cameraPos        : vec3<f32>,   // offset 32
  _pad3            : f32,         // offset 44
  betaR            : vec3<f32>,   // offset 48
  betaM            : f32,         // offset 60
  mieG             : f32,         // offset 64
  numSamples       : u32,         // offset 68
  numLightSamples  : u32,         // offset 72
  _pad4            : f32,         // offset 76
  invViewProj      : mat4x4<f32>, // offset 80
}

@group(0) @binding(0) var<uniform> atm        : AtmosphereUniforms;
@group(0) @binding(1) var          sceneColor : texture_2d<f32>;
@group(0) @binding(2) var          sceneDepth : texture_depth_2d;

// --- Vertex shader: full-screen quad (6 vertices, no VBO) ---

const QUAD_POS = array<vec2<f32>, 6>(
  vec2(-1.0, -1.0), vec2( 1.0, -1.0), vec2(-1.0,  1.0),
  vec2( 1.0, -1.0), vec2( 1.0,  1.0), vec2(-1.0,  1.0),
);

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0)       uv  : vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  let p = QUAD_POS[vi];
  var out: VSOut;
  out.pos = vec4<f32>(p, 0.0, 1.0);
  out.uv  = p * vec2(0.5, -0.5) + vec2(0.5); // NDC→UV: x:[−1,1]→[0,1], y flipped
  return out;
}

// --- Helper functions ---

// Analytic ray-sphere intersection. Sphere centered at origin.
// Returns vec2(tNear, tFar). Returns vec2(-1.0) on miss or behind camera.
fn intersect_sphere(orig: vec3<f32>, dir: vec3<f32>, r: f32) -> vec2<f32> {
  let b    = dot(orig, dir);
  let c    = dot(orig, orig) - r * r;
  let disc = b * b - c;
  if (disc < 0.0) { return vec2(-1.0); }
  let s = sqrt(disc);
  return vec2(-b - s, -b + s);
}

fn rayleigh_phase(cosTheta: f32) -> f32 {
  return (3.0 / (16.0 * PI)) * (1.0 + cosTheta * cosTheta);
}

fn mie_phase(cosTheta: f32, g: f32) -> f32 {
  let g2    = g * g;
  let denom = max((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5), 1e-7);
  return (3.0 / (8.0 * PI)) * ((1.0 - g2) * (1.0 + cosTheta * cosTheta)) / denom;
}

// Integrate optical depth from `pos` toward `dir` for `maxDist` distance.
// Returns vec2(Rayleigh depth, Mie depth).
fn optical_depth(pos: vec3<f32>, dir: vec3<f32>, maxDist: f32, steps: u32) -> vec2<f32> {
  let stepLen = maxDist / f32(steps);
  var depth   = vec2(0.0);
  var p       = pos + dir * (stepLen * 0.5);
  for (var i = 0u; i < steps; i++) {
    let h = max(length(p) - atm.planetRadius, 0.0);
    depth += vec2(exp(-h / H_R), exp(-h / H_M)) * stepLen;
    p     += dir * stepLen;
  }
  return depth;
}

// --- Fragment shader ---

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let texel = vec2<i32>(floor(in.pos.xy));
  let depth = textureLoad(sceneDepth, texel, 0);
  let color = textureLoad(sceneColor, texel, 0).rgb;
  let isSky = depth >= 0.9999;

  // Reconstruct world position from depth
  let ndcX     = in.uv.x * 2.0 - 1.0;
  let ndcY     = 1.0 - in.uv.y * 2.0;
  let clipPos4 = atm.invViewProj * vec4<f32>(ndcX, ndcY, depth, 1.0);
  let worldPos = clipPos4.xyz / clipPos4.w;

  let camPos = atm.cameraPos;
  let rayDir = normalize(worldPos - camPos);

  // Atmosphere intersection
  let atmHit = intersect_sphere(camPos, rayDir, atm.atmosphereRadius);
  if (atmHit.y < 0.0) {
    // Ray entirely misses atmosphere
    return vec4<f32>(color, 1.0);
  }

  let tMin = max(atmHit.x, 0.0);
  var tMax = atmHit.y;
  if (!isSky) {
    tMax = min(tMax, length(worldPos - camPos));
  }
  if (tMin >= tMax) {
    return vec4<f32>(color, 1.0);
  }

  let cosTheta = dot(rayDir, atm.sunDir);
  let phaseR   = rayleigh_phase(cosTheta);
  let phaseM   = mie_phase(cosTheta, atm.mieG);

  let stepLen   = (tMax - tMin) / f32(atm.numSamples);
  var sumR      = vec3(0.0);
  var sumM      = 0.0;
  var optDepthR = 0.0;
  var optDepthM = 0.0;

  var t = tMin + stepLen * 0.5;
  for (var i = 0u; i < atm.numSamples; i++) {
    let p  = camPos + rayDir * t;
    let h  = max(length(p) - atm.planetRadius, 0.0);

    let densR = exp(-h / H_R) * stepLen;
    let densM = exp(-h / H_M) * stepLen;

    // Shadow test: is this point occluded from the sun by the planet body?
    let planetOcclude = intersect_sphere(p, atm.sunDir, atm.planetRadius);
    let in_shadow     = planetOcclude.x > 0.0; // planet is ahead on sun ray

    if (!in_shadow) {
      // Shadow ray toward sun — only when sun is visible from this point
      let sunHit  = intersect_sphere(p, atm.sunDir, atm.atmosphereRadius);
      let sunDist = max(sunHit.y, 0.0);
      let odSun   = optical_depth(p, atm.sunDir, sunDist, atm.numLightSamples);

      // Transmittance uses depth from tMin to entry of this segment (before adding densR/M)
      let tau           = atm.betaR * (optDepthR + odSun.x)
                        + vec3<f32>(atm.betaM * (optDepthM + odSun.y));
      let transmittance = exp(-tau);

      sumR += densR * transmittance;
      sumM += densM * dot(transmittance, vec3<f32>(1.0 / 3.0)); // average over RGB
    }

    optDepthR += densR;
    optDepthM += densM;

    t += stepLen;
  }

  let rayleigh   = sumR * atm.betaR * phaseR;
  let mie_color  = vec3<f32>(sumM * atm.betaM * phaseM);
  let inScatter  = (rayleigh + mie_color) * SCATTER_SCALE;
  let viewTau    = atm.betaR * optDepthR + vec3<f32>(atm.betaM * optDepthM);
  let viewT      = exp(-viewTau);
  let finalColor = color * viewT + inScatter;

  return vec4<f32>(finalColor, 1.0);
}
