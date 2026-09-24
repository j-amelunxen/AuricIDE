import Std

/-!
# MCP session isolation reference model

The UI workspace is presentation state. Agent sessions own immutable project
bindings, so changing or closing the UI workspace cannot retarget a request.
Filesystem canonicalisation, subprocesses and SQLite effects remain integration
test obligations.
-/

namespace AuricIDE.McpSessionIsolation

abbrev SessionId := Nat
abbrev ProjectId := String

structure State where
  uiProject : Option ProjectId
  bindings : SessionId → Option ProjectId

def switchUiProject (state : State) (project : Option ProjectId) : State :=
  { state with uiProject := project }

def routeRequest (state : State) (session : SessionId) : Option ProjectId :=
  state.bindings session

def endSession (state : State) (ended : SessionId) : State :=
  { state with bindings := fun session => if session = ended then none else state.bindings session }

theorem ui_switch_noninterference
    (state : State) (project : Option ProjectId) (session : SessionId) :
    routeRequest (switchUiProject state project) session = routeRequest state session := by
  rfl

theorem request_routes_to_exact_binding
    (state : State) (session : SessionId) (project : ProjectId)
    (bound : state.bindings session = some project) :
    routeRequest state session = some project := by
  exact bound

theorem ending_session_preserves_others
    (state : State) (ended other : SessionId) (different : other ≠ ended) :
    routeRequest (endSession state ended) other = routeRequest state other := by
  simp [routeRequest, endSession, different]

theorem projectless_session_stays_projectless
    (state : State) (session : SessionId)
    (projectless : state.bindings session = none)
    (visible : Option ProjectId) :
    routeRequest (switchUiProject state visible) session = none := by
  simpa [routeRequest, switchUiProject] using projectless

end AuricIDE.McpSessionIsolation
