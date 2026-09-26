import AuricIDE.LaunchGate

open AuricIDE.LaunchGate

/-- Lake executable entry point for the deterministic launch-gate corpus. -/
def main : IO Unit :=
  emitOracle
