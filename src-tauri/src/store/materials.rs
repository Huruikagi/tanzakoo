use super::*;

impl Store {
    #[cfg(all(target_os = "macos", feature = "app-sandbox"))]
    pub(crate) fn material_bookmark(&self, id: &str) -> Result<crate::materials::scope::Bookmark> {
        get(&self.connect()?, "material_access", id).map_err(|_| {
            invalid("参照資料のアクセス許可を復元できません。参照資料をもう一度選択してください。")
        })
    }

    pub fn materials(&self) -> Result<Vec<ReferenceMaterial>> {
        list(&self.connect()?, "material")
    }

    pub fn material(&self, material_id: &str) -> Result<ReferenceMaterial> {
        get(&self.connect()?, "material", material_id)
    }

    /// Only the native picker may grant access. No MCP or arbitrary-path IPC exposes this.
    pub fn add_materials(&self, paths: &[PathBuf], kind: MaterialKind) -> Result<()> {
        let selected = paths
            .iter()
            .map(|path| {
                crate::materials::validate_selection(path, &kind).map_err(StoreError::Invalid)
            })
            .collect::<Result<Vec<_>>>()?;
        let mut db = self.connect()?;
        let tx = db.transaction()?;
        let mut registered: Vec<ReferenceMaterial> = list(&tx, "material")?;
        for path in selected {
            #[cfg(all(target_os = "macos", feature = "app-sandbox"))]
            let bookmark = crate::materials::scope::create(&path, &kind)?;
            if let Some(_existing) = registered.iter().find(|m| m.path == path && m.kind == kind) {
                // Re-selection repairs a missing/stale grant without duplicating the material.
                #[cfg(all(target_os = "macos", feature = "app-sandbox"))]
                put(&tx, "material_access", &_existing.id, &bookmark)?;
                continue;
            }
            if registered.len() >= 32 {
                return Err(invalid("参照資料は32件まで登録できます。"));
            }
            let material = ReferenceMaterial {
                id: id(&tx)?,
                path,
                kind: kind.clone(),
            };
            put(&tx, "material", &material.id, &material)?;
            #[cfg(all(target_os = "macos", feature = "app-sandbox"))]
            put(&tx, "material_access", &material.id, &bookmark)?;
            registered.push(material);
        }
        tx.commit()?;
        Ok(())
    }

    pub fn remove_material(&self, material_id: &str) -> Result<()> {
        self.connect()?.execute(
            "DELETE FROM records WHERE kind IN ('material', 'material_access') AND id=?1",
            [material_id],
        )?;
        Ok(())
    }
}
