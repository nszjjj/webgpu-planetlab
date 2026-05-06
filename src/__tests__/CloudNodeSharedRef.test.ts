import { describe, it, expect } from 'vitest';
import { CloudCoverageNode } from '../graph/nodes/CloudCoverageNode.ts';
import { CloudRenderNode }   from '../graph/nodes/CloudRenderNode.ts';
import { DEFAULT_CLOUD_PARAMS, type CloudParams } from '../core/types.ts';

describe('CloudCoverageNode shared params ref', () => {
  it('holds the passed-in params object by reference, not by copy', () => {
    const params: CloudParams = { ...DEFAULT_CLOUD_PARAMS };
    const node = new CloudCoverageNode(undefined as any, undefined as any, params);
    expect((node as any)._params).toBe(params);
  });
});

describe('CloudRenderNode shared params ref', () => {
  it('holds the passed-in params object by reference, not by copy', () => {
    const params: CloudParams = { ...DEFAULT_CLOUD_PARAMS };
    const node = new CloudRenderNode(
      undefined as any,
      undefined as any,
      undefined as any,
      params,
    );
    expect((node as any)._params).toBe(params);
  });
});
