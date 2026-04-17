import type { IGraphNode, FrameContext } from './types.ts';
import type { Scene } from '../ecs/Scene.ts';

export class RenderGraph {
  readonly scene: Scene;
  private _nodes: IGraphNode[] = [];

  constructor(scene: Scene) {
    this.scene = scene;
  }

  addNode(node: IGraphNode): void {
    this._nodes.push(node);
  }

  /** Call once per frame: runs all node update() in registration order. */
  update(ctx: FrameContext): void {
    for (const node of this._nodes) {
      node.update(ctx);
    }
  }

  /** Call once per frame after update(): records all passes and submits. */
  execute(ctx: FrameContext): void {
    const encoder = ctx.device.createCommandEncoder();
    for (const node of this._nodes) {
      node.recordPass(encoder, ctx);
    }
    ctx.device.queue.submit([encoder.finish()]);
  }
}
