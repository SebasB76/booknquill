//! Everything the UI can ask for, shared by the Tauri app and the E2E bridge.
//! Notes are plain `.md` files in one flat folder; the file name is the note title.

use base64::{engine::general_purpose::STANDARD, Engine};
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebounceEventResult, Debouncer};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

const MAX_TITLE_CHARS: usize = 120;
const TRASH_DIR: &str = ".trash";
const IMAGES_DIR: &str = "images";

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NoteInfo {
    pub file: String,
    pub title: String,
    pub modified_ms: u64,
    pub preview: String,
}

pub struct Notes {
    dir: PathBuf,
}

/// Notes live in `$BOOKNQUILL_NOTES_DIR`, or `~/Notes` by default.
pub fn default_notes_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("BOOKNQUILL_NOTES_DIR") {
        return PathBuf::from(dir);
    }
    dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join("Notes")
}

impl Notes {
    pub fn new(dir: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&dir).map_err(err)?;
        Ok(Self { dir })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Runs one UI command. The Tauri app and the E2E bridge both go through here,
    /// so the tests exercise exactly the code the app ships.
    pub fn dispatch(&self, cmd: &str, args: Value) -> Result<Value, String> {
        let s = |key: &str| -> Result<String, String> {
            args.get(key)
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or_else(|| format!("missing argument `{key}`"))
        };
        match cmd {
            "config" => Ok(json!({ "notesDir": self.dir.to_string_lossy() })),
            "list" => Ok(json!(self.list()?)),
            "read" => Ok(json!(self.read(&s("file")?)?)),
            "write" => Ok(json!(self.write(&s("file")?, &s("content")?)?)),
            "create" => Ok(json!(self.create(&s("title")?, &s("content")?)?)),
            "rename" => Ok(json!(self.rename(&s("file")?, &s("title")?)?)),
            "trash" => {
                self.trash(&s("file")?)?;
                Ok(Value::Null)
            }
            "saveImage" => Ok(json!(self.save_image(&s("base64")?, &s("ext")?)?)),
            "readImage" => Ok(json!(self.read_image(&s("path")?)?)),
            "writeInk" => {
                self.write_ink(&s("path")?, &s("svg")?)?;
                Ok(Value::Null)
            }
            "mathFromText" => Ok(json!(crate::ai::math_from_text(&s("text")?)?)),
            _ => Err(format!("unknown command `{cmd}`")),
        }
    }

    pub fn list(&self) -> Result<Vec<NoteInfo>, String> {
        let mut notes = Vec::new();
        for entry in fs::read_dir(&self.dir).map_err(err)? {
            let path = entry.map_err(err)?.path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else { continue };
            if name.starts_with('.') || !name.ends_with(".md") || !path.is_file() {
                continue;
            }
            notes.push(self.info(name)?);
        }
        notes.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
        Ok(notes)
    }

    pub fn read(&self, file: &str) -> Result<String, String> {
        fs::read_to_string(self.path(file)?).map_err(err)
    }

    /// Writes through a temp file and a rename, so another editor never sees half a note.
    pub fn write(&self, file: &str, content: &str) -> Result<NoteInfo, String> {
        let path = self.path(file)?;
        let tmp = self.dir.join(format!(".{file}.tmp"));
        fs::write(&tmp, content).map_err(err)?;
        fs::rename(&tmp, &path).map_err(err)?;
        self.info(file)
    }

    pub fn create(&self, title: &str, content: &str) -> Result<NoteInfo, String> {
        let file = self.free_name(&file_name_for(title), None);
        self.write(&file, content)
    }

    /// Renames a note after its first line changed. Keeps the old name when the new one is taken.
    pub fn rename(&self, file: &str, title: &str) -> Result<NoteInfo, String> {
        let wanted = file_name_for(title);
        if wanted == file {
            return self.info(file);
        }
        let target = self.free_name(&wanted, Some(file));
        fs::rename(self.path(file)?, self.path(&target)?).map_err(err)?;
        self.info(&target)
    }

    pub fn trash(&self, file: &str) -> Result<(), String> {
        let trash = self.dir.join(TRASH_DIR);
        fs::create_dir_all(&trash).map_err(err)?;
        let mut target = trash.join(file);
        let mut n = 2;
        while target.exists() {
            target = trash.join(format!("{} {n}.md", file.trim_end_matches(".md")));
            n += 1;
        }
        fs::rename(self.path(file)?, target).map_err(err)
    }

    /// Stores a pasted or edited image and returns its link relative to the notes folder.
    /// Edits always create a new file, so the original image is kept.
    pub fn save_image(&self, base64: &str, ext: &str) -> Result<String, String> {
        let ext = match ext {
            "png" | "jpg" | "jpeg" | "gif" | "webp" => ext,
            _ => "png",
        };
        let bytes = STANDARD.decode(base64).map_err(err)?;
        let images = self.dir.join(IMAGES_DIR);
        fs::create_dir_all(&images).map_err(err)?;
        let stamp = chrono::Local::now().format("pasted-%Y%m%d-%H%M%S");
        let mut name = format!("{stamp}.{ext}");
        let mut n = 2;
        while images.join(&name).exists() {
            name = format!("{stamp}-{n}.{ext}");
            n += 1;
        }
        fs::write(images.join(&name), bytes).map_err(err)?;
        Ok(format!("{IMAGES_DIR}/{name}"))
    }

    /// Returns an image as base64, so the UI can edit it on a canvas without a tainted origin.
    pub fn read_image(&self, path: &str) -> Result<String, String> {
        let full = if Path::new(path).is_absolute() { PathBuf::from(path) } else { self.dir.join(path) };
        if full.components().any(|c| c.as_os_str() == "..") {
            return Err(format!("invalid image path `{path}`"));
        }
        fs::read(full).map(|b| STANDARD.encode(b)).map_err(err)
    }

    /// Overwrites a drawing. Unlike pasted images, a drawing keeps one file and changes with every stroke.
    pub fn write_ink(&self, path: &str, svg: &str) -> Result<(), String> {
        let name = path
            .strip_prefix("images/")
            .filter(|n| n.starts_with("ink-") && n.ends_with(".svg") && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.'))
            .ok_or_else(|| format!("invalid drawing path `{path}`"))?;
        let images = self.dir.join(IMAGES_DIR);
        fs::create_dir_all(&images).map_err(err)?;
        fs::write(images.join(name), svg).map_err(err)
    }

    fn info(&self, file: &str) -> Result<NoteInfo, String> {
        let path = self.path(file)?;
        let meta = fs::metadata(&path).map_err(err)?;
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let content = fs::read_to_string(&path).unwrap_or_default();
        Ok(NoteInfo {
            file: file.to_owned(),
            title: file.trim_end_matches(".md").to_owned(),
            modified_ms,
            preview: preview_of(&content),
        })
    }

    /// Only bare file names inside the notes folder are accepted.
    fn path(&self, file: &str) -> Result<PathBuf, String> {
        if file.is_empty() || file.contains('/') || file.contains('\\') || file.starts_with('.') {
            return Err(format!("invalid note name `{file}`"));
        }
        Ok(self.dir.join(file))
    }

    fn free_name(&self, wanted: &str, current: Option<&str>) -> String {
        let stem = wanted.trim_end_matches(".md");
        let mut name = wanted.to_owned();
        let mut n = 2;
        while Some(name.as_str()) != current && self.dir.join(&name).exists() {
            name = format!("{stem} {n}.md");
            n += 1;
        }
        name
    }
}

/// The file name is the first line, as Omawrite does it, minus Markdown markers.
pub fn file_name_for(title: &str) -> String {
    let cleaned: String = title
        .trim()
        .trim_start_matches('#')
        .trim()
        .replace(['/', '\\', '\n', '\r'], "-");
    let cleaned = cleaned.trim_start_matches('.').trim();
    let mut name: String = cleaned.chars().take(MAX_TITLE_CHARS).collect();
    if name.trim().is_empty() {
        name = "Sin título".to_owned();
    }
    format!("{}.md", name.trim_end())
}

fn preview_of(content: &str) -> String {
    content
        .lines()
        .skip(1)
        .map(|l| l.trim().trim_start_matches(['#', '-', '*', '>', ' ']).trim())
        .filter(|l| !l.is_empty() && !l.starts_with("!["))
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(140)
        .collect()
}

/// Watches the notes folder and reports changed note names (debounced).
pub fn watch(dir: &Path, on_change: impl Fn(Vec<String>) + Send + 'static) -> Result<Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>, String> {
    let mut debouncer = new_debouncer(Duration::from_millis(250), move |res: DebounceEventResult| {
        let Ok(events) = res else { return };
        let mut files: Vec<String> = events
            .iter()
            .filter_map(|e| e.path.file_name().and_then(|n| n.to_str()).map(str::to_owned))
            .filter(|n| n.ends_with(".md") && !n.starts_with('.'))
            .collect();
        files.sort();
        files.dedup();
        if !files.is_empty() {
            on_change(files);
        }
    })
    .map_err(err)?;
    debouncer.watcher().watch(dir, RecursiveMode::NonRecursive).map_err(err)?;
    Ok(debouncer)
}

#[derive(Deserialize)]
pub struct Invoke {
    pub cmd: String,
    #[serde(default)]
    pub args: Value,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
