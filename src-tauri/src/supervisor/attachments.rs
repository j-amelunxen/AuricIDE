use std::fs;
use std::path::{Path, PathBuf};

pub const MAX_IMAGE_ATTACHMENT_BYTES: u64 = 25 * 1024 * 1024;

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "heic"];

pub fn is_image_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            IMAGE_EXTENSIONS
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        })
}

pub fn copy_image_attachment(run_dir: &Path, source: &Path) -> Result<PathBuf, String> {
    let source = source
        .canonicalize()
        .map_err(|error| format!("Could not read image attachment: {error}"))?;
    if !source.is_file() || !is_image_path(&source) {
        return Err(
            "Only existing PNG, JPG, JPEG, GIF, WEBP and HEIC image files can be attached"
                .to_string(),
        );
    }
    let run_dir = run_dir
        .canonicalize()
        .map_err(|error| format!("Could not access the supervisor run folder: {error}"))?;
    if source.starts_with(&run_dir) {
        return Ok(source);
    }
    let size = source.metadata().map_err(|error| error.to_string())?.len();
    if size > MAX_IMAGE_ATTACHMENT_BYTES {
        return Err(format!(
            "Image attachment exceeds the {} MB limit",
            MAX_IMAGE_ATTACHMENT_BYTES / 1024 / 1024
        ));
    }
    let attachments = run_dir.join("attachments");
    fs::create_dir_all(&attachments)
        .map_err(|error| format!("Could not create attachments folder: {error}"))?;
    let name = source
        .file_name()
        .ok_or("Image attachment has no file name")?;
    let mut destination = attachments.join(name);
    let stem = source
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("image");
    let extension = source
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("");
    for number in 2.. {
        if !destination.exists() {
            break;
        }
        destination = attachments.join(format!("{stem}-{number}.{extension}"));
    }
    fs::copy(&source, &destination)
        .map_err(|error| format!("Could not copy image attachment: {error}"))?;
    Ok(destination)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn copies_images_without_touching_the_source_and_disambiguates_names() {
        let temp = tempdir().unwrap();
        let run = temp.path().join("run");
        let outside = temp.path().join("outside");
        fs::create_dir_all(&run).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let source = outside.join("Bildschirmfoto ä.png");
        fs::write(&source, b"png").unwrap();

        let first = copy_image_attachment(&run, &source).unwrap();
        let second = copy_image_attachment(&run, &source).unwrap();

        assert_eq!(source, outside.join("Bildschirmfoto ä.png"));
        assert_eq!(fs::read(&source).unwrap(), b"png");
        assert_eq!(first.file_name().unwrap(), "Bildschirmfoto ä.png");
        assert_eq!(second.file_name().unwrap(), "Bildschirmfoto ä-2.png");
        assert_eq!(fs::read(first).unwrap(), b"png");
    }

    #[test]
    fn rejects_non_images() {
        let temp = tempdir().unwrap();
        let run = temp.path().join("run");
        fs::create_dir(&run).unwrap();
        let source = temp.path().join("notes.txt");
        fs::write(&source, b"not an image").unwrap();
        assert!(copy_image_attachment(&run, &source).is_err());
    }
}
