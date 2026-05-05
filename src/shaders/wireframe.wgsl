const PI          : f32 = 3.14159265358979323846;
const TERRAIN_RES : u32 = 512u;

override rings    : u32 = 128u;
override segments : u32 = 128u;

struct Uniforms {
  viewProj       : mat4x4<f32>,
  model          : mat4x4<f32>,
  displace_scale : f32,
  _pad0          : f32,
  _pad1          : f32,
  _pad2          : f32,
  sunDir         : vec3<f32>,
  _pad3          : f32,
}

@group(0) @binding(0) var<uniform>       uniforms      : Uniforms;
@group(0) @binding(1) var<storage, read> height_buffer : array<f32>;

struct WireVertexOut {
  @builtin(position) clipPosition : vec4<f32>,
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

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> WireVertexOut {
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
  let displaced = localPos * (1.0 + h * uniforms.displace_scale);

  let worldPos = (uniforms.model * vec4<f32>(displaced, 1.0)).xyz;
  var out: WireVertexOut;
  out.clipPosition = uniforms.viewProj * vec4<f32>(worldPos, 1.0);
  // z-bias: pull wireframe toward camera to avoid z-fighting with the sphere surface
  out.clipPosition.z -= 0.001 * out.clipPosition.w;
  return out;
}

@fragment
fn fs_main(_in: WireVertexOut) -> @location(0) vec4<f32> {
  return vec4<f32>(0.45, 1.0, 0.45, 1.0);
}
