# PiQueueBall
Open the folder in VS Code and use Live Server on `index.html` (or open that file directly in a browser).

Pages: `index.html` (sign-in entry) -> `signup.html` or `login.html` -> `profile-setup.html` for new accounts -> `home.html` (queue). Starting a match opens `score.html`; player totals are on `totals.html`, saved match and queue history are on `results.html`, your account profile is on `profiles.html`, and player discovery and friend requests are on `friends.html`.

## Project layout

The web app stays at the project root so pages, scripts, styles, and the service worker can use simple relative URLs.

| Location | Contents |
| --- | --- |
| Root `*.html` | App pages: sign-in, signup, profile setup, queue, scoring, totals, results, profiles, and friends |
| Root `*.js` | Browser logic, authentication, Supabase integration, offline support, and page behavior |
| `styles.css` | Shared responsive app styling |
| `supabase-setup.sql` | Database tables, security policies, and Supabase functions |
| `assets/` | App images and logos |
| `scripts/` | Asset-copying and Android build helpers |
| `tests/` | Node.js regression tests |
| `android/` | Capacitor Android project and APK build output |
| `www/` | Generated Capacitor web assets; do not edit these directly |
| `node_modules/` | Installed npm dependencies; generated locally |

Keep editable web files in the root. `npm run android:apk` copies those files into `www/` and the Android app before building, so edits made only in generated folders may be overwritten.

New accounts go through a three-step profile setup for display name, profile photo or default avatar, and skill level, with Skip and Back controls; the final “Queue up” button enters the app. Skipped details can be edited later on `profiles.html`, which also shows career stats. The queue combines the next match preview and the following players in one section, while showing each player's session game count and rotation status. A “New Session” action resets counts after confirmation without removing players. You can add/remove players, choose singles or doubles, enable “Stay with same partner” for established doubles teams, and choose the first server (or flip a coin). Jumble Queue shuffles only players tied for the lowest games-played count; players who are ahead stay in their current spots. If there are not enough eligible players for a full match, the queue is left unchanged. With “Stay with same partner” enabled, pairs stay together, and a pair with different game counts stays in place. Add a registered player by email to link their profile and automatically send a friend request if you are not already connected; their match stats sync after they accept. Unregistered emails and player names remain local players without a profile photo. Typing your own registered profile name links that queue entry to your account so its matches count toward your profile stats. The match preview includes a compact played/won/lost statsheet for the selected players. Start or resume a match to open the dedicated score tracker. The tracker uses the bundled court image to show players on their respective sides, with the current server, serving side, and live pickleball score call. Use the rally buttons to award points or change serve: only the serving side scores, singles service sides follow the server's score parity, and doubles uses Server 1/2 with the one-server opening rule. The **End Match** button saves the result and returns to the queue so the next match preview is ready. Each match start saves a snapshot of the full queue and its teams; completed scores, winners, participating players, and dates appear in the results history. Players can customize their own account nickname, profile picture, and skill level on `profiles.html`, then review their wins, losses, win rate, recent partner, last played, and records with regular doubles partners. `profiles.html` always shows only the signed-in user's profile; its stats combine synced match history with local completed matches not yet synced. On `friends.html`, search player nicknames, send and accept friend requests, and add friends (or yourself) to the queue. Supabase match records and profiles are shared between authenticated users; queue and match data are also retained locally in the same browser. Profile pictures are limited to 1 MB. Complete a match with non-tied scores to advance the fair-play rotation and update each player's played, won, and lost totals. The rotation prioritizes players who have not played in the current round; when everyone has had a game, it starts a new round.

## Supabase setup

1. In Supabase, open **SQL Editor**, paste and run [`supabase-setup.sql`](./supabase-setup.sql). It creates or updates the profile, friend, and shared match tables, row-level security policies, and server-side RPC functions, including profile setup fields, nickname search, and friend requests. Rerun this script after updating the app to install the latest schema and functions.
2. `supabase-config.js` contains the project's URL and client-safe publishable key. Only the publishable key belongs in this browser app; never put a `service_role` or secret key here.
3. In **Authentication → URL Configuration**, set the Site URL to your development origin (for VS Code Live Server, commonly `http://127.0.0.1:5500`) and add the origin and `/login.html` callback as redirect URLs. For Android, also add `com.example.piqueueball://auth/callback` as a redirect URL. Add your production domain and its `/login.html` callback before deploying.
4. Open `index.html` through VS Code Live Server (or another HTTP server), create an account, and confirm the email if Supabase requests it. Browser confirmation returns to `login.html`; Android confirmation opens the app through its `com.example.piqueueball://auth/callback` deep link. The app ID and callback scheme must match if you change the app ID. A resend button is available after signup. If the email is not delivered, check Supabase's SMTP and email-template settings. Sessions persist and valid returning sessions go directly to the queue.

Queue management, match generation, score tracking, queue and match history, and player totals are saved in this browser and work offline. Choose **Continue offline** on the welcome page to use those features without signing in; offline matches are stored on this device until they can sync online. Matches completed while signed in are associated with that account and sync automatically when online. Matches recorded without an account (including older local matches) require review and an explicit choice on `results.html` before they are assigned to a signed-in account; matches already assigned to another account are never synced by the current account. Supabase deduplicates results already synced for the same account. A match involving another registered account can sync only if that player is still an accepted friend. Match and profile data are readable by all authenticated users under the current row-level security policies. **Delete** on `totals.html` removes that player's local history and matches saved by your account; **Delete** on `results.html` removes a single match and its queue snapshot. Shared match records created by other accounts are not deleted. Online deletion requires rerunning `supabase-setup.sql` to install the account-restricted deletion functions. On `results.html`, **Export device data** downloads the locally stored queue, profile, and match data as JSON; it does not import data or export cloud-only history. When served from localhost or HTTPS, the app caches its files for offline use after the first visit. Supabase sign-in, registration, profiles, friends, and shared match history require a network connection.

Run the focused regression tests with Node.js 18 or later: `node --test tests/history-utils.test.cjs tests/logic.test.cjs`. Before deployment, serve the app over HTTPS, configure the production origin in Supabase's allowed redirect URLs, and verify sign-up, sign-in, friend-only match submission rules, and offline sync on the production domain.

Long match and queue histories are displayed 25 items at a time to keep page rendering responsive. Score edits are saved shortly after typing and flushed when leaving the page or switching away.

Buttons have a short press feedback animation, and links between app pages fade during navigation. System reduced-motion preferences disable the motion effects.

Replace assets/logo.png with a higher-res logo whenever you have one.

## Build for iOS

An APK is Android-only. For iOS, use the Capacitor iOS platform and build/sign an IPA on a Mac with Xcode; this cannot be built or signed on Windows. Install Node.js LTS and Xcode on the Mac, then in the project folder run:

```sh
npm install
npx cap add ios
npm run ios:sync
npx cap open ios
```

In Xcode, select your Apple developer team and bundle identifier, then use **Product → Archive** to create and distribute a signed iOS app. The `ios:sync` command stages the latest web files and syncs them into the iOS project. Apple signing, provisioning, and distribution require an Apple developer account.

## Build an Android APK

The Android app is a Capacitor wrapper around the same web app. Install Node.js LTS and Android Studio, then open a terminal in this project folder and run:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
npm.cmd install
npx.cmd cap add android
npm.cmd run android:apk
```

In Android Studio's setup wizard, install the Android SDK and accept its licenses if prompted. These commands use Android Studio's bundled Java runtime; adjust `JAVA_HOME` if Android Studio is installed elsewhere. `android:apk` stages the latest HTML, JavaScript, CSS, and image files in `www`, syncs them into the Android project, builds a debug APK, and names it `PiQueueBall.apk`. Find the APK at `android\app\build\outputs\apk\debug\PiQueueBall.apk`. To rebuild after web changes, run `npm.cmd run android:apk` again in the same terminal. To install it on a connected device with Android platform tools, run `cd android; .\gradlew.bat installDebug`.

The configured Android application ID is `com.example.piqueueball`; change `appId` in `capacitor.config.json` to an ID you own before distributing the app. If you change it, also update the native auth redirect URL in `supabase-config.js`, the `custom_url_scheme` in Android resources, and the allowed redirect URL in Supabase. Test Supabase sign-in, email confirmation, and password recovery on a device.
