//! Scoped capability tokens: a way for a process that is not in an authorised
//! caller's process tree to do exactly the named actions on exactly one
//! resource. The contract is `docs/design-capability-tokens.md`, the
//! machine-checkable half `src/lib/agents/capabilityTokens.fixtures.json`.
//!
//! A feature grants a token to a caller it has already authorised (the PID walk
//! says who that is) and checks it later with [`lookup`] + [`Grant::check`]. The
//! module knows no feature: a scope is a `kind`, a `resource_id` and a list of
//! action names, all plain strings the feature defines. Adding a scope needs no
//! change here.
//!
//! - The token is 32 random bytes from the OS, shown once in the answer that
//!   issued it. Only its SHA-256 is stored, so the file never holds a usable
//!   token. [`SecretToken`] never prints itself.
//! - A grant expires on its own; the feature revokes every grant of a resource
//!   when the resource reaches a final state ([`revoke_resource`]). A revoked
//!   grant stays as a tombstone until it would have expired, so its holder hears
//!   `token_revoked` rather than `token_unknown`.

use crate::file_lock::FileLock;
use crate::supervisor::write_json_atomic;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;
use std::io::{ErrorKind, Read};
use std::path::{Path, PathBuf};

pub const STORE_VERSION: u32 = 1;
pub const STORE_FILE_NAME: &str = "capability-tokens.json";
const LOCK_FILE_NAME: &str = "capability-tokens.lock";
pub const TOKEN_PREFIX: &str = "auric_cap_";
const RANDOM_BYTES: usize = 32;
const ENCODED_CHARS: usize = 43;
pub const TTL_MIN_SECONDS: u64 = 60;
pub const TTL_MAX_SECONDS: u64 = 2_592_000;
pub const MAX_PER_RESOURCE: usize = 8;
/// Above `MAX_LIVE` external runs × `MAX_PER_RESOURCE`, so live runs alone
/// cannot fill it.
pub const MAX_GRANTS: usize = 2000;

/// A token as it travels. Serialises as the bare string, because the one answer
/// that issues it must carry it; `Debug` never shows it, so a `{:?}` of a request
/// or an answer cannot put it into a log.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SecretToken(String);

impl SecretToken {
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for SecretToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SecretToken([redacted])")
    }
}

/// The shape alone: prefix, then 43 base64url characters without padding.
pub fn valid_shape(token: &str) -> bool {
    token.strip_prefix(TOKEN_PREFIX).is_some_and(|rest| {
        rest.len() == ENCODED_CHARS
            && rest
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    })
}

fn sha256_hex(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn random_token() -> Result<SecretToken, TokenError> {
    let mut bytes = [0u8; RANDOM_BYTES];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut source| source.read_exact(&mut bytes))
        .map_err(|error| TokenError::Storage(format!("no randomness: {error}")))?;
    let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
    Ok(SecretToken(format!("{TOKEN_PREFIX}{encoded}")))
}

/// One stored grant. Holds the token's hash, never the token.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Grant {
    pub id: String,
    pub sha256: String,
    pub kind: String,
    pub resource_id: String,
    pub actions: Vec<String>,
    /// The run folder of the caller it was issued to, so a feature can tell
    /// whose resource it was granted on.
    pub owner_run_dir: String,
    pub issued_at: u64,
    pub expires_at: u64,
    pub revoked_at: Option<u64>,
}

impl Grant {
    /// Expired first (a tombstone past its time is gone), then revoked, then scope (fixture `authorize`).
    pub fn check(
        &self,
        kind: &str,
        resource_id: &str,
        action: &str,
        now: u64,
    ) -> Result<(), TokenError> {
        if now >= self.expires_at {
            return Err(TokenError::Unknown);
        }
        if self.revoked_at.is_some() {
            return Err(TokenError::Revoked);
        }
        if self.kind != kind
            || self.resource_id != resource_id
            || !self.actions.iter().any(|granted| granted == action)
        {
            return Err(TokenError::Scope);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct TokenFile {
    version: u32,
    grants: Vec<Grant>,
}

impl Default for TokenFile {
    fn default() -> Self {
        Self {
            version: STORE_VERSION,
            grants: Vec::new(),
        }
    }
}

impl TokenFile {
    /// Expired grants go, tombstones included. `true` when anything went.
    fn prune(&mut self, now: u64) -> bool {
        let before = self.grants.len();
        self.grants.retain(|grant| now < grant.expires_at);
        self.grants.len() != before
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum TokenError {
    /// Unknown, malformed or expired: not told apart, on purpose.
    Unknown,
    Revoked,
    /// Valid, but not for this kind, resource or action.
    Scope,
    Limit,
    InvalidTtl,
    Unreadable(String),
    Storage(String),
}

impl TokenError {
    /// The `reason` on a `token_denied` answer; `None` for the errors that are
    /// not about the token.
    pub fn reason(&self) -> Option<&'static str> {
        match self {
            Self::Unknown => Some("token_unknown"),
            Self::Revoked => Some("token_revoked"),
            Self::Scope => Some("token_scope"),
            Self::Limit => Some("token_limit"),
            Self::InvalidTtl | Self::Unreadable(_) | Self::Storage(_) => None,
        }
    }
}

impl fmt::Display for TokenError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unknown => f.write_str("the token is unknown or has expired"),
            Self::Revoked => f.write_str("the token was revoked: its resource has ended"),
            Self::Scope => f.write_str("the token does not allow this action on this resource"),
            Self::Limit => write!(f, "at most {MAX_GRANTS} capability tokens can be stored"),
            Self::InvalidTtl => write!(
                f,
                "a token lives between {TTL_MIN_SECONDS} and {TTL_MAX_SECONDS} seconds"
            ),
            Self::Unreadable(reason) => write!(f, "{STORE_FILE_NAME} cannot be used: {reason}"),
            Self::Storage(reason) => write!(f, "could not write {STORE_FILE_NAME}: {reason}"),
        }
    }
}

pub fn store_path_in(app_data: &Path) -> PathBuf {
    app_data.join(STORE_FILE_NAME)
}

/// Absent is empty. Anything else that cannot be read is refused rather than
/// treated as empty, or the next write would replace it.
fn read(app_data: &Path) -> Result<TokenFile, TokenError> {
    let unreadable = |reason: String| TokenError::Unreadable(reason);
    let text = match std::fs::read_to_string(store_path_in(app_data)) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(TokenFile::default()),
        Err(error) => return Err(unreadable(error.to_string())),
    };
    let file: TokenFile = serde_json::from_str(&text)
        .map_err(|error| unreadable(format!("it is not valid ({error})")))?;
    if file.version != STORE_VERSION {
        return Err(unreadable(format!(
            "this build reads version {STORE_VERSION} only"
        )));
    }
    Ok(file)
}

fn update<T>(
    app_data: &Path,
    now: u64,
    change: impl FnOnce(&mut TokenFile) -> Result<(T, bool), TokenError>,
) -> Result<T, TokenError> {
    let _lock = FileLock::acquire(app_data, LOCK_FILE_NAME)
        .map_err(|error| TokenError::Storage(error.to_string()))?;
    let mut file = read(app_data)?;
    let pruned = file.prune(now);
    let (result, touched) = change(&mut file)?;
    if touched || pruned {
        write_json_atomic(&store_path_in(app_data), &file).map_err(TokenError::Storage)?;
    }
    Ok(result)
}

/// What a feature asks to grant. The caller is authorised already; this module
/// does not decide who may be granted what.
pub struct GrantRequest<'a> {
    pub kind: &'a str,
    pub resource_id: &'a str,
    pub actions: &'a [&'a str],
    pub owner_run_dir: &'a str,
    pub ttl_seconds: u64,
}

/// The token, once, and the grant as stored.
#[derive(Debug)]
pub struct Issued {
    pub token: SecretToken,
    pub grant: Grant,
}

/// Grants a fresh token. A resource keeps at most `MAX_PER_RESOURCE` live
/// grants (the oldest goes); a full store drops its oldest tombstones first and
/// refuses with `Limit` only when every stored grant is live.
pub fn issue(app_data: &Path, request: GrantRequest<'_>, now: u64) -> Result<Issued, TokenError> {
    if !(TTL_MIN_SECONDS..=TTL_MAX_SECONDS).contains(&request.ttl_seconds) {
        return Err(TokenError::InvalidTtl);
    }
    let token = random_token()?;
    let grant = Grant {
        id: format!("cap-{}", &uuid::Uuid::new_v4().simple().to_string()[..12]),
        sha256: sha256_hex(token.expose()),
        kind: request.kind.to_string(),
        resource_id: request.resource_id.to_string(),
        actions: request.actions.iter().map(|a| (*a).to_string()).collect(),
        owner_run_dir: request.owner_run_dir.to_string(),
        issued_at: now,
        expires_at: now + request.ttl_seconds * 1000,
        revoked_at: None,
    };
    let stored = grant.clone();
    update(app_data, now, move |file| {
        let same_resource = |g: &Grant| {
            g.kind == stored.kind && g.resource_id == stored.resource_id && g.revoked_at.is_none()
        };
        while file.grants.iter().filter(|g| same_resource(g)).count() >= MAX_PER_RESOURCE {
            if let Some(oldest) = file.grants.iter().position(same_resource) {
                file.grants.remove(oldest);
            }
        }
        while file.grants.len() >= MAX_GRANTS {
            match file.grants.iter().position(|g| g.revoked_at.is_some()) {
                Some(at) => {
                    file.grants.remove(at);
                }
                None => return Err(TokenError::Limit),
            }
        }
        file.grants.push(stored);
        Ok(((), true))
    })?;
    Ok(Issued { token, grant })
}

/// The grant a token stands for, revoked or not; `Unknown` for a malformed,
/// unknown or expired one. The caller then asks [`Grant::check`] for its scope.
pub fn lookup(app_data: &Path, token: &str, now: u64) -> Result<Grant, TokenError> {
    if !valid_shape(token) {
        return Err(TokenError::Unknown);
    }
    let hash = sha256_hex(token);
    let grant = read(app_data)?
        .grants
        .into_iter()
        .find(|grant| grant.sha256 == hash)
        .ok_or(TokenError::Unknown)?;
    if now >= grant.expires_at {
        return Err(TokenError::Unknown);
    }
    if grant.revoked_at.is_some() {
        return Err(TokenError::Revoked);
    }
    Ok(grant)
}

/// Revokes every live grant on one resource. Answers how many it revoked.
pub fn revoke_resource(
    app_data: &Path,
    kind: &str,
    resource_id: &str,
    now: u64,
) -> Result<usize, TokenError> {
    // Nothing stored is nothing to revoke; no lock file for a feature unused.
    if !store_path_in(app_data).exists() {
        return Ok(0);
    }
    update(app_data, now, |file| {
        let mut revoked = 0;
        for grant in file
            .grants
            .iter_mut()
            .filter(|g| g.kind == kind && g.resource_id == resource_id && g.revoked_at.is_none())
        {
            grant.revoked_at = Some(now);
            revoked += 1;
        }
        Ok((revoked, revoked > 0))
    })
}

#[cfg(test)]
mod tests;
