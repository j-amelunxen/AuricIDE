'use client';

import React from 'react';

export interface AgentCardTerminalBodyProps {
  agentName: string;
  logs: string[];
  logPreview: string;
  replyRef: React.RefObject<HTMLInputElement | null>;
  logEndRef: React.RefObject<HTMLDivElement | null>;
  replyError: string | null;
  sendReply: (e: React.KeyboardEvent<HTMLInputElement>) => Promise<void>;
}

export function AgentCardTerminalBody({
  agentName,
  logs,
  logPreview,
  replyRef,
  logEndRef,
  replyError,
  sendReply,
}: AgentCardTerminalBodyProps) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="h-40 flex flex-col rounded-lg border border-white/10 bg-black/40 p-2 font-mono text-[9px] animate-in fade-in slide-in-from-left-2 duration-300"
    >
      <div
        data-testid="agent-log-preview"
        className="flex-1 overflow-y-auto no-scrollbar custom-scrollbar select-text"
      >
        {logs.length === 0 ? (
          <div className="h-full flex items-center justify-center opacity-20 italic">
            No activity stream...
          </div>
        ) : (
          <div className="whitespace-pre-wrap break-all text-primary-light/80">{logPreview}</div>
        )}
        <div ref={logEndRef} />
      </div>

      {/* Interactive Input for Agent */}
      <div className="mt-1 flex items-center gap-1 border-t border-white/5 pt-1">
        <span className="text-primary font-bold opacity-50">❯</span>
        <input
          ref={replyRef}
          type="text"
          placeholder="Reply to agent..."
          aria-label={`Reply to ${agentName}`}
          className="flex-1 bg-transparent border-none outline-none text-foreground placeholder:opacity-20 text-[9px] focus:ring-1 focus:ring-primary/50 rounded px-1"
          onKeyDown={sendReply}
        />
      </div>
      {replyError && (
        <p role="alert" className="mt-1 text-[8px] text-red-400">
          {replyError}
        </p>
      )}

      <div className="mt-1 flex items-center gap-1 text-[8px] text-primary/40 uppercase tracking-widest border-t border-white/5 pt-1">
        <span className="animate-pulse">●</span>
        <span>Interactive PTY Stream</span>
      </div>
    </div>
  );
}
