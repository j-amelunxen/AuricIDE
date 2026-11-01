import AuricIDE.PmScope

open AuricIDE.PmScope

/-- Lake executable entry point for the deterministic PM-gateway traces. -/
def main : IO Unit :=
  emitOracle
