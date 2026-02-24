import { describe, expect, it } from 'vitest';
import { buildImportSpecPrompt } from './importSpecPrompt';

describe('buildImportSpecPrompt', () => {
  it('includes the spec text in the prompt', () => {
    const prompt = buildImportSpecPrompt('My project spec here');
    expect(prompt).toContain('My project spec here');
  });

  it('includes MCP tool instructions for create_epic', () => {
    const prompt = buildImportSpecPrompt('spec');
    expect(prompt).toContain('create_epic');
  });

  it('includes MCP tool instructions for create_ticket', () => {
    const prompt = buildImportSpecPrompt('spec');
    expect(prompt).toContain('create_ticket');
  });

  it('includes MCP tool instructions for create_dependency', () => {
    const prompt = buildImportSpecPrompt('spec');
    expect(prompt).toContain('create_dependency');
  });

  it('includes MCP tool instructions for create_test_case', () => {
    const prompt = buildImportSpecPrompt('spec');
    expect(prompt).toContain('create_test_case');
  });

  it('includes standard epic: QA', () => {
    const prompt = buildImportSpecPrompt('spec');
    expect(prompt).toContain('QA');
    expect(prompt).toMatch(/testing.strategy|ui.test|integration.test/i);
  });

  it('includes standard epic: UI/UX', () => {
    const prompt = buildImportSpecPrompt('spec');
    expect(prompt).toContain('UI/UX');
    expect(prompt).toMatch(/user.journey|accessibility|onboarding/i);
  });

  it('includes standard epic: Tech Stack & DevOps', () => {
    const prompt = buildImportSpecPrompt('spec');
    expect(prompt).toMatch(/Tech Stack|DevOps/);
    expect(prompt).toMatch(/ci\/cd|linter|pre-commit/i);
  });

  it('includes duplicate check instruction (list_epics first)', () => {
    const prompt = buildImportSpecPrompt('spec');
    expect(prompt).toContain('list_epics');
  });

  it('includes priority guidelines', () => {
    const prompt = buildImportSpecPrompt('spec');
    expect(prompt).toContain('critical');
    expect(prompt).toContain('high');
    expect(prompt).toContain('normal');
    expect(prompt).toContain('low');
  });

  it('specifies order: epics → tickets → dependencies → test cases', () => {
    const prompt = buildImportSpecPrompt('spec');
    const epicIdx = prompt.indexOf('Epics');
    const ticketIdx = prompt.indexOf('Tickets', epicIdx);
    const depIdx = prompt.indexOf('Dependencies', ticketIdx);
    const tcIdx = prompt.indexOf('Test Cases', depIdx);
    expect(epicIdx).toBeLessThan(ticketIdx);
    expect(ticketIdx).toBeLessThan(depIdx);
    expect(depIdx).toBeLessThan(tcIdx);
  });

  it('instructs autonomous work without asking questions', () => {
    const prompt = buildImportSpecPrompt('spec');
    expect(prompt).toMatch(/autonomous|without.*(asking|question|clarif)/i);
  });

  it('handles empty spec text gracefully', () => {
    const prompt = buildImportSpecPrompt('');
    expect(prompt).toBeDefined();
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain('create_epic');
  });

  it('handles very long spec text (100k chars)', () => {
    const longSpec = 'A'.repeat(100_000);
    const prompt = buildImportSpecPrompt(longSpec);
    expect(prompt).toContain(longSpec);
    expect(prompt).toContain('create_epic');
  });
});
