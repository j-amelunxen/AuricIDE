import { describe, expect, it } from 'vitest';
import { extractTicket, resolveCommandTemplate } from './branchTicket';

describe('extractTicket', () => {
  const defaultPattern = '([A-Z]+-\\d+)';

  it('extracts ticket from feature branch', () => {
    expect(extractTicket('feature/AB-1234-your-ticket-text', defaultPattern)).toBe('AB-1234');
  });

  it('extracts ticket from bugfix branch', () => {
    expect(extractTicket('bugfix/JIRA-42-fix-login', defaultPattern)).toBe('JIRA-42');
  });

  it('extracts first match when multiple tickets exist', () => {
    expect(extractTicket('feature/AB-1234-and-AB-5678', defaultPattern)).toBe('AB-1234');
  });

  it('returns null when no match', () => {
    expect(extractTicket('main', defaultPattern)).toBeNull();
  });

  it('returns null for empty branch', () => {
    expect(extractTicket('', defaultPattern)).toBeNull();
  });

  it('returns null for empty pattern', () => {
    expect(extractTicket('feature/AB-1234', '')).toBeNull();
  });

  it('returns null for invalid regex', () => {
    expect(extractTicket('feature/AB-1234', '([invalid')).toBeNull();
  });

  it('works with custom pattern', () => {
    expect(extractTicket('feature/1234-description', '(\\d+)')).toBe('1234');
  });

  it('handles branch with only ticket ID', () => {
    expect(extractTicket('AB-999', defaultPattern)).toBe('AB-999');
  });
});

describe('resolveCommandTemplate', () => {
  const defaultPattern = '([A-Z]+-\\d+)';

  it('replaces {ticket} with extracted value', () => {
    const result = resolveCommandTemplate(
      'claude -p "commit. Prefix: {ticket}:" --model sonnet',
      'feature/AB-1234-your-ticket-text',
      defaultPattern
    );
    expect(result).toBe('claude -p "commit. Prefix: AB-1234:" --model sonnet');
  });

  it('replaces {branch} with full branch name', () => {
    const result = resolveCommandTemplate(
      'echo {branch}',
      'feature/AB-1234-your-ticket-text',
      defaultPattern
    );
    expect(result).toBe('echo feature/AB-1234-your-ticket-text');
  });

  it('replaces both {ticket} and {branch}', () => {
    const result = resolveCommandTemplate(
      '{ticket} on {branch}',
      'feature/AB-1234-your-ticket-text',
      defaultPattern
    );
    expect(result).toBe('AB-1234 on feature/AB-1234-your-ticket-text');
  });

  it('replaces {ticket} with empty string when no match', () => {
    const result = resolveCommandTemplate(
      'claude -p "commit. Prefix: {ticket}:" --model sonnet',
      'main',
      defaultPattern
    );
    expect(result).toBe('claude -p "commit. Prefix: :" --model sonnet');
  });

  it('returns command unchanged when no placeholders', () => {
    const result = resolveCommandTemplate(
      'git commit -m "hello"',
      'feature/AB-1234',
      defaultPattern
    );
    expect(result).toBe('git commit -m "hello"');
  });

  it('handles empty branch gracefully', () => {
    const result = resolveCommandTemplate('{ticket} {branch}', '', defaultPattern);
    expect(result).toBe(' ');
  });
});
