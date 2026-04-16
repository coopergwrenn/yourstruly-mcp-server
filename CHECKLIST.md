# Phase 1 Build Checklist — Postals (postals-mcp)

Internal build tracking for the Postals v1.0 MCP server.

## Key Decisions (from PRD)
- Pricing: $4.99/card (agent skill), $3.50/card (B2B bulk — separate)
- Font default: "Joyful Jennifer" (`HW_FONT_LABEL`)
- Card dimension: landscape 7"x5" (`dimension_id: 1`)
- Country: US only (`country_id: 1`)
- Transport: stdio
- Language: TypeScript
- License: MIT
- Package: unscoped `postals-mcp`


## Development Steps

- [x] 1. Package setup (package.json, tsconfig.json, directory) ✅ npm install OK
- [x] 2. `send_postcard` tool — HW API: upload → create card → singleStepOrder ✅
- [x] 3. Input validation — state codes (real US states), ZIP (5 or 5+4), message (max 400), image URL (HTTPS) ✅
- [x] 4. Idempotency — in-memory key→result map, 24h TTL ✅
- [x] 5. Rate limiting — 2s min delay between consecutive send_postcard calls ✅
- [x] 6. `generate_message` tool — embedded tone prompts + optional CF AI ✅
- [x] 7. `compose_postcard_message` prompt — MCP prompt primitive ✅
- [x] 8. Test mode — POSTALS_TEST_MODE=true, mock responses, no HW API calls ✅
- [x] 9. Spend controls — daily limit counter, POSTALS_DAILY_LIMIT env var (default 50) ✅
- [x] 10. Error handling — actionable isError messages with how-to-fix ✅
- [x] 11. Stderr logging — structured events, never PII or keys ✅
- [x] 12. Build & test — tsc compiles cleanly (build/index.js generated) ✅
- [x] 13. README + SKILL.md (dev-facing + agent-facing) ✅
- [ ] 14. npm publish
- [ ] 15. Submit to registries (MCP Registry, OpenClaw, PulseMCP, Awesome MCP Servers)
- [ ] 16. Host default card image on CDN

## send_postcard Input Schema
```
to_name            string   REQUIRED
to_address         string   REQUIRED
to_address_2       string   optional
to_city            string   REQUIRED
to_state           string   REQUIRED  2-letter US state (validated)
to_zip             string   REQUIRED  5-digit or 5+4 (validated)
message            string   REQUIRED  max 400 chars
front_image_url    string   optional  HTTPS URL, PNG/JPEG
handwriting_style  string   optional  default "Joyful Jennifer"
return_address     object   optional  {name, address, city, state, zip}
idempotency_key    string   optional  dedup key, 24h TTL
```

## send_postcard Output Schema
```
success            boolean
order_id           number
card_id            number
recipient          string
estimated_delivery string   "3-5 business days via USPS"
balance_remaining  number   cents (Phase 1: -1 = not tracked)
cards_available    number   (Phase 1: -1 = not tracked)
cards_sent_today   number
daily_limit        number
```

## generate_message Input Schema
```
recipient_context  string   REQUIRED
tone               enum     optional  "warm"|"professional"|"casual"|"excited" default:"warm"
max_chars          number   optional  default:350, max:400
sender_context     string   optional
```

## Env Vars
```
POSTALS_API_KEY     REQUIRED  Your Postals API key from postals.ai/developers
POSTALS_SENDER_NAME         optional  Default sender name
POSTALS_SENDER_ADDRESS      optional  Default sender street
POSTALS_SENDER_CITY         optional  Default sender city
POSTALS_SENDER_STATE        optional  Default sender state
POSTALS_SENDER_ZIP          optional  Default sender zip
POSTALS_HANDWRITING_STYLE   optional  Default font (default: "Joyful Jennifer")
POSTALS_DAILY_LIMIT         optional  Daily card limit (default: 50)
POSTALS_DEFAULT_CARD_IMAGE  optional  Default card front image URL
POSTALS_TEST_MODE           optional  "true" = no real sends
CLOUDFLARE_ACCOUNT_ID  optional  For AI message generation
CLOUDFLARE_API_TOKEN   optional  For AI message generation
```

## Server Instructions
```
"Send physical handwritten postcards to US addresses via Postals.
 Typical workflow: generate_message → send_postcard.
 Each card costs $4.99 and arrives in 3-5 business days via USPS.
 Keep messages under 400 characters. front_image_url must be publicly accessible.
 If you have a rendered image (AI-generated, photo, etc.), pass its URL as front_image_url."
```

## Valid US State Codes
AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC AS GU MH FM MP PW PR VI

## Exit Criteria
- [ ] Developer can `npx -y postals-mcp` in Claude Desktop and send a real postcard in <5 min
- [ ] Test mode works without any API keys
- [ ] Daily limit prevents runaway sends
- [ ] generate_message returns usable messages with CF AI, and usable prompts without
- [ ] Invalid state codes and ZIP formats rejected before HW API call
- [ ] Duplicate sends prevented with idempotency_key
- [ ] Back-to-back sends throttled to 2s minimum
- [ ] Listed on OpenClaw skill catalog
