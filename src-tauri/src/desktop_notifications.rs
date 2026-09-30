//! Local completion notifications. No project content is included in the OS payload.
use crate::{AppState, language::Language};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use ts_rs::TS;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod windows;
#[cfg(target_os = "macos")]
use macos as platform;
#[cfg(windows)]
use windows as platform;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum NotificationMode {
    Never,
    #[default]
    Inactive,
    Always,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum NotificationPermission {
    Granted,
    Denied,
    NotDetermined,
    Unknown,
    Unavailable,
}

#[derive(Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct NotificationTarget {
    pub project_id: String,
    pub conversation_id: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct NotificationSettings {
    pub mode: NotificationMode,
    pub permission: NotificationPermission,
}

pub fn initialize(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    platform::initialize(app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

pub fn activate(app: &tauri::AppHandle, target: Option<NotificationTarget>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        if let Some(target) = target {
            let _ = app.emit("notification-activated", target);
        }
    }
}

fn eligible(mode: NotificationMode, focused: Option<bool>, succeeded: bool) -> bool {
    succeeded
        && match mode {
            NotificationMode::Never => false,
            NotificationMode::Inactive => focused == Some(false),
            NotificationMode::Always => true,
        }
}

fn can_send(permission: NotificationPermission) -> bool {
    // Windows has no prompt and may have no per-app record until the first toast.
    matches!(
        permission,
        NotificationPermission::Granted | NotificationPermission::Unknown
    )
}

/// Called once after a successfully persisted turn, never from replayed UI events.
pub async fn completed(
    app: &tauri::AppHandle,
    target: NotificationTarget,
    language: Language,
    succeeded: bool,
) {
    let mode = app
        .state::<AppState>()
        .projects
        .lock()
        .ok()
        .and_then(|p| p.notification_mode().ok())
        .unwrap_or(NotificationMode::Never);
    let focused = app
        .get_webview_window("main")
        .and_then(|w| w.is_focused().ok());
    if !eligible(mode, focused, succeeded) {
        return;
    }
    // Never open an authorization prompt as an unexpected side effect of completion.
    if !permission(app, false).await.is_ok_and(can_send) {
        return;
    }
    if let Err(error) = show(app, Some(target), language, false).await {
        tracing::warn!(%error, "Completion notification failed");
    }
}

async fn permission(
    app: &tauri::AppHandle,
    request: bool,
) -> Result<NotificationPermission, String> {
    #[cfg(any(windows, target_os = "macos"))]
    {
        platform::permission(app, request).await
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (app, request);
        Ok(NotificationPermission::Unavailable)
    }
}

async fn show(
    app: &tauri::AppHandle,
    target: Option<NotificationTarget>,
    language: Language,
    test: bool,
) -> Result<(), String> {
    let body = if test {
        language.choose("テスト通知です。", "This is a test notification.")
    } else {
        language.choose("AIの応答が完了しました。", "The AI response is ready.")
    };
    #[cfg(any(windows, target_os = "macos"))]
    {
        platform::show(app, target, body).await
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (app, target, body);
        Err("Notifications are unavailable on this platform".into())
    }
}

#[tauri::command]
pub async fn notification_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<NotificationSettings, String> {
    let mode = state
        .projects
        .lock()
        .map_err(|e| e.to_string())?
        .notification_mode()
        .map_err(|e| e.system_message())?;
    Ok(NotificationSettings {
        mode,
        permission: permission(&app, false)
            .await
            .unwrap_or(NotificationPermission::Unavailable),
    })
}

#[tauri::command]
pub async fn configure_notifications(
    mode: NotificationMode,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<NotificationSettings, String> {
    let permission = if mode == NotificationMode::Never {
        permission(&app, false)
            .await
            .unwrap_or(NotificationPermission::Unavailable)
    } else {
        permission(&app, true).await?
    };
    state
        .projects
        .lock()
        .map_err(|e| e.to_string())?
        .set_notification_mode(mode)
        .map_err(|e| e.system_message())?;
    Ok(NotificationSettings { mode, permission })
}

#[tauri::command]
pub async fn test_notification(
    app: tauri::AppHandle,
    ui_language: Language,
) -> Result<NotificationPermission, String> {
    let permission = permission(&app, true).await?;
    if can_send(permission) {
        show(&app, None, ui_language, true).await?;
    }
    Ok(permission)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_successful_turns_follow_the_current_focus_policy() {
        for mode in [
            NotificationMode::Never,
            NotificationMode::Inactive,
            NotificationMode::Always,
        ] {
            for focus in [Some(true), Some(false), None] {
                assert!(!eligible(mode, focus, false));
            }
        }
        assert!(!eligible(NotificationMode::Never, Some(false), true));
        assert!(eligible(NotificationMode::Inactive, Some(false), true));
        assert!(!eligible(NotificationMode::Inactive, Some(true), true));
        assert!(!eligible(NotificationMode::Inactive, None, true));
        assert!(eligible(NotificationMode::Always, Some(true), true));
        assert!(can_send(NotificationPermission::Granted));
        assert!(can_send(NotificationPermission::Unknown));
        for permission in [
            NotificationPermission::Denied,
            NotificationPermission::NotDetermined,
            NotificationPermission::Unavailable,
        ] {
            assert!(!can_send(permission));
        }
    }
    #[test]
    fn preference_survives_restart_and_project_creation() {
        let root =
            std::env::temp_dir().join(format!("tanzakoo-notifications-{}", std::process::id()));
        let mut projects = crate::projects::Projects::open(root.clone()).unwrap();
        assert_eq!(
            projects.notification_mode().unwrap(),
            NotificationMode::Inactive
        );
        projects
            .set_notification_mode(NotificationMode::Always)
            .unwrap();
        projects.create("Other".into(), String::new()).unwrap();
        assert_eq!(
            projects.notification_mode().unwrap(),
            NotificationMode::Always
        );
        drop(projects);
        let projects = crate::projects::Projects::open(root.clone()).unwrap();
        assert_eq!(
            projects.notification_mode().unwrap(),
            NotificationMode::Always
        );
        projects
            .set_notification_mode(NotificationMode::Never)
            .unwrap();
        assert_eq!(
            projects.notification_mode().unwrap(),
            NotificationMode::Never
        );
        drop(projects);
        std::fs::remove_dir_all(root).unwrap();
    }
}
