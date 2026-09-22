# Winception Torrent Deployment — Interactive Web Presentation

Final delivery combining all requested directions:

1. **Single HTML build**: `winception-torrent-deck-standalone.html` is fully self-contained.
2. **Mermaid + polished SVG**: the deck defaults to inline SVG for reliable offline rendering and includes reusable Mermaid source under `mermaid/` and inside the relevant slides.
3. **Reveal.js-style presentation UX**: keyboard navigation, slide progress, overview mode, fullscreen, source drawer, print layout, direct URL hashes, and deck-style transitions — implemented without external runtime dependencies.
4. **Winception repo branding**: based on the existing Web Console “Warm Paper + Ink” design tokens (`#FAF7F2`, `#332E29`, terracotta `#9C4221`, warm semantic colors, serif display typography).

## Files

- `index.html` — maintainable GitHub Pages entry point
- `assets/styles.css` — presentation styling
- `assets/app.js` — language, navigation, interaction, overview, theme, fullscreen
- `winception-torrent-deck-standalone.html` — single-file version
- `mermaid/architecture.mmd` — architecture diagram source
- `mermaid/deployment-flow.mmd` — deployment flow source

## GitHub Pages

Public URL: https://davislinyd.github.io/winception/torrent/

`tools/Build-GitHubPages.ps1` copies this folder to the Pages `torrent/` subdirectory. The site root remains the operations manual at https://davislinyd.github.io/winception/.

Locally you can also open:

- `index.html` with `assets/`
- `winception-torrent-deck-standalone.html` as a single-file copy

No external CDN is required.

## Keyboard shortcuts

- `← / →` or `PageUp / PageDown`: navigate
- `Space`: next slide
- `O`: overview
- `L`: 中文 / English
- `S`: code source drawer
- `F`: fullscreen
- `Esc`: close overlays

## Notes

The analysis is based on the `master` branch of `davislinyd/winception`, especially:

- `osdcloud-assets/OSDCloud/WinPE/OSDCloud/Start-OSDCloud-iPXE.ps1`
- `tools/osdcloud-console/src/torrent.js`
- `tools/osdcloud-console/src/torrentCoordinator.js`
- `tools/osdcloud-console/src/httpServer.js`
- `tools/osdcloud-console/src/controller/index.js`
- `tools/osdcloud-console/src/config.js`
