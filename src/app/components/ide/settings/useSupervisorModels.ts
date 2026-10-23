'use client';

import { useEffect, useState } from 'react';
import { isModelAvailable, listProviders, type ModelOption } from '@/lib/tauri/providers';
import { supervisorPolicyGet } from '@/lib/tauri/supervisorPolicy';
import { byModelRank } from './SupervisorProjectRow';

/**
 * The models the supervisor's own provider offers, smallest first. A manager
 * runs on that provider, so its model can only be one of these. Empty until
 * the read lands, and when there is no backend (browser mode).
 */
export function useSupervisorModels(): ModelOption[] {
  const [models, setModels] = useState<ModelOption[]>([]);

  useEffect(() => {
    let current = true;
    void Promise.all([listProviders(), supervisorPolicyGet()]).then(
      ([providers, { policy }]) => {
        const provider = providers.find((candidate) => candidate.id === policy.supervisor.provider);
        if (current && provider) setModels(byModelRank(provider.models.filter(isModelAvailable)));
      },
      () => undefined
    );
    return () => {
      current = false;
    };
  }, []);

  return models;
}
