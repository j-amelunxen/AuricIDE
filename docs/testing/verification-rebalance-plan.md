# Verification Rebalance

## Ziel und Motivation

AuricIDE besitzt heute eine sehr breite Vitest-Suite mit rund 536 Testdateien,
aber nur vier Playwright-Specs. Viele dieser Tests liefern schnelles und präzises
Feedback. Ein anderer Teil prüft jedoch vor allem Implementierungsdetails:
CSS-Klassen, triviale Setter, Prop-Durchleitungen, Mock-Interaktionen oder interne
Komponentenstrukturen.

Das Ziel dieses Vorhabens ist **nicht, möglichst viele Unit-Tests zu löschen**.
Das Ziel ist, jede relevante Produkteigenschaft auf der Ebene zu verifizieren,
auf der ein Fehler tatsächlich Bedeutung hätte:

- Nutzerverhalten durch wenige aussagekräftige Journeys,
- Modul- und Systemgrenzen durch Integration- und Contract-Tests,
- kombinatorische Algorithmen weiterhin durch schnelle Unit- und Property-Tests,
- stabile, kritische Invarianten durch eine Lean-verifizierte Spezifikation,
- die Übereinstimmung von Spezifikation und TypeScript-/Rust-Implementierung
  durch ausführbare Konformitätsprüfungen.

Die angestrebte Veränderung lautet daher nicht „Unit durch E2E ersetzen“,
sondern:

> Von implementierungsnaher Testmenge zu risikoorientierter, ausführbarer
> Produktevidenz.

## Welchen Effekt wir erreichen wollen

### Mehr Vertrauen in das ausgelieferte System

Ein isolierter Komponententest kann grün sein, obwohl der Tauri-Command falsch
verdrahtet ist, die Rust-Seite ein anderes Schema erwartet oder die Daten nicht
korrekt persistiert werden. Ein vertikaler Test kann dagegen den wirklichen Pfad
prüfen:

```text
React → Tauri IPC → Rust → SQLite/Dateisystem → Neustart → React
```

Dadurch verschiebt sich die Aussage von „diese Funktion arbeitet mit unseren
Mocks“ zu „dieser relevante Arbeitsablauf funktioniert im Produkt“.

### Weniger Kopplung an die aktuelle Implementierung

Ein Refactoring soll Tests nur dann verändern müssen, wenn sich Verhalten oder
Verträge verändern. Tests auf Tailwind-Klassen, Hook-Aufrufe oder interne
Zustandsformen verursachen dagegen häufig Arbeit, obwohl für Nutzer alles gleich
bleibt.

Nach der Migration sollen insbesondere UI-Refactorings, interne Umbenennungen
und der Austausch technischer Implementierungen weniger unnötige Teständerungen
erzeugen.

### Explizitere Kernregeln

Regeln wie „deny gewinnt immer“, „unverified Evidence erfüllt keine Station“
oder „ein blockiertes Ticket wird nicht ausgeführt“ sind wichtiger als die
aktuelle Funktion, in der sie implementiert sind.

Eine formale Spezifikation zwingt uns, diese Regeln eindeutig zu benennen:

- Welche Eingaben existieren?
- Welche Zustände sind erlaubt?
- Was muss immer gelten?
- Welche Zustände dürfen niemals erreichbar sein?
- Was geschieht bei unbekannten oder widersprüchlichen Eingaben?

Lean kann anschließend Aussagen über das Modell für alle modellierten Zustände
beweisen, statt nur einzelne Beispiele auszuführen.

### Bessere Fehlerabdeckung an den riskanten Grenzen

Mehr Integration bedeutet nicht automatisch „alles als riesigen E2E-Test“.
Besonders wertvoll sind kleine, reale Grenztests:

- TypeScript ↔ Tauri IPC,
- Tauri IPC ↔ Rust,
- Rust ↔ SQLite und Dateisystem,
- TypeScript ↔ Rust bei doppelt implementierten Regeln,
- Save ↔ Reload und Migration alter Zustände.

Diese Grenzen sind in der Produktion fehleranfällig, werden durch reine
Unit-Tests mit Mocks aber häufig gerade ausgeblendet.

### Eine bessere Dokumentation des tatsächlichen Produkts

Die neue Verifikationsstruktur soll Regeln, Implementierungen und Nachweise
explizit verbinden:

```text
Invariante
  → formale oder textuelle Spezifikation
  → Produktionssymbol beziehungsweise Command
  → Contract-/Konformitätstest
  → relevante Journey
```

Damit lässt sich später nicht nur fragen „haben wir Coverage?“, sondern „welcher
Nachweis schützt diese Regel?“

## Was wir dadurch gewinnen

- Mehr Sicherheit, dass reale Nutzerabläufe und technische Grenzen
  funktionieren.
- Weniger Tests, die bei rein internen Refactorings brechen.
- Weniger Mock-Theater, bei dem Test und Implementierung dieselben falschen
  Annahmen teilen.
- Explizite, reviewbare Definitionen der wichtigsten Domänenregeln.
- Nachweisbare Parität zwischen TypeScript- und Rust-Implementierungen.
- Bessere Release-Evidenz für Persistenz, Migration, IPC und Restart-Verhalten.
- Eine bewusstere Entscheidung darüber, welche Fehlerklasse welcher Test
  erkennen soll.
- Potenziell weniger Testcode und geringere langfristige Wartungskosten.

Der größte Gewinn ist nicht eine kleinere Testanzahl. Der größte Gewinn ist ein
höheres Verhältnis von **erkannter relevanter Fehlerklasse zu gepflegtem
Testcode**.

## Was wir verlieren oder riskieren

### Langsameres Feedback

Integration- und Desktop-Tests benötigen mehr Aufbau, mehr Laufzeit und mehr
Ressourcen als pure Unit-Tests. Deshalb dürfen sie kombinatorische Logik nicht
pauschal ersetzen.

### Schlechtere Fehlerlokalisierung

Wenn eine große Journey rot wird, kann der Fehler in UI, State, IPC, Rust oder
Persistenz liegen. Kleine Tests zeigen die fehlerhafte Funktion häufig
unmittelbar. Die neue Strategie braucht deshalb gute Logs, Traces, Artefakte und
gezielte Tests an den Systemgrenzen.

### Flakiness und Infrastrukturaufwand

Native Anwendungen, Prozesse, Dateisysteme und Zeitverhalten können Tests
instabil machen. Ein Desktop-Harness ohne deterministische Profile, Datenbanken,
IDs, Zeit und Cleanup würde mehr Unsicherheit als Vertrauen erzeugen.

### Zusätzliche Komplexität durch Lean

Lean bringt Toolchain-, Modellierungs- und Pflegekosten mit. Eine unpassende
Formalisierung kann zu einer zweiten, vom Produkt entkoppelten Implementierung
werden. Lean ist deshalb nur für kleine, stabile und kritische
Entscheidungslogik vorgesehen.

### Weniger isolierte Regressionstests

Ein guter Unit-Test dokumentiert einen konkreten Grenzfall sehr präzise. Wenn
solche Tests unreflektiert entfernt werden, verlieren wir schnelle
Fehlerlokalisierung und Randfallbreite. Parser-, Algorithmus- und
Bug-Regressionstests bleiben daher ausdrücklich Teil der Strategie.

### Scheinsicherheit durch formale Modelle

Lean beweist zunächst Eigenschaften des Lean-Modells. Ohne verifizierte
Codegenerierung oder Refinement-Beweis ist damit nicht automatisch bewiesen,
dass TypeScript und Rust für alle Eingaben korrekt implementiert sind.

Die korrekte Aussage des ersten Piloten lautet deshalb:

> Lean-verifizierte Spezifikation mit differential getesteter
> TypeScript-/Rust-Konformität.

## Wann wir das Vorhaben nicht fortsetzen sollten

Die Migration lohnt sich nicht, wenn:

- E2E-Tests nur dieselben Mocks auf einer langsameren Ebene verwenden,
- Fehler deutlich schlechter lokalisierbar werden,
- die neue Suite häufig flaked,
- die PR-Feedbackzeit unvertretbar steigt,
- Lean-Modelle regelmäßig von der Produktionssemantik abweichen,
- die Zahl gelöschter Tests zur primären Erfolgsmetrik wird,
- kritische Randfälle nur noch durch einzelne Happy-Path-Journeys geschützt
  werden,
- Wartungskosten lediglich von Vitest nach Playwright oder Lean verschoben
  werden.

In diesen Fällen behalten wir die betroffenen Unit-Tests oder wechseln zu
Property-, Model-based- oder Contract-Tests, ohne die Migration dogmatisch
fortzusetzen.

## Leitprinzipien

1. Kein Test wird allein wegen seiner Ebene entfernt.
2. Jede relevante Regel benötigt einen ausführbaren Nachweis.
3. E2E prüft Journeys, nicht alle kombinatorischen Varianten.
4. Pure Logik bleibt schnell und nah an der Funktion testbar.
5. Mocks dürfen nicht genau die Grenze ersetzen, die verifiziert werden soll.
6. Lean spezifiziert stabile Domänenlogik, keine UI- oder Frameworkdetails.
7. Alte und neue Nachweise laufen vor einer Löschung parallel.
8. Coverage ist ein Diagnosewert, keine alleinige Qualitätsmetrik.
9. Flaky Tests gelten als defekt und nicht als akzeptables Grundrauschen.
10. Die Produktionsdaten der Nutzer dürfen durch Tests niemals berührt werden.

## Zielarchitektur

```text
Lean-Spezifikation
  ├── Definitionen und Zustandsmodelle
  ├── bewiesene Invarianten
  └── ausführbare Referenzfunktionen
             │
             ▼
versionierte Konformitätsvektoren / Trace-Korpora
             │
       ┌─────┴─────┐
       ▼           ▼
TypeScript      Rust
Domain Core     Domain Core
       │           │
       └─────┬─────┘
             ▼
Integrationsprüfungen
TS ↔ Tauri IPC ↔ Rust ↔ Persistenz/Provider
             │
             ▼
wenige kritische Desktop-Journeys
gegen die gebaute Tauri-Anwendung
```

## Test-Buckets

| Bucket              | Zweck                                          | Typische Beispiele                                   |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| Lean-Spezifikation  | Stabile, kritische Invarianten beweisen        | ProviderPolicy, Goal-Satisfaction, Dependency-Regeln |
| Unit-/Property-Test | Kombinatorische pure Logik schnell prüfen      | `parseDiff`, Sortierung, Graphalgorithmen            |
| Domain-Integration  | Zustandsübergänge und Effects gemeinsam prüfen | Cascade, Reorder, Persist/Reload                     |
| Contract/Parity     | Mehrere Implementierungen vergleichen          | ProviderPolicy in TypeScript und Rust                |
| Component Behavior  | Lokales beobachtbares UI-Verhalten prüfen      | Accessibility, Eingaben, Dialogverhalten             |
| Browser-Journey     | Weboberfläche und React-Flows prüfen           | Modal- und Navigationsabläufe                        |
| Native Vertical E2E | Vollständigen Desktop-Pfad prüfen              | IPC, SQLite, Dateisystem, Restart                    |
| Entfernen           | Kein relevanter zusätzlicher Fehlerschutz      | triviale Setter, CSS-Klassen, redundante Mocks       |

## Arbeitsprogramm

### VFY-01: Teststrategie und Entscheidungsregeln

**Deliverables**

- dieses Strategiedokument,
- ein ADR zur Rolle von Lean,
- verbindliche Regeln für Behalten, Überführen, Zusammenlegen und Löschen,
- Definition von „kritischer Logik“.

**Lean-Eignung**

Ein Bereich ist ein Lean-Kandidat, wenn er:

- deterministisch ist,
- eine stabile Semantik besitzt,
- bei Fehlern erheblichen Schaden verursachen kann,
- ein überschaubares Zustandsmodell hat,
- keine UI-, Netzwerk- oder Frameworkabhängigkeit benötigt,
- eindeutig einer Produktionsfunktion zugeordnet werden kann.

**Done, wenn**

- Reviewer anhand der Regeln denselben Testcluster überwiegend gleich
  klassifizieren,
- die Grenzen der Lean-Aussage ausdrücklich dokumentiert sind.

### VFY-02: Inventar und Baseline

Die Testdateien werden zunächst automatisiert vorgruppiert und danach
clusterweise bewertet. Eine vollständige manuelle Einzelklassifikation aller
536 Dateien ist nicht der erste Schritt.

Für jeden Cluster werden mindestens erfasst:

```yaml
area: provider-policy
protected_rules:
  - deny-always-wins
current_tests:
  - TypeScript fixture test
  - Rust fixture test
target_buckets:
  - formal-spec
  - cross-language-contract
  - integration
risk: critical
decision: migrate
```

**Baseline-Metriken**

- Laufzeit pro Suite und Testdatei,
- Flake-Rate,
- Anzahl und Tiefe der Mocks,
- Testcodezeilen,
- relevante Fehlerklassen,
- Coverage als Diagnosewert,
- gezielte Mutationen oder Fault Injection in den Piloten,
- Zeit zur Lokalisierung eines Fehlers.

**Done, wenn**

- alle Testbereiche einem vorläufigen Bucket zugeordnet sind,
- die Pilotbereiche eine dokumentierte Ausgangsmessung besitzen,
- noch keine massenhafte Löschung stattgefunden hat.

### VFY-03: Ausführbare Verification-Gates

Im Repository existiert derzeit keine eingecheckte CI-Konfiguration. Vor der
breiten Migration müssen die Gates real ausführbar werden.

```text
verify:fast
  Lint, Typecheck, Lean build, Contract-Smokes,
  wertvolle schnelle Unit-/Property-Tests

verify:pr
  check:all, vollständige Contracts,
  Browser-Journeys und Integrationsprüfungen

verify:native
  gebaute Tauri-App, echte IPC-Commands,
  temporäre SQLite-/Filesystem-Zustände

verify:release
  finales App-Artefakt, Migration, Restart,
  Persistenz und zentrale Desktop-Journeys
```

Vor der Umsetzung werden Laufzeitbudgets anhand der Baseline festgelegt.
Erforderliche PR-Tests dürfen nicht durch einen erfolgreichen Retry nachträglich
als stabil gelten. Wiederholungen dienen nur der Flake-Diagnose.

Fehlerartefakte müssen mindestens Logs, relevante Datenbankzustände,
Screenshots und Browser-/Desktop-Traces enthalten.

### VFY-04: UI-Konsolidierungspilot

Pilotbereich: `PhaseChip` und die direkt angrenzende Agent-Statusdarstellung.

**Vorgehen**

- Tests auf konkrete Tailwind-Klassen entfernen,
- zugänglichen Text und semantisch korrekte Statusanzeige behalten,
- Statuswechsel in einer fachlich benannten Browser-Journey prüfen,
- keine trivialen Varianten eins zu eins in Playwright nachbauen.

**Exit-Kriterien**

- ein reines CSS-Refactoring verändert keinen Test,
- ein falsches Statuslabel wird weiterhin erkannt,
- Accessibility-Schutz bleibt bestehen,
- 20 aufeinanderfolgende Läufe sind grün,
- jeder entfernte Test besitzt eine dokumentierte Begründung.

Dieser Pilot validiert den Löschprozess, nicht Lean oder Desktop-E2E.

### VFY-05: Native-Vertical-Pilot

Erste vollständige Journey:

> Requirement erstellen → über IPC speichern → Anwendung neu starten →
> Requirement aus SQLite laden und anzeigen.

Zusätzlicher Fehlerfall:

> Persistenz schlägt fehl → UI zeigt den Fehler → Zustand wird nicht
> fälschlich als gespeichert dargestellt.

**Harness-Anforderungen**

- die gebaute Tauri-Anwendung wird gestartet,
- Rust-Commands und SQLite sind real,
- jeder Test besitzt ein eigenes temporäres Projekt und App-Data-Verzeichnis,
- IDs, Zeit und Zufall sind kontrollierbar,
- Nutzer- und Produktionsdaten werden niemals verwendet,
- Cleanup ist deterministisch,
- externe Provider dürfen simuliert werden; IPC und Persistenz nicht.

Vor der Implementierung entscheidet ein begrenzter technischer Spike, welches
Native-Automation-Werkzeug diese Anforderungen zuverlässig erfüllt. Ein Test
nur gegen das Webview gilt nicht als Native E2E.

**Exit-Kriterien**

- Erfolgspfad und Fehlerpfad laufen gegen reale Grenzen,
- ein absichtlich gebrochener IPC-Vertrag wird erkannt,
- ein absichtlich gebrochener Persistenzpfad wird erkannt,
- 20 konsekutive Läufe sind grün,
- nach 100 geplanten Läufen liegt die Flake-Rate unter 1 Prozent.

### VFY-06: ProviderPolicy als Lean-Pilot

ProviderPolicy ist der erste Kandidat, weil die Regel bereits in TypeScript und
Rust implementiert und über gemeinsame JSON-Fixtures verbunden ist.

**Zu formalisierende Regeln**

- `deny` gewinnt immer,
- `allow: null` oder leer bedeutet keine Allowlist,
- ein nicht erlaubter Provider wird nie ausgewählt,
- unbekannte Namen werden vor der Prüfung auf den Default aufgelöst,
- geprüft wird der aufgelöste Provider,
- wenn kein Provider zulässig ist, entsteht ein explizites Fehlerergebnis,
- gleiche Eingaben erzeugen dieselbe Entscheidung.

**Vorgesehene Struktur**

```text
verification/lean/
  lean-toolchain
  lakefile.toml
  AuricIDE/ProviderPolicy.lean

verification/contracts/
  provider-policy-v1.json
```

Lean liefert das formale Modell, die Invariantenbeweise und eine ausführbare
Referenzfunktion. Daraus entsteht ein versionierter Korpus.

Die Produktionsprüfungen vergleichen:

```text
Lean-Orakel == TypeScript-Implementierung
Lean-Orakel == Rust-Implementierung
TypeScript == Rust
```

Ausgewählte Fälle laufen zusätzlich über den echten Tauri-Pfad.

**Exit-Kriterien**

- alle Policy-Zweige sind einem Theorem oder expliziten Grenzfall zugeordnet,
- TypeScript und Rust stimmen für den gesamten Korpus mit dem Orakel überein,
- relevante gezielte Mutationen bleiben nicht unentdeckt,
- Toolchain, Spec-Version und Korpus sind reproduzierbar gepinnt,
- das Modell enthält keine duplizierte Adapter-Geschäftslogik.

**Abbruchkriterium**

Wenn das Lean-Modell eine zweite, künstliche und schwerer verständliche Policy
erzeugt oder Policy-Änderungen unverhältnismäßig verteuert, wird Lean für diesen
Bereich gestoppt. Gemeinsame Fixtures und Differentialtests bleiben bestehen.

### VFY-07: Pilot-Auswertung und Go/No-Go

Eine breitere Migration wird nur freigegeben, wenn:

- keine benannte Kerninvariante Schutz verloren hat,
- Fault Injection beziehungsweise Mutation mindestens so wirksam ist wie in
  der Baseline,
- TypeScript, Rust und Lean für den Pilot-Korpus übereinstimmen,
- die Native-Journey reale IPC- und Persistenzgrenzen nutzt,
- die Flake-Budgets eingehalten werden,
- Fehler mindestens so gut lokalisierbar sind wie vorher,
- die Fast- und PR-Gates ihre vereinbarten Laufzeitbudgets einhalten,
- keine kritische Prüfung quarantänisiert ist,
- der Wartungsaufwand nicht lediglich auf eine andere Testebene verschoben
  wurde.

Scheitert eine Bedingung, wird die Portfolio-Migration nicht gestartet. Der
betroffene Pilot wird korrigiert, anders gelöst oder zurückgerollt.

### VFY-08: `pmSlice` migrieren

Nicht der gesamte Zustand-Store wird formalisiert. Die relevante Domainlogik
soll, soweit wirtschaftlich, als Transition isoliert werden:

```text
State × DomainEvent → State × EffectIntent
```

Zeit, IDs, Persistenz, Toasts und IPC werden dabei explizite Eingaben oder
Effects.

**Zielverteilung**

- triviale Setter-Tests entfernen,
- Cascade- und Reorder-Regeln als State-/Property-Tests behalten,
- Save/Reload als Integrationstest prüfen,
- Persistenzfehler als Integrationstest prüfen,
- einen vollständigen PM-Lifecycle als Journey prüfen,
- Eventsequenzen modellbasiert testen.

Wenn UI- und Async-Details das Modell dominieren, wird keine Lean-Spezifikation
erzwungen. Model-based Tests sind dann die passendere Lösung.

### VFY-09: Goal-Satisfaction formalisieren

Dieser Schritt beginnt erst, wenn der ProviderPolicy-Pilot den Nutzen und die
Kosten der Lean-Brücke sichtbar gemacht hat und die fachliche Semantik stabil
ist.

Mögliche Invarianten:

- ein Goal ohne abgeschlossene Pflichtbedingungen ist niemals satisfied,
- unverified Evidence erfüllt keine Station,
- alle erforderlichen Tickets, Requirements, Stations und Child Goals müssen
  den definierten Zustand besitzen,
- irrelevante zusätzliche Daten verändern das Ergebnis nicht,
- gleiche Eingaben liefern dasselbe Ergebnis.

Wenn Teile der Bewertung probabilistisch oder LLM-basiert sind, wird nur der
deterministische Rahmen formalisiert: Eingabevalidierung, Aggregation,
Schwellen, Fehler- und Fallbackregeln.

### VFY-10: Bereichsweise Portfolio-Migration

Jeder Bereich wird in drei getrennten Schritten migriert:

1. Ersatznachweis hinzufügen.
2. Alte und neue Suite parallel im Shadow-Modus betreiben.
3. Alte Tests nach erfolgreicher Auswertung entfernen.

**Reihenfolge**

1. CSS-, Snapshot- und Implementierungsdetailtests,
2. triviale Setter und Prop-Durchleitungen,
3. redundante Component-Tests,
4. stark gemockte Workflow-Tests,
5. Domain- und State-Tests nur mit aktivem Ersatz,
6. Parser und Algorithmen zuletzt und ausschließlich evidenzbasiert.

`parseDiff` bleibt beispielsweise schnelle parsernahe Unit-/Property-Logik und
wird nicht durch E2E ersetzt.

## Löschprotokoll

Jede Entfernung dokumentiert:

- die geschützte Regel,
- den bisherigen Test,
- den neuen Nachweis oder die Redundanzbegründung,
- das Ergebnis von Mutation oder Fault Injection,
- den Shadow-Zeitraum,
- das zuständige Gate,
- die explizite Review-Freigabe.

Löschung und Ersatz sollen in getrennten, leicht nachvollziehbaren Änderungen
erfolgen. Dadurch bleibt ein bereichsweiser Rollback möglich, ohne die gesamte
alte Suite zurückbringen zu müssen.

## Stop- und Rollback-Kriterien

Die Migration eines Bereichs wird pausiert oder zurückgerollt, wenn:

- eine Kerninvariante nur noch durch einen Happy Path geschützt ist,
- Mutation/Fault Detection gegenüber der Baseline sinkt,
- die Native-Flake-Rate das vereinbarte Budget überschreitet,
- Testdaten nicht zuverlässig von Nutzerdaten isoliert werden können,
- Fehler durch die größere Testebene wesentlich schlechter lokalisierbar sind,
- TypeScript, Rust und Lean ungeklärt voneinander abweichen,
- Korpus oder Lean-Build nicht reproduzierbar sind,
- relevante Regressionen aus bereits migrierten Bereichen entkommen,
- die Testlaufzeit nur von Vitest zu instabilem E2E verlagert wurde.

## Erfolgsmessung

Die Testanzahl ist keine primäre Erfolgsmetrik. Gemessen werden:

| Metrik                   | Erwartung                                                            |
| ------------------------ | -------------------------------------------------------------------- |
| Invariantenabdeckung     | Jede kritische Invariante hat Positiv-, Negativ- und Fehlernachweis  |
| Mutation/Fault Detection | Im migrierten Bereich nicht schlechter als die Baseline              |
| Contract-Parität         | TypeScript und Rust stimmen für 100 % des gemeinsamen Korpus überein |
| Flake-Rate               | Fast Gates praktisch null; Native E2E unter dem vereinbarten Budget  |
| Feedbackzeit             | p95 bleibt innerhalb des vorab festgelegten Gate-Budgets             |
| Fehlerlokalisierung      | Zeit bis zur identifizierten Schicht steigt nicht wesentlich         |
| Escape Rate              | Keine erhöhte Regressionrate in migrierten Bereichen                 |
| Refactoring-Kosten       | Weniger Teständerungen ohne Verhaltensänderung                       |
| Native-Path-Abdeckung    | Zentrale Workflows durchlaufen reale IPC- und Persistenzgrenzen      |
| Wartungsaufwand          | Keine bloße Verschiebung von Vitest zu Playwright oder Lean          |

Die Metriken werden vor dem Pilot erhoben und nach dem Pilot sowie nach jeder
Migrationswelle erneut verglichen.

## Definition of Done

Das Gesamtvorhaben ist erfolgreich, wenn:

- jede kritische Invariante einem ausführbaren Nachweis zugeordnet ist,
- echte Tauri-Journeys die zentralen Persistenz- und IPC-Pfade prüfen,
- Lean für mindestens einen stabilen Bereich messbaren Zusatznutzen liefert,
- TypeScript-/Rust-Konformität automatisiert geprüft wird,
- Flakiness und Diagnosezeit nicht steigen,
- interne Refactorings weniger unnötige Teständerungen verursachen,
- die verbleibenden Unit-Tests bewusst ausgewählte Logik- und
  Regressionstests sind,
- gelöschte Tests nicht als Erfolg an sich gewertet werden.

## Unmittelbar nächste Schritte

1. VFY-01 als ADR und verbindliche Test-Policy abschließen.
2. VFY-02 als automatisiertes Inventar mit Baseline-Bericht umsetzen.
3. VFY-03 mit minimalen ausführbaren Gates und festgelegten Budgets aufbauen.
4. Erst danach im Rahmen von VFY-04 den ersten Test verändern oder entfernen.
