# Stok Modülü — Analiz Dokümanı v3

Bu doküman Aurora ERP stok modülünün giriş/çıkış süreçlerini ve ekranlarını tanımlar.

# 1. Kapsam

Depolar arası transfer, stok sayımı, minimum stok uyarıları.

# 2. Ekranlar

- Stok kartı listesi — stok koduna ve ada göre filtrelenebilir. Durum: Tamamlandı (v3, s.4)
- Depo transfer fişi — onay akışından geçmelidir; reddedilen fiş gerekçesiyle kapatılır. Durum: Kısmen yapıldı (onay adımı eklendi, red akışı bekliyor)
- Stok sayım fişi — depo bazında ay sonu sayımı. Durum: ✓ Yapıldı (v3, s.5)

| Alan | Tip | Zorunlu |
| --- | --- | --- |
| StokKodu | nvarchar(30) | Evet |
| Birim | int | Evet |

# 3. Kurallar

3.1 Kaynak depoda yeterli stok yoksa transfer reddedilmelidir.

3.2 Bir kartın toplam stoku minimum stokun altına düşerse gösterge panelinde uyarı verilmelidir.

3.3 Stok kodları tekil olmalı ve büyük harfle saklanmalıdır.
