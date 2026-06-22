# steam-session — Authentication (v1.9.4)

## steam-session — Authentication (v1.9.4)

The `steam-session` library handles Steam login at the HTTP API level (not the
CM protocol). `steam-user` uses it internally for password/QR login before
switching to CM-level token authentication. You only need to interact with it
directly if you want web cookies without a full CM connection, or for
MobileApp/WebBrowser tokens.

**Requirements:** Node.js v12.22.0+

### Login Flow

```
LoginSession(platformType)
  │
  ├─ startWithCredentials({accountName, password, steamGuardCode?, steamGuardMachineToken?})
  │   └─ POST api.steampowered.com/IAuthenticationService/BeginAuthSessionViaCredentials
  │       ├─ Encrypts password (RSA public key + AES session key)
  │       └─ Returns allowedConfirmations[] — guards to satisfy
  │
  ├─ startWithQR()
  │   └─ POST BeginAuthSessionViaQR → returns qrChallengeUrl → start polling
  │
  ├─ submitSteamGuardCode(authCode)
  │   └─ EmailCode → EResult.InvalidLoginAuthCode(65) if wrong
  │   └─ DeviceCode → EResult.TwoFactorCodeMismatch(88) if wrong
  │
  └─ polling (PollAuthSessionStatus every pollInterval seconds)
      ├─ remoteInteraction — user viewed prompt in mobile app
      ├─ steamGuardMachineToken — new machine token (email Steam Guard)
      └─ authenticated → refreshToken + accessToken
          ├─ getWebCookies() → ['steamLoginSecure=...', 'sessionid=...']
          ├─ refreshAccessToken() → fresh access token
          └─ renewRefreshToken() → true if new refresh token issued
```

### Key Enums

**`EAuthTokenPlatformType`** — determines transport and token audience:
| Value | Transport | Token aud |
|-------|-----------|-----------|
| `SteamClient` (1) | WebSocketCMTransport (CM wss://) | `['web','client']` |
| `WebBrowser` (2) | WebApiTransport (api.steampowered.com) | `['web']` |
| `MobileApp` (3) | WebApiTransport | `['web','mobile']` |

**`EAuthSessionGuardType`:**
| Value | Meaning | Handler |
|-------|---------|---------|
| `None` (0) | No guard | Direct `_doPoll()` |
| `EmailCode` (1) | Email Steam Guard code | `submitSteamGuardCode(code)` |
| `DeviceCode` (2) | TOTP code (mobile authenticator) | `submitSteamGuardCode(code)` |
| `DeviceConfirmation` (3) | Approve in mobile app | Polling — `remoteInteraction` when viewed |
| `EmailConfirmation` (4) | Click link in email | Polling only |
| `MachineToken` (5) | Machine auth token (email SG bypass) | Auto-handled if token provided |

**`ESessionPersistence`:** `Persistent`(1) — normal login. `Ephemeral`(2) — temporary.

### How steam-user Uses It

```
steam-user logOn({ accountName, password })
  │
  ├─ Internally creates: new LoginSession(EAuthTokenPlatformType.SteamClient)
  ├─ await session.startWithCredentials({accountName, password})
  ├─ If actionRequired → emit 'steamGuard' event → user provides code
  │   └─ await session.submitSteamGuardCode(code)
  ├─ session.on('authenticated'):
  │   ├─ refreshToken = session.refreshToken
  │   └─ emit('refreshToken', refreshToken)  ← you save this
  └─ Then: send ClientLogon (EMsg 5514) with refreshToken over CM protocol
```

### Direct Usage (obtain web cookies without CM connection)

```js
import {LoginSession, EAuthTokenPlatformType} from 'steam-session';

// Get web cookies from existing refresh token:
let session = new LoginSession(EAuthTokenPlatformType.WebBrowser);
session.refreshToken = 'eyAidHlwIjogIkpXVCIsICJhbGciOiAiRWREU0EiIH0...';
let cookies = await session.getWebCookies();
// → ['steamLoginSecure=...', 'sessionid=...']

// Full password login with Steam Guard code:
let session2 = new LoginSession(EAuthTokenPlatformType.WebBrowser);
session2.loginTimeout = 60000;
let resp = await session2.startWithCredentials({
  accountName: 'user',
  password: 'pass',
  steamGuardCode: 'ABC12'  // optional upfront code
});
if (resp.actionRequired) {
  // resp.validActions: [{type: EAuthSessionGuardType.DeviceCode}, ...]
  await session2.submitSteamGuardCode(getCode());
}
session2.on('authenticated', async () => {
  console.log('Refresh token:', session2.refreshToken);
  let cookies = await session2.getWebCookies();
});
```

### Transport & Proxy

Default transport is auto-selected by platform type. Custom proxy via constructor:
```js
new LoginSession(EAuthTokenPlatformType.WebBrowser, {
  socksProxy: 'socks5://127.0.0.1:10808',
  // or: httpProxy: 'http://127.0.0.1:10809',
  // or: localAddress: '1.2.3.4',
});
```

### LoginApprover — Approve QR Login From Another Account

```js
import {LoginApprover} from 'steam-session';
let approver = new LoginApprover(mobileAppAccessToken, sharedSecret);
let info = await approver.getAuthSessionInfo(qrChallengeUrl);
// info: { ip, location: {geoloc, city, state}, deviceFriendlyName, ... }
await approver.approveAuthSession({qrChallengeUrl, approve: true, persistence: ESessionPersistence.Persistent});
```

---
