# Kullanıcı Fotoğrafları (foto gönderme)

Karakter senden foto isteyince buradan birini gönderebilirsin. Fotoğraf
ComfyUI JoyCaption ile analiz edilir (NSFW dahil) → içeriği karaktere metin
olarak iletilir → karakter ne gönderdiğini anlar.

## Kurulum
1. Fotoğraflarını bu klasöre koy (jpg/png/webp).
2. `index.json`'a dosya adlarını ekle, örn:
   ```json
   ["bora_1.jpg", "bora_2.png", "selfie3.jpg"]
   ```
   (İstersen başlık de verebilirsin: `[{"file":"bora_1.jpg","label":"plajda"}]`)
3. Phone shell'de 📷 → "📎 Fotoğrafım gönder" menüsünden seç.

## JoyCaption (içerik analizi) kurulumu — ComfyUI tarafı
`easy joyCaption2API` BizyAIR buluttur (API key + NSFW sansürü olabilir).
Gerçek yerel NSFW caption için ComfyUI'da `ComfyUI_SLK_joy_caption_two`
node'unu kurup config.yaml + modelini indir. Caption çalışmazsa foto yine
gönderilir, sadece "[içerik analiz edilemedi]" notu düşülür (graceful).
