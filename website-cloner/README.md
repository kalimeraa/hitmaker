# Website Cloner

Website Cloner is a local-first website capture tool for macOS, Windows, and Linux. It saves a browsable copy of a website — HTML, CSS, JavaScript, images, fonts, a screenshot, and a manifest — to a folder you control.

![Website Cloner](docs/screenshot.png)

## Highlights

- Electron desktop app with a clean, single-page workflow.
- Optional HTTP, SOCKS4, and SOCKS5 proxies with credentials.
- Configurable crawl depth and maximum page count.
- Live progress, history, delete, open-folder, preview, and ZIP export actions.
- Preview opens in the system default browser through a local HTTP server.
- No Docker, Redis, or MongoDB is required for the desktop/HTTP interface.
- MIT licensed for personal, commercial, and open-source use.

## Requirements

- Node.js 18 or newer
- npm

## Install and run

This folder is isolated from Hitmaker's routes and workers, but its capture adapter uses the repository's existing CloakBrowser automation. Install both dependency sets:

```bash
npm install
cd website-cloner
npm install
```

Desktop application:

```bash
npm start
# development alias:
npm run dev
```

Browser-based HTTP interface:

```bash
npm run serve
```

Open <http://127.0.0.1:4173>.

## Proxy format

Choose `http`, `https`, `socks4`, or `socks5`, then enter host, port, and optional credentials. URL format:

```text
socks5://username:password@proxy.example.com:1080
```

Credentials are used only for the active capture and are not written to the manifest.

## Output

Captures default to `Documents/Website Cloner/<domain>/<timestamp>/`. Each capture contains the source tree, `screenshot.png`, and `mirror-manifest.json`. Use **Open folder** to inspect the files or **Export ZIP** for a portable archive.

## Build installers

```bash
npm run build
```

Installers are written to `dist/` (DMG, NSIS, AppImage, and deb depending on platform).

## Development checks

```bash
npm test
node --check desktop/main.js
node --check desktop/renderer/app.js
```

The Website Cloner UI is isolated under `website-cloner/desktop`; the existing Hitmaker routes, workers, and database flow remain separate.

## License

MIT — see [LICENSE](LICENSE).
