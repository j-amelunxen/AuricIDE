export interface WordSpan {
  text: string;
  changed: boolean;
}

const TOKEN_RE = /(\s+|[^\w\s]+|\w+)/g;

function tokenize(line: string): string[] {
  return line.match(TOKEN_RE) ?? [];
}

function lcsKeepMasks(a: string[], b: string[]): { keepA: boolean[]; keepB: boolean[] } {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const keepA = Array<boolean>(n).fill(false);
  const keepB = Array<boolean>(m).fill(false);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      keepA[i - 1] = true;
      keepB[j - 1] = true;
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return { keepA, keepB };
}

export function wordDiff(
  oldLine: string,
  newLine: string
): { left: WordSpan[]; right: WordSpan[] } {
  const oldTokens = tokenize(oldLine);
  const newTokens = tokenize(newLine);
  const { keepA, keepB } = lcsKeepMasks(oldTokens, newTokens);
  return {
    left: oldTokens.map((text, idx) => ({ text, changed: !keepA[idx] })),
    right: newTokens.map((text, idx) => ({ text, changed: !keepB[idx] })),
  };
}
