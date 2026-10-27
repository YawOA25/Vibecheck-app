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

This runs five things in order and stops at the first failure:

| Step   | Command                | What it checks                                                            |
| ------ | ---------------------- | ------------------------------------------------------------------------- |
| Lint   | `npm run lint`         | ESLint looks for likely bugs and bad habits                               |
| Format | `npm run format:check` | Prettier checks the code layout is consistent (`npm run format` fixes it) |
| Types  | `npm run typecheck`    | TypeScript checks every value is used the way its type allows             |
| Tests  | `npm test`             | Jest runs the automated tests in `__tests__/`                             |
| DB     | `npm run test:db`      | pgTAP tests check the database security rules (see below)                 |

## Database tests

The database rules (who may read or change what) live in `supabase/migrations/`, and their tests live in `supabase/tests/database/`. The tests need a real database to run against.

**Main way: a free Supabase "dev" project in the cloud.** No Docker needed. Use a separate project named something like `vibecheck-dev`, never the real one. Connect this folder to it once:

```powershell
cd C:\dev\wt\vibecheck\apps\vibecheck
npx supabase login                                # opens your browser to sign in
npx supabase link --project-ref <your-project-id> # the id is in the project's web address; asks for its database password
npx supabase db push                              # copies our migrations to that project (again after each change)
```

Then add the same database password to `.env` as `SUPABASE_DB_PASSWORD=...` (see `.env.example`), and run:

```powershell
npm run test:db                                   # runs the database tests there
```

How it works: `supabase test db --linked` would still need Docker, so `scripts/test-db.js` connects to the dev project itself (through Supabase's pooler, over an encrypted connection checked against Supabase's certificate in `supabase/certs/`) and runs each test file. It prints one line per file, for example `ok 002_profiles.test.sql: 21/21 passed`, and fails on any failed check, a wrong check count, or an SQL error. If the password is wrong, it prints `Could not connect`.

**Alternative: a local database with Docker Desktop.** Free, works offline, and nothing leaves your PC. Docker Desktop is a large install (a few GB) and has to be running while you test.

```powershell
cd C:\dev\wt\vibecheck\apps\vibecheck
npx supabase start       # the first time, this downloads the database images; later starts take seconds
npm run test:db          # runs the database tests (the local database is used first if it's running)
npx supabase db reset    # after changing a migration: rebuilds the local database from scratch
npx supabase stop        # when you're done, frees up memory
```

Each test runs inside a transaction that is undone at the end, so tests leave no data behind. That includes pgTAP itself (the test tool): each test file switches it on inside its transaction, so it isn't left installed on the dev project.

**If neither is set up**, `npm run check` still runs everything else, then prints `Database tests (pgTAP): SKIPPED` with these instructions. A skip is not a pass. Before merging database changes, run the checks with the skip turned into a failure:

```powershell
$env:VIBECHECK_REQUIRE_DB = "1"; npm run check; Remove-Item Env:VIBECHECK_REQUIRE_DB
```

## Sign-in and the 18+ gate (VC-B03)

**How it works.** People sign in with a code sent to their email (no passwords). The first time, the app asks for a display name and date of birth, then calls the server function `complete_profile`. That function creates the profile only for people 18 or older. Without a profile, the app shows nothing but the age gate, and the database hides events. The phone checks the age too, but only to answer faster; the server has the final say.

**The age rule** (same on the phone in `src/lib/age.ts` and on the server in `supabase/migrations/20261026160000_complete_profile.sql`):

- 18 or older means the 18th birthday is today or earlier.
- "Today" is the date in New York (America/New_York), because the MVP runs in the DMV. A phone set to another time zone can't change it.
- A 29 February birthday turns 18 on 1 March in years without 29 February.

**One-time setup in the Supabase dashboard** (for the `vibecheck-dev` project, at supabase.com):

1. **App settings in `.env`.** Go to **Project Settings > API Keys** (or **Data API**). Copy the **Project URL** into `EXPO_PUBLIC_SUPABASE_URL` and the **anon / publishable** key into `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Never copy the `service_role` / secret key. Until this is done, the app shows "Setup needed".
2. **Make the emails show a code.** Supabase's standard sign-in email has only a link. Go to **Authentication > Emails** (Templates). In **Confirm signup** and in **Magic Link**, set the subject to `Your VibeCheck code` and replace the message body with the text of `supabase\templates\sign-in-code.html`. Both are needed: the first is sent to new addresses, the second to returning ones.
3. **Who can get emails, for now.** Until real email delivery is set up (task VC-B11), Supabase only sends sign-in emails to members of your Supabase organization, and only about 2 an hour. To let a teammate test, invite them under **Organization settings > Team**. Anyone else sees "Sign-in emails can only go to the VibeCheck team's addresses for now."

**Try it on your iPhone:** start the app (above), type your email, type the code from the email, then enter a name and a date of birth. A date less than 18 years ago shows "Sorry, VibeCheck is for people 18 and older." and only offers Sign out. An adult date takes you to Tonight, which has a **Sign out** button at the bottom.

## Admins and creating events (VC-B04)

**How it works.** Only admins can create or edit events. The server functions `create_event` and `update_event` check the caller's profile `role`, and refuse everyone else, even with a hand-made request that skips the app. Admins see a gold **New event** button in the Tonight header; nobody else does. The exact location (map pin), the check-in radius and the party code are saved in a private table that no app user can read. Guests only see the title, the area label (neighbourhood, never an address) and the times.

**Make yourself an admin (one time, by hand).** The app has no way to make someone an admin, on purpose: users can't change their own `role`. You do it once in the Supabase dashboard:

1. Sign in to the app once and finish the age gate, so you have a profile.
2. In the Supabase dashboard, open the project (`vibecheck-dev` for testing; the real project later), then **SQL Editor > New query**.
3. Paste this, put your sign-in email in place of `you@example.com`, and click **Run**:

```sql
-- One-off: make the founder an admin (VC-B04).
-- Finds your login by email and sets role = 'admin' on that profile only.
-- "returning" shows the row it changed, so you can check it was you.
update public.profiles p
set role = 'admin'
from auth.users u
where u.id = p.id
  and u.email = 'you@example.com'
returning p.id, p.display_name, p.role;
```

4. Check the result shows one row with your name and `admin`. If it shows no rows, the email doesn't match, or you haven't finished the age gate yet.
5. In the app, sign out and sign back in (or close and reopen it). The **New event** button appears on Tonight.

To remove admin rights later, run the same query with `set role = 'user'`.

**Create an event on your phone.** Stand at the place, tap **New event**, fill in the name and area, check the dates and times (for a party past midnight, set the end date to the next day), tap **Use my current location** (allow location when asked), set the switches, then **Create event**. The next screen shows the 6-character party code to write or print on a card; **Get a new code** replaces it if it leaks. Turn on **Test event** while trying things out: only testers see test events.

**Times are always New York time.** The dates and times you type are read as New York (DC) time, whatever time zone your phone is set to, and the date boxes start on New York's date. So "10:00 PM" always means 10 PM at the party, even if you create the event while travelling. Daylight-saving nights work too: on the November night the clocks go back, a party from 10:00 PM to 2:00 AM lasts 5 real hours, as it should.

**Staff picks (VC-29).** For a venue event the team picked: turn on **Staff pick**, paste the ticket link (only `https://` links on eventbrite.com are accepted) and write a summary of 15 words or fewer **in our own words**. Never paste the organizer's description, and never use their flyer or Eventbrite's logo (legal conditions, `team/projects/vibecheck/legal/eventbrite-terms-2026-10-26.md`).

## Crash reports with Sentry (VC-26)

**What it does.** When the app hits an error it didn't expect, it sends a short report to [Sentry](https://sentry.io), so we hear about bugs before anyone complains. The code is in `src/lib/sentry.ts`.

**Turn it on.** Put your project's DSN (Sentry: **Settings > Projects > vibecheck > Client Keys (DSN)**) in `.env` (not `.env.example`), on the line `EXPO_PUBLIC_SENTRY_DSN=`. Then stop Expo (`Ctrl+C`) and start it again, because Expo reads `.env` only when it starts. With no DSN, Sentry stays off and the app works exactly the same. A DSN is not a password: it only lets an app send reports in, so it is safe inside the app. It still lives only in `.env`, never in the code.

**Check it works (developers only).** With the app open in Expo Go, **press and hold the big "Tonight" title** for about a second. A pop-up says "Test error sent". Within a minute it appears in the Sentry dashboard under **Issues**, with environment **development**. If it says "Sentry is off", the DSN is missing: check `.env` and restart Expo. This long-press only exists in development; store builds don't have it.

**What is never sent (privacy, legal VC-30).** No IP address, name or email. Before anything leaves the phone, every report and every breadcrumb (Sentry's trail of recent taps, network calls and console lines) is cleaned: any field named like a birthdate, date of birth, email, password, code, token or location (lat/lng) is deleted, and emails, plain dates, 6-8 digit codes and GPS coordinates inside messages are blanked out. Screenshots and screen layouts are off.

**Limits for now.**

- **Expo Go reports JavaScript errors only.** Native crashes (deep inside iOS or Android) need our own build (task VC-B10). That's when we also add Sentry's Expo plugin to `app.config.ts`.
- **No source maps yet.** Reports show the app's packed code lines, not our file names. Uploading source maps needs a Sentry auth token (a secret) and the plugin; it's a later step.
- Each report is tagged `development` (Expo Go) or `production` (store builds), so test errors don't mix with real ones.
- In tests, Jest swaps Sentry for a fake (`__mocks__/@sentry/react-native.js`), so tests never send anything.

## Where things live

| Path              | What's there                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `app/`            | Screens. Each file is a screen, and its path is its address (expo-router). `_layout.tsx` wraps every screen. |
| `src/theme.ts`    | Colors, spacing and text sizes from the design (wireframes v1). Use these instead of typing colors by hand.  |
| `src/lib/`        | Helpers: the Supabase connection, the sign-in state (`auth-context.tsx`), age maths, error messages.         |
| `src/components/` | Shared pieces of screens, such as `Button` and `TextField`.                                                  |
| `__tests__/`      | Automated tests.                                                                                             |
| `app.config.ts`   | App name, icon, splash screen and plugins.                                                                   |
| `.env.example`    | Template for private settings. Copy to `.env`; never commit `.env`.                                          |
| `supabase/`       | Database tables and security rules (`migrations/`) and their pgTAP tests (`tests/database/`).                |
| `scripts/`        | Helper scripts, such as `test-db.js`, which runs the database tests or explains why they were skipped.       |

Screens so far: `app/(auth)/sign-in.tsx` (email code), `app/(auth)/age-gate.tsx` (name and date of birth), `app/index.tsx` (Tonight: today's and tomorrow's events, pull down to refresh), `app/event/[id].tsx` (one event's page, with "I'm here" and, for staff picks, "Get tickets"), `app/check-in/[id].tsx` ("Check-in coming soon" until task VC-B06) and `app/admin/new-event.tsx` (admins only). A folder or file name in square brackets, like `[id]`, is a changing part of the address (the event's id). A folder name in brackets, like `(auth)`, groups screens without adding to their address.
