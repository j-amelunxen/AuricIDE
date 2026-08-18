import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TicketCreateModal } from './TicketCreateModal';
import { useStore } from '@/lib/store';

vi.mock('@/lib/hooks/useProjectSkills', () => ({
  useProjectSkills: () => ({ discovered: [], ready: true }),
}));

const mockEpics = [
  { id: 'e1', name: 'Epic One', description: '', sortOrder: 0, createdAt: '', updatedAt: '' },
  { id: 'e2', name: 'Epic Two', description: '', sortOrder: 1, createdAt: '', updatedAt: '' },
];

describe('TicketCreateModal', () => {
  beforeEach(() => {
    useStore.setState({ overlayStack: { layers: [] } });
  });

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

  it('exposes an accessible dialog when open', () => {
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
    expect(screen.getByRole('dialog', { name: /new ticket/i })).toBeInTheDocument();
  });

  it('Create button is disabled when name is empty', () => {
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
    const btn = screen.getByRole('button', { name: 'Create' });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('Create button is enabled when name is filled', async () => {
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
    const btn = screen.getByRole('button', { name: 'Create' });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it('has a Create button and no Create and Close or Model Power UI', () => {
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
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create and Close' })).not.toBeInTheDocument();
    expect(screen.queryByText(/model power/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('model-power-selector')).not.toBeInTheDocument();
  });

  it('calls onSaveAndClose with form values on Create', async () => {
    const onSave = vi.fn();
    const onSaveAndClose = vi.fn();
    render(
      <TicketCreateModal
        isOpen={true}
        epics={mockEpics}
        allTickets={[]}
        availableItems={[]}
        defaultEpicId="e1"
        onSave={onSave}
        onSaveAndClose={onSaveAndClose}
        onClose={vi.fn()}
      />
    );
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('What needs to be done?'), 'My Ticket');
    await user.click(screen.getByRole('button', { name: 'Create' }));
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
    expect(onSave).not.toHaveBeenCalled();
  });

  it('respects defaultEpicId when submitting with Create', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSaveAndClose).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Test',
        epicId: 'e2',
      }),
      []
    );
  });

  it('allows selecting priority', async () => {
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
    await user.type(screen.getByPlaceholderText('What needs to be done?'), 'Critical Task');

    const selector = screen.getByTestId('priority-selector');
    await user.click(within(selector).getByText('Critical'));

    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSaveAndClose).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Critical Task',
        priority: 'critical',
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

  it('asks before closing a ticket that has been typed into', async () => {
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
    await user.type(screen.getByPlaceholderText('What needs to be done?'), 'Leave me');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    const dialog = await screen.findByRole('dialog', { name: 'Discard changes?' });
    expect(onClose).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the new ticket form when discard is declined', async () => {
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
    await user.type(screen.getByPlaceholderText('What needs to be done?'), 'Stay');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    const dialog = await screen.findByRole('dialog', { name: 'Discard changes?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: /new ticket/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('What needs to be done?')).toHaveValue('Stay');
  });

  it('registers as the ticket-create overlay so Escape closes it', async () => {
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
    expect(useStore.getState().overlayStack.layers.at(-1)?.id).toBe('ticket-create');
    const user = userEvent.setup();
    await user.keyboard('{Escape}');
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
    expect(screen.getByRole('button', { name: 'To Test' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Done' })).toBeDefined();
  });

  it('does not offer Archived as a status on create', () => {
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
    expect(screen.queryByRole('button', { name: 'Archived' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discarded' })).not.toBeInTheDocument();
  });

  it('shows a Create epic button when there are no epics and a handler', () => {
    render(
      <TicketCreateModal
        isOpen={true}
        epics={[]}
        allTickets={[]}
        availableItems={[]}
        defaultEpicId={null}
        onSave={vi.fn()}
        onSaveAndClose={vi.fn()}
        onClose={vi.fn()}
        onCreateEpic={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Create epic' })).toBeInTheDocument();
    expect(screen.getByText('No epics yet. Create one first.')).toBeInTheDocument();
  });

  it('does not show a dead Create epic button when there is no handler', () => {
    render(
      <TicketCreateModal
        isOpen={true}
        epics={[]}
        allTickets={[]}
        availableItems={[]}
        defaultEpicId={null}
        onSave={vi.fn()}
        onSaveAndClose={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Create epic' })).not.toBeInTheDocument();
    expect(screen.getByText('No epics yet. Create one first.')).toBeInTheDocument();
  });

  it('does not show Create epic when epics exist', () => {
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
    expect(screen.queryByRole('button', { name: 'Create epic' })).not.toBeInTheDocument();
  });

  it('calls onCreateEpic when Create epic is clicked', async () => {
    const onCreateEpic = vi.fn();
    render(
      <TicketCreateModal
        isOpen={true}
        epics={[]}
        allTickets={[]}
        availableItems={[]}
        defaultEpicId={null}
        onSave={vi.fn()}
        onSaveAndClose={vi.fn()}
        onClose={vi.fn()}
        onCreateEpic={onCreateEpic}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Create epic' }));
    expect(onCreateEpic).toHaveBeenCalledTimes(1);
  });
});
