//! Windows process-tree ownership shared by managed ACP and the external relay.
use std::{
    io,
    os::windows::io::{AsRawHandle, BorrowedHandle, FromRawHandle, OwnedHandle},
    time::{Duration, Instant},
};
use windows::Win32::{
    Foundation::{ERROR_INVALID_PARAMETER, ERROR_MORE_DATA, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT},
    System::{
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_BASIC_PROCESS_ID_LIST,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectBasicAccountingInformation,
            JobObjectBasicProcessIdList, JobObjectExtendedLimitInformation,
            QueryInformationJobObject, SetInformationJobObject, TerminateJobObject,
        },
        Threading::{OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject},
    },
};

pub(crate) struct ProcessJob {
    handle: OwnedHandle,
    root: Option<OwnedHandle>,
    stopped: bool,
}

impl ProcessJob {
    pub(crate) fn new() -> windows::core::Result<Self> {
        unsafe {
            let job = Self {
                handle: OwnedHandle::from_raw_handle(CreateJobObjectW(None, None)?.0),
                root: None,
                stopped: false,
            };
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                job.raw(),
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of_val(&limits) as u32,
            )?;
            Ok(job)
        }
    }

    fn raw(&self) -> HANDLE {
        HANDLE(self.handle.as_raw_handle())
    }

    pub(crate) fn assign(&self, process: HANDLE) -> windows::core::Result<()> {
        unsafe { AssignProcessToJobObject(self.raw(), process) }
    }

    pub(crate) fn assign_child(&mut self, child: &impl AsRawHandle) -> io::Result<()> {
        // Duplicate the spawned child's handle, never reopen by a possibly reused PID.
        // The borrowed handle is valid for the lifetime of this child reference.
        let process =
            unsafe { BorrowedHandle::borrow_raw(child.as_raw_handle()) }.try_clone_to_owned()?;
        self.assign(HANDLE(process.as_raw_handle()))
            .map_err(io::Error::other)?;
        self.root = Some(process);
        Ok(())
    }

    pub(crate) fn stop(&mut self) -> io::Result<()> {
        if self.stopped {
            return Ok(());
        }
        // ActiveProcesses can reach zero before the process objects become
        // signalled. Capture handles before termination so we can wait for the
        // actual exit (and pending I/O), rather than only the accounting count.
        let deadline = Instant::now() + Duration::from_secs(5);
        let members = self.members(deadline);
        unsafe { TerminateJobObject(self.raw(), 1) }.map_err(io::Error::other)?;
        let mut members = members?;
        // A direct child may have left the job's PID list while its process
        // object is still finishing exit. Retain its original handle at startup.
        if let Some(root) = &self.root {
            members.push(root.try_clone()?);
        }
        for process in members {
            let remaining = deadline
                .saturating_duration_since(Instant::now())
                .as_millis() as u32;
            match unsafe { WaitForSingleObject(HANDLE(process.as_raw_handle()), remaining) } {
                WAIT_OBJECT_0 => {}
                WAIT_TIMEOUT => {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "ACP process did not finish exiting",
                    ));
                }
                _ => return Err(io::Error::last_os_error()),
            }
        }
        loop {
            let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
            unsafe {
                QueryInformationJobObject(
                    Some(self.raw()),
                    JobObjectBasicAccountingInformation,
                    &mut info as *mut _ as *mut _,
                    std::mem::size_of_val(&info) as u32,
                    None,
                )
            }
            .map_err(io::Error::other)?;
            if info.ActiveProcesses == 0 {
                self.stopped = true;
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    format!(
                        "ACP job still has {} active processes after shutdown",
                        info.ActiveProcesses
                    ),
                ));
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn members(&self, deadline: Instant) -> io::Result<Vec<OwnedHandle>> {
        // The Windows structure ends in a variable-length pointer-sized array.
        // Allocate with usize alignment and grow if the tree changes during query.
        let mut capacity = 32;
        loop {
            let mut storage = vec![0usize; capacity + 2];
            let result = unsafe {
                QueryInformationJobObject(
                    Some(self.raw()),
                    JobObjectBasicProcessIdList,
                    storage.as_mut_ptr().cast(),
                    std::mem::size_of_val(storage.as_slice()) as u32,
                    None,
                )
            };
            match result {
                Ok(()) => {
                    let list =
                        unsafe { &*storage.as_ptr().cast::<JOBOBJECT_BASIC_PROCESS_ID_LIST>() };
                    let ids = unsafe {
                        std::slice::from_raw_parts(
                            storage
                                .as_ptr()
                                .byte_add(std::mem::offset_of!(
                                    JOBOBJECT_BASIC_PROCESS_ID_LIST,
                                    ProcessIdList
                                ))
                                .cast::<usize>(),
                            list.NumberOfProcessIdsInList as usize,
                        )
                    };
                    let mut handles = Vec::new();
                    for pid in ids {
                        match unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, *pid as u32) } {
                            Ok(handle) => {
                                handles.push(unsafe { OwnedHandle::from_raw_handle(handle.0) })
                            }
                            // A member can finish exiting between query and open.
                            Err(error) if error.code() == ERROR_INVALID_PARAMETER.to_hresult() => {}
                            Err(error) => return Err(io::Error::other(error)),
                        }
                    }
                    return Ok(handles);
                }
                Err(error)
                    if error.code() == ERROR_MORE_DATA.to_hresult()
                        && Instant::now() < deadline
                        && capacity < 65536 =>
                {
                    capacity *= 2
                }
                Err(error) => return Err(io::Error::other(error)),
            }
        }
    }
}

impl Drop for ProcessJob {
    fn drop(&mut self) {
        if let Err(error) = self.stop() {
            // Dropping the last handle still requests termination. Do not hide
            // a failure to observe exit when a connection is being cancelled.
            eprintln!("ACP process cleanup failed: {error}");
        }
    }
}
