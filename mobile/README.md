# Native Mobile Apps

This folder contains first-pass native clients for Pharma Search:

- `ios/` - SwiftUI iOS app, generated with XcodeGen
- `android/` - Kotlin + Jetpack Compose Android app

Both apps default to the deployed backend. Product search uses the same
ConnectRPC endpoints as the web app; account, watchlist, and alert actions use
the existing JSON endpoints.

## Backend

By default the native apps connect to the deployed backend:

```text
https://aposteka.rs
```

For local development, run the backend from the repository root and temporarily
point `APIEnvironment.defaultBaseURLString` / `ApiEnvironment.defaultBaseUrl` at
your local host URL:

```bash
go run .
```

The local mobile-only endpoints are served from the same port:

- `GET /api/mobile/featured?limit=24`
- `GET /api/mobile/search/groups?q=vitamin+d&offset=0&limit=24`
- `GET /api/mobile/facets`
- `GET /api/mobile/autocomplete?q=vitamin&limit=8`
- `GET /api/mobile/price-comparison?q=vitamin+d`
- `POST /api/mobile/push-token` with bearer auth, `platform`, `token`, and `appVersion`

Native login and watchlist screens use the existing account and watchlist endpoints:

- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/watch`
- `POST /api/watch`
- `POST /api/watch/remove`
- `GET /api/alerts`

## iOS

The iOS app defaults to the deployed backend. For local development, the iOS
simulator host URL is:

```text
http://localhost:50051
```

Generate/open the Xcode project:

```bash
cd mobile/ios
xcodegen generate
open PharmaSearch.xcodeproj
```

The app entry point is `PharmaSearch/PharmaSearchApp.swift`; the main UI is in `PharmaSearch/ContentView.swift`.

The iOS app stores the bearer token in Keychain. After sign-in, it asks for notification permission and uploads the APNs device token to `/api/mobile/push-token` when iOS returns one. A real device build needs the Push Notifications capability and APNs environment entitlement enabled in Xcode.

## Android

The Android app defaults to the deployed backend. For local development, the
Android emulator host URL is:

```text
http://10.0.2.2:50051
```

Open `mobile/android` in Android Studio and run the `app` configuration. The project is a standard Gradle Android application; Android Studio can provision or use its bundled Gradle if no command-line Gradle is installed.

The app entry point is `app/src/main/java/rs/aposteka/pharmasearch/MainActivity.kt`.

The Android app stores the bearer token in app-private preferences. After sign-in, it attempts to read a Firebase Cloud Messaging token and upload it to `/api/mobile/push-token`. Wire the Firebase app config for this package, including the Google Services Gradle plugin and `google-services.json`, before expecting a real FCM token on devices.

The backend CORS config already allows mobile/web development clients.
