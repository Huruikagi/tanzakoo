use super::{NotificationPermission, NotificationTarget};
use tauri_winrt_notification::Toast;
use windows::{
    UI::Notifications::{NotificationSetting, ToastNotificationManager},
    Win32::{
        Foundation::{
            APPMODEL_ERROR_NO_APPLICATION, APPMODEL_ERROR_NO_PACKAGE, ERROR_INSUFFICIENT_BUFFER,
            ERROR_NOT_FOUND,
        },
        Storage::Packaging::Appx::GetCurrentApplicationUserModelId,
        System::Registry::{
            HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ, RegCloseKey,
            RegCreateKeyExW, RegSetValueExW,
        },
    },
    core::{HRESULT, HSTRING, PCWSTR, PWSTR, w},
};

fn app_id(app: &tauri::AppHandle) -> Result<String, String> {
    let mut length = 0;
    // MSIX assigns an AUMID from the installed package identity, not the Tauri identifier.
    let status = unsafe { GetCurrentApplicationUserModelId(&mut length, None) };
    if status == ERROR_INSUFFICIENT_BUFFER {
        let mut buffer = vec![0u16; length as usize];
        unsafe { GetCurrentApplicationUserModelId(&mut length, Some(PWSTR(buffer.as_mut_ptr()))) }
            .ok()
            .map_err(|e| e.to_string())?;
        return String::from_utf16(&buffer[..length.saturating_sub(1) as usize])
            .map_err(|e| e.to_string());
    }
    if status != APPMODEL_ERROR_NO_APPLICATION && status != APPMODEL_ERROR_NO_PACKAGE {
        return Err(format!(
            "Could not resolve notification identity: {status:?}"
        ));
    }
    let id = app.config().identifier.clone();
    // Register only our unpackaged app, per user, as in Tauri's unpackaged toast example.
    // Never impersonate PowerShell or guess an MSIX package identity.
    let key_name = HSTRING::from(format!(r"SOFTWARE\Classes\AppUserModelId\{id}"));
    let mut key = HKEY::default();
    unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            &key_name,
            None,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            None,
            &mut key,
            None,
        )
    }
    .ok()
    .map_err(|e| e.to_string())?;
    let display_name: Vec<u8> = "Tanzakoo\0"
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect();
    let result =
        unsafe { RegSetValueExW(key, w!("DisplayName"), None, REG_SZ, Some(&display_name)) }.ok();
    let _ = unsafe { RegCloseKey(key) };
    result.map_err(|e| e.to_string())?;
    Ok(id)
}

pub async fn permission(
    app: &tauri::AppHandle,
    _request: bool,
) -> Result<NotificationPermission, String> {
    let notifier =
        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id(app)?))
            .map_err(|e| e.to_string())?;
    let setting = match notifier.Setting() {
        Ok(setting) => setting,
        // The OS may not create the app's notification settings until its first toast.
        // Keep this distinct from both authorization granted and explicit OS denial.
        Err(error) if error.code() == HRESULT::from_win32(ERROR_NOT_FOUND.0) => {
            return Ok(NotificationPermission::Unknown);
        }
        Err(error) => return Err(error.to_string()),
    };
    Ok(if setting == NotificationSetting::Enabled {
        NotificationPermission::Granted
    } else {
        NotificationPermission::Denied
    })
}

pub async fn show(
    app: &tauri::AppHandle,
    target: Option<NotificationTarget>,
    body: &str,
) -> Result<(), String> {
    let id = app_id(app)?;
    let app = app.clone();
    Toast::new(&id)
        .title("Tanzakoo")
        .text1(body)
        .on_activated(move |_| {
            super::activate(&app, target.clone());
            Ok(())
        })
        .show()
        .map_err(|e| e.to_string())
}
