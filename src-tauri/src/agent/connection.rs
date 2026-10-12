use super::AgentRuntime;
use crate::{chatgpt_plan, external_agents, review};

/// A per-operation connection snapshot. Selection never changes the active route.
pub(crate) struct Connection {
    pub review: Option<review::ReviewSession>,
    pub plan: Option<chatgpt_plan::PlanAccount>,
}

impl Connection {
    pub fn select(runtime: &AgentRuntime, agent: &str) -> Result<Self, String> {
        let external = external_agents::is_external(agent);
        if external {
            external_agents::ensure_available(agent)?;
        }
        let review = runtime.review_session()?;
        if external && review.is_some() {
            return Err("先に審査用接続を解除してください。".into());
        }
        let plan = if review.is_none() && !external {
            runtime.plan_account()?
        } else {
            None
        };
        Ok(Self { review, plan })
    }

    /// Both the command and runner check the saved route before doing any work.
    pub fn validate_session(&self, session: Option<&str>) -> Result<(), String> {
        chatgpt_plan::ensure_route(session, self.plan.as_ref())?;
        review::ensure_conversation_route(session, self.review.is_some())?;
        if let Some(access) = &self.review {
            access.ensure_usable()?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_conversations_stay_with_the_selected_account() {
        let runtime = AgentRuntime::default();
        *runtime.plan.lock().unwrap() = Some(chatgpt_plan::PlanAccount {
            id: "selected".into(),
            label: "Account".into(),
            signed_in: true,
        });
        let connection = Connection::select(&runtime, "codex").unwrap();
        assert!(connection.validate_session(None).is_ok());
        assert!(
            connection
                .validate_session(Some("tanzakoo-plan-v1:selected:thread"))
                .is_ok()
        );
        for session in [
            "tanzakoo-plan-v1:other:thread",
            "tanzakoo-review-v1:thread",
            "tanzakoo-v1:thread",
        ] {
            assert!(connection.validate_session(Some(session)).is_err());
        }
        // Losing the selected account cannot silently resume the saved plan session.
        *runtime.plan.lock().unwrap() = None;
        assert!(
            Connection::select(&runtime, "codex")
                .unwrap()
                .validate_session(Some("tanzakoo-plan-v1:selected:thread"))
                .is_err()
        );
    }

    #[test]
    fn external_connections_never_inherit_the_selected_plan() {
        let runtime = AgentRuntime::default();
        *runtime.plan.lock().unwrap() = Some(chatgpt_plan::PlanAccount {
            id: "selected".into(),
            label: "Account".into(),
            signed_in: true,
        });
        for agent in external_agents::IDS {
            let selected = Connection::select(&runtime, agent);
            if !external_agents::available() {
                assert_eq!(selected.err().unwrap(), external_agents::DISABLED);
                continue;
            }
            let connection = selected.unwrap();
            assert!(connection.plan.is_none());
            assert!(connection.validate_session(None).is_ok());
            assert!(
                connection
                    .validate_session(Some("tanzakoo-v1:thread"))
                    .is_ok()
            );
            for session in [
                "tanzakoo-plan-v1:selected:thread",
                "tanzakoo-review-v1:thread",
            ] {
                assert!(connection.validate_session(Some(session)).is_err());
            }
        }
    }
}
