//! Questions an agent raised for whoever started it
//! (`docs/design-agent-control.md`, "Questions"; model:
//! `verification/lean/AuricIDE/AgentQuestions.lean`).
//!
//! One append-only log per agent. A question gets the next `seq`, starting at
//! 1, and never changes. A reader names the highest `seq` it has seen and gets
//! everything after it, so with the cursor from its last answer it sees each
//! question exactly once, and an answer that got lost is delivered again
//! because the cursor did not move. A full log refuses the next question
//! rather than dropping an old one.
//!
//! In memory, like the output buffers: a question belongs to a running process
//! and a restart ends the agents that raised them.

use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

/// `limits.questionsPerAgentKept`.
pub const QUESTIONS_PER_AGENT: usize = 50;
/// How many agents keep a log before the oldest log goes. Far above the
/// finished agents anyone can still read (`RUN_RESULTS_KEPT`).
const AGENTS_KEPT: usize = 1000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    pub seq: u64,
    pub question: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<String>,
    pub raised_at: u64,
}

/// What a question is made of, before it has a number.
#[derive(Debug, Clone, PartialEq)]
pub struct NewQuestion {
    pub question: String,
    pub context: Option<String>,
    pub options: Vec<String>,
    pub raised_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogFull;

#[derive(Default)]
struct AgentLog {
    questions: Vec<Question>,
    /// Highest `seq` an answer has carried to the supervisor.
    delivered: u64,
    /// Highest `seq` a notice has already announced.
    announced: u64,
}

/// A notice owed to a supervisor: `agent_id` has `count` questions it has not
/// heard of, and `cursor` is what to read them with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unheard {
    pub agent_id: String,
    pub count: u64,
    pub cursor: u64,
    pub top: u64,
}

#[derive(Default)]
struct Logs {
    by_agent: HashMap<String, AgentLog>,
    order: VecDeque<String>,
}

#[derive(Default)]
pub struct QuestionLog {
    logs: Mutex<Logs>,
}

impl QuestionLog {
    fn lock(&self) -> std::sync::MutexGuard<'_, Logs> {
        self.logs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Appends a question and returns its `seq`.
    pub fn raise(&self, agent_id: &str, new: NewQuestion) -> Result<u64, LogFull> {
        let mut logs = self.lock();
        if !logs.by_agent.contains_key(agent_id) {
            logs.order.push_back(agent_id.to_string());
            while logs.order.len() > AGENTS_KEPT {
                if let Some(oldest) = logs.order.pop_front() {
                    logs.by_agent.remove(&oldest);
                }
            }
        }
        let log = logs.by_agent.entry(agent_id.to_string()).or_default();
        if log.questions.len() >= QUESTIONS_PER_AGENT {
            return Err(LogFull);
        }
        let seq = log.questions.len() as u64 + 1;
        log.questions.push(Question {
            seq,
            question: new.question,
            context: new.context,
            options: new.options,
            raised_at: new.raised_at,
        });
        Ok(seq)
    }

    /// Everything after `cursor`, oldest first, and the highest `seq` there is
    /// (the next cursor; `cursor` itself when nothing was ever raised).
    pub fn since(&self, agent_id: &str, cursor: u64) -> (Vec<Question>, u64) {
        let logs = self.lock();
        let Some(log) = logs.by_agent.get(agent_id) else {
            return (Vec::new(), cursor);
        };
        let top = log.questions.len() as u64;
        let found = log
            .questions
            .iter()
            .filter(|question| question.seq > cursor)
            .cloned()
            .collect();
        (found, top.max(cursor))
    }

    /// `since` for an answer on its way to the supervisor: what it carries
    /// needs no notice any more.
    pub fn deliver(&self, agent_id: &str, cursor: u64) -> (Vec<Question>, u64) {
        let (questions, top) = self.since(agent_id, cursor);
        if let Some(last) = questions.last() {
            if let Some(log) = self.lock().by_agent.get_mut(agent_id) {
                log.delivered = log.delivered.max(last.seq);
            }
        }
        (questions, top)
    }

    /// How many questions the agent has raised.
    pub fn count(&self, agent_id: &str) -> u64 {
        self.lock()
            .by_agent
            .get(agent_id)
            .map_or(0, |log| log.questions.len() as u64)
    }

    /// The agents with questions neither delivered nor announced yet.
    pub fn unheard(&self) -> Vec<Unheard> {
        self.lock()
            .by_agent
            .iter()
            .filter_map(|(agent_id, log)| {
                let top = log.questions.len() as u64;
                let heard = log.delivered.max(log.announced);
                (top > heard).then(|| Unheard {
                    agent_id: agent_id.clone(),
                    count: top - heard,
                    cursor: heard,
                    top,
                })
            })
            .collect()
    }

    /// The notice reached the supervisor: `seq` up to `top` are announced.
    pub fn mark_announced(&self, agent_id: &str, top: u64) {
        if let Some(log) = self.lock().by_agent.get_mut(agent_id) {
            log.announced = log.announced.max(top);
        }
    }

    pub fn forget(&self, agent_id: &str) {
        let mut logs = self.lock();
        logs.by_agent.remove(agent_id);
        logs.order.retain(|kept| kept != agent_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asked(text: &str) -> NewQuestion {
        NewQuestion {
            question: text.into(),
            context: None,
            options: Vec::new(),
            raised_at: 1,
        }
    }

    fn texts(found: &[Question]) -> Vec<&str> {
        found.iter().map(|q| q.question.as_str()).collect()
    }

    #[test]
    fn each_question_comes_once_with_the_cursor_and_again_without_it() {
        let log = QuestionLog::default();
        assert_eq!(log.since("a", 0), (Vec::new(), 0));
        assert_eq!(log.raise("a", asked("one")), Ok(1));
        assert_eq!(log.raise("a", asked("two")), Ok(2));
        let (first, cursor) = log.since("a", 0);
        assert_eq!(texts(&first), ["one", "two"]);
        assert_eq!(cursor, 2);
        assert!(log.since("a", cursor).0.is_empty(), "nothing new");
        assert_eq!(log.raise("a", asked("three")), Ok(3));
        assert_eq!(texts(&log.since("a", cursor).0), ["three"]);
        assert_eq!(
            texts(&log.since("a", 0).0).len(),
            3,
            "a lost answer comes again"
        );
    }

    #[test]
    fn a_full_log_refuses_and_keeps_what_it_has() {
        let log = QuestionLog::default();
        for n in 0..QUESTIONS_PER_AGENT {
            log.raise("a", asked(&n.to_string())).unwrap();
        }
        assert_eq!(log.raise("a", asked("too many")), Err(LogFull));
        assert_eq!(log.since("a", 0).0.len(), QUESTIONS_PER_AGENT);
        assert_eq!(log.raise("b", asked("another agent")), Ok(1));
    }

    #[test]
    fn a_cursor_past_the_end_stays_where_it_is() {
        let log = QuestionLog::default();
        log.raise("a", asked("one")).unwrap();
        assert_eq!(log.since("a", 9), (Vec::new(), 9));
        assert_eq!(log.since("nobody", 9), (Vec::new(), 9));
    }

    /// `verification/contracts/agent-questions-v1.jsonl`, generated by the Lean
    /// model: every step of every trace, against the real log.
    #[test]
    fn the_real_log_replays_the_lean_corpus() {
        let corpus = include_str!("../../../verification/contracts/agent-questions-v1.jsonl");
        let mut traces = 0;
        for line in corpus.lines() {
            let trace: serde_json::Value = serde_json::from_str(line).unwrap();
            let name = trace["name"].as_str().unwrap();
            let log = QuestionLog::default();
            for step in trace["steps"].as_array().unwrap() {
                let cursor = step["from"].as_u64().unwrap_or(0);
                match step["op"].as_str().unwrap() {
                    "raise" => {
                        let text = step["q"].to_string();
                        let got = log.raise("a", asked(&text)).ok();
                        assert_eq!(serde_json::json!(got), step["seq"], "{name}");
                    }
                    "read" => {
                        let (found, next) = log.deliver("a", cursor);
                        let texts: Vec<serde_json::Value> = found
                            .iter()
                            .map(|q| serde_json::from_str(&q.question).unwrap())
                            .collect();
                        assert_eq!(serde_json::json!(texts), step["found"], "{name}");
                        assert_eq!(serde_json::json!(next), step["next"], "{name}");
                    }
                    "lost" => {
                        log.deliver("a", cursor);
                    }
                    "notice" => {
                        let owed = log.unheard().first().map_or(0, |unheard| unheard.count);
                        assert_eq!(serde_json::json!(owed), step["owed"], "{name}");
                        if let Some(unheard) = log.unheard().first() {
                            log.mark_announced("a", unheard.top);
                        }
                    }
                    other => panic!("{name}: unknown op {other}"),
                }
            }
            traces += 1;
        }
        assert!(traces > 1000, "the corpus was cut short: {traces}");
    }

    #[test]
    fn a_notice_is_owed_once_and_not_for_what_an_answer_already_carried() {
        let log = QuestionLog::default();
        log.raise("a", asked("one")).unwrap();
        log.raise("a", asked("two")).unwrap();
        let owed = log.unheard();
        assert_eq!(owed[0].count, 2);
        assert_eq!((owed[0].cursor, owed[0].top), (0, 2));
        log.mark_announced("a", 2);
        assert!(log.unheard().is_empty());

        log.raise("a", asked("three")).unwrap();
        log.deliver("a", 0);
        assert!(log.unheard().is_empty(), "the await carried it");
        log.raise("a", asked("four")).unwrap();
        assert_eq!(log.unheard()[0].cursor, 3);
        log.forget("a");
        assert!(log.unheard().is_empty());
        assert_eq!(log.count("a"), 0);
    }
}
