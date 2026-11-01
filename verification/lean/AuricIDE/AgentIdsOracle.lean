import AuricIDE.AgentIds

open AuricIDE.AgentIds

/-- Lake executable entry point for the deterministic agent-id corpus. -/
def main : IO Unit :=
  emitOracle
