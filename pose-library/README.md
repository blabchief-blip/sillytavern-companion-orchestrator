# Poz Kütüphanesi (ControlNet)

`auto_gen` modülü sahne tag'lerine göre buradan poz referansı seçip ComfyUI'ya
ControlNet ile uygular (`useControlNet: true` iken). Dosya yoksa sessizce atlanır
(graceful) — kütüphane boşken üretim normal devam eder.

## Klasör yapısı (SCENE_POSE_REFS ile eşleşmeli)

```
pose-library/
  explicit/
    missionary.png
    cowgirl.png
    doggystyle.png
    oral.png
    spooning.png
  couple/
    straddling.png
    against_wall.png
    embrace.png
    kiss.png
  solo/
    lying.png
    arching.png
    sitting.png
    standing.png
```

## Görsel formatı

- **ControlNet modeli:** `control-lora-depth-rank256.safetensors` (SDXL/Pony uyumlu)
  - Bu DEPTH ControlNet'tir → poz referansları **depth map** VEYA poz duruşunu net
    gösteren normal görsel olabilir (ComfyUI preprocessor'ı işler).
  - OpenPose iskelet PNG'leri için SDXL openpose modeli (`OpenPoseXL2.safetensors`)
    indirilip `controlNetModel` ayarı değiştirilmeli.
- **Çözünürlük:** 832×1216 (üretim boyutuyla aynı oran) ideal.
- **Tek kişi mi çift mi:** `explicit/` ve `couple/` çift poz, `solo/` tek kişi.

## Community pack ekleme

NSFW OpenPose/depth pack indirip yukarıdaki isimlerle bu klasöre yerleştir.
İsimler `SCENE_POSE_REFS` tablosundaki (`modules/auto_gen.js`) yollarla
birebir eşleşmeli. Yeni poz tipi eklemek için tabloya satır ekle.

## Aktifleştirme

1. Görselleri yerleştir.
2. Ayarlar → Otomatik Üretici → `useControlNet` aç (veya settings'te `true`).
3. Sahne metni bir poz tag'i içerince (örn. "missionary") otomatik uygulanır.
