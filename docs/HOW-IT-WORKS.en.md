# How it works

**English** | [עברית](HOW-IT-WORKS.md)

## Overview

```text
 Windows PC                                   LG TV (webOS)
┌───────────────────────────────┐            ┌──────────────────────┐
│ Renderer: remote and screen   │            │                      │
│   src/renderer                │            │ SSAP       :3001 wss │
│        │ IPC (named actions)  │            │ commands             │
│        ▼                      │   wss      │                      │
│ Main: connection, view, store │◄──────────►│ Pointer socket       │
│   src/main/main.js            │            │ buttons and mouse    │
│   src/main/webos.js           │   http     │                      │
│   src/main/store.js           │◄───────────│ Screenshot file      │
└───────────────────────────────┘            └──────────────────────┘
```

The app is built with Electron. All communication with the TV happens in the main process, and the interface can only trigger a fixed list of actions.

## The three channels

### 1. Commands (SSAP)

Commands are JSON messages over a secure WebSocket on port 3001, falling back to plain `ws` on port 3000. The TV has a self-signed certificate, so it can't be verified.

```json
{ "type": "request", "id": "req_1", "uri": "ssap://audio/setVolume", "payload": { "volume": 20 } }
```

| Action | URI |
|---|---|
| List apps | `ssap://com.webos.applicationManager/listLaunchPoints` |
| Open an app | `ssap://com.webos.applicationManager/launch` |
| Running app | `ssap://com.webos.applicationManager/getForegroundAppInfo` |
| Inputs | `ssap://tv/getExternalInputList`, `ssap://tv/switchInput` |
| Volume | `ssap://audio/getVolume`, `setVolume`, `setMute` |
| Typing | `ssap://com.webos.service.ime/insertText`, `deleteCharacters`, `sendEnterKey` |
| Turn off | `ssap://system/turnOff` |
| Screen only | `ssap://com.webos.service.tvpower/power/turnOffScreen`, `turnOnScreen` |
| TV details | `ssap://system/getSystemInfo`, `ssap://com.webos.service.update/getCurrentSWInformation` |
| MAC addresses | `ssap://com.webos.service.connectionmanager/getinfo` |

### 2. Buttons and mouse (pointer socket)

`ssap://com.webos.service.networkinput/getPointerInputSocket` returns the address of a second WebSocket, which carries text messages:

```text
type:button
name:HOME

type:move
dx:5
dy:-3
down:0

type:click

type:scroll
dx:0
dy:-1

```

Movement is relative, so there's no "click at X,Y" command. The app uses the browser's Pointer Lock API to get raw mouse movement, and sends it in batches every 16 ms.

#### The pointer drawn over the picture

Screenshots leave out the TV's pointer, and no API reports its position. The app estimates it instead:

1. When capture starts, the app pushes the pointer into the top-left corner, giving a known start.
2. For each movement, it calculates the distance with `gain = 0.5 + 0.25 × speed`, because the TV accelerates the pointer according to speed.
3. The position stops at the screen edges, so reaching an edge corrects drift.

The formula was measured on an OLED55C6 at slow and medium speed: 2 units per event gave a ratio of about 1, and 10 units gave about 3. At higher speeds and on other models it's only an estimate.

### 3. Viewing (screenshots)

`ssap://tv/executeOneShot` returns an `imageUri`. The app downloads that image and displays it, in a loop: capture, download, display, then the next capture. The rate is therefore limited by what the TV can deliver, and this isn't a video stream.

The tested TV delivered 960×540 at about 3–4 pictures per second, including live TV.

The TV returns addresses containing its home network IP. The app replaces them with the address it connected to, so that over a VPN it keeps talking to the same TV and not to some other device.

## Pairing

```text
App                                     TV
 │ register (signed, client-key if any)  │
 ├──────────────────────────────────────►│
 │  403 blacklisted certificate          │  newer firmware
 │◄──────────────────────────────────────┤
 │ register again, without the signature │
 ├──────────────────────────────────────►│
 │  pairingType: PROMPT                  │
 │◄──────────────────────────────────────┤
 │                                       │  user accepts on the remote
 │  registered + client-key              │
 │◄──────────────────────────────────────┤
```

- **The signature:** open-source clients use an old public signature, which newer firmware blocks. The app tries with it first, to support older TVs, then without it. Without the signature, the TV may grant fewer permissions.
- **The approval:** the TV's owner approves on the TV screen in either case.
- **The key:** the `client-key` is stored encrypted with DPAPI in `tvs.json`, in the app's data folder. A rejected key triggers a new pairing.
- **PIN pairing:** the app registers with `pairingType: PIN` and sends the code to `ssap://pairing/setPin`.

## Finding the TV and waking it

- **Discovery:** an SSDP search on UDP port 1900 for `urn:lge-com:service:webos-second-screen:1`. It only works on the local network.
- **Waking:** a standard Wake-on-LAN magic packet, broadcast on UDP port 9, to the MAC addresses saved during an earlier connection.

## Staying connected

- A ping every 10 seconds detects a dead connection, such as when a VPN drops.
- Reconnection attempts wait progressively longer, from 2 up to 30 seconds.
- A view that fails 3 times in a row stops with a message, and control keeps working.

## Security

- The interface runs with `contextIsolation` and `sandbox` on, and `nodeIntegration` off.
- A strict Content Security Policy allows no external scripts, and images only as `data:`.
- App names from the TV are displayed as text rather than HTML, and a test covers this.
- Button names are checked against a fixed list, so fields can't be injected into the protocol.
- Image downloads are limited to 20 MB and to image types.

## Code layout

| File | Purpose |
|---|---|
| `src/main/webos.js` | The TV protocol, with no Electron dependency |
| `src/main/manifest.js` | The permissions the app requests |
| `src/main/main.js` | Window, reconnection, view loop, IPC |
| `src/main/store.js` | Saved TVs and keys |
| `src/main/preload.js` | The bridge between the interface and the main process |
| `src/renderer/` | The interface |
| `src/renderer/i18n.js` | English and Hebrew text |
| `install.ps1` | The one-line PowerShell installer |
| `tests/fake-tv.js` | The simulated TV |
| `tests/webos.test.js` | Protocol tests |
| `tests/e2e.js` | Test of the full app |
| `tests/packaged-smoke.js` | Test of the packaged build |
| `tests/real-tv-check.js` | Check against a real TV |
| `tests/real-pointer-probe.js` | Compares the estimated pointer with a real TV |
| `tests/docs-screenshots.js` | Creates the documentation pictures |

## Sources

LG doesn't officially document this API, and its behavior may change with a firmware update. The protocol is based on:

- [aiowebostv](https://pypi.org/project/aiowebostv/)
- [lgtvremote-cli](https://pypi.org/project/lgtvremote-cli/)
- [Community notes on screen capture](https://gist.github.com/Informatic/1983f2e501444cf1cbd182e50820d6c1)
- [Report of the blocked signature in Home Assistant](https://github.com/home-assistant/core/issues/179669)
