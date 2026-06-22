# iFicam by @Ungyani

Windows 11 desktop app that will turn an iPhone into a wireless HD webcam and PC-side recorder over LAN WiFi.

## Milestone Status

1. App skeleton + dark UI shell: complete.
2. Local HTTPS server + self-signed cert: ready for manual iPhone verification.
3. WebRTC live stream phone to PC: not started.
4. QR + PIN pairing: not started.
5. PC-side recording: not started.
6. Two-way control: not started.
7. Polish + packaging: not started.
8. About screen: not started.

## Development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run dist
```

## Milestone 2 HTTPS Test

1. Run the app with `npm.cmd run dev`.
2. Copy the LAN URL shown in the Setup panel, for example `https://192.168.1.42:8443`.
3. On an iPhone connected to the same WiFi, open the URL in Safari.
4. For the quick path, tap **Show Details**, then **visit this website**.
5. Confirm the page says **Secure iPhone page is working**.

The generated certificate is cached under Electron `userData` and regenerated when the advertised LAN IP changes. Its Subject Alternative Name includes the LAN IP, which iOS requires.

## Certificate Trust Flow

The setup panel exposes `/ificam-cert.crt` through the same HTTPS server. For the no-friction path, download the certificate on the iPhone, install the profile, then enable full trust in Certificate Trust Settings.
