<p align="center"><img src="https://raw.githubusercontent.com/k0etsu/xivodreview/master/app/public/logo.png" alt="logo" style="height: 10em; width: 10em"></p>
<h1 align="center">xivodreview-local</h1>

<p align="center">
  <a href="https://github.com/k0etsu/xivodreview-local/releases/latest" title="Release">
    <img src="https://img.shields.io/github/v/release/k0etsu/xivodreview-local" alt="Release">
  </a>
  <a href="https://github.com/k0etsu/xivodreview-local/blob/master/LICENSE" title="License">
    <img src="https://img.shields.io/github/license/k0etsu/xivodreview-local" alt="License">
  </a>
  <a href="https://ko-fi.com/k0etsu" title="Ko-Fi" target="_blank">
    <img src="https://img.shields.io/static/v1?label=donate&message=ko-fi&color=13C3FF&style=flat&logo=kofi">
  </a>
</p>

A standalone desktop application for reviewing Final Fantasy XIV raid footage alongside FF Logs report data. A local-first port of [xivodreview](https://github.com/k0etsu/xivodreview) that plays local video files instead of Twitch or YouTube VODs, with no streaming platform authentication required.

## Core Functionality

Users provide a local video file and an FF Logs report URL or code. The application displays the video alongside a sidebar showing all pulls from the report. Selecting a pull seeks the video to that encounter's timestamp. A configurable offset syncs the video clock to FF Logs event timestamps, and clicking any death event in the table seeks directly to that moment.

## Features

- Local video playback (.mp4, .mkv, .webm, .avi, .mov)
- Pull list with fight percentage, duration, pull number, phase reached, and wall-clock time
- Pull coloring by progress (common through legendary/kill)
- Phase grouping within each encounter
- Death event table with player, source ability, and relative timestamp
- Video sync offset with fine-grained controls and a one-click "sync here" button
- Saved encounters with persistent offset per report
- Reload button to re-fetch the report and refresh the video from disk (useful when recording live)
- No installation required — run directly from the extracted zip or the portable exe

## Keyboard Shortcuts

| Keys | Action |
|---|---|
| Space | Play / Pause |
| Left / Right | Seek +-5 s |
| Shift + Left / Right | Seek +-30 s |
| Ctrl + Left / Right | Step one frame |
| Up / Down | Volume +-10% |
| M | Toggle mute |
| [ / ] | Offset +-500 ms |
| S | Sync offset to current video position |
| N / P | Next / previous pull |
| R | Reload video + report |
| Ctrl + O | Open video file |
| ? | Toggle shortcut reference |
| Esc | Close modal |

## Download

Grab the latest release from the [Releases](https://github.com/k0etsu/xivodreview-local/releases) page.

| Platform | File |
|---|---|
| Windows | `xivodreview.*.zip` — extract and run `xivodreview.exe` |
| Windows | `xivodreview.*.exe` — portable single-file, no extraction needed |
| macOS | `xivodreview-*.dmg` |
| Linux | `xivodreview-*.AppImage` |

## Setup

FF Logs credentials are required to fetch report data.

1. Register an API client at [fflogs.com/api/clients](https://www.fflogs.com/api/clients)
2. Open Settings in the application and enter your client ID and secret
3. Use "Test connection" to verify before saving

Credentials are stored locally using the OS keychain and never leave the machine.

## Development

```bash
npm install
npm run dev
```

## Building

```bash
# Current platform
npm run build

# Per-platform
npm run build:win
npm run build:mac
npm run build:linux
```

Releases are built automatically via GitHub Actions when a version tag is pushed:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

## License

AGPL-3.0 - see [LICENSE](LICENSE)
