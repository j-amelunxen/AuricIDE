import { expect, test, type Page } from '@playwright/test';

interface SeededAgent {
  id: string;
  name: string;
  status: 'running';
  model: string;
  provider: string;
  currentTask: string;
  currentActivity: string;
  awaitingInput: boolean;
  startedAt: number;
  lastActivityAt: number;
  repoPath: string;
}

function agent(id: string, name: string, now: number, awaitingInput: boolean): SeededAgent {
  return {
    id,
    name,
    status: 'running',
    model: 'test-model',
    provider: 'test',
    currentTask: `Test task for ${name}`,
    currentActivity: awaitingInput ? 'Awaiting your answer' : 'Running checks',
    awaitingInput,
    startedAt: now - 10_000,
    lastActivityAt: now,
    repoPath: '/workspace/test-project',
  };
}

async function seedAgentStates(page: Page) {
  const now = Date.now();
  await page.evaluate(
    ({ agents }) => {
      const store = (
        window as unknown as {
          __AURIC_STORE__?: { setState: (state: Record<string, unknown>) => void };
        }
      ).__AURIC_STORE__;
      if (!store) throw new Error('Auric store is not exposed in browser mode');

      store.setState({
        agents,
        agentConsoleOpen: false,
        agentEvents: {},
        agentHeartbeat: {},
        agentLogs: {},
        agentColors: {},
        reviewedAgentIds: [],
      });
    },
    {
      agents: [
        agent('running-agent', 'Running Agent', now, false),
        agent('waiting-agent', 'Waiting Agent', now, true),
      ],
    }
  );
}

test('shows phase labels for seeded agent states in the Agent Console', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('ide-shell')).toBeVisible();

  await seedAgentStates(page);
  await page
    .getByTestId('start-screen-agents-line')
    .getByRole('button', { name: 'Open Agent Console' })
    .click();

  await expect(page.getByTestId('agent-console-shell')).toBeVisible();

  const runningCard = page.getByTestId('console-agent-card-running-agent');
  const waitingCard = page.getByTestId('console-agent-card-waiting-agent');
  await expect(runningCard).toBeVisible();
  await expect(waitingCard).toBeVisible();
  await expect(runningCard.getByTestId('phase-chip')).toHaveText('Running');
  await expect(waitingCard.getByTestId('phase-chip')).toHaveText('Waiting on you');
});
