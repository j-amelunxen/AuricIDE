import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImageViewer } from './ImageViewer';

const PNG_URI = 'data:image/png;base64,abc123';

describe('ImageViewer', () => {
  it('paints the image from a data URI, not raw base64', () => {
    render(<ImageViewer src={PNG_URI} fileName="shot.png" />);
    const img = screen.getByRole('img', { name: 'shot.png' });
    expect(img).toHaveAttribute('src', PNG_URI);
  });

  it('shows the file name', () => {
    render(<ImageViewer src={PNG_URI} fileName="hero.gif" />);
    expect(screen.getByText('hero.gif')).toBeInTheDocument();
  });

  it('zooms in and out from the toolbar', async () => {
    const user = userEvent.setup();
    render(<ImageViewer src={PNG_URI} fileName="shot.png" />);

    expect(screen.getByText('100%')).toBeInTheDocument();
    await user.click(screen.getByTitle('Zoom In'));
    expect(screen.getByText('125%')).toBeInTheDocument();
    await user.click(screen.getByTitle('Zoom Out'));
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});
