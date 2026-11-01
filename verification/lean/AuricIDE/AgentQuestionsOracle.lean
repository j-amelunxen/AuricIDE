import AuricIDE.AgentQuestions

open AuricIDE.AgentQuestions

/-- Lake executable entry point for the deterministic question corpus. -/
def main : IO Unit :=
  emitOracle
