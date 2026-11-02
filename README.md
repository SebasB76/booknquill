<p align="center"><img src="branding/icon.png" width="96" alt="BookNQuill icon"></p>

# BookNQuill

A quiet desktop notes app. Open it, start writing, and find the note again in your recent list.

- **Plain files.** Every note is a Markdown file in `~/Notes`. Other editors open them as usual.
- **Writes like a word processor.** `# Title` turns into a heading as you type; lists, tasks, bold and code work the same way.
- **Images without paths.** Paste a screenshot, then resize, align, rotate, crop or drag it. The file keeps a normal Markdown link, with the width stored the Obsidian way (`![|480](images/pasted-….png)`).
- **Sorts itself.** An optional classifier ([jev](https://typesafe.ai)) files each note under a category. Without an API key you pick the category yourself.

Built with Tauri 2 (Rust core), React and Tiptap.

## Status

Early development. Linux (Wayland, Hyprland) is the first target.

## License

MIT
