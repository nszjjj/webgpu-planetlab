import { describe, it, expect } from 'vitest';
import { CloudCoverageNode } from '../../../demos/planet/nodes/CloudCoverageNode.ts';
import { CloudRenderNode }   from '../../../demos/planet/nodes/CloudRenderNode.ts';
import { DEFAULT_CLOUD_PARAMS, type CloudParams } from '../../../demos/planet/params.ts';

describe('CloudCoverageNode shared params ref', () => {
  it('holds the passed-in params object by reference, not by copy', () => {
    const params: CloudParams = { ...DEFAULT_CLOUD_PARAMS };
    const node = new CloudCoverageNode();
    node.setInputs({ cloudParams: params });
    expect((node as any)._inputs.cloudParams).toBe(params);
  });
});

describe('CloudRenderNode shared params ref', () => {
  it('holds the passed-in params object by reference, not by copy', () => {
    const params: CloudParams = { ...DEFAULT_CLOUD_PARAMS };
    const node = new CloudRenderNode();
    node.setInputs({
      coverageBuffer: undefined as any,
      depthTarget:    undefined as any,
      vpMatrix:       new Float32Array(16),
      cameraPos:      [0, 0, 0],
      sunDir:         [0, 1, 0],
      planetRadius:   1,
      cloudParams:    params,
    });
    expect((node as any)._inputs.cloudParams).toBe(params);
  });
});
