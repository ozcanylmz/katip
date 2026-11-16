// Kâtip sabah bildirimi: telefona yalnız "uyan" sinyali gönderir.
// İş listesi sunucuda yoktur; bildirim metnini telefondaki uygulama kendisi hazırlar.
const webpush = require('web-push');

const raw = process.env.KATIP_PUSH;
if (!raw) { console.log('KATIP_PUSH tanımlı değil; atlandı.'); process.exit(0); }

let configs = JSON.parse(raw);
if (!Array.isArray(configs)) configs = [configs];

(async () => {
  let ok = 0;
  for (const c of configs) {
    try {
      const res = await webpush.sendNotification(c.sub, JSON.stringify({ t: 'daily' }), {
        vapidDetails: { subject: 'https://ozcanylmz.github.io/katip/', publicKey: c.pub, privateKey: c.priv },
        TTL: 6 * 3600,
        urgency: 'normal',
      });
      console.log('Gönderildi:', res.statusCode);
      ok++;
    } catch (e) {
      console.error('Gönderilemedi:', e.statusCode || '', e.body || e.message);
      if (e.statusCode === 404 || e.statusCode === 410) console.error('Abonelik geçersiz: uygulamada bildirimleri yeniden açıp yeni kurulum kodunu kaydedin.');
    }
  }
  if (!ok) process.exit(1);
})();
