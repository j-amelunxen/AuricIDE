/**
 * Builds a prompt that instructs an AI agent to parse a project specification
 * and create Epics, Tickets, Dependencies, and Test Cases via MCP tools.
 */
export function buildImportSpecPrompt(specText: string): string {
  return `You are a project management agent. Your job is to analyze the following project specification and set up the project structure using the available MCP tools. Work autonomously without asking any clarification questions.

## Available MCP Tools

### Epics
- list_epics() — List all epics with ticket counts (call FIRST to check for duplicates)
- list_epics_with_tickets() — List all epics with their full tickets nested inside
- get_epic_with_tickets({ epicId }) — Get a single epic with all its tickets
- create_epic({ name, description? }) — Create a new epic

### Tickets
- list_tickets({ status?, epicId? }) — List tickets, optionally filtered by status or epic
- create_ticket({ epicId, name, description?, priority? }) — Create a ticket in an epic
- update_ticket({ id, status?, name?, description?, priority?, needsHumanSupervision? }) — Update a ticket

### Dependencies
- create_dependency({ sourceId, targetId, sourceType?, targetType? }) — Source depends on target (target blocks source). Idempotent.
- list_dependencies({ ticketId? }) — List dependencies with enriched names and statuses

### Test Cases
- create_test_case({ ticketId, title, body? }) — Create a test case for a ticket

### Context (attach reference material to tickets for agents)
- add_context_snippet({ ticketId, value }) — Attach a text/code snippet to a ticket
- add_context_file({ ticketId, filePath }) — Attach a file reference to a ticket (path relative to project root)

### Task Workflow (not needed during import, listed for awareness)
- fetch_next_task() — Get the highest-priority open ticket and set it to in_progress
- fetch_next_unblocked_task() — Like fetch_next_task but skips tickets with unfinished dependencies
- complete_task({ id, summary? }) — Mark a ticket as done

## Execution Order

Follow this exact order:

1. **Check existing state** — Call list_epics() first. If epics already exist, use list_epics_with_tickets() to understand what is already set up. Only create items that do not already exist.
2. **Epics** — Create epics for each logical grouping in the specification.
3. **Tickets** — Create tickets for each epic, assigning appropriate priorities and detailed descriptions.
4. **Dependencies** — Create dependencies between tickets where one ticket blocks another. Semantics: source depends on target (target blocks source).
5. **Test Cases** — Create test cases for tickets that need verification.This is especially important for user interaction tests like for example UI tests which we need to build as end-to-end tests 
6. **Context** — If the specification references specific files or contains code snippets relevant to particular tickets, attach them using add_context_file or add_context_snippet. Also: ALWAYS add to the context area some context about what this tickle does in relation to this whole epic. So what is the main functionality that we are looking for, what we are trying to build and what part of the bigger hole is this tickle trying to solve. 

## Standard Epics

Always ensure these standard epics exist (create them if missing):

### QA
Testing strategy, UI tests, integration tests, stability verification, external system dependency handling, fallback strategies.

### UI/UX
User journeys, accessibility (a11y), learning curve considerations, onboarding flows, responsive design.

### Tech Stack & DevOps
Pre-commit hooks, linter configuration, code duplication avoidance, stack decisions, CI/CD pipeline setup.

## Priority Guidelines

Assign priorities based on these criteria:
- **critical** — Blocking issues, security vulnerabilities, data loss risks
- **high** — Core features required for MVP, architectural decisions
- **normal** — Standard features, improvements, nice-to-haves for v1
- **low** — Future improvements, polish, non-essential optimizations

## Project Specification

${specText}

## Instructions

Parse the specification above and:
1. Extract all features, requirements, and tasks
2. Group them into logical epics (including the standard epics above)
3. Create detailed tickets with clear descriptions
4. Establish dependencies between related tickets
5. Add test cases for testable requirements
6. Attach relevant context (file paths or snippets) to tickets where applicable

Work completely autonomously. Do not ask questions — make reasonable decisions based on the specification.`;
}
