<p align="center"><img src="docs/icon.png" width="88" alt=""></p>

<h1 align="center">Garabato</h1>

<p align="center">Scribble on any web page while you record it.</p>

<p align="center"><a href="README.es.md">Español</a></p>

Garabato (Spanish for *scribble*) is a Chrome extension for reviewing websites out loud. It records
the tab you're on with your camera and mic, and lets you draw on top and pin comments to the page as
you talk. Every comment is stamped with its time in the video. When you stop, you get an **MP4**, the
comments as **Markdown**, and **VTT** subtitles.

No account, no server, no upload. Everything happens in your browser and the files land in your
Downloads folder.

![Garabato on a landing page: a highlighted headline, a circled button, an arrow and three timestamped comments](docs/screenshot.png)

## Install

Garabato isn't on the Chrome Web Store yet, so load it unpacked:

1. Clone or [download](https://github.com/ignaciobernardo/garabato/archive/refs/heads/main.zip) this repo.
2. Open `chrome://extensions`, turn on **Developer mode** and click **Load unpacked**.
   Pick the `extension` folder.
3. Pin Garabato from the puzzle-piece menu next to the address bar.

On any page, click the icon or press **Alt+Shift+G** to show or hide the toolbar.

To try it without installing anything, run `python3 -m http.server 8098` in the repo and open
<http://localhost:8098/demo/>.

## Use

| Key | Tool |
|---|---|
| V | Cursor (use the page normally) |
| P | Pen |
| H | Highlighter |
| A | Arrow (Shift snaps to 15°) |
| R | Rectangle (Shift for a square) |
| C | Comment: click the page, type, ⌘↵ to save |
| F | Fading ink: strokes clear themselves after ~3 s |
| L | Comment list |
| ⌘Z | Undo · Esc goes back to the cursor |

- **Record** asks you to share *this tab*, counts down 3-2-1 and records the page with your
  drawings, comments, camera bubble and a halo that follows your pointer (Chrome leaves the cursor
  out of tab captures). The audio mixes your mic with the tab's own sound. You can pause.
- The **camera** turns on by itself when you hit Record and off when you stop. Click the camera
  button to see yourself before recording; switch it off and you won't be in the video. Drag the
  bubble anywhere; hover it to resize or close it.
- Drawings and comments stick to the content when you scroll.
- When you stop, the **review** opens: the video with your comments on a timeline and as
  subtitles. Click a comment to jump to that moment. Download the video, the comments or the
  subtitles from there.

![The review window: video player with comment markers on a timeline and the comment list beside it](docs/review.png)

### What you get

The Markdown file lists each comment with its time in the video, the element you clicked and its
text, so it can go straight into an issue or a ticket:

```md
# Comments · Tostado

http://localhost:8098/demo/

11/9/2026, 6:27:41 PM · 3 comments · video 00:11

1. **[00:01]** Headline wraps into 3 lines on laptop. Shorter: "Roasted this week."
   `div.wrap > section.hero > h1` — “Single-origin coffee, roasted this week.”
2. **[00:03]** This should be the only primary button
   `div.wrap > section.hero` — “Single-origin coffee, roasted this week. We pick small lots from gro…”
```

The video is H.264 MP4 at the tab's full resolution (2× on Retina screens) when Chrome can encode
it, and WebM otherwise.

## Privacy and permissions

- Garabato asks for `activeTab` and `scripting` only. It runs on a tab when you click its icon or
  press the shortcut, and never reads your other tabs or your browsing.
- It makes no network requests. Recordings and comments stay in memory until you download them.
- Chrome asks for camera and microphone permission per site, the first time you record there.

## Limits

- Navigating to another URL during a recording loses it (Garabato warns you before you leave).
  Route changes inside single-page apps are fine.
- It can't run on `chrome://` pages, the Chrome Web Store or the PDF viewer.
- Comments live in memory: export the `.md` before reloading the page.
- Chrome only for now. Firefox doesn't support `preferCurrentTab` tab capture.

## How it works

- `extension/garabato.js` is the whole tool: one file, no dependencies, no build step. It draws
  its UI inside a Shadow DOM so the page's styles can't leak in, and it also works as a plain
  `<script>` tag (that's what the demo does).
- Recording uses `getDisplayMedia({ preferCurrentTab: true })` and `MediaRecorder`. The tab's
  audio and your mic are mixed with Web Audio.
- The camera bubble and the drawings are part of the page, so the tab capture records them like
  everything else.
- `extension/player.html` plays the review video from the extension's own origin, so strict
  Content Security Policies (GitHub's, for example) can't block it.
- `extension/background.js` injects the script when you click the icon.

## Languages

The UI is in English, or in Spanish when your browser is set to Spanish. All strings live in the
`T` object near the top of `garabato.js`; pull requests with more languages are welcome.

## Contributing

Issues and pull requests are welcome. There's no build: edit `extension/garabato.js`, click the
reload arrow on Garabato's card in `chrome://extensions`, and reload the page you're testing on.
The demo page is the quickest way to try a change.

`scripts/pack.sh` zips the extension for the Chrome Web Store.

## License

[MIT](LICENSE)
