/// Incremental UTF-8 decoder for PTY byte streams.
///
/// PTY reads arrive in arbitrary-sized chunks that can split a multi-byte
/// UTF-8 sequence (umlauts, box-drawing characters, spinners) across two
/// reads. Decoding each chunk independently with `from_utf8_lossy` turns the
/// split character into U+FFFD replacement characters, which shifts every
/// following cell in the terminal row and corrupts TUI redraws. This decoder
/// holds back a trailing incomplete sequence until the next chunk completes
/// it, so the decoded stream is byte-for-byte equivalent to decoding the
/// concatenated input.
pub struct Utf8StreamDecoder {
    pending: Vec<u8>,
}

impl Utf8StreamDecoder {
    pub fn new() -> Self {
        Self {
            pending: Vec::new(),
        }
    }

    /// Decode the next chunk, returning all complete UTF-8 text. Trailing
    /// bytes of an incomplete sequence are retained for the next call.
    /// Genuinely invalid bytes become U+FFFD, like `from_utf8_lossy`.
    pub fn push(&mut self, chunk: &[u8]) -> String {
        self.pending.extend_from_slice(chunk);
        let mut out = String::new();

        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(s) => {
                    out.push_str(s);
                    self.pending.clear();
                    break;
                }
                Err(e) => {
                    let valid_up_to = e.valid_up_to();
                    if valid_up_to > 0 {
                        // Safety: valid_up_to is guaranteed valid by from_utf8
                        out.push_str(unsafe {
                            std::str::from_utf8_unchecked(&self.pending[..valid_up_to])
                        });
                        self.pending.drain(..valid_up_to);
                    }
                    match e.error_len() {
                        // Incomplete sequence at the end — wait for more bytes.
                        None => break,
                        // Genuinely invalid bytes — replace and continue.
                        Some(len) => {
                            out.push('\u{FFFD}');
                            self.pending.drain(..len);
                        }
                    }
                }
            }
        }

        out
    }

    /// Flush any retained incomplete bytes as U+FFFD (stream ended mid-sequence).
    pub fn finish(&mut self) -> String {
        if self.pending.is_empty() {
            String::new()
        } else {
            self.pending.clear();
            "\u{FFFD}".to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Decode `bytes` split at every possible boundary into two chunks and
    /// assert the result always equals decoding it in one piece.
    fn assert_all_two_chunk_splits_lossless(bytes: &[u8], expected: &str) {
        for split in 0..=bytes.len() {
            let mut dec = Utf8StreamDecoder::new();
            let mut out = String::new();
            out.push_str(&dec.push(&bytes[..split]));
            out.push_str(&dec.push(&bytes[split..]));
            out.push_str(&dec.finish());
            assert_eq!(
                out, expected,
                "split at byte {split} of {bytes:?} corrupted the stream"
            );
        }
    }

    #[test]
    fn ascii_passes_through_unchanged() {
        let mut dec = Utf8StreamDecoder::new();
        assert_eq!(
            dec.push(b"plain ascii \x1b[2K\x1b[1A"),
            "plain ascii \x1b[2K\x1b[1A"
        );
        assert_eq!(dec.finish(), "");
    }

    #[test]
    fn two_byte_umlaut_survives_any_chunk_split() {
        // "wäre" — the ä (0xC3 0xA4) must survive a split between its bytes.
        assert_all_two_chunk_splits_lossless("w\u{00E4}re".as_bytes(), "wäre");
    }

    #[test]
    fn three_byte_spinner_and_box_drawing_survive_any_chunk_split() {
        // Spinner ◐ (E2 97 90) and box-drawing ─ (E2 94 80): exactly what
        // Claude Code's TUI emits constantly.
        assert_all_two_chunk_splits_lossless("◐─│└".as_bytes(), "◐─│└");
    }

    #[test]
    fn four_byte_emoji_survives_any_chunk_split() {
        assert_all_two_chunk_splits_lossless("ok 🚀 done".as_bytes(), "ok 🚀 done");
    }

    #[test]
    fn realistic_tui_frame_split_at_every_boundary() {
        // A miniature Claude-Code-style redraw: cursor movement + German text
        // + box drawing, split at every possible byte boundary.
        let frame = "\x1b[2K\x1b[1A● Prüfe Test-Infrastruktur ─ läuft\r\n";
        assert_all_two_chunk_splits_lossless(frame.as_bytes(), frame);
    }

    #[test]
    fn sequence_split_across_three_chunks() {
        // 4-byte emoji delivered one byte at a time.
        let bytes = "🚀".as_bytes();
        let mut dec = Utf8StreamDecoder::new();
        let mut out = String::new();
        for b in bytes {
            out.push_str(&dec.push(std::slice::from_ref(b)));
        }
        out.push_str(&dec.finish());
        assert_eq!(out, "🚀");
    }

    #[test]
    fn genuinely_invalid_byte_becomes_replacement_char() {
        let mut dec = Utf8StreamDecoder::new();
        // 0xFF can never start a UTF-8 sequence — must not be held back forever.
        assert_eq!(dec.push(b"a\xFFb"), "a\u{FFFD}b");
        assert_eq!(dec.finish(), "");
    }

    #[test]
    fn truncated_sequence_at_stream_end_flushes_as_replacement() {
        let mut dec = Utf8StreamDecoder::new();
        // First two bytes of ◐, stream ends.
        assert_eq!(dec.push(&[0xE2, 0x97]), "");
        assert_eq!(dec.finish(), "\u{FFFD}");
    }

    #[test]
    fn incomplete_tail_is_not_emitted_early() {
        let mut dec = Utf8StreamDecoder::new();
        // Chunk ends mid-ä: the 'w' must come through, the 0xC3 must wait.
        assert_eq!(dec.push(&[b'w', 0xC3]), "w");
        assert_eq!(dec.push(&[0xA4]), "ä");
    }
}
