//! A bounded libproc snapshot; argv is inspected only for agent descendants.
use super::Process;
use crate::agents::AgentRole;
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

const MAX_PIDS: usize = 32768;
const MAX_ARGS: usize = 64 * 1024;
const BUDGET: Duration = Duration::from_millis(100);

pub(super) fn snapshot(roots: &HashMap<u32, (String, AgentRole)>) -> Option<HashMap<u32, Process>> {
    let started = Instant::now();
    let mut pids = vec![0 as libc::pid_t; MAX_PIDS];
    // SAFETY: the vector owns buffersize writable bytes of pid_t storage.
    let count = unsafe {
        libc::proc_listallpids(
            pids.as_mut_ptr().cast(),
            std::mem::size_of_val(pids.as_slice()) as i32,
        )
    };
    if count <= 0 || count as usize >= MAX_PIDS {
        return None;
    }
    let mut processes = HashMap::new();
    for &pid in &pids[..count as usize] {
        if started.elapsed() >= BUDGET {
            return None;
        }
        // SAFETY: proc_bsdinfo is plain C data and zero is valid for every field.
        let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
        let size = std::mem::size_of_val(&info) as i32;
        // SAFETY: info is valid for the exact number of bytes passed to libproc.
        let written = unsafe {
            libc::proc_pidinfo(
                pid,
                libc::PROC_PIDTBSDINFO,
                0,
                (&mut info as *mut libc::proc_bsdinfo).cast(),
                size,
            )
        };
        if written != size || info.pbi_status == 5 {
            // Darwin SZOMB: an exited child isn't activity.
            continue;
        }
        let name = info
            .pbi_name
            .iter()
            .take_while(|&&ch| ch != 0)
            .map(|&ch| ch as u8)
            .collect::<Vec<_>>();
        processes.insert(
            pid as u32,
            Process {
                parent: info.pbi_ppid,
                command: String::from_utf8_lossy(&name).into_owned(),
            },
        );
    }
    // Fetch arguments only inside the relevant trees, never system-wide argv.
    let relevant = processes
        .keys()
        .copied()
        .filter(|pid| {
            let mut parent = *pid;
            let mut seen = HashSet::new();
            while seen.insert(parent) {
                if started.elapsed() >= BUDGET {
                    return false;
                }
                if roots.contains_key(&parent) {
                    return !roots.contains_key(pid);
                }
                let Some(process) = processes.get(&parent) else {
                    break;
                };
                parent = process.parent;
            }
            false
        })
        .collect::<Vec<_>>();
    for pid in relevant {
        if started.elapsed() >= BUDGET {
            return None;
        }
        // A vanished/unreadable descendant or oversized argv makes this poll
        // uncertain; do not turn missing process evidence into a false stall.
        let command = command(pid)?;
        if let Some(process) = processes.get_mut(&pid) {
            process.command = command;
        }
    }
    (started.elapsed() < BUDGET).then_some(processes)
}

fn command(pid: u32) -> Option<String> {
    let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid as i32];
    let mut bytes = vec![0u8; MAX_ARGS];
    let mut size = bytes.len();
    // SAFETY: mib and bytes are live buffers of the stated lengths; size is writable.
    let rc = unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            mib.len() as u32,
            bytes.as_mut_ptr().cast(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    if rc != 0 || size > bytes.len() {
        return None;
    }
    argv(&bytes[..size])
}

fn argv(bytes: &[u8]) -> Option<String> {
    let argc = i32::from_ne_bytes(bytes.get(..4)?.try_into().ok()?);
    if !(1..=4096).contains(&argc) {
        return None;
    }
    let bytes = bytes.get(4..)?;
    let executable_end = bytes.iter().position(|&b| b == 0)?;
    let args = bytes.get(executable_end..)?.iter().position(|&b| b != 0)? + executable_end;
    Some(
        bytes[args..]
            .split(|&b| b == 0)
            .take(argc as usize)
            .map(String::from_utf8_lossy)
            .collect::<Vec<_>>()
            .join(" "),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn procargs_excludes_executable_padding_and_environment() {
        let mut bytes = 3i32.to_ne_bytes().to_vec();
        bytes.extend_from_slice(b"/bin/node\0\0\0node\0vitest\0run\0SECRET=value\0");
        assert_eq!(argv(&bytes).as_deref(), Some("node vitest run"));
        assert!(argv(&[]).is_none());
    }
}
