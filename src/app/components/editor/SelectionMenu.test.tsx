import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SelectionMenu } from './SelectionMenu';

describe('SelectionMenu', () => {
  it('renders and handles buttons', () => {
    const onSpawn = vi.fn();
    const onFixAscii = vi.fn();

    render(
      <SelectionMenu
        x={100}
        y={200}
        selection="test text"
        isAsciiArt={true}
        onSpawnAgent={onSpawn}
        onFixAsciiArt={onFixAscii}
      />
    );

    const spawnBtn = screen.getByText('SPAWN AGENT');
    fireEvent.click(spawnBtn);
    expect(onSpawn).toHaveBeenCalledWith('test text');

    const fixBtn = screen.getByText('FIX ASCII-ART');
    fireEvent.click(fixBtn);
    expect(onFixAscii).toHaveBeenCalled();
  });
});
