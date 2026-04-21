# İlgi alanları (interests)

Uygulamadaki ilgi alanları veritabanında çok dilli saklanır ve HTTP API ile çekilir.

## Veritabanı

- **Dosya:** `database/interests_table.sql`
- **Tablo adı:** `interests`

### Kolonlar

| Kolon | Açıklama |
|--------|-----------|
| `id` | Otomatik artan birincil anahtar |
| `slug` | Sabit anahtar (örn. `hiking`, `photography`) — uygulama mantığında kullanın |
| `emoji` | Görsel emoji karakteri |
| `sort_order` | Listeleme sırası (küçükten büyüğe) |
| `interest_tr` … `interest_ko` | 11 dilde metin etiketi |

### Desteklenen dil kodları

| Kod | Dil |
|-----|-----|
| `tr` | Türkçe |
| `en` | İngilizce |
| `de` | Almanca |
| `fr` | Fransızca |
| `pt` | Portekizce |
| `it` | İtalyanca |
| `zh` | Çince |
| `ja` | Japonca |
| `ru` | Rusça |
| `hi` | Hintçe |
| `ko` | Korece |

### Kurulum

MySQL / MariaDB üzerinde SQL dosyasını çalıştırın:

```bash
mysql -u KULLANICI -p VERITABANI_ADI < database/interests_table.sql
```

Script ikinci kez çalıştırılırsa aynı `slug` değerleri için satırlar güncellenir (`ON DUPLICATE KEY UPDATE`).

---

## API

**Base path:** `/interests`  
Kimlik doğrulama gerekmez (herkese açık).

### 1. Tüm kayıtlar — tüm diller

Tüm dil kolonlarını tek seferde almak için.

- **Yöntem:** `POST`
- **URL:** `/interests/list`
- **Body:** Boş veya `{}` (JSON)

**Örnek yanıt:**

```json
{
  "success": true,
  "count": 13,
  "interests": [
    {
      "id": 1,
      "slug": "hiking",
      "emoji": "🏔️",
      "sort_order": 1,
      "interest_tr": "Doğa yürüyüşü",
      "interest_en": "Hiking",
      "interest_de": "Wandern",
      "interest_fr": "Randonnée",
      "interest_pt": "Caminhadas",
      "interest_it": "Escursionismo",
      "interest_zh": "徒步",
      "interest_ja": "ハイキング",
      "interest_ru": "Походы",
      "interest_hi": "हाइकिंग",
      "interest_ko": "하이킹"
    }
  ]
}
```

### 2. Yerelleştirilmiş liste — tek dil

Arayüzde chip metni için; her satırda sadece seçilen dilin `label` alanı döner.

- **Yöntem:** `POST` veya `GET`

**POST** `/interests/list-localized`

```json
{
  "lang": "tr"
}
```

**GET** `/interests/list-localized?lang=tr`

**Örnek yanıt:**

```json
{
  "success": true,
  "lang": "tr",
  "count": 13,
  "interests": [
    {
      "id": 1,
      "slug": "hiking",
      "emoji": "🏔️",
      "sort_order": 1,
      "label": "Doğa yürüyüşü"
    }
  ]
}
```

Geçersiz `lang` gönderilirse `400` ve desteklenen kodların listesi döner.

---

## Flutter / istemci önerileri

1. Kullanıcı diline göre `lang` parametresini ayarlayın (örn. `tr`, `en`).
2. Seçimleri kaydederken **`slug`** kullanın; böylece dil değişince metin API’den tekrar çekilebilir.
3. Tam URL örneği (sunucu adresinizi yazın):

   - `POST https://API_ADRESI/interests/list-localized`
   - `GET https://API_ADRESI/interests/list-localized?lang=tr`

---

## Yeni ilgi alanı veya çeviri güncelleme

1. Veritabanında `interests` tablosuna `INSERT` ile yeni satır ekleyin veya mevcut satırı güncelleyin.
2. Yeni satır için benzersiz bir `slug` kullanın.
3. İsterseniz `database/interests_table.sql` dosyasındaki `INSERT` listesini de güncel tutun; böylece yeni ortamlar tek script ile kurulur.

Kod tarafında route dosyası: `routes/interests.js` — yeni kolon eklerseniz bu dosyadaki `SELECT` listesine de eklemeniz gerekir.
