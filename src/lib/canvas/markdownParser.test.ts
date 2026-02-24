import { describe, expect, it } from 'vitest';
import { parseWorkflowMarkdown, serializeWorkflow, type WorkflowData } from './markdownParser';

const sampleMarkdown = `# Workflow: My Pipeline

## Node: Receive Input
<!-- type: trigger, position: 100, 100 -->
<!-- tags: input, webhook -->
Receives incoming HTTP requests and validates payload.

## Node: Process Data
<!-- type: agent, position: 350, 100 -->
<!-- connects-from: Receive Input -->
<!-- tags: ai, classification -->
Claude agent that classifies and routes the data.

## Node: Generate Report
<!-- type: script, position: 600, 100 -->
<!-- connects-from: Process Data -->
<!-- tags: output, report -->
Generates the final Markdown report.
`;

describe('parseWorkflowMarkdown', () => {
  it('extracts nodes from ## Node: headers', () => {
    const result = parseWorkflowMarkdown(sampleMarkdown);
    expect(result.nodes).toHaveLength(3);
    expect(result.nodes[0].title).toBe('Receive Input');
    expect(result.nodes[1].title).toBe('Process Data');
    expect(result.nodes[2].title).toBe('Generate Report');
  });

  it('parses type from <!-- type: ... --> comments', () => {
    const result = parseWorkflowMarkdown(sampleMarkdown);
    expect(result.nodes[0].type).toBe('trigger');
    expect(result.nodes[1].type).toBe('agent');
    expect(result.nodes[2].type).toBe('script');
  });

  it('parses position from <!-- type: ..., position: x, y --> comments', () => {
    const result = parseWorkflowMarkdown(sampleMarkdown);
    expect(result.nodes[0].position).toEqual({ x: 100, y: 100 });
    expect(result.nodes[1].position).toEqual({ x: 350, y: 100 });
    expect(result.nodes[2].position).toEqual({ x: 600, y: 100 });
  });

  it('parses connections from <!-- connects-from: ... --> comments', () => {
    const result = parseWorkflowMarkdown(sampleMarkdown);
    expect(result.edges).toHaveLength(2);
  });

  it('parses tags from <!-- tags: ... --> comments', () => {
    const result = parseWorkflowMarkdown(sampleMarkdown);
    expect(result.nodes[0].tags).toEqual(['input', 'webhook']);
    expect(result.nodes[1].tags).toEqual(['ai', 'classification']);
    expect(result.nodes[2].tags).toEqual(['output', 'report']);
  });

  it('extracts description as remaining text after metadata comments', () => {
    const result = parseWorkflowMarkdown(sampleMarkdown);
    expect(result.nodes[0].description).toBe(
      'Receives incoming HTTP requests and validates payload.'
    );
    expect(result.nodes[1].description).toBe('Claude agent that classifies and routes the data.');
  });

  it('handles multiple nodes and creates correct edges', () => {
    const result = parseWorkflowMarkdown(sampleMarkdown);
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(2);

    const edge1 = result.edges[0];
    const edge2 = result.edges[1];

    // "Process Data" connects-from "Receive Input"
    expect(edge1.source).toBe(result.nodes[0].id); // Receive Input
    expect(edge1.target).toBe(result.nodes[1].id); // Process Data

    // "Generate Report" connects-from "Process Data"
    expect(edge2.source).toBe(result.nodes[1].id); // Process Data
    expect(edge2.target).toBe(result.nodes[2].id); // Generate Report
  });

  it('returns empty data for non-workflow markdown', () => {
    const result = parseWorkflowMarkdown('# Just a regular heading\n\nSome text.');
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('returns empty data for empty string', () => {
    const result = parseWorkflowMarkdown('');
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('handles nodes with no connections', () => {
    const md = `# Workflow: Standalone

## Node: Solo Task
<!-- type: output, position: 200, 200 -->
<!-- tags: standalone -->
A standalone task with no connections.
`;
    const result = parseWorkflowMarkdown(md);
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(0);
    expect(result.nodes[0].title).toBe('Solo Task');
    expect(result.nodes[0].type).toBe('output');
  });

  it('handles nodes with multiple connections', () => {
    const md = `# Workflow: Multi-connect

## Node: Source A
<!-- type: trigger, position: 100, 100 -->
Source A.

## Node: Source B
<!-- type: trigger, position: 100, 250 -->
Source B.

## Node: Merger
<!-- type: agent, position: 350, 175 -->
<!-- connects-from: Source A -->
<!-- connects-from: Source B -->
Merges both sources.
`;
    const result = parseWorkflowMarkdown(md);
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(2);

    const mergerNode = result.nodes.find((n) => n.title === 'Merger')!;
    const sourceA = result.nodes.find((n) => n.title === 'Source A')!;
    const sourceB = result.nodes.find((n) => n.title === 'Source B')!;

    expect(result.edges).toContainEqual({
      source: sourceA.id,
      target: mergerNode.id,
    });
    expect(result.edges).toContainEqual({
      source: sourceB.id,
      target: mergerNode.id,
    });
  });

  it('generates stable IDs from node titles', () => {
    const result = parseWorkflowMarkdown(sampleMarkdown);
    expect(result.nodes[0].id).toBe('receive-input');
    expect(result.nodes[1].id).toBe('process-data');
    expect(result.nodes[2].id).toBe('generate-report');
  });

  it('handles nodes with no tags', () => {
    const md = `# Workflow: No Tags

## Node: Plain Node
<!-- type: agent, position: 100, 100 -->
A node without tags.
`;
    const result = parseWorkflowMarkdown(md);
    expect(result.nodes[0].tags).toBeUndefined();
  });
});

describe('serializeWorkflow', () => {
  const sampleData: WorkflowData = {
    nodes: [
      {
        id: 'receive-input',
        type: 'trigger',
        title: 'Receive Input',
        description: 'Receives incoming HTTP requests and validates payload.',
        position: { x: 100, y: 100 },
        tags: ['input', 'webhook'],
      },
      {
        id: 'process-data',
        type: 'agent',
        title: 'Process Data',
        description: 'Claude agent that classifies and routes the data.',
        position: { x: 350, y: 100 },
        tags: ['ai', 'classification'],
      },
      {
        id: 'generate-report',
        type: 'script',
        title: 'Generate Report',
        description: 'Generates the final Markdown report.',
        position: { x: 600, y: 100 },
        tags: ['output', 'report'],
      },
    ],
    edges: [
      { source: 'receive-input', target: 'process-data' },
      { source: 'process-data', target: 'generate-report' },
    ],
  };

  it('produces valid markdown with workflow heading', () => {
    const md = serializeWorkflow(sampleData);
    expect(md).toContain('# Workflow');
  });

  it('includes node titles as ## Node: headers', () => {
    const md = serializeWorkflow(sampleData);
    expect(md).toContain('## Node: Receive Input');
    expect(md).toContain('## Node: Process Data');
    expect(md).toContain('## Node: Generate Report');
  });

  it('includes type and position metadata comments', () => {
    const md = serializeWorkflow(sampleData);
    expect(md).toContain('<!-- type: trigger, position: 100, 100 -->');
    expect(md).toContain('<!-- type: agent, position: 350, 100 -->');
  });

  it('includes connects-from comments for edges', () => {
    const md = serializeWorkflow(sampleData);
    expect(md).toContain('<!-- connects-from: Receive Input -->');
    expect(md).toContain('<!-- connects-from: Process Data -->');
  });

  it('includes tags comments', () => {
    const md = serializeWorkflow(sampleData);
    expect(md).toContain('<!-- tags: input, webhook -->');
    expect(md).toContain('<!-- tags: ai, classification -->');
  });

  it('includes node descriptions', () => {
    const md = serializeWorkflow(sampleData);
    expect(md).toContain('Receives incoming HTTP requests and validates payload.');
    expect(md).toContain('Claude agent that classifies and routes the data.');
  });

  it('handles nodes without tags', () => {
    const data: WorkflowData = {
      nodes: [
        {
          id: 'solo',
          type: 'output',
          title: 'Solo',
          description: 'A solo node.',
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
    };
    const md = serializeWorkflow(data);
    expect(md).not.toContain('<!-- tags:');
  });

  it('handles empty workflow data', () => {
    const md = serializeWorkflow({ nodes: [], edges: [] });
    expect(md).toContain('# Workflow');
  });
});

describe('round-trip fidelity', () => {
  it('parse(serialize(data)) preserves all node data', () => {
    const original: WorkflowData = {
      nodes: [
        {
          id: 'start',
          type: 'trigger',
          title: 'Start',
          description: 'The beginning.',
          position: { x: 100, y: 200 },
          tags: ['init'],
        },
        {
          id: 'end',
          type: 'output',
          title: 'End',
          description: 'The conclusion.',
          position: { x: 400, y: 200 },
          tags: ['final'],
        },
      ],
      edges: [{ source: 'start', target: 'end' }],
    };

    const serialized = serializeWorkflow(original);
    const parsed = parseWorkflowMarkdown(serialized);

    expect(parsed.nodes).toHaveLength(original.nodes.length);
    expect(parsed.edges).toHaveLength(original.edges.length);

    for (const origNode of original.nodes) {
      const parsedNode = parsed.nodes.find((n) => n.id === origNode.id);
      expect(parsedNode).toBeDefined();
      expect(parsedNode!.type).toBe(origNode.type);
      expect(parsedNode!.title).toBe(origNode.title);
      expect(parsedNode!.description).toBe(origNode.description);
      expect(parsedNode!.position).toEqual(origNode.position);
      expect(parsedNode!.tags).toEqual(origNode.tags);
    }

    for (const origEdge of original.edges) {
      expect(parsed.edges).toContainEqual(origEdge);
    }
  });

  it('serialize(parse(markdown)) preserves structure', () => {
    const md = `# Workflow: Test

## Node: Alpha
<!-- type: agent, position: 50, 75 -->
<!-- tags: test -->
Alpha description.

## Node: Beta
<!-- type: script, position: 300, 75 -->
<!-- connects-from: Alpha -->
Beta description.
`;
    const parsed = parseWorkflowMarkdown(md);
    const reserialized = serializeWorkflow(parsed);
    const reparsed = parseWorkflowMarkdown(reserialized);

    expect(reparsed.nodes).toHaveLength(parsed.nodes.length);
    expect(reparsed.edges).toHaveLength(parsed.edges.length);

    for (let i = 0; i < parsed.nodes.length; i++) {
      expect(reparsed.nodes[i].id).toBe(parsed.nodes[i].id);
      expect(reparsed.nodes[i].title).toBe(parsed.nodes[i].title);
      expect(reparsed.nodes[i].type).toBe(parsed.nodes[i].type);
      expect(reparsed.nodes[i].position).toEqual(parsed.nodes[i].position);
      expect(reparsed.nodes[i].description).toBe(parsed.nodes[i].description);
    }
  });
});
