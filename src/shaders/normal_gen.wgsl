// src/shaders/normal_gen.wgsl
// Compute shader: height_buffer → normal_buffer via central differences.
// One thread per texel, 512×512 dispatch, runs once.

const OCTA_RES: u32 = 512u;

struct DisplaceParams {
  scale : f32,
  _pad0 : f32,
  _pad1 : f32,
  _pad2 : f32,
}

@group(0) @binding(0) var<uniform>                  displace_params : DisplaceParams;
@group(0) @binding(1) var<storage, read>            height_buffer   : array<f32>;
@group(0) @binding(2) var<storage, read_write>      normal_buffer   : array<f32>;

fn oct_decode(uv: vec2<f32>) -> vec3<f32> {
  let p = uv * 2.0 - 1.0;
  let z = 1.0 - abs(p.x) - abs(p.y);
  var n: vec3<f32>;
  if (z >= 0.0) {
    n = vec3<f32>(p.x, p.y, z);
  } else {
    n = vec3<f32>(
      (1.0 - abs(p.y)) * select(-1.0, 1.0, p.x >= 0.0),
      (1.0 - abs(p.x)) * select(-1.0, 1.0, p.y >= 0.0),
      z,
    );
  }
  return normalize(n);
}

fn get_height(i: u32, j: u32) -> f32 {
  return height_buffer[i * OCTA_RES + j];
}

fn uv_at(i: u32, j: u32) -> vec2<f32> {
  return vec2<f32>((f32(j) + 0.5) / f32(OCTA_RES), (f32(i) + 0.5) / f32(OCTA_RES));
}

fn displaced_position(i: u32, j: u32, d: f32) -> vec3<f32> {
  let s = oct_decode(uv_at(i, j));
  let h = get_height(i, j);
  return s * (1.0 + h * d);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= OCTA_RES || gid.y >= OCTA_RES) { return; }

  let i = gid.x;
  let j = gid.y;
  let d = displace_params.scale;

  let i_left  = select(i - 1u, 0u, i == 0u);
  let i_right = select(i + 1u, OCTA_RES - 1u, i == OCTA_RES - 1u);
  let j_down  = select(j - 1u, 0u, j == 0u);
  let j_up    = select(j + 1u, OCTA_RES - 1u, j == OCTA_RES - 1u);

  let p_left  = displaced_position(i_left,  j,       d);
  let p_right = displaced_position(i_right, j,       d);
  let p_down  = displaced_position(i,       j_down,  d);
  let p_up    = displaced_position(i,       j_up,    d);

  let n = normalize(cross(p_right - p_left, p_up - p_down));

  let idx = (i * OCTA_RES + j) * 3u;
  normal_buffer[idx]     = n.x;
  normal_buffer[idx + 1u] = n.y;
  normal_buffer[idx + 2u] = n.z;
}
