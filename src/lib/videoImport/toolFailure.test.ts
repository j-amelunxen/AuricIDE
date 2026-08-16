import { describe, expect, it } from 'vitest';
import { parseToolFailure } from './toolFailure';

describe('parseToolFailure', () => {
  it('unpacks the structured failure the backend sends', () => {
    const failure = parseToolFailure(
      JSON.stringify({
        summary: 'The local transcription runtime is incomplete.',
        details: "ModuleNotFoundError: No module named 'librosa.filters'",
        logPath: '/data/runtime/setup.log',
      })
    );
    expect(failure.summary).toBe('The local transcription runtime is incomplete.');
    expect(failure.details).toContain('librosa');
    expect(failure.logPath).toBe('/data/runtime/setup.log');
  });

  /// The invariant this module exists for: whatever arrives, the headline the
  /// user reads is a sentence, never a traceback.
  it('never lets a raw traceback become the summary', () => {
    const traceback = [
      'Traceback (most recent call last):',
      '  File "/opt/tools/cli.py", line 348, in transcribe',
      '  File "/opt/tools/utils.py", line 79, in from_pretrained',
      "ModuleNotFoundError: No module named 'librosa.filters'",
    ].join('\n');
    const failure = parseToolFailure(traceback);
    expect(failure.summary).not.toContain('Traceback');
    expect(failure.summary).not.toContain('File "');
    expect(failure.summary.split('\n')).toHaveLength(1);
    // The output is not thrown away — it moves to where detail belongs.
    expect(failure.details).toContain('librosa');
  });

  it('keeps a plain one-line message as the summary', () => {
    const failure = parseToolFailure('Choose an existing video file');
    expect(failure.summary).toBe('Choose an existing video file');
    expect(failure.details).toBe('');
  });

  it('accepts an Error instance', () => {
    const failure = parseToolFailure(new Error('ffmpeg was not found.'));
    expect(failure.summary).toBe('ffmpeg was not found.');
  });

  it('reports something useful for null, undefined and empty input', () => {
    for (const input of [null, undefined, '', '   ']) {
      const failure = parseToolFailure(input);
      expect(failure.summary.length).toBeGreaterThan(0);
      expect(failure.summary).not.toBe('undefined');
      expect(failure.summary).not.toBe('null');
    }
  });

  it('does not mistake unrelated JSON for a structured failure', () => {
    const failure = parseToolFailure('{"unexpected":"shape"}');
    expect(failure.summary).not.toContain('unexpected');
    expect(failure.details).toContain('unexpected');
  });

  it('trims a very long first line rather than rendering it whole', () => {
    const failure = parseToolFailure(`${'x'.repeat(500)}\nsecond line`);
    expect(failure.summary.length).toBeLessThanOrEqual(200);
    expect(failure.details).toContain('second line');
  });
});
