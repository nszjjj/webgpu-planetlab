# Future Work: Atmosphere Parameter HUD

**Status:** Not started  
**Priority:** Medium — quality-of-life for parameter tuning  
**Prerequisite:** Phase 3 atmosphere (Nishita single-scattering) ✅ complete

---

## Goal

Add a runtime HTML overlay with sliders so atmosphere parameters can be tuned interactively without restarting the dev server. Currently all parameters are hardcoded in `DEFAULT_ATMOSPHERE_PARAMS` (`src/core/types.ts`) and the two scale heights `H_R` / `H_M` are `const` inside the shader.

---

## Required Prerequisite Change: Move H_R and H_M to Uniforms

`H_R` (Rayleigh scale height) and `H_M` (Mie scale height) are currently defined as WGSL `const` in `src/shaders/atmosphere.wgsl`:

```wgsl
const H_R : f32 = 0.025;
const H_M : f32 = 0.008;
```

Because they are shader constants they **cannot** be changed at runtime. Before exposing them in the HUD they must be moved to `AtmosphereUniforms`:

1. **`src/core/types.ts`** — add `scaleHeightR: number` and `scaleHeightM: number` to `AtmosphereParams` and `DEFAULT_ATMOSPHERE_PARAMS`.

2. **`src/shaders/atmosphere.wgsl`** — remove the two `const` lines; add two `f32` fields to the `AtmosphereUniforms` struct (keeping the byte-offset layout consistent — insert before or after existing fields, updating padding as needed). Reference them as `atm.scaleHeightR` / `atm.scaleHeightM` in `optical_depth()`.

3. **`src/graph/nodes/AtmosphereNode.ts`** — write the new fields into the uniform buffer in `update()`. The struct layout change requires updating `UNIFORM_SIZE` and all float-offset constants accordingly.

4. **`src/__tests__/AtmosphereParams.test.ts`** — add invariant tests:
   - `scaleHeightR > 0`
   - `scaleHeightM > 0`
   - `scaleHeightR > scaleHeightM` (Rayleigh scale height is always larger than Mie)

Current default values to carry over: `H_R = 0.025`, `H_M = 0.008`.

---

## HUD Implementation

### New file: `src/ui/AtmosphereHUD.ts`

Responsible for:
- Creating an absolutely-positioned `<div>` overlay injected into `document.body`
- Rendering one labeled `<input type="range">` per tunable parameter
- Calling a user-supplied callback whenever any slider changes

```typescript
export interface HUDParams {
  betaR0: number;       // betaR red channel
  betaR1: number;       // betaR green channel
  betaR2: number;       // betaR blue channel
  betaM: number;
  mieG: number;
  scaleHeightR: number;
  scaleHeightM: number;
  atmosphereRadius: number;
  scatterScale: number; // maps to SCATTER_SCALE constant → must also move to uniform (see below)
}

export class AtmosphereHUD {
  constructor(
    initial: HUDParams,
    onChange: (params: HUDParams) => void,
  ) { ... }

  dispose(): void { ... } // removes DOM elements
}
```

### Slider ranges (suggested)

| Field | Min | Max | Step | Default |
|-------|-----|-----|------|---------|
| betaR[0] (R) | 0.001 | 0.5 | 0.001 | 0.08 |
| betaR[1] (G) | 0.001 | 0.5 | 0.001 | 0.18 |
| betaR[2] (B) | 0.001 | 0.5 | 0.001 | 0.45 |
| betaM | 0.001 | 0.3 | 0.001 | 0.06 |
| mieG | -0.99 | 0.99 | 0.01 | 0.76 |
| scaleHeightR | 0.005 | 0.1 | 0.001 | 0.025 |
| scaleHeightM | 0.001 | 0.05 | 0.001 | 0.008 |
| atmosphereRadius | 1.01 | 1.5 | 0.01 | 1.10 |
| scatterScale | 0.5 | 50.0 | 0.5 | 5.0 |

### SCATTER_SCALE also needs to move to uniforms

`SCATTER_SCALE` is currently a WGSL `const` in `atmosphere.wgsl`. Same treatment as `H_R`/`H_M`: add to `AtmosphereUniforms` + `AtmosphereParams` + `AtmosphereNode.update()`.

---

## Wiring in WebGPUEngine or GraphBuilder

After `GraphBuilder.build()` returns, construct the HUD and wire its `onChange` callback to update the `AtmosphereNode`'s `_params`:

```typescript
// Option A: expose setParams() on AtmosphereNode
atmosNode.setParams(newParams);

// Option B: AtmosphereNode holds a reference to a shared params object
// (mutate in place, AtmosphereNode reads it each frame in update())
```

Option B (shared mutable object) is simpler and avoids adding a public API to the node.

---

## File Map Summary

| Action | Path | Change |
|--------|------|--------|
| Modify | `src/core/types.ts` | Add `scaleHeightR`, `scaleHeightM`, `scatterScale` to `AtmosphereParams` |
| Modify | `src/shaders/atmosphere.wgsl` | Move `H_R`, `H_M`, `SCATTER_SCALE` from `const` to `AtmosphereUniforms` |
| Modify | `src/graph/nodes/AtmosphereNode.ts` | Write new uniform fields; add `setParams()` or expose params ref |
| Modify | `src/__tests__/AtmosphereParams.test.ts` | Add invariant tests for new fields |
| Create | `src/ui/AtmosphereHUD.ts` | HTML slider overlay |
| Modify | `src/main.ts` or `src/core/WebGPUEngine.ts` | Construct HUD, wire onChange callback |

---

## Notes

- The HUD is purely a developer/debug tool. It does not need to be bundled for production; a `import.meta.env.DEV` guard is sufficient.
- Atmosphere radius changes at runtime will not update the `scene.color` / `scene.depth` texture sizes (those are fixed at build time). Only the raymarching shell radius changes — this is correct behavior.
- The `betaR` invariant test (blue > green > red) in `AtmosphereParams.test.ts` applies to `DEFAULT_ATMOSPHERE_PARAMS` only; the HUD allows the user to break this ordering intentionally for artistic purposes.
