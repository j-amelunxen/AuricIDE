import AuricIDE.ProviderPolicy

open AuricIDE.ProviderPolicy

/-- Lake executable entry point for the deterministic provider-policy corpus. -/
def main : IO Unit :=
  emitOracle
