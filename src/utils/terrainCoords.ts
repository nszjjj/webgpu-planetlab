export const TERRAIN_RESOLUTION = 512;

export function sphericalToIndex(
  theta: number,
  phi: number,
  resolution = TERRAIN_RESOLUTION,
): number {
  const phiNorm = ((phi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const i = Math.max(0, Math.min(resolution - 1, Math.floor((theta / Math.PI) * (resolution - 1))));
  const j = Math.max(0, Math.min(resolution - 1, Math.floor((phiNorm / (2 * Math.PI)) * (resolution - 1))));
  return i * resolution + j;
}
