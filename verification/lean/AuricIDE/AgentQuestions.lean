/-!
# Questions an agent raises for its supervisor

The model behind `src-tauri/src/agents/questions.rs` and the `await_result`
cursor (`docs/design-agent-control.md`, "Questions"). Proved for every trace of
raises, reads, reads whose answer got lost, and notices:

* A reader that goes on from the cursor of the last answer it got holds exactly
  the prefix of the log up to that cursor: no question lost, none twice, in
  order (`received_is_prefix`, `read_after_any_trace_has_everything`).
* A lost answer loses nothing (`lost_answer_changes_nothing_for_the_reader`).
* A full log refuses; what it holds never changes (`log_only_grows`,
  `refused_keeps_the_log`).
* A notice goes out at most once per question (`notices_at_most_questions`), and
  a question nobody heard of is owed one (`unheard_question_is_owed`).

This covers the model. Text limits, the PID identity of the asker, JSON and the
typing of the notice are outside it. `agent-questions-v1.jsonl` replays the
generated traces against the real Rust `QuestionLog`.
-/

namespace AuricIDE.AgentQuestions

/-- `QUESTIONS_PER_AGENT` in `questions.rs`. -/
def cap : Nat := 50

structure Server where
  log : List Nat := []
  delivered : Nat := 0
  announced : Nat := 0

structure World where
  server : Server := {}
  cursor : Nat := 0
  received : List Nat := []
  notices : Nat := 0

/-- The seq a question gets, or `none` when the log is full. -/
def raise (s : Server) (q : Nat) : Server × Option Nat :=
  if s.log.length < cap then
    ({ s with log := s.log ++ [q] }, some (s.log.length + 1))
  else (s, none)

/-- What a reader at `cursor` is handed, and the cursor it goes on with. -/
def since (s : Server) (cursor : Nat) : List Nat × Nat :=
  (s.log.drop cursor, max s.log.length cursor)

/-- `since` for an answer on its way out: what it carries needs no notice. -/
def deliver (s : Server) (cursor : Nat) : Server :=
  if (s.log.drop cursor).isEmpty then s
  else { s with delivered := max s.delivered s.log.length }

def owed (s : Server) : Nat := s.log.length - max s.delivered s.announced

def announce (s : Server) : Server :=
  { s with announced := max s.announced s.log.length }

inductive Step where
  | raise (q : Nat)
  | read
  | readLost
  | notice

def step (w : World) : Step → World
  | .raise q => { w with server := (raise w.server q).1 }
  | .read =>
    let found := since w.server w.cursor
    { w with
      server := deliver w.server w.cursor
      cursor := found.2
      received := w.received ++ found.1 }
  | .readLost => { w with server := deliver w.server w.cursor }
  | .notice =>
    if owed w.server > 0 then
      { w with server := announce w.server, notices := w.notices + 1 }
    else w

def run (w : World) (trace : List Step) : World := trace.foldl step w

theorem step_keeps_log_of_nonraise (w : World) :
    (step w .read).server.log = w.server.log ∧
    (step w .readLost).server.log = w.server.log ∧
    (step w .notice).server.log = w.server.log := by
  refine ⟨?_, ?_, ?_⟩
  · simp only [step, deliver]; split <;> rfl
  · simp only [step, deliver]; split <;> rfl
  · simp only [step, announce]; split <;> rfl

/- specuuid: s_62ndqc2j covers: el_85cp2q7y,el_vdqm4hcv -/
/-- A full log refuses and holds what it held. -/
theorem refused_keeps_the_log (s : Server) (q : Nat) (full : cap ≤ s.log.length) :
    (raise s q).2 = none ∧ (raise s q).1.log = s.log := by
  have : ¬ s.log.length < cap := Nat.not_lt.mpr full
  simp [raise, this]

/- specuuid: s_wbphwab0 covers: el_85cp2q7y,el_vdqm4hcv -/
/-- An accepted question gets the next number. -/
theorem accepted_gets_the_next_seq (s : Server) (q : Nat) (room : s.log.length < cap) :
    (raise s q).2 = some (s.log.length + 1) ∧ (raise s q).1.log = s.log ++ [q] := by
  simp [raise, room]

/- specuuid: s_p2tm5gd9 covers: el_85cp2q7y,el_a75yd10b -/
/-- Nothing ever leaves the log. -/
theorem log_only_grows (w : World) (s : Step) : w.server.log <+: (step w s).server.log := by
  cases s with
  | raise q =>
    simp only [step, raise]
    split
    · exact List.prefix_append _ _
    · exact List.prefix_refl _
  | read => rw [(step_keeps_log_of_nonraise w).1]; exact List.prefix_refl _
  | readLost => rw [(step_keeps_log_of_nonraise w).2.1]; exact List.prefix_refl _
  | notice => rw [(step_keeps_log_of_nonraise w).2.2]; exact List.prefix_refl _

/-- The reader's invariant: it holds exactly the log up to its cursor. -/
def Holds (w : World) : Prop :=
  w.cursor ≤ w.server.log.length ∧ w.received = w.server.log.take w.cursor

theorem holds_initially : Holds ({} : World) := by simp [Holds]

theorem step_holds (w : World) (s : Step) (h : Holds w) : Holds (step w s) := by
  obtain ⟨le, rec⟩ := h
  cases s with
  | raise q =>
    simp only [Holds, step, raise]
    split
    · simp only [List.length_append, List.length_cons, List.length_nil]
      refine ⟨by omega, ?_⟩
      rw [rec, List.take_append_of_le_length le]
    · exact ⟨le, rec⟩
  | read =>
    constructor
    · rw [(step_keeps_log_of_nonraise w).1]
      simp only [step, since]; omega
    · rw [(step_keeps_log_of_nonraise w).1]
      have top : max w.server.log.length w.cursor = w.server.log.length := by omega
      simp only [step, since, top, rec, List.take_append_drop, List.take_length]
  | readLost =>
    constructor
    · rw [(step_keeps_log_of_nonraise w).2.1]; exact le
    · rw [(step_keeps_log_of_nonraise w).2.1]; exact rec
  | notice =>
    constructor
    · rw [(step_keeps_log_of_nonraise w).2.2]
      simp only [step]; split <;> exact le
    · rw [(step_keeps_log_of_nonraise w).2.2]
      simp only [step]; split <;> exact rec

theorem run_holds (w : World) (trace : List Step) (h : Holds w) : Holds (run w trace) := by
  induction trace generalizing w with
  | nil => exact h
  | cons s rest ih => exact ih _ (step_holds w s h)

/- specuuid: s_knh10vdg covers: el_a75yd10b,el_rqg3vpjg -/
/-- What a reader holds after any trace is a prefix of what was raised, in
order, each question once: no reordering, no repeat. -/
theorem received_is_prefix (trace : List Step) :
    (run {} trace).received = (run {} trace).server.log.take (run {} trace).cursor :=
  (run_holds {} trace holds_initially).2

/- specuuid: s_f1ybb9fm covers: el_a75yd10b,el_rqg3vpjg -/
/-- One more read after any trace leaves the reader with every question there is:
none lost, whatever was interleaved, lost answers included. -/
theorem read_after_any_trace_has_everything (trace : List Step) :
    (step (run {} trace) .read).received = (run {} trace).server.log := by
  have h := run_holds {} trace holds_initially
  simp only [step, since, h.2, List.take_append_drop]

/- specuuid: s_k5cprhtm covers: el_a75yd10b,el_rqg3vpjg -/
/-- A read that returned nothing new leaves the next read empty too: nothing is
handed out twice to a reader that kept its cursor. -/
theorem nothing_twice (w : World) (h : Holds w) :
    since (step w .read).server (step w .read).cursor = ([], w.server.log.length) := by
  have le := h.1
  have log_eq := (step_keeps_log_of_nonraise w).1
  have top : max w.server.log.length w.cursor = w.server.log.length := by omega
  simp only [since, log_eq]
  simp only [step, since, top]
  simp

/- specuuid: s_tkqpx44d covers: el_a75yd10b,el_rqg3vpjg -/
/-- A lost answer changes nothing for the reader. -/
theorem lost_answer_changes_nothing_for_the_reader (w : World) :
    (step w .readLost).cursor = w.cursor ∧ (step w .readLost).received = w.received ∧
    since (step w .readLost).server w.cursor = since w.server w.cursor := by
  refine ⟨rfl, rfl, ?_⟩
  simp only [since, (step_keeps_log_of_nonraise w).2.1]

/-- A question nobody has heard of is owed a notice. -/
theorem unheard_question_is_owed (s : Server) (q : Nat) (room : s.log.length < cap)
    (heard : max s.delivered s.announced ≤ s.log.length) : owed (raise s q).1 > 0 := by
  simp [raise, room, owed]
  omega

/-- After a notice nothing is owed until the next question. -/
theorem notice_clears_what_is_owed (s : Server) : owed (announce s) = 0 := by
  simp only [owed, announce]; omega

/-- The bookkeeping behind notices: each one used up at least one question. -/
def Counted (w : World) : Prop :=
  w.notices ≤ w.server.announced ∧ w.server.announced ≤ w.server.log.length ∧
    w.server.delivered ≤ w.server.log.length

theorem step_counted (w : World) (s : Step) (h : Counted w) : Counted (step w s) := by
  obtain ⟨n, a, d⟩ := h
  cases s with
  | raise q =>
    simp only [Counted, step, raise]
    split
    · simp only [List.length_append, List.length_cons, List.length_nil]; omega
    · exact ⟨n, a, d⟩
  | read =>
    simp only [Counted, step, deliver]
    split
    · exact ⟨n, a, d⟩
    · simp only; omega
  | readLost =>
    simp only [Counted, step, deliver]
    split
    · exact ⟨n, a, d⟩
    · simp only; omega
  | notice =>
    simp only [Counted, step]
    split
    · rename_i pos
      simp only [owed] at pos
      simp only [announce]; omega
    · exact ⟨n, a, d⟩

theorem run_counted (w : World) (trace : List Step) (h : Counted w) :
    Counted (run w trace) := by
  induction trace generalizing w with
  | nil => exact h
  | cons s rest ih => exact ih _ (step_counted w s h)

/- specuuid: s_3cgh3mye covers: el_85cp2q7y -/
/-- Never more notices than questions: none is announced twice. -/
theorem notices_at_most_questions (trace : List Step) :
    (run {} trace).notices ≤ (run {} trace).server.log.length := by
  have h := run_counted {} trace (by simp [Counted])
  exact Nat.le_trans h.1 h.2.1

/-! ## The corpus -/

def jsonList (items : List String) : String := "[" ++ ",".intercalate items ++ "]"

def stepResult (w : World) : Step → String
  | .raise q =>
    let seq := match (raise w.server q).2 with
      | some n => toString n
      | none => "null"
    "{\"op\":\"raise\",\"q\":" ++ toString q ++ ",\"seq\":" ++ seq ++ "}"
  | .read =>
    let found := since w.server w.cursor
    "{\"op\":\"read\",\"from\":" ++ toString w.cursor ++ ",\"found\":" ++
      jsonList (found.1.map toString) ++ ",\"next\":" ++ toString found.2 ++ "}"
  | .readLost =>
    "{\"op\":\"lost\",\"from\":" ++ toString w.cursor ++ "}"
  | .notice =>
    "{\"op\":\"notice\",\"owed\":" ++ toString (owed w.server) ++ "}"

def traceLine (name : String) (trace : List Step) : String :=
  let rec go (w : World) : List Step → List String
    | [] => []
    | s :: rest => stepResult w s :: go (step w s) rest
  "{\"version\":\"agent-questions-v1\",\"name\":\"" ++ name ++ "\",\"steps\":" ++
    jsonList (go {} trace) ++ "}"

def raises (start count : Nat) : List Step :=
  (List.range count).map (fun n => Step.raise (start + n))

def namedTraces : List (String × List Step) :=
  [ ("nothing raised", [.read, .notice, .read])
  , ("once per cursor", [.raise 1, .raise 2, .read, .read, .raise 3, .read, .read])
  , ("a lost answer comes again", [.raise 1, .readLost, .read, .read])
  , ("lost after a read", [.raise 1, .read, .raise 2, .readLost, .readLost, .read, .read])
  , ("a notice once", [.raise 1, .raise 2, .notice, .notice, .read, .notice])
  , ("no notice for what a read carried", [.raise 1, .read, .notice, .raise 2, .notice, .notice])
  , ("a lost answer also stops the notice", [.raise 1, .readLost, .notice, .read])
  , ("a full log refuses and keeps", raises 100 50 ++ [.raise 999, .read, .raise 998, .read, .notice]) ]

/-- Every interleaving of four step kinds up to length 5, from a raise. -/
def generated : List (String × List Step) :=
  let kinds : List Step := [.raise 7, .read, .readLost, .notice]
  let rec words : Nat → List (List Step)
    | 0 => [[]]
    | n + 1 => (words n).flatMap (fun w => kinds.map (fun k => k :: w))
  ((words 5).zipIdx).map (fun (w, i) => ("generated " ++ toString i, w))

def emitOracle : IO Unit :=
  for (name, trace) in namedTraces ++ generated do IO.println (traceLine name trace)

end AuricIDE.AgentQuestions
