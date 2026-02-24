import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

export const auricTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'transparent',
      color: '#e2e8f0',
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      fontFeatureSettings: '"liga" 1, "calt" 1',
      textRendering: 'optimizeLegibility',
    },
    '.cm-content': {
      caretColor: '#bc13fe',
      padding: '12px 0',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: '#bc13fe',
      borderLeftWidth: '2px',
      boxShadow: '0 0 8px rgba(188, 19, 254, 0.6)',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'rgba(188, 19, 254, 0.25)',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255, 255, 255, 0.03)',
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: '#475569',
      borderRight: '1px solid rgba(255, 255, 255, 0.05)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
      color: '#bc13fe',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 12px 0 16px',
      minWidth: '44px',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'rgba(188, 19, 254, 0.1)',
      border: '1px solid rgba(188, 19, 254, 0.2)',
      color: '#94a3b8',
    },
    '.cm-foldGutter .cm-gutterElement': {
      padding: '0 4px',
      cursor: 'pointer',
      color: '#475569',
      transition: 'color 0.15s',
    },
    '.cm-foldGutter .cm-gutterElement:hover': {
      color: '#bc13fe',
    },
    '.cm-tooltip': {
      backgroundColor: '#0a0a10',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      color: '#e2e8f0',
      backdropFilter: 'blur(8px)',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'rgba(188, 19, 254, 0.2)',
    },
    '.cm-slash-option': {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    },
    '.cm-slash-icon': {
      fontSize: '14px',
      opacity: '0.7',
    },
    '.cm-slash-category': {
      fontSize: '9px',
      opacity: '0.5',
      marginLeft: 'auto',
      padding: '0 4px',
      borderRadius: '3px',
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
    },

    // Markdown Block Enhancements
    '.cm-content .cm-line': {
      padding: '0 4px',
    },
    '.cm-blockquote': {
      borderLeft: '3px solid #bc13fe',
      paddingLeft: '12px',
      color: '#94a3b8',
      fontStyle: 'italic',
      backgroundColor: 'rgba(188, 19, 254, 0.03)',
      margin: '4px 0',
    },
    '.cm-codeBlock': {
      backgroundColor: 'rgba(0, 0, 0, 0.3)',
      border: '1px solid rgba(255, 255, 255, 0.05)',
      borderRadius: '4px',
      fontFamily: 'var(--font-mono)',
      margin: '4px 0',
    },

    // Search panel
    '.cm-panels': {
      backgroundColor: '#0a0a10',
      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
    },
    '.cm-panels.cm-panels-top': {
      borderBottom: '1px solid rgba(188, 19, 254, 0.2)',
    },
    '.cm-search': {
      padding: '6px 12px',
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: '4px',
      fontSize: '12px',
    },
    '.cm-search label': {
      color: '#94a3b8',
      fontSize: '11px',
    },
    '.cm-search input, .cm-search button:not(.cm-button)': {
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '4px',
      color: '#e2e8f0',
      padding: '2px 8px',
      fontSize: '12px',
      outline: 'none',
    },
    '.cm-search input:focus': {
      borderColor: 'rgba(188, 19, 254, 0.5)',
      boxShadow: '0 0 6px rgba(188, 19, 254, 0.2)',
    },
    '.cm-button': {
      backgroundColor: 'rgba(188, 19, 254, 0.1)',
      border: '1px solid rgba(188, 19, 254, 0.2)',
      borderRadius: '4px',
      color: '#c084fc',
      padding: '2px 8px',
      fontSize: '11px',
      cursor: 'pointer',
    },
    '.cm-button:hover': {
      backgroundColor: 'rgba(188, 19, 254, 0.2)',
    },
    '.cm-searchMatch': {
      backgroundColor: 'rgba(188, 19, 254, 0.25)',
      outline: '1px solid rgba(188, 19, 254, 0.4)',
    },
    '.cm-searchMatch-selected': {
      backgroundColor: 'rgba(188, 19, 254, 0.45)',
    },
    '.cm-selectionMatch': {
      backgroundColor: 'rgba(255, 255, 255, 0.08)',
    },
  },
  { dark: true }
);

export const auricHighlightStyle = syntaxHighlighting(
  HighlightStyle.define([
    // Keywords & Logic
    {
      tag: [tags.keyword, tags.modifier, tags.operatorKeyword],
      color: '#c084fc',
      fontWeight: 'bold',
    },
    { tag: [tags.controlKeyword, tags.moduleKeyword], color: '#d66aff', fontWeight: 'bold' },

    // Comments
    { tag: tags.comment, color: '#6a7c8f', fontStyle: 'italic' },

    // Literals
    { tag: tags.string, color: '#86efac' },
    { tag: tags.number, color: '#fbbf24' },
    { tag: [tags.bool, tags.null], color: '#ff9d00', fontWeight: 'bold' },
    { tag: tags.regexp, color: '#ff7eb6' },
    { tag: tags.escape, color: '#fbbf24' },

    // Names & Variables
    { tag: [tags.variableName, tags.definition(tags.variableName)], color: '#e2e8f0' },
    { tag: tags.local(tags.variableName), color: '#93c5fd' },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#60a5fa' },
    { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: '#93c5fd' },
    { tag: [tags.className, tags.typeName, tags.namespace], color: '#fbbf24', fontStyle: 'italic' },
    { tag: tags.macroName, color: '#ff7eb6' },
    { tag: tags.constant(tags.variableName), color: '#fbbf24', fontWeight: 'bold' },

    // Markdown specific
    {
      tag: tags.heading,
      color: '#bc13fe',
      fontWeight: 'bold',
      textShadow: '0 0 10px rgba(188, 19, 254, 0.3)',
    },
    { tag: tags.heading1, fontSize: '1.6em', borderBottom: '1px solid rgba(188, 19, 254, 0.2)' },
    { tag: tags.heading2, fontSize: '1.4em', color: '#d66aff' },
    { tag: tags.heading3, fontSize: '1.2em', color: '#e086ff' },
    { tag: tags.emphasis, fontStyle: 'italic', color: '#93c5fd' },
    {
      tag: tags.strong,
      fontWeight: 'bold',
      color: '#ffffff',
      textShadow: '0 0 5px rgba(255, 255, 255, 0.2)',
    },
    { tag: tags.link, color: '#137fec', textDecoration: 'underline' },
    { tag: tags.url, color: '#137fec', opacity: 0.7 },
    { tag: tags.strikethrough, textDecoration: 'line-through', opacity: 0.5 },

    // Markdown structure
    { tag: tags.list, color: '#bc13fe', fontWeight: 'bold' },
    { tag: tags.quote, color: '#94a3b8', fontStyle: 'italic' },
    {
      tag: tags.monospace,
      color: '#00f0ff',
      backgroundColor: 'rgba(0, 240, 255, 0.1)',
      padding: '1px 4px',
      borderRadius: '3px',
      border: '1px solid rgba(0, 240, 255, 0.2)',
    },
    { tag: tags.meta, color: '#6a7c8f' },
    { tag: tags.contentSeparator, color: '#bc13fe', fontWeight: 'bold' },

    // Web / XML
    { tag: tags.tagName, color: '#bc13fe' },
    { tag: tags.attributeName, color: '#93c5fd' },
    { tag: tags.attributeValue, color: '#86efac' },

    // Punctuation & Operators
    { tag: [tags.punctuation, tags.separator, tags.bracket], color: '#94a3b8' },
    { tag: tags.operator, color: '#c084fc' },

    // Meta & Processing
    { tag: [tags.meta, tags.processingInstruction], color: '#6a7c8f' },
    { tag: tags.invalid, color: '#ff4a4a' },
  ])
);
