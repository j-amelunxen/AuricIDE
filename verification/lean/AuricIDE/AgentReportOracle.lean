import AuricIDE.AgentReport

open AuricIDE.AgentReport

/-- Lake executable entry point for the deterministic report corpus. -/
def main : IO Unit :=
  emitOracle
