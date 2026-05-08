// src/shaders/cloud_coverage.wgsl
// Compute pass: write FBM cloud coverage into a flat float32 storage buffer.
// Buffer layout: cov[v * OCTA_RES + u] = density in [0, 1] via octahedral mapping.

struct CoverageUniforms {
  time      : f32,  // FBM time offset for drift animation
  frequency : f32,  // noise frequency
  threshold : f32,  // density below threshold = 0
  _pad      : f32,
}

@group(0) @binding(0) var<uniform>             u   : CoverageUniforms;
@group(0) @binding(1) var<storage, read_write> cov : array<f32>;

const OCTA_RES : u32 = 256u;
const PI       : f32 = 3.14159265358979;

fn hash3(p: vec3<f32>) -> f32 {
  var q = fract(p * 0.1031);
  q += dot(q, q.zyx + 31.32);
  return fract((q.x + q.y) * q.z);
}

fn noise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i),               hash3(i + vec3(1,0,0)), s.x),
        mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), s.x), s.y),
    mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), s.x),
        mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), s.x), s.y),
    s.z);
}

fn fbm5(p: vec3<f32>, freq: f32) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var f = freq;
  for (var i = 0; i < 5; i++) {
    v += a * noise3(p * f);
    a *= 0.5;
    f *= 2.0;
  }
  return v;
}

fn oct_decode(uv: vec2<f32>) -> vec3<f32> {
  let p = uv * 2.0 - 1.0;
  let z = 1.0 - abs(p.x) - abs(p.y);
  var n: vec3<f32>;
  if (z >= 0.0) {
    n = vec3<f32>(p.x, p.y, z);
  } else {
    n = vec3<f32>((1.0 - abs(p.y)) * select(-1.0, 1.0, p.x >= 0.0), (1.0 - abs(p.x)) * select(-1.0, 1.0, p.y >= 0.0), z);
  }
  return normalize(n);
}

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= OCTA_RES || gid.y >= OCTA_RES) { return; }

  let uv  = vec2<f32>((f32(gid.x) + 0.5) / f32(OCTA_RES), (f32(gid.y) + 0.5) / f32(OCTA_RES));
  let sph = oct_decode(uv);

  let raw     = fbm5(sph + u.time * 0.05, u.frequency);
  let density = clamp((raw - u.threshold) / max(1.0 - u.threshold, 1e-5), 0.0, 1.0);

  cov[gid.y * OCTA_RES + gid.x] = density;
}
