import type { MindmapNode } from "../types";

interface LaidOutNode {
  node: MindmapNode;
  x: number;
  y: number;
  depth: number;
}

interface LaidOutEdge {
  from: LaidOutNode;
  to: LaidOutNode;
}

const ROW_HEIGHT = 64;
const COL_WIDTH = 240;
const NODE_WIDTH = 200;

// Simple depth-first tidy-tree layout: every leaf gets its own row slot in
// document order, every parent sits at the vertical midpoint of its
// children — the same idea a dendrogram uses. No text-measurement pass:
// the model is instructed (mindmapSystemPrompt, server-side) to keep labels
// short, and the row pitch below gives a wrapped 1-2 line label room
// without colliding with its neighbors.
function layoutTree(root: MindmapNode): { nodes: LaidOutNode[]; edges: LaidOutEdge[]; height: number; maxDepth: number } {
  const nodes: LaidOutNode[] = [];
  const edges: LaidOutEdge[] = [];
  let leafIndex = 0;
  let maxDepth = 0;

  function place(node: MindmapNode, depth: number): LaidOutNode {
    maxDepth = Math.max(maxDepth, depth);
    const kids = node.children ?? [];
    let laid: LaidOutNode;
    if (kids.length === 0) {
      laid = { node, x: depth * COL_WIDTH, y: leafIndex * ROW_HEIGHT, depth };
      leafIndex += 1;
    } else {
      const laidKids = kids.map((k) => place(k, depth + 1));
      const y = (laidKids[0].y + laidKids[laidKids.length - 1].y) / 2;
      laid = { node, x: depth * COL_WIDTH, y, depth };
      for (const child of laidKids) edges.push({ from: laid, to: child });
    }
    nodes.push(laid);
    return laid;
  }

  place(root, 0);
  const height = Math.max(leafIndex * ROW_HEIGHT, ROW_HEIGHT);
  return { nodes, edges, height, maxDepth };
}

function connector(from: LaidOutNode, to: LaidOutNode): string {
  const x1 = from.x + NODE_WIDTH;
  const y1 = from.y;
  const x2 = to.x;
  const y2 = to.y;
  const midX = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
}

// Renders a conversation's topic hierarchy (see mindmapSystemPrompt) as a
// left-to-right tree — root on the left, themes and points fanning out to
// the right, connected by curved lines. Plain absolutely-positioned HTML
// nodes rather than SVG text, so labels wrap naturally at any length; only
// the connector lines are SVG.
export function MindMap({ root }: { root: MindmapNode }) {
  const { nodes, edges, height, maxDepth } = layoutTree(root);
  const width = (maxDepth + 1) * COL_WIDTH + NODE_WIDTH / 2;

  return (
    <div className="mindmap">
      <div className="mindmap__canvas" style={{ width, height, minWidth: width }}>
        <svg className="mindmap__lines" width={width} height={height}>
          {edges.map((e, i) => (
            <path key={i} d={connector(e.from, e.to)} className="mindmap__edge" />
          ))}
        </svg>
        {nodes.map((n, i) => (
          <div
            key={i}
            className={`mindmap__node mindmap__node--depth${Math.min(n.depth, 2)}`}
            style={{ left: n.x, top: n.y, width: NODE_WIDTH }}
          >
            {n.node.topic}
          </div>
        ))}
      </div>
    </div>
  );
}
