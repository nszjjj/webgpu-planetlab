import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LUT_PRESETS, DEFAULT_ATMOSPHERE_LUT_PARAMS } from '../core/types.ts';

describe('LUT_PRESETS', () => {
  it('all presets have positive resolutions', () => {
    for (const [name, res] of Object.entries(LUT_PRESETS)) {
      expect(res.r, `${name}: r must be > 0`).toBeGreaterThan(0);
      expect(res.muS, `${name}: muS must be > 0`).toBeGreaterThan(0);
      expect(res.muV, `${name}: muV must be > 0`).toBeGreaterThan(0);
    }
  });

  it('presets increase monotonically', () => {
    const order: Array<keyof typeof LUT_PRESETS> = ['low', 'medium', 'high', 'ultra'];
    for (let i = 1; i < order.length; i++) {
      const prev = LUT_PRESETS[order[i - 1]!];
      const curr = LUT_PRESETS[order[i]!];
      expect(curr.r, `${order[i]}.r > ${order[i-1]}.r`).toBeGreaterThanOrEqual(prev.r);
      expect(curr.muS, `${order[i]}.muS > ${order[i-1]}.muS`).toBeGreaterThanOrEqual(prev.muS);
      expect(curr.muV, `${order[i]}.muV > ${order[i-1]}.muV`).toBeGreaterThanOrEqual(prev.muV);
    }
  });

  it('all muV and muS dimensions are multiples of 8 for workgroup alignment', () => {
    for (const [name, res] of Object.entries(LUT_PRESETS)) {
      expect(res.muS % 8, `${name}: muS must be multiple of 8`).toBe(0);
      expect(res.muV % 8, `${name}: muV must be multiple of 8`).toBe(0);
    }
  });
});

describe('DEFAULT_ATMOSPHERE_LUT_PARAMS', () => {
  it('atmosphere radius is larger than planet radius', () => {
    expect(DEFAULT_ATMOSPHERE_LUT_PARAMS.atmosphereRadius)
      .toBeGreaterThan(DEFAULT_ATMOSPHERE_LUT_PARAMS.planetRadius);
  });

  it('betaR components are positive', () => {
    DEFAULT_ATMOSPHERE_LUT_PARAMS.betaR.forEach((v, i) => {
      expect(v, `betaR[${i}]`).toBeGreaterThan(0);
    });
  });

  it('betaM is positive', () => {
    expect(DEFAULT_ATMOSPHERE_LUT_PARAMS.betaM).toBeGreaterThan(0);
  });

  it('scale heights are positive', () => {
    expect(DEFAULT_ATMOSPHERE_LUT_PARAMS.H_R).toBeGreaterThan(0);
    expect(DEFAULT_ATMOSPHERE_LUT_PARAMS.H_M).toBeGreaterThan(0);
  });

  it('numSamples > numLightSamples (LUT precomputation needs more view samples than shadow)', () => {
    expect(DEFAULT_ATMOSPHERE_LUT_PARAMS.numSamples)
      .toBeGreaterThan(DEFAULT_ATMOSPHERE_LUT_PARAMS.numLightSamples);
  });
});

// AtmosphereLUTNode tests — mock WebGPU, verify resource creation and recordPass gating
describe('AtmosphereLUTNode', () => {
  let AtmosphereLUTNode: typeof import('../graph/nodes/AtmosphereLUTNode.ts').AtmosphereLUTNode;

  beforeEach(async () => {
    vi.restoreAllMocks();
    const mod = await import('../graph/nodes/AtmosphereLUTNode.ts');
    AtmosphereLUTNode = mod.AtmosphereLUTNode;
  });

  function makeMocks() {
    const resources = {
      createBuffer: vi.fn().mockReturnValue({ destroy: vi.fn() }),
      createTexture: vi.fn().mockReturnValue({ destroy: vi.fn(), createView: vi.fn().mockReturnValue({}) }),
      getBuffer: vi.fn(),
      getTexture: vi.fn(),
    } as any;

    const pipelines = {
      createComputePipeline: vi.fn().mockReturnValue({}),
    } as any;

    const device: any = {
      createShaderModule: vi.fn().mockReturnValue({}),
      createBindGroupLayout: vi.fn().mockReturnValue({}),
      createBindGroup: vi.fn().mockReturnValue({}),
      createPipelineLayout: vi.fn().mockReturnValue({}),
      createSampler: vi.fn().mockReturnValue({}),
      queue: { writeBuffer: vi.fn() },
    };

    const buildCtx: any = {
      device,
      resources,
      surfaceRes: { onChanged: vi.fn() },
      surfaceDesc: { colorFormat: 'rgba8unorm', depthFormat: 'depth32float', targetFormat: 'bgra8unorm' },
      pipelines,
      scene: {},
    };

    const frameCtx: any = {
      device,
      frameIndex: 0,
      dt: 0.016,
      totalTime: 0,
      targetView: {},
      sceneColorView: {},
      depthView: {},
      resources,
    };

    return { resources, pipelines, device, buildCtx, frameCtx };
  }

  it('constructor accepts preset and optional params', () => {
    const { resources, pipelines } = makeMocks();
    const node = new AtmosphereLUTNode(resources, pipelines, 'medium');
    expect(node.name).toBe('AtmosphereLUT');
  });

  it('build creates LUT texture with STORAGE + TEXTURE usage', () => {
    const { resources, pipelines, buildCtx } = makeMocks();
    const node = new AtmosphereLUTNode(resources, pipelines, 'low');
    node.build(buildCtx);
    const createTexCalls = resources.createTexture.mock.calls;
    expect(createTexCalls.length).toBeGreaterThanOrEqual(1);
    const texDescriptor = createTexCalls[0]![1];
    expect(texDescriptor.dimension).toBe('3d');
    expect(texDescriptor.format).toBe('rgba16float');
    expect(texDescriptor.usage).toSatisfy(
      (u: number) => (u & GPUTextureUsage.STORAGE_BINDING) !== 0 && (u & GPUTextureUsage.TEXTURE_BINDING) !== 0,
    );
  });

  it('build creates compute pipeline with correct name', () => {
    const { resources, pipelines, buildCtx } = makeMocks();
    const node = new AtmosphereLUTNode(resources, pipelines, 'low');
    node.build(buildCtx);
    expect(pipelines.createComputePipeline).toHaveBeenCalledWith(
      'atmosphere.lut_gen',
      expect.anything(),
    );
  });

  it('recordPass dispatches on first frame and skips afterwards', () => {
    const { resources, pipelines, buildCtx, frameCtx } = makeMocks();
    const node = new AtmosphereLUTNode(resources, pipelines, 'low');
    node.build(buildCtx);

    const encoder: any = {
      beginComputePass: vi.fn().mockReturnValue({
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        dispatchWorkgroups: vi.fn(),
        end: vi.fn(),
      }),
    };

    // First frame: should dispatch
    node.recordPass(encoder, frameCtx);
    expect(encoder.beginComputePass).toHaveBeenCalledOnce();

    // Reset mock
    encoder.beginComputePass.mockClear();

    // Second frame: should skip
    node.recordPass(encoder, frameCtx);
    expect(encoder.beginComputePass).not.toHaveBeenCalled();
  });

  it('LUT texture size matches preset resolution', () => {
    const { resources, pipelines, buildCtx } = makeMocks();
    const preset = LUT_PRESETS.low;
    const node = new AtmosphereLUTNode(resources, pipelines, 'low');
    node.build(buildCtx);

    const texCall = resources.createTexture.mock.calls.find(
      (c: any) => c[1]?.dimension === '3d',
    );
    expect(texCall).toBeDefined();
    const size = texCall[1].size;
    expect(size[0]).toBe(preset.muV);
    expect(size[1]).toBe(preset.muS);
    expect(size[2]).toBe(preset.r);
  });
});
