import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VideoViewer } from './VideoViewer';

const SRC = 'asset://localhost/movies/clip.mp4';

describe('VideoViewer', () => {
  it('renders a native video player for the file', () => {
    const { container } = render(<VideoViewer src={SRC} fileName="clip.mp4" />);
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute('src', SRC);
    expect(video).toHaveAttribute('controls');
  });

  it('does not autoplay', () => {
    const { container } = render(<VideoViewer src={SRC} fileName="clip.mp4" />);
    const video = container.querySelector('video');
    expect(video).not.toHaveAttribute('autoplay');
  });

  it('shows the file name', () => {
    render(<VideoViewer src={SRC} fileName="take.mov" />);
    expect(screen.getByText('take.mov')).toBeInTheDocument();
  });
});
