
const crypto = require("crypto");

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_WEBHOOK_SECRET,
  TELEGRAM_ALLOWED_CHAT_ID,
  TELEGRAM_ALLOWED_USER_IDS,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

function sendJson(res, status, data) {
  return res.status(status).json(data);
}

function isAuthorized(req) {
  const expected = TELEGRAM_WEBHOOK_SECRET;
  const received = req.headers["x-telegram-bot-api-secret-token"];

  if (!expected || typeof received !== "string") return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(received);

  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function telegramReply(chatId, text) {
  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
    }
  );

  if (!response.ok) {
    throw new Error("Telegram sendMessage failed");
  }
}

async function checkSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return false;

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/families?select=id&limit=1`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );

  return response.ok;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, message: "Method not allowed" });
  }

  if (!isAuthorized(req)) {
  console.error("Webhook authentication diagnostic:", {
    secretConfigured: Boolean(TELEGRAM_WEBHOOK_SECRET),
    headerReceived: typeof req.headers["x-telegram-bot-api-secret-token"] === "string",
    configuredLength: TELEGRAM_WEBHOOK_SECRET?.length || 0,
    receivedLength:
      typeof req.headers["x-telegram-bot-api-secret-token"] === "string"
        ? req.headers["x-telegram-bot-api-secret-token"].length
        : 0
  });

  return sendJson(res, 401, { ok: false, message: "Unauthorized" });
}
  }

  if (
    !TELEGRAM_BOT_TOKEN ||
    !TELEGRAM_ALLOWED_CHAT_ID ||
    !TELEGRAM_ALLOWED_USER_IDS
  ) {
    return sendJson(res, 503, { ok: false, message: "Configuration incomplete" });
  }

  try {
    const update = req.body || {};
    const message = update.message;

    // Abaikan update selain pesan biasa.
    if (!message || !message.chat || !message.from) {
      return sendJson(res, 200, { ok: true });
    }

    // Batasi hanya grup keluarga.
    if (String(message.chat.id) !== String(TELEGRAM_ALLOWED_CHAT_ID)) {
      return sendJson(res, 200, { ok: true });
    }

    // Batasi hanya anggota keluarga yang diizinkan.
    const allowedUsers = TELEGRAM_ALLOWED_USER_IDS
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    if (!allowedUsers.includes(String(message.from.id))) {
      return sendJson(res, 200, { ok: true });
    }

    const text = (message.text || "").trim();
    const chatId = message.chat.id;

    if (/^\/start(?:@\w+)?(?:\s|$)/i.test(text)) {
      await telegramReply(
        chatId,
        "Halo! 👋 Bot Keuangan Keluarga sudah aktif.\n\n" +
          "Perintah yang tersedia:\n" +
          "/start - Memulai bot\n" +
          "/ping - Memeriksa bot\n" +
          "/status - Memeriksa koneksi database\n\n" +
          "Pencatatan transaksi akan kita aktifkan pada tahap berikutnya."
      );
    } else if (/^\/ping(?:@\w+)?(?:\s|$)/i.test(text)) {
      await telegramReply(chatId, "Pong! 🟢 Bot berjalan dengan baik.");
    } else if (/^\/status(?:@\w+)?(?:\s|$)/i.test(text)) {
      const connected = await checkSupabase();
      await telegramReply(
        chatId,
        connected
          ? "🟢 Bot aktif\n🟢 Koneksi Supabase berhasil"
          : "🟢 Bot aktif\n🔴 Koneksi Supabase belum berhasil"
      );
    } else if (text) {
      await telegramReply(
        chatId,
        "Pesan diterima. 😊\nFitur pencatatan transaksi sedang kita siapkan."
      );
    }

    return sendJson(res, 200, { ok: true });
  } catch (error) {
    // Jangan mencatat token, secret, atau isi kredensial ke log.
    console.error("Webhook processing error:", error.message);
    return sendJson(res, 200, { ok: true });
  }
};
