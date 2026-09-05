use portable_pty::{native_pty_system, PtySize};

#[test]
fn test_pty_resize_after_clone_reader_and_take_writer() {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("Failed to open PTY");

    // Clone reader and take writer — same sequence as shell_spawn
    let _reader = pair.master.try_clone_reader().expect("clone reader");
    let _writer = pair.master.take_writer().expect("take writer");

    // Resize should still work on the master
    pair.master
        .resize(PtySize {
            rows: 50,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("resize after clone_reader + take_writer should succeed");
}
