'use client';

import { useState, useEffect } from 'react';
import type { AgentConfig } from '@/lib/tauri/agents';
import { listProviders, FALLBACK_CRUSH_PROVIDER, type ProviderInfo } from '@/lib/tauri/providers';

interface GenerateDiagramDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (config: AgentConfig) => void;
  folderPath: string;
}

const diagramTypeOptions = [
  { value: 'flowchart', label: 'Flowchart' },
  { value: 'component-diagram', label: 'Component / Module Diagram' },
];

const detailLevelOptions = [
  { value: 'abstract', label: 'Abstract' },
  { value: 'medium', label: 'Medium' },
  { value: 'detailed', label: 'Detailed' },
];

function buildAgentTask(diagramType: string, detailLevel: string, folderPath: string): string {
  if (diagramType === 'component-diagram') {
    const levelDescription: Record<string, string> = {
      abstract:
        'Show only the top-level subsystems (e.g. Frontend, Backend, Database). Keep it minimal — 3 to 8 nodes.',
      medium:
        'Show main modules within each subsystem and their key connections. Include IPC channels and data flows.',
      detailed:
        'Show all modules and sub-modules, detailed IPC mechanisms, event flows, and data storage details.',
    };
    const description = levelDescription[detailLevel] ?? levelDescription['abstract'];

    return `You are an experienced software architect. Analyze the codebase in: ${folderPath}

Your task is to create a high-level Component and Module Diagram in Mermaid syntax.

IMPORTANT: Stay at the architectural level. Do NOT descend into individual functions, methods, or class implementations. Focus on the broad structure of the system.

Identify and document:
1. Main components and modules — the top-level building blocks of the application
2. Component interactions — how the components depend on or communicate with each other
3. Process communication — IPC channels, API calls, message passing, and events between processes
4. Data flow — how data moves through the system from input to output
5. Data storage — where data is persisted (databases, files, local storage, config files, etc.)
6. Technology and process boundaries — frontend vs backend, separate processes or services

Detail level: ${detailLevel}
${description}

Use Mermaid flowchart syntax with subgraph blocks to group related modules.

Write the result as a Markdown file with a mermaid code block to: ${folderPath}/diagram.md`;
  }

  return `Analyze the code in the directory: ${folderPath}

Generate a ${diagramType} diagram in Mermaid syntax.
Detail level: ${detailLevel}
- Abstract: Show only the most important high-level components and their relationships. Keep it minimal and focused on the big picture.
- Medium: Show main components, key relationships, and moderate internal structure.
- Detailed: Show all components, detailed relationships, internal structures, data flows, and edge cases.

Write the result as a Markdown file with a mermaid code block to: ${folderPath}/diagram.md`;
}

export function GenerateDiagramDialog({
  isOpen,
  onClose,
  onGenerate,
  folderPath,
}: GenerateDiagramDialogProps) {
  const [diagramType, setDiagramType] = useState('flowchart');
  const [detailLevel, setDetailLevel] = useState('abstract');
  const [providers, setProviders] = useState<ProviderInfo[]>([FALLBACK_CRUSH_PROVIDER]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderInfo>(FALLBACK_CRUSH_PROVIDER);

  useEffect(() => {
    listProviders()
      .then((loadedProviders) => {
        if (loadedProviders.length > 0) {
          setProviders(loadedProviders);
          setSelectedProvider(loadedProviders[0]);
        }
      })
      .catch(() => {
        // Browser mode — keep fallback
      });
  }, []);

  if (!isOpen) return null;

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const found = providers.find((p) => p.id === e.target.value);
    if (found) setSelectedProvider(found);
  };

  const handleGenerate = () => {
    const folderName = folderPath.split('/').pop() || '';
    const name = folderName ? `Diagram (${folderName})` : 'Diagram';

    const task = buildAgentTask(diagramType, detailLevel, folderPath);

    onGenerate({
      name,
      model: selectedProvider.defaultModel,
      task,
      cwd: folderPath,
      permissionMode: 'acceptEdits',
      provider: selectedProvider.id,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-card w-full max-w-md overflow-hidden rounded-xl border border-white/10 bg-[#0a0a10] p-6 shadow-2xl animate-in fade-in zoom-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">schema</span>
          <h2 className="text-sm font-bold tracking-tight text-foreground uppercase">
            Generate Diagram
          </h2>
        </div>

        <div className="flex flex-col gap-5">
          <div className="space-y-1.5">
            <p className="text-xs text-foreground-muted truncate">{folderPath}</p>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="provider"
              className="block text-[10px] font-bold text-foreground-muted uppercase tracking-wider"
            >
              Provider
            </label>
            <select
              id="provider"
              value={selectedProvider.id}
              onChange={handleProviderChange}
              className="w-full rounded-lg border border-white/5 bg-black/40 px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors appearance-none"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="diagram-type"
                className="block text-[10px] font-bold text-foreground-muted uppercase tracking-wider"
              >
                Diagram Type
              </label>
              <select
                id="diagram-type"
                value={diagramType}
                onChange={(e) => setDiagramType(e.target.value)}
                className="w-full rounded-lg border border-white/5 bg-black/40 px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors appearance-none"
              >
                {diagramTypeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="detail-level"
                className="block text-[10px] font-bold text-foreground-muted uppercase tracking-wider"
              >
                Detail Level
              </label>
              <select
                id="detail-level"
                value={detailLevel}
                onChange={(e) => setDetailLevel(e.target.value)}
                className="w-full rounded-lg border border-white/5 bg-black/40 px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors appearance-none"
              >
                {detailLevelOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-foreground-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleGenerate}
              className="rounded-lg bg-primary px-6 py-2 text-xs font-bold text-white shadow-[0_0_15px_rgba(188,19,254,0.3)] hover:brightness-110 transition-all"
            >
              Generate
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
