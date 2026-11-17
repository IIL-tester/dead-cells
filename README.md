# Dead Cells — Web Port

HTML5 Canvas & TypeScript web port of Dead Cells.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build       # Builds ./dist for GitHub Pages / static hosting
npm run build:cdn   # Builds ./cdn/dead-cells.js (IIFE bundle for jsDelivr)
```

## GitHub Pages

Pushes to `main` automatically build `./dist` and deploy to GitHub Pages via `.github/workflows/deploy.yml`.

## Standalone (jsDelivr)

Copy the contents of [`play-jsdelivr.html`](play-jsdelivr.html) into any HTML editor (such as W3Schools Tryit Editor) to run the game directly from jsDelivr.
