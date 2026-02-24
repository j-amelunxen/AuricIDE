// Shared structural patterns for the Markdown Intelligence Layer.
// Used by the highlighter (structural keywords) and the entity index (find references).
//
// NOTE: Action, parameter, and concept detection has been moved to wink-nlp
// (see winkAnalyzer.ts) for context-aware POS-based classification.

// 1. Structural Signal Keywords (Critical)
export const STRUCTURE_REGEX =
  /\b(?:TODO|FIXME|HACK|NOTE|IMPORTANT|WARNING|CAUTION|ERROR|FAILED|SUCCESS|DONE|PENDING|QUEUED)\b/g;

// 2. Prompt Framework Indicators (The "MPF" from the report)
export const PROMPT_DIRECTIVE_REGEX = /^(?:Task:|Objective:|Goal:|Directive:)\s*(.*)$/gm;
export const PROMPT_CONTEXT_REGEX = /^(?:Context:|Background:|Scenario:|Role:)\s*(.*)$/gm;
export const PROMPT_CONSTRAINT_REGEX =
  /^(?:Constraint:|Requirement:|Restriction:|Output:|Format:)\s*(.*)$/gm;

// 3. Architectural Entities (PascalCase / UPPER_CASE)
// Kept for find-references and entity-index (external consumers).
export const ENTITY_REGEX = /\b(?:[A-Z][a-z]+(?:[A-Z][a-z]+)+|[A-Z]{2,}(?:_[A-Z0-9]+)*)\b/g;

// 4. PascalCase detector (at least two uppercase-led segments)
// Used by winkAnalyzer as fallback for tokens not tagged PROPN.
export const PASCAL_CASE_REGEX = /^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/;
