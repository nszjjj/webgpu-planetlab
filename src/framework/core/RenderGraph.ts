import type { IGraphNode, FrameContext } from '../graph/types.ts';

export class RenderGraph {
  private _nodes: IGraphNode[] = [];

  addNode(node: IGraphNode): void { this._nodes.push(node); }

  /** 每帧调用：run update + record all passes 到给定 encoder */
  runFrame(encoder: GPUCommandEncoder, ctx: FrameContext): void {
    for (const n of this._nodes) n.update(ctx);
    for (const n of this._nodes) n.recordPass(encoder, ctx);
  }
}
