import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PersistChip } from './PersistChip';

describe('PersistChip', () => {
  it('prints Unsaved · ⌘S when the surface is dirty', () => {
    render(<PersistChip dirty />);
    expect(screen.getByTestId('persist-chip')).toHaveTextContent('Unsaved · ⌘S');
  });

  it('prints Autosaved when the surface writes as it goes', () => {
    render(<PersistChip mode="autosaved" />);
    expect(screen.getByTestId('persist-chip')).toHaveTextContent('Autosaved');
  });

  it('renders nothing when there is nothing to say', () => {
    const { container } = render(<PersistChip dirty={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
