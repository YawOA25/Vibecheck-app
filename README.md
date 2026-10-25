# VibeCheck

A phone app (iPhone and Android) that shows the live "vibe" of a party, rated by the guests who are there. Built with Expo, TypeScript and expo-router. The full plan is in `team/projects/vibecheck/mvp-plan.md`.

## Where the app folder is

All commands below are for **PowerShell** (the normal Windows terminal, and the one in VS Code).

- **Right now (before this branch is merged):** `C:\dev\wt\vibecheck\apps\vibecheck`. This is a separate working copy (a "worktree") used while the cto reviews the code.
- **After the branch is merged into main:** `C:\dev\startup\apps\vibecheck`. That folder doesn't exist on main until then.

Use whichever one applies in the `cd` commands below. The examples use the current one.

## What you need

- **Node 22.13 or newer.** Expo refuses to start on older versions, and this PC's Node is 22.12. Check yours with `node -v`. Pick one fix:
  - **(a) Recommended, one time:** download the latest **Node 22 LTS** installer from [nodejs.org](https://nodejs.org) and run it. It upgrades your current Node in place. Open a new PowerShell window and check that `node -v` shows 22.13 or newer. You never need to think about this again.
  - **(b) Per terminal, no install:** this PC already has Node 22.14 through a tool called `fnm`, but a new PowerShell window doesn't know about it yet. Run these two lines in each new window, inside the app folder:
    ```powershell
    fnm env --use-on-cd | Out-String | Invoke-Expression   # teaches this window how to use fnm
    fnm use                                                  # switches to the version in .node-version (22.14.0)
    ```
- **Expo Go** on your iPhone (free, App Store). Keep it updated: see the troubleshooting notes below.
- Your iPhone and your PC on the **same Wi-Fi network**.

## First-time setup

```powershell
cd C:\dev\wt\vibecheck\apps\vibecheck
npm install                      # downloads the packages the app uses (into node_modules\)
Copy-Item .env.example .env      # makes your private settings file (filled in from task VC-B02)
```

## Open the app on your iPhone (Expo Go)

1. In PowerShell, in the app folder, run:
   ```powershell
   cd C:\dev\wt\vibecheck\apps\vibecheck
   npx expo start
   ```
2. **First time only:** Windows may show a **Windows Defender Firewall** pop-up for "Node.js". Tick **Private networks** and click **Allow access**. Without this, your phone can't reach your PC.
3. A QR code appears in the terminal.
4. On your iPhone, open the **Camera** app and point it at the QR code. Tap the "Open in Expo Go" banner.
5. The app loads and shows the **Tonight** screen.

Save a file on your PC and the phone updates by itself within a second or two. Press `r` in the terminal to reload the app, or `Ctrl+C` to stop.

**If something goes wrong:**

- **The phone can't connect or keeps loading:** check that both are on the same Wi-Fi, and that you allowed Node.js through the firewall (step 2). If it still fails, press `Ctrl+C`, then run `npx expo start --tunnel`. This sends the connection through the internet instead of your Wi-Fi. It's slower, but it works on most networks.
- **Expo Go says the project needs a different SDK version:** update Expo Go from the App Store. This app uses Expo SDK 58, and an older Expo Go can't open it.
- **`npx expo start` says Node is outdated:** see "What you need" above.

**Android emulator:** with the emulator running, run `npx expo start` and press `a`.

## Checks (run before every commit)

```powershell
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
