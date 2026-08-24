// Pass A: FBM + Ridged + Worley noise → terrain.height storage buffer
// Indexed by (i=v-row, j=u-col) via octahedral mapping.

const PI        : f32 = 3.14159265358979323846;
const OCTA_RES  : u32 = 512u;

struct NoiseParams {
  continent_freq        : f32,
  continent_persistence : f32,
  mountain_freq         : f32,
  detail_freq           : f32,
}

@group(0) @binding(0) var<uniform>             params        : NoiseParams;
@group(0) @binding(1) var<storage, read_write> height_buffer : array<f32>;

// ── Value noise helpers ───────────────────────────────────────────────────────

fn hash(p: f32) -> f32 {
  return fract(sin(p) * 43758.5453123);
}

fn noise3(p: vec3<f32>) -> f32 {
  let ip = floor(p);
  let fp = fract(p);
  let u  = fp * fp * (3.0 - 2.0 * fp);
  let n  = ip.x + ip.y * 157.0 + ip.z * 113.0;
  return mix(
    mix(mix(hash(n +   0.0), hash(n +   1.0), u.x),
        mix(hash(n + 157.0), hash(n + 158.0), u.x), u.y),
    mix(mix(hash(n + 113.0), hash(n + 114.0), u.x),
        mix(hash(n + 270.0), hash(n + 271.0), u.x), u.y),
    u.z,
  );
}

// ── Noise stack ───────────────────────────────────────────────────────────────

fn fbm(p: vec3<f32>, freq: f32, octaves: i32, persistence: f32) -> f32 {
  var value          = 0.0;
  var amplitude      = 1.0;
  var total_amplitude = 0.0;
  var f              = freq;
  for (var i = 0; i < octaves; i++) {
    value           += noise3(p * f) * amplitude;
    total_amplitude += amplitude;
    amplitude       *= persistence;
    f               *= 2.0;
  }
  return value / total_amplitude;
}

fn ridged(p: vec3<f32>, freq: f32, octaves: i32) -> f32 {
  var value     = 0.0;
  var amplitude = 0.5;
  var f         = freq;
  for (var i = 0; i < octaves; i++) {
    let n  = 1.0 - abs(noise3(p * f) * 2.0 - 1.0);
    value     += n * n * amplitude;
    amplitude *= 0.5;
    f         *= 2.0;
  }
  return value;
}

fn worley(p: vec3<f32>, freq: f32) -> f32 {
  let scaled   = p * freq;
  let fp       = fract(scaled);
  let ip       = floor(scaled);
  var min_dist = 1.0;
  for (var x = -1; x <= 1; x++) {
    for (var y = -1; y <= 1; y++) {
      for (var z = -1; z <= 1; z++) {
        let offset  = vec3<f32>(f32(x), f32(y), f32(z));
        let nb      = ip + offset;
        let feature = offset + vec3<f32>(
          hash(dot(nb, vec3<f32>( 1.0, 57.0, 21.0))),
          hash(dot(nb, vec3<f32>(31.0,  7.0, 41.0))),
          hash(dot(nb, vec3<f32>(13.0, 97.0,  3.0))),
        );
        min_dist = min(min_dist, length(fp - feature));
      }
    }
  }
  return min_dist;
}

// ── Octahedral decode ─────────────────────────────────────────────────────

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

// ── Main ──────────────────────────────────────────────────────────────────────

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= OCTA_RES || gid.y >= OCTA_RES) { return; }

  // Octahedral: (gid.x = v-row, gid.y = u-col)
  let uv  = vec2<f32>(
    (f32(gid.y) + 0.5) / f32(OCTA_RES),
    (f32(gid.x) + 0.5) / f32(OCTA_RES),
  );
  let pos = oct_decode(uv);

  let continent = fbm(pos,    params.continent_freq, 6, params.continent_persistence);
  let mountain  = ridged(pos, params.mountain_freq,  4);
  let detail    = worley(pos, params.detail_freq);

  // detail is a distance field [0,1]; invert so high values = rougher surface
  let h = clamp(continent * 0.6 + mountain * 0.3 + (1.0 - detail) * 0.1, 0.0, 1.0);

  height_buffer[gid.x * OCTA_RES + gid.y] = h;
}
