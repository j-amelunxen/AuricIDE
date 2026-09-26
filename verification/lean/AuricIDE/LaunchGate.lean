import Std

/-!
# Launch-grant gate reference model (REQ-LAUNCH-01..03)

An agent asks the IDE, through MCP `request_agent_launch`, to start another
agent for a goal. Such a request may start without a click only under a launch
grant that a person saved for the goal's mission root. This model is the gate
in front of that automatic start, in the shape the native store has since the
grant moved into `notifications.db` (table `agent_launch_grants`):

* A grant is a row with its own id. Saving a grant for a root stamps every
  row of that root that is still in force as revoked and adds a row with a
  fresh id; revoking stamps one row. Rows never disappear and never come back
  into force.
* A decision attempt carries the grant id the deciding app instance last saw
  for the root. That id may be stale: revoked, replaced, or for another root.
* A request's goal can move to another mission root between the request and
  the decision (event `move`); the claim reads where the goal sits now.
* There is no clock: a request written before the grant starts once the grant
  is given, capped by limit and budget (decision Jennifer, 2026-09-26).

Two decisions are modelled:

* `claim` is the native claim (`claim_launch_impl` in
  `src-tauri/src/notifications/operations.rs`), in its order: real request,
  still open, grant row in force, goal under the grant's root now, budget,
  slot. The Rust replay runs the corpus through the real claim, on real grant
  rows and a real project database.
* `decide` is the TypeScript pre-filter `decideLaunch`
  (`src/lib/notifications/launchGate.ts`): grant, claim, budget, slot, over the
  grant the IDE resolved for the goal's current root. `claim_start_iff_gate`
  ties the two together: the claim starts exactly when the request is real and
  the gate says start.

Proved here, for every interleaving of events:

* REQ-LAUNCH-01: a start needs a grant row that is in force at the moment of
  the decision and whose root is the goal's root at that moment. Once a row is
  revoked or replaced it never starts anything again, whatever happens after.
  A goal moved out of the root is refused as outside the root. A request
  written before any grant starts once one is given, if budget and a slot are
  free.
* REQ-LAUNCH-02: a start happens only below the limit, so the held slots of a
  root never exceed the limit of the grant in force while that grant stands;
  only an explicit resolution (spawn failed, run finished) frees a slot, so a
  start with an unclear outcome keeps counting.
* REQ-LAUNCH-03: a start happens only with budget left; usage never goes down;
  once the budget of a root's grant is spent, no request of that root starts
  until a person saves a new grant.

Outside the model and covered by tests instead: JSON and IPC adapters, the
SQLite transaction that makes the claim atomic across processes, the spawn
itself, the working-directory rule, retries, the UI acknowledgement, and all
shell or input handling. A started agent with a shell that writes SQLite
directly is outside the threat model (notes 2026-09-26-09-bedrohungsmodell-und-
verzeichnis and 2026-09-26-09-antwort-grant-autoritaet).
-/

namespace AuricIDE.LaunchGate

abbrev Root := Nat
abbrev Uid := Nat
abbrev GrantId := Nat

inductive Decision where
  | start
  | notARequest
  | alreadyClaimed
  | noGrant
  | outsideRoot
  | budgetSpent
  | atCapacity
  deriving Repr, DecidableEq

/-! ## The TypeScript gate -/

structure GateGrant where
  maxConcurrent : Nat
  launchBudget : Nat
  deriving Repr, DecidableEq

structure GateInput where
  grant : Option GateGrant
  alreadyClaimed : Bool
  used : Nat
  held : Nat

/-- The pure gate, checked in a fixed order: grant, claim, budget, slot. -/
def decide (input : GateInput) : Decision :=
  match input.grant with
  | none => .noGrant
  | some g =>
      if input.alreadyClaimed then .alreadyClaimed
      else if g.launchBudget ≤ input.used then .budgetSpent
      else if g.maxConcurrent ≤ input.held then .atCapacity
      else .start

theorem decide_start_iff (input : GateInput) :
    decide input = .start ↔
      ∃ g, input.grant = some g ∧ input.alreadyClaimed = false ∧
        input.used < g.launchBudget ∧ input.held < g.maxConcurrent := by
  cases hg : input.grant with
  | none => simp [decide, hg]
  | some g =>
      simp only [decide, hg]
      by_cases h2 : input.alreadyClaimed = true
      · simp [h2]
      · by_cases h3 : g.launchBudget ≤ input.used
        · simp [h2, h3] <;> omega
        · by_cases h4 : g.maxConcurrent ≤ input.held
          · simp [h2, h3, h4] <;> omega
          · simp [h2, h3, h4] <;> omega

/-! ## State and events -/

/-- Point update of a function, the only mutation the model needs. -/
def upd {α β : Type} [DecidableEq α] (f : α → β) (a : α) (b : β) : α → β :=
  fun x => if x = a then b else f x

@[simp] theorem upd_same {α β : Type} [DecidableEq α] (f : α → β) (a : α) (b : β) :
    upd f a b a = b := by simp [upd]

@[simp] theorem upd_other {α β : Type} [DecidableEq α] (f : α → β) (a x : α) (b : β)
    (h : x ≠ a) : upd f a b x = f x := by simp [upd, h]

/-- A grant row as the native store keeps it. Only `revoked` ever changes. -/
structure GrantRow where
  root : Root
  maxConcurrent : Nat
  launchBudget : Nat
  revoked : Bool
  deriving Repr, DecidableEq

structure State where
  nextGrantId : GrantId
  rows : GrantId → Option GrantRow
  /-- Written requests: the mission root their goal sits under now. -/
  goalRoot : Uid → Option Root
  /-- Taken by a decision that started it (read, answered or claimed). -/
  claimed : Uid → Bool
  /-- The root whose slot this request holds, until its start resolves. -/
  holder : Uid → Option Root
  heldCount : Root → Nat
  used : GrantId → Nat

def State.initial : State where
  nextGrantId := 0
  rows := fun _ => none
  goalRoot := fun _ => none
  claimed := fun _ => false
  holder := fun _ => none
  heldCount := fun _ => 0
  used := fun _ => 0

inductive Event where
  /-- A person saves a grant for a mission root; it replaces the one in force. -/
  | grant (root : Root) (maxConcurrent launchBudget : Nat)
  /-- A person revokes the grant row with this id (possibly a stale id). -/
  | revoke (id : GrantId)
  /-- An agent writes a launch request for a goal under `root`. -/
  | request (uid : Uid) (root : Root)
  /-- The request's goal is moved under another mission root. -/
  | move (uid : Uid) (root : Root)
  /-- An app instance claims the request with the grant id it last saw. -/
  | attempt (uid : Uid) (id : GrantId)
  /-- The spawn reported an agent; nothing is resolved yet. -/
  | running (uid : Uid)
  /-- The spawn certainly did not happen. -/
  | spawnFailed (uid : Uid)
  /-- The started agent's run was recorded as finished. -/
  | finished (uid : Uid)
  deriving Repr, DecidableEq

/-- The root an event saves a grant for, if it is a grant. -/
def Event.grantsRoot : Event → Option Root
  | .grant root _ _ => some root
  | _ => none

/-- Only these two free a slot. -/
def Event.resolves : Event → Bool
  | .spawnFailed _ => true
  | .finished _ => true
  | _ => false

def revokeRow (row : GrantRow) : GrantRow := { row with revoked := true }

/-- Saving a grant: rows of `root` are stamped revoked, the new row gets a fresh id. -/
def saveRows (s : State) (root : Root) (m b : Nat) : GrantId → Option GrantRow :=
  fun id =>
    if id = s.nextGrantId then
      some { root, maxConcurrent := m, launchBudget := b, revoked := false }
    else (s.rows id).map fun row => if row.root = root then revokeRow row else row

/-- The native claim, in its order: request, open, grant row, root, budget, slot. -/
def claim (s : State) (uid : Uid) (id : GrantId) : Decision :=
  match s.goalRoot uid with
  | none => .notARequest
  | some r =>
      if s.claimed uid then .alreadyClaimed
      else match s.rows id with
        | none => .noGrant
        | some row =>
            if row.revoked then .noGrant
            else if row.root ≠ r then .outsideRoot
            else if row.launchBudget ≤ s.used id then .budgetSpent
            else if row.maxConcurrent ≤ s.heldCount r then .atCapacity
            else .start

/-- What the IDE hands `decideLaunch`: the grant only if the row is in force
and belongs to the root the goal sits under now. -/
def gateGrant (s : State) (uid : Uid) (id : GrantId) : Option GateGrant :=
  match s.goalRoot uid, s.rows id with
  | some r, some row =>
      if row.revoked = false ∧ row.root = r then
        some { maxConcurrent := row.maxConcurrent, launchBudget := row.launchBudget }
      else none
  | _, _ => none

def gateInput (s : State) (uid : Uid) (id : GrantId) : GateInput :=
  { grant := gateGrant s uid id
    alreadyClaimed := s.claimed uid
    used := s.used id
    held := match s.goalRoot uid with
      | some r => s.heldCount r
      | none => 0 }

def release (s : State) (uid : Uid) : State :=
  match s.holder uid with
  | none => s
  | some root =>
      { s with holder := upd s.holder uid none,
               heldCount := upd s.heldCount root (s.heldCount root - 1) }

def startClaim (s : State) (uid : Uid) (root : Root) (id : GrantId) : State :=
  { s with claimed := upd s.claimed uid true,
           holder := upd s.holder uid (some root),
           heldCount := upd s.heldCount root (s.heldCount root + 1),
           used := upd s.used id (s.used id + 1) }

def attempt (s : State) (uid : Uid) (id : GrantId) : State × Option Decision :=
  match s.goalRoot uid with
  | none => (s, some (claim s uid id))
  | some r =>
      if claim s uid id = .start then (startClaim s uid r id, some .start)
      else (s, some (claim s uid id))

/-- One event; the decision is set for attempts. -/
def step (s : State) : Event → State × Option Decision
  | .grant root m b =>
      ({ s with rows := saveRows s root m b, nextGrantId := s.nextGrantId + 1 }, none)
  | .revoke id => ({ s with rows := upd s.rows id ((s.rows id).map revokeRow) }, none)
  | .request uid root =>
      match s.goalRoot uid with
      | some _ => (s, none)
      | none => ({ s with goalRoot := upd s.goalRoot uid (some root) }, none)
  | .move uid root =>
      match s.goalRoot uid with
      | none => (s, none)
      | some _ => ({ s with goalRoot := upd s.goalRoot uid (some root) }, none)
  | .attempt uid id => attempt s uid id
  | .running _ => (s, none)
  | .spawnFailed uid => (release s uid, none)
  | .finished uid => (release s uid, none)

def runEvents (s : State) : List Event → State
  | [] => s
  | e :: es => runEvents (step s e).1 es

/-! ## The claim and its relation to the gate -/

theorem claim_start_iff (s : State) (uid : Uid) (id : GrantId) :
    claim s uid id = .start ↔
      ∃ r row, s.goalRoot uid = some r ∧ s.claimed uid = false ∧ s.rows id = some row ∧
        row.revoked = false ∧ row.root = r ∧ s.used id < row.launchBudget ∧
        s.heldCount r < row.maxConcurrent := by
  unfold claim
  cases hg : s.goalRoot uid with
  | none => simp
  | some r =>
      cases hc : s.claimed uid with
      | true => simp
      | false =>
          cases hrow : s.rows id with
          | none => simp
          | some row =>
              cases hrv : row.revoked with
              | true => simp [hrv]
              | false =>
                  by_cases h1 : row.root = r
                  · by_cases h2 : row.launchBudget ≤ s.used id
                    · simp [hrv, h1, h2] <;> omega
                    · by_cases h3 : row.maxConcurrent ≤ s.heldCount r
                      · simp [hrv, h1, h2, h3]
                      · simp [hrv, h1, h2, h3]; omega
                  · simp [hrv, h1]

/-- The native claim starts exactly when the request is real and the
TypeScript gate, fed with the grant resolved for the goal's current root,
says start. -/
theorem claim_start_iff_gate (s : State) (uid : Uid) (id : GrantId) :
    claim s uid id = .start ↔ s.goalRoot uid ≠ none ∧ decide (gateInput s uid id) = .start := by
  rw [claim_start_iff, decide_start_iff]
  constructor
  · rintro ⟨r, row, hg, hc, hrow, hrv, hroot, hu, hh⟩
    refine ⟨by simp [hg], ⟨row.maxConcurrent, row.launchBudget⟩, ?_, hc,
      by simpa [gateInput] using hu, ?_⟩
    · simp [gateInput, gateGrant, hg, hrow, hrv, hroot]
    · simpa [gateInput, hg] using hh
  · rintro ⟨hne, g, hgg, hc, hu, hh⟩
    cases hg : s.goalRoot uid with
    | none => exact absurd hg hne
    | some r =>
        cases hrow : s.rows id with
        | none => simp [gateInput, gateGrant, hg, hrow] at hgg
        | some row =>
            by_cases hin : row.revoked = false ∧ row.root = r
            · simp [gateInput, gateGrant, hg, hrow, hin] at hgg
              subst hgg
              refine ⟨r, row, rfl, hc, rfl, hin.1, hin.2, hu, ?_⟩
              simpa [gateInput, hg] using hh
            · simp [gateInput, gateGrant, hg, hrow, hin] at hgg

theorem attempt_decision (s : State) (uid : Uid) (id : GrantId) :
    (attempt s uid id).2 = some (claim s uid id) := by
  unfold attempt
  cases hg : s.goalRoot uid with
  | none => rfl
  | some r =>
      by_cases hd : claim s uid id = .start
      · simp [hd]
      · simp [hd]

theorem attempt_cases (s : State) (uid : Uid) (id : GrantId) :
    ((attempt s uid id).1 = s ∧ claim s uid id ≠ .start) ∨
      ∃ r, s.goalRoot uid = some r ∧ claim s uid id = .start ∧
        (attempt s uid id).1 = startClaim s uid r id := by
  unfold attempt
  cases hg : s.goalRoot uid with
  | none =>
      left
      refine ⟨rfl, ?_⟩
      intro h
      obtain ⟨r, _, hg', _⟩ := (claim_start_iff s uid id).mp h
      rw [hg] at hg'
      cases hg'
  | some r =>
      by_cases hd : claim s uid id = .start
      · right; exact ⟨r, rfl, hd, by simp [hd]⟩
      · left; simp [hd]

theorem step_attempt_start (s : State) (uid : Uid) (id : GrantId)
    (h : (step s (.attempt uid id)).2 = some .start) : claim s uid id = .start := by
  simpa [step, attempt_decision] using h

/-! ## Structural lemmas -/

theorem release_rows (s : State) (uid : Uid) : (release s uid).rows = s.rows := by
  unfold release; cases s.holder uid <;> rfl

theorem release_used (s : State) (uid : Uid) : (release s uid).used = s.used := by
  unfold release; cases s.holder uid <;> rfl

theorem release_goalRoot (s : State) (uid : Uid) :
    (release s uid).goalRoot = s.goalRoot := by
  unfold release; cases s.holder uid <;> rfl

theorem release_next (s : State) (uid : Uid) :
    (release s uid).nextGrantId = s.nextGrantId := by
  unfold release; cases s.holder uid <;> rfl

theorem attempt_rows (s : State) (uid : Uid) (id : GrantId) :
    (attempt s uid id).1.rows = s.rows := by
  rcases attempt_cases s uid id with ⟨h, _⟩ | ⟨r, _, _, h⟩ <;> simp [h, startClaim]

theorem attempt_next (s : State) (uid : Uid) (id : GrantId) :
    (attempt s uid id).1.nextGrantId = s.nextGrantId := by
  rcases attempt_cases s uid id with ⟨h, _⟩ | ⟨r, _, _, h⟩ <;> simp [h, startClaim]

theorem attempt_goalRoot (s : State) (uid : Uid) (id : GrantId) :
    (attempt s uid id).1.goalRoot = s.goalRoot := by
  rcases attempt_cases s uid id with ⟨h, _⟩ | ⟨r, _, _, h⟩ <;> simp [h, startClaim]

def Event.touchesRows : Event → Bool
  | .grant _ _ _ => true
  | .revoke _ => true
  | _ => false

/-- Only grants and revocations touch the grant rows. -/
theorem step_rows_other (s : State) (e : Event) (other : e.touchesRows = false) :
    (step s e).1.rows = s.rows ∧ (step s e).1.nextGrantId = s.nextGrantId := by
  cases e with
  | grant r m b => simp [Event.touchesRows] at other
  | revoke id => simp [Event.touchesRows] at other
  | request uid root => cases hc : s.goalRoot uid <;> simp [step, hc]
  | move uid root => cases hc : s.goalRoot uid <;> simp [step, hc]
  | attempt uid id => exact ⟨attempt_rows s uid id, attempt_next s uid id⟩
  | running uid => simp [step]
  | spawnFailed uid => exact ⟨release_rows s uid, release_next s uid⟩
  | finished uid => exact ⟨release_rows s uid, release_next s uid⟩

/-- No row lives at or beyond the next id: saved ids are fresh. -/
def Fresh (s : State) : Prop := ∀ id, s.nextGrantId ≤ id → s.rows id = none

/-- At most one row per root is in force. -/
def Unique (s : State) : Prop :=
  ∀ id₁ id₂ row₁ row₂, s.rows id₁ = some row₁ → s.rows id₂ = some row₂ →
    row₁.revoked = false → row₂.revoked = false → row₁.root = row₂.root → id₁ = id₂

def Wf (s : State) : Prop := Fresh s ∧ Unique s

/-- A row in force after an event was in force before with the same content,
or it is the row this very event saved. -/
theorem in_force_after_step (s : State) (e : Event) (id : GrantId) (row : GrantRow)
    (h : (step s e).1.rows id = some row) (hr : row.revoked = false) :
    s.rows id = some row ∨
      ∃ m b, e = .grant row.root m b ∧ id = s.nextGrantId ∧
        row = { root := row.root, maxConcurrent := m, launchBudget := b, revoked := false } := by
  have other := step_rows_other s e
  cases e with
  | grant r m b =>
      simp only [step, saveRows] at h
      by_cases hid : id = s.nextGrantId
      · simp [hid] at h
        subst h
        right; exact ⟨m, b, rfl, hid, rfl⟩
      · simp [hid] at h
        obtain ⟨row0, h0, hmap⟩ := h
        by_cases hroot : row0.root = r
        · simp [hroot, revokeRow] at hmap
          subst hmap; simp at hr
        · simp [hroot] at hmap
          subst hmap; left; exact h0
  | revoke rid =>
      simp only [step] at h
      by_cases hid : id = rid
      · subst hid
        simp at h
        obtain ⟨row0, _, hmap⟩ := h
        subst hmap; simp [revokeRow] at hr
      · simp [hid] at h; left; exact h
  | _ =>
      left
      rw [← (other rfl).1]
      exact h

/-- Every row survives every event with its root, limits and budget; a
revoked row stays revoked. -/
theorem row_kept (s : State) (e : Event) (id : GrantId) (row : GrantRow)
    (fresh : Fresh s) (h : s.rows id = some row) :
    ∃ row', (step s e).1.rows id = some row' ∧ row'.root = row.root ∧
      row'.maxConcurrent = row.maxConcurrent ∧ row'.launchBudget = row.launchBudget ∧
      (row.revoked = true → row'.revoked = true) := by
  have other := step_rows_other s e
  cases e with
  | grant r m b =>
      have hid : id ≠ s.nextGrantId := by
        intro hid; rw [fresh id (Nat.le_of_eq hid.symm)] at h; cases h
      by_cases hroot : row.root = r
      · exact ⟨revokeRow row, by simp [step, saveRows, hid, h, hroot], rfl, rfl, rfl,
          fun _ => rfl⟩
      · exact ⟨row, by simp [step, saveRows, hid, h, hroot], rfl, rfl, rfl, fun h => h⟩
  | revoke rid =>
      by_cases hid : id = rid
      · subst hid
        exact ⟨revokeRow row, by simp [step, h], rfl, rfl, rfl, fun _ => rfl⟩
      · exact ⟨row, by simp [step, hid, h], rfl, rfl, rfl, fun h => h⟩
  | _ =>
      refine ⟨row, ?_, rfl, rfl, rfl, fun h => h⟩
      rw [(other rfl).1]
      exact h

theorem wf_initial : Wf State.initial :=
  ⟨fun _ _ => rfl, fun _ _ _ _ h => by simp [State.initial] at h⟩

theorem wf_step (s : State) (e : Event) (wf : Wf s) : Wf (step s e).1 := by
  obtain ⟨fresh, unique⟩ := wf
  have other := step_rows_other s e
  cases e with
  | grant r m b =>
      refine ⟨?_, ?_⟩
      · intro id hid
        have hlt : s.nextGrantId < id := hid
        have hne : id ≠ s.nextGrantId := (Nat.ne_of_lt hlt).symm
        have hnone := fresh id (Nat.le_of_lt hlt)
        simp [step, saveRows, hne, hnone]
      · intro id₁ id₂ row₁ row₂ h₁ h₂ r₁ r₂ same
        rcases in_force_after_step s _ id₁ row₁ h₁ r₁ with old₁ | ⟨m₁, b₁, e₁, n₁, _⟩ <;>
          rcases in_force_after_step s _ id₂ row₂ h₂ r₂ with old₂ | ⟨m₂, b₂, e₂, n₂, _⟩
        · exact unique id₁ id₂ row₁ row₂ old₁ old₂ r₁ r₂ same
        · -- id₂ is the new row of root r; row₁ stayed in force, so its root is not r
          simp at e₂
          have hne : id₁ ≠ s.nextGrantId := by
            intro hid; rw [fresh id₁ (Nat.le_of_eq hid.symm)] at old₁; cases old₁
          have hroot : row₁.root ≠ r := by
            intro hroot
            simp [step, saveRows, hne, old₁, hroot, revokeRow] at h₁
            rw [← h₁] at r₁; simp at r₁
          exact absurd (same.trans e₂.1.symm) hroot
        · simp at e₁
          have hne : id₂ ≠ s.nextGrantId := by
            intro hid; rw [fresh id₂ (Nat.le_of_eq hid.symm)] at old₂; cases old₂
          have hroot : row₂.root ≠ r := by
            intro hroot
            simp [step, saveRows, hne, old₂, hroot, revokeRow] at h₂
            rw [← h₂] at r₂; simp at r₂
          exact absurd (same.symm.trans e₁.1.symm) hroot
        · rw [n₁, n₂]
  | revoke rid =>
      refine ⟨?_, ?_⟩
      · intro id hid
        simp only [step] at hid ⊢
        by_cases h : id = rid
        · subst h; simp [fresh id hid]
        · simp [h, fresh id hid]
      · intro id₁ id₂ row₁ row₂ h₁ h₂ r₁ r₂ same
        rcases in_force_after_step s _ id₁ row₁ h₁ r₁ with old₁ | ⟨_, _, e₁, _⟩
        · rcases in_force_after_step s _ id₂ row₂ h₂ r₂ with old₂ | ⟨_, _, e₂, _⟩
          · exact unique id₁ id₂ row₁ row₂ old₁ old₂ r₁ r₂ same
          · cases e₂
        · cases e₁
  | _ =>
      have := other rfl
      refine ⟨?_, ?_⟩
      · intro id hid
        rw [this.1]; exact fresh id (by rw [this.2] at hid; exact hid)
      · intro id₁ id₂ row₁ row₂ h₁ h₂
        rw [this.1] at h₁ h₂
        exact unique id₁ id₂ row₁ row₂ h₁ h₂

theorem wf_run (s : State) (es : List Event) (wf : Wf s) : Wf (runEvents s es) := by
  induction es generalizing s with
  | nil => simpa [runEvents] using wf
  | cons e rest ih => exact ih _ (wf_step s e wf)

/-! ## REQ-LAUNCH-01: a grant in force for the goal's root, at the decision -/

/-- A start needs a grant row in force at the moment of the decision whose
root is the root the goal sits under at that moment. -/
theorem start_needs_grant_in_force (s : State) (uid : Uid) (id : GrantId)
    (h : (step s (.attempt uid id)).2 = some .start) :
    ∃ r row, s.goalRoot uid = some r ∧ s.rows id = some row ∧
      row.revoked = false ∧ row.root = r := by
  obtain ⟨r, row, hg, _, hrow, hrv, hroot, _⟩ :=
    (claim_start_iff s uid id).mp (step_attempt_start s uid id h)
  exact ⟨r, row, hg, hrow, hrv, hroot⟩

def Revoked (s : State) (id : GrantId) : Prop :=
  ∃ row, s.rows id = some row ∧ row.revoked = true

/-- A revoked or replaced grant id starts nothing. -/
theorem revoked_no_start (s : State) (uid : Uid) (id : GrantId) (hr : Revoked s id) :
    (step s (.attempt uid id)).2 ≠ some .start := by
  intro h
  obtain ⟨_, row, _, hrow, hrv, _⟩ := start_needs_grant_in_force s uid id h
  obtain ⟨row', hrow', hrv'⟩ := hr
  rw [hrow] at hrow'
  cases hrow'
  rw [hrv] at hrv'
  cases hrv'

theorem revoke_takes_effect (s : State) (id : GrantId) (row : GrantRow)
    (h : s.rows id = some row) : Revoked (step s (.revoke id)).1 id :=
  ⟨revokeRow row, by simp [step, h], rfl⟩

/-- Saving a new grant for a root revokes the row it replaces. -/
theorem replacement_revokes (s : State) (id : GrantId) (row : GrantRow) (m b : Nat)
    (fresh : Fresh s) (h : s.rows id = some row) :
    Revoked (step s (.grant row.root m b)).1 id := by
  have hid : id ≠ s.nextGrantId := by
    intro hid; rw [fresh id (Nat.le_of_eq hid.symm)] at h; cases h
  exact ⟨revokeRow row, by simp [step, saveRows, hid, h], rfl⟩

theorem revoked_preserved (s : State) (e : Event) (id : GrantId)
    (fresh : Fresh s) (hr : Revoked s id) : Revoked (step s e).1 id := by
  obtain ⟨row, hrow, hrv⟩ := hr
  obtain ⟨row', h', _, _, _, keep⟩ := row_kept s e id row fresh hrow
  exact ⟨row', h', keep hrv⟩

theorem revoked_for_every_interleaving (s : State) (es : List Event) (id : GrantId)
    (wf : Wf s) (hr : Revoked s id) : Revoked (runEvents s es) id := by
  induction es generalizing s with
  | nil => simpa [runEvents] using hr
  | cons e rest ih =>
      exact ih _ (wf_step s e wf) (revoked_preserved s e id wf.1 hr)

/-- After a revocation, no event sequence brings the id back: every later
attempt that carries it is refused, here or in any other instance. -/
theorem revocation_holds (s : State) (id : GrantId) (row : GrantRow) (es : List Event)
    (uid : Uid) (wf : Wf s) (h : s.rows id = some row) :
    (step (runEvents (step s (.revoke id)).1 es) (.attempt uid id)).2 ≠ some .start :=
  revoked_no_start _ uid id
    (revoked_for_every_interleaving _ es id (wf_step s _ wf) (revoke_takes_effect s id row h))

/-- The same for a grant that a newer grant for its root replaced. -/
theorem replacement_holds (s : State) (id : GrantId) (row : GrantRow) (m b : Nat)
    (es : List Event) (uid : Uid) (wf : Wf s) (h : s.rows id = some row) :
    (step (runEvents (step s (.grant row.root m b)).1 es) (.attempt uid id)).2 ≠ some .start :=
  revoked_no_start _ uid id
    (revoked_for_every_interleaving _ es id (wf_step s _ wf)
      (replacement_revokes s id row m b wf.1 h))

/-- A goal moved out of the grant's root is refused as outside the root. -/
theorem moved_goal_outside_root (s : State) (uid : Uid) (id : GrantId) (r : Root)
    (row : GrantRow) (written : s.goalRoot uid ≠ none) (open_ : s.claimed uid = false)
    (hrow : s.rows id = some row) (inForce : row.revoked = false) (elsewhere : row.root ≠ r) :
    (step (step s (.move uid r)).1 (.attempt uid id)).2 = some .outsideRoot := by
  cases hg : s.goalRoot uid with
  | none => exact absurd hg written
  | some r0 =>
      simp [step, hg, attempt_decision, claim, open_, hrow, inForce, elsewhere]

/-- No clock: a request written before any grant starts once a grant for its
root is saved, when budget and a slot are free. -/
theorem waiting_request_starts_after_grant (s : State) (uid : Uid) (r : Root) (m b : Nat)
    (written : s.goalRoot uid = some r) (open_ : s.claimed uid = false)
    (budget : s.used s.nextGrantId < b) (slot : s.heldCount r < m) :
    (step (step s (.grant r m b)).1 (.attempt uid s.nextGrantId)).2 = some .start := by
  have : claim (step s (.grant r m b)).1 uid s.nextGrantId = .start := by
    rw [claim_start_iff]
    exact ⟨r, { root := r, maxConcurrent := m, launchBudget := b, revoked := false },
      by simpa [step] using written, by simpa [step] using open_,
      by simp [step, saveRows], rfl, rfl, by simpa [step] using budget,
      by simpa [step] using slot⟩
  simp only [step, attempt_decision] at this ⊢
  rw [this]

/-- A witness from the initial state: request first, grant later, start. -/
theorem waiting_request_example :
    (step (runEvents State.initial [.request 0 0, .attempt 0 0, .grant 0 1 1])
      (.attempt 0 0)).2 = some .start := by
  decide

/-! ## REQ-LAUNCH-02: never more than the limit; unclear starts keep their slot -/

theorem start_below_limit (s : State) (uid : Uid) (id : GrantId)
    (h : (step s (.attempt uid id)).2 = some .start) :
    ∃ r row, s.goalRoot uid = some r ∧ s.rows id = some row ∧ row.revoked = false ∧
      row.root = r ∧ s.heldCount r < row.maxConcurrent ∧
      (step s (.attempt uid id)).1.heldCount r = s.heldCount r + 1 := by
  have hc := step_attempt_start s uid id h
  obtain ⟨r, row, hg, _, hrow, hrv, hroot, _, hh⟩ := (claim_start_iff s uid id).mp hc
  rcases attempt_cases s uid id with ⟨_, hne⟩ | ⟨r', hg', _, hs⟩
  · exact absurd hc hne
  · rw [hg] at hg'
    cases hg'
    exact ⟨r, row, hg, hrow, hrv, hroot, hh, by simp [step, hs, startClaim]⟩

/-- The limit invariant for one root: its held slots fit every grant in force. -/
def LimitOk (r : Root) (s : State) : Prop :=
  ∀ id row, s.rows id = some row → row.revoked = false → row.root = r →
    s.heldCount r ≤ row.maxConcurrent

theorem release_count_le (s : State) (uid : Uid) (r : Root) :
    (release s uid).heldCount r ≤ s.heldCount r := by
  unfold release
  cases hh : s.holder uid with
  | none => simp
  | some root =>
      by_cases h : r = root
      · subst h; simp
      · simp [h]

/-- Every event but a grant for `r` keeps the limit of `r`. -/
theorem limit_preserved (s : State) (r : Root) (e : Event) (wf : Wf s)
    (ok : LimitOk r s) (notGrant : e.grantsRoot ≠ some r) :
    LimitOk r (step s e).1 := by
  intro id row hrow hrv hroot
  have old : s.rows id = some row := by
    rcases in_force_after_step s e id row hrow hrv with old | ⟨m, b, he, _, _⟩
    · exact old
    · subst he; simp [Event.grantsRoot, hroot] at notGrant
  have bound := ok id row old hrv hroot
  cases e with
  | attempt uid aid =>
      rcases attempt_cases s uid aid with ⟨hs, _⟩ | ⟨r', hg', hc, hs⟩
      · simpa [step, hs] using bound
      · obtain ⟨r'', row', hg'', _, hrow', hrv', hroot', _, hh⟩ :=
          (claim_start_iff s uid aid).mp hc
        rw [hg'] at hg''
        cases hg''
        by_cases hr : r = r'
        · subst hr
          have same := wf.2 id aid row row' old hrow' hrv hrv' (hroot.trans hroot'.symm)
          subst same
          rw [old] at hrow'
          cases hrow'
          simp [step, hs, startClaim]
          omega
        · simp [step, hs, startClaim, hr]
          exact bound
  | spawnFailed uid =>
      exact Nat.le_trans (release_count_le s uid r) bound
  | finished uid =>
      exact Nat.le_trans (release_count_le s uid r) bound
  | grant r' m b => simpa [step] using bound
  | revoke rid => simpa [step] using bound
  | request uid root => cases hc : s.goalRoot uid <;> simpa [step, hc] using bound
  | move uid root => cases hc : s.goalRoot uid <;> simpa [step, hc] using bound
  | running uid => simpa [step] using bound

/-- For every interleaving without a new grant for `r`, the limit of `r` holds. -/
theorem limit_holds_for_every_interleaving (s : State) (r : Root) (es : List Event)
    (wf : Wf s) (ok : LimitOk r s) (noRegrant : ∀ e ∈ es, e.grantsRoot ≠ some r) :
    LimitOk r (runEvents s es) := by
  induction es generalizing s with
  | nil => simpa [runEvents] using ok
  | cons e rest ih =>
      simp only [runEvents]
      exact ih _ (wf_step s e wf) (limit_preserved s r e wf ok (noRegrant e (by simp)))
        (fun x hx => noRegrant x (by simp [hx]))

theorem limit_initial (r : Root) : LimitOk r State.initial := by
  intro _ _ h
  simp [State.initial] at h

/-- A new grant for `r` starts the invariant again when the slots already
held fit its limit. -/
theorem limit_after_grant (s : State) (r : Root) (m b : Nat) (fresh : Fresh s)
    (fits : s.heldCount r ≤ m) : LimitOk r (step s (.grant r m b)).1 := by
  intro id row hrow hrv hroot
  rcases in_force_after_step s _ id row hrow hrv with old | ⟨m', b', he, _, hrow'⟩
  · have hne : id ≠ s.nextGrantId := by
      intro hid; rw [fresh id (Nat.le_of_eq hid.symm)] at old; cases old
    simp [step, saveRows, hne, old, hroot, revokeRow] at hrow
    rw [← hrow] at hrv; simp at hrv
  · simp at he
    obtain ⟨_, hm, _⟩ := he
    rw [hrow']
    simpa [step, ← hm] using fits

/-- Fail closed: only an explicit resolution frees a slot. A start whose
outcome is unclear (no `spawnFailed`, no `finished`) keeps counting. -/
theorem slots_only_freed_by_resolution (s : State) (r : Root) (e : Event)
    (unresolved : e.resolves = false) :
    s.heldCount r ≤ (step s e).1.heldCount r := by
  cases e with
  | grant root m b => simp [step]
  | revoke id => simp [step]
  | request uid root => cases hc : s.goalRoot uid <;> simp [step, hc]
  | move uid root => cases hc : s.goalRoot uid <;> simp [step, hc]
  | attempt uid id =>
      rcases attempt_cases s uid id with ⟨hs, _⟩ | ⟨root, _, _, hs⟩
      · simp [step, hs]
      · simp only [step, hs, startClaim]
        by_cases h : r = root
        · subst h; simp
        · simp [h]
  | running uid => simp [step]
  | spawnFailed uid => simp [Event.resolves] at unresolved
  | finished uid => simp [Event.resolves] at unresolved

/-! ## REQ-LAUNCH-03: the budget stops automatic starts -/

theorem start_within_budget (s : State) (uid : Uid) (id : GrantId)
    (h : (step s (.attempt uid id)).2 = some .start) :
    ∃ row, s.rows id = some row ∧ s.used id < row.launchBudget ∧
      (step s (.attempt uid id)).1.used id = s.used id + 1 := by
  have hc := step_attempt_start s uid id h
  obtain ⟨r, row, hg, _, hrow, _, _, hu, _⟩ := (claim_start_iff s uid id).mp hc
  rcases attempt_cases s uid id with ⟨_, hne⟩ | ⟨r', _, _, hs⟩
  · exact absurd hc hne
  · exact ⟨row, hrow, hu, by simp [step, hs, startClaim]⟩

/-- Usage never goes down, whatever happens. -/
theorem used_monotone (s : State) (e : Event) (id : GrantId) :
    s.used id ≤ (step s e).1.used id := by
  cases e with
  | grant root m b => simp [step]
  | revoke rid => simp [step]
  | request uid root => cases hc : s.goalRoot uid <;> simp [step, hc]
  | move uid root => cases hc : s.goalRoot uid <;> simp [step, hc]
  | attempt uid aid =>
      rcases attempt_cases s uid aid with ⟨hs, _⟩ | ⟨root, _, _, hs⟩
      · simp [step, hs]
      · simp only [step, hs, startClaim]
        by_cases h : id = aid
        · subst h; simp
        · simp [h]
  | running uid => simp [step]
  | spawnFailed uid => simp [step, release_used]
  | finished uid => simp [step, release_used]

/-- The budget of grant row `id` is spent. -/
def BudgetSpent (id : GrantId) (s : State) : Prop :=
  ∃ row, s.rows id = some row ∧ row.launchBudget ≤ s.used id

theorem spent_budget_no_start (s : State) (uid : Uid) (id : GrantId)
    (spent : BudgetSpent id s) : (step s (.attempt uid id)).2 ≠ some .start := by
  intro h
  obtain ⟨row, hrow, hu, _⟩ := start_within_budget s uid id h
  obtain ⟨row', hrow', hspent⟩ := spent
  rw [hrow] at hrow'
  cases hrow'
  omega

theorem budget_spent_preserved (s : State) (id : GrantId) (e : Event)
    (fresh : Fresh s) (spent : BudgetSpent id s) : BudgetSpent id (step s e).1 := by
  obtain ⟨row, hrow, hspent⟩ := spent
  obtain ⟨row', h', _, _, hb, _⟩ := row_kept s e id row fresh hrow
  exact ⟨row', h', by rw [hb]; exact Nat.le_trans hspent (used_monotone s e id)⟩

/-- Once spent, the budget of a grant id stays spent for every interleaving. -/
theorem budget_spent_for_every_interleaving (s : State) (id : GrantId) (es : List Event)
    (wf : Wf s) (spent : BudgetSpent id s) : BudgetSpent id (runEvents s es) := by
  induction es generalizing s with
  | nil => simpa [runEvents] using spent
  | cons e rest ih =>
      exact ih _ (wf_step s e wf) (budget_spent_preserved s id e wf.1 spent)

/-- `id` is the only grant row of `r` that can be in force. -/
def OnlyGrant (r : Root) (id : GrantId) (s : State) : Prop :=
  ∀ id' row, s.rows id' = some row → row.revoked = false → row.root = r → id' = id

theorem only_grant_preserved (s : State) (r : Root) (id : GrantId) (e : Event)
    (only : OnlyGrant r id s) (notGrant : e.grantsRoot ≠ some r) :
    OnlyGrant r id (step s e).1 := by
  intro id' row hrow hrv hroot
  rcases in_force_after_step s e id' row hrow hrv with old | ⟨m, b, he, _, _⟩
  · exact only id' row old hrv hroot
  · subst he; simp [Event.grantsRoot, hroot] at notGrant

theorem only_grant_for_every_interleaving (s : State) (r : Root) (id : GrantId)
    (es : List Event) (only : OnlyGrant r id s) (noRegrant : ∀ e ∈ es, e.grantsRoot ≠ some r) :
    OnlyGrant r id (runEvents s es) := by
  induction es generalizing s with
  | nil => simpa [runEvents] using only
  | cons e rest ih =>
      simp only [runEvents]
      exact ih _ (only_grant_preserved s r id e only (noRegrant e (by simp)))
        (fun x hx => noRegrant x (by simp [hx]))

/-- REQ-LAUNCH-03 for the root: when the budget of the grant in force for `r`
is spent, no request whose goal sits under `r` starts, with any grant id, for
every interleaving until a person saves a new grant for `r`. -/
theorem budget_stops_root (s : State) (id : GrantId) (row : GrantRow) (es : List Event)
    (wf : Wf s) (hrow : s.rows id = some row) (inForce : row.revoked = false)
    (spent : BudgetSpent id s) (noRegrant : ∀ e ∈ es, e.grantsRoot ≠ some row.root)
    (uid : Uid) (id' : GrantId) (under : (runEvents s es).goalRoot uid = some row.root) :
    (step (runEvents s es) (.attempt uid id')).2 ≠ some .start := by
  have only := only_grant_for_every_interleaving s row.root id es
    (fun id₂ row₂ h₂ r₂ root₂ => wf.2 id₂ id row₂ row h₂ hrow r₂ inForce root₂) noRegrant
  intro h
  obtain ⟨r, row', hg, hrow', hrv', hroot'⟩ := start_needs_grant_in_force _ uid id' h
  rw [under] at hg
  cases hg
  have same := only id' row' hrow' hrv' hroot'
  subst same
  exact spent_budget_no_start _ uid id' (budget_spent_for_every_interleaving s id' es wf spent) h

/-! ## Executable oracle: generated traces with the model's decisions -/

/-- A small deterministic generator (LCG); the corpus is byte-stable. -/
def nextSeed (seed : Nat) : Nat := (seed * 1103515245 + 12345) % 2147483648

/-- A grant id no row ever gets: an instance that has not seen any grant. -/
def UNKNOWN_GRANT : GrantId := 1000

def ROOTS : Nat := 3

structure Gen where
  seed : Nat
  nextUid : Uid
  nextGrant : GrantId
  /-- Issued grant ids with their root, oldest first. -/
  issued : List (GrantId × Root)
  /-- Written requests: uid, root when written, root now. -/
  requests : List (Uid × Root × Root)
  events : List Event

def pick (g : Gen) (bound : Nat) : Gen × Nat :=
  let seed := nextSeed g.seed
  ({ g with seed }, if bound = 0 then 0 else (seed / 65536) % bound)

/-- Appends an event and keeps the generator's own view of ids and goals. -/
def emit (g : Gen) (e : Event) : Gen :=
  let g := { g with events := g.events ++ [e] }
  match e with
  | .grant root _ _ =>
      { g with issued := g.issued ++ [(g.nextGrant, root)], nextGrant := g.nextGrant + 1 }
  | .request uid root =>
      if g.requests.any (fun p => p.1 == uid) then g
      else { g with requests := g.requests ++ [(uid, root, root)], nextUid := max g.nextUid (uid + 1) }
  | .move uid root =>
      { g with requests := g.requests.map fun p => if p.1 == uid then (p.1, p.2.1, root) else p }
  | _ => g

/-- The newest grant id saved for a root, as an instance that saw it holds it. -/
def latestFor (g : Gen) (root : Root) : GrantId :=
  match (g.issued.filter (fun p => p.2 == root)).getLast? with
  | some p => p.1
  | none => UNKNOWN_GRANT

/-- Any id issued so far (replaced, revoked or of another root included). -/
def anyIssued (g : Gen) : Gen × GrantId :=
  let (g, n) := pick g g.issued.length
  (g, match g.issued[n]? with
    | some p => p.1
    | none => UNKNOWN_GRANT)

/-- Root 0 carries most traffic, root 2 is rarely granted. -/
def pickRoot (g : Gen) : Gen × Root :=
  let (g, n) := pick g 6
  (g, if n < 3 then 0 else if n < 5 then 1 else 2)

/-- A written request, leaning towards the most recent; none if there is none. -/
def pickRequest (g : Gen) : Gen × Option (Uid × Root × Root) :=
  let (g, back) := pick g 3
  let n := g.requests.length
  if n = 0 then (g, none) else (g, g.requests[n - 1 - back % n]?)

def genEvent (g : Gen) : Gen :=
  let (g, kind) := pick g 24
  let (g, root) := pickRoot g
  let (g, target) := pickRequest g
  -- Attempts and resolutions on nothing written target the next, unwritten uid.
  let uid := match target with
    | some t => t.1
    | none => g.nextUid
  if kind < 1 then
    let (g, m) := pick g 2
    let (g, b) := pick g 3
    emit g (.grant root (m + 1) (b + 1))
  else if kind < 2 then
    let (g, view) := pick g 3
    if view < 2 then emit g (.revoke (latestFor g root))
    else
      let (g, id) := anyIssued g
      emit g (.revoke id)
  else if kind < 7 then emit g (.request g.nextUid root)
  else if kind < 9 then emit g (.move uid root)
  else if kind < 17 || 21 < kind then
    -- The id the deciding instance holds: for the goal's root now, for the root
    -- it saw when the request was written (stale after a move), or any old one.
    let (g, view) := pick g 4
    let (g, id) :=
      if view < 2 then (g, latestFor g (match target with | some t => t.2.2 | none => root))
      else if view < 3 then (g, latestFor g (match target with | some t => t.2.1 | none => root))
      else anyIssued g
    emit g (.attempt uid id)
  else if kind < 19 then emit g (.running uid)
  else if kind < 20 then emit g (.spawnFailed uid)
  else emit g (.finished uid)

/-- Four openings: grants first; requests that wait for a grant; a goal that
moves out of its granted root; nothing. The random tail follows. -/
def opening (index : Nat) : List Event :=
  match index % 4 with
  | 0 => [.grant 0 2 3, .grant 1 1 2]
  | 1 => [.request 0 0, .request 1 0, .request 2 1, .attempt 0 UNKNOWN_GRANT,
          .grant 0 1 2, .grant 1 1 1, .attempt 0 0, .attempt 1 0, .attempt 2 1]
  | 2 => [.grant 0 2 3, .request 0 0, .move 0 1, .attempt 0 0, .grant 1 1 2, .attempt 0 1]
  | _ => []

def genTrace (index : Nat) : List Event :=
  let start : Gen :=
    { seed := index * 7919 + 17, nextUid := 0, nextGrant := 0, issued := [], requests := [],
      events := [] }
  let start := (opening index).foldl emit start
  (List.range (14 + index % 21)).foldl (fun g _ => genEvent g) start |>.events

/-- Per step: the native claim's decision and the TypeScript gate's decision. -/
def decisionsOf (s : State) : List Event → List (Option Decision × Option Decision)
  | [] => []
  | e :: es =>
      let gate := match e with
        | .attempt uid id => some (decide (gateInput s uid id))
        | _ => none
      ((step s e).2, gate) :: decisionsOf (step s e).1 es

private def quote (value : String) : String := "\"" ++ value ++ "\""

def renderDecision : Option Decision → String
  | none => "null"
  | some .start => quote "start"
  | some .notARequest => quote "not-a-request"
  | some .alreadyClaimed => quote "already-claimed"
  | some .noGrant => quote "no-grant"
  | some .outsideRoot => quote "outside-root"
  | some .budgetSpent => quote "budget-spent"
  | some .atCapacity => quote "at-capacity"

def renderEvent : Event → String
  | .grant root m b =>
      "{\"kind\":\"grant\",\"root\":" ++ toString root ++ ",\"maxConcurrent\":" ++
        toString m ++ ",\"launchBudget\":" ++ toString b ++ "}"
  | .revoke id => "{\"kind\":\"revoke\",\"grant\":" ++ toString id ++ "}"
  | .request uid root =>
      "{\"kind\":\"request\",\"uid\":" ++ toString uid ++ ",\"root\":" ++ toString root ++ "}"
  | .move uid root =>
      "{\"kind\":\"move\",\"uid\":" ++ toString uid ++ ",\"root\":" ++ toString root ++ "}"
  | .attempt uid id =>
      "{\"kind\":\"attempt\",\"uid\":" ++ toString uid ++ ",\"grant\":" ++ toString id ++ "}"
  | .running uid => "{\"kind\":\"running\",\"uid\":" ++ toString uid ++ "}"
  | .spawnFailed uid => "{\"kind\":\"spawn-failed\",\"uid\":" ++ toString uid ++ "}"
  | .finished uid => "{\"kind\":\"finished\",\"uid\":" ++ toString uid ++ "}"

def renderList {α : Type} (render : α → String) (items : List α) : String :=
  "[" ++ String.intercalate "," (items.map render) ++ "]"

def TRACE_COUNT : Nat := 360

def renderTrace (index : Nat) : String :=
  let events := genTrace index
  let final := runEvents State.initial events
  let steps := decisionsOf State.initial events
  "{\"version\":\"launch-gate-v1\",\"trace\":" ++ toString index ++
    ",\"events\":" ++ renderList renderEvent events ++
    ",\"decisions\":" ++ renderList renderDecision (steps.map (·.1)) ++
    ",\"gate\":" ++ renderList renderDecision (steps.map (·.2)) ++
    ",\"final\":{\"heldCount\":" ++ renderList toString ((List.range ROOTS).map final.heldCount) ++
    ",\"used\":" ++ renderList toString ((List.range final.nextGrantId).map final.used) ++ "}}"

def emitOracle : IO Unit :=
  (List.range TRACE_COUNT).forM fun index => IO.println (renderTrace index)

end AuricIDE.LaunchGate
