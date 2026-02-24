import { Facet } from '@codemirror/state';
import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';

export type SlashCommandCategory = 'Heading' | 'Block' | 'Inline' | 'Diagram' | 'Meta' | 'Callout';

export interface SlashCommand {
  trigger: string;
  label: string;
  template: string;
  icon?: string;
  category?: SlashCommandCategory;
  isCustom?: boolean;
}

export const slashCommands: SlashCommand[] = [
  { trigger: 'h1', label: 'Heading 1', template: '# ', icon: 'title', category: 'Heading' },
  { trigger: 'h2', label: 'Heading 2', template: '## ', icon: 'title', category: 'Heading' },
  { trigger: 'h3', label: 'Heading 3', template: '### ', icon: 'title', category: 'Heading' },
  { trigger: 'h4', label: 'Heading 4', template: '#### ', icon: 'title', category: 'Heading' },
  { trigger: 'h5', label: 'Heading 5', template: '##### ', icon: 'title', category: 'Heading' },
  { trigger: 'h6', label: 'Heading 6', template: '###### ', icon: 'title', category: 'Heading' },
  { trigger: 'code', label: 'Code Block', template: '```\n\n```', icon: 'code', category: 'Block' },
  {
    trigger: 'table',
    label: 'Table',
    template: '| Col | Col |\n| --- | --- |\n|     |     |',
    icon: 'table',
    category: 'Block',
  },
  {
    trigger: 'hr',
    label: 'Horizontal Rule',
    template: '---\n',
    icon: 'horizontal_rule',
    category: 'Block',
  },
  {
    trigger: 'quote',
    label: 'Blockquote',
    template: '> ',
    icon: 'format_quote',
    category: 'Block',
  },
  { trigger: 'link', label: 'Link', template: '[text](url)', icon: 'link', category: 'Inline' },
  { trigger: 'image', label: 'Image', template: '![alt](url)', icon: 'image', category: 'Inline' },
  { trigger: 'task', label: 'Task List', template: '- [ ] ', icon: 'check_box', category: 'Block' },
  {
    trigger: 'mermaid',
    label: 'Mermaid Diagram',
    template: '```mermaid\ngraph TD\n  A-->B\n```',
    icon: 'schema',
    category: 'Diagram',
  },
  {
    trigger: 'callout',
    label: 'Callout',
    template: '> [!NOTE]\n> ',
    icon: 'info',
    category: 'Callout',
  },
  // New commands
  {
    trigger: 'details',
    label: 'Collapsible Details',
    template: '<details>\n<summary>Summary</summary>\n\nContent\n\n</details>',
    icon: 'expand_more',
    category: 'Block',
  },
  {
    trigger: 'footnote',
    label: 'Footnote',
    template: '[^1]: ',
    icon: 'superscript',
    category: 'Inline',
  },
  {
    trigger: 'math',
    label: 'Math Block',
    template: '$$\n\n$$',
    icon: 'function',
    category: 'Block',
  },
  {
    trigger: 'def',
    label: 'Definition List',
    template: 'Term\n: Definition',
    icon: 'format_list_bulleted',
    category: 'Block',
  },
  {
    trigger: 'toc',
    label: 'Table of Contents',
    template: '[TOC]',
    icon: 'toc',
    category: 'Meta',
  },
  {
    trigger: 'frontmatter',
    label: 'Front Matter',
    template: '---\ntitle: \ndate: \ntags: []\n---',
    icon: 'settings',
    category: 'Meta',
  },
  {
    trigger: 'warning',
    label: 'Warning Callout',
    template: '> [!WARNING]\n> ',
    icon: 'warning',
    category: 'Callout',
  },
  {
    trigger: 'tip',
    label: 'Tip Callout',
    template: '> [!TIP]\n> ',
    icon: 'lightbulb',
    category: 'Callout',
  },
  {
    trigger: 'info',
    label: 'Info Callout',
    template: '> [!INFO]\n> ',
    icon: 'info',
    category: 'Callout',
  },
  {
    trigger: 'danger',
    label: 'Danger Callout',
    template: '> [!DANGER]\n> ',
    icon: 'dangerous',
    category: 'Callout',
  },
];

export function mergeSlashCommands(
  defaults: SlashCommand[],
  custom: SlashCommand[]
): SlashCommand[] {
  if (custom.length === 0) return defaults;

  const map = new Map<string, SlashCommand>();
  for (const cmd of defaults) {
    map.set(cmd.trigger, cmd);
  }
  for (const cmd of custom) {
    map.set(cmd.trigger, { ...cmd, isCustom: true });
  }
  return Array.from(map.values());
}

export const slashCommandsFacet = Facet.define<SlashCommand[], SlashCommand[]>({
  combine: (values) => {
    const flat = values.flat();
    return flat.length > 0 ? flat : slashCommands;
  },
});

/**
 * Check whether a position is inside a fenced code block.
 */
function isInsideCodeFence(doc: string, pos: number): boolean {
  let inFence = false;
  let offset = 0;
  const lines = doc.split('\n');

  for (const line of lines) {
    if (/^```/.test(line)) {
      inFence = !inFence;
    }
    offset += line.length + 1;
    if (offset > pos) break;
  }

  return inFence;
}

export function slashCommandSource(ctx: CompletionContext): CompletionResult | null {
  // Match `/` preceded by line start or whitespace
  const match = ctx.matchBefore(/(?:^|(?<=\s))\/\w*/);
  if (!match) return null;

  const doc = ctx.state.doc.toString();

  // Don't trigger inside code fences
  if (isInsideCodeFence(doc, match.from)) return null;

  const typed = match.text.slice(1).toLowerCase(); // remove the leading /

  const cmds = ctx.state.facet(slashCommandsFacet);

  const options: Completion[] = cmds
    .filter(
      (cmd) =>
        cmd.trigger.toLowerCase().startsWith(typed) || cmd.label.toLowerCase().includes(typed)
    )
    .map((cmd) => ({
      label: cmd.label,
      detail: `/${cmd.trigger}`,
      _slashCmd: cmd,
      apply: (
        view: import('@codemirror/view').EditorView,
        _completion: Completion,
        _from: number,
        to: number
      ) => {
        view.dispatch({
          changes: { from: match.from, to, insert: cmd.template },
        });
      },
    }));

  if (options.length === 0) return null;

  return {
    from: match.from,
    options,
    filter: false,
  };
}

export const slashCommandRenderOption = {
  position: 50,
  render(completion: Completion & { _slashCmd?: SlashCommand }): Node | null {
    const cmd = completion._slashCmd;
    if (!cmd) return null;

    const wrapper = document.createElement('div');
    wrapper.className = 'cm-slash-option';

    if (cmd.icon) {
      const icon = document.createElement('span');
      icon.className = 'cm-slash-icon material-symbols-outlined';
      icon.style.fontSize = '14px';
      icon.textContent = cmd.icon;
      wrapper.appendChild(icon);
    }

    const label = document.createElement('span');
    label.className = 'cm-slash-label';
    label.textContent = cmd.label;
    wrapper.appendChild(label);

    if (cmd.category) {
      const badge = document.createElement('span');
      badge.className = 'cm-slash-category';
      badge.textContent = cmd.category;
      wrapper.appendChild(badge);
    }

    return wrapper;
  },
};
