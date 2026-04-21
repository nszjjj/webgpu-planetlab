// Planet render shader — vertex displacement via height_buffer, fragment color via splat_buffer.
// Uniform layout: viewProj(64) + model(64) + displace_scale(4) + pad×3(12) + sunDir(12) + pad(4) = 160 bytes.

const PI              : f32 = 3.14159265358979323846;
const TERRAIN_RES     : u32 = 512u;
const AMBIENT         : f32 = 0.30;  // minimum light on dark side

override rings    : u32 = 128u;
override segments : u32 = 128u;

struct Uniforms {
  viewProj       : mat4x4<f32>,   // offset   0
  model          : mat4x4<f32>,   // offset  64
  displace_scale : f32,           // offset 128
  _pad0          : f32,           // offset 132
  _pad1          : f32,           // offset 136
  _pad2          : f32,           // offset 140
  sunDir         : vec3<f32>,     // offset 144  (vec3 align=16, 144/16=9 ✓)
  _pad3          : f32,           // offset 156
}

@group(0) @binding(0) var<uniform>       uniforms      : Uniforms;
@group(0) @binding(1) var<storage, read> height_buffer : array<f32>;
@group(0) @binding(2) var<storage, read> splat_buffer  : array<u32>;

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
  return vec3<f32>(0.10, 0.25, 0.60);                                       // water
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

  // Displace vertex outward by height
  let h         = height_buffer[sphere_pos_to_index(localPos)];
  let displaced = localPos * (1.0 + h * uniforms.displace_scale);

  // Normal computed from original (un-displaced) sphere position
  let worldNormal = normalize((uniforms.model * vec4<f32>(localPos, 0.0)).xyz);
  let worldPos    = (uniforms.model * vec4<f32>(displaced, 1.0)).xyz;

  var out: VertexOut;
  out.clipPosition = uniforms.viewProj * vec4<f32>(worldPos, 1.0);
  out.normal       = worldNormal;
  out.spherePos    = localPos;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let mask   = splat_buffer[sphere_pos_to_index(in.spherePos)];
  let albedo = splat_to_color(mask);

  // Lambert diffuse with ambient floor
  let NdotL   = max(dot(normalize(in.normal), normalize(uniforms.sunDir)), 0.0);
  let diffuse = AMBIENT + (1.0 - AMBIENT) * NdotL;

  return vec4<f32>(albedo * diffuse, 1.0);
}
