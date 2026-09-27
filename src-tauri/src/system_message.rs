use serde::Serialize;

/// Stable identifiers for native diagnostics shown by the UI. The fallback lets
/// the current frontend display unknown codes, including saved error turns.
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Code {
    StorageAccess,
    StorageWrite,
    StorageRead,
    ExportOpen,
    ExportCreate,
    ExportWrite,
    ExportPartial,
    ModelOptions,
    AgentConnection,
    ProjectCleanup,
}

#[derive(Serialize)]
struct Payload<'a> {
    code: Code,
    args: Args<'a>,
    fallback: &'a str,
}

#[derive(Default, Serialize)]
struct Args<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<&'a str>,
}

const PREFIX: &str = "@tanzakoo/system:";

pub fn detail(code: Code, detail: &str, fallback: &str) -> String {
    encode(Payload {
        code,
        args: Args {
            detail: Some(detail),
            ..Args::default()
        },
        fallback,
    })
}

pub fn partial_export(detail: &str, path: &str, fallback: &str) -> String {
    encode(Payload {
        code: Code::ExportPartial,
        args: Args {
            detail: Some(detail),
            path: Some(path),
        },
        fallback,
    })
}

fn encode(payload: Payload<'_>) -> String {
    format!(
        "{PREFIX}{}",
        serde_json::to_string(&payload).expect("system message is serializable")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_detail_and_path_without_parsing_the_fallback() {
        let value = partial_export("disk: 日本語", "G:\\保存先\\a", "元の文面");
        let payload: serde_json::Value =
            serde_json::from_str(value.strip_prefix(PREFIX).unwrap()).unwrap();
        assert_eq!(payload["code"], "export_partial");
        assert_eq!(payload["args"]["detail"], "disk: 日本語");
        assert_eq!(payload["args"]["path"], "G:\\保存先\\a");
        assert_eq!(payload["fallback"], "元の文面");
    }
}
