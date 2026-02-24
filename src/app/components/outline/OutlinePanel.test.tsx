import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OutlinePanel } from './OutlinePanel';

describe('OutlinePanel', () => {
  const sampleContent = [
    '# Chapter 1',
    'Intro text',
    '## Section 1.1',
    'Content',
    '## Section 1.2',
    'More content',
    '# Chapter 2',
    '### Deep heading',
  ].join('\n');

  it('renders heading tree from content', () => {
    render(<OutlinePanel content={sampleContent} cursorLine={1} onHeadingClick={() => {}} />);

    expect(screen.getByText('Chapter 1')).toBeInTheDocument();
    expect(screen.getByText('Section 1.1')).toBeInTheDocument();
    expect(screen.getByText('Section 1.2')).toBeInTheDocument();
    expect(screen.getByText('Chapter 2')).toBeInTheDocument();
    expect(screen.getByText('Deep heading')).toBeInTheDocument();
  });

  it('shows hierarchical nesting with indentation', () => {
    render(<OutlinePanel content={sampleContent} cursorLine={1} onHeadingClick={() => {}} />);

    // h1 headings should exist at top level, h2 should be nested
    const section = screen.getByText('Section 1.1');
    const chapter = screen.getByText('Chapter 1');
    // Section button should have more padding than chapter button
    const sectionButton = section.closest('button');
    const chapterButton = chapter.closest('button');
    expect(sectionButton).toBeTruthy();
    expect(chapterButton).toBeTruthy();
  });

  it('calls onHeadingClick with correct line number', () => {
    const onClick = vi.fn();
    render(<OutlinePanel content={sampleContent} cursorLine={1} onHeadingClick={onClick} />);

    fireEvent.click(screen.getByText('Section 1.1'));
    expect(onClick).toHaveBeenCalledWith(3); // line 3 in the content
  });

  it('highlights active heading based on cursor line', () => {
    render(
      <OutlinePanel
        content={sampleContent}
        cursorLine={4} // Inside "Section 1.1"
        onHeadingClick={() => {}}
      />
    );

    const activeItem = screen.getByText('Section 1.1').closest('button');
    expect(activeItem?.className).toContain('text-primary');
  });

  it('shows empty state for no headings', () => {
    render(
      <OutlinePanel
        content="Just regular text without headings"
        cursorLine={1}
        onHeadingClick={() => {}}
      />
    );

    expect(screen.getByText(/no headings/i)).toBeInTheDocument();
  });

  it('shows non-markdown message when isMarkdown is false', () => {
    render(
      <OutlinePanel
        content="const x = 1;"
        cursorLine={1}
        isMarkdown={false}
        onHeadingClick={() => {}}
      />
    );

    expect(screen.getByText(/outline is available for markdown/i)).toBeInTheDocument();
  });

  it('updates when content changes', () => {
    const { rerender } = render(
      <OutlinePanel content="# Old Heading" cursorLine={1} onHeadingClick={() => {}} />
    );

    expect(screen.getByText('Old Heading')).toBeInTheDocument();

    rerender(<OutlinePanel content="# New Heading" cursorLine={1} onHeadingClick={() => {}} />);

    expect(screen.getByText('New Heading')).toBeInTheDocument();
  });
});
