# CS2 Game Coordinator (globaloffensive v3.3.0)

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
