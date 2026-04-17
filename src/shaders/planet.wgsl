const PI: f32 = 3.14159265358979323846;

// Pipeline-overridable constants — set at pipeline creation from PlanetComponent
override rings: u32 = 64u;
override segments: u32 = 64u;

struct Uniforms {
  viewProj : mat4x4<f32>,
  model    : mat4x4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexOut {
  @builtin(position) clipPosition : vec4<f32>,
  @location(0)       normal       : vec3<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  let cols  = segments + 1u;
  let i     = vertexIndex / cols;
  let j     = vertexIndex % cols;

  let theta = f32(i) / f32(rings)    * PI;
  let phi   = f32(j) / f32(segments) * 2.0 * PI;

  // Unit sphere in local space — radius applied via model matrix scale
  let localPos = vec3<f32>(
    sin(theta) * cos(phi),
    cos(theta),
    sin(theta) * sin(phi),
  );

  let worldPos    = (uniforms.model * vec4<f32>(localPos, 1.0)).xyz;
  let worldNormal = normalize((uniforms.model * vec4<f32>(localPos, 0.0)).xyz);

  var out: VertexOut;
  out.clipPosition = uniforms.viewProj * vec4<f32>(worldPos, 1.0);
  out.normal       = worldNormal;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  // Normal visualization: map [-1,1] → [0,1]
  return vec4<f32>(in.normal * 0.5 + 0.5, 1.0);
}
