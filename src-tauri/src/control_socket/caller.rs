//! Who is on the other end of a connection. The socket refuses any process
//! that descends from a running IDE agent, whatever provider that agent runs
//! and whatever it did with its environment (`docs/design-agent-control.md`).

use std::collections::HashSet;
use std::os::unix::net::UnixStream;

/// Deeper than any real process tree; a cycle in a stale reading ends here.
pub const MAX_ANCESTORS: usize = 64;

/// Whether `peer` or any of its ancestors is one of `agent_pids`.
pub fn descends_from_agent(
    peer: u32,
    agent_pids: &HashSet<u32>,
    parent_of: impl Fn(u32) -> Option<u32>,
) -> bool {
    let mut pid = peer;
    for _ in 0..MAX_ANCESTORS {
        if agent_pids.contains(&pid) {
            return true;
        }
        match parent_of(pid) {
            Some(parent) if parent > 1 && parent != pid => pid = parent,
            _ => return false,
        }
    }
    false
}

/// The PID of the process that connected, as the kernel recorded it.
#[cfg(target_os = "macos")]
pub fn peer_pid(stream: &UnixStream) -> Option<u32> {
    use std::os::fd::AsRawFd;
    let mut pid: libc::pid_t = 0;
    let mut len = std::mem::size_of::<libc::pid_t>() as libc::socklen_t;
    // SAFETY: `pid` and `len` are valid for writes and `len` states the size
    // of `pid`; the fd belongs to `stream`, which outlives the call.
    let rc = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_LOCAL,
            libc::LOCAL_PEERPID,
            (&mut pid as *mut libc::pid_t).cast(),
            &mut len,
        )
    };
    (rc == 0 && pid > 0).then_some(pid as u32)
}

#[cfg(target_os = "linux")]
pub fn peer_pid(stream: &UnixStream) -> Option<u32> {
    use std::os::fd::AsRawFd;
    let mut cred = libc::ucred {
        pid: 0,
        uid: 0,
        gid: 0,
    };
    let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    // SAFETY: `cred` and `len` are valid for writes and `len` states the size
    // of `cred`; the fd belongs to `stream`, which outlives the call.
    let rc = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&mut cred as *mut libc::ucred).cast(),
            &mut len,
        )
    };
    (rc == 0 && cred.pid > 0).then_some(cred.pid as u32)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn peer_pid(_stream: &UnixStream) -> Option<u32> {
    None
}

#[cfg(target_os = "macos")]
pub fn parent_pid(pid: u32) -> Option<u32> {
    // SAFETY: `proc_bsdinfo` is plain C data; all-zero is a valid value.
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
    // SAFETY: `info` is a zeroed `proc_bsdinfo` of exactly `size` bytes, which
    // is what PROC_PIDTBSDINFO writes.
    let written = unsafe {
        libc::proc_pidinfo(
            pid as libc::c_int,
            libc::PROC_PIDTBSDINFO,
            0,
            (&mut info as *mut libc::proc_bsdinfo).cast(),
            size,
        )
    };
    (written == size).then_some(info.pbi_ppid)
}

#[cfg(target_os = "linux")]
pub fn parent_pid(pid: u32) -> Option<u32> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    // The command name is in parentheses and may contain spaces; the parent
    // is the second field after its closing parenthesis.
    stat.rsplit_once(')')?
        .1
        .split_whitespace()
        .nth(1)?
        .parse()
        .ok()
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn parent_pid(_pid: u32) -> Option<u32> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_descendant_of_an_agent_is_recognised_and_others_are_not() {
        // 50 → 40 → 30 → 1
        let parent = |pid| match pid {
            50 => Some(40),
            40 => Some(30),
            30 => Some(1),
            _ => None,
        };
        let agents: HashSet<u32> = [40].into();
        assert!(descends_from_agent(50, &agents, parent));
        assert!(descends_from_agent(40, &agents, parent), "the agent itself");
        assert!(!descends_from_agent(30, &agents, parent));
        assert!(!descends_from_agent(50, &HashSet::new(), parent));
    }

    #[test]
    fn an_agent_claude_node_chain_is_refused_and_a_terminal_chain_is_not() {
        // IDE 10 ─┬─ agent shell 20 ─ claude 21 ─ node MCP 22
        //         └─ terminal panel shell 30 ─ node client 31
        let parent = |pid| match pid {
            22 => Some(21),
            21 => Some(20),
            20 | 30 => Some(10),
            31 => Some(30),
            10 => Some(1),
            _ => None,
        };
        let agents: HashSet<u32> = [20].into();
        assert!(descends_from_agent(22, &agents, parent));
        assert!(
            !descends_from_agent(31, &agents, parent),
            "the terminal panel is the IDE's child, not an agent's"
        );
    }

    #[test]
    fn the_walk_stops_at_pid_1_and_at_the_depth_cap() {
        let agents: HashSet<u32> = [1].into();
        assert!(
            !descends_from_agent(5, &agents, |_| Some(1)),
            "launchd/init is never followed"
        );

        // A straight chain 1000 → 999 → … with the agent just past the cap.
        let agents: HashSet<u32> = [1000 - MAX_ANCESTORS as u32].into();
        assert!(!descends_from_agent(1000, &agents, |pid| Some(pid - 1)));
        let agents: HashSet<u32> = [1000 - MAX_ANCESTORS as u32 + 1].into();
        assert!(descends_from_agent(1000, &agents, |pid| Some(pid - 1)));
    }

    #[test]
    fn a_real_grandchild_of_an_agent_is_recognised() {
        // `sh` stands in for the agent; `sleep` runs as its child, not exec'd.
        let mut agent = std::process::Command::new("sh")
            .args(["-c", "sleep 5 & wait"])
            .spawn()
            .unwrap();
        let agent_pid = agent.id();
        let child = (0..50).find_map(|_| {
            let out = std::process::Command::new("pgrep")
                .args(["-P", &agent_pid.to_string()])
                .output()
                .ok()?;
            let pid = String::from_utf8_lossy(&out.stdout).trim().parse().ok();
            if pid.is_none() {
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            pid
        });
        let agents: HashSet<u32> = [agent_pid].into();
        let result = child.map(|pid| descends_from_agent(pid, &agents, parent_pid));
        let own = descends_from_agent(std::process::id(), &agents, parent_pid);
        let _ = agent.kill();
        let _ = agent.wait();
        assert_eq!(result, Some(true), "sleep descends from the agent shell");
        assert!(!own, "the test process does not");
    }

    #[test]
    fn a_cycle_in_the_parent_chain_ends() {
        let agents: HashSet<u32> = [99].into();
        assert!(!descends_from_agent(5, &agents, |pid| Some(if pid == 5 {
            6
        } else {
            5
        })));
    }

    #[test]
    fn this_process_reads_its_own_parent() {
        let own = std::process::id();
        let expected = std::os::unix::process::parent_id();
        assert_eq!(parent_pid(own), Some(expected));
    }

    #[test]
    fn the_peer_pid_of_a_socket_pair_is_this_process() {
        let (a, _b) = UnixStream::pair().unwrap();
        assert_eq!(peer_pid(&a), Some(std::process::id()));
    }
}
