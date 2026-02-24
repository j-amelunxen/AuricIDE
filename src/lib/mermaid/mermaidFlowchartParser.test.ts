import { describe, expect, it } from 'vitest';
import {
  isMermaidFlowchart,
  parseMermaidFlowchart,
  serializeMermaidFlowchart,
} from './mermaidFlowchartParser';
import type { MermaidFlowchartData } from './mermaidFlowchartParser';

describe('isMermaidFlowchart', () => {
  it('returns true for "graph TD"', () => {
    expect(isMermaidFlowchart('graph TD')).toBe(true);
  });

  it('returns true for "graph LR"', () => {
    expect(isMermaidFlowchart('graph LR')).toBe(true);
  });

  it('returns true for "flowchart TD"', () => {
    expect(isMermaidFlowchart('flowchart TD')).toBe(true);
  });

  it('returns true for "flowchart RL"', () => {
    expect(isMermaidFlowchart('flowchart RL')).toBe(true);
  });

  it('returns true for "flowchart BT"', () => {
    expect(isMermaidFlowchart('flowchart BT')).toBe(true);
  });

  it('returns true for "graph TB"', () => {
    expect(isMermaidFlowchart('graph TB')).toBe(true);
  });

  it('returns true when there are leading blank lines', () => {
    expect(isMermaidFlowchart('\n\n  \ngraph TD\n  A-->B')).toBe(true);
  });

  it('returns false for "sequenceDiagram"', () => {
    expect(isMermaidFlowchart('sequenceDiagram')).toBe(false);
  });

  it('returns false for "pie"', () => {
    expect(isMermaidFlowchart('pie')).toBe(false);
  });

  it('returns false for "classDiagram"', () => {
    expect(isMermaidFlowchart('classDiagram')).toBe(false);
  });

  it('returns false for "erDiagram"', () => {
    expect(isMermaidFlowchart('erDiagram')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isMermaidFlowchart('')).toBe(false);
  });

  it('returns false for whitespace-only string', () => {
    expect(isMermaidFlowchart('   \n  \n  ')).toBe(false);
  });
});

describe('parseMermaidFlowchart', () => {
  it('parses direction TD correctly', () => {
    const result = parseMermaidFlowchart('flowchart TD\n  A-->B');
    expect(result.direction).toBe('TD');
  });

  it('parses direction LR correctly', () => {
    const result = parseMermaidFlowchart('graph LR\n  A-->B');
    expect(result.direction).toBe('LR');
  });

  it('parses direction BT correctly', () => {
    const result = parseMermaidFlowchart('flowchart BT\n  A-->B');
    expect(result.direction).toBe('BT');
  });

  it('parses direction RL correctly', () => {
    const result = parseMermaidFlowchart('flowchart RL\n  A-->B');
    expect(result.direction).toBe('RL');
  });

  it('parses rect node shape: A[Label]', () => {
    const result = parseMermaidFlowchart('flowchart TD\n  A[My Label]');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      id: 'A',
      label: 'My Label',
      shape: 'rect',
    });
  });

  it('parses round node shape: A(Label)', () => {
    const result = parseMermaidFlowchart('flowchart TD\n  A(My Label)');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      id: 'A',
      label: 'My Label',
      shape: 'round',
    });
  });

  it('parses rhombus node shape: A{Label}', () => {
    const result = parseMermaidFlowchart('flowchart TD\n  A{Decision}');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      id: 'A',
      label: 'Decision',
      shape: 'rhombus',
    });
  });

  it('parses circle node shape: A((Label))', () => {
    const result = parseMermaidFlowchart('flowchart TD\n  A((Circle))');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      id: 'A',
      label: 'Circle',
      shape: 'circle',
    });
  });

  it('parses stadium node shape: A([Label])', () => {
    const result = parseMermaidFlowchart('flowchart TD\n  A([Stadium])');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      id: 'A',
      label: 'Stadium',
      shape: 'stadium',
    });
  });

  it('parses subroutine node shape: A[[Label]]', () => {
    const result = parseMermaidFlowchart('flowchart TD\n  A[[Subroutine]]');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      id: 'A',
      label: 'Subroutine',
      shape: 'subroutine',
    });
  });

  it('parses cylindrical node shape: A[(Label)]', () => {
    const result = parseMermaidFlowchart('flowchart TD\n  A[(Database)]');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      id: 'A',
      label: 'Database',
      shape: 'cylindrical',
    });
  });

  it('parses asymmetric node shape: A>Label]', () => {
    const result = parseMermaidFlowchart('flowchart TD\n  A>Flag]');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      id: 'A',
      label: 'Flag',
      shape: 'asymmetric',
    });
  });

  it('parses hexagon node shape: A{{Label}}', () => {
    const result = parseMermaidFlowchart('flowchart TD\n  A{{Hexagon}}');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      id: 'A',
      label: 'Hexagon',
      shape: 'hexagon',
    });
  });

  it('parses double-circle node shape: A(((Label)))', () => {
    const result = parseMermaidFlowchart('flowchart TD\n  A(((DoubleCircle)))');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      id: 'A',
      label: 'DoubleCircle',
      shape: 'double-circle',
    });
  });

  it('parses arrow edge: A-->B', () => {
    const result = parseMermaidFlowchart('flowchart TD\n  A-->B');
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      source: 'A',
      target: 'B',
      style: 'arrow',
    });
  });

  it('parses open edge: A---B', () => {
    const result = parseMermaidFlowchart('flowchart TD\n  A---B');
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      source: 'A',
      target: 'B',
      style: 'open',
    });
  });

  it('parses dotted edge: A-.->B', () => {
    const result = parseMermaidFlowchart('flowchart TD\n  A-.->B');
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      source: 'A',
      target: 'B',
      style: 'dotted',
    });
  });

  it('parses thick edge: A==>B', () => {
    const result = parseMermaidFlowchart('flowchart TD\n  A==>B');
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      source: 'A',
      target: 'B',
      style: 'thick',
    });
  });

  it('parses edge labels with pipe syntax: A-->|text|B', () => {
    const result = parseMermaidFlowchart('flowchart TD\n  A-->|Yes|B');
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      source: 'A',
      target: 'B',
      label: 'Yes',
      style: 'arrow',
    });
  });

  it('parses edge labels with inline syntax: A-- text -->B', () => {
    const result = parseMermaidFlowchart('flowchart TD\n  A-- Yes -->B');
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      source: 'A',
      target: 'B',
      label: 'Yes',
      style: 'arrow',
    });
  });

  it('handles implicit nodes from edges', () => {
    const result = parseMermaidFlowchart('flowchart TD\n  X-->Y');
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.find((n) => n.id === 'X')).toMatchObject({
      id: 'X',
      label: 'X',
      shape: 'default',
    });
    expect(result.nodes.find((n) => n.id === 'Y')).toMatchObject({
      id: 'Y',
      label: 'Y',
      shape: 'default',
    });
  });

  it('does not duplicate nodes when defined and used in edges', () => {
    const code = `flowchart TD
  A[Start]
  B[End]
  A-->B`;
    const result = parseMermaidFlowchart(code);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0]).toMatchObject({ id: 'A', label: 'Start', shape: 'rect' });
    expect(result.nodes[1]).toMatchObject({ id: 'B', label: 'End', shape: 'rect' });
  });

  it('parses subgraphs', () => {
    const code = `flowchart TD
  subgraph Backend
    A[Server]
    B[Database]
  end
  C[Client]
  C-->A`;
    const result = parseMermaidFlowchart(code);
    expect(result.subgraphs).toHaveLength(1);
    expect(result.subgraphs[0]).toMatchObject({
      title: 'Backend',
      nodeIds: ['A', 'B'],
    });
  });

  it('parses multiple subgraphs', () => {
    const code = `flowchart LR
  subgraph Frontend
    A[React]
  end
  subgraph Backend
    B[Node]
    C[DB]
  end
  A-->B`;
    const result = parseMermaidFlowchart(code);
    expect(result.subgraphs).toHaveLength(2);
    expect(result.subgraphs[0]).toMatchObject({
      title: 'Frontend',
      nodeIds: ['A'],
    });
    expect(result.subgraphs[1]).toMatchObject({
      title: 'Backend',
      nodeIds: ['B', 'C'],
    });
  });

  it('assigns positions with x >= 0 and y >= 0 to all nodes', () => {
    const code = `flowchart TD
  A[Start]-->B[Middle]
  B-->C[End]`;
    const result = parseMermaidFlowchart(code);
    for (const node of result.nodes) {
      expect(node.position.x).toBeGreaterThanOrEqual(0);
      expect(node.position.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('parses node definitions inline with edges', () => {
    const code = `flowchart TD
  A[Start]-->B[Process]-->C[End]`;
    const result = parseMermaidFlowchart(code);
    expect(result.nodes).toHaveLength(3);
    expect(result.nodes.find((n) => n.id === 'A')).toMatchObject({
      label: 'Start',
      shape: 'rect',
    });
    expect(result.nodes.find((n) => n.id === 'B')).toMatchObject({
      label: 'Process',
      shape: 'rect',
    });
    expect(result.nodes.find((n) => n.id === 'C')).toMatchObject({
      label: 'End',
      shape: 'rect',
    });
    expect(result.edges).toHaveLength(2);
  });

  it('handles complex diagram with mixed shapes and edge types', () => {
    const code = `flowchart TD
  A[Start] --> B{Decision}
  B -->|Yes| C((Circle))
  B -->|No| D[End]`;
    const result = parseMermaidFlowchart(code);
    expect(result.nodes).toHaveLength(4);
    expect(result.nodes.find((n) => n.id === 'B')?.shape).toBe('rhombus');
    expect(result.nodes.find((n) => n.id === 'C')?.shape).toBe('circle');
    expect(result.edges).toHaveLength(3);
  });
});

describe('serializeMermaidFlowchart', () => {
  it('produces "flowchart DIRECTION" as first line', () => {
    const data: MermaidFlowchartData = {
      direction: 'TD',
      nodes: [],
      edges: [],
      subgraphs: [],
    };
    const result = serializeMermaidFlowchart(data);
    expect(result.split('\n')[0]).toBe('flowchart TD');
  });

  it('serializes node definitions with correct bracket syntax for rect', () => {
    const data: MermaidFlowchartData = {
      direction: 'TD',
      nodes: [{ id: 'A', label: 'Hello', shape: 'rect', position: { x: 0, y: 0 } }],
      edges: [],
      subgraphs: [],
    };
    const result = serializeMermaidFlowchart(data);
    expect(result).toContain('A[Hello]');
  });

  it('serializes node definitions with correct bracket syntax for round', () => {
    const data: MermaidFlowchartData = {
      direction: 'TD',
      nodes: [{ id: 'A', label: 'Hello', shape: 'round', position: { x: 0, y: 0 } }],
      edges: [],
      subgraphs: [],
    };
    const result = serializeMermaidFlowchart(data);
    expect(result).toContain('A(Hello)');
  });

  it('serializes node definitions with correct bracket syntax for stadium', () => {
    const data: MermaidFlowchartData = {
      direction: 'TD',
      nodes: [{ id: 'A', label: 'Hello', shape: 'stadium', position: { x: 0, y: 0 } }],
      edges: [],
      subgraphs: [],
    };
    const result = serializeMermaidFlowchart(data);
    expect(result).toContain('A([Hello])');
  });

  it('serializes node definitions with correct bracket syntax for subroutine', () => {
    const data: MermaidFlowchartData = {
      direction: 'TD',
      nodes: [{ id: 'A', label: 'Hello', shape: 'subroutine', position: { x: 0, y: 0 } }],
      edges: [],
      subgraphs: [],
    };
    const result = serializeMermaidFlowchart(data);
    expect(result).toContain('A[[Hello]]');
  });

  it('serializes node definitions with correct bracket syntax for cylindrical', () => {
    const data: MermaidFlowchartData = {
      direction: 'TD',
      nodes: [{ id: 'A', label: 'DB', shape: 'cylindrical', position: { x: 0, y: 0 } }],
      edges: [],
      subgraphs: [],
    };
    const result = serializeMermaidFlowchart(data);
    expect(result).toContain('A[(DB)]');
  });

  it('serializes node definitions with correct bracket syntax for circle', () => {
    const data: MermaidFlowchartData = {
      direction: 'TD',
      nodes: [{ id: 'A', label: 'Hello', shape: 'circle', position: { x: 0, y: 0 } }],
      edges: [],
      subgraphs: [],
    };
    const result = serializeMermaidFlowchart(data);
    expect(result).toContain('A((Hello))');
  });

  it('serializes node definitions with correct bracket syntax for asymmetric', () => {
    const data: MermaidFlowchartData = {
      direction: 'TD',
      nodes: [{ id: 'A', label: 'Flag', shape: 'asymmetric', position: { x: 0, y: 0 } }],
      edges: [],
      subgraphs: [],
    };
    const result = serializeMermaidFlowchart(data);
    expect(result).toContain('A>Flag]');
  });

  it('serializes node definitions with correct bracket syntax for rhombus', () => {
    const data: MermaidFlowchartData = {
      direction: 'TD',
      nodes: [{ id: 'A', label: 'Decision', shape: 'rhombus', position: { x: 0, y: 0 } }],
      edges: [],
      subgraphs: [],
    };
    const result = serializeMermaidFlowchart(data);
    expect(result).toContain('A{Decision}');
  });

  it('serializes node definitions with correct bracket syntax for hexagon', () => {
    const data: MermaidFlowchartData = {
      direction: 'TD',
      nodes: [{ id: 'A', label: 'Hex', shape: 'hexagon', position: { x: 0, y: 0 } }],
      edges: [],
      subgraphs: [],
    };
    const result = serializeMermaidFlowchart(data);
    expect(result).toContain('A{{Hex}}');
  });

  it('serializes node definitions with correct bracket syntax for double-circle', () => {
    const data: MermaidFlowchartData = {
      direction: 'TD',
      nodes: [{ id: 'A', label: 'DC', shape: 'double-circle', position: { x: 0, y: 0 } }],
      edges: [],
      subgraphs: [],
    };
    const result = serializeMermaidFlowchart(data);
    expect(result).toContain('A(((DC)))');
  });

  it('serializes edges with correct arrow syntax for arrow', () => {
    const data: MermaidFlowchartData = {
      direction: 'TD',
      nodes: [
        { id: 'A', label: 'A', shape: 'default', position: { x: 0, y: 0 } },
        { id: 'B', label: 'B', shape: 'default', position: { x: 0, y: 0 } },
      ],
      edges: [{ source: 'A', target: 'B', style: 'arrow' }],
      subgraphs: [],
    };
    const result = serializeMermaidFlowchart(data);
    expect(result).toContain('A --> B');
  });

  it('serializes edges with correct arrow syntax for open', () => {
    const data: MermaidFlowchartData = {
      direction: 'TD',
      nodes: [
        { id: 'A', label: 'A', shape: 'default', position: { x: 0, y: 0 } },
        { id: 'B', label: 'B', shape: 'default', position: { x: 0, y: 0 } },
      ],
      edges: [{ source: 'A', target: 'B', style: 'open' }],
      subgraphs: [],
    };
    const result = serializeMermaidFlowchart(data);
    expect(result).toContain('A --- B');
  });

  it('serializes edges with correct arrow syntax for dotted', () => {
    const data: MermaidFlowchartData = {
      direction: 'TD',
      nodes: [
        { id: 'A', label: 'A', shape: 'default', position: { x: 0, y: 0 } },
        { id: 'B', label: 'B', shape: 'default', position: { x: 0, y: 0 } },
      ],
      edges: [{ source: 'A', target: 'B', style: 'dotted' }],
      subgraphs: [],
    };
    const result = serializeMermaidFlowchart(data);
    expect(result).toContain('A -.-> B');
  });

  it('serializes edges with correct arrow syntax for thick', () => {
    const data: MermaidFlowchartData = {
      direction: 'TD',
      nodes: [
        { id: 'A', label: 'A', shape: 'default', position: { x: 0, y: 0 } },
        { id: 'B', label: 'B', shape: 'default', position: { x: 0, y: 0 } },
      ],
      edges: [{ source: 'A', target: 'B', style: 'thick' }],
      subgraphs: [],
    };
    const result = serializeMermaidFlowchart(data);
    expect(result).toContain('A ==> B');
  });

  it('serializes edge labels', () => {
    const data: MermaidFlowchartData = {
      direction: 'TD',
      nodes: [
        { id: 'A', label: 'A', shape: 'default', position: { x: 0, y: 0 } },
        { id: 'B', label: 'B', shape: 'default', position: { x: 0, y: 0 } },
      ],
      edges: [{ source: 'A', target: 'B', label: 'Yes', style: 'arrow' }],
      subgraphs: [],
    };
    const result = serializeMermaidFlowchart(data);
    expect(result).toContain('A -->|Yes| B');
  });

  it('serializes subgraphs', () => {
    const data: MermaidFlowchartData = {
      direction: 'TD',
      nodes: [
        { id: 'A', label: 'Server', shape: 'rect', position: { x: 0, y: 0 } },
        { id: 'B', label: 'DB', shape: 'rect', position: { x: 0, y: 0 } },
        { id: 'C', label: 'Client', shape: 'rect', position: { x: 0, y: 0 } },
      ],
      edges: [{ source: 'C', target: 'A', style: 'arrow' }],
      subgraphs: [{ id: 'sg-0', title: 'Backend', nodeIds: ['A', 'B'] }],
    };
    const result = serializeMermaidFlowchart(data);
    expect(result).toContain('subgraph Backend');
    expect(result).toContain('end');
    expect(result).toContain('A[Server]');
    expect(result).toContain('B[DB]');
  });

  it('does not serialize default-shaped nodes with brackets', () => {
    const data: MermaidFlowchartData = {
      direction: 'TD',
      nodes: [{ id: 'A', label: 'A', shape: 'default', position: { x: 0, y: 0 } }],
      edges: [],
      subgraphs: [],
    };
    const result = serializeMermaidFlowchart(data);
    // Default nodes where label === id should not produce a definition line
    expect(result.trim()).toBe('flowchart TD');
  });
});

describe('round-trip tests', () => {
  it('parse(serialize(data)) preserves structure', () => {
    const data: MermaidFlowchartData = {
      direction: 'LR',
      nodes: [
        { id: 'A', label: 'Start', shape: 'rect', position: { x: 0, y: 0 } },
        { id: 'B', label: 'Process', shape: 'round', position: { x: 250, y: 0 } },
        { id: 'C', label: 'End', shape: 'rect', position: { x: 500, y: 0 } },
      ],
      edges: [
        { source: 'A', target: 'B', style: 'arrow' },
        { source: 'B', target: 'C', label: 'Done', style: 'arrow' },
      ],
      subgraphs: [],
    };

    const serialized = serializeMermaidFlowchart(data);
    const parsed = parseMermaidFlowchart(serialized);

    expect(parsed.direction).toBe(data.direction);
    expect(parsed.nodes).toHaveLength(data.nodes.length);
    expect(parsed.edges).toHaveLength(data.edges.length);

    for (const origNode of data.nodes) {
      const parsedNode = parsed.nodes.find((n) => n.id === origNode.id);
      expect(parsedNode).toBeDefined();
      expect(parsedNode!.label).toBe(origNode.label);
      expect(parsedNode!.shape).toBe(origNode.shape);
    }

    for (const origEdge of data.edges) {
      const parsedEdge = parsed.edges.find(
        (e) => e.source === origEdge.source && e.target === origEdge.target
      );
      expect(parsedEdge).toBeDefined();
      expect(parsedEdge!.style).toBe(origEdge.style);
      if (origEdge.label) {
        expect(parsedEdge!.label).toBe(origEdge.label);
      }
    }
  });

  it('serialize(parse(code)) produces equivalent code', () => {
    const code = `flowchart TD
  A[Start] --> B{Decision}
  B -->|Yes| C[OK]
  B -->|No| D[Fail]`;

    const parsed = parseMermaidFlowchart(code);
    const serialized = serializeMermaidFlowchart(parsed);
    const reparsed = parseMermaidFlowchart(serialized);

    expect(reparsed.direction).toBe(parsed.direction);
    expect(reparsed.nodes).toHaveLength(parsed.nodes.length);
    expect(reparsed.edges).toHaveLength(parsed.edges.length);

    for (const origNode of parsed.nodes) {
      const reNode = reparsed.nodes.find((n) => n.id === origNode.id);
      expect(reNode).toBeDefined();
      expect(reNode!.label).toBe(origNode.label);
      expect(reNode!.shape).toBe(origNode.shape);
    }

    for (const origEdge of parsed.edges) {
      const reEdge = reparsed.edges.find(
        (e) => e.source === origEdge.source && e.target === origEdge.target
      );
      expect(reEdge).toBeDefined();
      expect(reEdge!.style).toBe(origEdge.style);
      if (origEdge.label) {
        expect(reEdge!.label).toBe(origEdge.label);
      }
    }
  });

  it('round-trip preserves subgraphs', () => {
    const code = `flowchart LR
  subgraph Backend
    A[Server]
    B[Database]
  end
  C[Client]
  C --> A`;

    const parsed = parseMermaidFlowchart(code);
    const serialized = serializeMermaidFlowchart(parsed);
    const reparsed = parseMermaidFlowchart(serialized);

    expect(reparsed.subgraphs).toHaveLength(1);
    expect(reparsed.subgraphs[0].title).toBe('Backend');
    expect(reparsed.subgraphs[0].nodeIds).toContain('A');
    expect(reparsed.subgraphs[0].nodeIds).toContain('B');
  });
});
