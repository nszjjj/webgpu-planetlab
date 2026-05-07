// Planet render shader — vertex displacement via height_buffer, PBR fragment.
// Uniform layout: PerFrame 208 bytes + MaterialUniforms 160 bytes.

const PI              : f32 = 3.14159265358979323846;
const TERRAIN_RES     : u32 = 512u;
const AMBIENT         : f32 = 0.03;  // minimum light on dark side

// ── BRDF Microfacet Functions ──────────────────────────────────────────────

fn DistributionGGX(N: vec3f, H: vec3f, roughness: f32) -> f32 {
  let a      = roughness * roughness;
  let a2     = a * a;
  let NdotH  = max(dot(N, H), 0.0);
  let denom  = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / (PI * denom * denom);
}

fn GeometrySchlickGGX(NdotV: f32, roughness: f32) -> f32 {
  let k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
  return NdotV / (NdotV * (1.0 - k) + k);
}

fn GeometrySmith(N: vec3f, V: vec3f, L: vec3f, roughness: f32) -> f32 {
  return GeometrySchlickGGX(max(dot(N, V), 0.0), roughness)
       * GeometrySchlickGGX(max(dot(N, L), 0.0), roughness);
}

fn fresnelSchlick(cosTheta: f32, F0: vec3f) -> vec3f {
  return F0 + (vec3(1.0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// ── Cook-Torrance BRDF ─────────────────────────────────────────────────────

fn cookTorranceBRDF(
  N: vec3f, V: vec3f, L: vec3f,
  albedo: vec3f, metallic: f32, roughness: f32,
) -> vec3f {
  let H = normalize(V + L);

  let F0 = mix(vec3(0.04), albedo, metallic);

  let NDF = DistributionGGX(N, H, roughness);
  let G   = GeometrySmith(N, V, L, roughness);
  let F   = fresnelSchlick(max(dot(H, V), 0.0), F0);

  let numerator    = NDF * G * F;
  let NdotL        = max(dot(N, L), 0.0);
  let NdotV        = max(dot(N, V), 0.0);
  let denominator  = max(4.0 * NdotV * NdotL, 0.001);

  let specular = numerator / denominator;

  let kD = (vec3(1.0) - F) * (1.0 - metallic);
  return kD * albedo / PI + specular;
}

// ── Direct Lighting ────────────────────────────────────────────────────────

fn directLight(
  N: vec3f, V: vec3f, L: vec3f,
  albedo: vec3f, metallic: f32, roughness: f32,
  lightColor: vec3f, lightIntensity: f32,
) -> vec3f {
  let NdotL  = max(dot(N, L), 0.0);
  let radiance = lightColor * lightIntensity;
  return cookTorranceBRDF(N, V, L, albedo, metallic, roughness) * radiance * NdotL;
}

// ── Tone Mapping ───────────────────────────────────────────────────────────

fn tonemapReinhard(color: vec3f) -> vec3f {
  return color / (color + vec3(1.0));
}

override rings    : u32 = 128u;
override segments : u32 = 128u;

struct PerFrameUniforms {
  viewProj       : mat4x4<f32>,   // offset   0
  model          : mat4x4<f32>,   // offset  64
  displaceScale  : f32,           // offset 128
  _pad0          : f32,           // offset 132
  _pad1          : f32,           // offset 136
  _pad2          : f32,           // offset 140
  sunDir         : vec3<f32>,     // offset 144  (align 16, 144/16=9 ✓)
  _pad3          : f32,           // offset 156
  cameraPos      : vec3<f32>,     // offset 160  (align 16, 160/16=10 ✓)
  _pad4          : f32,           // offset 172
  lightColor     : vec3<f32>,     // offset 176  (align 16, 176/16=11 ✓)
  lightIntensity : f32,           // offset 188
  _pad5          : f32,           // offset 192
  _pad6          : f32,           // offset 196
  _pad7          : f32,           // offset 200  (struct padded to 208 for 16-byte alignment)
  _pad8          : f32,           // offset 204
}

struct MaterialUniforms {
  waterRoughness : f32,           // offset   0
  waterMetallic  : f32,           // offset   4
  _mPad0         : vec2<f32>,     // offset   8
  sandRoughness  : f32,           // offset  16
  sandMetallic   : f32,           // offset  20
  _mPad1         : vec2<f32>,     // offset  24
  grassRoughness : f32,           // offset  32
  grassMetallic  : f32,           // offset  36
  _mPad2         : vec2<f32>,     // offset  40
  rockRoughness  : f32,           // offset  48
  rockMetallic   : f32,           // offset  52
  _mPad3         : vec2<f32>,     // offset  56
  snowRoughness  : f32,           // offset  64
  snowMetallic   : f32,           // offset  68
  _mPad4         : vec2<f32>,     // offset  72
  // Reserved slots 5-9 (80-160 bytes)
  _reserved0     : vec4<f32>,     // offset  80
  _reserved1     : vec4<f32>,     // offset  96
  _reserved2     : vec4<f32>,     // offset 112
  _reserved3     : vec4<f32>,     // offset 128
  _reserved4     : vec4<f32>,     // offset 144
}

@group(0) @binding(0) var<uniform>       perFrame      : PerFrameUniforms;
@group(0) @binding(1) var<storage, read> height_buffer : array<f32>;
@group(0) @binding(2) var<storage, read> splat_buffer  : array<u32>;
@group(0) @binding(3) var<uniform>       materials     : MaterialUniforms;

struct MaterialParam {
  roughness : f32,
  metallic  : f32,
}

struct VertexOut {
  @builtin(position) clipPosition : vec4<f32>,
  @location(0)       normal       : vec3<f32>,
  @location(1)       spherePos    : vec3<f32>,  // original unit-sphere pos for terrain lookup
}

fn sphere_pos_to_index(p: vec3<f32>) -> u32 {
  let n     = normalize(p);
  let theta = acos(clamp(n.y, -1.0, 1.0));
  var phi   = atan2(n.z, n.x);
  if (phi < 0.0) { phi += 2.0 * PI; }
  let i = u32(clamp(theta / PI * f32(TERRAIN_RES - 1u), 0.0, f32(TERRAIN_RES - 1u)));
  let j = u32(clamp(phi / (2.0 * PI) * f32(TERRAIN_RES - 1u), 0.0, f32(TERRAIN_RES - 1u)));
  return i * TERRAIN_RES + j;
}

fn splat_to_color(mask: u32) -> vec3<f32> {
  if ((mask & (1u << 4u)) != 0u) { return vec3<f32>(0.90, 0.92, 0.95); } // snow
  if ((mask & (1u << 3u)) != 0u) { return vec3<f32>(0.45, 0.40, 0.35); } // rock
  if ((mask & (1u << 2u)) != 0u) { return vec3<f32>(0.25, 0.55, 0.20); } // grass
  if ((mask & (1u << 1u)) != 0u) { return vec3<f32>(0.76, 0.70, 0.50); } // sand
  return vec3<f32>(0.10, 0.25, 0.60);                                      // water
}

fn splat_to_material(mask: u32) -> MaterialParam {
  // Priority: snow > rock > grass > sand > water (matches splat_to_color)
  if ((mask & (1u << 4u)) != 0u) { return MaterialParam(materials.snowRoughness,  materials.snowMetallic);  }
  if ((mask & (1u << 3u)) != 0u) { return MaterialParam(materials.rockRoughness,  materials.rockMetallic);  }
  if ((mask & (1u << 2u)) != 0u) { return MaterialParam(materials.grassRoughness, materials.grassMetallic); }
  if ((mask & (1u << 1u)) != 0u) { return MaterialParam(materials.sandRoughness,  materials.sandMetallic);  }
  return MaterialParam(materials.waterRoughness, materials.waterMetallic);
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  let cols = segments + 1u;
  let i    = vertexIndex / cols;
  let j    = vertexIndex % cols;

  let theta = f32(i) / f32(rings)    * PI;
  let phi   = f32(j) / f32(segments) * 2.0 * PI;

  let localPos = vec3<f32>(
    sin(theta) * cos(phi),
    cos(theta),
    sin(theta) * sin(phi),
  );

  let h         = height_buffer[sphere_pos_to_index(localPos)];
  let displaced = localPos * (1.0 + h * perFrame.displaceScale);

  let worldNormal = normalize((perFrame.model * vec4<f32>(localPos, 0.0)).xyz);
  let worldPos    = (perFrame.model * vec4<f32>(displaced, 1.0)).xyz;

  var out: VertexOut;
  out.clipPosition = perFrame.viewProj * vec4<f32>(worldPos, 1.0);
  out.normal       = worldNormal;
  out.spherePos    = localPos;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let mask   = splat_buffer[sphere_pos_to_index(in.spherePos)];
  let albedo = splat_to_color(mask);
  let mat    = splat_to_material(mask);

  let N = normalize(in.normal);
  let V = normalize(perFrame.cameraPos - (perFrame.model * vec4<f32>(in.spherePos, 1.0)).xyz);
  let L = normalize(perFrame.sunDir.xyz);

  // Cook-Torrance direct lighting
  let pbrColor = directLight(
    N, V, L,
    albedo, mat.metallic, mat.roughness,
    perFrame.lightColor, perFrame.lightIntensity,
  );

  // Ambient fill for dark side
  let ambient = albedo * AMBIENT;
  let color   = pbrColor + ambient;

  // Tone map to avoid hard clipping in unorm RT
  let tonemapped = tonemapReinhard(color);

  return vec4<f32>(tonemapped, 1.0);
}
