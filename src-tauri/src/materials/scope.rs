//! Private, read-only Powerbox grants. Bookmark bytes never enter snapshots or MCP.
use crate::{
    model::ReferenceMaterial,
    store::{Result, Store},
};

#[cfg(all(target_os = "macos", feature = "app-sandbox"))]
mod macos {
    use super::*;
    use crate::model::MaterialKind;
    use objc2::{rc::Retained, runtime::Bool};
    use objc2_foundation::{
        NSData, NSString, NSURL, NSURLBookmarkCreationOptions as Creation,
        NSURLBookmarkResolutionOptions as Resolution,
    };
    use serde::{Deserialize, Serialize};

    fn unavailable() -> crate::store::StoreError {
        super::super::invalid(
            "参照資料のアクセス許可を復元できません。参照資料をもう一度選択してください。",
        )
    }

    #[derive(Serialize, Deserialize)]
    pub(crate) struct Bookmark {
        path: String,
        kind: MaterialKind,
        bytes: Vec<u8>,
    }

    pub(crate) fn create(path: &str, kind: &MaterialKind) -> Result<Bookmark> {
        let url = NSURL::fileURLWithPath_isDirectory(
            &NSString::from_str(path),
            *kind == MaterialKind::Folder,
        );
        let data = url
            .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
                Creation::WithSecurityScope | Creation::SecurityScopeAllowOnlyReadAccess,
                None,
                None,
            )
            .map_err(|_| unavailable())?;
        Ok(Bookmark {
            path: path.into(),
            kind: kind.clone(),
            bytes: data.to_vec(),
        })
    }

    pub(crate) struct Scope(Retained<NSURL>);
    impl Drop for Scope {
        fn drop(&mut self) {
            // Balanced with the successful start in restore; URL stays alive throughout access.
            unsafe { self.0.stopAccessingSecurityScopedResource() };
        }
    }

    pub(crate) fn restore(bookmark: Bookmark, material: &ReferenceMaterial) -> Result<Scope> {
        if bookmark.path != material.path
            || bookmark.kind != material.kind
            || bookmark.bytes.is_empty()
        {
            return Err(unavailable());
        }
        let mut stale = Bool::NO;
        // Foundation writes only to the live stack Bool; no UI or volume mounting is permitted.
        let url = unsafe {
            NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
                &NSData::with_bytes(&bookmark.bytes),
                Resolution::WithSecurityScope | Resolution::WithoutUI | Resolution::WithoutMounting,
                None,
                &mut stale,
            )
        }
        .map_err(|_| unavailable())?;
        // Do not silently follow a moved source or broaden access. Native re-selection renews it.
        if stale.as_bool() || url.path().is_none_or(|p| p.to_string() != material.path) {
            return Err(unavailable());
        }
        if !unsafe { url.startAccessingSecurityScopedResource() } {
            return Err(unavailable());
        }
        Ok(Scope(url))
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn invalid_or_mismatched_bookmarks_never_grant_access() {
            let material = ReferenceMaterial {
                id: "test".into(),
                path: "/nonexistent/source.md".into(),
                kind: MaterialKind::File,
            };
            for (path, kind, bytes) in [
                (material.path.clone(), MaterialKind::File, vec![]),
                ("/different.md".into(), MaterialKind::File, vec![1]),
                (material.path.clone(), MaterialKind::Folder, vec![1]),
                (material.path.clone(), MaterialKind::File, vec![1, 2, 3]),
            ] {
                assert!(restore(Bookmark { path, kind, bytes }, &material).is_err());
            }
        }
    }
}

#[cfg(all(target_os = "macos", feature = "app-sandbox"))]
pub(crate) use macos::{Bookmark, Scope, create};

#[cfg(not(all(target_os = "macos", feature = "app-sandbox")))]
pub(crate) struct Scope;

pub(crate) fn acquire(store: &Store, material: &ReferenceMaterial) -> Result<Scope> {
    #[cfg(all(target_os = "macos", feature = "app-sandbox"))]
    {
        macos::restore(store.material_bookmark(&material.id)?, material)
    }
    #[cfg(not(all(target_os = "macos", feature = "app-sandbox")))]
    {
        let _ = (store, material);
        Ok(Scope)
    }
}
