# VibeCheck

A phone app (iPhone and Android) that shows the live "vibe" of a party, rated by the guests who are there. Built with Expo, TypeScript and expo-router. The full plan is in `team/projects/vibecheck/mvp-plan.md`.

## What you need

- **Node 22.13 or newer.** Expo refuses to start on older versions. Your PC has Node 22.14 through `fnm`, and the `.node-version` file in this folder tells fnm which version to use. If `node -v` shows 22.12, run `fnm use` in this folder first.
- **Expo Go** on your iPhone (free, App Store).
- Your iPhone and your PC on the **same Wi-Fi network**.

## First-time setup

```bash
cd apps/vibecheck
npm install            # downloads the packages the app uses (into node_modules/)
cp .env.example .env   # makes your private settings file (filled in from task VC-B02)
```

## Open the app on your iPhone (Expo Go)

1. In this folder, run `npx expo start`.
2. A QR code appears in the terminal.
3. On your iPhone, open the **Camera** app and point it at the QR code. Tap the "Open in Expo Go" banner.
4. The app loads and shows the **Tonight** screen.

Save a file on your PC and the phone updates by itself within a second or two. Press `r` in the terminal to reload the app, or `Ctrl+C` to stop.

**If the phone can't connect:** check you're on the same Wi-Fi. If it still fails (some home or office networks block it), stop and run `npx expo start --tunnel` instead, which goes through the internet.

**Android emulator:** with the emulator running, run `npx expo start` and press `a`.

## Checks (run before every commit)

```bash
npm run check
```

This runs four things in order and stops at the first failure:

| Step   | Command                | What it checks                                                            |
| ------ | ---------------------- | ------------------------------------------------------------------------- |
| Lint   | `npm run lint`         | ESLint looks for likely bugs and bad habits                               |
| Format | `npm run format:check` | Prettier checks the code layout is consistent (`npm run format` fixes it) |
| Types  | `npm run typecheck`    | TypeScript checks every value is used the way its type allows             |
| Tests  | `npm test`             | Jest runs the automated tests in `__tests__/`                             |

## Where things live

| Path            | What's there                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| `app/`          | Screens. Each file is a screen, and its path is its address (expo-router). `_layout.tsx` wraps every screen. |
| `src/theme.ts`  | Colors, spacing and text sizes from the design (wireframes v1). Use these instead of typing colors by hand.  |
| `__tests__/`    | Automated tests.                                                                                             |
| `app.config.ts` | App name, icon, splash screen and plugins.                                                                   |
| `.env.example`  | Template for private settings. Copy to `.env`; never commit `.env`.                                          |

Coming in later tasks: `src/lib/` (helpers), `src/components/`, and `supabase/` (database rules and their tests).
