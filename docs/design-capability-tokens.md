# Scoped capability tokens

The control socket decides who a caller is from the kernel: it walks the peer
process's parents and finds the nearest IDE agent (`docs/design-agent-control.md`).
That is the right default, and it has one gap. A process that acts _for_ a
supervisor but is not in its process tree — a detached reaper, a timeout handler, a
job runner on a box pool — has no agent ancestor and reads as an outside client.

A capability token closes that gap for one named thing at a time. A feature hands
one to a caller it has already authorised, and later accepts it from whoever holds
it, for exactly the actions and the one resource it was issued on.

The machine-checkable half of this contract is
`src/lib/agents/capabilityTokens.fixtures.json`, read by Rust and TypeScript.
**Change the fixtures first.** The code is `src-tauri/src/capability_tokens/`.

## The model

A **grant** is stored, a **token** is handed out.

| Grant field   | Meaning                                                              |
| ------------- | -------------------------------------------------------------------- |
| `id`          | `cap-…`, for the audit of the store only                             |
| `sha256`      | SHA-256 of the whole token string, hex. The token itself is not kept |
| `kind`        | The kind of resource, a string the feature defines (`external_run`)  |
| `resourceId`  | The one resource (`ext-1a2b3c4d`)                                    |
| `actions`     | The action names it allows (`["external_stop"]`)                     |
| `ownerRunDir` | The run folder of the caller it was issued to                        |
| `issuedAt`    | Unix ms                                                              |
| `expiresAt`   | Unix ms; at or after it the token is unknown                         |
| `revokedAt`   | Unix ms or `null`; set when the resource reached a final state       |

The token is `auric_cap_` followed by 32 random bytes from `/dev/urandom` in
base64url without padding (43 characters, fixture `token.pattern`). The prefix
makes a leaked token recognisable to a secret scanner.

**Checking** is two steps, so a feature that must first find the resource can do
that in between: `lookup(token)` answers the grant (or `token_unknown`,
`token_revoked`), and `Grant::check(kind, resourceId, action)` answers
`token_scope` for anything else it was not issued on. The order is fixed
(fixture `authorize`): expired, then revoked, then scope. Malformed, unknown and
expired tokens all read `token_unknown`, on purpose.

**Adding a scope** needs no change in this module: the feature defines its
`kind` and action names, calls `issue` where it has authorised the caller, and
`lookup` + `check` where it accepts the token. List the scope in the fixture's
`scopes` block.

## Storage

`<app_data_dir>/capability-tokens.json`, Rust-owned, mode 0600, version 1, written
through a temp file and a rename under a file lock (`capability-tokens.lock`), the
same pattern as `external-agents.json`. An unreadable file or an unknown version is
never overwritten.

Bounds (fixture `limits`): a lifetime between 60 seconds and 30 days; at most 8
live grants per resource (issuing a ninth drops the oldest); at most 2000 grants in
all, above 200 live external runs × 8 (revoked tombstones go first; when every stored grant is live, issuing answers
`token_limit`). Expired grants, tombstones included, are pruned on every write.

## Revocation

- **Expiry**, always.
- **The resource reaches a final state.** The feature calls
  `revoke_resource(kind, resourceId)`; every live grant on it gets `revokedAt`. The
  tombstone stays until its expiry, so the holder hears `token_revoked` ("it is
  over") rather than `token_unknown`.
- Revocation is the second write after the feature's own. If it fails, the
  feature's own rule must still refuse the token past a final state; for external
  runs a non-forcing stop of a final run changes nothing, and a token can never
  force.

## Never logged

"Shown once" means the IDE answers it once and keeps no copy. The answer itself
goes where the caller's answers go: for a supervisor that is its CLI transcript
and its model provider. Treat a token like any short-lived secret.

- `SecretToken`'s `Debug` prints `SecretToken([redacted])`, so a `{:?}` of a request
  or an answer cannot put it in a log. No error message names a token.
- The token is in exactly one answer: the one that issued it. The socket writes no
  request log.
- What the holder does with it is the holder's business: pass it through the
  environment or a pipe, not a command line (`ps` shows those) and not a file other
  users can read.

## Who may use one

Any caller the control socket admits as **external** or **supervisor**. A worker
agent is still refused at admission for everything but `raise_question`: a token
does not let an agent steer anything. The supervisor link has no route to a
token-accepting method.

## Errors

`token_denied` with `reason` (fixture `error.reasons`):

| Reason          | Meaning                                                    |
| --------------- | ---------------------------------------------------------- |
| `token_unknown` | Unknown, malformed or expired                              |
| `token_revoked` | The resource reached a final state                         |
| `token_scope`   | Valid, but not for this action or this resource            |
| `token_limit`   | No token could be issued; the store is full of live grants |

A token that does not even have the token shape is refused earlier, as
`invalid_params`, by the method's parameter check.

## Scopes in use

| Kind           | Actions         | Issued by           | Default life | Revoked when                 |
| -------------- | --------------- | ------------------- | ------------ | ---------------------------- |
| `external_run` | `external_stop` | `external_register` | 72 h         | the run is stopped or failed |

`docs/design-external-agents.md` ("Tokens") has the details of the first scope.
