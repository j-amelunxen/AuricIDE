use crate::schedules::Schedule;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CreateMissionInput {
    pub project_path: String,
    #[serde(default)]
    pub project_name: Option<String>,
    pub name: String,
    pub objective: String,
    pub recurrence: MissionRecurrence,
    pub timezone: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum MissionRecurrence {
    Daily {
        time_of_day: String,
    },
    Weekly {
        weekday: u8,
        time_of_day: String,
    },
    Interval {
        every_n: i64,
        every_unit: String,
        #[serde(default)]
        time_of_day: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CreatedMission {
    pub name: String,
    pub slug: String,
    pub path: String,
    pub schedule_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CreatedMissionWithSchedule {
    pub mission: CreatedMission,
    pub schedule: Schedule,
}
