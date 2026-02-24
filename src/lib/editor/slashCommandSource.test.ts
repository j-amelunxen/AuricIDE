import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { CompletionContext } from '@codemirror/autocomplete';
import {
  slashCommandSource,
  slashCommands,
  mergeSlashCommands,
  slashCommandsFacet,
  slashCommandRenderOption,
  type SlashCommand,
} from './slashCommandSource';

function getCompletions(doc: string, pos?: number) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage })],
    selection: { anchor: pos ?? doc.length },
  });
  const ctx = new CompletionContext(state, pos ?? doc.length, false);
  return slashCommandSource(ctx);
}

describe('slashCommandSource', () => {
  it('returns completions for / at line start', () => {
    const result = getCompletions('/');
    expect(result).not.toBeNull();
    expect(result!.options.length).toBeGreaterThan(0);
  });

  it('returns completions after whitespace + /', () => {
    const result = getCompletions('some text\n  /');
    expect(result).not.toBeNull();
    expect(result!.options.length).toBeGreaterThan(0);
  });

  it('returns null for / mid-word', () => {
    const result = getCompletions('hello/');
    expect(result).toBeNull();
  });

  it('returns null inside a code block', () => {
    const doc = '```\n/\n```';
    const pos = doc.indexOf('/') + 1;
    const result = getCompletions(doc, pos);
    expect(result).toBeNull();
  });

  it('filters by typed text', () => {
    const result = getCompletions('/ta');
    expect(result).not.toBeNull();
    // /table and /task should match
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain('Table');
    expect(labels).toContain('Task List');
    // /h1 should not match
    expect(labels).not.toContain('Heading 1');
  });

  it('includes all expected slash commands', () => {
    const result = getCompletions('/');
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain('Heading 1');
    expect(labels).toContain('Heading 6');
    expect(labels).toContain('Code Block');
    expect(labels).toContain('Table');
    expect(labels).toContain('Horizontal Rule');
    expect(labels).toContain('Blockquote');
    expect(labels).toContain('Link');
    expect(labels).toContain('Image');
    expect(labels).toContain('Task List');
    expect(labels).toContain('Mermaid Diagram');
    expect(labels).toContain('Callout');
  });

  it('has correct template for code block', () => {
    const cmd = slashCommands.find((c) => c.label === 'Code Block');
    expect(cmd).toBeDefined();
    expect(cmd!.template).toContain('```');
  });

  it('has correct template for table', () => {
    const cmd = slashCommands.find((c) => c.label === 'Table');
    expect(cmd).toBeDefined();
    expect(cmd!.template).toContain('|');
  });

  it('has correct template for mermaid', () => {
    const cmd = slashCommands.find((c) => c.label === 'Mermaid Diagram');
    expect(cmd).toBeDefined();
    expect(cmd!.template).toContain('```mermaid');
  });

  it('has correct template for callout', () => {
    const cmd = slashCommands.find((c) => c.label === 'Callout');
    expect(cmd).toBeDefined();
    expect(cmd!.template).toContain('> [!NOTE]');
  });
});

describe('slashCommands – extended defaults', () => {
  it('has 25 default commands', () => {
    expect(slashCommands.length).toBe(25);
  });

  it('every default has icon and category', () => {
    for (const cmd of slashCommands) {
      expect(cmd.icon, `${cmd.trigger} missing icon`).toBeDefined();
      expect(cmd.category, `${cmd.trigger} missing category`).toBeDefined();
    }
  });

  it('includes the 10 new commands', () => {
    const triggers = slashCommands.map((c) => c.trigger);
    expect(triggers).toContain('details');
    expect(triggers).toContain('footnote');
    expect(triggers).toContain('math');
    expect(triggers).toContain('def');
    expect(triggers).toContain('toc');
    expect(triggers).toContain('frontmatter');
    expect(triggers).toContain('warning');
    expect(triggers).toContain('tip');
    expect(triggers).toContain('info');
    expect(triggers).toContain('danger');
  });

  it('has correct template for details', () => {
    const cmd = slashCommands.find((c) => c.trigger === 'details');
    expect(cmd).toBeDefined();
    expect(cmd!.template).toContain('<details>');
    expect(cmd!.template).toContain('<summary>');
    expect(cmd!.template).toContain('</details>');
  });

  it('has correct template for math block', () => {
    const cmd = slashCommands.find((c) => c.trigger === 'math');
    expect(cmd).toBeDefined();
    expect(cmd!.template).toContain('$$');
  });

  it('has correct template for frontmatter', () => {
    const cmd = slashCommands.find((c) => c.trigger === 'frontmatter');
    expect(cmd).toBeDefined();
    expect(cmd!.template).toContain('---');
    expect(cmd!.template).toContain('title:');
  });

  it('has correct template for callout variants', () => {
    const warning = slashCommands.find((c) => c.trigger === 'warning');
    expect(warning!.template).toContain('> [!WARNING]');

    const tip = slashCommands.find((c) => c.trigger === 'tip');
    expect(tip!.template).toContain('> [!TIP]');

    const info = slashCommands.find((c) => c.trigger === 'info');
    expect(info!.template).toContain('> [!INFO]');

    const danger = slashCommands.find((c) => c.trigger === 'danger');
    expect(danger!.template).toContain('> [!DANGER]');
  });

  it('has correct template for footnote', () => {
    const cmd = slashCommands.find((c) => c.trigger === 'footnote');
    expect(cmd).toBeDefined();
    expect(cmd!.template).toContain('[^');
  });

  it('has correct template for definition list', () => {
    const cmd = slashCommands.find((c) => c.trigger === 'def');
    expect(cmd).toBeDefined();
    expect(cmd!.template).toContain(': ');
  });

  it('has correct template for toc', () => {
    const cmd = slashCommands.find((c) => c.trigger === 'toc');
    expect(cmd).toBeDefined();
    expect(cmd!.template).toContain('[TOC]');
  });

  it('assigns correct categories to headings', () => {
    const headings = slashCommands.filter((c) => /^h[1-6]$/.test(c.trigger));
    expect(headings.length).toBe(6);
    for (const h of headings) {
      expect(h.category).toBe('Heading');
    }
  });

  it('assigns correct categories to callout variants', () => {
    const callouts = slashCommands.filter((c) =>
      ['callout', 'warning', 'tip', 'info', 'danger'].includes(c.trigger)
    );
    for (const c of callouts) {
      expect(c.category).toBe('Callout');
    }
  });
});

describe('mergeSlashCommands', () => {
  const defaults: SlashCommand[] = [
    { trigger: 'h1', label: 'Heading 1', template: '# ', icon: 'title', category: 'Heading' },
    {
      trigger: 'code',
      label: 'Code Block',
      template: '```\n\n```',
      icon: 'code',
      category: 'Block',
    },
  ];

  it('returns defaults when custom is empty', () => {
    const result = mergeSlashCommands(defaults, []);
    expect(result).toEqual(defaults);
  });

  it('appends custom commands with new triggers', () => {
    const custom: SlashCommand[] = [
      { trigger: 'myblock', label: 'My Block', template: 'custom template' },
    ];
    const result = mergeSlashCommands(defaults, custom);
    expect(result.length).toBe(3);
    expect(result[2].trigger).toBe('myblock');
    expect(result[2].isCustom).toBe(true);
  });

  it('overrides default when custom has same trigger', () => {
    const custom: SlashCommand[] = [{ trigger: 'h1', label: 'Custom H1', template: '# CUSTOM ' }];
    const result = mergeSlashCommands(defaults, custom);
    expect(result.length).toBe(2);
    const h1 = result.find((c) => c.trigger === 'h1');
    expect(h1!.label).toBe('Custom H1');
    expect(h1!.template).toBe('# CUSTOM ');
    expect(h1!.isCustom).toBe(true);
  });

  it('marks all custom commands with isCustom: true', () => {
    const custom: SlashCommand[] = [
      { trigger: 'a', label: 'A', template: 'a' },
      { trigger: 'b', label: 'B', template: 'b' },
    ];
    const result = mergeSlashCommands(defaults, custom);
    const customResults = result.filter((c) => c.isCustom);
    expect(customResults.length).toBe(2);
  });

  it('does not mark defaults as custom', () => {
    const result = mergeSlashCommands(defaults, []);
    expect(result.every((c) => !c.isCustom)).toBe(true);
  });
});

describe('slashCommandsFacet', () => {
  it('combines multiple inputs via flatten', () => {
    const cmds1: SlashCommand[] = [
      { trigger: 'a', label: 'A', template: 'a', icon: 'a', category: 'Block' },
    ];
    const cmds2: SlashCommand[] = [
      { trigger: 'b', label: 'B', template: 'b', icon: 'b', category: 'Block' },
    ];
    const state = EditorState.create({
      extensions: [slashCommandsFacet.of(cmds1), slashCommandsFacet.of(cmds2)],
    });
    const result = state.facet(slashCommandsFacet);
    expect(result.length).toBe(2);
    expect(result[0].trigger).toBe('a');
    expect(result[1].trigger).toBe('b');
  });

  it('falls back to defaults when no facet values provided', () => {
    const state = EditorState.create({ extensions: [] });
    const result = state.facet(slashCommandsFacet);
    expect(result.length).toBe(slashCommands.length);
  });

  it('custom command via facet appears in completions', () => {
    const custom: SlashCommand[] = [
      {
        trigger: 'unicorn',
        label: 'Unicorn Block',
        template: 'unicorn!',
        icon: 'star',
        category: 'Block',
      },
    ];
    const state = EditorState.create({
      doc: '/unicorn',
      extensions: [markdown({ base: markdownLanguage }), slashCommandsFacet.of(custom)],
      selection: { anchor: 8 },
    });
    const ctx = new CompletionContext(state, 8, false);
    const result = slashCommandSource(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain('Unicorn Block');
  });
});

describe('slashCommandRenderOption', () => {
  it('has position property for addToOptions', () => {
    expect(slashCommandRenderOption.position).toBeDefined();
  });

  it('render function creates elements with icon and label', () => {
    const completion = {
      label: 'Test',
      _slashCmd: {
        trigger: 'test',
        label: 'Test',
        template: 'test',
        icon: 'star',
        category: 'Block' as const,
      },
    };
    const el = slashCommandRenderOption.render(completion as never) as HTMLElement;
    expect(el).toBeDefined();
    expect(el.querySelector('.cm-slash-icon')).not.toBeNull();
    expect(el.textContent).toContain('Test');
  });

  it('renders category badge when category is set', () => {
    const completion = {
      label: 'Test',
      _slashCmd: {
        trigger: 'test',
        label: 'Test',
        template: 'test',
        icon: 'star',
        category: 'Block' as const,
      },
    };
    const el = slashCommandRenderOption.render(completion as never) as HTMLElement;
    const badge = el.querySelector('.cm-slash-category');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe('Block');
  });

  it('does not render category badge when _slashCmd is absent', () => {
    const completion = { label: 'Plain' };
    const el = slashCommandRenderOption.render(completion as never);
    // Should return null for non-slash completions
    expect(el).toBeNull();
  });
});
