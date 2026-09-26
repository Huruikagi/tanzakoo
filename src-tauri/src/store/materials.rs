use super::*;

impl Store {
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
            if registered.iter().any(|m| m.path == path && m.kind == kind) {
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
            registered.push(material);
        }
        tx.commit()?;
        Ok(())
    }

    pub fn remove_material(&self, material_id: &str) -> Result<()> {
        self.connect()?.execute(
            "DELETE FROM records WHERE kind='material' AND id=?1",
            [material_id],
        )?;
        Ok(())
    }
}
