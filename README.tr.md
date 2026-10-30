<div align="center">

# Ecelon Station

**[Claude Code](https://docs.claude.com/en/docs/claude-code) ajan ekipleri için yerel bir kontrol odası.**
Her proje izometrik bir ofiste bir oda, her rol masasında bir karakter.
Ve koddan kanıt gelmeden analiz dokümanındaki hiçbir madde "yapıldı" sayılmaz.

[![CI](https://github.com/rildir/ecelon-station/actions/workflows/ci.yml/badge.svg)](https://github.com/rildir/ecelon-station/actions/workflows/ci.yml)
[![Lisans: MIT](https://img.shields.io/badge/lisans-MIT-blue.svg)](LICENSE)
![Node 20+](https://img.shields.io/badge/node-20%2B-339933)
![Yalnızca yerel](https://img.shields.io/badge/%C3%A7al%C4%B1%C5%9F%C4%B1r-%25100%20yerel-success)

<img src="docs/media/hero.gif" alt="Ecelon Station: üç proje odası, ekip sohbeti, gereksinim ekranı ve doküman kapsaması" width="860">

[English](README.md) · [Türkçe](README.tr.md)

</div>

## 30 saniyede dene

Claude Code, API anahtarı ya da kendi projen gerekmez — demo, üç örnek proje üzerinde senaryolu sahte ajanlar çalıştırır:

```bash
git clone https://github.com/rildir/ecelon-station
cd ecelon-station
npm install
npm run demo
```

`http://127.0.0.1:4777` açılır. Bir odaya tıkla, mesaj gönder; sonra **Kapsam**'ı aç ve **Dokümandan çıkar → Kodla karşılaştır → Testçiye doğrulat** düğmelerine sırayla bas. Arayüz dilini üst çubuktaki **EN** düğmesinden Türkçe yapabilirsin.

Gerçek ajanlarla çalışmak için [Claude Code](https://docs.claude.com/en/docs/claude-code) kur (`claude --version` çalışmalı), `npm run demo` yerine `npm start` çalıştır ve **Proje ekle**'ye bas.

## Neden

Tek bir Claude Code oturumu çalıştırmak kolay. Birkaç repoda birkaç oturumu, gerçekten karşılanması gereken bir analizle birlikte yürütmek ise karışır:

- Hangi projem düşünüyor, hangisi izin bekliyor, hangisi bitti?
- Analiz dokümanı bir özellik için "yapıldı" diyor. Gerçekten kodda var mı, yoksa biri öyle mi dedi?
- Kodu yazan ajan kendi ödevini de kendisi mi notladı?

Ecelon Station bunları tek ekranda cevaplar.

<p align="center"><img src="docs/media/station.png" alt="Üç proje odası ve ajanları" width="860"></p>

## Neler var

### Tek sohbet yerine her projede bir ekip
Her proje klasörüne bir **lider (geliştirici)**, bir **analist**, bir **testçi** ve bir **gözden geçirici** gelir; her birinin kendi oturumu ve odada kendi masası vardır. Dosya yazan yalnızca liderdir; analist ve gözden geçirici salt okunurdur; testçi sorunu sessizce "düzeltmek" yerine raporlar. İş, bir düğmeyle ya da mesajda `@testçi` yazarak devredilir. 3B'de izleyebilir ya da 3B'yi yok sayıp sadece sohbeti kullanabilirsin.

<p align="center"><img src="docs/media/chat.png" alt="Liderle sohbet; testçiye devir, izin kartı, testçi sonucu" width="860"></p>

### Analiz-gerçeklik izlenebilirliği ("Kapsam")
Bir analiz dokümanını (Markdown, Word, Excel; MarkItDown ile PDF) projeye bağla, sonra:

1. **Çıkar** — analist dokümanı, kendi cümlesinden alıntıyla numaralı gereksinimlere (`R-001`…) çevirir.
2. **Karşılaştır** — analist her maddeyi kodla karşılaştırır, `dosya:satır` işaretiyle durum belirler.
3. **Doğrula** — *testçi* (farklı bir ajan) senaryoyu çalıştırır ve gerçek kanıt eklemek zorundadır (gerçekten koşmuş bir komut, bir sonuç dosyası). Kanıt yoksa "doğrulandı" yok.

Doküman *yapıldı* diyor ama hiçbir şey doğrulamıyorsa yeşil tik yerine **uyuşmazlık** uyarısı görürsün.

<p align="center"><img src="docs/media/scope.png" alt="Uyuşmazlık uyarılı gereksinim ekranı" width="860"></p>

### Doküman kapsaması — hiçbir şey atlanmaz
Dokümanın her paragrafı, madde işareti, tablo satırı, başlığı ve görseli izlenir. Hiçbir gereksinime bağlanmamış bölümler **eşleşmemiş** görünür; ajan "gereksinim içermiyor" önerebilir ama bu ancak *sen* onaylayınca sayılır. Kapsama yüzdesi iddia edilmez, hesaplanır.

<p align="center"><img src="docs/media/coverage.png" alt="Doküman kapsama ekranı" width="860"></p>

### Gerisi
- **Varsayılan olarak güvenli:** her görevden önce ve sonra git kontrol noktası (dalına ve index'ine dokunulmaz). Sohbette "3 dosya değişti" kartında farkları gör, tek tıkla geri al.
- **Gerçek sohbet arayüzü:** model / efor / izin modu, düşünce akışı, araç ayrıntıları, görev listesi, plan onayı, izin kartları, `@dosya` önerisi, mesaj kuyruğu, görsel ekleme, sesle yazma, kullanım ve bağlam göstergeleri.
- **Belge arşivi:** PDF, Word, Excel, Markdown, CSV; belge içinde arama; otomatik sürüm geçmişi; 7 gün geri alınabilir silme. Sohbette `#` ile iliştir.
- **Yerleşik kod editörü** (Monaco), Git paneli, kardeş proje bağları (lider ortak bir API'yi değiştirince karşı projeyi uyarır).
- **Türkçe ve İngilizce arayüz**, üst çubuktan değişir.
- **Sessiz:** görev bitince, izin gerekince ya da hata olunca bildirim.

## Gizlilik ve güvenlik

- Sunucu yalnızca **`127.0.0.1`**'i dinler; `Host` ve `Origin` başlıkları denetlenir (CSRF / DNS rebinding koruması).
- **Telemetri yok, hesap yok, bulut yok.** Kodun ve belgelerin makinende kalır. Tek ağ trafiği, `claude`'u kendin çalıştırdığındaki gibi Claude Code'un Anthropic ile konuşmasıdır.
- Projeler, gereksinimler ve belge arşivi `./data` altında tutulur (ya da `--data` / `ECELON_DATA` neredeyse orada). Hepsi git'e girmeyecek şekilde yok sayılır; belgeler yanlışlıkla commit'e girmez.
- Ecelon Station tek kullanıcılı bir araçtır, giriş ekranı yoktur: portunu dışarı açma (tünel, port yönlendirme, ortak makine yok). Ayrıntı: [SECURITY.md](SECURITY.md).
- Ecelon Station kendisi hiçbir şey push etmez, yüklemez, yayımlamaz. Varsayılan izin modlarında Claude Code, `git push` gibi komutlardan önce sana sorar; sohbetteki izin kartından yanıtlarsın.
- "Tam yetki" modu ajanın sormadan komut çalıştırmasına izin verir; yalnızca güvendiğin projelerde aç.

## Gereksinimler

- Node.js 20+ ve WebGL destekli güncel bir tarayıcı (Chrome, Edge, Firefox, Safari).
- Gerçek kullanım için (demo dışında): giriş yapılmış [Claude Code](https://docs.claude.com/en/docs/claude-code). `PATH`'te değilse `CLAUDE_BIN=/yol/claude` ile göster.
- İsteğe bağlı: `git` (kontrol noktaları, değişiklik kartları, Git paneli), Python 3.10+ (PDF / PowerPoint / EPUB metnini çıkaran tek tıkla MarkItDown okuyucusu için), Linux'ta `zenity` (klasör seçici; yoksa yolu yapıştır).
- Birim ve duman testleri CI'da Windows, macOS ve Linux'ta çalışır (Node 20 ve 22). Masaüstü bildirimleri Windows'ta PowerShell, macOS'ta `osascript`, Linux'ta `notify-send` kullanır.
- Windows'ta klondan, `windows\install-shortcuts.bat` masaüstü / Başlat menüsü kısayolu ekler; istasyon kendi penceresinde açılır, sunucu oturum açılınca başlar.

## Seçenekler

```
node bin/ecelon-station.js [--demo] [--port 4777] [--lang en|tr] [--data <klasör>] [--no-open] [--watch]
```

## Geliştirme

```bash
npm install
npm test        # birim testleri + demo modu duman testi
npm run lint    # eslint + çeviri tutarlılık denetimi
```

Düz ES modülleri; framework yok, bundler yok. Bkz. [CONTRIBUTING.md](CONTRIBUTING.md) ve [docs/i18n.md](docs/i18n.md).

## Teşekkür

3B varlıklar: [Kenney](https://kenney.nl) (Space Kit, Furniture Kit, Blocky Characters — CC0). Editör: [Monaco](https://microsoft.github.io/monaco-editor/), 3B: [three.js](https://threejs.org).

## Lisans

[MIT](LICENSE)
