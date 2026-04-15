#!/usr/bin/env node
/**
 * Postals v1.0.0
 *
 * Agent skill that turns any AI into a direct mail machine. One MCP tool call
 * mails a physical handwritten postcard via USPS.
 *
 * https://postals.ai · https://github.com/coopergwrenn/postals-mcp
 * Built by YoursTruly AI. Fulfillment by Handwrytten.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ─── Configuration ────────────────────────────────────
const HW_API = "https://api.handwrytten.com/v2";
const API_KEY = process.env.POSTALS_API_KEY;
const DEFAULT_FONT = process.env.POSTALS_HANDWRITING_STYLE || "Joyful Jennifer";
const DAILY_LIMIT = parseInt(process.env.POSTALS_DAILY_LIMIT || "50", 10);
const DEFAULT_IMAGE = process.env.POSTALS_DEFAULT_CARD_IMAGE;
const TEST_MODE = process.env.POSTALS_TEST_MODE === "true";
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

const SENDER_DEFAULT = {
  name: process.env.POSTALS_SENDER_NAME || "",
  address: process.env.POSTALS_SENDER_ADDRESS || "",
  city: process.env.POSTALS_SENDER_CITY || "",
  state: process.env.POSTALS_SENDER_STATE || "",
  zip: process.env.POSTALS_SENDER_ZIP || "",
};

// ─── Validation ───────────────────────────────────────
const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC", "AS", "GU", "MH", "FM", "MP", "PW", "PR", "VI",
]);

const ZIP_RE = /^\d{5}(-\d{4})?$/;

function validateAddress(state: string, zip: string): string | null {
  const st = state.toUpperCase();
  if (!US_STATES.has(st)) return `Invalid state code "${state}". Must be a 2-letter US state (e.g. CA, NY, TX).`;
  if (!ZIP_RE.test(zip)) return `Invalid ZIP "${zip}". Must be 5 digits (e.g. 78701) or 5+4 (e.g. 78701-1234).`;
  return null;
}

// ─── Spend Tracking ───────────────────────────────────
let usageDay = new Date().toISOString().slice(0, 10);
let cardsSent = 0;

function enforceLimit(): string | null {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== usageDay) { usageDay = today; cardsSent = 0; }
  if (cardsSent >= DAILY_LIMIT) {
    return `Daily limit reached (${cardsSent}/${DAILY_LIMIT}). Resets at midnight UTC. Adjust with POSTALS_DAILY_LIMIT env var.`;
  }
  return null;
}

// ─── Rate Limiting (2s min between sends) ─────────────
let lastSendTime = 0;

async function enforceRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastSendTime;
  if (lastSendTime > 0 && elapsed < 2000) {
    await new Promise((r) => setTimeout(r, 2000 - elapsed));
  }
  lastSendTime = Date.now();
}

// ─── Idempotency (in-memory, 24h TTL) ────────────────
const idempotencyCache = new Map<string, { result: any; expires: number }>();
const IDEMPOTENCY_TTL = 24 * 60 * 60 * 1000; // 24 hours

function checkIdempotency(key: string | undefined): any | null {
  if (!key) return null;
  const entry = idempotencyCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { idempotencyCache.delete(key); return null; }
  return entry.result;
}

function storeIdempotency(key: string | undefined, result: any): void {
  if (!key) return;
  idempotencyCache.set(key, { result, expires: Date.now() + IDEMPOTENCY_TTL });
  // Prune expired entries periodically (every 100 stores)
  if (idempotencyCache.size % 100 === 0) {
    const now = Date.now();
    for (const [k, v] of idempotencyCache) {
      if (now > v.expires) idempotencyCache.delete(k);
    }
  }
}

// ─── Handwrytten API Helpers ──────────────────────────
function log(level: string, event: string, data?: Record<string, any>): void {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level, event, ...data }));
}

function errResponse(msg: string) {
  return { content: [{ type: "text" as const, text: msg }], isError: true as const };
}

function okResponse(data: Record<string, any>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

async function hw(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${HW_API}${path}`, {
    ...init,
    headers: { Authorization: API_KEY!, ...(init?.headers || {}) },
  });
  const data = await res.json();
  if (data.httpCode && data.httpCode >= 400) {
    throw new Error(data.error || data.status || `Handwrytten API error (HTTP ${data.httpCode})`);
  }
  return data;
}

async function createCard(imageUrl: string, label: string): Promise<number> {
  const img = await fetch(imageUrl);
  if (!img.ok) throw new Error(`Cannot fetch image from URL (HTTP ${img.status}). Ensure the URL is publicly accessible.`);
  const blob = await img.blob();
  const isJpeg = (img.headers.get("content-type") || "").includes("jpeg");
  const ext = isJpeg ? "jpeg" : "png";

  const form = new FormData();
  form.append("file", new Blob([blob], { type: `image/${ext}` }), `card.${ext}`);
  form.append("type", "cover");
  const upload = await hw("/cards/uploadCustomLogo", { method: "POST", body: form });
  const imageId = upload.image_id || upload.id;
  if (!imageId) throw new Error("Image upload returned no image ID");

  const card = await hw("/cards/createCustomCard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: label, dimension_id: 1, cover_id: imageId }),
  });
  if (!card.card_id) throw new Error("Card creation returned no card ID");
  return card.card_id;
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  return { first: parts[0] || "", last: parts.slice(1).join(" ") || "" };
}

// ─── Server ───────────────────────────────────────────
const server = new McpServer(
  { name: "postals", version: "1.0.0" },
  {
    instructions:
      "Send physical handwritten postcards to US addresses via Postals. " +
      "Typical workflow: generate_message -> send_postcard. " +
      "Each card costs $4.99 and arrives in 3-5 business days via USPS. " +
      "Keep messages under 400 characters. front_image_url must be publicly accessible. " +
      "If you have a rendered image (AI-generated, photo, etc.), pass its URL as front_image_url.",
  }
);

// ─── Tool: send_postcard ──────────────────────────────
server.registerTool(
  "send_postcard",
  {
    description:
      "Send a physical handwritten postcard to a US mailing address. " +
      "Postals prints it with real robotic handwriting (pen and ink) and mails it via USPS. " +
      "Delivery in 3-5 business days. Cost: $4.99 per card. " +
      "Provide the recipient's address, a message (max 400 chars), and optionally an image URL for the card front. " +
      "If no image is provided, uses the configured default card.",
    inputSchema: {
      to_name: z.string().describe("Recipient's full name (e.g. 'Jane Smith')"),
      to_address: z.string().describe("Street address line 1"),
      to_address_2: z.string().optional().describe("Street address line 2 (apt, suite, etc.)"),
      to_city: z.string().describe("City"),
      to_state: z.string().length(2).describe("Two-letter US state code (e.g. CA, NY, TX)"),
      to_zip: z.string().describe("5-digit ZIP code (e.g. 78701 or 78701-1234)"),
      message: z.string().max(400).describe(
        "The handwritten message for the back of the card. Max 400 characters. Keep it personal and concise."
      ),
      front_image_url: z.string().url().optional().describe(
        "Public HTTPS URL of the image for the card front (PNG or JPEG, landscape 7x5 preferred). If omitted, uses POSTALS_DEFAULT_CARD_IMAGE."
      ),
      handwriting_style: z.string().optional().describe(
        'Handwriting font name. Default: "Joyful Jennifer". Other options depend on your Handwrytten account.'
      ),
      return_address: z.object({
        name: z.string().describe("Sender full name"),
        address: z.string().describe("Sender street address"),
        city: z.string().describe("Sender city"),
        state: z.string().length(2).describe("Sender 2-letter state code"),
        zip: z.string().describe("Sender ZIP code"),
      }).optional().describe("Sender's return address. If omitted, uses POSTALS_SENDER_* env defaults."),
      idempotency_key: z.string().optional().describe(
        "Unique key to prevent duplicate sends on retries. If a prior send with this key succeeded, returns the original result without sending a new card. Recommended for autonomous agents."
      ),
    },
    annotations: {
      title: "Send Postcard",
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (params) => {
    // ── Idempotency check ──
    const cached = checkIdempotency(params.idempotency_key);
    if (cached) {
      log("info", "send_postcard_idempotent_hit", { key: params.idempotency_key });
      return cached;
    }

    // ── Pre-flight: API key ──
    if (!API_KEY) {
      return errResponse(
        "POSTALS_API_KEY not set. Add it to your MCP server env config. " +
        "Get a key at postals.ai/developers or use a Handwrytten API key for Phase 1."
      );
    }

    // ── Pre-flight: input validation ──
    const addrErr = validateAddress(params.to_state, params.to_zip);
    if (addrErr) return errResponse(addrErr);

    // ── Pre-flight: image ──
    const imageUrl = params.front_image_url || DEFAULT_IMAGE;
    if (!imageUrl) {
      return errResponse("No card image. Provide front_image_url or set POSTALS_DEFAULT_CARD_IMAGE env var.");
    }
    if (params.front_image_url && !params.front_image_url.startsWith("https://")) {
      return errResponse("front_image_url must be an HTTPS URL.");
    }

    // ── Pre-flight: return address ──
    const sender = params.return_address || SENDER_DEFAULT;
    const senderName = sender.name || SENDER_DEFAULT.name;
    if (!senderName) {
      return errResponse("No return address. Provide return_address or set POSTALS_SENDER_* env vars.");
    }

    // ── Pre-flight: daily limit ──
    const limitErr = enforceLimit();
    if (limitErr) return errResponse(limitErr);

    // ── Rate limit: 2s between sends ──
    await enforceRateLimit();

    // Increment counter now (decrement on failure)
    cardsSent++;
    log("info", "send_postcard_start", { recipient_city: params.to_city, recipient_state: params.to_state });

    // ── Test mode ──
    if (TEST_MODE) {
      const result = okResponse({
        success: true,
        test_mode: true,
        message: "Test mode — no card sent. Set POSTALS_TEST_MODE=false to send real cards.",
        mock_order_id: `test-${Date.now()}`,
        recipient: params.to_name,
        estimated_delivery: "3-5 business days via USPS",
        balance_remaining: -1,
        cards_available: -1,
        cards_sent_today: cardsSent,
        daily_limit: DAILY_LIMIT,
      });
      storeIdempotency(params.idempotency_key, result);
      log("info", "send_postcard_test", { cards_sent_today: cardsSent });
      return result;
    }

    // ── Real send ──
    try {
      const cardId = await createCard(imageUrl, `YT-MCP-${Date.now()}`);
      const to = splitName(params.to_name);
      const from = splitName(senderName);

      const order = await hw("/orders/singleStepOrder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          card_id: cardId,
          message: params.message,
          font_label: params.handwriting_style || DEFAULT_FONT,
          recipient_first_name: to.first,
          recipient_last_name: to.last,
          recipient_address1: params.to_address,
          recipient_address2: params.to_address_2 || "",
          recipient_city: params.to_city,
          recipient_state: params.to_state.toUpperCase(),
          recipient_zip: params.to_zip,
          recipient_country_id: 1,
          sender_first_name: from.first,
          sender_last_name: from.last,
          sender_address1: sender.address || SENDER_DEFAULT.address,
          sender_city: sender.city || SENDER_DEFAULT.city,
          sender_state: (sender.state || SENDER_DEFAULT.state).toUpperCase(),
          sender_zip: sender.zip || SENDER_DEFAULT.zip,
          sender_country_id: 1,
        }),
      });

      const result = okResponse({
        success: true,
        order_id: order.order_id,
        card_id: cardId,
        recipient: params.to_name,
        estimated_delivery: "3-5 business days via USPS",
        balance_remaining: -1,
        cards_available: -1,
        cards_sent_today: cardsSent,
        daily_limit: DAILY_LIMIT,
      });
      storeIdempotency(params.idempotency_key, result);
      log("info", "send_postcard_success", { order_id: order.order_id, cards_sent_today: cardsSent });
      return result;

    } catch (e: any) {
      cardsSent = Math.max(0, cardsSent - 1);
      log("error", "send_postcard_failed", { error: e.message });
      return errResponse(`Send failed: ${e.message}`);
    }
  }
);

// ─── Tool: generate_message ───────────────────────────
const TONE_GUIDES: Record<string, string> = {
  warm: "Write like a friendly neighbor — genuine, kind, personal.",
  professional: "Polished but personable. Business-appropriate, not stiff.",
  casual: "Relaxed and conversational, like a quick note to a friend.",
  excited: "Genuinely enthusiastic and energetic. Show real excitement.",
};

server.registerTool(
  "generate_message",
  {
    description:
      "Generate a personalized handwritten message for a postcard based on context about the recipient. " +
      "Returns a ready-to-use message you can pass directly to send_postcard. " +
      "Uses AI if Cloudflare credentials are configured (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN); " +
      "otherwise returns a structured prompt you can use to compose the message yourself.",
    inputSchema: {
      recipient_context: z.string().describe(
        "Who the recipient is and why you're writing. Example: 'John Smith, homeowner at 123 Oak St. Sending a before/after postcard showing what a pool would look like in his backyard.'"
      ),
      tone: z.enum(["warm", "professional", "casual", "excited"]).default("warm").describe("Message tone"),
      max_chars: z.number().max(400).default(350).describe("Max character count for the message"),
      sender_context: z.string().optional().describe(
        "Who is sending the card. Example: 'Blue Wave Pools — local pool builder in Austin, TX'"
      ),
    },
  },
  async (params) => {
    log("info", "generate_message_start", { tone: params.tone, ai_available: !!(CF_ACCOUNT && CF_TOKEN) });

    const system = [
      "You write short, personal messages for physical handwritten postcards.",
      "Rules:",
      `- Stay under ${params.max_chars} characters.`,
      `- Tone: ${TONE_GUIDES[params.tone] || TONE_GUIDES.warm}`,
      "- No quotation marks wrapping the message.",
      "- No subject lines, headers, or sign-off formalities.",
      "- Write in first person from the sender's perspective.",
      "- Sound handwritten and personal, never like marketing copy.",
      "- Reference something specific about the recipient.",
      "- Include a subtle, natural call to action when appropriate.",
    ].join("\n");

    const user = [
      `Recipient: ${params.recipient_context}`,
      params.sender_context ? `Sender: ${params.sender_context}` : "",
      "",
      "Write the postcard message now.",
    ].filter(Boolean).join("\n");

    // Try Cloudflare AI if configured
    if (CF_ACCOUNT && CF_TOKEN) {
      try {
        const res = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/run/@cf/meta/llama-3.1-8b-instruct-fast`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${CF_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              max_tokens: 150,
              messages: [
                { role: "system", content: system },
                { role: "user", content: user },
              ],
            }),
          }
        );
        const data = (await res.json()) as any;
        const msg = (data.result?.response || "").replace(/^["']|["']$/g, "").trim();
        if (msg) {
          log("info", "generate_message_success", { char_count: msg.length, ai: true });
          return okResponse({ message: msg, char_count: msg.length, tone: params.tone, ai_generated: true });
        }
      } catch {
        // Fall through to prompt-based approach
      }
    }

    // Fallback: return prompt for agent to self-generate
    log("info", "generate_message_fallback", { ai: false });
    return okResponse({
      message: null,
      ai_generated: false,
      prompt: { system, user },
      instructions:
        "Cloudflare AI not configured. Use the system/user prompts above to generate the message, " +
        "then pass it to send_postcard. Or set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN for server-side generation.",
      tone: params.tone,
      max_chars: params.max_chars,
    });
  }
);

// ─── Prompt: compose_postcard_message ─────────────────
server.prompt(
  "compose_postcard_message",
  {
    recipient: z.string().describe("Who the recipient is and context for the message"),
    sender: z.string().optional().describe("Who is sending the card"),
    tone: z.enum(["warm", "professional", "casual", "excited"]).default("warm").describe("Message tone"),
  },
  (params) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            "Write a short handwritten postcard message (under 350 characters).",
            `Tone: ${TONE_GUIDES[params.tone] || TONE_GUIDES.warm}`,
            `Recipient: ${params.recipient}`,
            params.sender ? `Sender: ${params.sender}` : "",
            "",
            "Rules: No quotation marks. No headers. First person. Sound personal, not like marketing.",
            "Reference something specific about the recipient. Include a natural call to action.",
          ].filter(Boolean).join("\n"),
        },
      },
    ],
  })
);

// ─── Start ────────────────────────────────────────────
log("info", "server_start", { version: "1.0.0", test_mode: TEST_MODE, daily_limit: DAILY_LIMIT });
const transport = new StdioServerTransport();
server.connect(transport).catch((e) => {
  log("error", "server_fatal", { error: String(e) });
  process.exit(1);
});
