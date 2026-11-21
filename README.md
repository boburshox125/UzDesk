# UzDesk — kompyuterni masofadan boshqarish

Kompyuteringizni **Android telefon** yoki **boshqa kompyuter**dan boshqaring: yuqori sifatli, kam kechikishli tasvir, sensorli boshqaruv, fayl va matn almashish.

| Qurilma | Fayl | Vazifasi |
|---|---|---|
| Windows 10/11 | `UzDesk.exe` | Boshqariladigan kompyuter (server) **va** boshqa kompyuterga ulanish |
| Android 8+ | `UzDesk.apk` | Kompyuterni telefondan boshqarish |

Yuklab olish: [Releases](../../releases/latest) bo'limi.

## Tezkor boshlash

1. Kompyuterda `UzDesk.exe` ni ishga tushiring. Windows Firewall so'rasa — **Ruxsat berish** (Private va Public).
2. Dastur oynasida **ID** va **PIN** ko'rinadi.
3. Telefonda `UzDesk.apk` ni o'rnating va oching.
   - **Bir Wi‑Fi tarmoqda** bo'lsangiz — kompyuter “Tarmoqdagi kompyuterlar” ro'yxatida o'zi chiqadi. Bosing, PIN ni kiriting.
   - **Boshqa joydan (mobil internet)** — kompyuterda **“Internet orqali ulanish”** tugmasini yoqing, telefonda **ID** va **PIN** ni kiriting.

## Imkoniyatlar

- **Tez va sifatli video**: H.264 (NVIDIA NVENC, Intel QuickSync, AMD AMF yoki CPU x264) va JPEG rejimi; DXGI orqali ekran olish.
- **Qotmaslik uchun oqim nazorati**: telefon/tarmoq ulgurmasa kadrlar navbatga yig'ilmaydi — kechikish o'smaydi. Moslashuvchan bitreyt tarmoqqa qarab sifatni o'zgartiradi. Ekran o'zgarmasa trafik deyarli nol, matn esa avtomatik tiniqlashadi.
- **Uzilmaslik**: aloqa uzilsa avtomatik qayta ulanadi (Wi‑Fi ↔ mobil internet almashsa ham), heartbeat bilan "o'lik" ulanish tez aniqlanadi.
- **Video sozlamalari** (har bir kompyuter uchun saqlanadi): profil (Tejamkor / Muvozanat / Yuqori / Ultra), kodek, kodlovchi, kodlash rejimi, FPS (10–90), bitreyt (0.5–40 Mbit/s), o'lcham (25–100%), JPEG sifati, monitor tanlash.
- **Sensorli boshqaruv**: Touchpad rejimi (noutbuk sensori kabi) yoki to'g'ridan-to'g'ri bosish; 2 barmoq — aylantirish / o'ng tugma, chimdish — kattalashtirish, ikki marta bosib surish — sudrash, 3 barmoq — klaviatura.
- **Klaviatura**: telefon klaviaturasi (istalgan til), maxsus tugmalar paneli (Ctrl, Alt, Win, F1–F12, strelkalar...), tezkor buyruqlar (Alt+Tab, Win+D, Ctrl+C/V ...).
- **Almashish buferi** sinxronlash, **fayl yuborish** (kompyuterdagi `Yuklanmalar\UzDesk` papkasiga), qulflash, vazifalar menejeri, o'chirish/qayta yuklash/uyqu.
- **Xavfsizlik**: 6 xonali PIN yoki doimiy parol, noto'g'ri urinishlarda bloklash, ixtiyoriy “har ulanishni tasdiqlash” rejimi.
- Windows bilan birga ishga tushish, tray'da fonda ishlash.

## Internet orqali ulanish qanday ishlaydi

“Internet orqali ulanish” yoqilganda kompyuter **Cloudflare Quick Tunnel** (`cloudflared`) orqali shifrlangan `https://...trycloudflare.com` manzil oladi. Manzil har safar o'zgargani uchun dastur uni **ID** ostida `ntfy.sh` xizmatiga e'lon qiladi — telefon ID orqali joriy manzilni topadi va avval mahalliy tarmoqni, keyin internetni sinaydi. Buni Sozlamalarda o'chirish mumkin (unda havolani qo'lda kiritasiz).

Barqarorroq internet ulanish uchun [Tailscale](https://tailscale.com) ham ishlaydi: ikkala qurilmaga o'rnating va kompyuterning Tailscale IP manzilini kiriting.

## Eslatmalar

- Administrator huquqi bilan ochilgan oynalarni boshqarish uchun dasturni “Administrator sifatida qayta ochish” tugmasi bilan ishga tushiring.
- Windows xavfsiz ekranini (UAC, Ctrl+Alt+Del) foydalanuvchi rejimidagi dastur ko'ra olmaydi.
- Exe imzolanmagani uchun SmartScreen ogohlantirishi chiqishi mumkin: **Batafsil → Baribir ishga tushirish**.

## Loyiha tuzilishi

```
host/      Windows dasturi (Python): ekran olish, kodlash, server, GUI
client/    Umumiy ko'ruvchi (HTML/JS) — Android ilova va Windows oynasi ishlatadi
android/   Android ilova (Kotlin, WebView + mahalliy tarmoqda qidirish)
.github/   GitHub Actions: EXE va APK avtomatik yig'iladi, `v*` teg — Release
```

### Mahalliy ishga tushirish

```bash
pip install -r host/requirements.txt
python host/uzdesk_main.py
```

Yangi versiya chiqarish: `git tag v1.0.1 && git push --tags` — Actions EXE va APK ni yig'ib Release'ga qo'yadi.
