# TV Anywhere

**English** | [עברית](README.he.md)

An app on the TV shows an ID and a password that change every week. Type them into the phone app to control the TV from anywhere.

> **This is an early preview, and it isn't finished.** It has never completed a real connection on a real TV. See [Status](#status) before you rely on it.

## Status

| Part | State |
|---|---|
| Weekly ID and password, encryption, blocking repeated guesses | Works in automated tests |
| Phone app | Works in automated tests in a phone-sized desktop browser. Not tried on a real phone |
| Relay on Cloudflare | Works in automated tests on Cloudflare's local simulator. Not yet deployed anywhere |
| LG app | Installs and opens on a real LG OLED55C6. Controlling that TV has **not** been confirmed |
| Android TV app | **Not written** |
| Samsung app | **Not written** |

**Still unknown on LG:**

- Whether the app can control its own TV through the TV's local interface.
- Whether it keeps running after you switch to another app. If it doesn't, the app has to stay open on the TV.
- Whether a screen picture can reach the phone.

**Known limits:**

- **Turning the TV on:** an app on a TV that's off can't run, so the TV can't be turned on from outside the home.
- **Developer Mode on LG:** installing needs Developer Mode, which LG enables for a limited time. Once that time runs out, the app stops opening until the app is installed again. Extend it in LG's Developer Mode app while time remains.
- **Samsung:** a developer has reported that a TV app can't reach the TV's local remote interface, so this approach may not work there.

## Setup

You need [Node.js](https://nodejs.org), the [webOS CLI](https://webostv.developer.lge.com/develop/tools/cli-installation) set up with your TV in Developer Mode, and a free [Cloudflare](https://dash.cloudflare.com/sign-up) account.

```bash
git clone https://github.com/dor2500/universal-tv-remote.git
```

```bash
cd universal-tv-remote
```

```bash
npm install
```

```powershell
powershell -ExecutionPolicy Bypass -File anywhere\setup.ps1
```

The script:

1. Opens a browser so you can sign in to Cloudflare.
2. Puts the relay and the phone app online on your account, and prints their address.
3. Builds the LG app for that address, installs it on the TV and opens it.

Accept the request on the TV with its remote. Then open the printed address on your phone, and add it to your home screen.

Cloudflare's free plan has daily limits. Showing the TV's screen uses far more of them than pressing buttons.

## Using it

1. Open TV Anywhere on the TV. It shows the ID and password.
2. Type them into the phone app.
3. The TV shows that a phone is connected.

The codes change by themselves every Monday at 00:00 UTC. To change them right away, press OK on the TV's remote in the app.

## Security

- **Who can read your session:** phone and TV encrypt everything between them, so the relay can't read it.
- **Guessing online:** after 5 wrong passwords, the TV blocks attempts for a time that doubles with each further failure.
- **Guessing offline:** someone who records a session at the relay could try passwords on their own computer. The password has about 50 bits of randomness, and the weekly change limits how long it stays useful.
- **What the codes allow:** full control of the TV, including turning it off. Treat them like a house key.
- **This code hasn't had a security review.**

## How it works

```text
Phone app  ──wss──►  Relay on Cloudflare  ◄──wss──  App on the TV ──local interface──► TV
           sealed messages the relay can't read
```

The TV connects out to the relay, so no router ports need opening. The ID picks the room at the relay. The password never travels: both sides derive a key from it and prove they hold the same one.

| Folder | Purpose |
|---|---|
| `shared/session.js` | Weekly codes and encryption |
| `agent/` | The app on the TV. `core.js` is shared, `adapter-webos.js` is the LG part |
| `relay/` | `worker.js` for Cloudflare, `server.js` for testing or self-hosting |
| `phone/` | The phone app |
| `build.js`, `setup.ps1` | Building and installing |

## Tests

```bash
npm test
```

```bash
npm run test:anywhere
```
