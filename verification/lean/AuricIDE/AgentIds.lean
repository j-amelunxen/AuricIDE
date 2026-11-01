import Std

/-!
# Agent id allocation

Model of `src-tauri/src/agents/ids.rs`. An id is `agent-<yyMMdd>-<seq>`; the
durable state is the last pair `(day, seq)` handed out. The rule `next` is the
pure function Rust runs under its file lock.

What is proved here: the pair strictly increases for every clock value, also a
backwards one; over every trace of allocations, restarts and crashes after the
state was saved, all handed-out ids are pairwise distinct; and a dated id has a
different segment shape than a legacy id.

What is not modelled (Rust tests): the cross-process file lock, fsync and
rename, JSON of the state file, reseeding of a damaged file, the `u64`
saturation of `seq`. The corpus (`AgentIdsOracle.lean`) ties the model to the
Rust rule and renderer on bounded traces only.
-/

namespace AuricIDE.AgentIds

structure St where
  day : Nat
  seq : Nat
  deriving Repr, DecidableEq

/-- Lexicographic order on `(day, seq)`. -/
def Lt (a b : St) : Prop := a.day < b.day ∨ (a.day = b.day ∧ a.seq < b.seq)

/-- Lexicographic `≤`. -/
def Le (a b : St) : Prop := a = b ∨ Lt a b

/-- The allocation rule: a later day restarts at 1; otherwise keep the stored
day (also when the clock went backwards) and count on. -/
def next (s : St) (today : Nat) : St :=
  if s.day < today then ⟨today, 1⟩ else ⟨s.day, s.seq + 1⟩

/-- Requirement 1: for every clock value the pair strictly increases. -/
theorem next_increases (s : St) (today : Nat) : Lt s (next s today) := by
  unfold next Lt
  split
  · simp_all
  · simp

theorem lt_irrefl (a : St) : ¬ Lt a a := by
  unfold Lt; omega

theorem lt_trans {a b c : St} (h₁ : Lt a b) (h₂ : Lt b c) : Lt a c := by
  unfold Lt at *; omega

theorem le_lt_trans {a b c : St} (h₁ : Le a b) (h₂ : Lt b c) : Lt a c := by
  rcases h₁ with rfl | h
  · exact h₂
  · exact lt_trans h h₂

/-- Backwards clock: an earlier `today` keeps the stored day. -/
theorem backwards_clock_keeps_day (s : St) (today : Nat) (h : today ≤ s.day) :
    (next s today).day = s.day ∧ (next s today).seq = s.seq + 1 := by
  unfold next
  have : ¬ s.day < today := by omega
  simp [this]

/-- What happens to the world: ids handed out, newest first, and the durable state. -/
structure World where
  durable : St
  handed : List St

def World.init : World := ⟨⟨0, 0⟩, []⟩

inductive Step where
  /-- Allocate with the clock reading `today`; the id reaches the caller. -/
  | alloc (today : Nat)
  /-- The app quits and starts again: only the durable state survives. -/
  | restart
  /-- State saved, then the process died before the id was used. -/
  | crashAfterPersist (today : Nat)

def step (w : World) : Step → World
  | .alloc today => ⟨next w.durable today, next w.durable today :: w.handed⟩
  | .restart => w
  | .crashAfterPersist today => ⟨next w.durable today, w.handed⟩

def run (w : World) : List Step → World
  | [] => w
  | s :: rest => run (step w s) rest

/-- Every id handed out so far is at or below the durable state. -/
def Inv (w : World) : Prop := w.handed.Nodup ∧ ∀ h ∈ w.handed, Le h w.durable

theorem inv_init : Inv World.init := by
  simp [Inv, World.init]

theorem inv_step (w : World) (s : Step) (h : Inv w) : Inv (step w s) := by
  obtain ⟨nodup, below⟩ := h
  cases s with
  | restart => exact ⟨nodup, below⟩
  | alloc today =>
    have up := next_increases w.durable today
    refine ⟨?_, ?_⟩
    · simp only [step, List.nodup_cons]
      refine ⟨?_, nodup⟩
      intro mem
      exact lt_irrefl _ (le_lt_trans (below _ mem) up)
    · intro x hx
      simp only [step, List.mem_cons] at hx
      rcases hx with rfl | hx
      · exact Or.inl rfl
      · exact Or.inr (le_lt_trans (below _ hx) up)
  | crashAfterPersist today =>
    have up := next_increases w.durable today
    refine ⟨nodup, ?_⟩
    intro x hx
    exact Or.inr (le_lt_trans (below _ hx) up)

theorem inv_run (steps : List Step) : ∀ w, Inv w → Inv (run w steps) := by
  induction steps with
  | nil => intro w h; exact h
  | cons s rest ih => intro w h; exact ih _ (inv_step w s h)

/-- Requirement 2: after any trace of allocations, restarts and crashes after
the state was saved, all ids handed out are pairwise distinct. -/
theorem all_ids_distinct (steps : List Step) : (run World.init steps).handed.Nodup :=
  (inv_run steps World.init inv_init).1

/-- The durable state never goes down along a trace (so a restart cannot reissue). -/
theorem durable_monotone (w : World) (s : Step) : Le w.durable (step w s).durable := by
  cases s with
  | restart => exact Or.inl rfl
  | alloc today => exact Or.inr (next_increases _ _)
  | crashAfterPersist today => exact Or.inr (next_increases _ _)

/-! ## Ids and their rendered shape -/

/-- A stored legacy id `agent-<n>` or a dated id `agent-<yyMMdd>-<seq>`. -/
inductive AgentId where
  | legacy (n : Nat)
  | dated (day seq : Nat)
  deriving Repr, DecidableEq

/-- Decimal digits of a number, most significant first. -/
def digitsAux : Nat → Nat → List Nat
  | 0, _ => []
  | fuel + 1, n => if n < 10 then [n] else digitsAux fuel (n / 10) ++ [n % 10]

def digits (n : Nat) : List Nat := digitsAux (n + 1) n

/-- The hyphen-separated segments after the common `agent` prefix; each is a
non-empty run of digits. -/
def segments : AgentId → List (List Nat)
  | .legacy n => [digits n]
  | .dated day seq => [digits day, digits seq]

theorem digits_ne_nil (n : Nat) : digits n ≠ [] := by
  unfold digits
  cases h : n + 1 with
  | zero => omega
  | succ fuel =>
    unfold digitsAux
    split
    · simp
    · simp

/-- Requirement 3 (structural): a dated id never renders like a legacy id,
because the two have different numbers of hyphen-separated segments. -/
theorem dated_never_legacy (day seq n : Nat) :
    segments (.dated day seq) ≠ segments (.legacy n) := by
  simp [segments]

/-- Equal renderings need equal shape, and for the same shape the segment
lists are what distinguishes the numbers. -/
theorem shape_decides (a b : AgentId) (h : (segments a).length = (segments b).length) :
    (∃ n m, a = .legacy n ∧ b = .legacy m) ∨ (∃ d s e t, a = .dated d s ∧ b = .dated e t) := by
  cases a <;> cases b <;> simp_all [segments]

/-- Both shapes are accepted by the reserved key pattern `^agent-\d+(-\d+)?$`:
one or two non-empty digit segments. -/
def reservedShape (segs : List (List Nat)) : Prop :=
  (segs.length = 1 ∨ segs.length = 2) ∧ ∀ s ∈ segs, s ≠ []

theorem every_id_is_reserved (id : AgentId) : reservedShape (segments id) := by
  cases id <;> simp [reservedShape, segments, digits_ne_nil]

/-! ## The rendered string is injective

Token view of the text after `agent-`: decimal digits are the tokens `0..9`
and the hyphen is the token `10`. Hyphen-free digit runs make the first `10`
the only separator, so no two different ids render alike. (Zero padding of the
day to six digits changes nothing here: it is a function of the day alone.) -/

def ofDigits (l : List Nat) : Nat := l.foldl (fun a d => a * 10 + d) 0

theorem digitsAux_ofDigits : ∀ (fuel n : Nat), n < fuel → ofDigits (digitsAux fuel n) = n := by
  intro fuel
  induction fuel with
  | zero => intro n h; omega
  | succ fuel ih =>
    intro n h
    unfold digitsAux
    split
    · simp [ofDigits]
    · rename_i big
      have lt : n / 10 < fuel := by omega
      have := ih (n / 10) lt
      unfold ofDigits at *
      rw [List.foldl_append, this]
      simp
      omega

theorem ofDigits_digits (n : Nat) : ofDigits (digits n) = n :=
  digitsAux_ofDigits (n + 1) n (by omega)

theorem digits_injective {m n : Nat} (h : digits m = digits n) : m = n := by
  have := congrArg ofDigits h
  rwa [ofDigits_digits, ofDigits_digits] at this

theorem digitsAux_lt_ten : ∀ (fuel n : Nat), ∀ d ∈ digitsAux fuel n, d < 10 := by
  intro fuel
  induction fuel with
  | zero => intro n d h; simp [digitsAux] at h
  | succ fuel ih =>
    intro n d h
    unfold digitsAux at h
    split at h
    · simp at h; omega
    · simp at h
      rcases h with h | h
      · exact ih _ _ h
      · omega

theorem digits_lt_ten (n : Nat) : ∀ d ∈ digits n, d < 10 := digitsAux_lt_ten _ _

/-- The text after `agent-`, hyphen as token 10. -/
def tokens : AgentId → List Nat
  | .legacy n => digits n
  | .dated day seq => digits day ++ [10] ++ digits seq

theorem split_unique : ∀ (a c b d : List Nat), (∀ x ∈ a, x < 10) → (∀ x ∈ c, x < 10) →
    a ++ [10] ++ b = c ++ [10] ++ d → a = c ∧ b = d := by
  intro a
  induction a with
  | nil =>
    intro c b d _ hc h
    cases c with
    | nil => simp at h; exact ⟨rfl, h⟩
    | cons x c =>
      simp at h
      have := hc x (by simp)
      omega
  | cons x a ih =>
    intro c b d ha hc h
    cases c with
    | nil =>
      simp at h
      have := ha x (by simp)
      omega
    | cons y c =>
      simp at h
      obtain ⟨hxy, rest⟩ := h
      subst hxy
      have := ih c b d (fun z hz => ha z (by simp [hz])) (fun z hz => hc z (by simp [hz]))
        (by simpa using rest)
      exact ⟨by simp [this.1], this.2⟩

theorem ten_not_in_digits (n : Nat) : 10 ∉ digits n := by
  intro h; have := digits_lt_ten n 10 h; omega

/-- Requirement 3 (full): different ids never render to the same text. -/
theorem render_injective {a b : AgentId} (h : tokens a = tokens b) : a = b := by
  cases a with
  | legacy n =>
    cases b with
    | legacy m => simpa using digits_injective (by simpa [tokens] using h)
    | dated d s =>
      exfalso
      simp only [tokens] at h
      exact ten_not_in_digits n (by rw [h]; simp)
  | dated d s =>
    cases b with
    | legacy m =>
      exfalso
      simp only [tokens] at h
      exact ten_not_in_digits m (by rw [← h]; simp)
    | dated e t =>
      simp only [tokens] at h
      obtain ⟨h1, h2⟩ := split_unique _ _ _ _ (digits_lt_ten d) (digits_lt_ten e) h
      simp [digits_injective h1, digits_injective h2]

/-! ## Corpus -/

private def quote (value : String) : String := "\"" ++ value ++ "\""

private def pad6 (n : Nat) : String :=
  let s := toString n
  String.ofList (List.replicate (6 - s.length) '0') ++ s

/-- The rendered id, as the Rust renderer must produce it. -/
def renderDated (s : St) : String := "agent-" ++ pad6 s.day ++ "-" ++ toString s.seq

inductive Op where
  | alloc (today : Nat)
  | restart
  | crash (today : Nat)

private def opName : Op → String
  | .alloc _ => "alloc"
  | .restart => "restart"
  | .crash _ => "crash"

private def opToday : Op → Nat
  | .alloc t => t
  | .restart => 0
  | .crash t => t

private def toStep : Op → Step
  | .alloc t => .alloc t
  | .restart => .restart
  | .crash t => .crashAfterPersist t

structure Trace where
  name : String
  start : St
  ops : List Op

/-- Expected output per operation: the id handed out, or `null` when none. -/
private def expected (w : World) : List Op → List String
  | [] => []
  | op :: rest =>
    let w' := step w (toStep op)
    let out := match op with
      | .alloc _ => quote (renderDated w'.durable)
      | _ => "null"
    out :: expected w' rest

private def renderOp (op : Op) : String :=
  "{\"op\":" ++ quote (opName op) ++ ",\"today\":" ++ toString (opToday op) ++ "}"

private def renderTrace (t : Trace) : String :=
  "{\"version\":\"agent-ids-v1\",\"name\":" ++ quote t.name ++
    ",\"start\":{\"day\":" ++ toString t.start.day ++ ",\"seq\":" ++ toString t.start.seq ++
    "},\"ops\":[" ++ String.intercalate "," (t.ops.map renderOp) ++
    "],\"ids\":[" ++ String.intercalate "," (expected ⟨t.start, []⟩ t.ops) ++ "]}"

/-- Deterministic pseudo-random clock jumps around a base day. -/
private def lcg (x : Nat) : Nat := (x * 1103515245 + 12345) % 2147483648

private def clockFor (r : Nat) : Nat :=
  match r % 5 with
  | 0 => 261101
  | 1 => 261102
  | 2 => 261031   -- clock set back
  | 3 => 261231
  | _ => 270101   -- across a year

private def opFor (r : Nat) : Op :=
  match (r / 7) % 6 with
  | 0 => .restart
  | 1 => .crash (clockFor r)
  | _ => .alloc (clockFor r)

private def generated (seed len : Nat) : List Op :=
  (List.range len).foldl
    (fun (acc : Nat × List Op) _ =>
      let r := lcg acc.1
      (r, acc.2 ++ [opFor (r / 3)]))
    (seed, []) |>.2

def traces : List Trace :=
  [ { name := "first id on a fresh install", start := ⟨0, 0⟩, ops := [.alloc 261101] },
    { name := "same day counts on", start := ⟨0, 0⟩,
      ops := [.alloc 261101, .alloc 261101, .alloc 261101] },
    { name := "new day restarts at one", start := ⟨261101, 7⟩,
      ops := [.alloc 261102, .alloc 261102] },
    { name := "clock set back keeps the stored day", start := ⟨261101, 7⟩,
      ops := [.alloc 261031, .alloc 261031, .alloc 261101] },
    { name := "restart changes nothing", start := ⟨261101, 2⟩,
      ops := [.alloc 261101, .restart, .alloc 261101] },
    { name := "crash after persist burns an id", start := ⟨261101, 2⟩,
      ops := [.crash 261101, .restart, .alloc 261101] },
    { name := "year rollover", start := ⟨261231, 9⟩, ops := [.alloc 270101, .alloc 261231] },
    { name := "wide counter", start := ⟨261101, 99999⟩, ops := [.alloc 261101] } ] ++
  (List.range 40).map fun i =>
    { name := s!"generated {i}", start := ⟨261101, i⟩, ops := generated (i + 1) 12 }

def emitOracle : IO Unit :=
  traces.forM fun t => IO.println (renderTrace t)

end AuricIDE.AgentIds
