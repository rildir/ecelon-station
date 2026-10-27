# Ecelon Station

Bilgisayarındaki projeleri izometrik bir uzay istasyonunda modüllere dönüştüren, her modülde bir
**Claude Code** ajanı çalıştıran yerel kontrol odası. Her ajan yalnızca kendi proje klasöründe çalışır;
hepsine tek ekrandan, VS Code'daki Claude sohbetine benzer bir arayüzle komut verirsin.

> Yalnızca **yerel ve kişisel kullanım** içindir. Senin Claude Code oturumunla (`claude -p`) çalışır;
> sunucu yalnızca `127.0.0.1`'i dinler ve başka sitelerden gelen istekleri reddeder.

## Gereksinimler
- Windows 10/11 (macOS/Linux'ta da çalışır; kısayol kurulumu Windows'a özel)
- [Node.js](https://nodejs.org) 20+
- [Claude Code](https://docs.claude.com/en/docs/claude-code) kurulu ve giriş yapılmış (`claude --version` çalışmalı)

## Kurulum
```
npm install
```
Sonra **bir kez** `kurulum.bat` çift tıkla:
- Masaüstüne ve Başlat menüsüne **Ecelon Station** kısayolu eklenir (kendi penceresinde, adres çubuğu olmadan açılır).
- Bilgisayar açılınca sunucu arka planda kendiliğinden başlar.

Kaldırmak için `kaldir.bat`. Elle başlatmak istersen: `npm start` ve tarayıcıda http://127.0.0.1:4777

Deneme modu (Claude çağırmadan sahte akış): `npm run dev` (Windows: `npm run dev:win`)

## Özellikler
- **İstasyon:** her proje Kenney Space Kit'ten bir modül, her ajan animasyonlu bir Kenney karakteri.
  Sürükleyerek gez, tekerle yakınlaş, odaları sürükleyip birbirinin üstüne bırakarak yer değiştir.
- **Sohbet:** model / efor / izin seçimi, konuşma geçmişi, düşünce akışı, araç ayrıntıları (fark, komut çıktısı),
  görev listesi, plan onayı, izin isteme kartları, `@dosya` önerisi, mesaj kuyruğu, görsel ekleme ve gösterme,
  sesle yazma, kullanım limiti ve bağlam göstergesi.
- **Proje ekleme:** Windows Gezgini penceresiyle klasör seç.

## Klasör yapısı
```
server/        Express + WebSocket sunucusu, claude -p koşucusu, klasör seçici (PowerShell)
public/        Arayüz (Three.js sahnesi, sohbet paneli), fontlar node_modules'tan servis edilir
public/assets/ Kenney modelleri (CC0) ve lisansları
data/, logs/   Yerel veriler ve sohbet kayıtları (git'e girmez)
```

## Güvenlik notları
- Sunucu yalnızca `127.0.0.1:4777`'yi dinler; Host ve Origin başlıkları denetlenir (CSRF ve DNS rebinding'e karşı).
- "Tam yetki" izni ajanın sormadan komut çalıştırmasına izin verir; yalnızca güvendiğin projelerde aç.
- Sohbet kayıtları ve ajan listesi `logs/` ve `data/` içinde yerel kalır.

## Teşekkür
3D varlıklar: [Kenney](https://kenney.nl) — Modular Space Kit, Blocky Characters (CC0).
