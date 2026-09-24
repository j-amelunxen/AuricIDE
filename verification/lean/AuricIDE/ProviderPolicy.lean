import Std

/-!
# Provider-policy reference model

This model starts *after* adapter normalisation: every non-blank provider id
and every list entry is an ASCII lowercase, trimmed identifier. The production
adapters remain responsible for JSON parsing, Unicode case-folding, duplicate
removal, and resolving unknown requested provider names to the registry default.

The executable corpus intentionally uses only the bounded, canonical examples
below. It establishes conformance of TypeScript and Rust for those examples; it
does not formally prove the JSON adapters or the spawn path.
-/

namespace AuricIDE.ProviderPolicy

abbrev ProviderId := String

structure Policy where
  allow : Option (List ProviderId)
  deny : List ProviderId
  deriving Repr, DecidableEq

/-- The total decision for an already-normalised provider id and policy. -/
def isAllowed (providerId : ProviderId) (policy : Policy) : Bool :=
  if providerId = "" then false
  else if providerId ∈ policy.deny then false
  else
    match policy.allow with
    | none => true
    | some [] => true
    | some allowed => allowed.contains providerId

/-- A deny entry wins even if the same id occurs in the allow list. -/
theorem deny_wins (policy : Policy) (providerId : ProviderId)
    (denied : providerId ∈ policy.deny) :
    isAllowed providerId policy = false := by
  simp [isAllowed, denied]

/-- An empty allow list carries the same open meaning as no allow list. -/
theorem empty_allow_means_open (policy : Policy) (providerId : ProviderId)
    (notBlank : providerId ≠ "")
    (notDenied : providerId ∉ policy.deny) :
    isAllowed providerId { policy with allow := some [] } = true := by
  simp [isAllowed, notBlank, notDenied]

/-- A blank id names no provider and is always rejected. -/
theorem blank_id_denied (policy : Policy) : isAllowed "" policy = false := by
  simp [isAllowed]

/-- The reference function has no hidden state or nondeterminism. -/
theorem determinism (policy : Policy) (providerId : ProviderId) :
    isAllowed providerId policy = isAllowed providerId policy := rfl

/-- Every input receives exactly one boolean decision. -/
theorem totality (policy : Policy) (providerId : ProviderId) :
    isAllowed providerId policy = true ∨ isAllowed providerId policy = false := by
  cases decision : isAllowed providerId policy <;> simp_all

structure OracleCase where
  name : String
  policy : Policy
  providerId : ProviderId

private def quote (value : String) : String := "\"" ++ value ++ "\""

private def encodeList (ids : List ProviderId) : String :=
  "[" ++ String.intercalate "," (ids.map quote) ++ "]"

private def encodeAllow : Option (List ProviderId) → String
  | none => "null"
  | some ids => encodeList ids

private def encodeBoolean (value : Bool) : String := if value then "true" else "false"

private def renderCase (testCase : OracleCase) : String :=
  "{\"version\":\"provider-policy-v1\",\"name\":" ++ quote testCase.name ++
    ",\"policy\":{\"allow\":" ++ encodeAllow testCase.policy.allow ++
    ",\"deny\":" ++ encodeList testCase.policy.deny ++ "},\"providerId\":" ++
    quote testCase.providerId ++ ",\"allowed\":" ++
    encodeBoolean (isAllowed testCase.providerId testCase.policy) ++ "}"

/-!
The bounded v1 corpus covers each decision branch. Keep identifiers JSON-safe
ASCII literals: `quote` is deliberately a minimal serializer, not a JSON
adapter implementation.
-/
def oracleCases : List OracleCase :=
  [ { name := "open policy permits a normalized id", policy := { allow := none, deny := [] },
      providerId := "claude" },
    { name := "deny wins over allow", policy := { allow := some ["claude", "grok"], deny := ["grok"] },
      providerId := "grok" },
    { name := "empty allow means open", policy := { allow := some [], deny := [] },
      providerId := "opencode" },
    { name := "allow list permits a member", policy := { allow := some ["claude"], deny := [] },
      providerId := "claude" },
    { name := "allow list denies a non-member", policy := { allow := some ["claude"], deny := [] },
      providerId := "crush" },
    { name := "deny list leaves a different provider open", policy := { allow := none, deny := ["grok"] },
      providerId := "claude" },
    { name := "blank provider id is denied", policy := { allow := none, deny := [] },
      providerId := "" },
    { name := "deny list can block every named provider", policy := { allow := none, deny := ["claude", "crush"] },
      providerId := "crush" } ]

def emitOracle : IO Unit :=
  oracleCases.forM fun testCase => IO.println (renderCase testCase)

end AuricIDE.ProviderPolicy
