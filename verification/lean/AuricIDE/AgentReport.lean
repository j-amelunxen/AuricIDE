/-!
# An agent's latest complete report

The model behind `src-tauri/src/agent_usage/report.rs` and `finished_report` in
`control_socket/mod.rs`. Proved:

* A report only ever comes from a line that says its turn ended, with text that
  is not blank (`report_has_a_finished_turn`).
* No finished turn with text means no report, whatever else the transcript holds
  (`no_report_iff_no_finished_text`, `running_turn_is_no_report`).
* The newest finished turn wins, and a later turn still going does not replace
  it (`newest_finished_turn_wins`, `turn_still_going_changes_nothing`).
* The console is no source: a finished run with only a console tail has no report,
  and available always comes with a source that is not the console
  (`console_tail_is_no_report`, `available_never_from_console`).
* A failed run keeps its console as its answer (`failure_keeps_console`).

This covers the decision over parsed lines. It does not cover JSON parsing, which
line of a real transcript means what (`TurnLine`), file reads or truncation.
`agent-report-v1.jsonl` replays generated vectors against the real Rust functions;
the line meanings are checked against real transcripts by an ignored Rust test.
-/

namespace AuricIDE.AgentReport

/-- One transcript line reduced to what the extraction decides on. -/
structure Line where
  id : Nat
  endsTurn : Bool
  text : String

structure Report where
  id : Nat
  text : String
deriving DecidableEq

def blank (text : String) : Bool := text.all Char.isWhitespace

def parts (lines : List Line) (id : Nat) : List String :=
  ((lines.filter (fun l => l.id == id)).map (·.text)).filter (fun t => !blank t)

/-- The report a line that ended its turn stands for, if its message has text. -/
def candidate (lines : List Line) (l : Line) : Option Report :=
  if (parts lines l.id).isEmpty then none
  else some ⟨l.id, "\n".intercalate (parts lines l.id)⟩

/-- The search over the lines, newest first. -/
def search (lines : List Line) : List Line → Option Report
  | [] => none
  | l :: rest =>
    if l.endsTurn then
      (candidate lines l).orElse (fun _ => search lines rest)
    else search lines rest

def latest (lines : List Line) : Option Report := search lines lines.reverse

theorem search_some (lines scan : List Line) (r : Report) (found : search lines scan = some r) :
    ∃ l ∈ scan, l.endsTurn = true ∧ l.id = r.id ∧ parts lines l.id ≠ [] ∧
      r.text = "\n".intercalate (parts lines l.id) := by
  induction scan with
  | nil => simp [search] at found
  | cons l rest ih =>
    have tail : search lines rest = some r →
        ∃ x ∈ l :: rest, x.endsTurn = true ∧ x.id = r.id ∧ parts lines x.id ≠ [] ∧
          r.text = "\n".intercalate (parts lines x.id) := by
      intro hit
      obtain ⟨x, mem, a, b, c, d⟩ := ih hit
      exact ⟨x, List.mem_cons_of_mem _ mem, a, b, c, d⟩
    by_cases ends : l.endsTurn = true
    · by_cases empty : (parts lines l.id).isEmpty = true
      · simp [search, ends, candidate, empty] at found
        exact tail found
      · simp [search, ends, candidate, empty] at found
        subst found
        refine ⟨l, List.mem_cons_self, ends, rfl, ?_, rfl⟩
        intro nil
        simp [nil] at empty
    · simp [search, ends] at found
      exact tail found

/- specuuid: s_z2rshctm covers: el_r3sk9wv0,el_8822ww84 -/
/-- A report comes from a line in the transcript that ended a turn and has text. -/
theorem report_has_a_finished_turn (lines : List Line) (r : Report)
    (found : latest lines = some r) :
    ∃ l ∈ lines, l.endsTurn = true ∧ l.id = r.id ∧ parts lines l.id ≠ [] ∧
      r.text = "\n".intercalate (parts lines l.id) := by
  obtain ⟨l, mem, rest⟩ := search_some lines lines.reverse r found
  exact ⟨l, List.mem_reverse.mp mem, rest⟩

theorem search_none (lines scan : List Line) :
    search lines scan = none ↔ ∀ l ∈ scan, l.endsTurn = true → parts lines l.id = [] := by
  induction scan with
  | nil => simp [search]
  | cons l rest ih =>
    simp only [List.mem_cons, forall_eq_or_imp]
    by_cases ends : l.endsTurn = true
    · by_cases empty : (parts lines l.id).isEmpty = true
      · have nil : parts lines l.id = [] := List.isEmpty_iff.mp empty
        simp [search, ends, candidate, nil, ih]
      · have ne : parts lines l.id ≠ [] := fun nil => by simp [nil] at empty
        simp [search, ends, candidate, empty, ne]
    · simp [search, ends, ih]

/-- No finished turn with text, no report; and the other way round. -/
theorem no_report_iff_no_finished_text (lines : List Line) :
    latest lines = none ↔ ∀ l ∈ lines, l.endsTurn = true → parts lines l.id = [] := by
  unfold latest
  rw [search_none]
  simp only [List.mem_reverse]

/- specuuid: s_qrw4f3ye covers: el_r3sk9wv0,el_8822ww84 -/
/-- A transcript with no turn over yet has no report, whatever it says. -/
theorem running_turn_is_no_report (lines : List Line)
    (going : ∀ l ∈ lines, l.endsTurn = false) : latest lines = none := by
  rw [no_report_iff_no_finished_text]
  intro l mem ends
  rw [going l mem] at ends
  contradiction

theorem parts_append_fresh (lines more : List Line) (id : Nat)
    (fresh : ∀ m ∈ more, m.id ≠ id) : parts (lines ++ more) id = parts lines id := by
  have : more.filter (fun l => l.id == id) = [] := by
    apply List.filter_eq_nil_iff.mpr
    intro m mem
    simpa using fresh m mem
  simp [parts, List.filter_append, this]

theorem search_append_fresh (lines more scan : List Line)
    (fresh : ∀ l ∈ scan, ∀ m ∈ more, m.id ≠ l.id) :
    search (lines ++ more) scan = search lines scan := by
  induction scan with
  | nil => rfl
  | cons l rest ih =>
    have here := parts_append_fresh lines more l.id (fresh l List.mem_cons_self)
    have tail := ih (fun x mem => fresh x (List.mem_cons_of_mem _ mem))
    simp only [search, candidate, here, tail]

/- specuuid: s_05b6aq0g covers: el_r3sk9wv0,el_8822ww84 -/
/-- Lines of a later turn still going leave the report as it was. -/
theorem turn_still_going_changes_nothing (lines more : List Line)
    (going : ∀ m ∈ more, m.endsTurn = false)
    (fresh : ∀ l ∈ lines, ∀ m ∈ more, m.id ≠ l.id) :
    latest (lines ++ more) = latest lines := by
  have skip : ∀ (front : List Line) (scan : List Line),
      (∀ m ∈ front, m.endsTurn = false) →
      search (lines ++ more) (front ++ scan) = search (lines ++ more) scan := by
    intro front scan all
    induction front with
    | nil => rfl
    | cons x xs ih =>
      have x_going := all x List.mem_cons_self
      simp only [List.cons_append, search, x_going, Bool.false_eq_true, ite_false]
      exact ih (fun m mem => all m (List.mem_cons_of_mem _ mem))
  unfold latest
  rw [List.reverse_append,
    skip more.reverse lines.reverse (fun m mem => going m (List.mem_reverse.mp mem))]
  exact search_append_fresh lines more lines.reverse
    (fun l mem m mem' => fresh l (List.mem_reverse.mp mem) m mem')

/- specuuid: s_srwjpw0z covers: el_r3sk9wv0,el_8822ww84 -/
/-- A finished turn with text is the report from then on. -/
theorem newest_finished_turn_wins (lines : List Line) (l : Line)
    (ends : l.endsTurn = true) (text : parts (lines ++ [l]) l.id ≠ []) :
    (latest (lines ++ [l])).map (·.id) = some l.id := by
  have empty : ¬ (parts (lines ++ [l]) l.id).isEmpty = true := by
    intro hit; exact text (List.isEmpty_iff.mp hit)
  simp [latest, search, ends, candidate, empty]

/-! ## From a lookup to the wire -/

inductive RunSource where
  | cliResult | transcript | consoleTail
  deriving DecidableEq

inductive ReportSource where
  | cliResult | claudeTranscript
  deriving DecidableEq

/-- `finished_report`: a kept answer becomes a report only from a clean source. -/
def finishedReport (source : RunSource) (answer : Option String) : Option ReportSource :=
  match source, answer with
  | .consoleTail, _ => none
  | _, none => none
  | .cliResult, some text => if blank text then none else some .cliResult
  | .transcript, some text => if blank text then none else some .claudeTranscript

/- specuuid: s_nbgrv6yr covers: el_r3sk9wv0,el_8822ww84 -/
theorem console_tail_is_no_report (answer : Option String) :
    finishedReport .consoleTail answer = none := rfl

/- specuuid: s_yn4t9yx8 covers: el_r3sk9wv0,el_8822ww84 -/
theorem available_never_from_console (source : RunSource) (answer : Option String)
    (out : ReportSource) (found : finishedReport source answer = some out) :
    source ≠ .consoleTail := by
  intro console
  subst console
  simp [finishedReport] at found

/-- `with_transcript_report`: which source a finished run's answer ends with. -/
def resultSource (isError hasReport : Bool) : RunSource :=
  if !isError && hasReport then .transcript else .consoleTail

theorem failure_keeps_console (hasReport : Bool) :
    resultSource true hasReport = .consoleTail := rfl

theorem clean_finish_uses_the_transcript :
    resultSource false true = .transcript := rfl

/-! ## The corpus -/

def jsonText (text : String) : String := "\"" ++ text.replace "\n" "\\n" ++ "\""

def lineJson (l : Line) : String :=
  "{\"id\":\"m" ++ toString l.id ++ "\",\"ends\":" ++ toString l.endsTurn ++
    ",\"text\":" ++ jsonText l.text ++ "}"

def reportJson : Option Report → String
  | none => "null"
  | some r => "{\"id\":\"m" ++ toString r.id ++ "\",\"text\":" ++ jsonText r.text ++ "}"

def vector (name : String) (lines : List Line) : String :=
  "{\"version\":\"agent-report-v1\",\"kind\":\"latest\",\"name\":" ++ jsonText name ++
    ",\"lines\":[" ++ ",".intercalate (lines.map lineJson) ++ "],\"report\":" ++
    reportJson (latest lines) ++ "}"

def sourceName : RunSource → String
  | .cliResult => "cli_result"
  | .transcript => "transcript"
  | .consoleTail => "console_tail"

def finishedVector (source : RunSource) (answer : Option String) : String :=
  let out := match finishedReport source answer with
    | none => "null"
    | some .cliResult => "\"cli_result\""
    | some .claudeTranscript => "\"claude_transcript\""
  let given := match answer with
    | none => "null"
    | some text => jsonText text
  "{\"version\":\"agent-report-v1\",\"kind\":\"finished\",\"source\":\"" ++ sourceName source ++
    "\",\"answer\":" ++ given ++ ",\"report\":" ++ out ++ "}"

def named : List (String × List Line) :=
  [ ("empty", [])
  , ("a turn going on", [⟨1, false, "Let me look."⟩])
  , ("one report", [⟨1, true, "Done."⟩])
  , ("thinking line then text", [⟨1, true, ""⟩, ⟨1, true, "Done."⟩])
  , ("text across lines", [⟨1, false, "one"⟩, ⟨1, true, "two"⟩])
  , ("newest wins", [⟨1, true, "first"⟩, ⟨2, true, "second"⟩])
  , ("a later tool turn does not replace it", [⟨1, true, "first"⟩, ⟨2, false, "working"⟩])
  , ("an ended turn without text keeps the one before", [⟨1, true, "first"⟩, ⟨2, true, "   "⟩])
  , ("only blank", [⟨1, true, " "⟩, ⟨2, true, ""⟩])
  , ("a tool turn with text is not a report", [⟨1, false, "text"⟩, ⟨2, false, "more"⟩]) ]

/-- Every transcript of up to four lines over two messages and three texts. -/
def generated : List (String × List Line) :=
  let choices : List Line :=
    [⟨1, false, "a"⟩, ⟨1, true, "b"⟩, ⟨2, false, " "⟩, ⟨2, true, "c"⟩, ⟨3, true, ""⟩]
  let rec words : Nat → List (List Line)
    | 0 => [[]]
    | n + 1 => (words n).flatMap (fun w => choices.map (fun c => c :: w))
  ((words 4).zipIdx).map (fun (w, i) => ("generated " ++ toString i, w))

def emitOracle : IO Unit := do
  for (name, lines) in named ++ generated do
    IO.println (vector name lines)
  for source in [RunSource.cliResult, .transcript, .consoleTail] do
    for answer in [none, some "", some " ", some "Done."] do
      IO.println (finishedVector source answer)

end AuricIDE.AgentReport
