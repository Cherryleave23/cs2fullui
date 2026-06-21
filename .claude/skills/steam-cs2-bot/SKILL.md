---
name: steam-cs2-bot
description: 'Reference for steam-user, globaloffensive, and ByMykel/CSGO-API. Use when writing or debugging Steam bots, CS2 trade tools, or any code that needs to resolve CS2 item IDs to human-readable names/rarities/images.'
argument-hint: '[topic: auth|trade|inventory|chat|friends|cs2|cdn|tickets|crafting|storage|csgoapi|skins|stickers|crates]'
allowed-tools: 'Bash(git:*), Bash(npm:*), Read, Write, Edit, Glob, Grep, WebFetch, WebSearch'
disable-model-invocation: false
---

# Steam + CS2 Bot Development

Reference for `steam-user` (v5.x) and `globaloffensive` (v3.3.0) —
both by [DoctorMcKay](https://github.com/DoctorMcKay). Node.js v14+
required, steam-user ≥ v4.2.0 for globaloffensive.

**Source repositories:**
- [`steam-user`](https://github.com/DoctorMcKay/node-steam-user) — Steam client protocol
- [`globaloffensive`](https://github.com/DoctorMcKay/node-globaloffensive) — CS2 Game Coordinator
- [`CSGO-API`](https://github.com/ByMykel/CSGO-API) — static JSON data: skins, stickers, crates, etc.
- [`steam-session`](https://github.com/DoctorMcKay/node-steam-session) — Steam authentication (used internally by steam-user)

---

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

## When to Use

Invoke this skill whenever you are:
- Writing code that imports `steam-user` or `globaloffensive`
- Debugging Steam authentication, connection, or session issues
- Working with CS2 inventory, item inspection, crafting, or storage units
- Implementing Steam chat, friends, or persona features
- Setting up CDN depot downloads or app auth tickets
- Configuring family sharing or trade URLs
- Looking up Steam/CS2 enum values, event signatures, or method parameters
- Understanding the Steam protocol wire format or GC message routing
- Resolving CS2 weapon `def_index`, `paint_index`, `sticker_id`, `rarity`, or `crate` IDs to human-readable names, colors, and images
- Looking up skin wear ranges (min_float/max_float), market hash names, or collection/crate contents
- Fetching static CS2 item data (skins, stickers, crates, agents, keychains, music kits, etc.) via the CSGO-API JSON endpoints
现在将汰换交易包装成一个函数，让其有可重复调用的能力，输入参数即为10个物品的
Use `/steam-cs2-bot [topic]` to narrow focus, or invoke without arguments for
the full reference.

---

## Quick Start / Skeleton

```js
const SteamUser = require('steam-user');
const GlobalOffensive = require('globaloffensive');

const client = new SteamUser({
  enablePicsCache: true,         // REQUIRED for ownership/owns checks
  changelistUpdateInterval: 60000,
  language: 'english',
});

const csgo = new GlobalOffensive(client);
// Validates steam-user >= 4.2.0 by checking packageName/packageVersion

client.on('loggedOn', () => {
  client.setPersona(SteamUser.EPersonaState.Online);
  client.gamesPlayed([730]);         // → CS2 GC connection
});

client.on('error', (err) => {        // MUST handle — unhandled = crash
  console.error('Fatal:', err.eresult);
  process.exit(1);
});

client.logOn({ refreshToken: '...' });
```

### Class Inheritance Chain

```
EventEmitter
  SteamUserBase       → HandlerManager, exponential backoff
  SteamUserEnums      → ~220+ auto-generated Steam enums
  SteamUserConnection → CM discovery, protocol selection
  SteamUserMessages   → Wire protocol, protobuf routing, _send()
  SteamUserUtility    → formatCurrency()
  SteamUserFileStorage→ _saveFile/_readFile, storage engine
  SteamUserWebAPI     → _apiRequest (api.steampowered.com)
  SteamUserWeb        → webLogOn(), webSession event
  SteamUserMachineAuth→ Machine auth token persistence
  SteamUserLogon      → logOn() — all auth methods
  SteamUserAccount    → accountInfo, emailInfo, wallet, vacBans, gifts, privacy
  SteamUserAppAuth    → Encrypted tickets, auth session tickets
  SteamUserApps       → gamesPlayed, ownership, PICS, product info
  SteamUserCDN        → Depot downloads, manifests, chunks
  SteamUserChat       → Legacy chat (deprecated)
  SteamUserEcon       → Asset class info, trade URL, emoticons, profile items
  SteamUserFamilySharing → Library sharing
  SteamUserFriends    → Personas, friends, groups, nicknames, rich presence
  SteamUserGameCoordinator → sendToGC(), GC message routing
  SteamUserGameServers→ Server queries (GMSServerQuery)
  SteamUserNotifications → tradeOffers, newItems, notifications
  SteamUserPublishedFiles → Workshop files
  SteamUserStore      → Store tag names
  SteamUserTrading    → trade(), cancelTradeRequest() (deprecated)
  SteamUserTwoFactor  → enableTwoFactor(), finalizeTwoFactor()
  SteamUser           → Final exported class
```

---

## Connection & Authentication

### CM Discovery & Selection

1. `_doConnection()` fetches CM list from `ISteamDirectory/GetCMListForConnect/v1`
2. Filters to `realm == 'steamglobal'`
3. Sorts by `wtd_load`, picks random from top 5
4. Removes blacklisted CMs (TTL cache `CM_DQ_<type>_<endpoint>`, 2 min)
5. Instantiates transport based on `type` field:
   - `'netfilter'` → TCPConnection
   - `'websockets'` → WebSocketConnection

### Protocol Options

| Constant | Value | Notes |
|----------|-------|-------|
| `PROTOCOL_VERSION` | `65580` | Sent in ClientHello + ClientLogon |
| `PROTO_MASK` | `0x80000000` | Bitmask on EMsg for protobuf-encoded messages |
| `JOBID_NONE` | `'18446744073709551615'` | Max uint64 string for null job ID |

### TCP Protocol (netfilter)

Three-message encryption handshake before logon:
1. CM → Client: `ChannelEncryptRequest` (EMsg 1303) — nonce (16B) + protocol + universe
2. Client → CM: `ChannelEncryptResponse` (EMsg 1304) — DH session key + CRC32
3. CM → Client: `ChannelEncryptResult` (EMsg 1305) — OK → `sessionKey` set, `_sendLogOn()` called

Wire format: `[4B LE length][4B MAGIC "VT01"][encrypted or plain body]`
Traffic encrypted with `SteamCrypto.symmetricEncryptWithHmacIv()` once sessionKey is established.

### WebSocket Protocol (websockets)

- Connection URL: `wss://{endpoint}/cmsocket/`
- Uses TLS — NO ChannelEncrypt handshake
- 30-second ping interval
- `_sendLogOn()` called immediately on connect
- SOCKS proxy forces WebSocket (`httpProxy` works with both)

### webCompatibilityMode

When `true`: forces WebSocket transport, filters to port 443 servers only
(critical for restrictive firewalls).

### Exponential Backoff

| Name | Min | Max | Used for |
|------|-----|-----|----------|
| `logOn` | 1s | 60s | Connection retry |
| `webLogOn` | 1s | 60s | Web session retry |

Initial `_connectTimeout` is 1000ms, doubles each failure up to 10000ms.

---

### Logon Methods

#### Auth Method Validation Rules

| Method | Required | Forbidden | Optional |
|--------|----------|-----------|----------|
| **Refresh Token** | `refreshToken` | accountName, password, authCode, twoFactorCode, machineAuthToken, webLogonToken | `steamID` (verified if given), `logonID`, `machineName`, `clientOS` |
| **Password + 2FA** | `accountName`, `password` | webLogonToken, steamID | `machineAuthToken`, `authCode`, `twoFactorCode`, `logonID`, `machineName`, `clientOS` |
| **Web Logon Token** | `accountName`, `webLogonToken`, `steamID` | password, machineAuthToken, authCode, twoFactorCode, logonID, machineName, clientOS | — |
| **Anonymous** | `anonymous: true` | accountName, password, refreshToken, authCode, twoFactorCode, machineAuthToken, webLogonToken | `machineName`, `clientOS` |

**Password Logon Flow:**
1. Sends `ClientHello` (EMsg 9805) with `protocol_version: 65580`
2. Uses `steam-session` library's `LoginSession` with `CMAuthTransport`
3. Calls `session.startWithCredentials({accountName, password, steamGuardMachineToken, steamGuardCode})`
4. On `'authenticated'`: stores refresh token, emits `'refreshToken'`, continues with token logon
5. If `actionRequired`: synthesizes appropriate EResult for Steam Guard

**Refresh Token Logon:**
- JWT is decoded (no verification) to validate `iss == 'steam'` and `aud` includes `'client'`
- SteamID extracted from `sub` claim
- Sends `ClientLogon` (EMsg 5514) directly — no ClientHello/steam-session needed

**`LogOnDetails` object:**
```js
{
  anonymous, refreshToken, accountName, password,
  machineAuthToken, webLogonToken, steamID, authCode, twoFactorCode,
  logonID, machineName, clientOS
}
```
- `logonID`: a uint32 (from `obfuscated_private_ip`). Can also be an IPv4 address string like `"192.168.1.5"`.
- `clientOS`: from `EOSType` enum; auto-detected if not provided via `getOsType()`.
- `machineName`: displayed on steamcommunity.com when viewing your games list.

### Steam Guard Event

```js
client.on('steamGuard', (domain, callback, lastCodeWrong) => {
  // domain = null for TOTP, or email domain string
  // lastCodeWrong: if true, WAIT 30 SECONDS before providing a new TOTP code
  //                to avoid temporary IP ban
  callback(getCode());
});
```

If no listener is bound, steam-user prompts via stdin.

### Connection Events

| Event | Data | Notes |
|-------|------|-------|
| `loggedOn` | `(body: ClientLogonResponse, parental: object|null)` | Auth complete; `body` has `heartbeat_seconds` |
| `disconnected` | `(eresult, msg)` | Non-fatal disconnect; auto-relogin if `autoRelogin: true` |
| `error` | `(err)` | Fatal error; `err.eresult` available. **Must be handled** |
| `steamGuard` | `(domain, callback, lastCodeWrong)` | Prompt for auth code |
| `refreshToken` | `(token)` | New JWT refresh token — **save this** |
| `machineAuthToken` | `(token)` | New sentry file token (email Steam Guard) |
| `contentServersReady` | `()` | CDN content server list is available |

### Web Session

```js
client.webLogOn();  // Called automatically after logon
// Uses exponential backoff on failure (1-60s)
// Generates sessionid= and clientsessionid= cookies via crypto.randomBytes if missing
```

Event: `webSession(sessionID, cookies[])` — cookies are `name=value` strings ready for steamcommunity.com.

---

## SteamChatRoomClient (Modern Chat)

Accessed via `client.chat`. This is the **current** chat API. The old `chatMessage()`, `joinChat()`, etc. on `SteamUser` are deprecated.

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `createGroup` | `(inviteeSteamIds?, name?, cb?)` → `{chat_group_id, state, user_chat_state}` | Create chat group |
| `saveGroup` | `(groupId, name, cb?)` | Save unnamed ad-hoc group |
| `getGroups` | `(cb?)` → `{chat_room_groups}` | List all joined groups |
| `setSessionActiveGroups` | `(groupIDs, cb?)` | Set which groups get member change events |
| `joinGroup` | `(groupId, inviteCode?, cb?)` | Join group |
| `leaveGroup` | `(groupId, cb?)` | Leave group |
| `inviteUserToGroup` | `(groupId, steamId, cb?)` | Invite friend to group |
| `createInviteLink` | `(groupId, options?, cb?)` | Create invite link (default 1h validity) |
| `getGroupInviteLinks` | `(groupId, cb?)` | List active invite links |
| `deleteInviteLink` | `(linkUrl, cb?)` | Revoke invite link |
| `getInviteLinkInfo` | `(linkUrl, cb?)` | Decode `s.team/chat/...` link |
| `getClanChatGroupInfo` | `(clanSteamID, cb?)` | Get clan's chat group info |
| `sendFriendMessage` | `(steamId, message, options?, cb?)` | Send DM to friend |
| `sendFriendTyping` | `(steamId, cb?)` | Send typing indicator |
| `sendChatMessage` | `(groupId, chatId, message, cb?)` | Send to chat channel |
| `getActiveFriendMessageSessions` | `(options?, cb?)` | Active conversations |
| `getFriendMessageHistory` | `(friendSteamId, options?, cb?)` | Message history with friend |
| `getChatMessageHistory` | `(groupId, chatId, options?, cb?)` | Channel message history |
| `ackFriendMessage` | `(friendSteamId, timestamp)` | Mark friend messages read |
| `ackChatMessage` | `(chatGroupId, chatId, timestamp)` | Mark channel messages read |
| `deleteChatMessages` | `(groupId, chatId, messages, cb?)` | Delete messages |
| `createChatRoom` | `(groupId, name, options?, cb?)` | Create channel in group |
| `renameChatRoom` | `(groupId, chatId, newName, cb?)` | Rename channel |
| `deleteChatRoom` | `(groupId, chatId, cb?)` | Delete channel |
| `kickUserFromGroup` | `(groupId, steamId, expireTime?, cb?)` | Kick user |
| `getGroupBanList` | `(groupId, cb?)` | Get ban list |
| `setGroupUserBanState` | `(groupId, userSteamId, banState, cb?)` | Ban/unban user |
| `setGroupUserRoleState` | `(groupId, userSteamId, roleId, roleState, cb?)` | Assign/remove role |

### Key Events on `client.chat`

| Event | Payload |
|-------|---------|
| `friendMessage` | `{steamid_friend, chat_entry_type, message, message_bbcode_parsed, server_timestamp: Date, ordinal, local_echo}` |
| `friendMessageEcho` | Same as above with `local_echo: true` |
| `friendTyping` | Friend typing event |
| `chatMessage` | `{chat_group_id, chat_id, steamid_sender, message, server_timestamp, ordinal, mentions?, server_message?}` |
| `chatMessagesModified` | `{chat_group_id, chat_id, messages: [{server_timestamp, ordinal, deleted}]}` |
| `chatRoomGroupSelfStateChange` | `{chat_group_id, user_action, user_chat_group_state, group_summary}` |
| `chatRoomGroupMemberStateChange` | `{chat_group_id, member, change}` |
| `chatRoomGroupHeaderStateChange` | `{chat_group_id, header_state}` |
| `chatRoomGroupRoomsChange` | `{chat_group_id, default_chat_id, chat_rooms}` |

---

## Account & Profile Management

### Account Properties and Events

| Property | Event | Event Data |
|----------|-------|------------|
| `accountInfo` | `accountInfo` | `(name, country, authedMachines, flags, facebookID?, facebookName?)` |
| `emailInfo` | `emailInfo` | `(address, validated)` |
| `limitations` | `accountLimitations` | `(limited, communityBanned, locked, canInviteFriends)` |
| `vac` | `vacBans` | `(numBans, appids[], ranges[][])` |
| `wallet` | `wallet` | `(hasWallet, currency: ECurrencyCode, balance)` — balance already /100 |
| `vanityURL` | `vanityURL` | `(url)` |
| `licenses` | `licenses` | `(licenses[])` — `CMsgClientLicenseList.License` objects |
| `gifts` | `gifts` | `(gifts[])` — `gid` as string, `Time*` as Date |

All these events suppress duplicate emissions when data is unchanged.

### Account Methods

```js
client.requestValidationEmail([cb])                     // Request validation email
client.getSteamGuardDetails([cb])                       // SG status + canTrade boolean
client.getCredentialChangeTimes([cb])                   // Last password/email change dates
client.getAuthSecret([cb])                              // Auth secret for in-home streaming
client.getPrivacySettings([cb])                         // Privacy states
```

**`canTrade` check** (from `getSteamGuardDetails`): requires `isSteamGuardEnabled && timestampSteamGuardEnabled >= 15 days ago` AND EITHER `twoFactorEnabled >= 7 days ago` OR `machineSteamGuardEnabled >= 7 days ago`.

---

## Friends, Personas & Social

### UserPersona Object Structure

```js
{
  persona_state, game_played_app_id, game_server_ip, game_server_port,
  persona_state_flags, online_session_instances, persona_set_by_user,
  player_name, avatar_hash: Buffer,
  avatar_url_icon, avatar_url_medium, avatar_url_full,
  last_logoff: Date, last_logon: Date, last_seen_online: Date,
  clank_rank, game_name, gameid, game_data_blob,
  clan_data, clan_tag, rich_presence: object[], rich_presence_string?,
  broadcast_id, game_lobby_id, watching_broadcast_*,
  is_community_banned, player_name_pending_review, avatar_pending_review
}
```

### GroupPersona Object Structure

```js
{
  clan_account_flags,
  name_info: { clan_name, sha_avatar: Buffer },
  user_counts: { members, online, chatting, in_game, chat_room_members },
  events: [{ gid, event_time, headline, game_id, just_posted }],
  announcements: [{ gid, event_time, headline, game_id, just_posted }],
  chat_room_private
}
```

### Friends Methods

```js
client.setPersona(state[, name])                          // Set online state + optionally profile name
client.setUIMode(mode)                                    // BigPicture/Mobile/Web mode display
client.addFriend(steamID[, cb])                           // Send/accept invite
client.removeFriend(steamID)                              // Remove friend / decline invite
client.blockUser(steamID[, cb])                           // Block all communication
client.unblockUser(steamID[, cb])                         // Unblock
client.getPersonas(steamids[, cb])                        // Request persona data
client.getSteamLevels(steamids, cb)                       // Steam levels
client.getGameBadgeLevel(appid, cb)                       // Your badge levels for a game
client.getAliases(steamIDs, cb)                           // Persona name history (last 10)
client.setNickname(steamID, nickname[, cb])               // Set private nickname; '' to remove
client.getNicknames([cb])                                 // Get all nicknames
client.inviteToGroup(userSteamID, groupSteamID)           // Invite friend to Steam group
client.respondToGroupInvite(groupSteamID, accept)         // Accept/decline group invite
client.createFriendsGroup(groupName[, cb])                // Create tag
client.deleteFriendsGroup(groupID[, cb])                  // Delete tag
client.renameFriendsGroup(groupID, newName[, cb])         // Rename tag
client.addFriendToGroup(groupID, userSteamID[, cb])       // Add friend to tag
client.removeFriendFromGroup(groupID, userSteamID[, cb])  // Remove friend from tag
client.getUserOwnedApps(steamID[, options], cb)           // Get another user's app list
client.getFriendsThatPlay(appID, cb)                      // Friends playing an app
```

### Quick Invite Links

```js
client.createQuickInviteLink([options], cb)               // {inviteLimit?, inviteDuration?} → {token}
client.listQuickInviteLinks(cb)                           // All active links
client.revokeQuickInviteLink(linkOrToken[, cb])           // Revoke link
client.getQuickInviteLinkSteamID(link)                    // Extract SteamID (synchronous)
client.checkQuickInviteLinkValidity(link, cb)             // Check validity
client.redeemQuickInviteLink(link[, cb])                  // Redeem → add friend
```

### Rich Presence

```js
client.uploadRichPresence(appid, {steam_display: '#RP_Display', ...})
client.requestRichPresence(appid, steamIDs[, language], cb) // Returns {richPresence, localizedString}
client.getAppRichPresenceLocalization(appID[, language], cb)// Get RP localization tokens
```

### Social Events

| Event | Data | Notes |
|-------|------|-------|
| `user` | `(steamID, UserPersona)` | ID event: `user#<steamID64>` |
| `group` | `(steamID, GroupPersona)` | ID event |
| `groupEvent` | `(steamID, headline, timestamp: Date, gid, gameID)` | New event; ID event |
| `groupAnnouncement` | `(steamID, headline, gid)` | New announcement; ID event |
| `friendsList` | `()` | Full list loaded → `myFriends` |
| `friendPersonasLoaded` | `()` | All friend personas in `users` |
| `groupList` | `()` | Full group list loaded |
| `friendRelationship` | `(steamID, relationship, previousRelationship)` | ID event |
| `groupRelationship` | `(steamID, relationship, previousRelationship)` | ID event |
| `friendsGroupList` | `(groupList)` | Tags data loaded |
| `nicknameList` | `(nicks)` | Full nickname list |
| `nickname` | `(steamID, nickname\|null)` | Individual nickname changed |

### ID Events

Events marked as **ID events** fire with a `SteamID` first argument. A second event `eventName#<steamID64>` also fires for targeted listening:

```js
client.on('user#76561198006409530', (sid, user) => { /* specific user */ });
```

---

## Notifications

| Event | Data | Notes |
|-------|------|-------|
| `newItems` | `(count)` | New inventory items |
| `newComments` | `(total, myItems, discussions)` | New comments |
| `tradeOffers` | `(count)` | Active received trade offers; suppressed if unchanged from last emission |
| `communityMessages` | `(count)` | Unread moderator messages; same suppression |
| `offlineMessages` | `(offlineMessages, friends[]: SteamID64 strings)` | Always emitted after logon |
| `marketingMessages` | `(timestamp: Date, messages[])` | `{id, url, flags}` per message |
| `notificationsReceived` | `({notifications: [{id, type, targets, body, read, timestamp, hidden, expiry, viewed}]})` | Full notification payloads; `body` is JSON-parsed |

Methods: `markNotificationsRead(ids[])`, `markAllNotificationsRead()`

---

## Ownership, PICS, and Product Info

### Global Ownership Filter

```js
// Per-instance, applied to all getOwned*/owns* calls without explicit filter:
client.setOption('ownershipFilter', {
  excludeFree: false,        // Exclude NoCost, FreeOnDemand, GuestPass, FreeCommercialLicense
  excludeShared: false,      // Exclude family-shared licenses
  excludeExpiring: false,    // Exclude GuestPass + non-free promotions with expiration
});
// Or a custom function:
client.setOption('ownershipFilter', (license, idx, allLicenses) => {
  return !(license.flags & SteamUser.ELicenseFlags.Expired);
});
```

### Ownership Methods

```js
// Synchronous (require enablePicsCache + ownershipCached event):
client.getOwnedApps([filter])        // → AppID[] (sorted)
client.ownsApp(appid[, filter])      // → boolean
client.getOwnedDepots([filter])      // → DepotID[] (sorted)
client.ownsDepot(depotid[, filter])  // → boolean
client.getOwnedPackages([filter])    // → PackageID[] (sorted; only needs PICS for advanced filters)
client.ownsPackage(pkgid[, filter])  // → boolean
```

### Product Info & PICS

```js
client.getProductInfo(apps, packages[, inclTokens], cb[, requestType])
// apps: [AppID] or [{appid, access_token?}]
// packages: [PackageID] or [{packageid, access_token?}]
// inclTokens: auto-request access tokens for missingToken entries
// Timeout: 60 MINUTES (longest of any method)
// → {apps, packages, unknownApps, unknownPackages}

client.getProductChanges(sinceChangenumber, cb)
// → {currentChangeNumber, appChanges[], packageChanges[]}

client.getProductAccessToken(apps, packages, cb)
// → {appTokens: {appid: token}, packageTokens, appDeniedTokens, packageDeniedTokens}
```

### PICS Events

| Event | Data | Notes |
|-------|------|-------|
| `ownershipCached` | `()` | PICS data ready (was `appOwnershipCached` pre v4.22.1) |
| `changelist` | `(currentChangeNumber, appChanges[], packageChanges[])` | Periodic poll |
| `appUpdate` | `(appid, data: {changenumber, missingToken, appinfo})` | App data changed |
| `packageUpdate` | `(packageid, data: {changenumber, missingToken, packageinfo})` | Package data changed |

---

## Game Playing & App Lifecycle

```js
client.gamesPlayed(apps[, force])
// apps: [int|string|{game_id, game_extra_info?, game_ip_address?}]
//        int = Steam appid, string = non-Steam game name, object = app with display name
// force: if true, calls kickPlayingSession() first
// Pass [] to stop all games

client.kickPlayingSession([cb])     // Kick other session playing games → {playingApp}
client.getPlayerCount(appid, cb)    // 0 = total Steam users online
```

Events: `appLaunched(appid)`, `appQuit(appid)`, `playingState(blocked, playingApp)`

**Important for GC**: When `gamesPlayed([730])` emits `appLaunched(730)`, globaloffensive hooks the event and starts GC connection.

---

## CDN / Depot Downloads

```js
client.getContentServers([appid], cb)     // → {servers} (cached 1h)
client.getDepotDecryptionKey(appID, depotID, cb) // → {key: Buffer}
client.getCDNAuthToken(appID, depotID, hostname, cb) // → {token, expires: Date}
client.getManifest(appID, depotID, manifestID, branchName, [branchPassword], cb) // → {manifest}
client.getRawManifest(appID, depotID, manifestID, branchName, [branchPassword], cb) // → {manifest: Buffer}
client.getManifestRequestCode(appID, depotID, manifestID, branchName, [branchPassword], cb) // → {requestCode}
client.downloadChunk(appID, depotID, chunkSha1, [contentServer], cb) // → {chunk: Buffer}
client.downloadFile(appID, depotID, fileManifest, [outputFilePath], cb) // Progress events + result
client.getAppBetaDecryptionKeys(appID, password, cb) // → {keys}
```

Compression formats: Zstd (`VSZa` header), VZip/LZMA (`VZa` header), Zip (`PK\x03\x04`).

---

## App Authentication Tickets

### Creating Tickets

```js
// Encrypted App Ticket (for publisher server auth):
client.createEncryptedAppTicket(appid[, userData: Buffer], cb)
// → {encryptedAppTicket: Buffer}

// Static parser (requires publisher's encryption key):
SteamUser.parseEncryptedAppTicket(ticket: Buffer, key: Buffer|string)
// → decrypted ticket object

// Auth Session Ticket (for game server authentication):
client.createAuthSessionTicket(appid, cb)
// → {sessionTicket: Buffer}
// Structure: GCTOKEN + SESSIONHEADER + OWNERSHIPTICKET

// App Ownership Ticket:
client.getAppOwnershipTicket(appid, cb)
// → {appOwnershipTicket: Buffer}
// Cached on disk if saveAppTickets: true (validates IP match + not expiring within 6h)

// Generic ticket parser:
SteamUser.parseAppTicket(ticket: Buffer|ByteBuffer, [allowInvalidSignature: false])
// → parsed object or null
```

### Managing Active Tickets

```js
client.activateAuthSessionTickets(appid, tickets, cb)
// tickets: Buffer|object|Array of either. Skips already-active, replaces same-appid/steamid.

client.cancelAuthSessionTickets(appid[, gcTokens], cb)
// gcTokens: specific token(s) to cancel, or null to cancel all for this appid
// → {canceledTicketCount}

client.endAuthSessions(appid[, steamIDs], cb)
// steamIDs: specific users to end, or null for all non-self sessions
// → {canceledTicketCount}

client.getActiveAuthSessionTickets()
// → [{appID, steamID: SteamID, ticketCrc, gcToken, validated}]
```

### Auth Ticket Events

`authTicketStatus` and `authTicketValidation` — both carry:
```js
{steamID, appOwnerSteamID: SteamID|null, appID, ticketCrc, ticketGcToken, state, authSessionResponse}
```
- `authTicketStatus`: our own ticket status change (`estate == 0`)
- `authTicketValidation`: other user's ticket validated
- Tickets with non-OK `eauth_session_response` are auto-removed from active list

---

## Econ & Profile Items

```js
client.getAssetClassInfo(language, appid, classes, cb) // [{classid, instanceid?}] → {descriptions}
client.getTradeURL(cb)                                  // → {token, url}
client.changeTradeURL(cb)                               // → {token, url} (generates new)
client.getEmoticonList(cb)                              // → {emoticons}
client.getOwnedProfileItems([options], cb)              // {language?} → backgrounds, avatars, frames, etc.
client.getEquippedProfileItems(steamID[, options], cb)  // User's equipped profile items
client.setProfileBackground(communityItemID[, cb])       // Change profile background
```

---

## Family Sharing

```js
client.addAuthorizedBorrowers(steamIDs, cb)             // Single or array
client.removeAuthorizedBorrowers(steamIDs, cb)          // MUST be array
client.getAuthorizedBorrowers([options], cb)            // {includeCanceled?, includePending?}
client.getAuthorizedSharingDevices([options], cb)       // {includeCanceled?}
client.authorizeLocalSharingDevice(deviceName, cb)      // → {deviceToken}
client.deauthorizeSharingDevice(deviceToken, cb)        // String or {deviceToken}
client.activateSharingAuthorization(ownerSteamID, deviceToken) // Fire-and-forget; → licenses event
client.deactivateSharingAuthorization()                 // Fire-and-forget
```

---

## Trade, Store & Published Files

```js
// Trade (deprecated but still works between bots):
client.trade(steamID)              // Send request → 'tradeResponse' event
client.cancelTradeRequest(steamID) // Cancel outstanding request

// Store:
client.getStoreTagNames(language, tagIDs, cb) // → {tags: {id: {name, englishName}}}

// Workshop:
client.getPublishedFileDetails(ids, cb)      // Accepts single id or array → {files}

// Key redemption:
client.redeemKey(key[, cb])                  // 90-second timeout; on error, err.purchaseResultDetails
client.requestFreeLicense(appIDs[, cb])      // Free-on-demand; rate-limited ~50/hr
client.getLegacyGameKey(appid, cb)           // Legacy CD key for owned game
```

### Trade Events

| Event | Data | Notes |
|-------|------|-------|
| `tradeRequest` | `(steamID, respond(bool))` | ID event; call `respond(true/false)` |
| `tradeResponse` | `(steamID, response, restrictions)` | ID event; `restrictions` = `{steamguardRequiredDays, newDeviceCooldownDays, ...}` |
| `tradeStarted` | `(steamID)` | ID event; trade session live at `steamcommunity.com/trade/<steamID>` |

---

## Two-Factor Authentication

```js
// Enable TOTP 2FA:
client.enableTwoFactor(cb)
// → {shared_secret, identity_secret, revocation_code, server_time, status, steamguard_scheme, ...}
// SAVE the full response! Use JSON.stringify.

// Finalize activation:
client.finalizeTwoFactor(sharedSecret: Buffer|string, activationCode: string, cb)
// Retries up to 30 times with +30s TOTP window on each attempt.
// Rejects with 'Invalid activation code' on status 89.
```

---

## Helpers (Static / Utility)

| Function | Description |
|----------|-------------|
| `SteamUser.formatCurrency(amount, currency)` | Format currency values (e.g. `'$12.34'`) |
| `SteamUser.helpers.steamID(input)` | Convert string/object to `SteamID` |
| `SteamUser.helpers.createFriendCode(steamID)` | `'XXXXX-XXXXX'` format |
| `SteamUser.helpers.parseFriendCode(code)` | Back to `SteamID` |
| `SteamUser.helpers.eresultError(eresult)` | `Error` with `.eresult` property |
| `SteamUser.helpers.decodeJwt(jwt)` | Decode JWT payload without verification |
| `SteamUser.helpers.getOsType()` | Auto-detect OS type for logon |
| `client.setOption(option, value)` | Change single option |
| `client.setOptions(options)` | Change multiple options |

### Custom Storage Engine

```js
client.storage.on('save', (filename, contents, callback) => { callback(err); });
client.storage.on('read', (filename, callback) => { callback(err, buffer); });
```

### Resource Enums

`EClientUIMode`: None(0), BigPicture(1), Mobile(2), Web(3)
`EConnectionProtocol`: Auto(0), TCP(1), WebSocket(2)
`EMachineIDType`: None(1), AlwaysRandom(2), AccountNameGenerated(3), PersistentRandom(4)
`EPrivacyState`: Private(1), FriendsOnly(2), Public(3)
`EPurchaseResult`: OK(0), AlreadyOwned(9), RegionLockedKey(13), InvalidKey(14), DuplicatedKey(15), BaseGameRequired(24), OnCooldown(53)

---

## Game Coordinator Protocol

### `sendToGC(appid, msgType, protoBufHeader, payload[, callback])`

```js
// Send custom GC messages (e.g., for other games):
client.sendToGC(730, msgType, {}, protobuf.encode(body).finish());

// With job callback:
client.sendToGC(730, msgType, {}, payload, (appid, msgType, payload) => {
  // Response handled here
});
```

**Protocol details:**
- Protobuf messages: OR msgType with `0x80000000` (PROTO_MASK), encode `CMsgProtoBufHeader`
- Non-protobuf: 18-byte header (version=1, JOBID_NONE, sourceJobID)
- If callback: generates job ID, stores in `_jobsGC`
- Response via `EMsg.ClientFromGC` → matched by `jobid_target` or emitted as `receivedFromGC`

### Events

`receivedFromGC(appid, msgType, payload)` — unsolicited GC messages (non-job)
`recievedFromGC(...)` — typo alias for backward compat

---

## CS2 Game Coordinator Reference (globaloffensive v3.3.0)

### GC Connection Lifecycle

```
client.gamesPlayed([730])
  → steam-user emits 'appLaunched'(730)
  → csgo._isInCSGO = true
  → csgo._connect():
      sends CMsgClientHello { version: 2000244 }
      exponential backoff: 500ms → 1s → 2s → ... → 60s max
  → GC responds with CMsgClientWelcome
      contains SO cache (type_id=1 = inventory items)
      csgo decodes CSOEconItem objects → csgo.inventory[]
  → csgo.haveGCSession = true
  → csgo emits 'connectedToGC'
  → GC sends MatchmakingGC2ClientHello → csgo.accountData, emits 'accountData'

Disconnection paths:
  gamesPlayed([]) → appQuit(730) → _isInCSGO=false, haveGCSession=false (no disconnect event)
  client.disconnected → handleAppQuit(true) → emits 'disconnectedFromGC'
  ConnectionStatus != HAVE_SESSION → emits 'disconnectedFromGC', auto-reconnects
  ClientLogonFatalError → emits 'error'
```

### Properties

| Property | Type | Notes |
|----------|------|-------|
| `csgo._steam` | SteamUser | Parent SteamUser ref |
| `csgo.haveGCSession` | boolean | Only call methods when true |
| `csgo.inventory` | CSOEconItem[] | Full inventory; available after connectedToGC |
| `csgo.accountData` | CMsgGCCStrike15_v2_MatchmakingGC2ClientHello | Account stats + rankings |
| `csgo._isInCSGO` | boolean | Internal: is CS:GO running? |

### CS2 Item — Full CSOEconItem Object

```js
{
  // Core protobuf fields
  id: '12345678901',             // uint64 → string
  account_id: 12345678,
  inventory: 0x40000012,         // bit30 = isNew, bits0-15 = position
  def_index: 1,                  // e.g. 1=Deagle, 1201=Storage Unit
  quantity: 1, level: 0, quality: 4, flags: 0, origin: 8,
  custom_name: 'My AK',          // Direct field or from attribute 111
  custom_desc: null,
  style: 0, original_id: '0',
  in_use: false, rarity: 5,

  attribute: [{                  // CSOEconItemAttribute[]
    def_index: 6,                // Attribute definition index
    value: 123,                  // Integer value (uint32)
    value_bytes: Buffer,         // Raw bytes (for floats, strings, etc.)
  }],

  interior_item: null,
  equipped_state: [{ new_class, new_slot }],

  // --- Decoded by _processSOEconItem() ---

  position: 18,                  // Decoded from inventory field

  // Paint/skin
  paint_index: 44.0,             // attr 6 (float from value_bytes)
  paint_seed: 123,               // attr 7 (float → floor)
  paint_wear: 0.123456,          // attr 8 (float)

  // Trade
  tradable_after: Date,          // attr 75 (uint32 × 1000)

  // StatTrak
  kill_eater_value: 42,          // attr 80 (uint32)
  kill_eater_score_type: 0,      // attr 81 (uint32); 0=Kills

  // Custom name
  custom_name: 'Custom',         // attr 111 (bytes, skip 2B prefix → utf8)

  // Quest
  quest_id: 12345,               // attr 168 (uint32)

  // Stickers (attrs 113-133, 278-289, 290-295)
  stickers: [{
    slot: 0,                     // Computed; schema attr 290-295 may override
    sticker_id: 1111,            // attr 113+i*4 (uint32)
    wear: 0.2,                   // attr 114+i*4+0 (float; null=pristine)
    scale: null,                 // attr 114+i*4+1 (float)
    rotation: null,              // attr 114+i*4+2 (float)
    offset_x: 0.1,               // attr 278+i*2+0 (float)
    offset_y: 0.2,               // attr 278+i*2+1 (float)
    tint_id: 0,
  }],

  // Keychains (same structure; only in CEconItemPreviewDataBlock, not CSOEconItem attrs)
  keychains: [...],

  // Storage unit
  casket_id: '9876543210',       // attr 272 (low) + 273 (high) → Long → string
  casket_contained_item_count: 3,// attr 270 (uint32); only on def_index=1201 (Storage Unit)
}
```

### CS2 Item Attribute → Field Decoding Map

| Attr def_index | Field | Decoding |
|---------------|-------|----------|
| 6 | `paint_index` | `value_bytes.readFloatLE(0)` |
| 7 | `paint_seed` | `Math.floor(value_bytes.readFloatLE(0))` |
| 8 | `paint_wear` | `value_bytes.readFloatLE(0)` |
| 75 | `tradable_after` | `new Date(value_bytes.readUInt32LE(0) * 1000)` |
| 80 | `kill_eater_value` | `value_bytes.readUInt32LE(0)` |
| 81 | `kill_eater_score_type` | `value_bytes.readUInt32LE(0)` |
| 111 | `custom_name` | `value_bytes.slice(2).toString('utf8')` (skip 2-byte prefix) |
| 113+4i | `stickers[i].sticker_id` | `value_bytes.readUInt32LE(0)` |
| 114+4i+0 | `stickers[i].wear` | `value_bytes.readFloatLE(0)` |
| 114+4i+1 | `stickers[i].scale` | `value_bytes.readFloatLE(0)` |
| 114+4i+2 | `stickers[i].rotation` | `value_bytes.readFloatLE(0)` |
| 168 | `quest_id` | `value_bytes.readUInt32LE(0)` |
| 270 | `casket_contained_item_count` | `value_bytes.readUInt32LE(0)` (only def_index=1201) |
| 272+273 | `casket_id` | `new Long(low.readUInt32LE(), high.readUInt32LE()).toString()` |
| 278+2i+0 | `stickers[i].offset_x` | `value_bytes.readFloatLE(0)` |
| 278+2i+1 | `stickers[i].offset_y` | `value_bytes.readFloatLE(0)` |
| 290+i | `stickers[i].slot` override | `value_bytes.readUInt32LE(0)` |

### Inspect Item — Full Details (`inspectItem`)

**Three calling forms:**

1. **Standard inspect link (GC call):**
   ```js
   csgo.inspectItem('steam://rungame/730/... +csgo_econ_action_preview%20S{owner}A{assetid}D{d}');
   // regex extracts: /[SM](\d+)A(\d+)D(\d+)$/
   ```

2. **Masked/embedded inspect link (SYNCHRONOUS, no GC call!):**
   ```js
   csgo.inspectItem('steam://rungame/730/... +csgo_econ_action_preview%20M{hex}');
   // Demasking: buffer[0] = mask; for i>0: buffer[i] ^= mask
   // Validates CRC32 checksum
   // Decodes CEconItemPreviewDataBlock protobuf
   // Emits via setImmediate() — same tick, after current code
   ```

3. **Individual params:**
   ```js
   csgo.inspectItem(ownerSteamID|ownerSteamID64|marketListingId, assetid, d[, callback]);
   ```
   - `owner`: SteamID64 string, SteamID object, or market listing ID
   - `assetid`: string
   - `d`: string — the "D" number from inspect URL
   - Timeout: 10 seconds → emits `inspectItemTimedOut`

### CEconItemPreviewDataBlock (inspect result / masked link)

```js
{
  accountid: null,               // Always null for external items
  itemid: '12345678901',         // uint64 → string
  defindex: 1,
  paintindex: 44,                // uint32
  rarity: 5,                     // uint32
  quality: 4,                    // uint32
  paintwear: 0.123456,           // uint32 → float (big-endian conversion!)
  paintseed: 123,                // uint32
  killeaterscoretype: 0,         // uint32
  killeatervalue: 42,            // uint32
  customname: 'My AK',           // string (null if none)
  stickers: [{
    slot: 0,
    sticker_id: 1111, wear, scale, rotation,
    tint_id: 0, offset_x, offset_y, offset_z, pattern,
  }],
  keychains: [{                  // Same structure as stickers!
    slot, sticker_id, wear, scale, rotation,
    tint_id, offset_x, offset_y, offset_z, pattern,
  }],
  inventory: 123,                // uint32 — no use
  origin: 8,                     // uint32
  questid: null, dropreason: 0,
  musicindex: 0, entindex: 0, petindex: null,
}
// paintwear conversion: Buffer.alloc(4).writeUInt32BE(raw, 0); then buf.readFloatBE(0)
```

### CS2 Methods

```js
// --- Item Inspection ---
csgo.inspectItem(owner, assetid, d[, callback]) // Three forms (see above)

// --- Player Profile ---
csgo.requestPlayersProfile(steamid[, cb])
// steamid: SteamID, string, or account ID
// → profile with ranking, per_map_rank[], commendations, medals, player_level, player_cur_xp
// Event: 'playersProfile' + 'playersProfile#<steamID64>'

// --- Crafting (Trade-Ups) ---
csgo.craft(itemIds[], recipe)
// Protocol: ByteBuffer [int16 recipe, int16 count, uint64... itemIds]
// Recipes: 0-4 = Consumer→Covert, 10-14 = StatTrak versions
// Event: 'craftingComplete(recipe, itemsGained[])'; recipe=-1 = FAILURE

// --- Item Management ---
csgo.nameItem(nameTagId, itemId, name)
// nameTagId=0 for free (storage units); protocol: [uint64 tagId, uint64 itemId, 0x00, CString name]
csgo.deleteItem(itemId)
// DESTRUCTIVE! Protocol: [uint64 itemId]

// --- Storage Units (Caskets) ---
csgo.addToCasket(casketId, itemId)       // CMsgCasketItem → ItemCustomizationNotification.CasketAdded
csgo.removeFromCasket(casketId, itemId)  // CMsgCasketItem → ItemCustomizationNotification.CasketRemoved
csgo.getCasketContents(casketId, cb)
// Checks if items already loaded → returns immediately
// Otherwise: sends CasketItemLoadContents, waits for notification CasketContents(1012)
// Timeout: 30 seconds

// --- Match Data ---
csgo.requestGame(shareCodeOrDetails)
// Accepts: share code string (auto-decoded) or {matchId, outcomeId, token}
csgo.requestLiveGames()                  // Current live tournament games
csgo.requestRecentGames(steamid)         // Recent matches (max 8)
csgo.requestLiveGameForUser(steamid)     // Live match for specific user
```

### Player Profile Response

```js
{
  account_id,
  ongoingmatch,
  penalty_seconds, penalty_reason, vac_banned,
  ranking: {
    account_id, rank_id (0-18), wins, rank_change, rank_type_id (6=MM,7=Wingman,10=DangerZone),
    tv_control, rank_window_stats, leaderboard_name,
    rank_if_win, rank_if_lose, rank_if_tie,
    per_map_rank: [{ map_id, rank_id, wins }], // NEW: per-map ranks
  },
  commendation: { cmd_friendly, cmd_teaching, cmd_leader },
  medals: { display_items_defidx[], featured_display_item_defidx },
  my_current_event, my_current_event_teams, my_current_team, my_current_event_stages,
  survey_vote, activity,
  player_level, player_cur_xp, player_xp_bonus_flags,
  rankings: [PlayerRankingInfo...], // Multiple rank types
}
// Level % = (player_cur_xp - 327680000) / 5000
```

### CS2 Events

| Event | Data | Notes |
|-------|------|-------|
| `connectedToGC` | — | **Wait for this before GC calls.** May fire without prior `disconnectedFromGC`. |
| `disconnectedFromGC` | `reason` (GCConnectionStatus) | Auto-reconnect via `_connect()` |
| `error` | `err` | Fatal from ClientLogonFatalError — handle or crash |
| `connectionStatus` | `status, data` | Raw CMsgConnectionStatus |
| `accountData` | `proto` (MatchmakingGC2ClientHello) | Account stats |
| `debug` | `message` | Internal debug messages |
| `matchList` | `matches[], data` | Response to match requests |
| `inspectItemInfo` | `item` (CEconItemPreviewDataBlock) | Also `inspectItemInfo#{itemid}` |
| `inspectItemTimedOut` | `assetid` | Also `inspectItemTimedOut#{assetid}` |
| `itemAcquired` | `item` (CSOEconItem) | New item |
| `itemChanged` | `oldItem, item` (CSOEconItem) | Item modified |
| `itemRemoved` | `item` (CSOEconItem) | Item destroyed |
| `itemCustomizationNotification` | `itemIds[], notificationType` | See types below |
| `craftingComplete` | `recipe, itemsGained[]` | recipe=-1 = failure |
| `playersProfile` | `profile` | Also `playersProfile#{steamID64}` |

### GCConnectionStatus

| Value | Name |
|-------|------|
| 0 | `HAVE_SESSION` |
| 1 | `GC_GOING_DOWN` |
| 2 | `NO_SESSION` |
| 3 | `NO_SESSION_IN_LOGON_QUEUE` |
| 4 | `NO_STEAM` |

### ItemCustomizationNotification Types (partial — most useful)

| Value | Name | Trigger |
|-------|------|---------|
| 1006 | `NameItem` | Name tag applied |
| 1007 | `UnlockCrate` | Crate/case opened |
| 1008 | `XRayItemReveal` | X-ray reveal |
| 1009 | `XRayItemClaim` | X-ray claim |
| 1011 | `CasketTooFull` | Target casket full |
| 1012 | `CasketContents` | Casket contents loaded (getCasketContents response) |
| 1013 | `CasketAdded` | Item added to casket |
| 1014 | `CasketRemoved` | Item removed from casket |
| 1015 | `CasketInvFull` | Inventory full (can't extract from casket) |
| 1019 | `NameBaseItem` | Base item renamed |
| 1030 | `RemoveItemName` | Name tag removed |
| 1053 | `RemoveSticker` | Sticker scraped |
| 1086 | `ApplySticker` | Sticker applied |
| 1088 | `StatTrakSwap` | StatTrak transferred |
| 9178 | `ActivateFanToken` | Fan token activated |
| 9179 | `ActivateOperationCoin` | Operation coin activated |
| 9185 | `GraffitiUnseal` | Graffiti unsealed |
| 9204 | `GenerateSouvenir` | Souvenir generated |

### Internal GC Trade Protocol Msg IDs (not exposed as methods)

| ID | Name | Purpose |
|----|------|---------|
| 1501 | `Trading_InitiateTradeRequest` | Start GC trade |
| 1502 | `Trading_InitiateTradeResponse` | Response |
| 1503 | `Trading_StartSession` | Session started |
| 1504 | `Trading_SetItem` | Add item to trade |
| 1505 | `Trading_RemoveItem` | Remove from trade |
| 1506 | `Trading_UpdateTradeInfo` | Update trade state |
| 1507 | `Trading_SetReadiness` | Ready check |
| 1508 | `Trading_ReadinessResponse` | Ready ack |
| 1509 | `Trading_SessionClosed` | Trade ended |
| 1510 | `Trading_CancelSession` | Cancel |
| 1511 | `Trading_TradeChatMsg` | Trade chat |

---

## CSGO-API — Static JSON Data (ByMykel/CSGO-API)

A free, public, static JSON API that maps CS2 internal numeric IDs to
human-readable names, rarities, images, and metadata. No auth required, no
CORS. Hosted on raw.githubusercontent.com. MIT license.

**Base URL:** `https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/{language}/`
**Languages hosted:** `en`, `zh-CN` (28 available locally)
**Image CDN:** `ByMykel/counter-strike-image-tracker`

### Why Use It

`globaloffensive` gives you raw numeric IDs — `def_index`, `paint_index`,
`sticker_id`, `rarity` — but not names, colors, images, or relationships.
CSGO-API bridges that gap:

```
globaloffensive item       CSGO-API lookup
─────────────────────      ──────────────────────────────
def_index: 1               "weapon_deagle" → "Desert Eagle"
paint_index: 44            "AK-47 | Redline"
rarity: 5                  "Covert" / color: #eb4b4b
paint_wear: 0.12           min_float: 0.00, max_float: 0.70
stickers[0].sticker_id: 75 "Sticker | Titan | Katowice 2014"
paint_index + weapon_id    "skin-{weapon_id}_{paint_index}"
```

### All 18 Endpoints

| Endpoint | ID Format | Purpose |
|----------|-----------|---------|
| `all.json` | `{id}` | All items keyed by ID |
| `skins.json` | `skin-{weapon_id}_{paint_index}` | Skins grouped by wear range (`wears[]`) |
| `skins_not_grouped.json` | `skin-{weapon_id}_{paint_index}_{wear}` | Individual skin+wear combos with `market_hash_name` |
| `stickers.json` | `sticker-{def_index}` | Stickers with tournament/team info |
| `sticker_slabs.json` | `sticker_slab-{def_index}` | Sticker slabs (charms) with `original{name,image_inventory}` |
| `keychains.json` | `keychain-{def_index}` | Weapon charms |
| `collections.json` | `collection-set-{name}` | Collections with `contains[]` and `crates[]` |
| `crates.json` | `crate-{def_index}` | Cases/capsules/boxes/souvenir packages with `contains[]`, `contains_rare[]` |
| `keys.json` | `key-{name}` | Case keys with `crates[]` (which they unlock) |
| `collectibles.json` | `collectible-{def_index}` | Service medals, veteran coins |
| `agents.json` | `agent-{def_index}` | Agent skins with `team` (terrorists/ct) |
| `patches.json` | `patch-{def_index}` | Agent patches |
| `graffiti.json` | `graffiti-{def_index}` | Sealed graffiti |
| `music_kits.json` | `music_kit-{def_index}` | Music kits with `exclusive` flag |
| `base_weapons.json` | `base_weapon-{name}` | Default weapon models |
| `highlights.json` | `aus2025_{name}` | Tournament highlights with `video` URL |
| `inventory.json` | `{skins: {weapon_id: {paint_index}}}` | Inventory lookup — skins by `weapon_id→paint_index`, other items by `def_index` |

### Common Object Shapes

Every endpoint returns arrays or objects with these recurring patterns:

**Rarity (always present on rarity-bearing items):**
```js
{ id: "rarity_ancient_weapon", name: "Covert", color: "#eb4b4b" }
```

**Rarity ID → Name / Color Table:**

| Rarity ID | Display Name | Color |
|-----------|-------------|-------|
| `rarity_common` | Base Grade | `#b0c3d9` |
| `rarity_uncommon` / `rarity_uncommon_weapon` | Industrial Grade | `#5e98d9` |
| `rarity_rare` / `rarity_rare_weapon` | Mil-Spec / High Grade | `#4b69ff` |
| `rarity_mythical` | Restricted / Remarkable | `#8847ff` |
| `rarity_legendary` / `rarity_legendary_character` | Classified / Superior | `#d32ce6` |
| `rarity_ancient` / `rarity_ancient_weapon` | Covert / Extraordinary | `#eb4b4b` |
| `rarity_immortal` | Gold | `#ffd700` |

**Cross-references (used in skins, stickers, keychains, agents, etc.):**
```js
collections: [{ id: "collection-set-overpass", name: "The Overpass Collection", image: "..." }]
crates: [{ id: "crate-4028", name: "ESL One Cologne 2014 Overpass Souvenir Package", image: "..." }]
```

### Skin Object (`skins.json`)
```js
{
  id: "skin-65604",              // skin-{weapon_id}_{paint_index}
  name: "Desert Eagle | Urban DDPAT",
  description: "...",
  weapon: { id: "weapon_deagle", weapon_id: 1, name: "Desert Eagle" },
  category: { id: "csgo_inventory_weapon_category_pistols", name: "Pistols" },
  pattern: { id: "hy_ddpat_urb", name: "Urban DDPAT" },
  min_float: 0.06, max_float: 0.8,  // Valid wear range
  rarity: { id: "rarity_uncommon_weapon", name: "Industrial Grade", color: "#5e98d9" },
  stattrak: false, souvenir: true,
  paint_index: "17",              // String! Maps to CSOEconItem attribute 6
  wears: [{ id: "SFUI_InvTooltip_Wear_Amount_0", name: "Factory New" }, ...],
  collections: [...], crates: [...],
  team: { id: "both", name: "Both Teams" },
  legacy_model: true,
  image: "https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/main/..."
}
```

### Skin Not Grouped (`skins_not_grouped.json`)
Same as above plus:
```js
{
  id: "skin-65604_0",             // skin-{weapon_id}_{paint_index}_{wear_index}
  skin_id: "skin-65604",          // Parent grouped skin ID
  wear: { id: "SFUI_InvTooltip_Wear_Amount_0", name: "Factory New" },
  stattrak: false, souvenir: false,  // Explicit per-variant
  market_hash_name: "Desert Eagle | Urban DDPAT (Factory New)",
  style: { id: 2, name: "Hydrographic", url: "..." }
}
```

### Sticker Object (`stickers.json`)
```js
{
  id: "sticker-75",               // sticker-{def_index}
  name: "Sticker | Titan | Katowice 2014",
  description: "...",
  rarity: { id: "rarity_rare", name: "High Grade", color: "#4b69ff" },
  crates: [...],
  tournament_event: "Katowice 2014",
  tournament_team: "Titan",
  type: "Team",                   // Team, Player, Other
  market_hash_name: "Sticker | Titan | Katowice 2014",
  effect: "Other",
  image: "..."
}
```

### Sticker Slab Object (`sticker_slabs.json`)
```js
{
  id: "sticker_slab-75",
  name: "Sticker Slab | Titan | Katowice 2014",
  def_index: "75",                // String!
  rarity: { ... },
  crates: [...], collections: [],
  type: "Team",
  tournament: { id: 3, name: "2014 EMS One Katowice" },
  team: { id: 27, tag: "TIT", geo: "FR", name: "Titan" },
  original: { name: "kat2014_titan", image_inventory: "econ/stickers/emskatowice2014/titan_1355_37" },
  market_hash_name: "Sticker Slab | Titan | Katowice 2014",
  effect: "Other",
  image: "..."
}
```

### Crate Object (`crates.json`)
```js
{
  id: "crate-4904",
  name: "Kilowatt Case",
  type: "Case",                   // Case, Capsule, Graffiti Box, Music Kit Box, Souvenir Package
  first_sale_date: "2024-01-16",
  contains: [{ id, name, rarity, paint_index, image }, ...],
  contains_rare: [{ id, name, rarity, paint_index: null, phase: null, image }, ...],
  market_hash_name: "Kilowatt Case",
  rental: true,                   // CS2 rental feature
  image: "...",
  model_player: "models/props/crates/csgo_drop_crate_community_33.vmdl",
  loot_list: { name: "★ Kukri Knife ★", footer: "...", image: "..." }
}
```

### Collection Object (`collections.json`)
```js
{
  id: "collection-set-community-3",
  name: "The Huntsman Collection",
  crates: [{ id, name, image }, ...],
  contains: [{ id, name, rarity, paint_index, image }, ...],
  image: "..."
}
```

### Agent, Keychain, Patch, Music Kit, Graffiti, Collectible
All follow the same pattern: `{ id, name, description, rarity, market_hash_name, image }` plus type-specific fields:
- **Agents:** `team: { id: "terrorists"|"ct", name }`
- **Keychains:** `collections[]`
- **Patches:** rarity only
- **Music Kits:** `exclusive: true|false`
- **Graffiti:** `crates[]`
- **Collectibles:** `type`, `genuine`

### Inventory Lookup (`inventory.json`)

```js
{
  skins: {
    "1": {                        // weapon_id (from CSOEconItem.def_index → weapon mapping)
      "17": {                     // paint_index (from CSOEconItem attribute 6)
        name: "Desert Eagle | Urban DDPAT",
        rarity: { id: "rarity_uncommon_weapon", name: "Industrial Grade", color: "#5e98d9" },
        marketable: true,
        image: "..."
      }
    }
  },
  crates: { "1210": { name, rarity, marketable, image }, ... },
  stickers: { "75": { ... }, ... },
  keychains: { "1": { ... }, ... },
  music_kits: { "39": { ... }, ... },
  agents: { "4613": { ... }, ... },
  graffiti: { "1654": { ... }, ... },
  collectibles: { "874": { ... }, ... },
  patches: { "5126": { ... }, ... },
  highlights: { "aus2025_...": { ... }, ... },
  tools: { ... }                  // Name tags, storage units, etc.
}
```

### How to Use with globaloffensive

**Resolve a skin from inventory:**
```js
const API_BASE = 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en';

async function resolveSkin(item, fetchFn = fetch) {
  const { paint_index, def_index } = item;  // from CSOEconItem
  // Look up by weapon_id (def_index) and paint_index
  // Option 1: Full skins_not_grouped.json scan
  const res = await fetchFn(`${API_BASE}/skins_not_grouped.json`);
  const skins = await res.json();
  return skins.find(s => s.weapon?.weapon_id === def_index && s.paint_index === String(paint_index));
}

async function resolveSticker(stickerId, fetchFn = fetch) {
  const res = await fetchFn(`${API_BASE}/stickers.json`);
  const stickers = await res.json();
  return stickers.find(s => s.id === `sticker-${stickerId}`);
}

async function resolveRarity(rarityNum) {
  // rarity 5 (from CEconItemPreviewDataBlock) → "Covert" + "#eb4b4b"
  const res = await fetchFn(`${API_BASE}/skins.json`);
  const skins = await res.json();
  const match = skins.find(s => s.rarity && s.weapon?.weapon_id === 1);
  // Better: use the rarity table built into this skill
}
```

**Build a local inventory resolver:**
```js
// Download once, use many times
async function buildResolver(fetchFn = fetch) {
  const [skinsNG, stickers, keychains, crates] = await Promise.all([
    fetchFn(`${API_BASE}/skins_not_grouped.json`).then(r => r.json()),
    fetchFn(`${API_BASE}/stickers.json`).then(r => r.json()),
    fetchFn(`${API_BASE}/keychains.json`).then(r => r.json()),
    fetchFn(`${API_BASE}/crates.json`).then(r => r.json()),
  ]);

  const skinByPaintIdx = {};
  for (const s of skinsNG) {
    if (!skinByPaintIdx[s.paint_index]) skinByPaintIdx[s.paint_index] = [];
    skinByPaintIdx[s.paint_index].push(s);
  }

  const stickerById = {};
  for (const s of stickers) stickerById[s.id] = s;

  return {
    resolveSkin(paintIndex, weaponId) {
      return (skinByPaintIdx[String(paintIndex)] || [])
        .find(s => s.weapon?.weapon_id === weaponId);
    },
    resolveSticker(stickerId) {
      return stickerById[`sticker-${stickerId}`];
    },
  };
}
```

### Important Details

- **`paint_index` is a STRING** in CSGO-API, not a number — always use `String()` when comparing.
- **`def_index`** in the API is also a string. Compare with care.
- **`skins.json` groups by wear ranges** — use `skins_not_grouped.json` for exact `wear+stattrak+souvenir` combos.
- **Images are in a separate repo** (`ByMykel/counter-strike-image-tracker`) — all URLs point there.
- **The `inventory.json` endpoint** is optimized for fast `weapon_id → paint_index → skin` lookup (no array scan needed).
- **Only `en` and `zh-CN` are hosted** — for other languages, clone and build locally with `node update.js --languages <codes>`.
- **28 language codes available:** `en, zh-CN, pt-BR, ru, es-ES, bg, cs, da, nl, fi, fr, de, el, hu, it, ja, ko, es-MX, no, pl, pt-PT, ro, sv, zh-TW, th, tr, uk, vi`

---

## 本地库存匹配方案 (cs2tradetool v2)

基于 `cs2tradetool/index.js` 验证过的生产级方案。核心思想：**`def_index` 是容器型号不是物品身份**，
真正的身份信息在 GC 返回的 `stickers[0].sticker_id` 和 `paint_index` 中。

### 数据源

```
all.json (71MB, 45,756条, 单一文件)
  ├─ skin-{hash}_{wear}  → paint_index + weapon_id → 皮肤名+稀有度+图片
  ├─ sticker-{id}        → O(1) 直接查找贴纸名
  ├─ crate-{id}          → O(1) 直接查找箱子名
  ├─ agent-{id}          → 探员
  ├─ keychain-{id}       → 挂件
  └─ collectible-{id}    → 收藏品
+
items_game.txt + csgo_english.txt  (VDF, 6.6MB)
  └─ 断层回退: CSGO-API 缺失的旧贴纸/涂鸦 (如 1695-1738 范围)
```

**`all.json` 下载:** `node generate_dict.js` (约 70MB, 从 raw.githubusercontent.com)

### 三路分派规则

```
CSOEconItem (raw GC data)
  │
  ├─ item.stickers[0] exists?
  │   YES → 贴纸/涂鸦容器。身份 = stickers[0].sticker_id
  │         查找: all.json "sticker-{sticker_id}"
  │         失败 → items_game.txt 断层回退 (英文名)
  │         ★ 绝不用 def_index 命名!
  │
  ├─ item.paint_index != null && item.paint_index !== 0?
  │   YES → 武器皮肤。Key = paint_index + "|" + weapon_id
  │         查找: all.json skin 条目, 获取中文名/稀有度/图片/min_float/max_float
  │         磨损: 依据 0.07/0.15/0.38/0.45 阈值分 5 档
  │
  ├─ isKnownWeapon(def_index)?
  │   YES → 原版武器 (无涂装, paint_index=0)
  │
  └─ 否则 → 箱子/收藏品/探员/涂鸦等
            从 all.json 按类别精度计分匹配
            (all.json 条目多的类别如 sticker=10441 权重极低)
```

### 类别精度计分

`def_index` 在所有物品类型间共享 (如 4236 同时是箱子+贴纸)。
用精度基数消歧义: `10000 / 该类别条目数`。越少条目的类别越精准:

| 类别 | 条目数 | 精度分 | 说明 |
|------|-------|--------|------|
| tool | 4 | 2500 | 最精准 |
| key | 39 | 256 | |
| agent | 63 | 159 | |
| keychain | 78 | 128 | |
| patch | 112 | 89 | |
| music_kit | 189 | 53 | |
| crate | 478 | 20.9 | |
| collectible | 627 | 15.9 | |
| graffiti | 2111 | 4.7 | |
| sticker_slab | 10441 | 0.96 | 权重最低, 永远不首选 |
| sticker | 10441 | 0.96 | 权重最低 |

### `def_index` 歧义验证 (实战数据)

以 GC 实际数据验证——所有有歧义的 def_index 案例分析:

```
def_index=1209  (514件, 全部有 sticker[0]):
  all.json def=1209 → "Zeus(金色)"          ← 错, def_index 查的
  all.json sticker_id=4531 → "滑翔高手"       ← 对, 真实身份
  all.json sticker_id=4683 → "远古保卫者"     ← 对
  → 102种不同sticker_id → def_index是容器, sticker_id是身份

def_index=1348  (14件, 全部有 sticker[0]):
  → 全部 sticker_id 在 CSGO-API 断层(1695-1738)
  → items_game.txt 回退: "Cocky", "Mr. Teeth", ...
  → 这些是旧版涂鸦/喷漆包

def_index=1349  (4件, 全部有 sticker[0]):
  → sticker_id 1737 = "GTG" (items_game.txt 回退)
  → sticker_id 1718 = "Sheriff"

def_index=4236  (49件, 全部无 sticker[0]):
  all.json crate-4236 → "伽玛武器箱"          ← 对, crate精度分20.9
  all.json sticker-4236 → "nitr0(金色)"        ← 噪音, 权重0.96
  → 无贴纸属性 → crate 优先
```

### 关键实现 (CsgoResolver 类)

```js
class CsgoResolver {
  constructor() {
    const all = JSON.parse(fs.readFileSync('data/all.json', 'utf8'));
    // 皮肤: "paint_index|weapon_id" → entry
    this._skinByKey = {};
    // 贴纸: sticker_id → entry
    this._stickerById = {};
    // 所有非皮肤类别: "type|def_index" → entry
    this._byTypeAndDef = {};
    // 已知武器 ID 集合
    this._weaponIds = new Set();

    for (const [key, item] of Object.entries(all)) {
      const type = key.split('-')[0];
      if (type === 'skin' && item.paint_index && item.weapon?.weapon_id) {
        this._skinByKey[item.paint_index + '|' + item.weapon.weapon_id] = item;
        this._weaponIds.add(item.weapon.weapon_id);
      }
      if (type === 'sticker') {
        this._stickerById[key.replace('sticker-', '')] = item;
      }
      if (item.def_index) {
        (this._byTypeAndDef[type] ??= {})[item.def_index] = item;
      }
    }
  }
}
```

### 断层回退

all.json 的贴纸数据在 1695-1738 等范围有断层 (CSGO-API 未收录的旧物品)。
这些由 `items_game.txt` (VDF格式, 从 Valve 官方游戏文件提取) 填补:

```js
// VDF 解析 → sticker_kits 段 → 取 item_name → 英文翻译 → 贴纸名
const gameVdf = VDF.parse(fs.readFileSync('data/game/items_game.txt'));
const stickerKits = gameVdf.items_game.sticker_kits;
const name = translate(stickerKits[stickerId].item_name); // e.g. "GTG", "Sheriff"
```

### 单复数陷阱

all.json 的 key 前缀使用**单数形式**: `crate`, `agent`, `graffiti`, `collectible` 等。
代码中的类别搜索必须匹配单数形式，否则 `resolveByDef('crates', 4236)` 永远找不到
索引中的 `byTypeAndDef['crate']`。这是从多文件迁移到 all.json 时最常见的 bug。

---

## Common Patterns

### Login + Token 持久化 (完整生产级)

基于 `cs2tradetool/index.js` 验证过的范式。策略：优先 Refresh Token
（免密免 2FA），Token 失效自动降级密码登录。

**持久化文件 `data/tokens.json`：**
```json
{ "accountName": "eyJ0eXAiOiJKV1Q...refresh-token..." }
```

**完整事件绑定：**
```js
require('dotenv').config();
const SteamUser = require('steam-user');
const GlobalOffensive = require('globaloffensive');
const readline = require('readline');

const client = new SteamUser({
  enablePicsCache: true,
  webCompatibilityMode: true,        // 穿透防火墙 (WebSocket:443)
});
Object.assign(client.options, {
  httpProxy: process.env.HTTP_PROXY || undefined,
  socksProxy: process.env.SOCKS_PROXY || undefined,
});

const csgo = new GlobalOffensive(client);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// === Token 持久化 ===
const tokenPath = './data/tokens.json';
let savedTokens = {};
if (fs.existsSync(tokenPath)) {
  try { savedTokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8')); } catch {}
}
function saveToken(accountName, token) {
  savedTokens[accountName] = token;
  fs.writeFileSync(tokenPath, JSON.stringify(savedTokens, null, 2));
}

// === 登录方式选择 ===
const accountName = process.env.STEAM_ACCOUNT;
const savedToken = savedTokens[accountName];
let loginDone = false;

let logonOptions;
if (savedToken && !process.argv.includes('--password')) {
  logonOptions = { refreshToken: savedToken };           // 免密登录
} else {
  logonOptions = { accountName, password: process.env.STEAM_PASSWORD };
}

// === 事件 ===

// Refresh Token → 永久保存
client.on('refreshToken', (token) => {
  saveToken(accountName, token);
});

// Steam Guard (仅密码登录时触发)
client.on('steamGuard', (domain, callback, lastCodeWrong) => {
  if (lastCodeWrong) {
    // CRITICAL: 等 30 秒再给新 TOTP 码, 否则 IP 被临时封禁
    setTimeout(() => callback(getTOTPCode()), 30000);
  } else {
    callback(getTOTPCode());
  }
});

// 登录成功 → 启动 CS2
client.on('loggedOn', () => {
  loginDone = true;
  client.setPersona(SteamUser.EPersonaState.Online);
  client.gamesPlayed([730]);
});

// 断线 (非致命 — autoRelogin 默认 true 会自动重连)
client.on('disconnected', (eresult, msg) => {
  if (!loginDone) {
    console.error(`登录失败: ${msg} (${SteamUser.EResult[eresult]})`);
    if (eresult === 84) {
      delete savedTokens[accountName];                   // Token 失效 → 清除
      fs.writeFileSync(tokenPath, JSON.stringify(savedTokens));
    }
    process.exit(1);
  }
});

// 致命错误 → Token 失效自动清除
client.on('error', (err) => {
  if (err.message?.includes('InvalidToken') || err.eresult === 84) {
    delete savedTokens[accountName];
    fs.writeFileSync(tokenPath, JSON.stringify(savedTokens));
  }
  process.exit(1);
});

client.logOn(logonOptions);
```

**命令行：**
```bash
node index.js                 # Token → 密码降级
node index.js --password      # 强制密码登录 (更换密码/Token失效时)
```

**代理支持 (`.env`)：**
```
SOCKS_PROXY=socks5://127.0.0.1:10808
HTTP_PROXY=http://127.0.0.1:10809
```

---

### 汰换交易 (Trade-Up / Craft)

**前置条件：** 每组 10 件**同稀有度**物品。支持批量多组（`;` 分隔），顺序执行，
组间 500ms 间隔防 GC 限速，任一组失败不中断后续组。

**命令行：**
```bash
node index.js --trade-up=id1,...,id10                      # 单组
node index.js --trade-up=id1,...,id10;id11,...,id20         # 多组 (; 分隔)
```

**完整实现：**
```js
if (TRADE_UP) {
  // 解析组: "id1,...,id10;id11,...,id20" → [["id1",...], ["id11",...]]
  const groups = TRADE_UP.split(';').map(g => g.split(',').map(s => s.trim()));

  // 验证每组恰好 10 件
  for (let i = 0; i < groups.length; i++) {
    if (groups[i].length !== 10) { /* 报错退出 */ }
  }

  const rarityToRecipe = {
    '消费级': 0, '工业级': 1, '军规级': 2, '受限': 3, '保密': 4,
  };

  let idx = 0, ok = 0, fail = 0;

  function next() {
    if (idx >= groups.length) {
      console.log('✅ 批量汰换: ' + ok + ' 成功, ' + fail + ' 失败');
      process.exit(0);
      return;
    }

    const tradeIds = groups[idx];
    idx++;
    const label = '[' + idx + '/' + groups.length + ']';

    // 1. GC 库存定位 + 验证
    const rawItems = tradeIds.map(id =>
      csgo.inventory.find(i => String(i.id) === id)
    ).filter(Boolean);
    if (rawItems.length !== 10) { fail++; return next(); }

    // 2. 稀有度 → recipe
    const processed = processInventory(rawItems).items;
    const rarities = [...new Set(processed.map(i => i.rarityNameZh))];
    if (rarities.length > 1) { fail++; return next(); }

    const allStatTrak = processed.every(i => i.stattrak);
    let recipe = rarityToRecipe[rarities[0]];
    if (allStatTrak) recipe += 10;

    // 3. 执行
    csgo.craft(rawItems.map(i => i.id), recipe);

    // 4. 等待结果 (10s 超时)
    const t = setTimeout(() => { fail++; next(); }, 10000);

    csgo.once('craftingComplete', (rr, gained) => {
      clearTimeout(t);
      if (rr === -1) { fail++; }
      else {
        // 解析产出物
        const g = gained.map(id => {
          const item = csgo.inventory.find(i => String(i.id) === String(id));
          if (!item) return { name: 'ID:' + id };
          return processInventory([item]).items[0];
        });
        console.log('  ✅ → ' + g.map(x => x.name).join(' | '));
        ok++;
      }
      setTimeout(next, 500); // 组间间隔
    });
  }

  next();
  return;
}
```

**Recipe 速查表：**

| INPUT 稀有度 | Recipe | OUTPUT |
|-------------|--------|--------|
| 消费级 (Consumer) | 0 | 工业级 |
| 工业级 (Industrial) | 1 | 军规级 |
| 军规级 (Mil-Spec) | 2 | 受限 |
| 受限 (Restricted) | 3 | 保密 |
| 保密 (Classified) | 4 | 隐秘 |
| StatTrak 版本 | +10 | 对应 StatTrak |

**失效原因：** `recipe=-1` 最常见原因是稀有度→recipe 映射偏移，或物品混入不同稀有度。

---

### Item Inspection (All Forms)

```js
// Standard link:
csgo.inspectItem('steam://rungame/730/... +csgo_econ_action_preview%20S76561198006409530A12345678901D67890');
// Masked link (synchronous!):
csgo.inspectItem('steam://rungame/730/... +csgo_econ_action_preview%20M0A1B2C3...hex...');
// Individual:
csgo.inspectItem('76561198006409530', '12345678901', '67890', (item) => { ... });

csgo.on('inspectItemInfo', (item) => {
  console.log(`Float: ${item.paintwear.toFixed(6)} | Paint: ${item.paintindex} | Seed: ${item.paintseed}`);
  if (item.stickers) item.stickers.forEach(s => console.log(`  Slot ${s.slot}: id=${s.sticker_id}`));
  if (item.keychains) console.log('Has', item.keychains.length, 'keychain(s)');
});
```

### Storage Units

```js
csgo.getCasketContents('casketId', (err, items) => { ... });
const loose = csgo.inventory.filter(i => !i.casket_id);
csgo.addToCasket('casketId', 'itemId');
csgo.removeFromCasket('casketId', 'itemId');

csgo.on('itemCustomizationNotification', (itemIds, type) => {
  if (type === GlobalOffensive.ItemCustomizationNotification.CasketInvFull) {
    console.log('Inventory full!', itemIds[0]);
  }
});
```

---

## Enum Quick Reference

### EPersonaState: Offline(0), Online(1), Busy(2), Away(3), Snooze(4), LookingToTrade(5), LookingToPlay(6), Invisible(7)

### EFriendRelationship: None(0), Blocked(1), RequestRecipient(2), Friend(3), RequestInitiator(4), Ignored(5), IgnoredFriend(6), SuggestedFriend(7)

### EClanRelationship: None(0), Blocked(1), Invited(2), Member(3), Kicked(4), KickedByRagequit(5), LeftGroup(6)

### EEconTradeResponse: Accepted, Declined, TradeBannedInitiator, TradeBannedTarget, TargetAlreadyTrading, Disabled, NotLoggedIn, Cancel, TooSoon, TooSoonPenalty, ConnectionFailed, AlreadyTrading, AlreadyHasTradeRequest, NoResponse, CyberCafeInitiator, CyberCafeTarget, SchoolLabInitiator, SchoolLabTarget, InitiatorBlockedTarget, TargetBlockedInitiator, InitiatorNeedsSteamGuard, TargetNeedsSteamGuard, InitiatorSteamGuardDuration, TargetSteamGuardDuration

### ECurrencyCode: USD(1), GBP(2), EUR(3), CHF(4), RUB(5), PLN(6), BRL(7), JPY(8), NOK(9), IDR(10), MYR(11), PHP(12), SGD(13), THB(14), VND(15), KRW(16), TRY(17), UAH(18), MXN(19), CAD(20), AUD(21), NZD(22), CNY(23), INR(24), CLP(25), PEN(26), COP(27), ZAR(28), HKD(29), TWD(30), SAR(31), AED(32), ARS(34), ILS(35), BYN(36), KZT(37), KWD(38), QAR(39), CRC(40), UYU(41), BGN(42), HRK(43), CZK(44), DKK(45), HUF(46), RON(47)

---

## Critical Gotchas

1. **Always handle `error` events** on both SteamUser and GlobalOffensive. Unhandled = process crash.

2. **Do NOT call GC methods before `connectedToGC`** — check `csgo.haveGCSession` first.

3. **TOTP `lastCodeWrong === true`** — MUST wait 30 seconds before providing new code. Failure = temporary IP ban + login loop.

4. **`enablePicsCache: true`** is required for `getOwnedApps()`, `ownsApp()`, `ownsDepot()`. They throw without it. Also wait for `ownershipCached` event.

5. **Set persona state after logon**: `client.setPersona(SteamUser.EPersonaState.Online)`. Without this you won't receive persona data for friends or appear online.

6. **Casket items still appear in `csgo.inventory`**. Filter by `!item.casket_id` for loose items. The GC may load casket items without explicit `getCasketContents()`.

7. **GC can reconnect silently** — `connectedToGC` may fire without preceding `disconnectedFromGC`. Always re-check `csgo.inventory` on reconnect.

8. **Masked inspect links are synchronous** — they decode locally (XOR demask → CRC32 verify → protobuf decode) and emit via `setImmediate()`. No GC round-trip.

9. **Use `client.chat` (SteamChatRoomClient)**, NOT the deprecated `chatMessage()` / `joinChat()` methods on SteamUser.

10. **`craft()` requires exactly 10 items** of the same grade. Recipes are not CS2 version dependent.

11. **SteamUser class has ~220+ auto-generated enums** from protobufs — use `SteamUser.EResult`, `SteamUser.ECurrencyCode`, etc. Value-to-name lookup: `SteamUser.EResult[88]` → `'TwoFactorCodeMismatch'`.

12. **Storage engine can be replaced** — hook `client.storage.on('save', ...)` and `client.storage.on('read', ...)` for database persistence.

13. **TCP encryption handshake**: `ChannelEncryptRequest → ChannelEncryptResponse → ChannelEncryptResult`. WebSocket uses TLS (wss://) and skips this.

14. **SOCKS proxy forces WebSocket protocol** — it's incompatible with TCP transport.

15. **`redeemKey()` has a 90-second timeout** — the longest after `getProductInfo`'s 60 minutes.
