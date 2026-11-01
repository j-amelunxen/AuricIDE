import Std

/-!
# The PM gateway of a supervisor: scope and child cache

A supervisor reaches a project's PM tools through two tools of its own server
(`pm_tools`, `pm_call`). Each call asks Rust which folder the current policy
allows (`pm_target`, `src-tauri/src/supervisor/pm_target.rs`) and only then uses
a child server (`src/mcp/supervisorPm.ts`). This model is that order, over every
trace of policy changes and calls.

Proved for every trace:

* A call reaches a child only if the project is permitted and initialised by the
  policy in force at that step, also when a child for it is cached from earlier
  (`reached_needs_permit_at_that_step`, `revoked_unreachable`).
* A refused call changes nothing and starts nothing (`refused_changes_nothing`).
* A name that fits two projects never reaches a child (`ambiguous_never_reaches`,
  `resolved_name_is_unique`).
* The cache stays within its limit (`cache_within_limit`).

Not modelled, and left to tests: spawning processes, JSON-RPC framing, the
socket, path canonicalisation and the file check behind `initialised`, and
concurrent calls. The corpus shows the Rust resolver and the TypeScript gateway
agree with this model on the emitted traces; it does not prove them equal to it.
-/

namespace AuricIDE.PmScope

structure Entry where
  path : String
  name : String
  allowed : Bool
  initialised : Bool
  deriving Repr, DecidableEq

abbrev Policy := List Entry

def permitted (policy : Policy) : List Entry := policy.filter (·.allowed)

/-! ## Old server names: `auric-pm-<slug>`, numbered over the permitted projects -/

def slug (entry : Entry) : String := entry.name.toLower

/-- The permitted entries sharing `entry`'s slug, in policy order. -/
def slugGroup (policy : Policy) (entry : Entry) : List Entry :=
  (permitted policy).filter (fun other => slug other == slug entry)

def serverName (policy : Policy) (entry : Entry) : String :=
  let position := ((slugGroup policy entry).map (·.path)).idxOf entry.path
  if position == 0 then "auric-pm-" ++ slug entry
  else "auric-pm-" ++ slug entry ++ "-" ++ toString (position + 1)

/-- A numbered name was only ever right for the policy it was handed out under,
so it stands for its whole slug group, not for one project of it. -/
def namedByServer (policy : Policy) (reference : String) (entry : Entry) : Bool :=
  (slugGroup policy entry).any (fun other => serverName policy other == reference)

def fits (policy : Policy) (reference : String) (entry : Entry) : Bool :=
  entry.path == reference || entry.name.toLower == reference.toLower ||
    namedByServer policy reference entry

def candidates (policy : Policy) (reference : String) : List Entry :=
  (permitted policy).filter (fits policy reference)

/-! ## The resolver -/

inductive Resolution where
  | ok (path : String)
  | unknown
  | notInitialised (path : String)
  | ambiguous (paths : List String)
  | noneInitialised
  deriving Repr, DecidableEq

def resolve (policy : Policy) : Option String → Resolution
  | none =>
    match (permitted policy).find? (·.initialised) with
    | some entry => .ok entry.path
    | none => .noneInitialised
  | some reference =>
    match candidates policy reference with
    | [] => .unknown
    | [entry] => if entry.initialised then .ok entry.path else .notInitialised entry.path
    | several => .ambiguous (several.map (·.path))

/-- The policy says this folder may be used right now. -/
def Permits (policy : Policy) (path : String) : Prop :=
  ∃ entry ∈ policy, entry.path = path ∧ entry.allowed = true ∧ entry.initialised = true

/- specuuid: s_74e9yrm1 covers: el_ff0j17a0 -/
theorem resolve_ok_permits (policy : Policy) (reference : Option String) (path : String)
    (resolved : resolve policy reference = .ok path) : Permits policy path := by
  cases reference with
  | none =>
    simp only [resolve] at resolved
    split at resolved
    · rename_i entry found
      have equal : entry.path = path := by simpa using resolved
      have member := List.mem_of_find?_eq_some found
      have initialised := List.find?_some found
      have inPolicy := List.mem_filter.mp member
      exact ⟨entry, inPolicy.1, equal, inPolicy.2, initialised⟩
    · cases resolved
  | some reference =>
    simp only [resolve] at resolved
    split at resolved
    · cases resolved
    · rename_i entry only
      have member : entry ∈ candidates policy reference := by simp [only]
      have inPermitted := (List.mem_filter.mp member).1
      have inPolicy := List.mem_filter.mp inPermitted
      split at resolved
      · rename_i initialised
        have equal : entry.path = path := by simpa using resolved
        exact ⟨entry, inPolicy.1, equal, inPolicy.2, initialised⟩
      · cases resolved
    · cases resolved

/- specuuid: s_9vmj0fsb covers: el_ff0j17a0 -/
/-- A name resolves only when exactly one permitted project fits it. -/
theorem resolved_name_is_unique (policy : Policy) (reference path : String)
    (resolved : resolve policy (some reference) = .ok path) :
    ∃ entry, candidates policy reference = [entry] ∧ entry.path = path := by
  simp only [resolve] at resolved
  split at resolved
  · cases resolved
  · rename_i entry only
    split at resolved
    · exact ⟨entry, only, by simpa using resolved⟩
    · cases resolved
  · cases resolved

/-! ## The gateway -/

def cacheLimit : Nat := 8

structure Gateway where
  policy : Policy
  /-- Child servers kept for reuse, most recently used first. -/
  cache : List String
  deriving Repr, DecidableEq

inductive Step where
  | setPolicy (policy : Policy)
  | call (reference : Option String) (tool : String)
  deriving Repr, DecidableEq

inductive Outcome where
  | policySet
  | reached (path tool : String) (started : Bool) (closed : Option String)
  | refused (why : Resolution)
  deriving Repr, DecidableEq

/-- The child for `path`: reused when cached, else started, closing the least
recently used one when that would pass the limit. -/
def useChild (cache : List String) (path : String) : List String × Bool × Option String :=
  if path ∈ cache then (path :: cache.filter (· != path), false, none)
  else if cache.length < cacheLimit then (path :: cache, true, none)
  else (path :: cache.dropLast, true, cache.getLast?)

/-- Policy first, cache second. -/
def stepCall (gateway : Gateway) (reference : Option String) (tool : String) :
    Gateway × Outcome :=
  match resolve gateway.policy reference with
  | .ok path =>
    let (cache, started, closed) := useChild gateway.cache path
    ({ gateway with cache }, .reached path tool started closed)
  | why => (gateway, .refused why)

def step (gateway : Gateway) : Step → Gateway × Outcome
  | .setPolicy policy => ({ gateway with policy }, .policySet)
  | .call reference tool => stepCall gateway reference tool

def run (gateway : Gateway) : List Step → Gateway × List Outcome
  | [] => (gateway, [])
  | next :: rest =>
    let (after, outcome) := step gateway next
    let (final, outcomes) := run after rest
    (final, outcome :: outcomes)

/-- The policy in force after `steps`, read from the steps alone. -/
def policyInForce (initial : Policy) : List Step → Policy
  | [] => initial
  | .setPolicy policy :: rest => policyInForce policy rest
  | .call _ _ :: rest => policyInForce initial rest

/-! ## What holds for every trace -/

theorem stepCall_policy (gateway : Gateway) (reference : Option String) (tool : String) :
    (stepCall gateway reference tool).1.policy = gateway.policy := by
  unfold stepCall
  split <;> rfl

theorem run_policy (gateway : Gateway) (steps : List Step) :
    (run gateway steps).1.policy = policyInForce gateway.policy steps := by
  induction steps generalizing gateway with
  | nil => rfl
  | cons next rest ih =>
    cases next with
    | setPolicy policy =>
      simp only [run, step]
      exact ih { gateway with policy }
    | call reference tool =>
      simp only [run, step]
      have := ih (stepCall gateway reference tool).1
      rw [stepCall_policy] at this
      exact this

theorem run_outcomes_length (gateway : Gateway) (steps : List Step) :
    (run gateway steps).2.length = steps.length := by
  induction steps generalizing gateway with
  | nil => rfl
  | cons next rest ih =>
    simp only [run, List.length_cons]
    rw [ih]

theorem run_append (gateway : Gateway) (before after : List Step) :
    (run gateway (before ++ after)).2 =
      (run gateway before).2 ++ (run (run gateway before).1 after).2 := by
  induction before generalizing gateway with
  | nil => rfl
  | cons next rest ih =>
    simp only [List.cons_append, run, List.cons_append, List.cons.injEq, true_and]
    exact ih _

theorem stepCall_reached_permits (gateway : Gateway) (reference : Option String)
    (tool path reachedTool : String) (started : Bool) (closed : Option String)
    (reached : (stepCall gateway reference tool).2 = .reached path reachedTool started closed) :
    Permits gateway.policy path := by
  unfold stepCall at reached
  split at reached
  · rename_i resolvedPath resolved
    have equal : resolvedPath = path := by
      simp only [Outcome.reached.injEq] at reached
      exact reached.1
    exact equal ▸ resolve_ok_permits _ _ _ resolved
  · cases reached

/- specuuid: s_rsbx5ja9 covers: el_h6np2qvy -/
/-- **The core.** Whatever came before, and whatever the cache holds by then: the
call at this position reaches a child only if the policy in force at this
position permits it. `policyInForce` reads only the steps before it. -/
theorem reached_needs_permit_at_that_step (gateway : Gateway) (before after : List Step)
    (reference : Option String) (tool path reachedTool : String) (started : Bool)
    (closed : Option String)
    (reached : (run gateway (before ++ .call reference tool :: after)).2[before.length]? =
      some (.reached path reachedTool started closed)) :
    Permits (policyInForce gateway.policy before) path := by
  rw [run_append, List.getElem?_append_right (by rw [run_outcomes_length]; omega)] at reached
  rw [run_outcomes_length, Nat.sub_self] at reached
  simp only [run, step, List.getElem?_cons_zero, Option.some.injEq] at reached
  have permits := stepCall_reached_permits _ _ _ _ _ _ _ reached
  rwa [run_policy] at permits

/-- A policy that does not permit `path` keeps every later call from it, however
many times the child was cached, until some later policy permits it again. -/
theorem revoked_unreachable (gateway : Gateway) (path : String) (steps : List Step)
    (revoked : ¬ Permits gateway.policy path)
    (staysRevoked : ∀ policy, Step.setPolicy policy ∈ steps → ¬ Permits policy path) :
    ∀ tool started closed, Outcome.reached path tool started closed ∉ (run gateway steps).2 := by
  induction steps generalizing gateway with
  | nil => simp [run]
  | cons next rest ih =>
    intro tool started closed member
    simp only [run, List.mem_cons] at member
    cases next with
    | setPolicy policy =>
      simp only [step] at member
      rcases member with bad | later
      · cases bad
      · exact ih { gateway with policy } (staysRevoked policy (by simp))
          (fun other inRest => staysRevoked other (by simp [inRest])) tool started closed later
    | call reference called =>
      simp only [step] at member
      rcases member with bad | later
      · exact revoked (stepCall_reached_permits _ _ _ _ _ _ _ bad.symm)
      · refine ih (stepCall gateway reference called).1 ?_ ?_ tool started closed later
        · rw [stepCall_policy]; exact revoked
        · exact fun other inRest => staysRevoked other (by simp [inRest])

/- specuuid: s_3pqtb1r0 covers: el_h6np2qvy -/
/-- Revocation holds at once, with the child still in the cache. -/
theorem revocation_holds_at_once (gateway : Gateway) (path : String) (policy : Policy)
    (reference : Option String) (tool reachedTool : String) (started : Bool)
    (closed : Option String) (revoked : ¬ Permits policy path) :
    (run gateway [.setPolicy policy, .call reference tool]).2 ≠
      [.policySet, .reached path reachedTool started closed] := by
  intro same
  have := revoked_unreachable { gateway with policy } path [.call reference tool] revoked
    (by simp) reachedTool started closed
  apply this
  simp only [run, step, List.cons.injEq, and_true, true_and] at same
  simp [run, step, same]

/-- A refused call leaves the gateway as it found it, cache included. -/
theorem refused_changes_nothing (gateway : Gateway) (reference : Option String) (tool : String)
    (why : Resolution) (refused : (stepCall gateway reference tool).2 = .refused why) :
    (stepCall gateway reference tool).1 = gateway := by
  unfold stepCall at refused ⊢
  split at refused
  · cases refused
  · rfl

/- specuuid: s_br9wgywd covers: el_h6np2qvy -/
/-- Nothing starts or closes except on a call that reached a child. -/
theorem refused_starts_nothing (gateway : Gateway) (reference : Option String) (tool path
    reachedTool : String) (why : Resolution) (started : Bool) (closed : Option String)
    (refused : (stepCall gateway reference tool).2 = .refused why) :
    (stepCall gateway reference tool).2 ≠ .reached path reachedTool started closed := by
  rw [refused]
  intro impossible
  cases impossible

/- specuuid: s_h0c5j21y covers: el_h6np2qvy -/
theorem ambiguous_never_reaches (gateway : Gateway) (reference tool : String)
    (several : 2 ≤ (candidates gateway.policy reference).length) :
    (stepCall gateway (some reference) tool).1 = gateway ∧
      ∃ paths, (stepCall gateway (some reference) tool).2 = .refused (.ambiguous paths) := by
  have resolved : ∃ paths, resolve gateway.policy (some reference) = .ambiguous paths := by
    simp only [resolve]
    split
    · rename_i nothing; simp [nothing] at several
    · rename_i only; simp [only] at several
    · exact ⟨_, rfl⟩
  obtain ⟨paths, resolved⟩ := resolved
  unfold stepCall
  split
  · rename_i other found; rw [resolved] at found; cases found
  · refine ⟨rfl, paths, ?_⟩
    simp [resolved]

/-- A cached child is reused, never started again; only an uncached one starts. -/
theorem cached_child_is_reused (cache : List String) (path : String) (cached : path ∈ cache) :
    (useChild cache path).2.1 = false := by
  simp [useChild, cached]

theorem useChild_within_limit (cache : List String) (path : String)
    (within : cache.length ≤ cacheLimit) : (useChild cache path).1.length ≤ cacheLimit := by
  unfold useChild
  split
  · rename_i cached
    have shorter : (cache.filter (· != path)).length < cache.length :=
      List.length_filter_lt_length_iff_exists.mpr ⟨path, cached, by simp⟩
    simp only [List.length_cons]
    omega
  · split
    · simp only [List.length_cons]; omega
    · simp only [List.length_cons, List.length_dropLast]
      unfold cacheLimit at *
      omega

theorem step_within_limit (gateway : Gateway) (next : Step)
    (within : gateway.cache.length ≤ cacheLimit) :
    (step gateway next).1.cache.length ≤ cacheLimit := by
  cases next with
  | setPolicy policy => exact within
  | call reference tool =>
    simp only [step, stepCall]
    split
    · exact useChild_within_limit _ _ within
    · exact within

/- specuuid: s_g4w39aqh covers: el_h6np2qvy -/
theorem cache_within_limit (gateway : Gateway) (steps : List Step)
    (within : gateway.cache.length ≤ cacheLimit) :
    (run gateway steps).1.cache.length ≤ cacheLimit := by
  induction steps generalizing gateway with
  | nil => exact within
  | cons next rest ih =>
    simp only [run]
    exact ih _ (step_within_limit gateway next within)

/-! ## The theorems are not empty -/

/-- One permitted, initialised project does reach its child: refusing everything
would satisfy all of the above and be useless. -/
theorem sole_match_is_reached (gateway : Gateway) (reference tool : String) (entry : Entry)
    (only : candidates gateway.policy reference = [entry])
    (initialised : entry.initialised = true) :
    ∃ started closed, (stepCall gateway (some reference) tool).2 =
      .reached entry.path tool started closed := by
  have resolved : resolve gateway.policy (some reference) = .ok entry.path := by
    simp [resolve, only, initialised]
  simp only [stepCall, resolved]
  exact ⟨_, _, rfl⟩

/-- The order that the gateway must not have: look in the cache first, ask the
policy only to start a child. -/
def stepCacheFirst (gateway : Gateway) (reference : Option String) (tool : String)
    (cachedPath : String) : Gateway × Outcome :=
  if cachedPath ∈ gateway.cache then (gateway, .reached cachedPath tool false none)
  else stepCall gateway reference tool

/-- That order reaches a revoked project; the theorems above rule it out. -/
theorem cache_first_reaches_revoked :
    let revoked : Gateway := { policy := [], cache := ["/p/alpha"] }
    ¬ Permits revoked.policy "/p/alpha" ∧
      (stepCacheFirst revoked (some "/p/alpha") "list_epics" "/p/alpha").2 =
        .reached "/p/alpha" "list_epics" false none := by
  simp [Permits, stepCacheFirst]

/-! ## The oracle: generated traces with every decision of the model -/

private def quote (value : String) : String := "\"" ++ value ++ "\""

private def encodeBool (value : Bool) : String := if value then "true" else "false"

private def encodeStrings (values : List String) : String :=
  "[" ++ String.intercalate "," (values.map quote) ++ "]"

private def encodeEntry (entry : Entry) : String :=
  "{\"path\":" ++ quote entry.path ++ ",\"name\":" ++ quote entry.name ++ ",\"allowed\":" ++
    encodeBool entry.allowed ++ ",\"initialized\":" ++ encodeBool entry.initialised ++ "}"

private def encodePolicy (policy : Policy) : String :=
  "[" ++ String.intercalate "," (policy.map encodeEntry) ++ "]"

private def encodeResolution : Resolution → String
  | .ok path => "{\"kind\":\"ok\",\"path\":" ++ quote path ++ "}"
  | .unknown => "{\"kind\":\"unknown\"}"
  | .notInitialised path => "{\"kind\":\"not_initialized\",\"path\":" ++ quote path ++ "}"
  | .ambiguous paths => "{\"kind\":\"ambiguous\",\"candidates\":" ++ encodeStrings paths ++ "}"
  | .noneInitialised => "{\"kind\":\"none_initialized\"}"

private def encodeOption : Option String → String
  | none => "null"
  | some value => quote value

private def encodeCall (reference : Option String) (tool : String) (before : Gateway) : String :=
  let (after, outcome) := stepCall before reference tool
  let (started, closed, reached) :=
    match outcome with
    | .reached _ _ started closed => (started, closed, true)
    | _ => (false, none, false)
  "{\"op\":\"call\",\"project\":" ++ encodeOption reference ++ ",\"tool\":" ++ quote tool ++
    ",\"resolution\":" ++ encodeResolution (resolve before.policy reference) ++
    ",\"reached\":" ++ encodeBool reached ++ ",\"started\":" ++ encodeBool started ++
    ",\"closed\":" ++ encodeOption closed ++ ",\"cache\":" ++ encodeStrings after.cache ++ "}"

private def encodeStep (gateway : Gateway) : Step → String
  | .setPolicy policy => "{\"op\":\"set_policy\",\"policy\":" ++ encodePolicy policy ++ "}"
  | .call reference tool => encodeCall reference tool gateway

private def encodeSteps (gateway : Gateway) : List Step → List String
  | [] => []
  | next :: rest => encodeStep gateway next :: encodeSteps (step gateway next).1 rest

private def renderTrace (name : String) (initial : Policy) (steps : List Step) : String :=
  "{\"version\":\"pm-scope-v1\",\"name\":" ++ quote name ++ ",\"initial\":" ++
    encodePolicy initial ++ ",\"steps\":[" ++
    String.intercalate "," (encodeSteps { policy := initial, cache := [] } steps) ++ "]}"

/-- Sorted by path, as the policy's map is in Rust. -/
private def fullPolicy : Policy :=
  [ { path := "/p/Delta", name := "Delta", allowed := true, initialised := true },
    { path := "/p/alpha", name := "alpha", allowed := true, initialised := true },
    { path := "/p/beta", name := "beta", allowed := true, initialised := false },
    { path := "/p/gamma", name := "gamma", allowed := false, initialised := true },
    { path := "/q/app", name := "app", allowed := true, initialised := true },
    { path := "/r/app", name := "app", allowed := true, initialised := true } ]

private def withoutAlpha : Policy := fullPolicy.filter (·.path != "/p/alpha")

private def withoutTwin : Policy := fullPolicy.filter (·.path != "/r/app")

private def betaInitialised : Policy :=
  fullPolicy.map fun entry =>
    if entry.path == "/p/beta" then { entry with initialised := true } else entry

private def alphaDenied : Policy :=
  fullPolicy.map fun entry =>
    if entry.path == "/p/alpha" then { entry with allowed := false } else entry

private def emptyPolicy : Policy := []

private def manyProjects : Policy :=
  (List.range 11).map fun index =>
    { path := "/w/project" ++ toString index, name := "project" ++ toString index,
      allowed := true, initialised := true }

private def policies : List Policy :=
  [fullPolicy, withoutAlpha, withoutTwin, betaInitialised, alphaDenied, emptyPolicy]

/-- Everything a model might name: paths, folder names in two spellings, old
server names, a project outside every policy, relative and traversal spellings. -/
private def references : List (Option String) :=
  [ none, some "/p/alpha", some "alpha", some "ALPHA", some "auric-pm-alpha", some "/p/beta",
    some "beta", some "auric-pm-beta", some "/p/Delta", some "/p/delta", some "delta", some "DELTA",
    some "auric-pm-delta", some "/p/gamma", some "gamma", some "auric-pm-gamma", some "/q/app",
    some "/r/app", some "app", some "auric-pm-app", some "auric-pm-app-2", some "auric-pm-app-3",
    some "/p/outside", some "outside", some "auric-pm-outside", some "../p/alpha",
    some "p/alpha", some "./alpha", some "/p/alpha/" ]

private def tools : List String := ["list_epics", "get_context"]

/-- A small linear congruential generator: the same traces on every machine. -/
private def nextSeed (seed : Nat) : Nat := (seed * 1103515245 + 12345) % 2147483648

private def generatedSteps : Nat → Nat → List Step
  | 0, _ => []
  | count + 1, seed =>
    let seed := nextSeed seed
    let choice := seed / 65536
    let next :=
      if choice % 5 == 0 then
        Step.setPolicy (policies.getD (choice / 5 % policies.length) [])
      else
        Step.call (references.getD (choice / 5 % references.length) none)
          (tools.getD (choice / 7 % tools.length) "list_epics")
    next :: generatedSteps count seed

private def callPath (path : String) : Step := .call (some path) "list_epics"

/-- The cases named in the design, written out so a reader can find them. -/
private def namedTraces : List (String × Policy × List Step) :=
  [ ("a permitted project reaches its child once, then reuses it", fullPolicy,
      [callPath "/p/alpha", .call (some "alpha") "get_context", callPath "/p/alpha"]),
    ("revoked while cached is refused at once, and allowed again reuses the child", fullPolicy,
      [callPath "/p/alpha", .setPolicy withoutAlpha, callPath "/p/alpha",
        .call (some "alpha") "list_epics", .call (some "auric-pm-alpha") "list_epics",
        .setPolicy fullPolicy, callPath "/p/alpha"]),
    ("denied while cached is refused like a missing entry", fullPolicy,
      [callPath "/p/alpha", .setPolicy alphaDenied, callPath "/p/alpha"]),
    ("a project that loses its database while cached is refused", betaInitialised,
      [callPath "/p/beta", .setPolicy fullPolicy, callPath "/p/beta"]),
    ("the first usable project moves with the policy", fullPolicy,
      [.call none "list_epics", .setPolicy withoutAlpha, .call none "list_epics",
        .setPolicy emptyPolicy, .call none "list_epics"]),
    ("a name of two folders and its server names are refused, the paths work", fullPolicy,
      [.call (some "app") "list_epics", .call (some "auric-pm-app") "list_epics",
        .call (some "auric-pm-app-2") "list_epics", callPath "/q/app", callPath "/r/app"]),
    ("a name stops being ambiguous only when the policy says so", fullPolicy,
      [.call (some "app") "list_epics", .setPolicy withoutTwin, .call (some "app") "list_epics"]),
    ("outside the policy, however it is spelled", fullPolicy,
      [callPath "/p/gamma", .call (some "gamma") "list_epics",
        .call (some "auric-pm-gamma") "list_epics", callPath "/p/outside",
        .call (some "auric-pm-outside") "list_epics", .call (some "../p/alpha") "list_epics",
        .call (some "p/alpha") "list_epics"]),
    ("the ninth project closes the least recently used child", manyProjects,
      ((List.range 9).map fun index => callPath ("/w/project" ++ toString index)) ++
        [callPath "/w/project2", callPath "/w/project9", callPath "/w/project10",
          callPath "/w/project0", callPath "/w/project3"]) ]

private def generatedTraces : List (String × Policy × List Step) :=
  (List.range 120).map fun index =>
    ("generated " ++ toString index, policies.getD (index % policies.length) [],
      generatedSteps (6 + index % 10) (index * 7919 + 1))

def emitOracle : IO Unit :=
  (namedTraces ++ generatedTraces).forM fun (name, initial, steps) =>
    IO.println (renderTrace name initial steps)

end AuricIDE.PmScope
