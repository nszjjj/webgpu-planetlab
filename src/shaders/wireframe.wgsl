const PI       : f32 = 3.14159265358979323846;
const OCTA_RES  : u32 = 512u;

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

struct VertexInput {
  @location(0) position : vec3<f32>,
}

struct WireVertexOut {
  @builtin(position) clipPosition : vec4<f32>,
}

fn oct_encode(n: vec3<f32>) -> vec2<f32> {
  let absSum = abs(n.x) + abs(n.y) + abs(n.z);
  var p = vec2<f32>(n.x, n.y) / absSum;
  if (n.z < 0.0) {
    p = (vec2<f32>(1.0) - abs(p.yx)) * select(vec2(-1.0), vec2(1.0), p >= vec2(0.0));
  }
  return p * 0.5 + 0.5;
}

fn oct_to_index(n: vec3<f32>) -> u32 {
  let uv = oct_encode(normalize(n));
  let i  = u32(clamp(uv.y * f32(OCTA_RES), 0.0, f32(OCTA_RES - 1u)));
  let j  = u32(clamp(uv.x * f32(OCTA_RES), 0.0, f32(OCTA_RES - 1u)));
  return i * OCTA_RES + j;
}

@vertex
fn vs_main(in: VertexInput) -> WireVertexOut {
  let localPos = in.position;

  let h         = height_buffer[oct_to_index(localPos)];
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
