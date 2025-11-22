import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import axios from "axios";
import fs from "fs";
import pino from "pino";
// qrcode-terminal removed because we won't print QR in terminal

console.log("🚀 Starting BYD WhatsApp Agent...");

// -------------------------------------------------------------
// CONFIG: Put your n8n webhook URL here
// -------------------------------------------------------------
const N8N_WEBHOOK_URL =
  "https://n8n.modulo.click/webhook/4e4ce2c6-c8ef-487f-afcc-719dac1ea67f";
// Example:
// const N8N_WEBHOOK_URL = "https://n8n.modulo.click/webhook/whatsapp-leads";

// -------------------------------------------------------------
// ENSURE AUTH FOLDER EXISTS
// -------------------------------------------------------------
if (!fs.existsSync("./auth")) {
  console.log("⚠️ No auth folder found. Creating './auth'...");
  fs.mkdirSync("./auth", { recursive: true });
}

// -------------------------------------------------------------
// GLOBAL CRASH HANDLERS
// -------------------------------------------------------------
process.on("uncaughtException", (err) => {
  console.error("🔥 UNCAUGHT EXCEPTION:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("🔥 UNHANDLED PROMISE REJECTION:", err);
});

// -------------------------------------------------------------
// MAIN START FUNCTION
// -------------------------------------------------------------
async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "info" }),
  });

  // -------------------------
  // Connection updates
  // -------------------------
  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      // Instead of printing QR in terminal, log a URL you can open in a browser
      const qrImageUrl =
        "https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=" +
        encodeURIComponent(qr);

      console.log("🔗 New WhatsApp pairing QR generated.");
      console.log("➡ Open this URL in a browser and scan the QR with your phone:");
      console.log(qrImageUrl);
    }

    if (connection === "open") {
      console.log("✅ WhatsApp connection is open.");
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("❌ Connection closed. Reason:", reason);
      if (reason !== DisconnectReason.loggedOut) {
        console.log("♻️ Reconnecting...");
        start();
      } else {
        console.log("🔒 Logged out. Delete ./auth to re-pair.");
      }
    }
  });

  // Save credentials when updated
  sock.ev.on("creds.update", saveCreds);

  // -------------------------
  // Main logic: listen for messages
  // -------------------------
  sock.ev.on("messages.upsert", async ({ messages }) => {
    if (!messages || !messages.length) return;

    for (const msg of messages) {
      try {
        // Ignore if no message content
        if (!msg.message) continue;

        // Ignore messages we sent ourselves
        if (msg.key.fromMe) continue;

        // Extract text body (several possible places)
        const body =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          "";

        const normalizedBody = body.trim().toLowerCase();
        const template = "halo, saya tertarik";

        // Only handle messages that start with the template text
        if (!normalizedBody.startsWith(template)) {
          continue;
        }

        // Extract number and name
        const jid = msg.key.remoteJid || "";
        const number = jid.includes("@") ? jid.split("@")[0] : jid;
        const name = msg.pushName || "";

        const payload = {
          name,
          number,
          message: body,
          timestamp: new Date().toISOString(),
        };

        console.log("📩 New lead captured:", payload);

        if (!N8N_WEBHOOK_URL) {
          console.warn("N8N_WEBHOOK_URL is empty. Skipping POST to n8n.");
          continue;
        }

        await axios.post(N8N_WEBHOOK_URL, payload, {
          timeout: 5000,
        });

        console.log("✅ Lead sent to n8n successfully.");
      } catch (err) {
        console.error("Error handling incoming message:", err);
      }
    }
  });
}

// -------------------------------------------------------------
// START BOT
// -------------------------------------------------------------
start().catch((err) => {
  console.error("Fatal error:", err);
});
