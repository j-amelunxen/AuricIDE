import { describe, expect, it } from 'vitest';

import { REDACTED, redactSecrets } from './redact';

/**
 * A key-shaped fixture built at runtime rather than written as a literal, so
 * the source text never contains a string that reads as a real credential —
 * only `redactSecrets` ever sees the assembled value.
 */
function fakeKey(prefix: string, digits: number): string {
  return `${prefix}${'0'.repeat(digits)}`;
}

describe('redactSecrets — assignments that name a secret', () => {
  it('masks the value but keeps the key, so the command still reads as itself', () => {
    expect(redactSecrets(`Ran ANTHROPIC_API_KEY=${fakeKey('sk-ant-', 20)} pnpm test`)).toBe(
      `Ran ANTHROPIC_API_KEY=${REDACTED} pnpm test`
    );
  });

  it('masks every assignment on the line, not just the first', () => {
    expect(redactSecrets('Ran API_TOKEN=aaaaaaaaaaaa DB_PASSWORD=bbbbbbbbbbbb ./deploy')).toBe(
      `Ran API_TOKEN=${REDACTED} DB_PASSWORD=${REDACTED} ./deploy`
    );
  });

  it('recognises the secret word anywhere in the key name', () => {
    expect(redactSecrets('Ran export SECRET_FOR_CI=abcdef')).toBe(
      `Ran export SECRET_FOR_CI=${REDACTED}`
    );
  });

  it('masks a quoted value whole rather than up to its first space', () => {
    expect(redactSecrets('Ran PASSWORD="two words here" ./login')).toBe(
      `Ran PASSWORD=${REDACTED} ./login`
    );
    expect(redactSecrets("Ran PASSWD='two words here' ./login")).toBe(
      `Ran PASSWD=${REDACTED} ./login`
    );
  });

  it('masks a flag spelled as --token=…', () => {
    expect(redactSecrets(`Ran gh auth login --token=${fakeKey('ghp_', 20)}`)).toBe(
      `Ran gh auth login --token=${REDACTED}`
    );
  });

  it('leaves an assignment whose key names nothing secret alone', () => {
    expect(redactSecrets('Ran NODE_ENV=production pnpm build')).toBe(
      'Ran NODE_ENV=production pnpm build'
    );
  });

  it('reads the name in segments, so a word merely containing one is not a secret', () => {
    // `--author` is a real git flag and `monkey` is a real variable name. A
    // substring test fires on both and shreds an ordinary command.
    expect(redactSecrets('Ran git commit --author=maintainer')).toBe(
      'Ran git commit --author=maintainer'
    );
    expect(redactSecrets('Ran node -e "monkey=1"')).toBe('Ran node -e "monkey=1"');
  });

  it('still reads a name glued to a prefix, as long as it ends in the word', () => {
    // `PGPASSWORD` is one segment and a real credential; the segment rule has
    // to keep it without also accepting `monkey`.
    expect(redactSecrets('Ran PGPASSWORD=hunter2 psql -h db.example.invalid')).toBe(
      `Ran PGPASSWORD=${REDACTED} psql -h db.example.invalid`
    );
  });

  it('never swallows the quote that closes the value', () => {
    // The value ran to the next space, so a masked assignment inside a quoted
    // argument took the closing quote with it and broke the line's structure.
    expect(redactSecrets('Ran node -e "key=1"')).toBe(`Ran node -e "key=${REDACTED}"`);
  });
});

describe('redactSecrets — secrets passed as a flag value', () => {
  it('masks the value after a credential flag and keeps the flag', () => {
    expect(redactSecrets('Ran deploy --token abcdef0123456789')).toBe(
      `Ran deploy --token ${REDACTED}`
    );
    expect(redactSecrets('Ran psql --password hunter2 -h db.example.invalid')).toBe(
      `Ran psql --password ${REDACTED} -h db.example.invalid`
    );
  });

  it('masks a curl -u pair, which is a user and a password', () => {
    expect(redactSecrets('Ran curl -u alice:hunter2 https://api.example.invalid')).toBe(
      `Ran curl -u ${REDACTED} https://api.example.invalid`
    );
  });

  it('leaves -u alone when what follows is an argument and not a pair', () => {
    // `-u` is `--unique` to sort and `--user` to curl. Only the `user:pass`
    // shape tells them apart, so only that shape is masked.
    expect(redactSecrets('Ran sort -u notes.txt')).toBe('Ran sort -u notes.txt');
  });

  it('does not mask the next flag when the credential flag has no value', () => {
    expect(redactSecrets('Ran deploy --token --verbose')).toBe('Ran deploy --token --verbose');
  });
});

describe('redactSecrets — secrets passed as a header', () => {
  it('masks the value of a key header without eating the closing quote', () => {
    expect(redactSecrets('Ran curl -H "X-Api-Key: abcdef0123456789" /v1/me')).toBe(
      `Ran curl -H "X-Api-Key: ${REDACTED}" /v1/me`
    );
  });

  it('masks other spellings of a credential header', () => {
    expect(redactSecrets('Ran curl -H "X-Auth-Token: abcdef0123456789"')).toBe(
      `Ran curl -H "X-Auth-Token: ${REDACTED}"`
    );
  });

  it('leaves an ordinary header alone', () => {
    expect(redactSecrets('Ran curl -H "Content-Type: application/json" /v1/me')).toBe(
      'Ran curl -H "Content-Type: application/json" /v1/me'
    );
  });

  it('reads the header name in segments too', () => {
    expect(redactSecrets('Ran curl -H "X-Monkey-Header: banana"')).toBe(
      'Ran curl -H "X-Monkey-Header: banana"'
    );
  });

  it('leaves a bare word before a colon alone, because prose is full of them', () => {
    // Error labels are log lines, and a log line is mostly colons.
    expect(redactSecrets('Error: token: invalid or expired')).toBe(
      'Error: token: invalid or expired'
    );
  });
});

describe('redactSecrets — bearer tokens', () => {
  it('masks the token after Bearer', () => {
    expect(redactSecrets('Ran curl -H "Authorization: Bearer abc123.def-456_ghi" /v1/me')).toBe(
      `Ran curl -H "Authorization: ${REDACTED}" /v1/me`
    );
  });

  it('masks it unquoted and case-insensitively', () => {
    expect(redactSecrets('Ran curl -H Authorization: bearer abc123def456')).toBe(
      `Ran curl -H Authorization: ${REDACTED}`
    );
  });

  it('leaves the word Bearer alone when no token follows it', () => {
    expect(redactSecrets('Edited src/auth/bearer.ts')).toBe('Edited src/auth/bearer.ts');
  });
});

describe('redactSecrets — standalone key shapes', () => {
  it.each([
    ['sk-…', fakeKey('sk-', 24)],
    ['sk-ant-…', fakeKey('sk-ant-', 20)],
    ['ghp_…', fakeKey('ghp_', 20)],
    ['github_pat_…', fakeKey('github_pat_', 24)],
    ['AKIA…', fakeKey('AKIA', 16)],
  ])('masks a %s-shaped key wherever it appears', (_shape, key) => {
    expect(redactSecrets(`Ran ./seed --with ${key}`)).toBe(`Ran ./seed --with ${REDACTED}`);
  });

  it('does not mask short lookalikes that carry no key', () => {
    // Too short to be a key, and shredding an ordinary command is a real cost.
    expect(redactSecrets('Ran sk-cli --help')).toBe('Ran sk-cli --help');
  });
});

describe('redactSecrets — credentials in a URL', () => {
  it('masks both the user and the password', () => {
    expect(redactSecrets('Ran psql postgres://admin:hunter2@db.example.invalid/app')).toBe(
      `Ran psql postgres://${REDACTED}:${REDACTED}@db.example.invalid/app`
    );
  });

  it('masks an empty password too, since the user name is still a credential', () => {
    expect(redactSecrets('Ran psql postgres://admin:@db.example.invalid/app')).toBe(
      `Ran psql postgres://${REDACTED}:${REDACTED}@db.example.invalid/app`
    );
  });

  it('leaves a URL without credentials untouched', () => {
    expect(redactSecrets('Fetched https://docs.example.invalid/guide?q=1')).toBe(
      'Fetched https://docs.example.invalid/guide?q=1'
    );
  });

  it('leaves a host:port URL untouched', () => {
    expect(redactSecrets('Ran curl http://localhost:41873/health')).toBe(
      'Ran curl http://localhost:41873/health'
    );
  });
});

describe('redactSecrets — ordinary text stays readable', () => {
  it.each([
    'Ran pnpm test:run src/lib/auth/token.test.ts',
    'Edited src/auth/token.ts',
    'Read docs/api-key-rotation.md',
    'Noted the key insight is that the token expires',
    'Permission requested: Bash(pnpm lint)',
    'Ran git commit --author=maintainer',
    'Ran node -e "monkey=1"',
    'Ran openssl req -subj /CN=localhost',
    '',
  ])('leaves %j exactly as it was', (line) => {
    expect(redactSecrets(line)).toBe(line);
  });
});

describe('redactSecrets — hostile input', () => {
  it('stays fast on a long line built to make a backtracking matcher hang', () => {
    // Agent output is untrusted by nature; a redactor that can be stalled by a
    // crafted line would stall the store's log flush with it.
    const hostile = `Ran ${'A'.repeat(20_000)}=${'b'.repeat(20_000)} ${'x:'.repeat(10_000)}`;
    const started = performance.now();
    redactSecrets(hostile);

    expect(performance.now() - started).toBeLessThan(200);
  });

  it('stays fast on a long hyphen chain, which is what the header name matches', () => {
    // `(?:\w+-)+` is the one nested quantifier here. It is safe because `\w`
    // excludes `-`, so each segment has exactly one way to match — but that is
    // a property worth holding onto rather than rediscovering.
    const hostile = `Ran ${'a-'.repeat(20_000)}z: v`;
    const started = performance.now();
    redactSecrets(hostile);

    expect(performance.now() - started).toBeLessThan(200);
  });

  it('masks a secret that is the entire label', () => {
    expect(redactSecrets(fakeKey('sk-ant-', 20))).toBe(REDACTED);
  });
});
