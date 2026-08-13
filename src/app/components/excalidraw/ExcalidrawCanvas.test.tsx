import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExcalidrawCanvas } from './ExcalidrawCanvas';

vi.mock('next/dynamic', () => ({
  default: () =>
    function ExcalidrawStub({ initialData }: { initialData: { elements: { id?: string }[] } }) {
      // Same contract as @excalidraw/excalidraw: initialData is mount-only.
      const [scene] = useState(() => initialData);
      return (
        <div data-testid="excalidraw-scene">
          {scene.elements.map((el) => el.id ?? '?').join(',')}
        </div>
      );
    },
}));

const empty = { appState: {}, files: {} };

describe('ExcalidrawCanvas', () => {
  it('keeps the first scene when props change without a new sceneKey', () => {
    const { rerender } = render(
      <ExcalidrawCanvas elements={[{ id: 'rect-a' }]} {...empty} sceneKey="a.excalidraw" />
    );
    expect(screen.getByTestId('excalidraw-scene')).toHaveTextContent('rect-a');

    rerender(
      <ExcalidrawCanvas elements={[{ id: 'ellipse-b' }]} {...empty} sceneKey="a.excalidraw" />
    );
    expect(screen.getByTestId('excalidraw-scene')).toHaveTextContent('rect-a');
  });

  it('paints the new scene when sceneKey changes', () => {
    const { rerender } = render(
      <ExcalidrawCanvas elements={[{ id: 'rect-a' }]} {...empty} sceneKey="a.excalidraw" />
    );
    rerender(
      <ExcalidrawCanvas elements={[{ id: 'ellipse-b' }]} {...empty} sceneKey="b.excalidraw" />
    );
    expect(screen.getByTestId('excalidraw-scene')).toHaveTextContent('ellipse-b');
  });
});
