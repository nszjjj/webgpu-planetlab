// src/shaders/cloud_render.wgsl
// Half-resolution fragment pass: ray-march spherical cloud shell.
// Outputs rgba16float: RGB = in-scatter colour, A = transmittance (1 = clear, 0 = opaque).

const PI                 : f32 = 3.14159265358979;
const OCTA_RES           : u32 = 256u;
const CLOUD_SCATTER_SCALE: f32 = 15.0;  // artistic multiplier; compensates for single-scatter-only model (no multiple-scatter) and matches atmosphere SCATTER_SCALE range

// Uniform buffer layout: 128 bytes
struct CloudUniforms {
  invViewProj      : mat4x4<f32>,  // offset   0 (64 bytes)
  cameraPos        : vec3<f32>,    // offset  64 (12 bytes)
  planetRadius     : f32,          // offset  76
  sunDir           : vec3<f32>,    // offset  80 (12 bytes)
  cloudInnerRadius : f32,          // offset  92
  cloudOuterRadius : f32,          // offset  96
  extinction       : f32,          // offset 100
  scatterAlbedo    : f32,          // offset 104
  mieG             : f32,          // offset 108
  scaleHeight      : f32,          // offset 112
  timeOffset       : f32,          // offset 116
  numSteps         : u32,          // offset 120
  _pad             : f32,          // offset 124
}

@group(0) @binding(0) var<uniform>           u        : CloudUniforms;
@group(0) @binding(1) var<storage, read>     coverage : array<f32>;
@group(0) @binding(2) var                    depthTex : texture_depth_2d;

// --- Vertex shader: full-screen quad (6 vertices, no VBO) ---

const QUAD_POS = array<vec2<f32>, 6>(
  vec2(-1.0,-1.0), vec2(1.0,-1.0), vec2(-1.0,1.0),
  vec2(1.0,-1.0),  vec2(1.0,1.0),  vec2(-1.0,1.0),
);

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0)       uv  : vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  let p = QUAD_POS[vi];
  return VSOut(vec4(p, 0.0, 1.0), p * vec2(0.5, -0.5) + 0.5);
}

// --- Helpers ---

fn intersect_sphere(orig: vec3<f32>, dir: vec3<f32>, r: f32) -> vec2<f32> {
  let b    = dot(orig, dir);
  let c    = dot(orig, orig) - r * r;
  let disc = b * b - c;
  if (disc < 0.0) { return vec2(-1.0); }
  let s = sqrt(disc);
  return vec2(-b - s, -b + s);
}

fn hg_phase(cosTheta: f32, g: f32) -> f32 {
  let g2    = g * g;
  let denom = max(pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5), 1e-7);
  return (1.0 - g2) / (4.0 * PI * denom);
}

fn oct_encode(n: vec3<f32>) -> vec2<f32> {
  let absSum = abs(n.x) + abs(n.y) + abs(n.z);
  var p = vec2<f32>(n.x, n.y) / absSum;
  if (n.z < 0.0) {
    p = (vec2<f32>(1.0) - abs(p.yx)) * select(vec2(-1.0), vec2(1.0), p >= vec2(0.0));
  }
  return p * 0.5 + 0.5;
}

// Nearest-neighbour lookup into the flat octahedral coverage buffer.
fn coverage_sample(spherePos: vec3<f32>) -> f32 {
  let uv = oct_encode(normalize(spherePos));
  let iu = u32(clamp(uv.x * f32(OCTA_RES), 0.0, f32(OCTA_RES) - 1.0));
  let iv = u32(clamp(uv.y * f32(OCTA_RES), 0.0, f32(OCTA_RES) - 1.0));
  return coverage[iv * OCTA_RES + iu];
}

// Hash-based step jitter — eliminates banding without a blue-noise texture.
// Replace with a blue-noise texture lookup once the PNG is supplied.
fn hash_jitter(px: u32, py: u32) -> f32 {
  var h = px * 1664525u + py * 214013u + 2531011u;
  h ^= h >> 16u;
  h *= 0x45d9f3bu;
  h ^= h >> 16u;
  return f32(h & 0xFFFFu) / 65536.0;
}

// --- Fragment shader ---

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // Cloud RT is half-resolution; map to full-res depth texel by ×2
  let texel     = vec2<i32>(floor(in.pos.xy));
  let fullTexel = texel * 2;
  let depth     = textureLoad(depthTex, fullTexel, 0);
  let isSky     = depth >= 0.9999;  // standard depth (clear=1.0, depthCompare='less')

  // Reconstruct world-space ray direction
  let ndcX     = in.uv.x * 2.0 - 1.0;
  let ndcY     = 1.0 - in.uv.y * 2.0;
  let clip4    = u.invViewProj * vec4(ndcX, ndcY, depth, 1.0);
  let worldPos = clip4.xyz / clip4.w;
  let camPos   = u.cameraPos;
  let rayDir   = normalize(worldPos - camPos);

  // Clip ray to the cloud shell interval
  let outerHit  = intersect_sphere(camPos, rayDir, u.cloudOuterRadius);
  if (outerHit.y < 0.0) { return vec4(0.0, 0.0, 0.0, 1.0); }  // miss: transmittance = 1

  let innerHit  = intersect_sphere(camPos, rayDir, u.cloudInnerRadius);
  let planetHit = intersect_sphere(camPos, rayDir, u.planetRadius);

  var tMin = max(outerHit.x, 0.0);
  var tMax = outerHit.y;
  if (innerHit.x > 0.0 && innerHit.x < tMax) { tMax = innerHit.x; }
  if (planetHit.x > 0.0 && planetHit.x < tMax) { tMax = planetHit.x; }
  if (!isSky) {
    let tDepth = length(worldPos - camPos);
    tMax = min(tMax, tDepth);
  }
  if (tMin >= tMax) { return vec4(0.0, 0.0, 0.0, 1.0); }

  let stepLen  = (tMax - tMin) / f32(u.numSteps);
  let jitter   = hash_jitter(u32(texel.x), u32(texel.y));
  let cosTheta = dot(rayDir, u.sunDir);
  let sunColor = vec3(1.0, 0.95, 0.85);

  var transmittance = 1.0;
  var inScatter     = vec3(0.0);

  var t = tMin + stepLen * jitter;
  for (var i = 0u; i < u.numSteps; i++) {
    let p = camPos + rayDir * t;
    let r = length(p);

    if (r >= u.cloudInnerRadius && r <= u.cloudOuterRadius) {
      let cov     = coverage_sample(p);
      let altFrac = (r - u.cloudInnerRadius) / (u.cloudOuterRadius - u.cloudInnerRadius);
      // optical depth for this step
      let tau     = cov * exp(-altFrac / u.scaleHeight) * stepLen * u.extinction;

      transmittance *= exp(-tau);

      // Planet occlusion test: skip in-scatter if planet body blocks sun
      let planetOcc = intersect_sphere(p, u.sunDir, u.planetRadius);
      if (planetOcc.x <= 0.0 && transmittance > 0.01) {
        let phaseHG  = hg_phase(cosTheta, u.mieG);
        // Blend HG with isotropic (1/(4π)) to approximate multiple-scatter brightness;
        // pure single-scatter HG at 90° gives ~0.032 vs isotropic ~0.08 — side-lit clouds would be nearly black otherwise.
        let phaseIso = 1.0 / (4.0 * PI);
        let phase    = mix(phaseHG, phaseIso, 0.5);
        inScatter   += transmittance * tau * u.scatterAlbedo * phase * CLOUD_SCATTER_SCALE * sunColor;
      }
    }

    t += stepLen;
    if (transmittance < 0.01) { break; }
  }

  return vec4(inScatter, transmittance);
}
