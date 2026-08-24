// src/shaders/atmosphere.wgsl
// Nishita (1993) single-scattering atmosphere.
// Planet is centered at world origin. Planet radius = 1.0 scene unit.

const PI           : f32 = 3.14159265358979323846;
const SCATTER_SCALE: f32 = 6.0;  // artistic boost — matches old per-pixel raymarch scale

struct AtmosphereUniforms {
  sunDir           : vec3<f32>,   // offset  0
  planetRadius     : f32,         // offset 12
  atmosphereRadius : f32,         // offset 16
  H_R              : f32,         // offset 20  ← was _pad0
  H_M              : f32,         // offset 24  ← was _pad1
  _pad2            : f32,         // offset 28  (pad before cameraPos vec3)
  cameraPos        : vec3<f32>,   // offset 32
  _pad3            : f32,         // offset 44  (pad after cameraPos vec3)
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
@group(0) @binding(3) var          cloudColor : texture_2d<f32>;
@group(0) @binding(4) var          lutTex    : texture_3d<f32>;

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

const DEPTH_SIGMA : f32 = 10.0;  // weight decay per NDC depth unit; tune if cloud edges bleed across depth discontinuities

// Bilateral upsample: 2×2 cloud texels weighted by depth similarity.
// centerDepth is sampled directly from texel to avoid half-res coordinate truncation mismatches.
fn bilateral_cloud(texel: vec2<i32>, cloudTexel: vec2<i32>) -> vec4<f32> {
  let centerDepth = textureLoad(sceneDepth, texel, 0);
  let maxCoord    = vec2<i32>(textureDimensions(cloudColor)) - vec2<i32>(1, 1);
  var weightSum   = 0.0;
  var result      = vec4(0.0);
  for (var dy = 0; dy <= 1; dy++) {
    for (var dx = 0; dx <= 1; dx++) {
      let nc = clamp(cloudTexel + vec2<i32>(dx, dy), vec2<i32>(0, 0), maxCoord);
      let d  = textureLoad(sceneDepth, nc * 2, 0);
      let w  = exp(-abs(d - centerDepth) * DEPTH_SIGMA);
      result   += w * textureLoad(cloudColor, nc, 0);
      weightSum += w;
    }
  }
  return result / max(weightSum, 1e-6);
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

  let viewSamples = 16u;
  let stepLen   = (tMax - tMin) / f32(viewSamples);
  let atmHeight = atm.atmosphereRadius - atm.planetRadius;

  var accum = vec3(0.0);
  var odR   = 0.0;
  var odM   = 0.0;

  var t = tMin + stepLen * 0.5;
  for (var i = 0u; i < viewSamples; i++) {
    let p = camPos + rayDir * t;
    let h = max(length(p) - atm.planetRadius, 0.0);

    let densR = exp(-h / atm.H_R);
    let densM = exp(-h / atm.H_M);

    // Sample LUT with trilinear interpolation (textureLoad avoids non-uniform CF restriction)
    let r_norm = clamp(h / atmHeight, 0.0, 1.0);
    let mu_s   = dot(normalize(p), atm.sunDir);
    let mu_v   = dot(rayDir, normalize(p));

    let uv_mu_v = mu_v * 0.5 + 0.5;
    let uv_mu_s = mu_s * 0.5 + 0.5;

    let dims = vec3<f32>(textureDimensions(lutTex));
    let tc   = vec3<f32>(uv_mu_v, uv_mu_s, r_norm) * dims - 0.5;
    let base = vec3<i32>(floor(tc));
    let frac = tc - vec3<f32>(base);
    let bc   = clamp(base, vec3<i32>(0), vec3<i32>(dims) - vec3<i32>(2));

    let c000 = textureLoad(lutTex, bc + vec3<i32>(0,0,0), 0);
    let c100 = textureLoad(lutTex, bc + vec3<i32>(1,0,0), 0);
    let c010 = textureLoad(lutTex, bc + vec3<i32>(0,1,0), 0);
    let c110 = textureLoad(lutTex, bc + vec3<i32>(1,1,0), 0);
    let c001 = textureLoad(lutTex, bc + vec3<i32>(0,0,1), 0);
    let c101 = textureLoad(lutTex, bc + vec3<i32>(1,0,1), 0);
    let c011 = textureLoad(lutTex, bc + vec3<i32>(0,1,1), 0);
    let c111 = textureLoad(lutTex, bc + vec3<i32>(1,1,1), 0);

    let c00 = mix(c000, c100, frac.x);
    let c01 = mix(c001, c101, frac.x);
    let c10 = mix(c010, c110, frac.x);
    let c11 = mix(c011, c111, frac.x);
    let c0  = mix(c00, c10, frac.y);
    let c1  = mix(c01, c11, frac.y);
    let lutVal = mix(c0, c1, frac.z);

    let stepScatter = lutVal.rgb * stepLen;

    let viewT = exp(-(atm.betaR * odR + vec3(atm.betaM * odM)));
    accum   += viewT * stepScatter;

    odR += densR * stepLen;
    odM += densM * stepLen;

    t += stepLen;
  }

  let viewTau    = atm.betaR * odR + vec3(atm.betaM * odM);
  let viewT      = exp(-viewTau);
  let finalColor = color * viewT + accum * SCATTER_SCALE;

  // Bilateral upsample cloud RT and composite on top of atmosphere
  let cloudTexel = texel / 2;
  let cloud      = bilateral_cloud(texel, cloudTexel);
  let composite  = cloud.rgb + finalColor * cloud.a;
  return vec4<f32>(composite, 1.0);
}
