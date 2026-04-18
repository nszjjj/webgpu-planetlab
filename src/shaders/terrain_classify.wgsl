// Pass B: read terrain.height → write terrain.splat (u32 bit-mask per texel)
// Bit layout: 0=water 1=sand 2=grass 3=rock 4=snow 5=ore_iron 6=ore_rare

const PI         : f32 = 3.14159265358979323846;
const RESOLUTION : u32 = 512u;

struct ClassifyParams {
  water_max          : f32,
  sand_max           : f32,
  grass_max          : f32,
  rock_max           : f32,
  ore_iron_threshold : f32,
  ore_rare_threshold : f32,
  ore_noise_freq     : f32,
  _pad0              : f32,
}

@group(0) @binding(0) var<uniform>             params        : ClassifyParams;
@group(0) @binding(1) var<storage, read>       height_buffer : array<f32>;
@group(0) @binding(2) var<storage, read_write> splat_buffer  : array<u32>;

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

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= RESOLUTION || gid.y >= RESOLUTION) { return; }

  let index = gid.x * RESOLUTION + gid.y;
  let h     = height_buffer[index];

  var mask: u32 = 0u;

  // Base terrain: exactly one bit set per texel
  if (h < params.water_max) {
    mask |= 1u;        // bit 0: water
  } else if (h < params.sand_max) {
    mask |= 2u;        // bit 1: sand
  } else if (h < params.grass_max) {
    mask |= 4u;        // bit 2: grass
  } else if (h < params.rock_max) {
    mask |= 8u;        // bit 3: rock
  } else {
    mask |= 16u;       // bit 4: snow
  }

  // Ore: independent high-frequency noise; only in grass (4) or rock (8) areas
  let theta = f32(gid.x) / f32(RESOLUTION - 1u) * PI;
  let phi   = f32(gid.y) / f32(RESOLUTION - 1u) * 2.0 * PI;
  let pos   = vec3<f32>(sin(theta) * cos(phi), cos(theta), sin(theta) * sin(phi));
  let ore_n = noise3(pos * params.ore_noise_freq);

  if (ore_n > params.ore_iron_threshold && (mask & 12u) != 0u) {
    mask |= 32u;       // bit 5: ore_iron  (12 = grass | rock)
  }
  if (ore_n > params.ore_rare_threshold && (mask & 8u) != 0u) {
    mask |= 64u;       // bit 6: ore_rare  (rock only)
  }

  splat_buffer[index] = mask;
}
