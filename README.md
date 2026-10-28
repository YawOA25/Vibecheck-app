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

**Privacy and security on the phone (batch Q1).**

- **The login is encrypted on the phone.** Supabase keeps the login (session tokens) so people stay signed in. Since Q1 it lives in the phone's secure store (iPhone Keychain, Android Keystore) through `expo-secure-store`, not in plain AsyncStorage. The secure store holds about 2 KB per value and a login is bigger, so `src/lib/secure-session-storage.ts` saves it in small pieces and switches to a new set only once every piece is saved (a crash halfway keeps the old login). People signed in on an older build are moved over once, the first time the app opens, and stay signed in; the old AsyncStorage copy is then deleted. If the phone's keychain can't be written at that moment, the old copy is kept and used until the next try, so nobody is signed out. The login stays on that phone only: a new phone restored from a backup asks the guest to sign in again. The web version has no secure store and keeps using the browser's storage.
- **The date of birth never goes in a web address.** The app sends it only to `complete_profile`, and every server call (`supabase.rpc`) is a POST: the inputs travel in the request body, which servers don't write to their address logs. supabase-js only uses GET (inputs in the address) when it is given a third `{ get: true }` or `{ head: true }` option; ESLint refuses any `rpc` call with a third input (`eslint.config.js`), and `__tests__/rpc-post-only.test.js` checks the real client sends POST with the date in the body only. Supabase still keeps its own normal request logs (address, time, status) for a short time; those never contain the date of birth.
- Expo note: `expo-secure-store` is a native part, so after pulling this change start Expo once with `npx expo start --clear` (PowerShell, in the app folder). Expo Go already includes it; our own EAS builds need a new build to include it.

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

**Create an event on your phone.** Stand at the place, tap **New event**, fill in the name and area, tap **Starts** and **Ends** to pick the dates and times on your phone's own picker (a spinning wheel with **Done** on iPhone; a calendar, then a clock, on Android), tap **Use my current location** (allow location when asked), set the switches, then **Create event**. The next screen shows the 6-character party code to write or print on a card; **Get a new code** replaces it if it leaks. Turn on **Test event** while trying things out: only testers see test events.

**Times are always New York time.** The pickers show and pick New York (DC) time, whatever time zone your phone is set to, and they start on New York's date. So "10:00 PM" always means 10 PM at the party, even if you create the event while travelling. Daylight-saving nights work too: on the November night the clocks go back, a party from 10:00 PM to 2:00 AM lasts 5 real hours, as it should.

**Staff picks (VC-29).** For a venue event the team picked: turn on **Staff pick**, paste the ticket link (only `https://` links on eventbrite.com are accepted) and write a summary of 15 words or fewer **in our own words**. Never paste the organizer's description, and never use their flyer or Eventbrite's logo (legal conditions, `team/projects/vibecheck/legal/eventbrite-terms-2026-10-26.md`).

**"How to get in" link (VC-40).** For a host event (not a staff pick), you can paste the host's own RSVP or invite page. Only `https://` links on partiful.com, posh.vip, lu.ma, luma.com, eventbrite.com, dice.fm or instagram.com are accepted (ra.co is left out on purpose; see `team/projects/vibecheck/legal/vc40-host-links-2026-10-27.md`). Guests see a plain **How to get in** link, never a site name or logo, with "Links go to the host's page. We're not responsible for other sites." under it.

**Share (VC-41).** The event page has a **Share** button that opens your phone's share sheet with the event's name, area and time. It never includes the party code or the location. There's no web link yet: once there is one, put it in `SHARE_LINK` in `src/lib/share.ts`.

## Rating and heads-ups (VC-B08, VC-43)

**How it works.** After checking in, a guest taps **Rate the night** (on the check-in result, or on the event page) and picks one option in each of three rows: Crowd, Music, Energy. A reaction (one of six emoji) and heads-up tags such as "Lines are long" are optional. The screen is `app/rate/[id].tsx`.

**The rules** live on the server, in `supabase/migrations/20261027120000_ratings_and_heads_ups.sql`, so a changed app can't skip them:

- only checked-in guests can rate, and the check-in must be confirmed in the last 45 minutes. For a GPS check-in, the app quietly takes one more location reading before saving (only if location is already allowed; it never asks), which refreshes that time. Since VC-48 party-code guests get the same quiet check: if their phone already allows location and the reading is outside the party area (the event's radius plus the phone's own accuracy, at most 75 m extra), the rating is stopped ("too far"). After 5 "too far" answers at an event the server locks GPS for that person there, and the rating screen treats that lock as "too far" too, so trying again doesn't get round it. A party-code guest who never allowed location is not asked and rates as before. Tester check-ins skip the check (a tester at home would always be too far). This check runs in the app, like the GPS one: it keeps honest phones honest, but a tampered app could skip it;
- the window is the same as check-in: from 30 minutes before the start to 1 hour after the end;
- there's one rating per person per event. Saving again updates it, but only 60 minutes or more after the last save. A guest can still rate every event they go to in a night;
- admins can't rate or add heads-ups (staff rule). Use a separate guest account to test rating;
- hidden ratings count nowhere, and that guest's heads-ups don't count either. Admins hide them on the **Moderate** screen (see "Moderation" below).

**Heads-ups (VC-43, VC-45).** The nine tags are fixed (no free text, so nothing to moderate); the list lives in `src/lib/rating.ts` and `private.heads_up_tags_active()`. The event page shows a **Heads-up** card with each tag's count. Small-crowd privacy, decided on the server so lower counts never reach the app: no tag shows at all until 5 or more different guests have a visible rating at the event tonight (since 5 AM New York; VC-67, `20261027230000_tags_need_five_raters.sql`), because at a tiny event a count could point at one person. After that a tag shows once 2 or more guests picked it (VC-56), and "Felt unsafe" needs 3+ guests and 10% of tonight's raters (VC-59). Until then the card says "No heads-ups yet. Tags show here once 5 or more guests have rated tonight and 2 or more of them pick the same tag." Admins still see every count on the Moderate screen. A checked-in guest can tap a tag to **+1** it, once per tag, and can't take it back. Nobody can see who added a tag. Counts cover the last 3 hours only (VC-46, `20261027140100_live_windows.sql`), so a tag fades out unless people keep confirming it; a guest whose own +1 is older than 3 hours can add it again.

## Live vibe score and headcount (VC-B09, VC-42)

**What people see.** The event page's **Live vibe** card shows a meter: the score from 0 to 10 with its word (under 4 Quiet, 4 to 6.9 Good, 7 to 8.4 Hot, 8.5 and up Fire), how many people rated and when, the reaction tally, and the headcount ("74 here", a number only: no names, no guest list). While the event is on, the headcount counts people whose check-in was confirmed in the last 3 hours (the same window as the score; a re-check before rating refreshes it). Once the end time has passed it says "74 were here" and counts everyone who checked in that night (VC-55). It refreshes every 20 seconds while the page is open. Each card on the Tonight list shows the score and word (or "Early" with "3 so far", or "No vibe yet") and the headcount, refreshed every minute.

**The rules** live on the server, in `supabase/migrations/20261027130000_vibe_score.sql`:

- one rating's score is (crowd + music + energy - 3) / 6 x 10. The live score is a weighted average of the ratings saved in the last 3 hours, where a rating counts half as much every 30 minutes but never less than a quarter (VC-50: weight = max(0.25, 0.5 ^ (age in minutes / 30))), rounded to 1 decimal. Without that floor, one new rating after a quiet spell could outweigh 16 older ones;
- fewer than 5 ratings shows "Early reading: N people so far" with no number. A number is never made from fewer than 5 ratings: if the last 3 hours hold fewer than 5, the score is the plain (unweighted) average of the 5 newest instead, so one fresh rating can't outweigh the others. No new rating for 90 minutes shows the last score in grey with "Quiet for ..." and the night's average (the average is only sent in this quiet state);
- hidden ratings count nowhere. Hiding or unhiding on the **Moderate** screen (VC-47) republishes the score at once, under the same per-event lock as rating. If one or two new ratings are waiting for the 3-rater gate at that moment (VC-64), the snapshot is re-made as of its own earlier time instead, so they aren't released below the gate. Edge case of that rule: if the waiting "rating" is an UPDATE by someone already in the snapshot, the re-made snapshot leaves that person out until the next publish (their row now carries the newer time), so the change can hint at their old rating. It's one person (or two), once, and only when an admin hides at that exact moment (documented after cto review). Accepted limit: that republish changes the score by exactly the hidden rating, so someone watching can work out roughly what the hidden (abusive) rating was. A manual publish never replaces a newer one, and it takes the same per-event lock as rating (`20261027150000_vibe_publish_fixes.sql`);
- the quiet state's night average is shown only when it can't single anyone out: when the score leaves out none of the night's ratings, or 5 or more of them. Otherwise (for example 6 raters with the score made from the 5 newest, where 6 x average - 5 x score would be the oldest person's rating) it is left out and the card just says "Quiet for ...";
- **the score is published, not live (VC-51, `20261027140200_vibe_publish_gate.sql`; 3 raters since VC-64, `20261027180000_gate3_report_reasons.sql`).** The meter, the rater count and the reaction tally only change once 3 or more different people have rated since the last update (it was 2). In between, every refresh gets exactly the same answer, so watching the meter can't reveal what one person gave. One person rating and then updating an hour later counts once. The number lives in one place, `private.vibe_publish_after()`. Honest limits: 3 is a floor, not real anonymity. A guest who rates right after exactly two others can work out roughly the AVERAGE of what those two gave (they know their own rating), at most once an hour per event; with 2 it was one person's rating. The person who just rated still sees the live count in "You and 4 others". The first rating at an event shows nothing until two more people rate, and the score updates a little less often;
- the app only ever gets totals (`get_event_vibe` for one event, `get_events_vibe` for the list), never names, ids or the exact time of a rating, and it can't pick the clock the score is worked out at. Before VC-51, someone who kept refreshing could see the score and the count change when one new rating arrived; the publish gate above closes that, within its limits. The earlier privacy fixes are in `supabase/migrations/20261027130100_vibe_score_privacy.sql` and `20261027130200_vibe_score_floor_plain_average.sql`.

## Next-morning recap and Nights out (VC-B12)

**What people see.** Right after a rating is saved, the phone asks once for permission to send notifications (the only time the app asks). If allowed, a local notification arrives at **11:00 AM New York time** the morning after the night ("Your night at Rooftop is ready."; never a score, because it shows on the lock screen). Tapping it opens **Your night**: your own word and three rows next to the room's final night word, the last published score, how many rated, and the top reaction. The **Me** button on the home screen opens your name, a "Last night, rated" card and **Your nights out** (every event you rated, newest first). If you say no to notifications, nothing else changes: the recap is always under Me.

**The rules.** `get_my_recap` (`supabase/migrations/20261028100000_my_recap.sql`) returns only your own ratings, saved in the last 36 hours (or all of them, up to 50, for Nights out), each with the event's PUBLISHED vibe: the exact answer the event page shows. Nothing is worked out fresh, the night is a word only, and hidden ratings are left out. The 11 AM time is in `src/lib/recap.ts` (`recapMorning`); the notification code is `src/lib/recap-notifications.ts` (local notifications only: no push, no server).

**Trying it in Expo Go.** Local notifications work in Expo Go. To check the recap without waiting until 11 AM, rate a test event and open Me; the notification itself is best checked at the real 11 AM.

## Settings, account deletion and legal pages (VC-B13, VC-32b, VC-32c)

**What people see.** The round gear next to your name on **Me** opens **Settings**: who is signed in, **Sign out**, **Terms of Service**, **Privacy Policy**, **Contact us** (only once an address is set) and **Delete account**. Deleting asks twice ("Delete your account?", then "Last step") before anything happens. The sign-in screen also links to Terms and Privacy, and the 18+ gate's "sorry" screen shows Contact us.

**How deletion works.** The app calls the `delete-account` Supabase Edge Function (`supabase/functions/delete-account/`), which checks the login token and calls `public.delete_account` (`supabase/migrations/20261028120000_delete_account.sql`) for that token's owner only. In one transaction it deletes the login and every personal row (profile, check-ins, ratings, heads-ups, reports they made, sign-in history), blanks them out of the moderation log, and republishes the scores of the events they rated without releasing ratings still waiting below the 3-rater gate. The phone then signs out and removes its recap notes. The service key exists only in Supabase's function secrets. Logins locked by the 18+ gate can't be deleted this way (their 12-month mark stays).

**Deploying the function** (PowerShell, dev project only, from `C:\dev\Startup\apps\vibecheck`): `npx supabase functions deploy delete-account --project-ref abzcocmcqmmpfdfgogjr`.

**Still to set.** The legal text in `src/copy/legal.ts` is placeholder (a "Draft" note shows) until the legal-advisor's version is approved; swap it there. The help address is `SUPPORT_EMAIL` in `src/lib/contact.ts`, empty until the founder picks one (the link stays hidden).

## Moderation (VC-47, VC-58)

**For admins.** Two screens, both admin-only (the app hides them from everyone else, and every `admin_` server function refuses non-admins):

- **Reports** (button on Tonight, `app/admin/reports.tsx`): every open "Report this tag", grouped per event and tag, oldest first, with how many reports and +1s, how many gave each reason ("Not true 2 · Spam or fake 1", VC-65; reports from before reasons existed show as "No reason"), and how long it has waited. Reports should be decided within **48 hours**; older ones say **Overdue** in red. Tap one to open its event's Moderate screen.
- **Moderate** (from Reports, or **Moderate ratings and tags** in an event's Admin box, `app/admin/moderate/[id].tsx`): the event's tags (hide, unhide, or **Keep tag** to close reports and leave it up), everyone who rated or +1'd (with account age and check-in method, to spot brigading), and the latest decisions. **Hide rating** / **Unhide rating** and **Remove +1s** / **Restore +1s** work on one guest, including someone who only +1'd and never rated. Removing covers that guest for the whole event: +1s they add later, on any tag, don't count either until you restore them (`20261027170000_heads_up_bans.sql`).

**The written removal rule** (legal review, `team/projects/vibecheck/legal/phase0-consents-2026-10-27.md`, section 5). Every action asks for a reason, and the server only accepts these:

| Removing (hide a rating, remove +1s, hide a tag) | Restoring or keeping |
| ------------------------------------------------ | -------------------- |
| Weren't really there (`not_checked_in`)          | No rule broken       |
| Coordinated or brigading (`coordinated`)         | Undo a mistake       |
| Broke the tester rules (`broke_tester_rules`)    |                      |

There is no "the venue asked" reason, on purpose: an honest tag stays up whoever complains (FTC fake-review rule). Each decision is saved with its reason, the admin and an optional note in a private log (`private.moderation_log`).

**Reporting (any guest).** The Heads-up card has a **Report this tag** link for anyone who isn't an admin, checked in or not (so hosts can use it). They pick the tag, then a reason: **Not true**, **Spam or fake**, **Targets a person**, **Offensive** or **Other** (VC-65); tapping the reason sends it. The server refuses a report without one of those reasons. Temporary exception: app builds made before VC-65 still call the old two-input `report_heads_up_tag(event, tag)`, kept as a wrapper that saves the report with no reason ("No reason" in the queue) by `20261027180100_report_tag_compat.sql`. Remove it before outside testers (cto debt). Limits: one report per person per tag per event, and 10 per person per 24 hours. Who reported is stored for abuse handling but never shown to anyone, not even admins. Code: `supabase/migrations/20261027160000_admin_moderation.sql`, `20261027160100_tag_reports.sql` and `20261027180000_gate3_report_reasons.sql` (reasons).

**Venue contact email.** `VENUE_CONTACT_EMAIL` in `src/lib/contact.ts` is empty until you choose an address. Once set, the Heads-up card shows "Venue or host? Email ..." under the report link.

**Tester rules** (draft for the B14 tester terms, lawyer to review):

- Only pick tags about what you saw yourself tonight. Don't use tags to target a person or business. False or coordinated tags are removed and can end your access.

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

## Android test builds with EAS (VC-B10)

**What it is.** EAS Build (Expo Application Services) builds a real Android app (an `.apk` file) on Expo's servers, under the founder's Expo account `yawoa25` (project `@yawoa25/vibecheck`). Anyone with the link can install it on an Android phone or emulator. No Google Play account is needed for this. iOS builds are paused for now.

**The build settings live in `eas.json`.** JSON files can't hold comments, so here is what each "profile" (a named set of build settings) means:

| Profile       | What it builds                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `development` | A developer build with Expo's dev menu, shared by link (`distribution: internal`). Not used yet: it needs the `expo-dev-client` package first, and Expo Go covers the MVP.     |
| `preview`     | The test app we hand out: an installable `.apk` shared by link. Uses the EAS "preview" environment for its settings. This is the one we use now.                               |
| `production`  | The store version (a Play Store `.aab` bundle). Its version number goes up automatically each build (`autoIncrement`), and Expo's servers keep the count (`appVersionSource`). |

Each profile names an EAS **environment** (`development`, `preview`, `production`). That is where the build gets its `EXPO_PUBLIC_` settings, because `.env` is ignored by git and so never reaches Expo's servers. The `preview` environment holds only three public values: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` and `EXPO_PUBLIC_SENTRY_DSN`. **Never** add `SUPABASE_DB_PASSWORD` or a Supabase service key there. See or change them at expo.dev > vibecheck > **Environment variables**.

**What gets uploaded.** EAS starts from the whole git repo, but `.easignore` in the repo's top folder (`C:\dev\Startup\.easignore`) limits the upload to `apps/vibecheck` only: no `team/` notes, no `.claude/`, no other apps, no `.env`, no `node_modules`. When `.easignore` exists, EAS uses it instead of `.gitignore`, so any new `.gitignore` rule must be copied there too. To see exactly what would go up: `npx eas-cli build:inspect -p android --profile preview --stage archive --output C:\temp\eas-archive` (an empty folder).

**Run a build (PowerShell, from `C:\dev\Startup\apps\vibecheck`, with `EXPO_TOKEN` set):**

```powershell
npx eas-cli build -p android --profile preview
```

It takes about 10-20 minutes. The build page on expo.dev shows progress and, when done, an **Install** button and QR code.

**Install on a phone or emulator.** Open the build page link on the Android device (or scan its QR code), tap **Install**, download the `.apk`, and allow "Install unknown apps" for your browser when Android asks. On the emulator you can also drag the downloaded `.apk` onto the emulator window.

**Signing in on the APK.** This is a release-style build, so `__DEV__` is false and the **Reviewer sign-in** link is hidden. Sign in with the normal email code. Until real email delivery exists (task VC-B11), Supabase's built-in email only sends to members of your Supabase team (so use your own email address) and allows only a few emails per hour. If no email comes, wait an hour before asking for a new code.

**The Android package ID is provisional.** `android.package` in `app.config.ts` is `com.yawoa25.vibecheck` until the app name is chosen. It must be final before the first Google Play upload, because Play never lets it change.

**Signing key.** EAS created and stores the Android signing key (keystore) for this project. Don't delete it in expo.dev: Android only installs updates signed with the same key.

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

Screens so far: `app/(auth)/sign-in.tsx` (email code), `app/(auth)/age-gate.tsx` (name and date of birth), `app/index.tsx` (the home list: this week's events by night, the date filter, pull down to refresh, and 100 events at a time with **Load more events** / scroll to load the next 100, VC-66), `app/event/[id].tsx` (one event's page, with the live vibe meter, "I'm here" and, for staff picks, "Get tickets"), `app/check-in/[id].tsx` (GPS check-in, task VC-B06), `app/join/[id].tsx` (party-code check-in, task VC-B07), `app/rate/[id].tsx` (the 3-tap rating, task VC-B08) `app/admin/new-event.tsx`, `app/admin/edit-event/[id].tsx`, `app/admin/reports.tsx` (tag report queue, VC-58) and `app/admin/moderate/[id].tsx` (hide ratings, +1s and tags, VC-47) (admins only). A folder or file name in square brackets, like `[id]`, is a changing part of the address (the event's id). A folder name in brackets, like `(auth)`, groups screens without adding to their address.
