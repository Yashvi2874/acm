# Local Setup Requirements

This project is a `React + TypeScript + Vite` app and uses `npm` for dependency management.

## Prerequisites

- `Node.js`: `20.19.0+` or `22.12.0+`
- `npm`: version bundled with the compatible Node.js install
- `Git`: optional, only needed if cloning the repository

## Install Before Running

From the project root:

```bash
npm install
```

If you want a clean install that matches `package-lock.json` exactly, use:

```bash
npm ci
```

## Run Locally

```bash
npm run dev
```

## Project Dependencies

### Runtime dependencies

- `@types/three` `^0.183.1`
- `react` `^19.2.4`
- `react-dom` `^19.2.4`
- `three` `^0.183.2`

### Development dependencies

- `@eslint/js` `^9.39.4`
- `@types/node` `^24.12.0`
- `@types/react` `^19.2.14`
- `@types/react-dom` `^19.2.3`
- `@vitejs/plugin-react` `^6.0.1`
- `eslint` `^9.39.4`
- `eslint-plugin-react-hooks` `^7.0.1`
- `eslint-plugin-react-refresh` `^0.5.2`
- `globals` `^17.4.0`
- `typescript` `~5.9.3`
- `typescript-eslint` `^8.57.0`
- `vite` `^8.0.1`

## Helpful Commands

- Start dev server: `npm run dev`
- Build production bundle: `npm run build`
- Preview production build: `npm run preview`
- Run linting: `npm run lint`
