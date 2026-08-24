// src/framework/graph/handles.ts
// Typed resource handles: phantom `Tag` enables compile-time discrimination
// of distinct buffers/textures while `key` remains the runtime lookup string.

export interface BufferHandle<Tag extends string = string> {
  readonly __tag:  Tag;
  readonly __kind: 'buffer';
  readonly key:    string;
}

export interface TextureHandle<Tag extends string = string> {
  readonly __tag:  Tag;
  readonly __kind: 'texture';
  readonly key:    string;
}
