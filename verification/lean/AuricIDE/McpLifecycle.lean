import Std

/-!
# MCP lifecycle reference model

This is the deliberately small, pure part of the app-managed MCP supervisor.
It models the generation gate used at the asynchronous UI/backend boundary:
only a completion belonging to the newest operation may publish lifecycle
state. OS process creation, termination, readiness, and SQLite isolation stay
outside this model and are covered by Rust/TypeScript integration tests.
-/

namespace AuricIDE.McpLifecycle

inductive Phase where
  | stopped
  | starting
  | running
  | stopping
  | failed
  deriving Repr, DecidableEq

structure State where
  generation : Nat
  phase : Phase
  pid : Option Nat
  workspace : Option String
  deriving Repr, DecidableEq

inductive Completion where
  | started (generation : Nat) (pid : Nat) (workspace : String)
  | stopped (generation : Nat)
  | failed (generation : Nat)
  deriving Repr, DecidableEq

def completionGeneration : Completion → Nat
  | .started generation _ _ => generation
  | .stopped generation => generation
  | .failed generation => generation

/-- A completion may publish state only for the currently active operation. -/
def applyCompletion (state : State) (completion : Completion) : State :=
  if completionGeneration completion != state.generation then state
  else
    match completion with
    | .started _ pid workspace =>
        { state with phase := .running, pid := some pid, workspace := some workspace }
    | .stopped _ =>
        { state with phase := .stopped, pid := none, workspace := none }
    | .failed _ =>
        { state with phase := .failed }

/-- An older async completion cannot overwrite a newer lifecycle intent. -/
theorem stale_completion_noninterference
    (state : State) (completion : Completion)
    (stale : completionGeneration completion ≠ state.generation) :
    applyCompletion state completion = state := by
  simp [applyCompletion, stale]

/-- Every accepted successful start publishes both its PID and workspace. -/
theorem accepted_start_is_coherent
    (state : State) (pid generation : Nat) (workspace : String)
    (current : generation = state.generation) :
    let next := applyCompletion state (.started generation pid workspace)
    next.phase = .running ∧ next.pid = some pid ∧ next.workspace = some workspace := by
  subst generation
  simp [applyCompletion, completionGeneration]

/-- A failed operation reports the error phase without inventing process truth. -/
theorem accepted_failure_preserves_known_binding
    (state : State) (generation : Nat)
    (current : generation = state.generation) :
    let next := applyCompletion state (.failed generation)
    next.phase = .failed ∧ next.pid = state.pid ∧ next.workspace = state.workspace := by
  subst generation
  simp [applyCompletion, completionGeneration]

/-- The model has one optional process slot, hence never represents two children. -/
def liveProcessCount (state : State) : Nat :=
  if state.pid.isSome then 1 else 0

theorem singleton_process_slot (state : State) : liveProcessCount state ≤ 1 := by
  unfold liveProcessCount
  split <;> omega

end AuricIDE.McpLifecycle
