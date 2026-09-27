//! Fixed, offline verification shipped only in the separate Sandbox experiment.
//! Launch through the signed parent, never through an unsandboxed shell's Node.
use std::{fs, io, process::Command};

pub fn denied(path: &str) -> io::Result<()> {
    match fs::read(path) {
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => Ok(()),
        _ => Err(io::Error::other(
            "Sandbox must deny the existing external canary",
        )),
    }
}

pub fn run(canary: &str) -> io::Result<()> {
    denied(canary)?;
    let context = crate::context();
    let data = crate::storage::macos_data_dir(&context.config().identifier)?;
    fs::create_dir_all(&data)?;
    let executable = std::env::current_exe()?;
    let contents = executable
        .parent()
        .and_then(|p| p.parent())
        .ok_or_else(|| io::Error::other("Missing bundle"))?;
    let resources = contents.join("Resources");
    let runtime = resources.join("agent-runtime");
    let node = runtime.join("bin/node");
    let checks = resources.join("sandbox-check");
    let work = data.join(format!("sandbox-check-{}", std::process::id()));
    fs::create_dir(&work)?;
    let run = || -> io::Result<()> {
        for (script, args) in [
            ("check-packaged-runtime.mjs", vec![runtime.clone()]),
            (
                "sandbox-board-check.mjs",
                vec![
                    runtime.clone(),
                    contents.join("MacOS/tanzakoo-mcp"),
                    canary.into(),
                ],
            ),
        ] {
            let status = Command::new(&node)
                .arg(checks.join(script))
                .args(args)
                .current_dir(&work)
                .env_clear()
                .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
                .env("HOME", &work)
                .env("TMPDIR", &work)
                .status()?;
            if !status.success() {
                return Err(io::Error::other(format!("{script}: {status}")));
            }
        }
        Ok(())
    };
    let result = run();
    fs::remove_dir_all(&work)?;
    result
}
