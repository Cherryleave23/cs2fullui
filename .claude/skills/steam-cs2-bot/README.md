# steam-cs2-bot — Claude Code Skill

CS2 交易工具开发的完整知识库。本 Skill 基于对四个 GitHub 项目的**逐文件源码阅读**编写，
覆盖从 Steam 登录到 CS2 物品操作的全链路。

## 数据源

| 项目 | 版本 | 作者 | 源码规模 | 用途 |
|------|------|------|---------|------|
| [node-steam-user](https://github.com/DoctorMcKay/node-steam-user) | v5.x | DoctorMcKay | 30+ 组件文件, 220+ 枚举 | Steam 客户端协议 (TCP/WebSocket CM 连接) |
| [node-globaloffensive](https://github.com/DoctorMcKay/node-globaloffensive) | v3.3.0 | DoctorMcKay | index + handlers + 6 proto 文件 | CS2 游戏协调器 (GC) |
| [CSGO-API](https://github.com/ByMykel/CSGO-API) | latest | ByMykel | 18 个 JSON 端点, 28 种语言 | CS2 物品静态数据 (皮肤/贴纸/箱子/探员/挂件) |
| [node-steam-session](https://github.com/DoctorMcKay/node-steam-session) | v1.9.4 | DoctorMcKay | TypeScript, 3 核心类 | Steam 认证会话 (HTTP API 层) |

## 安装

将 `steam-cs2-bot/` 目录放到项目的 `.claude/skills/` 下：

```
your-project/
└── .claude/
    └── skills/
        └── steam-cs2-bot/
            ├── SKILL.md    (1734 行, 主知识库)
            └── README.md   (本文件)
```

## 使用方式

```
/steam-cs2-bot                          # 加载完整参考
/steam-cs2-bot auth                     # 指定主题
```

**可选 topic 参数:** `auth`, `trade`, `inventory`, `cs2`, `crafting`, `chat`, `friends`,
`storage`, `skins`, `stickers`, `crates`, `cdn`, `tickets`, `csgoapi`

在 prompt 中提及 `steam-user`、`globaloffensive`、CS2 库存/贴纸/汰换等关键词时，
Skill 会自动触发加载。

---

## 功能详解

### 1. Steam 登录与会话管理

#### 1.1 Token 持久化（免密登录）

首次使用密码登录成功后，`steam-user` 会通过 `refreshToken` 事件返回一个 JWT
refresh token（有效期约 200 天）。将其保存到本地文件，后续启动直接使用 token
登录，无需密码和 Steam Guard 验证码。

**文件格式** (`data/tokens.json`):
```json
{ "your_account_name": "eyAidHlwIjogIkpXVCIs..." }
```

**登录优先级：**
1. `data/tokens.json` 中存在该账号的 refresh token → 免密登录
2. 否则 → 使用 `.env` 中的账号密码登录
3. 可选: `--password` 强制密码登录 (Token 过期时)
4. 可选: `--qr` QR 码扫码登录

**Token 生命周期：**
- 每次密码登录或 token 续期 → `refreshToken` 事件 → 自动写入文件
- Token 失效 (`eresult=84` 或 `InvalidToken`/`Expired`) → 自动从文件删除 → 下次自动降级密码登录

**命令行：**
```bash
node index.js                 # 自动: Token 优先 → 密码降级
node index.js --password      # 强制密码登录
node index.js --qr            # QR 码扫码登录
```

#### 1.2 代理配置

支持 HTTP 和 SOCKS5 代理，在 `.env` 中配置：

```env
SOCKS_PROXY=socks5://127.0.0.1:10808    # V2RayN 默认 SOCKS5 端口
HTTP_PROXY=http://127.0.0.1:10809       # V2RayN HTTP 代理端口
```

`webCompatibilityMode: true` 强制使用 WebSocket (wss://port 443)，配合代理可穿透
大多数企业防火墙。SOCKS 代理会强制 WebSocket 协议。

#### 1.3 Steam Guard 处理

密码登录时可能触发 `steamGuard` 事件，需要用户输入验证码。

**事件参数：**
- `domain` — `null` 表示 TOTP (手机令牌)，否则为邮箱域名 (如 `gmail.com`)
- `callback(code)` — 调用此回调提交验证码
- `lastCodeWrong` — 上一次 TOTP 码是否错误。**为 `true` 时必须等 30 秒再给新码**，否则 IP 会被临时封禁

#### 1.4 登录超时与断线重连

- **登录超时:** 30 秒未收到 `loggedOn` 或 `steamGuard` → 超时诊断并退出
- **非致命断线:** `disconnected` 事件 → `autoRelogin: true` (默认) 会自动重连
- **致命错误:** `error` 事件 → Token 过期自动清除 → 退出

#### 1.5 底层认证流程 (steam-session)

`steam-user` 内部使用 `steam-session` 完成 HTTP 层面的认证：

```
LoginSession(EAuthTokenPlatformType.SteamClient)
  → startWithCredentials({accountName, password})
    → POST api.steampowered.com/BeginAuthSessionViaCredentials
    → 密码加密: RSA 公钥 + AES 会话密钥
    → 返回 allowedConfirmations[] (守卫列表)
  → submitSteamGuardCode(code)  (如需)
  → 轮询 PollAuthSessionStatus
  → authenticated → refreshToken
→ steam-user 取得 refreshToken
→ 通过 CM 协议发送 ClientLogon (EMsg 5514)
```

| 守卫类型 | 值 | 处理方式 |
|---------|---|---------|
| `None` | 0 | 无需操作，直接轮询 |
| `EmailCode` | 1 | 邮箱验证码 → `submitSteamGuardCode` |
| `DeviceCode` | 2 | TOTP 验证码 → `submitSteamGuardCode` |
| `DeviceConfirmation` | 3 | 手机 App 确认 → 轮询等待 |
| `EmailConfirmation` | 4 | 点击邮件链接 → 轮询等待 |
| `MachineToken` | 5 | 机器令牌 → 自动处理 |

**Token 平台类型 (`EAuthTokenPlatformType`)：**

| 类型 | 值 | Transport | Token 权限 |
|------|---|-----------|-----------|
| `SteamClient` | 1 | WebSocket CM | `['web','client']` |
| `WebBrowser` | 2 | api.steampowered.com | `['web']` |
| `MobileApp` | 3 | api.steampowered.com | `['web','mobile']` |

---

### 2. CS2 库存导出

#### 2.1 数据链路

```
登录 → gamesPlayed([730]) → GC 返回 CMsgClientWelcome
  → SO 缓存 type_id=1 → CSOEconItem[] → _processSOEconItem() 增强
  → csgo.inventory[] (完整物品数组)
  → 本地 CSGO-API JSON 解析 ID → 中文名/稀有度/磨损
  → 输出 inventory_export.json
```

#### 2.2 物品 ID 解析核心逻辑

GC 返回的 `def_index` 是所有物品类型**共享的全局编号**，同一個數字可能同時代表武器和貼紙。
因此必须基于物品属性（而非 `def_index`）来判定真实类型。

**三路分派规则：**

```
CSOEconItem
  │
  ├─ item.stickers[0] 存在?
  │   YES → 贴纸容器。真实身份 = stickers[0].sticker_id
  │         用 stickers.json 解析: "sticker-{sticker_id}"
  │         ★ 绝对不用 def_index 命名! def_index 只是容器型号(如 1209=通用贴纸容器)
  │
  ├─ item.paint_index != null && item.paint_index !== 0?
  │   YES → 武器皮肤。用 skins_not_grouped.json 解析:
  │         key = paint_index + "|" + weapon_id
  │
  ├─ isKnownWeapon(def_index)?
  │   YES → 原版武器 (无涂装)
  │
  └─ 否则 → 箱子/收藏品/探员/涂鸦等
            从 inventory.json 按类别精度计分匹配
            (stickers 类别有 10441 个 key, 权重极低, 不会误匹配)
```

**关键发现 (实战验证)：**
- `def_index=1209` 是所有独立贴纸的通用容器编号。512 个 GC 物品共享此编号但装着 101 种不同贴纸
- CSGO-API 数据存在断层 (如贴纸 ID 1695→1738)，需 fallback 为 `印花 #{id}`
- `inventory.json` 的 `stickers` 和 `sticker_slabs` 各有 10441 个 key (1-11173)，覆盖几乎所有 `def_index`。**永远不能**用它做首选匹配

#### 2.3 磨损分类

| 浮点范围 | 中文名 | 英文名 |
|---------|--------|--------|
| 0.00 - 0.07 | 崭新出厂 | Factory New |
| 0.07 - 0.15 | 略有磨损 | Minimal Wear |
| 0.15 - 0.38 | 久经沙场 | Field-Tested |
| 0.38 - 0.45 | 破损不堪 | Well-Worn |
| 0.45 - 1.00 | 战痕累累 | Battle-Scarred |

#### 2.4 稀有度映射

| 中文名 | 英文名 | 颜色 |
|--------|--------|------|
| 基础 | Base Grade | `#b0c3d9` |
| 工业级 | Industrial Grade | `#5e98d9` |
| 军规级 | Mil-Spec | `#4b69ff` |
| 受限 | Restricted | `#8847ff` |
| 保密 | Classified | `#d32ce6` |
| 隐秘 | Covert | `#eb4b4b` |
| 金色 | Gold | `#ffd700` |

#### 2.5 CSGO-API 数据端点 (18 个)

| 端点 | ID 格式 | 用途 |
|------|---------|------|
| `skins_not_grouped.json` | `skin-{weapon_id}_{paint_index}_{wear}` | 皮肤 (含磨损 + market_hash_name) |
| `skins.json` | `skin-{weapon_id}_{paint_index}` | 皮肤 (按磨损范围分组) |
| `stickers.json` | `sticker-{def_index}` | 贴纸 (含赛事/战队信息) |
| `sticker_slabs.json` | `sticker_slab-{def_index}` | 印花板 |
| `keychains.json` | `keychain-{def_index}` | 武器挂件 |
| `collections.json` | `collection-set-{name}` | 收藏品 (含内含物品列表) |
| `crates.json` | `crate-{def_index}` | 箱子/胶囊/纪念品包 (含 `contains[]` + `contains_rare[]`) |
| `keys.json` | `key-{name}` | 箱子钥匙 |
| `collectibles.json` | `collectible-{def_index}` | 服役勋章、老兵硬币 |
| `agents.json` | `agent-{def_index}` | 探员皮肤 (含 `team`) |
| `patches.json` | `patch-{def_index}` | 探员臂章 |
| `graffiti.json` | `graffiti-{def_index}` | 密封涂鸦 |
| `music_kits.json` | `music_kit-{def_index}` | 音乐盒 |
| `base_weapons.json` | `base_weapon-{name}` | 默认武器模型 |
| `highlights.json` | `aus2025_{name}` | 锦标赛精彩时刻 |
| `inventory.json` | `{skins: {weapon_id: {paint_index}}}` | 库存快速索引表 |
| `all.json` | `{id}` | 所有物品聚合索引 |

**本地使用：** 下载需要的 JSON 文件到 `data/` 目录，纯本地方案，无需网络。

```bash
npm run update-data       # 下载英文数据
npm run update-data-zh    # 下载简体中文数据
```

#### 2.6 导出 JSON 结构

```json
{
  "exportedAt": "2026-06-19T...",
  "steamId": "7656119...",
  "totalItems": 749,
  "statistics": {
    "totalItems": 749,
    "statTrakCount": 5,
    "souvenirCount": 8,
    "byRarityZh": { "军规级": 200, "工业级": 150, "受限": 30, "保密": 10 },
    "byWearZh": { "崭新出厂": 50, "略有磨损": 30, "久经沙场": 120 },
    "withStickers": 15,
    "totalStickers": 41
  },
  "items": [
    {
      "assetId": "52389074207",
      "defIndex": 1209,
      "name": "印花 | jabbi | 2026年科隆锦标赛",
      "itemType": "sticker",
      "rarityNameZh": "军规级",
      "rarityNameEn": "Mil-Spec Grade",
      "rarityColor": "#4b69ff",
      "wear": { "nameZh": "崭新出厂", "nameEn": "Factory New", "float": 0.061234 },
      "wearFloat": 0.061234567,
      "paintIndex": "10746",
      "paintSeed": 123,
      "minFloat": 0.00, "maxFloat": 0.70,
      "marketHashName": "Sticker | jabbi | Cologne 2026",
      "imageUrl": "https://...",
      "stickers": [{ "slot": 0, "stickerId": 4842, "name": "印花 | 骷髅章鱼", "wear": 0.15 }],
      "tradableAfter": "2026-06-26T07:00:00.000Z"
    }
  ]
}
```

---

### 3. 汰换交易 (Trade-Up / Craft)

#### 3.1 命令格式

```bash
# 单组 (10 件)
node index.js --trade-up=id1,id2,...,id10

# 多组 (用 ; 分隔)
node index.js --trade-up=id1,...,id10;id11,...,id20;id21,...,id30
```

#### 3.2 执行流程

```
1. 登录 + GC 连接
2. 解析命令行: ; 分隔组, , 分隔每组内的 10 个 assetId
3. 验证每组恰好 10 件
4. 顺序执行 (500ms 组间间隔防 GC 限速):
   │
   ├─ 4a. GC 库存定位 → csgo.inventory.find() × 10
   ├─ 4b. 稀有度验证 → [...new Set(rarities)].length === 1
   ├─ 4c. Recipe 推断 (见下表)
   ├─ 4d. csgo.craft(itemIds, recipe)
   │      → ByteBuffer [int16 recipe, int16 count=10, uint64×10 ids]
   │      → 经 steam-user sendToGC() 发送
   ├─ 4e. 等待 craftingComplete 事件 (10s 超时)
   │      recipe === -1 → 失败
   │      recipe !== -1 → 成功，解析产出物
   └─ 下一组 (setTimeout 500ms)
```

#### 3.3 Recipe 速查

| INPUT 稀有度 | Recipe | OUTPUT | StatTrak Recipe |
|-------------|--------|--------|-----------------|
| 消费级 | 0 | 工业级 | 10 |
| 工业级 | 1 | 军规级 | 11 |
| 军规级 | 2 | 受限 | 12 |
| 受限 | 3 | 保密 | 13 |
| 保密 | 4 | 隐秘 | 14 |

**Recipe 错误是 #1 失败原因。** 军规级是 recipe 2，不是 1。

#### 3.4 GC 协议层

```
csgo.craft(itemIds, recipe)
  → ByteBuffer (little-endian): [2B recipe][2B count=10][8B×10 ids]
  → Language.Craft (msg 1002, 非 protobuf)
  → EMsg.ClientToGC → 路由到 appid 730
  → GC 响应 → Language.CraftResponse (msg 1003) 处理:
    读取 [2B recipe][4B unused][2B count][8B×N gainedIds]
    → emit('craftingComplete', recipe, gainedIds[])
```

#### 3.5 批量汰换特性

- **失败不中断:** 某一组失败 (稀有度不一致/超时/物品未找到) 不影响后续组
- **组间间隔:** 500ms，防止 GC 限速拒绝
- **产出物解析:** 自动识别名称、稀有度、磨损
- **最终汇总:** `X 成功, Y 失败`

---

### 4. 物品检视 (inspectItem)

#### 4.1 三种调用形式

| 形式 | 参数 | GC 调用 | 速度 |
|------|------|---------|------|
| 标准链接 | `'steam://rungame/730/...S{owner}A{assetid}D{d}'` | 是 | 1-5s |
| Masked 链接 | `'steam://rungame/730/...M{hex}'` | **否** | 即时 |
| 独立参数 | `(owner, assetid, d[, callback])` | 是 | 1-5s |

**Masked 链接解码流程 (本地, 无 GC 调用)：**
```
hex 字符串 → Buffer → XOR demask (buffer[0] 为 mask key)
  → CRC32 校验 → CEconItemPreviewDataBlock protobuf 解码
  → paintwear uint32 → float 转换 (big-endian)
  → 即时 emit('inspectItemInfo')
```

#### 4.2 返回数据结构 (CEconItemPreviewDataBlock)

```
{
  itemid, defindex, paintindex, rarity, quality,
  paintwear (float), paintseed,
  killeaterscoretype, killeatervalue, customname,
  stickers[{slot, sticker_id, wear, scale, rotation, tint_id, offset_x, offset_y, offset_z, pattern}],
  keychains[{同 stickers 结构}],  // CS2 新增!
  inventory, origin, questid, dropreason, musicindex, entindex, petindex
}
```

---

### 5. GC 协议与物品结构

#### 5.1 GC 连接生命周期

```
gamesPlayed([730]) → steam-user emit 'appLaunched'(730)
  → globaloffensive._connect()
    → 发送 CMsgClientHello { version: 2000244 }
    → 指数退避重试: 500ms → 1s → 2s → ... → 60s max
  → GC 返回 CMsgClientWelcome
    → SO cache type_id=1 → CSOEconItem[] 解码
    → _processSOEconItem() 解析 paint/stickers/casket 等
    → haveGCSession = true → emit('connectedToGC')

断开:
  gamesPlayed([]) → appQuit → 无 disconnect 事件
  Steam 断线 → disconnected → emit('disconnectedFromGC') + 自动重连
  ConnectionStatus != HAVE_SESSION → 同上
  ClientLogonFatalError → emit('error')
```

#### 5.2 CSOEconItem 关键字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uint64 | 物品唯一 ID (assetId) |
| `def_index` | uint32 | 物品定义索引 (⚠️ 不同物品类型共享同一空间) |
| `quality` | uint32 | 品质 (4=普通, 9=StatTrak, 12=Souvenir) |
| `rarity` | uint32 | 稀有度数值 |
| `origin` | uint32 | 物品来源 (8=交易/开箱, 24=某种容器) |
| `inventory` | uint32 | bit30=new标志, bits0-15=位置 |
| `attribute[]` | array | 属性数组 (涂装/贴纸/可交易日期等) |
| `stickers[]` | array | globaloffensive 从 attribute 解码的贴纸 |
| `equipped_state[]` | array | 装备状态 |

#### 5.3 关键 Attribute 映射

| attr def_index | 字段 | 解码 |
|---------------|------|------|
| 6 | `paint_index` | `value_bytes.readFloatLE(0)` |
| 7 | `paint_seed` | `Math.floor(value_bytes.readFloatLE(0))` |
| 8 | `paint_wear` | `value_bytes.readFloatLE(0)` |
| 75 | `tradable_after` | `new Date(value_bytes.readUInt32LE(0) * 1000)` |
| 80 | `kill_eater_value` | `value_bytes.readUInt32LE(0)` |
| 81 | `kill_eater_score_type` | `value_bytes.readUInt32LE(0)` |
| 111 | `custom_name` | `value_bytes.slice(2).toString('utf8')` |
| 113+4i | `stickers[i].sticker_id` | `value_bytes.readUInt32LE(0)` |
| 114+4i+0 | `stickers[i].wear` | `value_bytes.readFloatLE(0)` |
| 270 | `casket_contained_item_count` | `value_bytes.readUInt32LE(0)` |
| 272+273 | `casket_id` | Long 组合 |
| 290+i | `stickers[i].slot` override | `value_bytes.readUInt32LE(0)` |

#### 5.4 GCConnectionStatus

| 值 | 名称 | 含义 |
|----|------|------|
| 0 | HAVE_SESSION | 已连接 |
| 1 | GC_GOING_DOWN | GC 正在关闭 (维护) |
| 2 | NO_SESSION | 未连接 |
| 3 | NO_SESSION_IN_LOGON_QUEUE | 排队中 |
| 4 | NO_STEAM | 无 Steam 连接 |

---

### 6. SteamChatRoomClient (现代聊天)

通过 `client.chat` 访问。旧的 `chatMessage()`/`joinChat()` 已废弃。

#### 6.1 核心方法 (28 个)

| 方法 | 参数 | 返回 |
|------|------|------|
| `createGroup` | `(inviteeSteamIds?, name?, cb?)` | `{chat_group_id, state, user_chat_state}` |
| `getGroups` | `(cb?)` | `{chat_room_groups}` |
| `joinGroup` | `(groupId, inviteCode?, cb?)` | `{state, user_chat_state}` |
| `leaveGroup` | `(groupId, cb?)` | void |
| `sendFriendMessage` | `(steamId, message, options?, cb?)` | `{modified_message, server_timestamp, ordinal}` |
| `sendChatMessage` | `(groupId, chatId, message, cb?)` | `{modified_message, server_timestamp, ordinal}` |
| `getFriendMessageHistory` | `(friendSteamId, options?, cb?)` | `{messages[], more_available}` |
| `getChatMessageHistory` | `(groupId, chatId, options?, cb?)` | `{messages[], more_available}` |
| `createInviteLink` | `(groupId, options?, cb?)` | `{invite_code, invite_url}` |
| `kickUserFromGroup` | `(groupId, steamId, expireTime?, cb?)` | void |
| `setGroupUserBanState` | `(groupId, userSteamId, banState, cb?)` | void |
| `createChatRoom` | `(groupId, name, options?, cb?)` | `{chat_room}` |
| `deleteChatRoom` | `(groupId, chatId, cb?)` | void |

#### 6.2 关键事件 (13 个)

| 事件 | 载荷 |
|------|------|
| `friendMessage` | `{steamid_friend, chat_entry_type, message, message_bbcode_parsed, server_timestamp: Date, ordinal}` |
| `friendTyping` | 同上结构 |
| `chatMessage` | `{chat_group_id, chat_id, steamid_sender, message, server_timestamp, ordinal, mentions?, server_message?}` |
| `chatMessagesModified` | `{chat_group_id, chat_id, messages: [{server_timestamp, ordinal, deleted}]}` |
| `chatRoomGroupSelfStateChange` | `{chat_group_id, user_action, user_chat_group_state, group_summary}` |
| `chatRoomGroupHeaderStateChange` | `{chat_group_id, header_state}` |
| `chatRoomGroupRoomsChange` | `{chat_group_id, default_chat_id, chat_rooms}` |

---

### 7. 进阶功能

#### 7.1 App Auth Ticket (加密票据)

```js
// 创建加密 App Ticket (用于向第三方服务器证明游戏所有权)
client.createEncryptedAppTicket(appid[, userData: Buffer], cb)
  → {encryptedAppTicket: Buffer}

// 静态解析器 (需要游戏的加密密钥)
SteamUser.parseEncryptedAppTicket(ticket: Buffer, key: Buffer|string) → object

// 创建 Auth Session Ticket (用于游戏服务器认证)
client.createAuthSessionTicket(appid, cb) → {sessionTicket: Buffer}

// 管理激活的 tickets
client.activateAuthSessionTickets(appid, tickets, cb)
client.cancelAuthSessionTickets(appid[, gcTokens], cb)
client.endAuthSessions(appid[, steamIDs], cb)
client.getActiveAuthSessionTickets() → [{appID, steamID, ticketCrc, gcToken, validated}]
```

#### 7.2 CDN Depot 下载

```js
client.getContentServers([appid], cb)                          // 获取 CDN 服务器列表
client.getDepotDecryptionKey(appID, depotID, cb)               // 仓库解密密钥
client.getCDNAuthToken(appID, depotID, hostname, cb)           // CDN 认证 token
client.getManifest(appID, depotID, manifestID, branch, cb)     // 下载并解析 manifest
client.getRawManifest(...)                                      // 下载不解压
client.downloadChunk(appID, depotID, chunkSha1, [server], cb)  // 下载数据块
client.downloadFile(appID, depotID, fileManifest, [path], cb)  // 下载完整文件
```

**解压格式:** Zstd (header `VSZa`), VZip/LZMA (header `VZa`), Zip (header `PK`)

#### 7.3 Family Sharing

```js
client.addAuthorizedBorrowers(steamIDs, cb)
client.removeAuthorizedBorrowers(steamIDs, cb)
client.getAuthorizedBorrowers([options], cb)
client.getAuthorizedSharingDevices([options], cb)
client.authorizeLocalSharingDevice(deviceName, cb) → {deviceToken}
client.deauthorizeSharingDevice(deviceToken, cb)
client.activateSharingAuthorization(ownerSteamID, deviceToken)  // fire-and-forget
```

#### 7.4 存储单元 (Casket)

```js
csgo.addToCasket(casketId, itemId)         // 放入
csgo.removeFromCasket(casketId, itemId)    // 取出
csgo.getCasketContents(casketId, cb)       // 加载内容 (30s 超时)
// 注意: GC 可能自动加载 casket 物品到 inventory，需用 !item.casket_id 过滤
```

---

## 关键发现 (实战踩坑)

1. **`def_index` 是容器编号，不是物品身份。** 512 个 `def_index=1209` 的 GC 物品装着 101 种不同贴纸。`stickers[0].sticker_id` 才是贴纸的真实 ID。

2. **CSGO-API 数据存在断层** (如贴纸 ID 1695→1738, 共 43 个缺失)。需 fallback 为 `印花 #{id}`。

3. **汰换 recipe 偏移** 是 #1 失败原因：军规级 recipe=2，不是 1。`rarityToRecipe` 映射必须对齐。

4. **`inventory.json` 的 stickers 类别有 10,441 个 key (1-11173)**，覆盖几乎所有物品编号。不能用它做首选匹配，必须用属性 (stickers[0]/paint_index/isKnownWeapon) 消歧义。

5. **SOCKS 代理 + `webCompatibilityMode`** 可穿透大多数企业防火墙。`api.steampowered.com` 的 HTTPS 请求和 CM 的 WebSocket 连接均通过代理。

6. **TOTP `lastCodeWrong === true`** 必须等 30 秒。连续快速重试会导致临时 IP 封禁。

7. **GC 可能静默重连** — `connectedToGC` 可能在不经 `disconnectedFromGC` 的情况下重复触发。始终重新读取 `csgo.inventory`。

8. **Masked inspect link 是同步的** — XOR demask + CRC32 + protobuf decode 全程本地完成，通过 `setImmediate()` 同步返回，无 GC 往返。

---

## 依赖

```
steam-user v5.x       - Steam 客户端协议
globaloffensive v3.x  - CS2 Game Coordinator
dotenv               - 环境变量加载 (.env)
```

## 文件结构

```
cs2tradetool/
├── index.js                    # 主程序 (库存导出 + 汰换)
├── generate_dict.js            # CSGO-API 数据下载器
├── .env                        # 环境变量 (账号/密码/代理)
├── data/
│   ├── tokens.json             # 持久化 refresh token
│   ├── skins_not_grouped.json  # CSGO-API 皮肤数据
│   ├── stickers.json           # CSGO-API 贴纸数据
│   ├── inventory.json          # CSGO-API 库存索引
│   ├── keychains.json          # CSGO-API 挂件数据
│   ├── crates.json             # CSGO-API 箱子数据
│   └── agents.json             # CSGO-API 探员数据
├── inventory_export.json       # 导出结果
└── .claude/skills/steam-cs2-bot/
    ├── SKILL.md                # 完整知识库 (1734 行)
    └── README.md               # 本文件
```

## Skill 版本

v2 · 1734 行 · 覆盖 4 个 GitHub 项目 · 基于源码级阅读编写
