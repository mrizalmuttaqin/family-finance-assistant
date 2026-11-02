
# Family Finance Assistant

Telegram bot untuk membantu pencatatan dan pemantauan keuangan keluarga.

## Teknologi

- Telegram Bot API
- Vercel Serverless Functions
- Supabase PostgreSQL

## Fitur awal

- `/start` untuk memulai bot
- `/ping` untuk memeriksa bot
- `/status` untuk memeriksa koneksi Supabase
- Pembatasan akses berdasarkan grup dan Telegram User ID
- Validasi webhook secret

## Environment Variables

Semua kredensial disimpan di Vercel Environment Variables, bukan di repository.

## Endpoint

`/api/webhook`
