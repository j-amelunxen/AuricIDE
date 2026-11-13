import { describe, expect, it } from 'vitest';
import { serializeWorkflow, type WorkflowData } from './markdownParser';

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
