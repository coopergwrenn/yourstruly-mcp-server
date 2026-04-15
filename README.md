# YoursTruly MCP Server

> **The agent skill that turns any AI into a direct mail machine.**
> One tool call. Real handwritten postcards. Delivered by USPS.

[![npm version](https://img.shields.io/npm/v/yourstruly-mcp-server.svg)](https://www.npmjs.com/package/yourstruly-mcp-server)
[![MCP compatible](https://img.shields.io/badge/MCP-compatible-blue.svg)](https://modelcontextprotocol.io)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](#license)

Send physical handwritten postcards from any MCP-compatible AI agent — **Claude Desktop, Cursor, Claude Code, OpenClaw, n8n, LangChain, CrewAI, or your own code**. YoursTruly handles image upload, card creation, robotic handwriting (real pen and ink), and USPS mailing.

- 💌 **$4.99 per card** — no subscriptions, no monthly minimums
- ✍️ **Real handwriting** — robotic pens hold real ink (not font simulation)
- 📬 **3–5 business days** — printed and mailed via USPS
- 🤖 **Built for agents** — one tool call, spend controls, idempotency, test mode
- 🇺🇸 **US addresses** — international coming soon

---

## Table of Contents

- [Why this exists](#why-this-exists)
- [Quick start (under 5 minutes)](#quick-start)
- [Client configuration](#client-configuration)
- [Tools reference](#tools-reference)
- [The pool builder workflow](#the-pool-builder-workflow)
- [Message generation](#message-generation)
- [Image handling](#image-handling)
- [Test mode](#test-mode)
- [Spend control](#spend-control)
- [Error handling](#error-handling)
- [Configuration reference](#configuration-reference)
- [Handwriting styles](#handwriting-styles)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [What's next (roadmap)](#whats-next)
- [Contributing](#contributing)
- [License](#license)

---

## Why this exists

A new pattern is emerging in the AI agent ecosystem: autonomous bots that scan the world (satellite imagery, social media, public records), identify opportunities, and **reach out with real physical mail**. Pool builders, landscapers, roofers, solar installers, real estate agents — they're closing five- and six-figure deals from postcards mailed by bots.

Before YoursTruly, every builder hand-rolled their own mailing stack: image upload, card templating, print API, address validation, USPS handoff, tracking. It took weeks and was fragile.

We ship this as **one tool**. Your agent calls `send_postcard` with a recipient and a message. We do the rest.

---

## Quick start

### 1. Sign up and get an API key

Visit **[yourstruly.ai/developers](https://yourstruly.ai/developers)** (coming with v1.1). In v1.0, you can use a [Handwrytten](https://handwrytten.com) API key directly — the server auto-detects which one you're using.

### 2. Add the server to your MCP client

**Claude Desktop** — Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "yourstruly": {
      "command": "npx",
      "args": ["-y", "yourstruly-mcp-server"],
      "env": {
        "YOURSTRULY_API_KEY": "your_api_key",
        "YT_SENDER_NAME": "Jane Smith",
        "YT_SENDER_ADDRESS": "123 Main St",
        "YT_SENDER_CITY": "Austin",
        "YT_SENDER_STATE": "TX",
        "YT_SENDER_ZIP": "78701",
        "YT_TEST_MODE": "true"
      }
    }
  }
}
```

Fully restart Claude Desktop after editing. (Not just close the window — quit from the menu.)

### 3. Verify it's working

Open a new chat and ask:

> "List the MCP tools you have available."

You should see `send_postcard` and `generate_message`.

### 4. Send a test card

Still in test mode (`YT_TEST_MODE=true`), ask:

> "Send a postcard to Jane Smith at 123 Oak St, Austin TX 78701 saying 'Thanks for the great meeting yesterday — looking forward to next steps.'"

The agent will call `send_postcard`. You'll get back a mock `order_id` and confirmation that test mode is on. No card mailed, no money spent.

### 5. Go live

Remove `YT_TEST_MODE` from your config (or set to `false`), restart, and your next send will mail a real card.

---

## Client configuration

Copy-paste-ready configs for every major MCP client.

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
`%APPDATA%\Claude\claude_desktop_config.json` (Windows)

```json
{
  "mcpServers": {
    "yourstruly": {
      "command": "npx",
      "args": ["-y", "yourstruly-mcp-server"],
      "env": {
        "YOURSTRULY_API_KEY": "your_key"
      }
    }
  }
}
```

### Cursor

Global: `~/.cursor/mcp.json`
Per-project: `.cursor/mcp.json` in repo root

```json
{
  "mcpServers": {
    "yourstruly": {
      "command": "npx",
      "args": ["-y", "yourstruly-mcp-server"],
      "env": {
        "YOURSTRULY_API_KEY": "your_key"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add yourstruly npx -y yourstruly-mcp-server
```

Then set env vars in `~/.claude/settings.json` under `mcpServers.yourstruly.env`.

### OpenClaw / InstaClaw

See the bundled [SKILL.md](./SKILL.md) for the full agent-facing skill definition. For standalone OpenClaw usage:

```yaml
mcp_servers:
  yourstruly:
    command: npx
    args: ["-y", "yourstruly-mcp-server"]
    env:
      YOURSTRULY_API_KEY: ${YT_API_KEY}
```

### n8n (via Composio — v1.1+)

Install the YoursTruly toolkit from the Composio marketplace. One-click add to any workflow. See [Composio docs](https://composio.dev) when available.

### Custom agents (programmatic)

Any MCP client library works. Example with the official TypeScript SDK:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "yourstruly-mcp-server"],
  env: { YOURSTRULY_API_KEY: "your_key", YT_TEST_MODE: "true" },
});
const client = new Client({ name: "my-agent", version: "1.0" }, { capabilities: {} });
await client.connect(transport);

const result = await client.callTool({
  name: "send_postcard",
  arguments: {
    to_name: "John Smith",
    to_address: "123 Oak St",
    to_city: "Austin",
    to_state: "TX",
    to_zip: "78701",
    message: "Hey John — thought you'd love this.",
    front_image_url: "https://example.com/render.png",
    idempotency_key: "john-smith-123-oak-001",
  },
});
```

---

## Tools reference

### `send_postcard`

Mails one physical handwritten postcard to a US address.

**Input**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to_name` | string | ✓ | Recipient's full name |
| `to_address` | string | ✓ | Street address line 1 |
| `to_address_2` | string | | Apt/suite/unit |
| `to_city` | string | ✓ | City |
| `to_state` | string | ✓ | 2-letter US state code |
| `to_zip` | string | ✓ | 5-digit ZIP (or 5+4) |
| `message` | string | ✓ | Handwritten message (max 400 chars) |
| `front_image_url` | string | | HTTPS URL to card front image (PNG/JPEG). Falls back to `YT_DEFAULT_CARD_IMAGE`. |
| `handwriting_style` | string | | Font name. Default: `Joyful Jennifer` |
| `return_address` | object | | Per-call sender override. Falls back to `YT_SENDER_*` env vars. |
| `idempotency_key` | string | | Unique dedup key. Same key = same result, no duplicate send. 24h TTL. |

**Output (success)**

```json
{
  "success": true,
  "order_id": 196937,
  "card_id": 305570,
  "recipient": "John Smith",
  "estimated_delivery": "3-5 business days via USPS",
  "balance_remaining": -1,
  "cards_available": -1,
  "cards_sent_today": 7,
  "daily_limit": 25
}
```

`balance_remaining` and `cards_available` return `-1` in v1.0 (direct Handwrytten mode). They return real values once you're on the YoursTruly wallet (v1.1+).

**Output (test mode)** adds `test_mode: true` and `mock_order_id`. No card is mailed.

**Output (error)** returns `isError: true` with an actionable message. See [Error handling](#error-handling).

### `generate_message`

AI-drafts a personalized postcard message. Uses Cloudflare AI if configured; otherwise returns a structured prompt your agent can use to self-generate (which is often just as good, since the agent is already an LLM).

**Input**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `recipient_context` | string | ✓ | Who the recipient is and why you're writing |
| `tone` | enum | | `warm` (default), `professional`, `casual`, `excited` |
| `max_chars` | number | | Max message length. Default 350, max 400. |
| `sender_context` | string | | Who the sender is |

**Output (AI configured)**

```json
{
  "message": "Hey John — drove by your place on Oak St and couldn't help but picture how a pool would transform that backyard. Happy to share a quick render if you're curious. — Kevin, Blue Wave Pools",
  "char_count": 212,
  "tone": "warm",
  "ai_generated": true
}
```

**Output (AI not configured)** — returns the system + user prompts your agent can feed into its own LLM:

```json
{
  "message": null,
  "ai_generated": false,
  "prompt": {
    "system": "You write short, personal messages for physical handwritten postcards...",
    "user": "Recipient: John Smith, homeowner at 123 Oak St...\nSender: Blue Wave Pools\n\nWrite the postcard message now."
  },
  "instructions": "Cloudflare AI not configured. Use the system/user prompts above to generate the message...",
  "tone": "warm",
  "max_chars": 350
}
```

### `compose_postcard_message` (MCP prompt)

An MCP prompt primitive (not a tool). Returns a formatted prompt template for your agent to use with its own LLM. Zero external API dependencies. Useful when you want deterministic, dependency-free message composition.

**Arguments:** `recipient`, `sender` (optional), `tone` (optional).

---

## The pool builder workflow

This is the viral use case that put autonomous postcard sending on the map. Pool builders run agents that:

1. **Scan** satellite imagery of a neighborhood (Google Maps, Nearmap, etc.)
2. **Classify** — find homes without pools
3. **Render** — generate a personalized before/after showing a pool in that exact backyard
4. **Compose** — write a warm, specific message about that home
5. **Send** — mail the handwritten postcard
6. **Close** — five-figure deals landing weekly

YoursTruly owns steps 4–5 with two tool calls. You own 1–3 (any image pipeline works).

### Full example

```js
// Your pipeline produced:
//   - homeowner: { name, street, city, state, zip }
//   - renderUrl: "https://cdn.mybucket.com/renders/123-oak-st-pool.jpg"

const msg = await generate_message({
  recipient_context: `${homeowner.name}, homeowner at ${homeowner.street}. Corner lot with large flat backyard, no pool.`,
  sender_context: "Blue Wave Pools — Austin, TX. Specializing in fiberglass pools installed in 14 days.",
  tone: "warm",
});

const result = await send_postcard({
  to_name: homeowner.name,
  to_address: homeowner.street,
  to_city: homeowner.city,
  to_state: homeowner.state,
  to_zip: homeowner.zip,
  message: msg.message,
  front_image_url: renderUrl,
  idempotency_key: `prospect-${homeowner.id}`,  // crucial for retries
});

console.log(`Mailed card ${result.order_id}. ${result.cards_sent_today}/${result.daily_limit} today.`);
```

### Why this works

- **Real handwriting** beats printed mail 5–10× on open rate
- **Hyper-personalized image** (their actual house!) makes it unignorable
- **Warm, specific message** feels human, not mass-mailed
- **USPS delivery** triggers the "this is important" instinct

### Variations

| Industry | Scan for | Render | Tone |
|----------|----------|--------|------|
| **Pool builders** | No pool in backyard | Pool in their yard | Warm, aspirational |
| **Landscapers** | Overgrown / dead yards | Manicured landscape | Warm, visual |
| **Roofers** | Damaged or aged roofs | New roof render | Professional, urgent |
| **Solar installers** | Large south-facing roofs | Solar panel render | Professional, savings-focused |
| **Real estate agents** | FSBO or expired listings | Staged interior render | Professional, helpful |
| **Home remodelers** | Outdated exteriors | Modern renovation render | Excited, transformative |

All use the same two tool calls. Only the scanning, rendering, tone, and message change.

---

## Message generation

You have three ways to compose the handwritten message. Pick based on your setup:

### Option A — `generate_message` tool with Cloudflare AI

Set `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`. The server calls Llama 3.1 8B Instruct via Cloudflare Workers AI with YoursTruly's proven tone profiles. Returns a ready-to-use message.

```json
"env": {
  "YOURSTRULY_API_KEY": "...",
  "CLOUDFLARE_ACCOUNT_ID": "...",
  "CLOUDFLARE_API_TOKEN": "..."
}
```

### Option B — `generate_message` tool without AI (recommended for most agents)

Don't set the CF vars. The tool returns a **structured prompt** (system + user) that your agent uses with its own LLM. Since the calling agent is already an LLM (Claude, GPT, etc.), it generates a message at least as good as Llama 3.1 — often better.

### Option C — `compose_postcard_message` MCP prompt

An MCP prompt primitive (not a tool). Claude Desktop surfaces this in the slash-command menu. The agent injects YoursTruly's guidelines directly into its context and composes.

### Option D — Your agent writes the message itself

Skip `generate_message` entirely. Your agent already knows how to write. Just pass a message directly to `send_postcard`.

---

## Image handling

The `front_image_url` must be a **public HTTPS URL** to a PNG or JPEG. The server fetches the image, uploads it to Handwrytten, and creates a custom card.

### Recommended specs

- **Format:** PNG or JPEG
- **Orientation:** Landscape (wider than tall)
- **Size:** 2100 × 1500 px (7×5 inches at 300 DPI) — print quality
- **Minimum:** 1050 × 750 px
- **Max file size:** 10 MB
- **Accessibility:** Public URL, no auth headers, no signed URLs with short TTLs

### Common sources

| Source | Example |
|--------|---------|
| Your own CDN / S3 / Cloudflare R2 | `https://cdn.yoursite.com/renders/xyz.png` |
| AI image generation output | Most services return a public URL |
| Static templates | Pre-designed company cards hosted on your site |
| Recraft V3 (coming in a future release) | `generate_card_image` tool will return a URL |

### No image?

Set `YT_DEFAULT_CARD_IMAGE` to your branded fallback. Every call without `front_image_url` uses the default. This is ideal for business use cases where every card shares the same template.

---

## Test mode

Zero-cost, zero-risk testing. Set `YT_TEST_MODE=true` in your env.

When enabled:
- All inputs are validated normally (state code, ZIP format, message length, HTTPS URL)
- Daily limit counter increments (so you can test spend controls)
- Rate limiter enforces 2-second delays (so you can test timing)
- The Handwrytten API is **not called** — no cards printed, no money spent
- Response includes `test_mode: true` and `mock_order_id`

```json
{
  "success": true,
  "test_mode": true,
  "message": "Test mode — no card sent. Set YT_TEST_MODE=false to send real cards.",
  "mock_order_id": "test-1713099999999",
  "recipient": "Jane Smith",
  "estimated_delivery": "3-5 business days via USPS",
  "cards_sent_today": 3,
  "daily_limit": 25
}
```

**Best practice:** start with `YT_TEST_MODE=true`, verify your agent's tool calls look right, then flip it off for your first real send.

---

## Spend control

Agents run autonomously. Bad config + no limits = expensive bug. This server ships with four safety layers:

### 1. Daily limit (`YT_DAILY_LIMIT`, default 50)

Hard cap on cards per day. Counter resets at midnight UTC. Once reached:

```
isError: true
"Daily limit reached (25/25). Resets at midnight UTC. Adjust with YT_DAILY_LIMIT env var."
```

Set this low (5–10) while developing. Raise it once your agent is proven.

### 2. Rate limiter (2-second minimum between sends)

Firm server-side throttle. If you call `send_postcard` twice in rapid succession, the second call waits 2 seconds before executing. Prevents Handwrytten API abuse and gives you time to notice runaway behavior.

### 3. Idempotency keys

Pass `idempotency_key` in `send_postcard` args. Same key = same result, no duplicate send. Keys are cached for 24 hours.

```js
await send_postcard({ ..., idempotency_key: "prospect-123-oak-st" });
// If the network hiccups and your agent retries with the same key,
// you get back the original response — no second card mailed.
```

**Critical for autonomous agents.** Without this, a network timeout + retry = two postcards.

### 4. Test mode

See above. Belt and suspenders during development.

### Coming in v1.1

Prepaid wallet (pay ahead, spend down) with per-card billing, auto-reload with monthly cap, three funding paths (Stripe, USDC/WLD crypto, agent self-funding), instant pause (revoke API key from dashboard), and balance tracking in every response so agents can self-regulate.

---

## Error handling

Errors return `isError: true` with an actionable message written for the agent to relay to the human. Examples:

| Scenario | Error message |
|----------|---------------|
| Missing API key | `"YOURSTRULY_API_KEY not set. Add it to your MCP server env config. Get a key at yourstruly.ai/developers or use a Handwrytten API key for Phase 1."` |
| Invalid state code | `"Invalid state code \"ZZ\". Must be a 2-letter US state (e.g. CA, NY, TX)."` |
| Invalid ZIP | `"Invalid ZIP \"ABC12\". Must be 5 digits (e.g. 78701) or 5+4 (e.g. 78701-1234)."` |
| Missing image + no default | `"No card image. Provide front_image_url or set YT_DEFAULT_CARD_IMAGE env var."` |
| Non-HTTPS image URL | `"front_image_url must be an HTTPS URL."` |
| Missing return address | `"No return address. Provide return_address or set YT_SENDER_* env vars."` |
| Daily limit hit | `"Daily limit reached (25/25). Resets at midnight UTC. Adjust with YT_DAILY_LIMIT env var."` |
| Image fetch failed | `"Send failed: Cannot fetch image from URL (HTTP 404). Ensure the URL is publicly accessible."` |
| Handwrytten API error | `"Send failed: <classified error — address, message length, auth, etc.>"` |

Error messages are designed so your agent can read them and either self-correct or relay the fix to the human in plain language.

---

## Configuration reference

All config is via environment variables in your MCP client config.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `YOURSTRULY_API_KEY` | **Yes** | — | Your API key. [yourstruly.ai/developers](https://yourstruly.ai/developers) (v1.1+) or Handwrytten key (v1.0). |
| `YT_SENDER_NAME` | Recommended | — | Default sender full name |
| `YT_SENDER_ADDRESS` | Recommended | — | Default sender street address |
| `YT_SENDER_CITY` | Recommended | — | Default sender city |
| `YT_SENDER_STATE` | Recommended | — | Default sender 2-letter state code |
| `YT_SENDER_ZIP` | Recommended | — | Default sender ZIP |
| `YT_DEFAULT_CARD_IMAGE` | Recommended | — | HTTPS URL of default card front image (used when caller omits `front_image_url`) |
| `YT_HANDWRITING_STYLE` | Optional | `Joyful Jennifer` | Default handwriting font |
| `YT_DAILY_LIMIT` | Optional | `50` | Max cards per day. Set low while developing. |
| `YT_TEST_MODE` | Optional | `false` | `true` = skip Handwrytten API, return mock responses |
| `CLOUDFLARE_ACCOUNT_ID` | Optional | — | Enables AI message generation via Llama 3.1 |
| `CLOUDFLARE_API_TOKEN` | Optional | — | Required with `CLOUDFLARE_ACCOUNT_ID` |

**Per-call overrides:** `return_address`, `handwriting_style`, and `front_image_url` in `send_postcard` args override the env defaults for that one send.

---

## Handwriting styles

Default: `Joyful Jennifer` — warm, friendly, genuine handwriting.

Other styles depend on your Handwrytten account. Common options:

- `Joyful Jennifer` — warm, friendly feminine
- `Tarzan` — bold, energetic
- `Casual Craig` — relaxed masculine
- `Fancy Fiona` — elegant script
- `Precise Paul` — neat, business-like

Pass the exact style name as `handwriting_style` in the tool args, or set `YT_HANDWRITING_STYLE` globally. To see all styles available on your account, check your Handwrytten dashboard.

---

## Troubleshooting

### Claude Desktop doesn't show the tools

1. **Fully quit Claude Desktop** (menu → Quit, not just close window) and reopen. Config changes require a full restart.
2. Verify the config JSON is valid (no trailing commas, correct quotes).
3. On macOS, check the path: `~/Library/Application\ Support/Claude/claude_desktop_config.json`.
4. Run `npx -y yourstruly-mcp-server` manually in a terminal. If it errors, fix that first.

### `npx -y yourstruly-mcp-server` hangs

That's expected — it's waiting for MCP protocol input on stdin. To test it standalone, use the included test harness:

```bash
cd src/MCP/yourstruly-mcp-server
npm install
npm run build
YOURSTRULY_API_KEY=test YT_TEST_MODE=true node test-harness.mjs
```

### "YOURSTRULY_API_KEY not set"

The env var isn't being passed to the server. Check that:
- Your MCP client config has the `env` block set correctly
- You restarted the client after editing config
- The key is wrapped in quotes in JSON

### "Cannot fetch image from URL"

The image URL must be:
- A public HTTPS URL (no http://, no file://, no data:)
- Accessible without auth headers or cookies
- Returning a valid PNG or JPEG with `Content-Type: image/png` or `image/jpeg`

Test with `curl -I <url>` — should return 200 and a valid image content-type.

### Cards aren't arriving

1. Is `YT_TEST_MODE` set to `true`? If so, no cards are actually mailed. Remove it or set to `false`.
2. Check your Handwrytten dashboard for the `order_id` returned by the call. It should show as queued/printed/mailed.
3. Delivery is 3–5 business days after the card is *mailed* (not *ordered*). Printing happens within 1 business day.

### Rate limiter seems too slow

The 2-second minimum is intentional and firm. It prevents Handwrytten API abuse and gives you a chance to notice runaway behavior. For bulk campaigns of thousands of cards, use the existing `bulk-campaigns-worker` API instead (different code path, different pricing).

---

## FAQ

**How much does it cost?**
$4.99 per card. No monthly minimums, no subscriptions. Volume discounts starting at 101 cards/month (v1.1).

**How fast does it arrive?**
3–5 business days via USPS after mailing. Cards are printed and mailed within 1 business day of the API call.

**Is the handwriting really handwritten?**
Yes. [Handwrytten](https://handwrytten.com) uses custom robots that hold real pens and write in real ink on real paper. Recipients can't tell. Handwrytten is our fulfillment partner.

**What's the open rate on handwritten mail?**
Typically 5–10× higher than printed direct mail. Personalized imagery on the front (AI-rendered) further lifts response rates.

**What countries are supported?**
US only in v1.0 (including DC, Puerto Rico, and other US territories). Canada, UK, and EU support planned.

**Can I send letters or packages?**
Postcards only in v1.0. Letters, envelopes, and greeting cards planned for later releases.

**What image formats work?**
PNG or JPEG. Landscape 7×5 inches (2100×1500 px at 300 DPI) is ideal.

**Can I cancel a send?**
Not in v1.0. Cancel-within-printing-window (`cancel_postcard` tool) is planned for v1.1.

**Can I check delivery status?**
Not in v1.0. `check_order_status` tool is planned for v1.1.

**What happens if the agent has a bug and tries to send 1000 cards?**
Set `YT_DAILY_LIMIT` low (5–10) while developing. Send #11 returns an error instead of mailing. Combined with `idempotency_key` for retries and 2-second rate limiting, the three most common runaway scenarios are covered. v1.1 adds a wallet with a hard balance cap — once you hit $0, the agent stops.

**Can the agent fund itself from crypto earnings?**
Coming in v1.1. Three funding paths: Stripe (human pays), crypto deposit (human sends USDC/WLD), and agent self-funding (agent spends from its own wallet — human-authorized with monthly cap). This enables fully autonomous business loops: agent earns crypto → funds wallet → sends cards → closes deals → earns more.

**Can I use this commercially?**
Yes. MIT license. Cards are billed per-send, no license fees.

**How does pricing compare to Lob or PostGrid?**
Lob and PostGrid do printed postcards at $0.48–$0.77. We do **handwritten** postcards at $4.99. Different product. The handwriting premium pays for itself via the dramatically higher open and response rates for the kinds of outbound use cases where this matters (real estate, home services, high-ticket sales).

**Can multiple agents share one API key?**
Yes, but they share the daily limit. Use separate keys per agent for isolation (v1.1+ supports multiple keys per account).

**Does this work with langchain / crewai / autogen?**
Any framework with MCP client support works. The TypeScript/Python MCP SDK connects to this server like any other MCP tool. See the [Custom agents](#client-configuration) section for code.

**What data do you log?**
Structured JSON events to stderr only. We log: event name, timestamp, city/state (for debugging), counter values, order IDs. We **never** log: full addresses, full messages, recipient names, API keys, or image URLs with auth tokens.

---

## What's next

Current: **v1.0** — Direct Handwrytten API, $4.99/card via your own HW key.

Coming in **v1.1** (2–3 weeks):
- YoursTruly developer signup at yourstruly.ai/developers
- Prepaid wallet (pay ahead, spend down) with Stripe + USDC crypto
- `check_balance` tool — agents see their balance in every response
- `check_order_status` tool — poll fulfillment status
- `cancel_postcard` tool — cancel within printing window
- Pooled Handwrytten account (no HW account required)

Coming in **v2.0** (6–8 weeks):
- Full developer dashboard at yourstruly.ai/developers
- Auto-reload with monthly cap
- Webhook events (card_sent, low_balance, daily_limit_hit)
- Multiple API keys per account
- **Path 3:** Agent self-funding from its own crypto wallet (human-authorized)
- USPS CASS-certified address validation
- Volume pricing tiers (101–500: $4.49, 501–2000: $3.99, 2000+: custom)

Coming in **v3.0+**:
- `generate_card_image` tool — Recraft V3 AI card art
- Card template library (thank-you, birthday, business, real estate, etc.)
- Multi-provider fulfillment (handwritten via Handwrytten, printed via Lob)
- International mail (Canada, UK, EU)
- Batch send tool for high-volume workflows
- Letters and envelopes

Full roadmap in the [PRD](../../_notes/PRDs/InProgress/PRD-YoursTruly-MCP-Server.md).

---

## Contributing

Issues and PRs welcome at the [GitHub repo](https://github.com/coopergwrenn/yourstruly-mcp-server). For major changes, open an issue first to discuss.

Running the test harness:

```bash
npm install
npm run build
YOURSTRULY_API_KEY=test YT_TEST_MODE=true node test-harness.mjs
```

All 37 checks should pass.

---

## Links

- **npm:** [`yourstruly-mcp-server`](https://www.npmjs.com/package/yourstruly-mcp-server)
- **GitHub:** [github.com/coopergwrenn/yourstruly-mcp-server](https://github.com/coopergwrenn/yourstruly-mcp-server)
- **SKILL.md** (for agents): [`./SKILL.md`](./SKILL.md)
- **PRD:** [full spec](../../_notes/PRDs/InProgress/PRD-YoursTruly-MCP-Server.md)
- **YoursTruly:** [yourstruly.ai](https://yourstruly.ai)
- **Handwrytten** (fulfillment partner): [handwrytten.com](https://handwrytten.com)
- **Model Context Protocol:** [modelcontextprotocol.io](https://modelcontextprotocol.io)

---

## License

MIT © YoursTruly AI
