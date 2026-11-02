
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
  res.status(status).json(data);
}

function isAuthorized(req) {
  const received = req.headers["x-telegram-bot-api-secret-token"];

  if (!received || !TELEGRAM_WEBHOOK_SECRET) return false;

  const a = Buffer.from(String(received));
  const b = Buffer.from(String(TELEGRAM_WEBHOOK_SECRET));

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
    throw new Error("Telegram reply failed");
  }
}

async function supabaseRequest(table, query = "", options = {}) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ""}`,
    {
      method: options.method || "GET",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: options.prefer || "return=representation",
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    }
  );

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data?.message || "Database request failed";
    throw new Error(message);
  }

  return data;
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseAmount(text) {
  const match = text.match(
    /(\d[\d.,]*\s*(?:rb|ribu|jt|juta|miliar)?)\b/i
  );

  if (!match) return null;

  let raw = match[1].toLowerCase().replace(/\s/g, "");
  let multiplier = 1;

  if (raw.endsWith("miliar")) {
    multiplier = 1000000000;
    raw = raw.replace("miliar", "");
  } else if (raw.endsWith("juta")) {
    multiplier = 1000000;
    raw = raw.replace("juta", "");
  } else if (raw.endsWith("jt")) {
    multiplier = 1000000;
    raw = raw.replace("jt", "");
  } else if (raw.endsWith("ribu")) {
    multiplier = 1000;
    raw = raw.replace("ribu", "");
  } else if (raw.endsWith("rb")) {
    multiplier = 1000;
    raw = raw.replace("rb", "");
  }

  let number;

  if (multiplier !== 1) {
    const normalized = raw.replace(/\./g, "").replace(",", ".");
    number = Number(normalized) * multiplier;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
    number = Number(raw.replace(/\./g, ""));
  } else if (/^\d{1,3}(,\d{3})+$/.test(raw)) {
    number = Number(raw.replace(/,/g, ""));
  } else {
    number = Number(raw.replace(",", "."));
  }

  return Number.isFinite(number) && number > 0
    ? Math.round(number)
    : null;
}

function detectCategory(text, type) {
  const t = text.toLowerCase();

  if (type === "income") {
    if (/gaji|salary/.test(t)) return "Gaji";
    if (/usaha|jualan|freelance|bisnis/.test(t))
      return "Usaha / Penghasilan Sampingan";
    if (/bonus|thr/.test(t)) return "Bonus / THR";
    if (/dividen|bunga|kupon|capital gain/.test(t))
      return "Pendapatan Investasi";
    return "Pemasukan Lainnya";
  }

  if (type === "transfer") {
    if (/emas|reksa dana|reksadana|obligasi|saham|investasi/.test(t))
      return "Pembelian Investasi";
    if (/tarik.*investasi|cair.*investasi/.test(t))
      return "Penarikan Investasi";
    if (/tabung|tabungan|dana darurat/.test(t))
      return "Alokasi Tabungan";
    return "Transfer Antar-Rekening";
  }

  if (/bensin|bbm|transport|parkir|ojek|bensin/.test(t))
    return "Transportasi dan BBM";
  if (/makan|minum|kopi|jajan|sarapan|makan siang/.test(t))
    return "Makan dan Minum";
  if (/sembako|belanja rumah|sabun|deterjen/.test(t))
    return "Belanja Rumah Tangga";
  if (/popok|diaper|susu bayi|kebutuhan bayi/.test(t))
    return "Kebutuhan Bayi";
  if (/obat|dokter|rumah sakit|klinik/.test(t))
    return "Kesehatan";
  if (/kost|kontrakan|sewa rumah/.test(t))
    return "Tempat Tinggal";
  if (/wifi|internet|listrik|air|pulsa|tagihan/.test(t))
    return "Tagihan dan Internet";
  if (/utang|hutang|cicilan|angsuran/.test(t))
    return "Cicilan dan Utang";
  if (/sekolah|kursus|buku|pendidikan/.test(t))
    return "Pendidikan";
  if (/game|hiburan|nonton|rekreasi/.test(t))
    return "Hiburan";
  if (/sedekah|zakat|infak|infaq|donasi/.test(t))
    return "Sosial dan Sedekah";
  if (/servis motor|servis mobil|oli|ban|sparepart/.test(t))
    return "Perawatan Kendaraan";

  return "Pengeluaran Lainnya";
}

function detectType(text) {
  const t = text.toLowerCase();

  // Transfer dan alokasi tabungan/investasi
  if (
    /transfer|tabung|alokasi tabungan|beli emas|beli saham|beli obligasi|beli reksa dana|investasi/.test(t)
  ) {
    return "transfer";
  }

  // Pemasukan
  if (
    /gaji|pemasukan|pendapatan|terima uang|dapat uang|bonus|thr/.test(t)
  ) {
    return "income";
  }

  // Pengeluaran
  if (
    /beli|bayar|pengeluaran|jajan|makan|isi bensin|servis/.test(t)
  ) {
    return "expense";
  }

  return null;
}

function findAccount(text, accounts, position) {
  const t = normalize(text);

  const aliases = {
    bri: ["bri"],
    bni: ["bni"],
    jago: ["jago", "bankjago"],
    bsi: ["bsi"],
    kas: ["kas", "tunai", "cash"],
    shopeepay: ["shopeepay"],
    isaku: ["isaku"],
    ovo: ["ovo"],
    gopay: ["gopay"],
    dana: ["dana"],
    pluangemas: ["pluang", "emas"],
    bibitreksadana: ["bibit", "reksadana"],
    bibitobligasi: ["bibit", "obligasi"],
    bibitsaham: ["bibit", "saham"],
    tabungankeluarga: ["tabungankeluarga"],
    tabunganlebaran: ["tabunganlebaran", "lebaran"],
    danadarurat: ["danadarurat"],
  };

  let segment = t;

  if (position === "source") {
    const fromIndex = t.lastIndexOf("dari");
    const toIndex = t.lastIndexOf("ke");

    if (fromIndex >= 0) {
      segment = t.slice(
        fromIndex + 4,
        toIndex > fromIndex ? toIndex : undefined
      );
    }
  }

  if (position === "destination") {
    const toIndex = t.lastIndexOf("ke");

    if (toIndex >= 0) {
      segment = t.slice(toIndex + 2);
    }
  }

  const candidates = accounts.filter((account) => {
    const name = normalize(account.name);

    if (segment.includes(name)) return true;

    const key = Object.keys(aliases).find(
      (k) => normalize(account.name) === k
    );

    if (!key) return false;

    return aliases[key].some((alias) =>
      segment.includes(normalize(alias))
    );
  });

  return candidates.sort(
    (a, b) => normalize(b.name).length - normalize(a.name).length
  )[0] || null;
}
function formatRupiah(amount) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function cleanDescription(text) {
  const accountNames = [
    "Tabungan Keluarga",
    "Tabungan Lebaran",
    "Dana Darurat",
    "Pluang - Emas",
    "Bibit - Reksa Dana",
    "Bibit - Obligasi",
    "Bibit - Saham",
    "ShopeePay",
    "Kas",
    "BRI",
    "BNI",
    "Jago",
    "BSI",
    "iSaku",
    "OVO",
    "GoPay",
    "DANA"
  ];

  let result = text;

  // Hapus nama rekening
  for (const account of accountNames) {
    result = result.replace(
      new RegExp(`\\b${account.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"),
      ""
    );
  }

  return result
    .replace(/(\d[\d.,]*\s*(?:rb|ribu|jt|juta|miliar)?)/i, "")
    .replace(/\b(dari|ke|masuk|sebesar)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function handleMessage(message, updateId) {
  const chatId = message.chat.id;
  const userId = String(message.from.id);
  const text = String(message.text || "").trim();
  const command = text.trim().split(/\s+/)[0].split("@")[0].toLowerCase();

  const allowedUsers = (TELEGRAM_ALLOWED_USER_IDS || "")
    .split(",")
    .map((id) => id.trim());

  if (String(chatId) !== String(TELEGRAM_ALLOWED_CHAT_ID)) return;
  if (!allowedUsers.includes(userId)) return;

  const members = await supabaseRequest(
  "family_members",
  `select=id,family_id,display_name&telegram_user_id=eq.${userId}&is_active=eq.true&limit=1`
);

  if (!members.length) {
    await telegramReply(chatId, "Akun Telegram ini belum terdaftar sebagai anggota keluarga.");
    return;
  }

  const member = members[0];

  if (command === "/start") {
    await telegramReply(
      chatId,
      "👋 Selamat datang di Keluarga Zale Finance Bot!\n\n" +
      "Contoh transaksi:\n" +
      "• Beli bensin 30rb dari BRI\n" +
      "• Gaji masuk 7,4 juta ke BNI\n" +
      "• Transfer 500rb dari BRI ke Tabungan Lebaran\n\n" +
      "Setiap transaksi akan menunggu konfirmasi sebelum disimpan."
    );
    return;
  }

  if (command === "/ping") {
    await telegramReply(chatId, "Pong! 🟢 Bot berjalan dengan baik.");
    return;
  }

  if (command === "/status") {
    await supabaseRequest("families", "select=id&limit=1");
    await telegramReply(chatId, "🟢 Bot aktif\n🟢 Koneksi Supabase berhasil");
    return;
  }

  if (command === "/saldo") {
  const [accounts, transactions] = await Promise.all([
    supabaseRequest(
      "accounts",
      `select=id,name,account_type,opening_balance&family_id=eq.${member.family_id}`
    ),
    supabaseRequest(
      "transactions",
      `select=account_id,destination_account_id,transaction_type,amount&family_id=eq.${member.family_id}&status=eq.confirmed`
    ),
  ]);

  const balances = {};

  // Mulai dari saldo awal masing-masing rekening
  for (const account of accounts) {
    balances[account.id] = Number(account.opening_balance || 0);
  }

  // Hitung seluruh transaksi yang sudah dikonfirmasi
  for (const transaction of transactions) {
    const amount = Number(transaction.amount);

    if (transaction.transaction_type === "income") {
      if (balances[transaction.account_id] !== undefined) {
        balances[transaction.account_id] += amount;
      }
    }

    if (transaction.transaction_type === "expense") {
      if (balances[transaction.account_id] !== undefined) {
        balances[transaction.account_id] -= amount;
      }
    }

    if (transaction.transaction_type === "transfer") {
      if (balances[transaction.account_id] !== undefined) {
        balances[transaction.account_id] -= amount;
      }

      if (balances[transaction.destination_account_id] !== undefined) {
        balances[transaction.destination_account_id] += amount;
      }
    }
  }

  const totalBalance = Object.values(balances).reduce(
    (total, balance) => total + balance,
    0
  );

  let reply = "💰 SALDO REKENING KELUARGA ZALE\n\n";

  for (const account of accounts) {
    reply += `${account.name}: ${formatRupiah(balances[account.id])}\n`;
  }

  reply += `\n━━━━━━━━━━━━━━\n`;
  reply += `TOTAL SALDO: ${formatRupiah(totalBalance)}`;

  await telegramReply(chatId, reply);
  return;
}

  if (command === "/confirm" || command === "/batal") {
  const pending = await supabaseRequest(
    "transactions",
    `select=id,description,amount,transaction_type&family_id=eq.${member.family_id}&member_id=eq.${member.id}&status=eq.pending&order=created_at.desc&limit=1`
  );

  if (!pending.length) {
    await telegramReply(chatId, "Tidak ada transaksi yang menunggu konfirmasi.");
    return;
  }

  const transaction = pending[0];
  const newStatus = command === "/confirm" ? "confirmed" : "cancelled";

  await supabaseRequest(
    "transactions",
    `id=eq.${transaction.id}&family_id=eq.${member.family_id}`,
    {
      method: "PATCH",
      body: { status: newStatus },
    }
  );

  await telegramReply(
    chatId,
    newStatus === "confirmed"
      ? `✅ Transaksi berhasil disimpan!\n${transaction.description}\n${formatRupiah(Number(transaction.amount))}`
      : "❌ Transaksi dibatalkan."
  );
  return;
}

  if (text.startsWith("/")) {
    await telegramReply(chatId, "Perintah belum tersedia. Gunakan /start untuk melihat panduan.");
    return;
  }

  const existingPending = await supabaseRequest(
    "transactions",
    `select=id&family_id=eq.${member.family_id}&member_id=eq.${member.id}&status=eq.pending&limit=1`
  );

  if (existingPending.length) {
    await telegramReply(
      chatId,
      "⚠️ Masih ada transaksi yang menunggu konfirmasi.\n\nKetik /confirm untuk menyimpan atau /batal untuk membatalkan transaksi tersebut terlebih dahulu."
    );
    return;
  }

  const amount = parseAmount(text);
  const type = detectType(text);

  if (!amount || !type) {
    await telegramReply(
      chatId,
      "Saya belum bisa mengenali transaksi tersebut.\n\nContoh:\nBeli bensin 30rb dari BRI\nGaji masuk 7,4 juta ke BNI\nTransfer 500rb dari BRI ke Tabungan Lebaran"
    );
    return;
  }

  const [accounts, categories] = await Promise.all([
    supabaseRequest(
      "accounts",
      `select=id,name,account_type&family_id=eq.${member.family_id}`
    ),
    supabaseRequest(
      "categories",
      `select=id,name,transaction_type&or=(family_id.eq.${member.family_id},family_id.is.null)`
    ),
  ]);

  let sourceAccount;
  let destinationAccount = null;

  if (type === "income") {
    sourceAccount = findAccount(text, accounts, "destination");
  } else {
    sourceAccount = findAccount(text, accounts, "source");
  }

  if (type === "transfer") {
    destinationAccount = findAccount(text, accounts, "destination");
  }

  if (!sourceAccount) {
    await telegramReply(
      chatId,
      "Rekening atau sumber dana belum dikenali.\n\nTuliskan rekeningnya, misalnya:\nBeli bensin 30rb dari BRI\nGaji masuk 7,4 juta ke BNI"
    );
    return;
  }

  if (type === "transfer" && !destinationAccount) {
    await telegramReply(
      chatId,
      "Rekening tujuan belum dikenali.\n\nContoh:\nTransfer 500rb dari BRI ke Tabungan Lebaran"
    );
    return;
  }

  if (type === "transfer" && sourceAccount.id === destinationAccount.id) {
    await telegramReply(chatId, "Rekening asal dan tujuan tidak boleh sama.");
    return;
  }

  const categoryName = detectCategory(text, type);
  const category = categories.find(
    (item) =>
      item.name === categoryName &&
      item.transaction_type === type
  );

  if (!category) {
    await telegramReply(
      chatId,
      `Kategori "${categoryName}" belum ditemukan. Silakan periksa kategori di Supabase.`
    );
    return;
  }

  const description = cleanDescription(text) || categoryName;

  const inserted = await supabaseRequest(
    "transactions",
    "",
    {
      method: "POST",
      body: {
        family_id: member.family_id,
        member_id: member.id,
        account_id: sourceAccount.id,
        destination_account_id: destinationAccount?.id || null,
        category_id: category.id,
        transaction_type: type,
        amount,
        description,
        source: "telegram",
        status: "pending",
        telegram_update_id: updateId,
      },
    }
  );

  const transaction = inserted[0];

  let detail = `📝 KONFIRMASI TRANSAKSI\n\n`;
  detail += `Anggota: ${member.display_name}\n`;
  detail += `Jenis: ${type === "income" ? "Pemasukan" : type === "expense" ? "Pengeluaran" : "Transfer"}\n`;
  detail += `Nominal: ${formatRupiah(amount)}\n`;
  detail += `Kategori: ${category.name}\n`;

  if (type === "income") {
    detail += `Masuk ke: ${sourceAccount.name}\n`;
  } else {
    detail += `Dari: ${sourceAccount.name}\n`;
  }

  if (destinationAccount) {
    detail += `Ke: ${destinationAccount.name}\n`;
  }

  detail += `Keterangan: ${description}\n\n`;
  detail += `ID: ${transaction.id}\n\n`;
  detail += `Ketik /confirm untuk menyimpan.\nKetik /batal untuk membatalkan.`;

  await telegramReply(chatId, detail);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false });
  }

  if (!isAuthorized(req)) {
    return sendJson(res, 401, { ok: false });
  }

  if (
    !TELEGRAM_BOT_TOKEN ||
    !TELEGRAM_ALLOWED_CHAT_ID ||
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {
    return sendJson(res, 500, { ok: false });
  }

  try {
    const update = req.body || {};
    const message = update.message;

    if (message?.text) {
      await handleMessage(message, update.update_id);
    }

    return sendJson(res, 200, { ok: true });
  } catch (error) {
    // Jangan mencatat token, secret, atau isi payload Telegram.
    console.error("Webhook processing error:", error.message);

    const chatId = req.body?.message?.chat?.id;

    if (chatId && TELEGRAM_BOT_TOKEN) {
      try {
        await telegramReply(
          chatId,
          "⚠️ Terjadi kendala saat memproses transaksi. Belum ada konfirmasi bahwa transaksi berhasil disimpan. Silakan coba lagi atau periksa statusnya."
        );
      } catch (_) {
        // Tetap mengembalikan 200 agar Telegram tidak mengulang update tanpa kontrol.
      }
    }

    return sendJson(res, 200, { ok: true });
  }
};
