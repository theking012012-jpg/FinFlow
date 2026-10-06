# FinFlow — native app shell (Capacitor)

This folder wraps the FinFlow web app into native **iOS** and **Android** apps for the App Store
and Google Play. It is **self-contained** — it has its own `package.json` and does not touch the
server backend or the Railway build.

**Default approach:** the native app is a native shell whose WebView loads the live app
(`server.url` in `capacitor.config.json`). This is the fastest route to the stores and means the
apps always show the current web app with no rebuild. See *App Store review* below for the one
caveat and how the included native plugins address it.

---

## One-time setup (on your Mac for iOS; any OS for Android)

```bash
cd mobile
npm install
npx cap add ios        # creates mobile/ios/      (needs macOS + Xcode)
npx cap add android    # creates mobile/android/   (needs Android Studio)
npx cap sync
```

`cap add` generates the native projects; commit `mobile/ios/` and `mobile/android/` after.

## Point it at your domain

`capacitor.config.json` → `server.url` is set to the Railway URL. When you launch on your custom
domain, change it to `https://app.finflow.app/app` (and keep the entry in `allowNavigation`).

## Build & run

- **iOS:** `npx cap open ios` → Xcode → set your Team (signing), a Bundle ID matching `appId`
  (`app.finflow`), run on a simulator/device.
- **Android:** `npx cap open android` → Android Studio → Run.

## Icons & splash

Put a 1024×1024 `icon.png` and a splash image in `mobile/resources/`, then:
```bash
npm i -D @capacitor/assets
npx capacitor-assets generate
```
This produces every required icon/splash size for both platforms.

---

## Submitting (needs YOUR developer accounts)

- **Apple App Store** — Apple Developer Program ($99/yr). In Xcode: Product → Archive →
  Distribute App → App Store Connect. Create the listing (screenshots, privacy details, description)
  at appstoreconnect.apple.com.
- **Google Play** — Play Console ($25 one-time). In Android Studio: Build → Generate Signed
  Bundle (AAB). Upload at play.google.com/console with the store listing.

Both require: app icon, screenshots, a privacy policy URL, and a data-safety / privacy-nutrition
declaration (FinFlow handles financial data — declare what's collected and that it's encrypted
in transit).

---

## App Store review — the one thing to know

Apple guideline **4.2 (minimum functionality)** can reject apps that are *only* a website wrapper.
To clear it, the app should use at least one native capability. The deps in `package.json` are the
tools for that — wire one or more before submitting iOS:

- **`@capacitor/camera`** — native receipt capture for FinFlow's AI scan (strongest signal; it's a
  real device feature the web can't match as cleanly).
- **`@capacitor/push-notifications`** — payment reminders / overdue alerts as push.
- **Biometric unlock** (add `capacitor-native-biometric`) — Face ID / fingerprint to open the app.

A short bridge in the web app can detect Capacitor (`window.Capacitor`) and call these plugins when
present, falling back to the web behavior in a browser. Google Play is far more lenient about
wrappers; iOS is the one to harden.

> Scope note: this scaffold gets you buildable native apps pointed at production. The store
> accounts, signing, screenshots, privacy declarations, and (for iOS) wiring at least one native
> plugin are the remaining steps — all require your accounts and are documented above.
