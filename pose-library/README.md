# Poz Kütüphanesi (ControlNet)

`auto_gen` modülü sahne tag'lerine göre buradan poz referansı seçip ComfyUI'ya
ControlNet ile uygular (`useControlNet: true` iken). Dosya yoksa sessizce atlanır
(graceful) — kütüphane boşken üretim normal devam eder.

## Klasör yapısı (SCENE_POSE_REFS ile eşleşmeli)

**v0.8.x Batch 3 — Toplam 80 poz, 12 kategori:**

```
pose-library/
  explicit/ (9)         — missionary, cowgirl, reverse_cowgirl, doggystyle, standing_doggy, oral, sixty_nine, prone_bone, spooning
  couple/ (37)          — straddling, against_wall, embrace, kiss, lap_sit_legs_over, facing_window, dining_table, shower_together, bath_together, couch_makeout, morning_under_covers, slow_dance, forehead_kiss, carrying_bride, wedding_kiss, first_meet, standing_kiss_wall, lap_makeout, bedside_intimate, shower_washing, cooking_together, brunch_table, waking_up_couple, laundry_together, rooftop_stars, taxi_ride, park_bench, beach_sunset, picnic_blanket, hiking_peak, boat_ride, party_grind, new_year_kiss, anniversary_dance, shower_intimate, pool_hot_tub, balcony_night
  solo/ (9)             — lying, arching, sitting, standing, over_the_shoulder, bathroom_mirror, selfie_couch, squatting, stretching_yoga
  oral_variants/ (4)    — facial, deepthroat, cunnilingus_giver, cunnilingus_receiver
  combo/ (2)            — anal_doggy, anal_cowgirl
  clothed/ (3)          — flirting_office_desk, flirting_elevator, flirting_balcony
  office/ (3)           — presentation_pose, desk_working, water_cooler
  work/ (2)             — laptop_cafe, standing_desk
  party/ (3)            — club_dancing, cocktail_bar, balcony_smoking
  beach/ (3)            — beach_walking, poolside, sunbathing
  home/ (3)             — cooking, reading_book, couch_tv
  public/ (2)           — car_backseat, taxi_backseat
```

**Couple 11 → 37 genişletme (Batch 3):**
- Romantik/samimi (5): slow_dance, forehead_kiss, carrying_bride, wedding_kiss, first_meet
- Intimate/NSFW trust 5+ (4): standing_kiss_wall, lap_makeout, bedside_intimate, shower_washing
- Morning/domestic trust 7+ (4): cooking_together, brunch_table, waking_up_couple, laundry_together
- Gece/public (3): rooftop_stars, taxi_ride, park_bench
- Outdoor/tatil (4): beach_sunset, picnic_blanket, hiking_peak, boat_ride
- Parti/kutlama (3): party_grind, new_year_kiss, anniversary_dance
- Spicy trust 9+ (3): shower_intimate, pool_hot_tub, balcony_night

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
