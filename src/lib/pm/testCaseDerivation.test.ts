import { describe, it, expect } from 'vitest';
import { generateTestCaseDerivationPrompt, parseTestCaseResponse } from './testCaseDerivation';
import type { PmTicket } from '../tauri/pm';

describe('testCaseDerivation', () => {
  const mockTicket: PmTicket = {
    id: 't1',
    epicId: 'e1',
    name: 'User Login',
    description: 'Allow users to log in with email and password.',
    status: 'open',
    statusUpdatedAt: '',
    sortOrder: 0,
    priority: 'normal',
    createdAt: '',
    updatedAt: '',
  };

  it('should generate a prompt containing ticket details', () => {
    const prompt = generateTestCaseDerivationPrompt(mockTicket);
    expect(prompt).toContain('User Login');
    expect(prompt).toContain('Allow users to log in with email and password.');
    expect(prompt).toContain('TestRail');
  });

  it('should parse a valid LLM response', () => {
    const response = `
TITLE: Successful Login
BODY: 
1. Enter valid email
2. Enter valid password
3. Click login
EXPECTED: User is redirected to dashboard

TITLE: Invalid Password
BODY:
1. Enter valid email
2. Enter wrong password
3. Click login
EXPECTED: Error message "Invalid credentials" is shown
`;
    const testCases = parseTestCaseResponse(response);
    expect(testCases).toHaveLength(2);
    expect(testCases[0].title).toBe('Successful Login');
    expect(testCases[0].body).toContain('Enter valid email');
    expect(testCases[1].title).toBe('Invalid Password');
    expect(testCases[1].body).toContain('Error message "Invalid credentials"');
  });

  it('should handle empty or malformed response', () => {
    expect(parseTestCaseResponse('')).toHaveLength(0);
    expect(parseTestCaseResponse('Just some text without tags')).toHaveLength(0);
  });
});
