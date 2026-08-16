/**
 * Masks credential-shaped text in an event label before it is written to disk.
 *
 * The labels an agent produces are its own command lines — `Ran <command>` is
 * the command, verbatim — and in this workflow those routinely carry a key
 * inline. In memory that is exactly right: the user must see what actually
 * ran. On disk it is a plaintext file that outlives the session, so the copy
 * that goes there is masked and the live feed is not.
 *
 * This is pattern matching, so it is a floor and not a guarantee: it masks the
 * shapes listed below and nothing else. JWT bodies, PEM blocks, unmarked
 * base64 and any single-letter flag too generic to tell from an ordinary
 * argument (`-p`, `-k`) all reach the file intact. What it does buy is a
 * history that stays readable — the name survives, only the value goes.
 *
 * False positives are possible in the other direction too and are bounded
 * rather than ruled out: a name is read in segments so `--author` and `monkey`
 * are left alone, and every value stops at a quote so a mask can never take
 * the closing quote with it and break the line. `openssl -key cert.pem` still
 * loses its filename — masking an argument is a cost, not a corruption.
 *
 * Every pattern below is anchored on a literal or a length-bounded prefix and
 * every quantifier has one way to match, so a crafted line cannot stall the
 * store's log flush.
 */

/** Stands in for a masked value. Chosen to be unmistakable in a plain-text history. */
export const REDACTED = '«redacted»';

/**
 * `postgres://user:pw@host` — both halves are credentials, so both go.
 *
 * The scheme is length-bounded, as is the name in {@link ASSIGNMENT}. Neither
 * bound excludes anything real (schemes and variable names are short), and
 * without them a long unbroken run of letters costs a scan to the end of the
 * line at every offset in it — quadratic on exactly the kind of line an agent
 * can be made to print.
 */
const URL_CREDENTIALS = /([A-Za-z][A-Za-z0-9+.-]{0,19}:\/\/)[^\s/:@]+:[^\s/@]*@/g;

/** `Authorization: Bearer <token>`, quoted or bare. */
const BEARER_TOKEN = /\bbearer\s+[\w.~+/=-]+/gi;

/**
 * Any `name=value`; whether the value is a secret is decided by the name.
 *
 * The value stops at a quote as well as at a space. Running it to the next
 * space alone means a masked assignment inside a quoted argument takes the
 * closing quote with it — `node -e "key=1"` loses the `"` and the line stops
 * parsing as what it was.
 */
const ASSIGNMENT = /([A-Za-z][\w-]{0,63})=("[^"]*"|'[^']*'|["']?[^\s"']+)/g;

/** `--token <value>`, `--password <value>` — the flag is kept, the value goes. */
const SECRET_FLAG = /(^|\s)(--?(?:token|password|passwd|secret|api-?key|key))(\s+)(?!-)\S+/gi;

/**
 * `curl -u user:pass`. `-u` is `--user` to curl and `--unique` to sort, so the
 * `user:pass` shape is the only thing that tells a credential from an
 * ordinary argument — matching `-u` alone would mask `sort -u notes.txt`.
 */
const BASIC_AUTH_FLAG = /(^|\s)(-u)(\s+)[^\s:]+:\S+/g;

/**
 * `X-Api-Key: <value>` and friends. The name must be hyphenated (or be
 * `Authorization`) because a bare word before a colon is how prose and log
 * lines read — `Error: token: invalid` is not a header. The value stops at a
 * quote for the same reason as in {@link ASSIGNMENT}.
 */
const HEADER = /(^|["'\s])((?:\w+-)+\w+|authorization)(\s*:\s*)[^\s"']+/gi;

/**
 * A name segment that makes its value a credential.
 *
 * `KEY` and `AUTH` end ordinary English words — `monkey`, `author` — so they
 * only count as a whole segment. The longer words do not end anything that
 * turns up in a command line, so they are also accepted glued to a prefix,
 * which is what keeps `PGPASSWORD` recognised.
 */
const SECRET_SEGMENT = /^(?:key|auth|authorization)$|(?:password|passwd|secret|credential|token)$/i;

/** Splits `X-Api-Key`, `API_KEY` and `apiKey` alike into their words. */
function namesASecret(name: string): boolean {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_.-]+/)
    .some((segment) => SECRET_SEGMENT.test(segment));
}

/**
 * Keys recognisable on their own, with no name next to them. The length floors
 * are well under any real key and well over the everyday words that share a
 * prefix — `sk-cli` must survive.
 */
const STANDALONE_KEY =
  /\b(?:sk-[A-Za-z0-9_-]{16,}|github_pat_\w{20,}|ghp_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{12,})/g;

/**
 * Returns the label with anything credential-shaped replaced by {@link REDACTED}.
 *
 * `Bearer` is handled before assignments so that `Authorization=Bearer abc`
 * loses the token and not just the word in front of it.
 */
export function redactSecrets(label: string): string {
  return label
    .replace(URL_CREDENTIALS, `$1${REDACTED}:${REDACTED}@`)
    .replace(BEARER_TOKEN, REDACTED)
    .replace(HEADER, (match, lead: string, name: string, separator: string) =>
      namesASecret(name) ? `${lead}${name}${separator}${REDACTED}` : match
    )
    .replace(SECRET_FLAG, `$1$2$3${REDACTED}`)
    .replace(BASIC_AUTH_FLAG, `$1$2$3${REDACTED}`)
    .replace(ASSIGNMENT, (match, name: string) =>
      namesASecret(name) ? `${name}=${REDACTED}` : match
    )
    .replace(STANDALONE_KEY, REDACTED);
}
