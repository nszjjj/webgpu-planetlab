// src/graph/nodes/BaseNode.ts
import type { IGraphNode, BuildContext, FrameContext } from '../../core/types.ts';

export abstract class BaseNode implements IGraphNode {
  abstract readonly name: string;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  build(_ctx: BuildContext): void {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(_ctx: FrameContext): void {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  recordPass(_encoder: GPUCommandEncoder, _ctx: FrameContext): void {}
}
