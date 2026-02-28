import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TicketCreateModal } from './TicketCreateModal';

const mockEpics = [
  { id: 'e1', name: 'Epic One', description: '', sortOrder: 0, createdAt: '', updatedAt: '' },
  { id: 'e2', name: 'Epic Two', description: '', sortOrder: 1, createdAt: '', updatedAt: '' },
];

describe('TicketCreateModal', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <TicketCreateModal
        isOpen={false}
        epics={mockEpics}
        allTickets={[]}
        availableItems={[]}
        defaultEpicId="e1"
        onSave={vi.fn()}
        onSaveAndClose={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders form when isOpen is true', () => {
    render(
      <TicketCreateModal
        isOpen={true}
        epics={mockEpics}
        allTickets={[]}
        availableItems={[]}
        defaultEpicId="e1"
        onSave={vi.fn()}
        onSaveAndClose={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('New Ticket')).toBeDefined();
    expect(screen.getByPlaceholderText('What needs to be done?')).toBeDefined();
  });

  it('Create and Close button is disabled when name is empty', () => {
    render(
      <TicketCreateModal
        isOpen={true}
        epics={mockEpics}
        allTickets={[]}
        availableItems={[]}
        defaultEpicId="e1"
        onSave={vi.fn()}
        onSaveAndClose={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const btn = screen.getByRole('button', { name: 'Create and Close' });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('Create and Close button is enabled when name is filled', async () => {
    render(
      <TicketCreateModal
        isOpen={true}
        epics={mockEpics}
        allTickets={[]}
        availableItems={[]}
        defaultEpicId="e1"
        onSave={vi.fn()}
        onSaveAndClose={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('What needs to be done?'), 'My ticket');
    const btn = screen.getByRole('button', { name: 'Create and Close' });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it('calls onSaveAndClose with form values on submit', async () => {
    const onSaveAndClose = vi.fn();
    render(
      <TicketCreateModal
        isOpen={true}
        epics={mockEpics}
        allTickets={[]}
        availableItems={[]}
        defaultEpicId="e1"
        onSave={vi.fn()}
        onSaveAndClose={onSaveAndClose}
        onClose={vi.fn()}
      />
    );
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('What needs to be done?'), 'My Ticket');
    await user.click(screen.getByRole('button', { name: 'Create and Close' }));
    expect(onSaveAndClose).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'My Ticket',
        epicId: 'e1',
        status: 'open',
        priority: 'normal',
        description: '',
        modelPower: undefined,
      }),
      []
    );
  });

  it('calls onSave with form values on Create click and resets form', async () => {
    const onSave = vi.fn();
    render(
      <TicketCreateModal
        isOpen={true}
        epics={mockEpics}
        allTickets={[]}
        availableItems={[]}
        defaultEpicId="e1"
        onSave={onSave}
        onSaveAndClose={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const user = userEvent.setup();
    const input = screen.getByPlaceholderText('What needs to be done?');
    await user.type(input, 'My Ticket');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'My Ticket',
        epicId: 'e1',
        status: 'open',
        priority: 'normal',
        description: '',
        modelPower: undefined,
      }),
      []
    );
    expect(input).toHaveValue('');
  });

  it('respects defaultEpicId when submitting with Create and Close', async () => {
    const onSaveAndClose = vi.fn();
    render(
      <TicketCreateModal
        isOpen={true}
        epics={mockEpics}
        allTickets={[]}
        availableItems={[]}
        defaultEpicId="e2"
        onSave={vi.fn()}
        onSaveAndClose={onSaveAndClose}
        onClose={vi.fn()}
      />
    );
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('What needs to be done?'), 'Test');
    await user.click(screen.getByRole('button', { name: 'Create and Close' }));
    expect(onSaveAndClose).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Test',
        epicId: 'e2',
      }),
      []
    );
  });

  it('allows selecting priority', async () => {
    const onSave = vi.fn();
    render(
      <TicketCreateModal
        isOpen={true}
        epics={mockEpics}
        allTickets={[]}
        availableItems={[]}
        defaultEpicId="e1"
        onSave={onSave}
        onSaveAndClose={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('What needs to be done?'), 'Critical Task');

    const selector = screen.getByTestId('priority-selector');
    await user.click(within(selector).getByText('Critical'));

    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Critical Task',
        priority: 'critical',
      }),
      []
    );
  });

  it('allows selecting model power', async () => {
    const onSave = vi.fn();
    render(
      <TicketCreateModal
        isOpen={true}
        epics={mockEpics}
        allTickets={[]}
        availableItems={[]}
        defaultEpicId="e1"
        onSave={onSave}
        onSaveAndClose={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('What needs to be done?'), 'Heavy Task');

    const selector = screen.getByTestId('model-power-selector');
    await user.click(within(selector).getByText('High'));

    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Heavy Task',
        modelPower: 'high',
      }),
      []
    );
  });

  it('calls onClose when Cancel is clicked', async () => {
    const onClose = vi.fn();
    render(
      <TicketCreateModal
        isOpen={true}
        epics={mockEpics}
        allTickets={[]}
        availableItems={[]}
        defaultEpicId="e1"
        onSave={vi.fn()}
        onSaveAndClose={vi.fn()}
        onClose={onClose}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows epic options in selector', () => {
    render(
      <TicketCreateModal
        isOpen={true}
        epics={mockEpics}
        allTickets={[]}
        availableItems={[]}
        defaultEpicId="e1"
        onSave={vi.fn()}
        onSaveAndClose={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('Epic One')).toBeDefined();
    expect(screen.getByText('Epic Two')).toBeDefined();
  });

  it('shows status options', () => {
    render(
      <TicketCreateModal
        isOpen={true}
        epics={mockEpics}
        allTickets={[]}
        availableItems={[]}
        defaultEpicId="e1"
        onSave={vi.fn()}
        onSaveAndClose={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Open' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'In Progress' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Done' })).toBeDefined();
  });
});
