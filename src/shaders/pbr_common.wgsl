// src/shaders/pbr_common.wgsl
// Cook-Torrance BRDF with GGX distribution and Smith geometry.
// Direct lighting only — IBL deferred.

const PI: f32 = 3.14159265358979323846;

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

fn tonemapACESFilm(color: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((color * (a * color + b)) / (color * (c * color + d) + e), vec3(0.0), vec3(1.0));
}
