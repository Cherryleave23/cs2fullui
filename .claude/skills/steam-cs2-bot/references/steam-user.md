# SteamUser API Reference



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

## Enum Quick Reference

## Enum Quick Reference

### EPersonaState: Offline(0), Online(1), Busy(2), Away(3), Snooze(4), LookingToTrade(5), LookingToPlay(6), Invisible(7)

### EFriendRelationship: None(0), Blocked(1), RequestRecipient(2), Friend(3), RequestInitiator(4), Ignored(5), IgnoredFriend(6), SuggestedFriend(7)

### EClanRelationship: None(0), Blocked(1), Invited(2), Member(3), Kicked(4), KickedByRagequit(5), LeftGroup(6)

### EEconTradeResponse: Accepted, Declined, TradeBannedInitiator, TradeBannedTarget, TargetAlreadyTrading, Disabled, NotLoggedIn, Cancel, TooSoon, TooSoonPenalty, ConnectionFailed, AlreadyTrading, AlreadyHasTradeRequest, NoResponse, CyberCafeInitiator, CyberCafeTarget, SchoolLabInitiator, SchoolLabTarget, InitiatorBlockedTarget, TargetBlockedInitiator, InitiatorNeedsSteamGuard, TargetNeedsSteamGuard, InitiatorSteamGuardDuration, TargetSteamGuardDuration

### ECurrencyCode: USD(1), GBP(2), EUR(3), CHF(4), RUB(5), PLN(6), BRL(7), JPY(8), NOK(9), IDR(10), MYR(11), PHP(12), SGD(13), THB(14), VND(15), KRW(16), TRY(17), UAH(18), MXN(19), CAD(20), AUD(21), NZD(22), CNY(23), INR(24), CLP(25), PEN(26), COP(27), ZAR(28), HKD(29), TWD(30), SAR(31), AED(32), ARS(34), ILS(35), BYN(36), KZT(37), KWD(38), QAR(39), CRC(40), UYU(41), BGN(42), HRK(43), CZK(44), DKK(45), HUF(46), RON(47)

---
