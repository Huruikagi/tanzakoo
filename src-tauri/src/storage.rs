//! Writable application state is separate from the installed, read-only runtime.
//! Resolve native locations at startup; never construct a container path or package ID.
use std::{
    ffi::OsString,
    fs, io,
    path::{Path, PathBuf},
};

pub fn data_dir<R: tauri::Runtime>(
    app: &tauri::App<R>,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    prepare_data_dir(std::env::var_os("TANZAKOO_DATA_DIR"), || {
        #[cfg(target_os = "macos")]
        {
            macos_data_dir(&app.config().identifier)
        }
        #[cfg(not(target_os = "macos"))]
        {
            use tauri::Manager;
            app.path().app_local_data_dir().map_err(io::Error::other)
        }
    })
    .map_err(Into::into)
}

#[cfg(target_os = "macos")]
fn macos_data_dir(identifier: &str) -> io::Result<PathBuf> {
    use objc2_foundation::{
        NSSearchPathDirectory, NSSearchPathDomainMask, NSSearchPathForDirectoriesInDomains,
    };
    // Foundation returns Application Support inside the container when sandboxed,
    // including when launched from a shell with an inherited HOME value.
    let locations = NSSearchPathForDirectoriesInDomains(
        NSSearchPathDirectory::ApplicationSupportDirectory,
        NSSearchPathDomainMask::UserDomainMask,
        true,
    );
    let directory = locations
        .firstObject()
        .ok_or_else(|| io::Error::other("アプリの保存場所を取得できません。"))?;
    Ok(PathBuf::from(directory.to_string()).join(identifier))
}

fn prepare_data_dir(
    override_dir: Option<OsString>,
    default_dir: impl FnOnce() -> io::Result<PathBuf>,
) -> io::Result<PathBuf> {
    let directory = match override_dir {
        Some(path) if path.is_empty() => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "TANZAKOO_DATA_DIR に空の保存先は指定できません。",
            ));
        }
        Some(path) => PathBuf::from(path),
        None => default_dir()?,
    };
    // Agents run in a different working directory. Pass absolute paths for their
    // database, workspace and CODEX_HOME, even with a relative development override.
    let directory = std::path::absolute(directory)?;
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(&directory)?;
    Ok(directory)
}

/// Codex stores credentials in this app-owned directory. On Windows inherit the
/// per-user data directory ACL; on Unix also restrict traversal to its owner.
pub fn credential_dir(data: &Path) -> io::Result<PathBuf> {
    let directory = prepare_data_dir(None, || Ok(data.join("agents/codex")))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
    }
    Ok(directory)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::Projects;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            Self(std::env::temp_dir().join(format!(
                "tanzakoo-storage-{name}-{}-{nonce}",
                std::process::id()
            )))
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            if self.0.exists() {
                fs::remove_dir_all(&self.0).unwrap();
            }
        }
    }

    #[test]
    fn state_and_credentials_survive_reopen_in_the_selected_data_root() {
        let fixture = Fixture::new("再起動 空白");
        let dir = prepare_data_dir(None, || Ok(fixture.0.clone())).unwrap();
        let mut projects = Projects::open(dir.clone()).unwrap();
        projects.create("保存確認".into(), "前提".into()).unwrap();
        let store = projects.active_store().unwrap();
        store
            .create_card("論点".into(), "本文".into(), "user")
            .unwrap();
        let home = credential_dir(&dir).unwrap();
        fs::write(home.join("auth.json"), "test credential placeholder").unwrap();
        drop(projects);
        let reopened = Projects::open(prepare_data_dir(None, || Ok(fixture.0.clone())).unwrap())
            .unwrap()
            .snapshot()
            .unwrap();
        assert_eq!(reopened.project.name, "保存確認");
        assert_eq!(reopened.cards[0].body, "本文");
        assert_eq!(
            fs::read_to_string(home.join("auth.json")).unwrap(),
            "test credential placeholder"
        );
        assert!(store.path().is_absolute());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&home).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
    }

    #[test]
    fn explicit_override_does_not_read_or_create_the_default_root() {
        let fixture = Fixture::new("override");
        let dir = prepare_data_dir(Some(fixture.0.clone().into_os_string()), || {
            panic!("an override must not touch the default data directory")
        })
        .unwrap();
        assert!(dir.is_absolute());
        assert!(dir.is_dir());
    }

    #[test]
    fn relative_override_is_absolute_before_agents_change_working_directory() {
        let fixture = Fixture::new("relative");
        // Exercise a relative development root without changing the process-wide
        // cwd used by other tests.
        let cwd = std::env::current_dir().unwrap();
        let relative = PathBuf::from(".local").join(fixture.0.file_name().unwrap());
        let cleanup = Fixture(cwd.join(&relative));
        let dir = prepare_data_dir(Some(relative.into_os_string()), || unreachable!()).unwrap();
        assert!(dir.is_absolute());
        assert_eq!(dir, cleanup.0);
        assert!(credential_dir(&dir).unwrap().is_absolute());
    }

    #[test]
    fn invalid_or_unwritable_locations_fail_without_falling_back() {
        assert!(prepare_data_dir(Some(OsString::new()), || unreachable!()).is_err());
        let fixture = Fixture::new("failure");
        fs::create_dir_all(&fixture.0).unwrap();
        let file = fixture.0.join("not-a-directory");
        fs::write(&file, "keep").unwrap();
        assert!(prepare_data_dir(Some(file.clone().into_os_string()), || unreachable!()).is_err());
        assert_eq!(fs::read_to_string(file).unwrap(), "keep");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn native_application_support_location_is_absolute_and_app_specific() {
        let path = macos_data_dir("dev.huruikagi.tanzakoo").unwrap();
        assert!(path.is_absolute());
        assert!(path.ends_with("Library/Application Support/dev.huruikagi.tanzakoo"));
        // Container placement itself must be tested with a signed sandboxed app.
    }
}
