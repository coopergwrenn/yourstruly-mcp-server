---
name: postals
description: Send physical handwritten postcards to US addresses via Postals. Real robotic handwriting (pen and ink), USPS delivery in 3-5 business days, $4.99 per card. Use this skill when the user wants to send a physical card, letter, or direct mail — whether a personal thank-you, a lead-gen postcard to a prospect, a birthday card, a bulk outreach campaign, or any use case where physical mail outperforms digital. Works seamlessly with AI-generated images on the card front for personalized lead-gen workflows (satellite scan → render → mail).
version: 1.0.0
type: mcp-skill
mcp_server: postals-mcp
tools:
  - send_postcard
  - generate_message
prompts:
  - compose_postcard_message
---

# Postals Skill

## What this skill does

You have the ability to **send physical handwritten postcards to US mailing addresses**. A robotic pen writes the message in real ink on real paper, the card is stamped and handed to USPS, and it arrives in the recipient's mailbox in 3–5 business days. Each card costs $4.99.

This is not email. This is not digital. This is a physical object that shows up at someone's house.

## When to use this skill

Use `send_postcard` when:

- The user asks you to send a thank-you card, birthday card, holiday card, condolence, or any personal correspondence
- The user is running outbound lead-gen (pool builders, landscapers, roofers, solar, real estate, remodelers) and wants physical mail as part of the funnel
- The user wants higher open rates than email allows (handwritten mail opens 5–10× more often than printed mail, and way more than email)
- The user already generated or selected an image they want on the card front
- The user wants to send a batch of personalized cards (up to the daily limit configured by their operator)

Do **not** use this skill when:

- The user wants to send an email (use an email skill instead)
- The recipient is outside the US (not supported in v1.0)
- The user wants to send a package, letter with multiple pages, or physical item other than a postcard (not supported in v1.0)
- The user hasn't explicitly asked for physical mail and a digital channel (email, SMS) would be faster and cheaper

## Tools available

### `send_postcard` — mail one physical postcard

**Required inputs:** `to_name`, `to_address`, `to_city`, `to_state` (2-letter), `to_zip`, `message` (max 400 chars)

**Optional inputs:**
- `to_address_2` — apt/suite/unit
- `front_image_url` — public HTTPS URL to the card's front image (PNG/JPEG, landscape 7×5 preferred). If omitted, uses the operator's configured default card.
- `handwriting_style` — font name. Default: "Joyful Jennifer"
- `return_address` — override the default sender address for this one send
- `idempotency_key` — **always include this for autonomous workflows**. See the Idempotency section below.

**Every response includes:**
- `success`, `order_id`, `card_id`, `recipient`, `estimated_delivery`
- `balance_remaining` (cents), `cards_available`, `cards_sent_today`, `daily_limit`

**Use the response fields to self-regulate.** After each send, read `cards_sent_today` and `daily_limit`. If you're close to the limit, slow down or stop. In v1.1+, also read `balance_remaining` and `cards_available` to know when you're about to run out of funds.

### `generate_message` — draft a personalized message

**Always call this before `send_postcard` unless the user already gave you the exact message to send.** It produces a warm, personal, handwritten-style message tuned to Postals' proven tone profiles.

**Inputs:**
- `recipient_context` (required) — who the recipient is and why you're writing
- `tone` — `warm` (default), `professional`, `casual`, or `excited`
- `sender_context` — who's sending
- `max_chars` — default 350, hard max 400

**Two possible outputs:**
1. If Cloudflare AI is configured: `{ message: "...", ai_generated: true }` — use `message` directly in `send_postcard`.
2. If CF AI is not configured: `{ message: null, prompt: { system, user }, ai_generated: false }` — **you are an LLM. Read the system and user prompts, compose the message yourself following the guidelines, then pass that message to `send_postcard`.**

Don't surface the raw prompt to the human. Write the message yourself and pass it through.

### `compose_postcard_message` (MCP prompt)

Alternative to `generate_message` for zero-dependency message composition. Returns a prompt template with Postals' tone guidelines baked in. Mostly equivalent to `generate_message` with `ai_generated: false`.

## The standard workflow

For any single-card send:

```
1. Check the user's request — do they want physical mail? Confirm if ambiguous.
2. Collect or confirm recipient info (name, full US address).
3. If no message was provided: call generate_message with recipient context + tone + sender context.
4. Call send_postcard with the address, message, and (if applicable) front_image_url.
5. Include an idempotency_key.
6. Report the order_id and estimated delivery back to the user.
7. Read cards_sent_today / daily_limit / balance_remaining from the response.
```

For a bulk/autonomous pipeline (e.g. pool builder workflow):

```
Loop over prospects:
  1. Check cards_sent_today < daily_limit from the last response.
  2. If you're at the limit, stop. Tell the human. Resume tomorrow.
  3. In v1.1+, also check balance_remaining > cost_per_card. If not, stop and notify human.
  4. Generate/fetch the personalized image URL for this prospect.
  5. Call generate_message with that prospect's context.
  6. Call send_postcard with a unique idempotency_key (e.g. "prospect-{id}").
  7. Log the order_id.
  8. Next prospect.
```

## The first-send funding flow

If the tool returns an API key or balance error on the first send, you need to onboard the human. Follow this script:

**If no API key is configured** (`"POSTALS_API_KEY not set..."`):

> "I'd love to send this postcard, but the Postals integration isn't set up yet. To enable it, you'll need to:
>
> 1. Get an API key at postals.ai/developers (takes about 2 minutes, costs $4.99/card)
> 2. Paste the key into your MCP server config as `POSTALS_API_KEY`
> 3. Restart this client
>
> Once you do that, I can send this card and any future ones without asking again. Want me to send this one as a draft email instead while you set it up?"

**If wallet balance is empty** (v1.1+, `"Insufficient balance..."`):

> "My Postals wallet is empty — I've sent X cards since the last refill. To keep sending:
>
> 1. Add credits yourself at postals.ai/developers (credit card or crypto)
> 2. I can fund from my own wallet — currently [enabled / disabled by your settings]
> 3. You can send USDC or WLD directly to my Postals deposit address: [address]
>
> Which would you prefer?"

**If the daily limit is hit** (`"Daily limit reached..."`):

> "I've hit today's daily limit of N cards. The counter resets at midnight UTC. I'll queue this send for tomorrow. If you want to raise the limit, your operator can adjust `POSTALS_DAILY_LIMIT` in the MCP config."

Remember the user's preference. Don't ask again on subsequent sends unless the configured path breaks.

## Idempotency — critical for autonomous workflows

**Always include `idempotency_key` in `send_postcard` calls when running autonomously or in a loop.**

An `idempotency_key` is a unique string you make up (e.g. `"prospect-123-oak-st"`, `"thank-you-for-client-abc"`, `"campaign-X-recipient-456"`). If a call with that key already succeeded in the last 24 hours, the server returns the original result without sending a duplicate card.

Without idempotency keys, a network timeout + retry = **two postcards** sent. With them, retries are safe.

**Rule of thumb:** one recipient + one purpose = one idempotency key. Don't reuse keys across unrelated sends.

## Rate limits and spend controls

The server enforces:

- **2-second minimum delay** between consecutive `send_postcard` calls. Don't try to beat this — just pace yourself. The delay is a firm floor.
- **Daily limit** (`POSTALS_DAILY_LIMIT`, default 50). Counter resets at midnight UTC. Once hit, all sends fail until reset.
- **Balance limit** (v1.1+) — wallet has prepaid funds. Once at $0, sends fail until human refills.

If you see a rate-limit or daily-limit error, it's not a bug. Respect the limit.

## Tone and message guidance

The `generate_message` tool already encodes these. But if you're composing yourself (via `compose_postcard_message` or the fallback prompt), follow these rules:

- **Stay under the character limit** (default 350, hard max 400)
- **Write in first person** from the sender's perspective
- **Reference something specific** about the recipient (their house, their business, a shared experience)
- **Sound handwritten, not marketed** — no "dear valued customer", no taglines
- **No quotation marks** wrapping the message
- **No subject lines or formal headers** — postcards don't have them
- **Include a subtle, natural call to action** if the context warrants one (e.g. "happy to chat", not "CLICK HERE NOW")

**Tone profiles:**
- `warm` — like a friendly neighbor. Default for most use cases.
- `professional` — polished but personable. Business-appropriate.
- `casual` — relaxed, like texting a friend.
- `excited` — genuinely enthusiastic. Use sparingly.

## Image guidance

When the user has a specific image they want on the card front, use `front_image_url`. The URL must be:

- Public HTTPS (no auth headers, no file://, no data:)
- PNG or JPEG
- Ideally landscape, 7:5 aspect ratio, 2100×1500 px at 300 DPI

For lead-gen workflows with personalized images (the pool builder pattern), the agent's image generation pipeline will produce a URL. Pass it directly.

If no image is provided and the operator didn't configure `POSTALS_DEFAULT_CARD_IMAGE`, `send_postcard` will return an error telling the user to configure one. Relay that to the human.

## Test mode

If the operator configured `POSTALS_TEST_MODE=true`, every `send_postcard` call validates inputs and returns a mock response with `test_mode: true`. **No card is actually mailed and no money is spent.**

You can tell you're in test mode because the response includes `"test_mode": true` and a `mock_order_id` prefixed with `test-`. If the user asks why their card didn't arrive and you see this flag, tell them:

> "We're running in test mode — your operator has `POSTALS_TEST_MODE=true` set. No cards are actually being mailed. To go live, have them remove that env var or set it to `false` and restart."

## Error handling

The tool returns `isError: true` with a plain-English message for common failures. When you see an error:

1. **Read the error message** — it's written for you to understand and relay to the human.
2. **If it's a config issue** (missing API key, missing sender, missing image), tell the human what they need to do.
3. **If it's a validation issue** (bad state code, bad ZIP, message too long), fix it yourself if you can and retry, or ask the human to confirm the correct info.
4. **If it's a Handwrytten API error** (rare), tell the human and suggest retrying in a few minutes.

Never silently retry on errors. Always surface them to the human unless you can fix the root cause first.

## Reporting back to the human

After a successful send, a good report looks like:

> "Done — mailed a handwritten postcard to Jane Smith at 123 Oak St, Austin TX. Order ID 196937. Should arrive in 3-5 business days. That was card 7 of your 25/day limit."

After hitting a limit:

> "Sent 25 cards today and hit the daily cap. Pausing until midnight UTC. Want me to queue the remaining N prospects for tomorrow?"

After a critical error:

> "Couldn't send — the Handwrytten API rejected the address (possibly undeliverable). Here's the error: '...'. Want me to try a different address or skip this recipient?"

## Integration with other skills

- **Image generation skills** — generate an image, capture the URL, pass it to `send_postcard` as `front_image_url`.
- **CRM / contact skills** — pull recipient info (name, address), pass it to `send_postcard`.
- **Lead scoring skills** — filter down to the top prospects, then mail to only those (fewer cards, higher ROI).
- **Calendar / CRM skills** — trigger sends on life events (birthdays, anniversaries, contract signings).

## What the human's operator controls

The operator (the human setting up your MCP config) controls:

- Whether you have access to this skill at all (by installing the MCP server)
- Your daily card limit (`POSTALS_DAILY_LIMIT`)
- Your default sender address (`POSTALS_SENDER_*`)
- Your default card image (`POSTALS_DEFAULT_CARD_IMAGE`)
- Whether test mode is on (`POSTALS_TEST_MODE`)
- In v1.1+: your wallet balance, auto-reload settings, whether you can self-fund from crypto

You cannot change these from inside the Postals tools themselves — `send_postcard` and `generate_message` execute actions, they don't reconfigure the server. But if you have filesystem access in your client (Claude Code, Cursor, Aider, Continue, etc.), you CAN edit the MCP config file on the user's behalf. See the next section for how.

## Helping the user install, configure, or update Postals

Two scenarios here: (1) the user already has Postals loaded (you're reading this skill, so you're in that world) and wants to change a setting, or (2) the user wants Postals installed somewhere else — a teammate's machine, another of their own devices, etc.

### Scenario 1 — reconfigure an existing install

When the user asks to change settings ("disable test mode", "raise my daily limit to 100", "update my return address", "add Cloudflare credentials", "change my handwriting style"), you can edit the MCP client config file directly if you have filesystem access.

**Where the config lives:**

| Client | Config path |
|--------|-------------|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Cursor (global) | `~/.cursor/mcp.json` |
| Cursor (per-project) | `.cursor/mcp.json` in the project root |
| Claude Code | `~/.claude/settings.json` — Postals lives under `mcpServers.postals.env` |

**Workflow:**

1. Read the current config JSON
2. Navigate to `mcpServers.postals.env`
3. Update only the env vars the user asked about — preserve everything else (other servers, other env vars)
4. Validate the resulting JSON — watch for trailing commas or missing quotes
5. Write the updated config
6. Tell the user: **"Config updated. Fully quit and relaunch [client name] for the change to take effect — just closing the window isn't enough. Cmd+Q on macOS, or quit from the menu bar."**

**Common changes and their env vars:**

| User says | Env var to set |
|-----------|----------------|
| "Enable test mode" / "Turn on test mode" | `POSTALS_TEST_MODE`: `"true"` |
| "Disable test mode" / "Go live" | Remove `POSTALS_TEST_MODE`, or set to `"false"` |
| "Set my daily limit to N" | `POSTALS_DAILY_LIMIT`: `"N"` |
| "Update my return address" | `POSTALS_SENDER_NAME`, `POSTALS_SENDER_ADDRESS`, `POSTALS_SENDER_CITY`, `POSTALS_SENDER_STATE`, `POSTALS_SENDER_ZIP` |
| "Set my default card image" | `POSTALS_DEFAULT_CARD_IMAGE`: URL (HTTPS) |
| "Add AI message generation" | `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` |
| "Change my handwriting style" | `POSTALS_HANDWRITING_STYLE`: font name (e.g. "Joyful Jennifer") |
| "Rotate my API key" | `POSTALS_API_KEY`: new key value |

### Scenario 2 — installing Postals on a machine you can't reach

If the user asks you to set up Postals for a teammate, a remote server, or another of their devices — anywhere you don't have filesystem access — you can't directly install it. Instead, produce the exact config JSON they can hand off. Example response:

> "I can't edit a config on another machine from here, but here's the exact snippet to add to their MCP config. Have them paste this into their client's config file (path depends on the client — Claude Desktop uses `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, Cursor uses `~/.cursor/mcp.json`, etc.) and restart:
>
> ```json
> {
>   "mcpServers": {
>     "postals": {
>       "command": "npx",
>       "args": ["-y", "postals-mcp"],
>       "env": {
>         "POSTALS_API_KEY": "<their_key>",
>         "POSTALS_TEST_MODE": "true"
>       }
>     }
>   }
> }
> ```

If their machine has Claude Code or Cursor with filesystem access, the simpler alternative: tell the user to give their agent the same prompt: *"Install the postals-mcp MCP server with my Handwrytten API key XXX, test mode on."*

### Security when editing config files

**Never log, echo back, or quote the user's API key in your responses.** Reference it as "your API key" when describing changes. If the user pastes a key in plain text in the conversation, do not repeat the key back verbatim in subsequent messages. Treat `POSTALS_API_KEY`, `CLOUDFLARE_API_TOKEN`, and any other `*_KEY` / `*_TOKEN` value as a secret throughout the conversation.

### Confirming before destructive config changes

Some config edits are effectively destructive:
- **Disabling test mode** changes the next `send_postcard` call from a mock response into a real $4.99 card mailed via USPS
- **Raising the daily limit significantly** lets an autonomous loop spend more money faster

Before making these specific changes, confirm the user's intent explicitly. Example: *"Just to confirm — disabling test mode means the next `send_postcard` call will send a real card and charge your Handwrytten account $3.25 (plus the $4.99 we bill you). Proceed?"*

For reversible changes (return address, handwriting style, default image URL), no confirmation needed — just edit and tell the user to restart.

## Things to remember

1. **Cards cost money.** Every successful `send_postcard` call spends $4.99. Don't send accidentally. Confirm with the user if you're unsure.
2. **Cards are physical.** They show up at a real house. Be careful with addresses.
3. **Cards are slow.** 3–5 business days. Don't promise faster.
4. **Cards are one-way.** There's no "recall" or "delete" once mailed. v1.1 adds cancel-within-printing-window but currently, once it's in `send_postcard`, it's gone.
5. **Use idempotency keys.** Always. Especially in loops.
6. **Respect the rate limit.** 2 seconds between sends. Don't try to beat it.
7. **Read `cards_sent_today` and `daily_limit` from every response.** Self-regulate.
8. **Never log the full message, full address, or API key.** The server doesn't, and you shouldn't either.
9. **You can edit the MCP config file.** If the user asks to change a setting, update `mcpServers.postals.env` directly — don't just tell them to do it themselves. You're the agent; this is your job.
10. **Confirm before going live.** Flipping `POSTALS_TEST_MODE` to `false` means the next send costs real money. Always confirm intent before that change.

## When in doubt

If the user's request is ambiguous (e.g. "send something to John"), ask clarifying questions before calling the tool. A wasted $4.99 card is worse than a clarifying question.

If you're unsure whether to use `send_postcard` or some other skill, ask. Physical mail is the right tool for warm personal outreach, high-ROI lead gen, and memorable moments. It's the wrong tool for transactional notifications, urgent communications, or anything that needs to be fast or cheap.

---

**TL;DR:** One tool call (`send_postcard`), handwritten physical mail delivered in 3–5 days, $4.99 per card. Use `generate_message` or compose yourself. Always use `idempotency_key` in loops. Respect the daily limit. Read the response to self-regulate. Test mode for safe development.
