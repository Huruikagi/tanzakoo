use super::{NotificationPermission, NotificationTarget};
use block2::{DynBlock, RcBlock};
use objc2::{
    AnyThread, define_class, msg_send,
    rc::Retained,
    runtime::{Bool, ProtocolObject},
};
use objc2_foundation::{NSBundle, NSError, NSObject, NSObjectProtocol, NSString};
use objc2_user_notifications::*;
use std::{
    cell::RefCell,
    ptr::NonNull,
    sync::{
        Mutex, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
};
use tokio::sync::oneshot;

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
static NEXT: AtomicU64 = AtomicU64::new(1);
thread_local! { static DELEGATE: RefCell<Option<Retained<NotificationDelegate>>> = const { RefCell::new(None) }; }

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "TanzakooNotificationDelegate"]
    struct NotificationDelegate;

    unsafe impl NSObjectProtocol for NotificationDelegate {}
    unsafe impl UNUserNotificationCenterDelegate for NotificationDelegate {
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            completion: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            completion.call((UNNotificationPresentationOptions::Banner
                | UNNotificationPresentationOptions::List
                | UNNotificationPresentationOptions::Sound,));
        }
        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn respond(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion: &DynBlock<dyn Fn()>,
        ) {
            // Only the default click opens the app; dismiss actions do not navigate.
            if &*response.actionIdentifier() == unsafe { UNNotificationDefaultActionIdentifier }
                && let Some(app) = APP.get()
            {
                let identifier = response.notification().request().identifier().to_string();
                let target = identifier
                    .split_once(':')
                    .and_then(|(_, value)| serde_json::from_str(value).ok());
                super::activate(app, target);
            }
            completion.call(());
        }
    }
);

pub fn initialize(app: &tauri::AppHandle) {
    // UNUserNotificationCenter may raise an Objective-C exception for an unbundled executable.
    if !bundled() {
        return;
    }
    let _ = APP.set(app.clone());
    // Center holds a weak delegate. Retain it for the life of the UI thread.
    let delegate: Retained<NotificationDelegate> =
        unsafe { msg_send![NotificationDelegate::alloc(), init] };
    UNUserNotificationCenter::currentNotificationCenter()
        .setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    DELEGATE.with(|slot| *slot.borrow_mut() = Some(delegate));
}

fn bundled() -> bool {
    let bundle = NSBundle::mainBundle();
    bundle.bundleIdentifier().is_some() && bundle.bundlePath().to_string().ends_with(".app")
}

async fn status() -> Result<NotificationPermission, String> {
    let (tx, rx) = oneshot::channel();
    {
        let tx = Mutex::new(Some(tx));
        let callback = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
            // Apple's callback provides a valid settings object for the duration of this block.
            let settings = unsafe { settings.as_ref() };
            let status = settings.authorizationStatus();
            let result = if status == UNAuthorizationStatus::NotDetermined {
                NotificationPermission::NotDetermined
            } else if status == UNAuthorizationStatus::Denied {
                NotificationPermission::Denied
            } else if settings.alertSetting() == UNNotificationSetting::Enabled {
                NotificationPermission::Granted
            } else {
                NotificationPermission::Denied
            };
            if let Ok(mut sender) = tx.lock()
                && let Some(sender) = sender.take()
            {
                let _ = sender.send(result);
            }
        });
        UNUserNotificationCenter::currentNotificationCenter()
            .getNotificationSettingsWithCompletionHandler(&callback);
    }
    rx.await.map_err(|e| e.to_string())
}

pub async fn permission(
    app: &tauri::AppHandle,
    request: bool,
) -> Result<NotificationPermission, String> {
    if !bundled() {
        return Ok(NotificationPermission::Unavailable);
    }
    let current = status().await?;
    if !request || current != NotificationPermission::NotDetermined {
        return Ok(current);
    }
    let (tx, rx) = oneshot::channel();
    app.run_on_main_thread(move || {
        let tx = Mutex::new(Some(tx));
        let callback = RcBlock::new(move |_granted: Bool, error: *mut NSError| {
            let result = if error.is_null() {
                Ok(())
            } else {
                Err(unsafe { &*error }.localizedDescription().to_string())
            };
            if let Ok(mut sender) = tx.lock()
                && let Some(sender) = sender.take()
            {
                let _ = sender.send(result);
            }
        });
        UNUserNotificationCenter::currentNotificationCenter()
            .requestAuthorizationWithOptions_completionHandler(
                UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
                &callback,
            );
    })
    .map_err(|e| e.to_string())?;
    rx.await.map_err(|e| e.to_string())??;
    status().await
}

pub async fn show(
    _app: &tauri::AppHandle,
    target: Option<NotificationTarget>,
    body: &str,
) -> Result<(), String> {
    let (tx, rx) = oneshot::channel();
    {
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str("Tanzakoo"));
        content.setBody(&NSString::from_str(body));
        content.setSound(Some(&UNNotificationSound::defaultSound()));
        let target = target
            .map(|t| serde_json::to_string(&t))
            .transpose()
            .map_err(|e| e.to_string())?
            .unwrap_or_default();
        let identifier = NSString::from_str(&format!(
            "{}:{target}",
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &identifier,
            &content,
            None,
        );
        let tx = Mutex::new(Some(tx));
        let callback = RcBlock::new(move |error: *mut NSError| {
            let result = if error.is_null() {
                Ok(())
            } else {
                Err(unsafe { &*error }.localizedDescription().to_string())
            };
            if let Ok(mut sender) = tx.lock()
                && let Some(sender) = sender.take()
            {
                let _ = sender.send(result);
            }
        });
        UNUserNotificationCenter::currentNotificationCenter()
            .addNotificationRequest_withCompletionHandler(&request, Some(&callback));
    }
    rx.await.map_err(|e| e.to_string())?
}
