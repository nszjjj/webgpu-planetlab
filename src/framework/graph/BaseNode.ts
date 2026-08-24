// src/framework/graph/BaseNode.ts
import type { IGraphNode, BuildContext, FrameContext } from './types.ts';
import type { BufferHandle, TextureHandle } from './handles.ts';

export type NodeInputs  = Record<string, unknown>;
export type NodeOutputs = Record<string, BufferHandle | TextureHandle>;

export abstract class BaseNode<
  I extends NodeInputs  = {},
  O extends NodeOutputs = {},
> implements IGraphNode {
  abstract readonly name: string;

  protected _inputs!:  I;
  protected _outputs!: O;

  setInputs(inputs: I): this {
    this._inputs = inputs;
    return this;
  }

  get outputs(): O { return this._outputs; }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  build(_ctx: BuildContext): void {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(_ctx: FrameContext): void {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  recordPass(_encoder: GPUCommandEncoder, _ctx: FrameContext): void {}
}
