import type { MindmapNode } from "../types";

// Plain-text indented outline of a mind map tree, for the notes export
// (text download / print) where the absolutely-positioned diagram
// (MindMap.tsx) doesn't apply.
export function mindmapToOutline(root: MindmapNode, prefix = ""): string[] {
  const lines = [`${prefix}- ${root.topic}`];
  for (const child of root.children ?? []) {
    lines.push(...mindmapToOutline(child, `${prefix}  `));
  }
  return lines;
}
