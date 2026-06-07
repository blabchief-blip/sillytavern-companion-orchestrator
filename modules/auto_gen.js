/**
 * Companion Orchestrator v0.5.2 - AutoGen Module
 *
 * Companion'ın kendi image generation pipeline'ı.
 * Kazuma'yı bypass eder, ComfyUI'a direkt prompt gönderir.
 *
 * Akış:
 * 1. ST chat'te MESSAGE_RECEIVED event'ini dinle
 * 2. Son AI mesajını parse et (action tags, location, mood)
 * 3. Companion state'lerini topla (avatar, mood, spice, scenario)
 * 4. ComfyUI'ya prompt gönder (6Lora-CyberReal workflow)
 * 5. Üretilen görseli ST chat'e inject et
 *
 * Dependencies: image_gen (workflow utilities), avatar_desc, mood, spice, scenarios
 */

// =====================================================================
// Action & Tag Extraction (Regex-based)
// =====================================================================
// SCENE_INTIMATE_PATTERNS (v0.6.3 — scene keyword → Pony/NSFW tag)
// Triggers on intimate body parts / actions in scene text
// Works WITHOUT LLM Tagger (regex fallback when LLM fails)
// =====================================================================
const SCENE_INTIMATE_PATTERNS = [
  // ===== Oral / Mouth =====
  { rx: /\b(kiss|kissing|kissed|kisses)\b/gi, tags: ['kiss', 'romantic', 'lips', 'love'] },
  { rx: /\b(french\s*kiss|deep\s*kiss|passionate\s*kiss)\b/gi, tags: ['french_kiss', 'deep_kiss', 'tongue_out', 'saliva'] },
  { rx: /\b(tongue\s+on|tongue\s+out|tongue\s+down)\b/gi, tags: ['tongue_out', 'licking', 'oral'] },
  { rx: /\b(suck|sucking|sucks)\s*(on|off)?/gi, tags: ['sucking', 'oral', 'mouth'] },
  { rx: /\b(blowjob|oral\s+sex|giving\s+head|deepthroat)\b/gi, tags: ['blowjob', 'oral', 'fellatio', 'deepthroat', 'penis', 'tongue_out'] },
  { rx: /\b(cunnilingus|eating\s+out)\b/gi, tags: ['cunnilingus', 'oral', 'pussy', 'tongue_out'] },

  // ===== Penetration / Sex =====
  { rx: /\b(penetrat\w+|fucking|fucks|fucked)\b/gi, tags: ['penetration', 'sex', 'penis', 'pussy', 'nsfw', 'intense'] },
  { rx: /\b(making\s+love|love\s+making)\b/gi, tags: ['sex', 'intimate', 'passionate', 'nsfw'] },
  { rx: /\b(screwing|boning|humping|grinding)\b/gi, tags: ['sex', 'thrusting', 'intense'] },
  { rx: /\b(inserting|sliding\s+in|pushing\s+in)\b/gi, tags: ['penetration', 'insertion'] },
  { rx: /\b(pounding|pummeling|driving\s+into)\b/gi, tags: ['thrusting', 'intense', 'fast'] },
  { rx: /\b(riding|bouncing\s+on|on\s+top)\b/gi, tags: ['riding', 'cowgirl_position', 'on_top', 'bouncing'] },
  { rx: /\b(cowgirl|sitting\s+on\s+(his|her|my))\b/gi, tags: ['cowgirl_position', 'straddling', 'on_top', 'riding'] },
  { rx: /\b(reverse\s+cowgirl)\b/gi, tags: ['reverse_cowgirl', 'straddling', 'riding'] },
  { rx: /\b(missionary)\b/gi, tags: ['missionary', 'lying_on_back', 'legs_up'] },
  { rx: /\b(doggystyle|from\s+behind|rear\s+entry)\b/gi, tags: ['doggystyle', 'from_behind', 'on_all_fours', 'kneeling'] },
  { rx: /\b(spooning|side\s+by\s+side)\b/gi, tags: ['spooning', 'lying_on_side', 'cuddling'] },
  { rx: /\b(against\s+the\s+wall|pinned|pressed\s+against\s+wall)\b/gi, tags: ['pinned_against_wall', 'standing', 'pressed_close'] },

  // ===== Anal =====
  { rx: /\b(anal|anus)\b/gi, tags: ['anal', 'anal_sex', 'nsfw'] },
  { rx: /\b(rimming|analingus)\b/gi, tags: ['anal', 'oral', 'rimming'] },

  // ===== Body parts (explicit) =====
  { rx: /\b(breasts?|boobs?|tits?|bust)\b/gi, tags: ['breast', 'large_breasts', 'cleavage'] },
  { rx: /\b(nipples?|areola)\b/gi, tags: ['nipple', 'areola', 'puffy_nipples', 'erect_nipples'] },
  { rx: /\b(vagina|pussy|clit|clitoris)\b/gi, tags: ['pussy', 'vaginal', 'nsfw'] },
  { rx: /\b(penis|cock|dick|phallus)\b/gi, tags: ['penis', 'nsfw'] },
  { rx: /\b(testicles|balls|scrotum)\b/gi, tags: ['testicles', 'penis', 'nsfw'] },
  { rx: /\b(butt|ass|rear|cheeks?)\b/gi, tags: ['ass', 'butt', 'naked'] },
  { rx: /\b(thighs?)\b/gi, tags: ['thighs', 'legs', 'smooth_legs'] },
  { rx: /\b(hips?|waist)\b/gi, tags: ['hips', 'curved_hips'] },
  { rx: /\b(back|spine)\b/gi, tags: ['back', 'arched_back'] },
  { rx: /\b(neck|throat)\b/gi, tags: ['neck', 'neck_kiss', 'bitemark_target'] },
  { rx: /\b(lips?|mouth)\b/gi, tags: ['lips', 'parted_lips', 'mouth'] },
  { rx: /\b(skin|flesh)\b/gi, tags: ['skin', 'smooth_skin', 'realistic_skin'] },

  // ===== Foreplay / Touching =====
  { rx: /\b(caress\w*|strok\w+|rubb\w+)\b/gi, tags: ['caressing', 'stroking', 'touching'] },
  { rx: /\b(grabb\w+|gripp\w+|squeez\w+)\s+(\w+\s+)?(ass|breast|thigh|hip|hair)/gi, tags: ['grabbing', 'hands_gripping'] },
  { rx: /\b(pull\w*\s+(\w+\s+)?hair)\b/gi, tags: ['hair_pull', 'dominant'] },
  { rx: /\b(undress\w*|strip\w*|taking\s+off|remov\w+\s+clothes)\b/gi, tags: ['undressing', 'stripping', 'nude', 'removing_clothes'] },
  { rx: /\b(unbutton\w*|unzip\w*|pull\w*\s+down)\b/gi, tags: ['undressing', 'clothing_removed', 'pulled_down'] },
  { rx: /\b(bite\s+(\w+\s+)?lip)\b/gi, tags: ['lip_bite', 'seductive'] },
  { rx: /\b(bite\s+(\w+\s+)?neck)\b/gi, tags: ['bitemark', 'hickey', 'love_bite', 'kiss_mark'] },
  { rx: /\b(suck\s+(\w+\s+)?(neck|collarbone|finger))\b/gi, tags: ['hickey', 'kiss_mark', 'love_bite'] },
  { rx: /\b(lick\w*|tast\w+)\b/gi, tags: ['licking', 'tongue', 'mouth'] },
  { rx: /\b(tease|teasing|tantaliz\w+)\b/gi, tags: ['teasing', 'flirtatious', 'seductive'] },
  { rx: /\b(moan\w*|groan\w*|whimper\w*|cry\s+out)\b/gi, tags: ['moaning', 'ahegao', 'pleasure', 'open_mouth'] },
  { rx: /\b(scream\w*|gasping\s+out)\b/gi, tags: ['screaming', 'orgasm', 'pleasure', 'ahegao'] },

  // ===== Climax / Orgasm =====
  { rx: /\b(orgasm|climax|coming|cum\w*)\b/gi, tags: ['orgasm', 'climax', 'pleasure', 'cum', 'ecstasy'] },
  { rx: /\b(creampie|cum\s+inside|fill\w+\s+me)\b/gi, tags: ['creampie', 'cum_inside', 'cum', 'pussy_juice'] },
  { rx: /\b(cumshot|ejaculat\w+|shooting\s+cum)\b/gi, tags: ['cumshot', 'ejaculation', 'cum'] },
  { rx: /\b(cum\s+on\s+(\w+\s+)?(face|breast|body|stomach|thigh))\b/gi, tags: ['cum_on_body', 'facial', 'cum_on_breasts'] },
  { rx: /\b(pleasure|ecstasy|bliss)\b/gi, tags: ['pleasure', 'ecstasy', 'orgasm'] },
  { rx: /\b(shudder\w*|trembl\w*|shiver\w*)\b/gi, tags: ['shivering', 'trembling', 'aroused'] },
  { rx: /\b(arch\w*\s+(\w+\s+)?back)\b/gi, tags: ['arched_back', 'curved_back', 'pleasure'] },

  // ===== Emotional / Foreplay =====
  { rx: /\b(desire|lust|passion|longing)\b/gi, tags: ['desire', 'lustful_gaze', 'passionate'] },
  { rx: /\b(arous\w+|turned\s+on|horny)\b/gi, tags: ['aroused', 'lust', 'penis_erection'] },
  { rx: /\b(breath\w*|gasping|panting)\b/gi, tags: ['heavy_breathing', 'parted_lips', 'breathless'] },
  { rx: /\b(whisper\w*\s+(\w+\s+)?(sweet|nothings|love))\b/gi, tags: ['whispering', 'intimate', 'romantic'] },
  { rx: /\b(embrace\w*|cuddle\w*|snuggl\w+)\b/gi, tags: ['cuddling', 'embrace', 'intimate'] },
  { rx: /\b(aftercare|holding\s+after|cuddle\s+after)\b/gi, tags: ['aftercare', 'cuddling', 'tender', 'loving'] },

  // ===== Dominance / Sub =====
  { rx: /\b(orders?|command\w*|tells?\s+me\s+to)\b/gi, tags: ['dominant', 'commanding', 'domination'] },
  { rx: /\b(obey|submissive|surrender\w*|submit\w*)\b/gi, tags: ['submissive', 'surrender', 'domination'] },
  { rx: /\b(blindfold\w*|tie\w*|bind\w*|restrain\w*|rope)\b/gi, tags: ['blindfold', 'bondage', 'bdsm', 'shibari'] },
  { rx: /\b(spank\w*|slap\w*|paddl\w*)\b/gi, tags: ['spanking', 'bdsm', 'domination'] },
  { rx: /\b(chok\w*|throat\s+(hold|grab)|breath\s+play)\b/gi, tags: ['choking', 'breath_play', 'domination'] },

  // ===== Public / Risk =====
  { rx: /\b(public\s+(sex|place)|outdoor|risky\s+place)\b/gi, tags: ['public_sex', 'exhibitionism', 'public'] },
  { rx: /\b(sneak\w*\s+(\w+\s+)?(away|together|quick))\b/gi, tags: ['sneaking', 'public', 'risky'] },
  { rx: /\b(secret\w*|hidden\s+place|closet|alley)\b/gi, tags: ['hidden', 'secret_place', 'sneaking'] },

  // ===== Group / Multi =====
  { rx: /\b(threesome|three\s+some|threeway|three-way)\b/gi, tags: ['threesome', 'group_sex', 'multiple_partners'] },
  { rx: /\b(group\s+sex|orgy|gang\s+bang)\b/gi, tags: ['orgy', 'group_sex', 'multiple_partners'] },
  { rx: /\b(double\s+penetration|DP)\b/gi, tags: ['double_penetration', 'group_sex'] },

  // ===== Türkçe sahne kelimeleri (v0.8.13) =====
  { rx: /\b(sikiyor|sikişiyor|sikiş|sikmek|sikti|sikildi)\b/gi, tags: ['sex', 'penetration', 'nsfw', 'intense'] },
  { rx: /\b(am[ıiını]*|amcığ?\w*|vajina)\b/gi, tags: ['pussy', 'vaginal', 'nsfw'] },
  { rx: /\b(yarr?ak\w*|penis|sik[i]?\b)\b/gi, tags: ['penis', 'nsfw'] },
  { rx: /\b(göt[üuü]*|popo|kıç)\b/gi, tags: ['ass', 'butt'] },
  { rx: /\b(anal\s+seks|götüne|götten)\b/gi, tags: ['anal', 'anal_sex', 'nsfw'] },
  { rx: /\b(oral\s+seks|yalıyor|yalatıyor|fellatio)\b/gi, tags: ['oral', 'blowjob', 'tongue_out'] },
  { rx: /\b(meme\w*|göğüs\w*|buze\w*)\b/gi, tags: ['breast', 'cleavage'] },
  { rx: /\b(meme\s+ucu\w*|nipple\w*)\b/gi, tags: ['nipple', 'areola'] },
  { rx: /\b(inleme|inliyor|inledi|ah\s+çekiyor)\b/gi, tags: ['moaning', 'pleasure', 'open_mouth'] },
  { rx: /\b(orgazm\w*|boşaldı|boşalmak|doruk)\b/gi, tags: ['orgasm', 'climax', 'pleasure', 'ecstasy'] },
  { rx: /\b(zevk\s+alıyor|zevkle|keyif\s+alıyor)\b/gi, tags: ['pleasure', 'aroused'] },
  { rx: /\b(soyunuyor|soyundu|kıyafetini\s+çıkarıyor)\b/gi, tags: ['undressing', 'stripping', 'nude'] },
  { rx: /\b(mastürbasyon|kendini\s+tatmin|parmağını\s+sokuyor)\b/gi, tags: ['masturbation', 'fingering', 'solo'] },
  { rx: /\b(bağlıyor|bağlandı|kısıtlıyor)\b/gi, tags: ['bondage', 'bdsm', 'restrained'] },
  { rx: /\b(dominant|ağa|efendi|hükmediy?or)\b/gi, tags: ['dominant', 'domination'] },
  { rx: /\b(itaatkar|boyun\s+eğiyor|teslim\s+oluyor)\b/gi, tags: ['submissive', 'surrender'] },
  { rx: /\b(üçlü|üç\s+kişi|grup\s+seks)\b/gi, tags: ['threesome', 'group_sex'] },
  { rx: /\b(kreampay|içine\s+boşal\w*)\b/gi, tags: ['creampie', 'cum_inside', 'cum'] },
];

// =====================================================================
// v0.8.15: Sahne tag'i → poz referans dosyası eşlemesi (ControlNet için)
// Anahtar = tag (SCENE_INTIMATE_PATTERNS / SPICE_POSE çıktılarıyla aynı),
// değer = pose-library/ altındaki dosya yolu. Öncelik sıralı: ilk eşleşen
// kazanır (explicit pozlar üstte, genel pozlar altta). Dosya yoksa atlanır.
// =====================================================================
const SCENE_POSE_REFS = [
  // ---- explicit (çift) ----
  { tags: ['missionary'],                      file: 'explicit/missionary.png' },
  { tags: ['cowgirl_position'],                file: 'explicit/cowgirl.png' },
  { tags: ['reverse_cowgirl', 'reverse_cowgirl_position'], file: 'explicit/reverse_cowgirl.png' },
  { tags: ['doggystyle', 'from_behind'],       file: 'explicit/doggystyle.png' },
  { tags: ['standing_doggy', 'bent_over', 'bent_over_table', 'standing_from_behind'], file: 'explicit/standing_doggy.png' },
  { tags: ['blowjob', 'fellatio', 'cunnilingus', 'oral'], file: 'explicit/oral.png' },
  { tags: ['sixty_nine', '69_position', 'mutual_oral'], file: 'explicit/sixty_nine.png' },
  { tags: ['prone_bone', 'prone', 'lying_face_down'], file: 'explicit/prone_bone.png' },
  { tags: ['spooning'],                        file: 'explicit/spooning.png' },
  { tags: ['anal', 'anal_sex'],                file: 'explicit/doggystyle.png' },
  // ---- couple (samimi, clothed veya yarı çıplak) ----
  { tags: ['straddling', 'on_lap', 'riding'],  file: 'couple/straddling.png' },
  { tags: ['pinned_against_wall', 'pressed_against'], file: 'couple/against_wall.png' },
  { tags: ['embrace', 'cuddling', 'neck_kiss'],file: 'couple/embrace.png' },
  { tags: ['french_kiss', 'kiss', 'kissing'],  file: 'couple/kiss.png' },
  { tags: ['lap_sit_legs_over', 'legs_over', 'couch_intimate'], file: 'couple/lap_sit_legs_over.png' },
  { tags: ['facing_window', 'window_scene', 'night_window'], file: 'couple/facing_window.png' },
  { tags: ['dining_table', 'table_pressed', 'dining_intimate'], file: 'couple/dining_table.png' },
  // ---- solo ----
  { tags: ['lying_on_back', 'legs_spread', 'spread_legs'], file: 'solo/lying.png' },
  { tags: ['arching_back', 'arching'],         file: 'solo/arching.png' },
  { tags: ['sitting', 'sitting_close'],        file: 'solo/sitting.png' },
  { tags: ['standing'],                        file: 'solo/standing.png' },
  { tags: ['over_the_shoulder', 'looking_back', 'rear_view_solo'], file: 'solo/over_the_shoulder.png' },
  { tags: ['bathroom_mirror', 'mirror_selfie_solo', 'mirror_selfie'], file: 'solo/bathroom_mirror.png' },
  // ---- clothed (public/office, non-sexual) ----
  { tags: ['flirting_office_desk', 'leaning_desk', 'office_pose'], file: 'clothed/flirting_office_desk.png' },
  { tags: ['flirting_elevator', 'elevator_pose'], file: 'clothed/flirting_elevator.png' },
  { tags: ['flirting_balcony', 'balcony_pose', 'night_balcony'], file: 'clothed/flirting_balcony.png' },

  // ---- v0.8.x Batch 2: oral variants ----
  { tags: ['facial', 'cum_on_face'], file: 'oral_variants/facial.png' },
  { tags: ['deepthroat', 'throat_fuck'], file: 'oral_variants/deepthroat.png' },
  { tags: ['cunnilingus_giver', 'eating_pussy'], file: 'oral_variants/cunnilingus_giver.png' },
  { tags: ['cunnilingus_receiver', 'receiving_cunnilingus'], file: 'oral_variants/cunnilingus_receiver.png' },
  // ---- combo ----
  { tags: ['anal_doggy', 'anal_from_behind'], file: 'combo/anal_doggy.png' },
  { tags: ['anal_cowgirl', 'anal_riding'], file: 'combo/anal_cowgirl.png' },
  // ---- couple (intimate variants) ----
  { tags: ['shower_together', 'shower_couple'], file: 'couple/shower_together.png' },
  { tags: ['bath_together', 'bathtub_couple'], file: 'couple/bath_together.png' },
  { tags: ['couch_makeout', 'couch_kiss', 'making_out'], file: 'couple/couch_makeout.png' },
  { tags: ['morning_under_covers', 'under_covers_couple', 'bedhead_couple'], file: 'couple/morning_under_covers.png' },
  // ---- solo (günlük hayat) ----
  { tags: ['selfie_couch', 'couch_selfie'], file: 'solo/selfie_couch.png' },
  { tags: ['squatting', 'deep_squat', 'fitness_squat'], file: 'solo/squatting.png' },
  { tags: ['stretching_yoga', 'yoga_pose', 'warrior_pose'], file: 'solo/stretching_yoga.png' },
  // ---- office ----
  { tags: ['presentation_pose', 'whiteboard_pose', 'presenting'], file: 'office/presentation_pose.png' },
  { tags: ['desk_working', 'working_at_desk', 'office_sitting'], file: 'office/desk_working.png' },
  { tags: ['water_cooler', 'water_cooler_chat'], file: 'office/water_cooler.png' },
  // ---- work ----
  { tags: ['laptop_cafe', 'cafe_working', 'remote_work'], file: 'work/laptop_cafe.png' },
  { tags: ['standing_desk', 'standing_work', 'high_desk'], file: 'work/standing_desk.png' },
  // ---- party ----
  { tags: ['club_dancing', 'dancing_club', 'club_pose'], file: 'party/club_dancing.png' },
  { tags: ['cocktail_bar', 'bar_sitting', 'bar_pose'], file: 'party/cocktail_bar.png' },
  { tags: ['balcony_smoking', 'party_balcony', 'night_balcony_solo'], file: 'party/balcony_smoking.png' },
  // ---- beach ----
  { tags: ['beach_walking', 'shore_walk', 'sundress_walk'], file: 'beach/beach_walking.png' },
  { tags: ['poolside', 'pool_chair', 'lounging_pool'], file: 'beach/poolside.png' },
  { tags: ['sunbathing', 'tanning', 'beach_laying'], file: 'beach/sunbathing.png' },
  // ---- home ----
  { tags: ['cooking', 'kitchen_cooking', 'home_cooking'], file: 'home/cooking.png' },
  { tags: ['reading_book', 'book_reading', 'couch_reading'], file: 'home/reading_book.png' },
  { tags: ['couch_tv', 'watching_tv', 'couch_sitting'], file: 'home/couch_tv.png' },
  // ---- public tease ----
  { tags: ['car_backseat', 'backseat_kiss', 'car_intimate'], file: 'public/car_backseat.png' },
  { tags: ['taxi_backseat', 'taxi_pose', 'cab_ride'], file: 'public/taxi_backseat.png' },

  // ---- v0.8.x Batch 3: couple 11 → 37 ----
  // romantik / samimi
  { tags: ['slow_dance', 'dancing_slow', 'romantic_dance'], file: 'couple/slow_dance.png' },
  { tags: ['forehead_kiss', 'forehead_kiss_couple', 'gentle_forehead_kiss'], file: 'couple/forehead_kiss.png' },
  { tags: ['carrying_bride', 'bridal_carry', 'carrying_couple'], file: 'couple/carrying_bride.png' },
  { tags: ['wedding_kiss', 'altar_kiss', 'wedding_pose'], file: 'couple/wedding_kiss.png' },
  { tags: ['first_meet', 'first_encounter', 'meeting_couple'], file: 'couple/first_meet.png' },
  // intimate / NSFW (trust 5+)
  { tags: ['standing_kiss_wall', 'wall_kiss', 'lifted_wall_kiss', 'pressed_wall_kiss'], file: 'couple/standing_kiss_wall.png' },
  { tags: ['lap_makeout', 'lap_kiss_couple', 'sitting_lap_makeout'], file: 'couple/lap_makeout.png' },
  { tags: ['bedside_intimate', 'bed_edge_intimate', 'sitting_bed_edge'], file: 'couple/bedside_intimate.png' },
  { tags: ['shower_washing', 'washing_hair', 'shower_wash_couple'], file: 'couple/shower_washing.png' },
  // morning / domestic (trust 7+)
  { tags: ['cooking_together', 'kitchen_couple', 'cooking_back_to_back'], file: 'couple/cooking_together.png' },
  { tags: ['brunch_table', 'brunch_couple', 'breakfast_couple'], file: 'couple/brunch_table.png' },
  { tags: ['waking_up_couple', 'waking_up_together', 'morning_couple_face_to_face'], file: 'couple/waking_up_couple.png' },
  { tags: ['laundry_together', 'laundry_play', 'laundry_couple'], file: 'couple/laundry_together.png' },
  // gece / public
  { tags: ['rooftop_stars', 'rooftop_couple', 'stargazing'], file: 'couple/rooftop_stars.png' },
  { tags: ['taxi_ride', 'taxi_couple', 'cab_ride_couple'], file: 'couple/taxi_ride.png' },
  { tags: ['park_bench', 'bench_couple', 'park_sunset'], file: 'couple/park_bench.png' },
  // outdoor / tatil
  { tags: ['beach_sunset', 'sunset_couple', 'beach_embrace'], file: 'couple/beach_sunset.png' },
  { tags: ['picnic_blanket', 'picnic_couple', 'grass_picnic'], file: 'couple/picnic_blanket.png' },
  { tags: ['hiking_peak', 'mountain_peak_couple', 'summit_couple'], file: 'couple/hiking_peak.png' },
  { tags: ['boat_ride', 'boat_couple', 'sailing_couple'], file: 'couple/boat_ride.png' },
  // parti / kutlama
  { tags: ['party_grind', 'club_dancing_couple', 'grind_dance'], file: 'couple/party_grind.png' },
  { tags: ['new_year_kiss', 'midnight_kiss', 'new_year_couple'], file: 'couple/new_year_kiss.png' },
  { tags: ['anniversary_dance', 'anniversary_couple', 'candle_dance'], file: 'couple/anniversary_dance.png' },
  // spicy (trust 9+)
  { tags: ['shower_intimate', 'shower_embrace', 'shower_steam_couple'], file: 'couple/shower_intimate.png' },
  { tags: ['pool_hot_tub', 'hot_tub_couple', 'pool_embrace'], file: 'couple/pool_hot_tub.png' },
  { tags: ['balcony_night', 'balcony_couple', 'city_lights_couple'], file: 'couple/balcony_night.png' },

  // ---- v0.8.x Batch 4: group (3-4+ kişilik, Group LoRA ile stabilize) ----
  // threesome (3 kişilik)
  { tags: ['threeway_mff', 'threesome_mff', 'mff_threesome'], file: 'group/threeway_mff.png' },
  { tags: ['threeway_fmf', 'threesome_fmf', 'fmf_threesome'], file: 'group/threeway_fmf.png' },
  { tags: ['double_penetration', 'dp', 'double_penetrate'], file: 'group/double_penetration.png' },
  { tags: ['threesome_oral', 'oral_threesome', 'triple_oral'], file: 'group/threesome_oral.png' },
  { tags: ['threesome_fmm_oral', 'fmm_double_blowjob', 'double_blowjob'], file: 'group/threesome_fmm_oral.png' },
  // orgy / gangbang (4+ kişilik)
  { tags: ['orgy_bbq', 'orgy_4p', 'foursome_bbq'], file: 'group/orgy_bbq.png' },
  { tags: ['orgy_fmmf', 'foursome', 'mmff_foursome'], file: 'group/orgy_fmmf.png' },
  { tags: ['gangbang', 'gang_bang', 'multiple_men'], file: 'group/gangbang.png' },
  { tags: ['group_intimate_kiss', 'group_kiss', 'mff_kiss'], file: 'group/group_intimate_kiss.png' },
];

const ACTION_PATTERNS = [
  // Hareket
  { rx: /\b(walks?|walking|strolls?|strolling)\s+(to|into|out|toward|away)/gi, tags: ['walking'] },
  { rx: /\b(walks?|walking)\s+(over|across|away)/gi, tags: ['walking'] },
  { rx: /\b(sits?|sitting)\s+(down|on|beside|next|at)/gi, tags: ['sitting'] },
  { rx: /\b(stands?|standing)\s+(up|near|by|beside|behind|in front)/gi, tags: ['standing'] },

// =====================================================================
// SCENE_INTIMATE_PATTERNS (v0.6.3 — scene keyword → Pony/NSFW tag)
// Triggers on intimate body parts / actions in scene text
// Works WITHOUT LLM Tagger (regex fallback when LLM fails)
// =====================================================================
  // Duruş
  { rx: /\b(arms? wrapped|wraps? arms?)\b/gi, tags: ['arms_wrapped'] },
  { rx: /\b(hand on|places? hand on)\b/gi, tags: ['hand_on'] },
  { rx: /\b(close|closer|near|beside|next to)\b/gi, tags: ['close'] },
];

// Mekan
const LOCATION_PATTERNS = [
  { rx: /\b(coffee\s*shop|cafe|café)\b/gi, tags: ['coffee_shop', 'indoor', 'cafe_interior'] },
  { rx: /\b(bedroom|bed\s+room|on the bed|on a bed)\b/gi, tags: ['bedroom', 'indoor', 'bed'] },
  { rx: /\b(bathroom|shower|bathtub|washing)\b/gi, tags: ['bathroom', 'indoor', 'wet'] },
  { rx: /\b(kitchen|cooking|cook)\b/gi, tags: ['kitchen', 'indoor'] },
  { rx: /\b(living\s*room|sofa|couch|on the couch)\b/gi, tags: ['living_room', 'indoor', 'couch'] },
  { rx: /\b(restaurant|dining|dinner)\b/gi, tags: ['restaurant', 'indoor'] },
  { rx: /\b(office|desk|working|computer|laptop)\b/gi, tags: ['office', 'indoor', 'desk'] },
  { rx: /\b(classroom|school|university|college)\b/gi, tags: ['classroom', 'indoor'] },
  { rx: /\b(outside|outdoor|garden|park|street|beach|forest|rooftop|balcony)\b/gi, tags: ['outdoors'] },
  { rx: /\b(pool|swimming\s*pool|infinity\s*pool)\b/gi, tags: ['swimming_pool', 'water', 'wet'] },
  { rx: /\b(bar|pub|nightclub|club)\b/gi, tags: ['bar', 'indoor', 'neon'] },
  { rx: /\b(city\s*lights?|cityscape|skyline)\b/gi, tags: ['city_lights', 'night', 'urban'] },
  { rx: /\b(terrace|patio)\b/gi, tags: ['terrace', 'outdoor'] },
];

// Zaman / ışık
const TIME_PATTERNS = [
  { rx: /\b(morning|sunrise|dawn|breakfast)\b/gi, tags: ['morning_light', 'sunlight', 'soft_lighting'] },
  { rx: /\b(evening|sunset|dusk|golden\s*hour)\b/gi, tags: ['evening_light', 'golden_hour', 'warm_lighting'] },
  { rx: /\b(night|midnight|moonlight|starry)\b/gi, tags: ['night', 'moonlight', 'dark'] },
  { rx: /\b(afternoon)\b/gi, tags: ['afternoon_light', 'natural_lighting'] },
];

// Kıyafet
const CLOTHING_PATTERNS = [
  { rx: /\b(cheerleading\s*uniform|cheerleader)\b/gi, tags: ['cheerleader_uniform'] },
  { rx: /\b(school\s*uniform|school\s*girl)\b/gi, tags: ['school_uniform', 'sailor_collar'] },
  { rx: /\b(bikini|swimsuit)\b/gi, tags: ['bikini', 'swimsuit'] },
  { rx: /\b(dress|evening\s*dress|skirt)\b/gi, tags: ['dress', 'skirt'] },
  { rx: /\b(pajamas|pjs|nightgown|sleepwear)\b/gi, tags: ['pajamas', 'nightgown'] },
  { rx: /\b(lingerie|bra|panties|underwear)\b/gi, tags: ['lingerie'] },
  { rx: /\b(shirt|blouse|top)\b/gi, tags: ['shirt', 'top'] },
];

// Kullanıcı aksiyonları (kullanıcının yaptığı şey)
const USER_ACTION_PATTERNS = [
  { rx: /\b(kisses?|kissing)\s+her\b/gi, tags: ['kiss', 'intimate'] },
  { rx: /\b(hugs?|hugging)\s+her\b/gi, tags: ['hug', 'intimate'] },
  { rx: /\b(touches?|touching)\s+her\b/gi, tags: ['touching_her', 'intimate'] },
  { rx: /\b(grabs?|grabbing)\s+her\b/gi, tags: ['grabbing', 'intimate'] },
  { rx: /\b(pulls?\s+her\s+close)\b/gi, tags: ['pulling_close', 'intimate'] },
  { rx: /\b(reach(es|ing)?\s+for|reaches\s+across)\b/gi, tags: ['reaching'] },
  { rx: /\b(takes?\s+her\s+hand|holding\s+her\s+hand|takes?\s+my\s+hand)\b/gi, tags: ['handholding', 'tender'] },
  { rx: /\b(squeezes?\s+(my|her)\s+hand)\b/gi, tags: ['handholding', 'tender'] },
];

// =====================================================================
// Spice / Heat → Lighting & Atmosphere mapping
// =====================================================================

// Spice-aware lighting & mood mapping (v0.6.1 — extended)
// Level 0: vanilla/peaceful, 1: romantic, 2: flirtatious, 3: sensual, 4: explicit
const SPICE_LIGHTING = {
  0: ['soft_daylight', 'peaceful', 'calm', 'natural_lighting', 'bright'],
  1: ['warm_lighting', 'romantic', 'tender', 'golden_hour', 'soft_focus'],
  2: ['candlelit', 'intimate', 'sensual', 'soft_glow', 'warm_skin_tone'],
  3: ['dim_lighting', 'moody', 'provocative', 'shadowed', 'single_light_source', 'skin_shine', 'sweat'],
  4: ['dramatic_lighting', 'candlelit', 'passionate', 'low_key', 'rim_lighting', 'skin_highlight'],
};

const SPICE_MOOD = {
  0: ['calm', 'relaxed', 'happy', 'content'],
  1: ['affectionate', 'tender', 'loving', 'warm_smile'],
  2: ['flirtatious', 'seductive', 'teasing', 'coy', 'smirk', 'bedroom_eyes'],
  3: ['aroused', 'breathless', 'flushed', 'lip_bite', 'heavy_breathing', 'pupils_dilated', 'parted_lips'],
  4: ['intimate', 'passionate', 'overwhelmed', 'ecstasy', 'surrender', 'desire', 'lustful_gaze'],
};

// Pose/position tags per spice level (v0.6.1 — physical proximity)
const SPICE_POSE = {
  0: [], // vanilla — no specific pose
  1: ['sitting_close', 'face_to_face', 'eye_contact', 'gentle_touch'],
  2: ['leaning_close', 'hand_on_face', 'forehead_touch', 'neck_kiss', 'lips_at_ear'],
  3: ['straddling', 'on_lap', 'pinned_against_wall', 'hands_in_hair', 'pressed_against', 'breath_visible', 'bare_shoulders'],
  // v0.8.12: açık pozlar — yatay, bacaklar açık, hassas bölge görünür
  4: ['lying_on_back', 'legs_spread', 'spread_legs', 'arching_back', 'exposed', 'intimate_position', 'close_up'],
};

// Clothing default per spice (v0.6.1 — controls what's worn)
const SPICE_CLOTHING = {
  0: ['normal_clothes'],
  1: ['casual_clothes', 'loose_fit'],
  2: ['revealing_clothes', 'cleavage', 'tight_clothes'],
  3: ['lingerie', 'underwear', 'partially_undressed', 'see_through', 'open_shirt'],
  // v0.8.12: Pony-optimised explicit tags — model tamamen açık içerik üretir
  4: ['nude', 'nudity', 'nsfw', 'nipples', 'pussy', 'explicit', 'fully_undressed', 'no_clothes'],
};

// Body language per spice (v0.6.1)
const SPICE_BODY_LANG = {
  0: ['relaxed_pose', 'natural_posture'],
  1: ['soft_smile', 'gentle_lean', 'hand_holding', 'head_tilt'],
  2: ['hair_flip', 'lip_bite', 'side_glance', 'touched_neck', 'playing_with_hair'],
  3: ['pulled_close', 'against_body', 'hands_gripping', 'trembling', 'wet_lips'],
  // v0.8.12: Pony explicit body language — gerçekçi açık ifadeler
  4: ['arching', 'writhing', 'head_back', 'moaning', 'gripping_sheets', 'pleasure_expression', 'flushed_face', 'wet'],
};

// Mood preset → emotion tags
const MOOD_TAGS = {
  neutral: ['neutral_expression'],
  happy: ['happy', 'smiling', 'joyful'],
  sad: ['sad', 'frowning', 'teary_eyes'],
  flirty: ['flirtatious', 'seductive', 'smirk'],
  playful: ['playful', 'cheeky', 'grin'],
  angry: ['angry', 'frowning', 'pout'],
  anxious: ['anxious', 'worried', 'nervous_smile'],
  shy: ['shy', 'blushing', 'looking_away'],
  confident: ['confident', 'smirk', 'pout'],
  tired: ['tired', 'sleepy', 'half_closed_eyes'],
  excited: ['excited', 'wide_smile', 'sparkling_eyes'],
  calm: ['calm', 'serene', 'peaceful'],
};

// =====================================================================
// Module class
// =====================================================================

class AutoGen {
  constructor() {
    this.name = 'auto_gen';
    this.displayName = '🎬 Otomatik Üretici';
    this.description = 'AI mesajı geldiğinde context-aware görsel üretir (Kazuma\'yı bypass)';
    this.toggleKey = 'autoGenEnabled';
    this.enabled = false;
    this._unsub = null;
  }

  // -----------------------------------------------------------
  // init
  // -----------------------------------------------------------
  init(orch) {
    // orch index.js'den gelen parametre — orchestrator instance
    this.orch = orch;
    // ctx'yi orch'tan al (orchestrator instance'ında saveSettingsDebounced vs yok)
    // Lazy olarak SillyTavern.getContext() kullanacağız her seferinde
    this._getCtx = () => {
      if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
        return SillyTavern.getContext();
      }
      return null;
    };
    this.ctx = this._getCtx();

    // v0.7.0: Migration — mevcut settings'e yeni alanları merge et
    // (Eski versionlarda kayıtlı settings'e microsleepMs ekle)
    if (orch.settings.auto_gen) {
      if (orch.settings.auto_gen.microsleepMs === undefined) {
        orch.settings.auto_gen.microsleepMs = 100;
      }
    }

    // Settings init
    if (!orch.settings.auto_gen) {
      orch.settings.auto_gen = {
        enabled: false,                       // master toggle
        trigger: 'ai',                        // 'ai' | 'user' | 'both' | 'manual'
        throttleMs: 8000,                     // min ms between gens
        microsleepMs: 100,                    // v0.7.0: wait for other render listeners (Magic Translation)
        lastGenTs: 0,
        comfyuiUrl: orch.settings.image_gen?.comfyuiUrl || 'http://192.168.68.66:8001',
        workflowFile: '6Lora-CyberReal.json', // file adı string olmalı!
        // v0.8.13: 3 seviyeli dinamik LoRA stack — spice'a göre otomatik seçilir
        // SFW (spice 0-2): realism/aydınlatma odaklı
        // Pony realism stack (realismByStableYogi_ponyV65 checkpoint'e uyumlu)
        lorasSfw: [
          'AmateurStyle_v1_PONY_REALISM.safetensors',
          'Breast Slider - Pony_alpha1.0_rank4_noxattn_last.safetensors',
          'Body Type_alpha1.0_rank4_noxattn_last.safetensors',
          'Realism Lora By Stable Yogi_V3_Lite.safetensors',
        ],
        lorasSwfWts: [0.4, 1.5, 0.5, 1.0],
        lorasNsfw: [
          'AmateurStyle_v1_PONY_REALISM.safetensors',
          'Breast Slider - Pony_alpha1.0_rank4_noxattn_last.safetensors',
          'Body Type_alpha1.0_rank4_noxattn_last.safetensors',
          'Realism Lora By Stable Yogi_V3_Lite.safetensors',
        ],
        lorasNsfwWts: [0.4, 1.5, 0.5, 1.0],
        lorasExplicit: [
          'AmateurStyle_v1_PONY_REALISM.safetensors',
          'Breast Slider - Pony_alpha1.0_rank4_noxattn_last.safetensors',
          'Body Type_alpha1.0_rank4_noxattn_last.safetensors',
          'Realism Lora By Stable Yogi_V3_Lite.safetensors',
        ],
        lorasExplicitWts: [0.4, 1.5, 0.5, 1.0],
        loras: ['AmateurStyle_v1_PONY_REALISM.safetensors', 'Breast Slider - Pony_alpha1.0_rank4_noxattn_last.safetensors', 'Body Type_alpha1.0_rank4_noxattn_last.safetensors', 'Realism Lora By Stable Yogi_V3_Lite.safetensors'],
        lorawts: [0.4, 1.5, 0.5, 1.0],
        // v0.8.13: sansür + anatomik hata negatifleri
        negativeOverride: 'lowres, bad anatomy, bad hands, blurry, watermark, text, censored, mosaic, blur, covered, clothed, clothes, underwear, bad_pussy, malformed_genitals, fused_genitalia, extra_limbs, missing_limbs, mutation, deformed',
        width: 832,
        height: 1216,
        steps: 28,
        cfg: 6,
        sampler: 'euler_ancestral',
        scheduler: 'karras',
        model: 'realismByStableYogi_ponyV65.safetensors',
        // v0.8.13: Pony scoring sistemi — cyberrealisticPony bu tag'lere tepki verir
        prefix: 'score_9, score_8_up, score_7_up, rating_explicit, masterpiece, best quality, highly detailed, photorealistic',
        qualityTags: [
          'score_9', 'score_8_up', 'score_7_up', 'rating_explicit',
          'masterpiece', 'best quality', 'highly detailed',
          'photorealistic', 'sharp focus', 'cinematic lighting',
        ],
        useAvatar: true,
        useFaceId: true,         // v0.8.11: ReActor face-swap (FaceID'den geçildi — daha gerçekçi)
        useFaceMode: 'auto',     // v0.8.31: 'auto' | 'reactor' | 'faceid' | 'none' — sahne tipine göre otomatik
                                 //   auto: 1 kişi → reactor, 2+ kişi → faceid (önerilen)
                                 //   reactor: her zaman ReActor (eski davranış, multi-face bozabilir)
                                 //   faceid: her zaman FaceID IP-Adapter (yavaş ama tutarlı)
                                 //   none: yüz koruması yok, sadece prompt
        faceIdWeight: 0.85,      // v0.8.31: FaceID ağırlığı (group'ta 0.5-0.7 önerilir)
        faceIdWeightGroup: 0.5,  // v0.8.31: group/explicit sahnelerde düşük weight (kimlik zayıf ama temiz)
        useMood: true,
        useSpice: true,
        useScenario: true,
        usePosePresets: true,    // v0.6.1: built-in pose presets (B senaryosu)
        useCustomTags: true,     // v0.6.1: custom tag presets (E senaryosu)
        useSceneIntimate: true,  // v0.6.3: scene text → NSFW tag extraction (regex fallback when LLM fails)
        explicitMode: true,      // v0.8.12: varsayılan açık — spice 4 (explicit) bloklanmıyor
        maxAllowedSpice: 4,      // v0.8.12: tam explicit içeriğe izin ver
        // v0.8.15: ControlNet poz kontrolü — sahne tipine göre poz referansı
        // ComfyUI'ya yüklenip conditioning'e ControlNet uygulanır. Poz kütüphanesi
        // (pose-library/) boşsa veya eşleşme yoksa sessizce atlanır (graceful).
        useControlNet: true,     // v0.8.15: poz kütüphanesi dolu (13 referans bootstrap edildi)
        controlNetModel: 'control-lora-depth-rank256.safetensors', // SDXL-uyumlu (openpose SD1.5 olduğu için depth)
        controlNetStrength: 0.55,
        controlNetStartPercent: 0.0,
        controlNetEndPercent: 0.7, // sonlara doğru bırak — yüz/detay serbest kalsın
        history: [],
        debug: false,
        injectToChat: true,
      };
    }

    this.settings = orch.settings.auto_gen;

    // v0.8.12–v0.8.13: NSFW migration — eski kurulumları güncelle
    {
      const s = this.settings;
      // v0.8.32: Pony realism stack — realismByStableYogi_ponyV65 checkpoint'e uyumlu
      const PONY_LORAS = [
        'AmateurStyle_v1_PONY_REALISM.safetensors',
        'Breast Slider - Pony_alpha1.0_rank4_noxattn_last.safetensors',
        'Body Type_alpha1.0_rank4_noxattn_last.safetensors',
        'Realism Lora By Stable Yogi_V3_Lite.safetensors',
      ];
      const PONY_WTS = [0.4, 1.5, 0.5, 1.0];
      // Eski non-Pony LoRA stack'lerini Pony ile değiştir (cyberrealisticPony → realismByStableYogi)
      const OLD_LORAS = ['RealSkin_xxXL_v1.safetensors', 'ZITnsfwLoRAv2.safetensors', 'incase_style_v3-1_ponyxl_ilff.safetensors',
                         'Realism_Engine_Klein_V2.safetensors', 'add-detail-xl.safetensors', 'Mystic-XXX-ZIT-V7.safetensors'];
      const needsMigration = (arr) => Array.isArray(arr) && arr.some(l => OLD_LORAS.includes(l));
      if (needsMigration(s.loras))        { s.loras = PONY_LORAS; s.lorawts = PONY_WTS; }
      if (needsMigration(s.lorasSfw))     { s.lorasSfw = PONY_LORAS; s.lorasSwfWts = PONY_WTS; }
      if (needsMigration(s.lorasNsfw))    { s.lorasNsfw = PONY_LORAS; s.lorasNsfwWts = PONY_WTS; }
      if (needsMigration(s.lorasExplicit)){ s.lorasExplicit = PONY_LORAS; s.lorasExplicitWts = PONY_WTS; }
      if (!s.lorasSfw)      { s.lorasSfw = PONY_LORAS; s.lorasSwfWts = PONY_WTS; }
      if (!s.lorasNsfw)     { s.lorasNsfw = PONY_LORAS; s.lorasNsfwWts = PONY_WTS; }
      if (!s.lorasExplicit) { s.lorasExplicit = PONY_LORAS; s.lorasExplicitWts = PONY_WTS; }
      // Checkpoint migration: cyberrealisticPony → realismByStableYogi
      if (!s.model || s.model === 'cyberrealisticPony_v170.safetensors') {
        s.model = 'realismByStableYogi_ponyV65.safetensors';
      }
      // Prefix: Pony scoring tag'leri ekle
      if (s.prefix && !s.prefix.includes('score_9')) {
        s.prefix = 'score_9, score_8_up, score_7_up, rating_explicit, ' + s.prefix;
      }
      if (Array.isArray(s.qualityTags) && !s.qualityTags.includes('score_9')) {
        s.qualityTags.unshift('score_9', 'score_8_up', 'score_7_up', 'rating_explicit');
      }
      // explicitMode + maxAllowedSpice guard'ları kaldır
      if (s.explicitMode === false) { s.explicitMode = true; }
      if (s.maxAllowedSpice < 4) { s.maxAllowedSpice = 4; }
      // CFG / steps yükselt
      if (s.cfg < 6) { s.cfg = 6; }
      if (s.steps < 28) { s.steps = 28; }
      // v0.8.14: DHCP ile ComfyUI .66→.67'ye taşındı; eski kayıtlı URL'i göç ettir
      // v0.8.22: ComfyUI kalıcı olarak .66'da (statik IP). Yanlışlıkla .67'ye
      // göç etmiş kurulumları geri .66'ya çevir.
      if (s.comfyuiUrl === 'http://192.168.68.67:8001') {
        s.comfyuiUrl = 'http://192.168.68.66:8001';
        console.log('[Companion AutoGen] v0.8.22 migration: ComfyUI URL .67→.66');
      }
      // v0.8.15: ControlNet poz ayarları (eski kurulumda yoksa ekle)
      if (s.useControlNet === undefined) s.useControlNet = true;
      // v0.8.31: Face mode ayarları (eski kurulumda yoksa ekle)
      if (s.useFaceMode === undefined) s.useFaceMode = 'auto';
      if (s.faceIdWeight === undefined) s.faceIdWeight = 0.85;
      if (s.faceIdWeightGroup === undefined) s.faceIdWeightGroup = 0.5;
      if (!s.controlNetModel) s.controlNetModel = 'control-lora-depth-rank256.safetensors';
      if (s.controlNetStrength === undefined) s.controlNetStrength = 0.55;
      if (s.controlNetStartPercent === undefined) s.controlNetStartPercent = 0.0;
      if (s.controlNetEndPercent === undefined) s.controlNetEndPercent = 0.7;
      // Negatif prompt: sansür + anatomik hata
      if (s.negativeOverride && !s.negativeOverride.includes('censored')) {
        s.negativeOverride += ', censored, mosaic, blur, covered, clothed, clothes, underwear';
      }
      if (s.negativeOverride && !s.negativeOverride.includes('bad_pussy')) {
        s.negativeOverride += ', bad_pussy, malformed_genitals, fused_genitalia, extra_limbs, missing_limbs, mutation, deformed';
      }
    }

    // Hook MESSAGE_RECEIVED (eğer enabled)
    if (this.settings.enabled) {
      this._subscribe();
      // Kazuma auto-gen ile çakışmayı önle: biz açıkken Kazuma kapalı olmalı
      setTimeout(() => this._setKazumaAutoGen(false), 2000); // ST hazır olana kadar bekle
    }

    console.log('[Companion AutoGen] Initialized v' + (orch.VERSION || '?'), this.settings.enabled ? '(ENABLED)' : '(disabled)');
  }

  // -----------------------------------------------------------
  // Subscribe / Unsubscribe to MESSAGE_RECEIVED
  // -----------------------------------------------------------
  _subscribe(retryCount = 0) {
    if (this._unsub) return;
    const ctx = this._getCtx();
    if (!ctx?.eventSource || !ctx?.eventTypes) {
      if (retryCount < 10) {
        // ST henüz hazır değil — 500ms sonra tekrar dene (max 5s)
        setTimeout(() => this._subscribe(retryCount + 1), 500);
        if (retryCount === 0) console.warn('[Companion AutoGen] eventSource hazır değil, retry bekleniyor...');
      } else {
        console.error('[Companion AutoGen] eventSource 5s içinde hazır olmadı, subscription başarısız.');
      }
      return;
    }
    const et = ctx.eventTypes;
    // CHARACTER_MESSAGE_RENDERED: render tamamlandıktan SONRA tetiklenir
    const eventName = et.CHARACTER_MESSAGE_RENDERED || et.MESSAGE_RECEIVED;

    const handler = async (data) => {
      if (!this.settings.enabled) return;
      await this._onMessageReceived(data);
    };

    ctx.eventSource.on(eventName, handler);
    this._unsub = () => ctx.eventSource.removeListener(eventName, handler);
    console.log(`[Companion AutoGen] ✅ Subscribed to ${eventName} (retry ${retryCount})`);
  }

  _unsubscribe() {
    if (this._unsub) {
      this._unsub();
      this._unsub = null;
    }
  }

  // -----------------------------------------------------------
  // Kazuma çakışma yönetimi: auto_gen açıkken Kazuma'nın kendi
  // auto-generate'ini kapat (ikisi aynı anda ComfyUI'a üretim
  // gönderirse kuyruk taşıyor, "Failed to fetch" oluyor).
  // -----------------------------------------------------------
  _setKazumaAutoGen(enabled) {
    try {
      const ctx = this._getCtx();
      const kazuma = ctx?.extensionSettings?.['Image-gen-kazuma'];
      if (!kazuma) return;
      if (!enabled) {
        // Mevcut değeri yedekle, sadece true ise (yoksa gereksiz müdahale)
        if (kazuma.autoGenEnabled) {
          kazuma._autoGenBackup = true;
          kazuma.autoGenEnabled = false;
          // Kazuma UI checkbox'ını da güncelle
          if (typeof $ !== 'undefined') $('#kazuma_auto_enable').prop('checked', false);
          ctx.saveSettingsDebounced?.();
          console.log('[AutoGen] Kazuma autoGenEnabled kapatıldı (çakışma önleme)');
        }
      } else {
        // Yedeklenen değeri geri yükle
        if (kazuma._autoGenBackup) {
          kazuma.autoGenEnabled = true;
          delete kazuma._autoGenBackup;
          if (typeof $ !== 'undefined') $('#kazuma_auto_enable').prop('checked', true);
          ctx.saveSettingsDebounced?.();
          console.log('[AutoGen] Kazuma autoGenEnabled geri açıldı');
        }
      }
    } catch (e) {
      console.warn('[AutoGen] Kazuma auto-gen koordinasyonu başarısız:', e.message);
    }
  }

  setEnabled(enabled) {
    this.settings.enabled = enabled;
    if (enabled) {
      this._subscribe();
      this._setKazumaAutoGen(false); // Kazuma'yı kapat — çakışma önle
      this.toast('🎬 Otomatik üretici AÇIK (Kazuma auto-gen durduruldu)', 'success');
    } else {
      this._unsubscribe();
      this._setKazumaAutoGen(true); // Kazuma'yı geri aç
      this.toast('🎬 Otomatik üretici KAPALI', 'info');
    }
  }

  // -----------------------------------------------------------
  // Trigger
  // -----------------------------------------------------------
  async _onMessageReceived(data) {
    // Throttle check
    const now = Date.now();
    if (now - this.settings.lastGenTs < this.settings.throttleMs) {
      console.log('[Companion AutoGen] Throttled, skipping');
      return;
    }

    // v0.7.0: Mikrosleep — Magic Translation gibi async listener'lar render'ı bitirsin
    // MESSAGE_RENDERED event'i zaten render sonrası tetikleniyor ama Magic Translation
    // updateMessageBlock + ReasoningHandler hâlâ async DOM update yapabilir
    // 100ms = pratik olarak yeterli (test ederek ayarlanabilir)
    if (this.settings.microsleepMs && this.settings.microsleepMs > 0) {
      await new Promise(r => setTimeout(r, this.settings.microsleepMs));
    }

    // CHARACTER_MESSAGE_RENDERED / MESSAGE_RECEIVED event'i (messageId: number, type) gönderiyor.
    // data = number (mesaj index) → chat array'den çek.
    const ctx2 = this._getCtx();
    let chatMessage;
    if (typeof data === 'number') {
      chatMessage = ctx2?.chat?.[data] || null;
    } else {
      // Fallback: eski object format veya debug emit
      chatMessage = data?.message || data || null;
    }
    if (!chatMessage) {
      // Son AI mesajını fallback olarak kullan
      const chat = ctx2?.chat || [];
      for (let i = chat.length - 1; i >= 0; i--) {
        if (!chat[i].is_user && chat[i].mes) { chatMessage = chat[i]; break; }
      }
    }
    const isAi = chatMessage && !chatMessage.is_user && chatMessage.mes;
    if (this.settings.trigger === 'ai' && !isAi) return;
    if (this.settings.trigger === 'user' && chatMessage?.is_user) return;

    const lastMsg = chatMessage;
    if (!lastMsg || lastMsg.is_user) return;

    console.log('[Companion AutoGen] 🎬 Trigger fired, generating for:', (lastMsg.mes || '').slice(0, 50));
    await this.generate(lastMsg);
  }

  // -----------------------------------------------------------
  // Main generation
  // -----------------------------------------------------------
  async generate(lastAiMessage) {
    try {
      this.settings.lastGenTs = Date.now();

      // 1) Get LLM tags (if LLM Tagger available + enabled)
      let llmTags = null;
      let llmMeta = null;
      if (this.orch?.modules) {
        const llmMod = this.orch.modules.find(m => m.name === 'llm_tagger');
        if (llmMod?.settings?.enabled && llmMod?.settings?.apiKey) {
          try {
            const check = llmMod.canCall();
            if (check.ok) {
              const companionState = {
                mood: this._getCurrentMood(),
                spice: this._getCurrentSpice(),
                tags: this._getSpiceTags().slice(0, 5),
              };
              llmMeta = await llmMod.extract(lastAiMessage.mes || '', companionState);
              llmTags = llmMeta.tags;
              if (this.settings.debug) {
                console.log('[Companion AutoGen] 🧠 LLM extracted', llmTags.length, 'tags in', llmMeta.latency, 'ms');
              }
            } else {
              if (this.settings.debug) {
                console.log('[Companion AutoGen] LLM Tagger skipped:', check.reason);
              }
            }
          } catch (e) {
            console.warn('[Companion AutoGen] LLM Tagger failed, using regex fallback:', e.message);
          }
        }
      }

      // 2) Build prompt from message + Companion state (+ LLM tags if available)
      const prompt = this.buildPrompt(lastAiMessage, llmTags);
      if (this.settings.debug) {
        console.log('[Companion AutoGen] Prompt:', prompt);
      }

      // 2) Apply workflow overrides
      // v0.8.15: ControlNet poz seçimi için sahne tag'lerini topla
      // (LLM tag'leri + mesaj metninden regex + spice poz tag'leri).
      let sceneTags = [];
      try {
        const msgText = lastAiMessage.mes || lastAiMessage.message || '';
        sceneTags = [
          ...(Array.isArray(llmTags) ? llmTags : []),
          ...this._extractSceneIntimateTags(msgText),
          ...this._getSpiceTags(),
        ];
      } catch (_) { sceneTags = []; }
      const workflow = await this.loadAndOverrideWorkflow(prompt, sceneTags);
      if (!workflow) {
        console.warn('[Companion AutoGen] No workflow available, aborting');
        return;
      }

      // 3) Send to ComfyUI
      const promptId = await this.sendToComfy(workflow);
      if (!promptId) return;

      // 4) Wait for completion
      const filename = await this.waitForCompletion(promptId);
      if (!filename) return;

      // 5) Inject to chat — lastAiMessage'ın kendisine inject et
      if (this.settings.injectToChat) {
        await this.injectToChat(filename, prompt, lastAiMessage);
      }

      // 6) Save history
      this._saveHistory({
        promptId,
        filename,
        prompt,
        timestamp: Date.now(),
      });

      this.toast(`🎨 Görsel üretildi: ${filename}`, 'success');
    } catch (err) {
      console.error('[Companion AutoGen] Generation failed:', err);
      this.toast(`❌ Üretim hatası: ${err.message}`, 'error');
    }
  }

  // -----------------------------------------------------------
  // Prompt Builder (context-aware)
  // -----------------------------------------------------------
  buildPrompt(message, llmTags = null) {
    const text = (message.mes || message.message || '').replace(/<[^>]+>/g, ' ').trim();
    if (!text) return this.settings.prefix;

    // Extract action tags
    const tags = new Set();

    // Quality prefix
    this.settings.qualityTags.forEach(t => tags.add(t));

    // LLM tags (priority context — if provided)
    if (llmTags && llmTags.length > 0) {
      llmTags.forEach(t => tags.add(t));
    }

    // Avatar description
    if (this.settings.useAvatar) {
      const avatarTags = this._getAvatarTags();
      avatarTags.forEach(t => tags.add(t));
    }

    // Mood
    if (this.settings.useMood) {
      const moodTags = this._getMoodTags();
      moodTags.forEach(t => tags.add(t));
    }

    // Spice → lighting
    if (this.settings.useSpice) {
      const spiceTags = this._getSpiceTags();
      spiceTags.forEach(t => tags.add(t));
    }

    // v0.6.3: SCENE-INTIMATE patterns (sahne metnindeki gerçek aksiyon/beden kelimeleri)
    // LLM Tagger fail olduğunda bile doğru tag'ler üretir
    if (this.settings.useSceneIntimate !== false) {
      const sceneTags = this._extractSceneIntimateTags(text);
      sceneTags.forEach(t => tags.add(t));
      if (this.settings.debug && sceneTags.length) {
        console.log('[Companion AutoGen] 🔥 Scene intimate tags:', sceneTags);
      }
    }

    // Scenario
    if (this.settings.useScenario) {
      const scenarioTags = this._getScenarioTags();
      scenarioTags.forEach(t => tags.add(t));
    }

    // Pose presets (v0.6.1 — B senaryosu)
    if (this.settings.usePosePresets) {
      const poseMod = this.orch?.modules?.find(m => m.name === 'pose_presets');
      if (poseMod?.settings?.enabled) {
        // Aktif pozisyon varsa ekle, yoksa hiçbir şey yapma
        const activePose = poseMod.settings?.activePose;
        if (activePose) {
          const poseTags = poseMod.getPoseTags(activePose);
          poseTags.forEach(t => tags.add(t));
          if (this.settings.debug) {
            console.log('[Companion AutoGen] 🎭 Applied pose preset:', activePose, '(', poseTags.length, 'tags)');
          }
        }
      }
    }

    // Custom tag presets (v0.6.1 — E senaryosu)
    if (this.settings.useCustomTags) {
      const customMod = this.orch?.modules?.find(m => m.name === 'custom_tags');
      if (customMod?.settings?.enabled) {
        // Aktif custom preset'ler
        const activeCustom = customMod.settings?.activePresets || [];
        const currentSpice = this._getCurrentSpice();
        for (const presetKey of activeCustom) {
          const customTags = customMod.apply(presetKey, [], currentSpice);
          customTags.forEach(t => tags.add(t));
        }
        if (this.settings.debug && activeCustom.length) {
          console.log('[Companion AutoGen] 🏷️ Applied custom presets:', activeCustom);
        }
      }
    }

    // Action patterns
    for (const pattern of ACTION_PATTERNS) {
      pattern.rx.lastIndex = 0; // reset global regex state
      if (pattern.rx.test(text)) {
        pattern.tags.forEach(t => tags.add(t));
      }
    }

    // User actions (kisses her, hugs her)
    for (const pattern of USER_ACTION_PATTERNS) {
      pattern.rx.lastIndex = 0;
      if (pattern.rx.test(text)) {
        pattern.tags.forEach(t => tags.add(t));
      }
    }

    // Location
    for (const pattern of LOCATION_PATTERNS) {
      pattern.rx.lastIndex = 0;
      if (pattern.rx.test(text)) {
        pattern.tags.forEach(t => tags.add(t));
      }
    }

    // Time
    for (const pattern of TIME_PATTERNS) {
      pattern.rx.lastIndex = 0;
      if (pattern.rx.test(text)) {
        pattern.tags.forEach(t => tags.add(t));
      }
    }

    // Clothing
    for (const pattern of CLOTHING_PATTERNS) {
      pattern.rx.lastIndex = 0;
      if (pattern.rx.test(text)) {
        pattern.tags.forEach(t => tags.add(t));
      }
    }

    // Booru-style: count prefix — SAHNE BAZLI (v0.8.31)
    // Önce: 1girl, solo her zaman ekleniyordu → couple/group sahnelerde
    // ComfyUI "tek kişi" üretiyordu. Şimdi: poz referansı + sahne tag'lerine
    // göre dinamik count (1girl/1boy, 2girls/1boy, 2girls/2boys, ...).
    const sceneCounts = this._resolveSceneCount(text, sceneTags);
    sceneCounts.forEach(t => tags.add(t));

    return Array.from(tags).join(', ');
  }

  // ----------------------------------------------------------------
  // v0.8.31: Sahne tipine göre doğru count tag'leri hesapla.
  // Önceki davranış: hep "1girl, solo" → couple/group sahnelerde tek kişi.
  // Yeni davranış: poz kategorisi + sahne tag'lerine göre gerçekçi count.
  // ----------------------------------------------------------------
  _resolveSceneCount(text, sceneTags) {
    const counts = new Set();
    const t = String(text || '').toLowerCase();
    const tagsLower = new Set((sceneTags || []).map(x => String(x).toLowerCase()));

    // 1) Poz kategorisini belirle (sceneTags'ten klasör prefix'i)
    let category = null;
    for (const tag of tagsLower) {
      if (tag.startsWith('explicit/') || tag.startsWith('oral_variants/') || tag.startsWith('combo/')) {
        category = 'explicit';
        break;
      }
      if (tag.startsWith('couple/') || tag.startsWith('group_intimate') || tag.startsWith('mff') || tag.startsWith('kiss_couple')) {
        category = 'couple';
        break;
      }
      if (tag.startsWith('group/') || tag.startsWith('threeway') || tag.startsWith('threesome') || tag.startsWith('orgy') || tag.startsWith('foursome') || tag.startsWith('gangbang') || tag.startsWith('mff_') || tag.startsWith('fmf_')) {
        category = 'group';
        break;
      }
      if (tag.startsWith('solo/') || tag.startsWith('oral') || tag.startsWith('selfie') || tag === 'lying' || tag === 'sitting' || tag === 'standing') {
        category = 'solo';
        break;
      }
    }

    // 2) Eğer kategori belirlenemedi, sahnede 2+ kişi sinyali var mı?
    if (!category) {
      if (/\b(her|him|he|she|they|them|partner|man|woman|guy|girl|boy)\b/.test(t)) {
        // Possible 2+ — ama emin değiliz, couple default
        category = 'couple';
      } else {
        category = 'solo';
      }
    }

    // 3) Cinsiyet kombinasyonu
    const lesbian = /lesbian|female_only|2girls|trib|strap|tribadism/.test(t) || tagsLower.has('lesbian') || tagsLower.has('trib');
    const gay = /gay|male_only|2boys|femboy/.test(t) || tagsLower.has('gay') || tagsLower.has('m2m');

    // 4) Count tag'lerini hesapla
    if (category === 'solo') {
      counts.add('1girl');
      counts.add('solo');
    } else if (category === 'couple') {
      if (lesbian) {
        counts.add('2girls');
        counts.add('yuri');
      } else if (gay) {
        counts.add('2boys');
        counts.add('yaoi');
      } else {
        // Heteroseksüel default
        counts.add('1girl');
        counts.add('1boy');
      }
    } else if (category === 'group') {
      // group klasöründeki pozlardan kişi sayısı
      const peopleCount = this._countPeopleInGroupPose(text, sceneTags);
      // MFF vs FMF ayrımı: tag isminden veya path'ten çıkar
      // (group/threeway_mff → MFF, group/threeway_fmf → FMF)
      // NOT: substring match ('fmf' veya 'fmm') güvenli değil çünkü path'lerde çakışıyor.
      // Bunun yerine tag/path birebir karşılaştırma:
      const mffTags = new Set(['threeway_mff', 'threesome_mff', 'mff_threesome', 'mff_kiss', 'group/threeway_mff', 'group/mff_kiss', 'group/group_intimate_kiss']);
      const fmfTags = new Set(['threeway_fmf', 'threesome_fmf', 'fmf_threesome', 'threesome_fmm_oral', 'fmm_double_blowjob', 'double_blowjob', 'group/threeway_fmf', 'group/threesome_fmm_oral']);
      let isMff = false;
      let isFmf = false;
      for (const tag of tagsLower) {
        if (mffTags.has(tag)) isMff = true;
        if (fmfTags.has(tag)) isFmf = true;
      }
      if (peopleCount === 3) {
        if (isMff && !isFmf) {
          counts.add('2girls');
          counts.add('1boy');
        } else if (isFmf && !isMff) {
          counts.add('1girl');
          counts.add('2boys');
        } else {
          counts.add('2girls');
          counts.add('1boy'); // default 3 kişilik
        }
      } else if (peopleCount === 4) {
        counts.add('2girls');
        counts.add('2boys');
      } else if (peopleCount === 5) {
        counts.add('1girl');
        counts.add('4boys'); // gangbang default
      } else {
        counts.add('2girls');
        counts.add('2boys'); // default 4 kişilik
      }
    } else if (category === 'explicit') {
      if (lesbian) {
        counts.add('2girls');
        counts.add('yuri');
      } else {
        counts.add('1girl');
        counts.add('1boy');
      }
    }

    return Array.from(counts);
  }

  // ----------------------------------------------------------------
  // v0.8.31: Group pose'dan kişi sayısını çıkar.
  // ----------------------------------------------------------------
  _countPeopleInGroupPose(text, sceneTags) {
    const tagsLower = new Set((sceneTags || []).map(x => String(x).toLowerCase()));
    // threesome → 3, foursome → 4, gangbang → 5
    // Hem tag alias'larını hem de tam path'leri (group/threeway_mff) kabul et
    const threewayAliases = ['threeway', 'threesome', 'double_penetration', 'double_blowjob', 'triple_oral', 'oral_threesome'];
    const foursomeAliases = ['orgy', 'foursome', 'mmff', 'orgy_4p'];
    const gangbangAliases = ['gangbang', 'gang_bang', 'multiple_men'];

    // Önce path prefix'i kontrol et (group/*, orgy/ vb.)
    let categoryMatch = null;
    for (const tag of tagsLower) {
      if (tag.startsWith('group/')) { categoryMatch = 'group'; break; }
    }
    // Sonra alias eşleşmesi
    for (const tag of tagsLower) {
      const lower = tag.toLowerCase();
      // threesome
      if (threewayAliases.some(a => lower.includes(a)) || tagsLower.has('threeway_mff') || tagsLower.has('threeway_fmf') ||
          tagsLower.has('threesome_mff') || tagsLower.has('threesome_fmf') ||
          tagsLower.has('threesome_oral') || tagsLower.has('threesome_fmm_oral') ||
          tagsLower.has('double_penetration') || tagsLower.has('dp') || tagsLower.has('double_penetrate') ||
          tagsLower.has('double_blowjob') || tagsLower.has('fmm_double_blowjob') || tagsLower.has('mff_double_blowjob') ||
          tagsLower.has('mff_kiss') || tagsLower.has('mff_threesome') || tagsLower.has('fmf_threesome') ||
          tagsLower.has('group_intimate_kiss') || tagsLower.has('group_kiss') ||
          (categoryMatch === 'group' && (lower.includes('threeway') || lower.includes('threesome') || lower.includes('double_pen') || lower.includes('double_blow')))) {
        return 3;
      }
      // foursome
      if (foursomeAliases.some(a => lower.includes(a)) || tagsLower.has('orgy_bbq') || tagsLower.has('orgy_fmmf') ||
          tagsLower.has('orgy_4p') || tagsLower.has('foursome') || tagsLower.has('foursome_bbq') || tagsLower.has('mmff_foursome') ||
          (categoryMatch === 'group' && (lower.includes('orgy') || lower.includes('foursome') || lower.includes('bbq')))) {
        return 4;
      }
      // gangbang
      if (gangbangAliases.some(a => lower.includes(a)) || tagsLower.has('gangbang') || tagsLower.has('gang_bang') || tagsLower.has('multiple_men')) {
        return 5;
      }
    }
    return 4; // safe default
  }

  // ----------------------------------------------------------------
  // v0.8.31: Face mode çözümle.
  // - 'auto' (default): 1 kişi (solo/selfie) → ReActor, 2+ kişi → FaceID
  // - 'reactor': her zaman ReActor
  // - 'faceid': her zaman FaceID
  // - 'none': yüz koruması yok
  // - Legacy: useFaceId=false → 'none', useFaceId=true (mode yoksa) → 'reactor'
  // ----------------------------------------------------------------
  _resolveFaceMode(sceneTags) {
    const mode = this.settings.useFaceMode;
    // Legacy fallback
    if (!mode || mode === 'auto') {
      // useFaceId false ise → none
      if (this.settings.useFaceId === false) return 'none';
      // useFaceMode auto: sahne tipine göre karar
      if (this._isGroupScene(sceneTags)) return 'faceid';
      if (this._isCoupleScene(sceneTags)) return 'faceid';
      return 'reactor'; // solo/selfie
    }
    return mode;
  }

  _isGroupScene(sceneTags) {
    if (!Array.isArray(sceneTags)) return false;
    const set = new Set(sceneTags.map(t => String(t).toLowerCase()));
    // Hem tag alias'larını hem de tam path'leri (group/threeway_mff) kabul et
    const groupIndicators = [
      // threesome
      'threeway_mff', 'threeway_fmf', 'threesome_mff', 'threesome_fmf',
      'threesome_oral', 'threesome_fmm_oral', 'oral_threesome', 'triple_oral',
      'double_penetration', 'dp', 'double_penetrate',
      'double_blowjob', 'fmm_double_blowjob', 'mff_double_blowjob',
      'mff_threesome', 'fmf_threesome', 'mff_kiss', 'fmf_kiss',
      // foursome
      'orgy_bbq', 'orgy_fmmf', 'orgy_4p', 'foursome', 'foursome_bbq', 'mmff_foursome',
      // gangbang
      'gangbang', 'gang_bang', 'multiple_men',
      // group kiss
      'group_intimate_kiss', 'group_kiss',
      // generic
      'mff', 'fmf',
    ];
    for (const ind of groupIndicators) {
      if (set.has(ind)) return true;
    }
    // Path prefix kontrolü (group/threeway_mff, group/orgy_fmmf, ...)
    for (const tag of set) {
      if (tag.startsWith('group/')) return true;
    }
    return false;
  }

  _isCoupleScene(sceneTags) {
    if (!Array.isArray(sceneTags)) return false;
    // Explicit/couple/oral_variants sahnelerde ReActor bozabilir → FaceID öner
    const coupleKeywords = [
      'kiss', 'kissing', 'couple', 'straddling', 'pinned_against_wall', 'pressed_against',
      'embrace', 'cuddling', 'forehead_kiss', 'lap_makeout', 'shower_together',
      'bath_together', 'couch_makeout', 'slow_dance', 'standing_kiss_wall',
      'doggystyle', 'cowgirl_position', 'reverse_cowgirl', 'missionary',
      'anal', 'anal_sex', 'oral', 'blowjob', 'fellatio', 'cunnilingus',
      'sixty_nine', 'prone_bone', 'spooning', 'standing_doggy',
      'missionary', 'anal_doggy', 'anal_cowgirl',
      'facial', 'deepthroat', 'throat_fuck', 'cunnilingus_giver', 'cunnilingus_receiver',
      'blowjob', 'fellatio', 'eating_pussy', 'receiving_cunnilingus',
    ];
    const set = new Set(sceneTags.map(t => String(t).toLowerCase()));
    for (const k of coupleKeywords) {
      if (set.has(k)) return true;
    }
    // Path prefix kontrolü (couple/*, explicit/*, oral_variants/*, combo/*)
    for (const tag of set) {
      if (tag.startsWith('couple/') || tag.startsWith('explicit/') ||
          tag.startsWith('oral_variants/') || tag.startsWith('combo/')) return true;
    }
    return false;
  }

  // -----------------------------------------------------------
  // Companion state readers
  // -----------------------------------------------------------
  _getAvatarTags() {
    const orch = this.orch;
    const ad = orch.settings.avatar_desc;
    if (!ad) return [];

    const charId = this.ctx.characterId;
    const override = ad.override?.[charId];
    const cached = ad.cache?.[charId];

    const desc = override || cached?.description || '';
    if (!desc) return [];

    // desc zaten booru format: "blue eyes, porcelain skin, 21 years old, female, hair: long"
    return desc.split(',').map(s => s.trim()).filter(Boolean);
  }

  _getMoodTags() {
    const orch = this.orch;
    const m = orch.settings.moodData;
    if (!m) return [];

    const charId = this.ctx.characterId;
    const mood = m[charId]?.current || m.current || 'neutral';

    return MOOD_TAGS[mood] || MOOD_TAGS.neutral;
  }

  /**
   * v0.6.3: Extract scene-intimate tags from the actual scene text
   * This ensures real scene keywords (kiss, oral, penetration, etc.)
   * produce relevant Pony/NSFW tags even when LLM Tagger is unavailable
   */
  _extractSceneIntimateTags(text) {
    if (!text) return [];
    const tags = new Set();
    for (const pattern of SCENE_INTIMATE_PATTERNS) {
      pattern.rx.lastIndex = 0; // reset global regex state
      if (pattern.rx.test(text)) {
        for (const t of pattern.tags) tags.add(t);
      }
    }
    return [...tags];
  }

  /**
   * v0.6.3: Public wrapper for testing
   */
  extractSceneTags(text) {
    return this._extractSceneIntimateTags(text);
  }

  _getSpiceTags() {
    const orch = this.orch;
    // v0.6.2: Spice state is at orch.settings.spice.state[charId].current
    // Legacy fallbacks: spiceData, spice[charId].level
    let s = orch.settings.spice;
    if (!s) return [];

    const charId = this.ctx.characterId;
    let level = 0;
    if (s.state) {
      // v0.6.2 spice module structure: state[charId] (key may be string or number)
      level = s.state[charId]?.current ?? s.state[String(charId)]?.current ?? 0;
    } else if (s[charId]) {
      level = s[charId].level ?? 0;
    } else if (s.currentLevel !== undefined) {
      level = s.currentLevel;
    }
    const clampedLevel = Math.min(Math.max(level, 0), 4);

    // Guard rail: explicit (spice 4) tag'ler sadece yetişkin karakterler için
    // Default cap = 3 unless explicit enabled + age verified
    let effectiveLevel = clampedLevel;
    if (clampedLevel >= 4 && !this._isExplicitAllowed()) {
      if (this.settings.debug) {
        console.warn('[Companion AutoGen] Spice 4 blocked — character not verified 18+ or explicit disabled');
      }
      effectiveLevel = 3; // cap at 3 unless explicit mode on
    }

    // v0.6.2: Spice Intensify tier system (soft / intensify / lora_aware)
    // v0.7.0: Per-character profile override
    const charProfilesMod = orch.modules?.find(m => m.name === 'char_lora_profiles');
    const intensifyMod = orch.modules?.find(m => m.name === 'spice_intensify');
    if (intensifyMod?.getTags) {
      // v0.7.0: Apply char profile's tier if set
      let effectiveTierConfig = intensifyMod.settings;
      if (charProfilesMod?.getEffective) {
        const profile = charProfilesMod.getEffective(charId);
        if (profile && profile.tier !== effectiveTierConfig.intensityTier) {
          // Override with profile's tier for this character
          effectiveTierConfig = { ...effectiveTierConfig, intensityTier: profile.tier };
        }
      }
      return intensifyMod.getTags.call(
        { settings: effectiveTierConfig, orch: intensifyMod.orch },
        level, effectiveLevel
      );
    }

    // Legacy fallback (v0.6.1 behavior)
    const lighting = SPICE_LIGHTING[effectiveLevel] || SPICE_LIGHTING[0];
    const mood = SPICE_MOOD[effectiveLevel] || SPICE_MOOD[0];
    const pose = SPICE_POSE[effectiveLevel] || [];
    const clothing = SPICE_CLOTHING[effectiveLevel] || [];
    const bodyLang = SPICE_BODY_LANG[effectiveLevel] || [];

    return [...lighting, ...mood, ...pose, ...clothing, ...bodyLang];
  }

  /**
   * Guard rail: explicit/spice 4 tag'ler sadece şu durumlarda izinli:
   * 1. auto_gen.settings.explicitMode === true
   * 2. Companion'da veya karakter description'da 18+ yaş belirtilmiş
   */
  _isExplicitAllowed() {
    const orch = this.orch;
    if (!orch?.settings?.auto_gen?.explicitMode) return false;
    // Karakter description'da 18+ kontrolü
    try {
      const ctx = this._getCtx() || this.ctx;
      const char = ctx?.characters?.[ctx.characterId];
      const desc = (char?.description || '') + ' ' + (char?.creator_notes || '') + ' ' + (char?.personality || '');
      // Yaygın 18+ işaretleri
      const adultMarkers = /\b(1[89]|[2-9][0-9])\s*(yo|ya[\u015fs]|years?\s*old|age|\+)|adult\s*character|nsfw\s*allowed|mature\s*content|18\+|21\+/i;
      if (adultMarkers.test(desc)) return true;
      // Eğer hiç yaş yoksa explicit'i engelle (güvenli varsayılan)
      return false;
    } catch (e) {
      return false;
    }
  }

  _getCurrentMood() {
    const orch = this.orch;
    const m = orch.settings.moodData;
    if (!m) return null;
    const charId = this.ctx?.characterId;
    return m[charId]?.current || m.current || null;
  }

  _getCurrentSpice() {
    const orch = this.orch;
    const s = orch.settings.spice;
    if (!s) return 0;
    const charId = this.ctx?.characterId;
    if (s.state) {
      return s.state[charId]?.current ?? s.state[String(charId)]?.current ?? 0;
    }
    return s[charId]?.level ?? s.currentLevel ?? 0;
  }

  _getScenarioTags() {
    const orch = this.orch;
    const sc = orch.settings.scenariosData || orch.settings.scenarios;
    if (!sc) return [];

    const charId = this.ctx.characterId;
    const current = sc[charId]?.current || sc.current || 'default';

    // Built-in scenarios → tags
    const SCENARIO_TAGS = {
      default: [],
      coffee_shop: ['coffee_shop', 'cafe_interior', 'morning_light'],
      late_night_texting: ['bedroom', 'night', 'phone', 'bed'],
      domestic_soft: ['home_interior', 'cozy', 'warm_lighting', 'kitchen'],
      high_stakes: ['dramatic', 'moody', 'cinematic'],
    };

    const builtin = SCENARIO_TAGS[current] || [];
    const custom = sc[charId]?.custom?.[current]?.tags || sc.custom?.[current]?.tags || [];

    return [...builtin, ...custom];
  }

  // -----------------------------------------------------------
  // Workflow override (port from image_gen + kazuma_bridge)
  // -----------------------------------------------------------
  async loadAndOverrideWorkflow(prompt, sceneTags = null) {
    const ctx = this._getCtx() || this.ctx;
    if (!ctx?.getRequestHeaders) {
      console.warn('[Companion AutoGen] loadAndOverrideWorkflow: no ctx.getRequestHeaders');
      return null;
    }
    const headers = ctx.getRequestHeaders();

    // 1) Load workflow
    const wfResp = await fetch('/api/sd/comfy/workflow', {
      method: 'POST',
      headers,
      body: JSON.stringify({ file_name: this.settings.workflowFile }),
    });

    if (!wfResp.ok) {
      this.toast(`Workflow yüklenemedi: ${wfResp.status}`, 'error');
      return null;
    }

    let raw = await wfResp.text();
    let workflow = JSON.parse(raw);
    if (typeof workflow === 'string') workflow = JSON.parse(workflow);

    // 2) Override placeholders
    // v0.8.13: spice'a göre dinamik LoRA stack seç
    const spiceLevel = this._getCurrentSpice();
    let activeLoras, activeWts;
    if (spiceLevel >= 4 && Array.isArray(this.settings.lorasExplicit)) {
      activeLoras = this.settings.lorasExplicit;
      activeWts   = this.settings.lorasExplicitWts || [0.35, 0.65, 0.45, 0.5];
    } else if (spiceLevel >= 3 && Array.isArray(this.settings.lorasNsfw)) {
      activeLoras = this.settings.lorasNsfw;
      activeWts   = this.settings.lorasNsfwWts || [0.4, 0.7, 0.5, 0.5];
    } else if (Array.isArray(this.settings.lorasSfw)) {
      activeLoras = this.settings.lorasSfw;
      activeWts   = this.settings.lorasSwfWts || [0.4, 0.5, 0.5, 0.4];
    } else {
      // fallback: eski tek-stack
      activeLoras = this.settings.loras || [];
      activeWts   = this.settings.lorawts || [];
    }

    for (const nodeId in workflow) {
      const node = workflow[nodeId];
      if (!node?.inputs) continue;
      for (const key in node.inputs) {
        const v = node.inputs[key];
        if (v === '*input*') node.inputs[key] = prompt;
        else if (v === '*ninput*') node.inputs[key] = this.settings.negativeOverride;
        else if (v === '*model*') node.inputs[key] = this.settings.model;
        else if (v === '*sampler*') node.inputs[key] = this.settings.sampler;
        else if (v === '*seed*') node.inputs[key] = Math.floor(Math.random() * 1e15);
        else if (v === '*steps*') node.inputs[key] = this.settings.steps;
        else if (v === '*cfg*') node.inputs[key] = this.settings.cfg;
        else if (v === '*width*') node.inputs[key] = this.settings.width;
        else if (v === '*height*') node.inputs[key] = this.settings.height;
        else if (v === '*lora*')   node.inputs[key] = activeLoras[0];
        else if (v === '*lora2*')  node.inputs[key] = activeLoras[1];
        else if (v === '*lora3*')  node.inputs[key] = activeLoras[2];
        else if (v === '*lora4*')  node.inputs[key] = activeLoras[3];
        else if (v === '*lorawt*')  node.inputs[key] = activeWts[0];
        else if (v === '*lorawt2*') node.inputs[key] = activeWts[1];
        else if (v === '*lorawt3*') node.inputs[key] = activeWts[2];
        else if (v === '*lorawt4*') node.inputs[key] = activeWts[3];
      }
    }

    // v0.8.15: ControlNet poz — sahne tag'lerine göre poz referansı uygula.
    // Conditioning'i (KSampler positive/negative) ControlNet'ten geçirir.
    // useControlNet kapalıysa / eşleşme yoksa / poz dosyası yoksa atlanır.
    if (this.settings.useControlNet && Array.isArray(sceneTags) && sceneTags.length) {
      try {
        const poseFile = this._selectPoseRef(sceneTags);
        if (poseFile) {
          const poseRefName = await this._uploadPoseRefToComfy(this.settings.comfyuiUrl, poseFile);
          if (poseRefName) {
            this._injectControlNet(workflow, poseRefName);
            if (this.settings.debug) console.log('[Companion AutoGen] 🎯 ControlNet poz:', poseFile);
          } else if (this.settings.debug) {
            console.log('[Companion AutoGen] Poz dosyası bulunamadı (kütüphane boş):', poseFile);
          }
        }
      } catch (e) {
        console.warn('[Companion AutoGen] ControlNet enjeksiyonu atlandı:', e?.message || e);
      }
    }

    // v0.8.31: Face mode (auto/reactor/faceid/none) — sahne tipine göre
    // otomatik mod seçimi. Eski davranış: hep ReActor → 2+ kişilik sahnelerde
    // yüz tanıyamayıp bozuyordu. Yeni: 1 kişi → ReActor, 2+ kişi → FaceID.
    // v0.8.11: ReActor face-swap — aktif karakterin avatar yüzünü üretilen
    // görsele swap et (selfie pipeline ile aynı yaklaşım). FaceID'den geçildi:
    // FaceID gerçekçilik↔kimlik'i aynı diffusion'a yükleyip plastik doku katıyordu.
    // ReActor'da: taban görsel orijinal şekilde üretilir (gerçekçi) → son adımda
    // avatar yüzü swap edilir (inswapper_128) + GFPGANv1.4 restore.
    // Avatar yoksa / upload başarısızsa sessizce atla — düz üretim devam eder.
    const faceMode = this._resolveFaceMode(sceneTags);
    console.log('[AutoGen] useFaceMode:', this.settings.useFaceMode, '→ resolved:', faceMode, '| useFaceId(legacy):', this.settings.useFaceId, '| sceneTags:', sceneTags?.slice(0, 5));
    if (faceMode === 'none') {
      console.warn('[AutoGen] ⚠️ Face mode: none — yüz koruması yok.');
    } else if (faceMode === 'reactor') {
      try {
        const _ctx2 = this._getCtx();
        const _charId = _ctx2?.characterId;
        const _avatar = _ctx2?.characters?.[_charId]?.avatar;
        console.log('[AutoGen] ReActor: charId=', _charId, 'avatar=', _avatar, 'comfyUrl=', this.settings.comfyuiUrl);
        const refName = await this._uploadAvatarToComfy(this.settings.comfyuiUrl);
        if (refName) {
          this._injectReActor(workflow, refName);
          console.log('[AutoGen] ✅ ReActor inject OK, avatar:', refName);
        } else {
          console.warn('[AutoGen] ⚠️ ReActor atlandı: avatar upload null (charId:', _charId, '| avatar:', _avatar, ')');
          this.toast('⚠️ ReActor: avatar null — console\'a bak', 'warning');
        }
      } catch (e) {
        console.warn('[AutoGen] ReActor enjeksiyonu atlandı:', e?.message || e);
        this.toast(`⚠️ ReActor hata: ${e?.message}`, 'warning');
      }
    } else if (faceMode === 'faceid') {
      try {
        const _ctx2 = this._getCtx();
        const _charId = _ctx2?.characterId;
        const _avatar = _ctx2?.characters?.[_charId]?.avatar;
        console.log('[AutoGen] FaceID: charId=', _charId, 'avatar=', _avatar, 'comfyUrl=', this.settings.comfyuiUrl);
        const refName = await this._uploadAvatarToComfy(this.settings.comfyuiUrl);
        if (refName) {
          // Group sahnesinde weight düşür (kimlik zayıf ama bozuk olmasın)
          const isGroup = this._isGroupScene(sceneTags);
          const w = isGroup ? (this.settings.faceIdWeightGroup ?? 0.5) : (this.settings.faceIdWeight ?? 0.85);
          this._injectFaceId(workflow, refName);
          // _injectFaceId default 0.85 kullanıyor; istersek override ederiz
          for (const [nid, node] of Object.entries(workflow)) {
            if (node?.class_type === 'IPAdapterFaceID' && node.inputs?.weight !== undefined) {
              node.inputs.weight = w;
            }
          }
          console.log('[AutoGen] ✅ FaceID inject OK, avatar:', refName, '| weight:', w, '| isGroup:', isGroup);
        } else {
          console.warn('[AutoGen] ⚠️ FaceID atlandı: avatar upload null (charId:', _charId, '| avatar:', _avatar, ')');
          this.toast('⚠️ FaceID: avatar null — console\'a bak', 'warning');
        }
      } catch (e) {
        console.warn('[AutoGen] FaceID enjeksiyonu atlandı:', e?.message || e);
        this.toast(`⚠️ FaceID hata: ${e?.message}`, 'warning');
      }
    } else {
      console.warn('[AutoGen] ⚠️ useFaceId=false — yüz koruması devre dışı. Settings\'ten aç.');
      this.toast('⚠️ Yüz Tutarlılığı kapalı — Companion State Injection\'dan aç', 'warning');
    }

    return workflow;
  }

  // -----------------------------------------------------------
  // v0.8.7: FaceID — aktif karakterin avatar görselini ComfyUI input
  // klasörüne yükle. LoadImage referansı için ad döner (yoksa null).
  // -----------------------------------------------------------
  // Görseli yüz bölgesine (üst-orta kare) kırpar — FaceID kimliği için.
  async _cropToFaceRegion(blob) {
    try {
      if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return blob;
      const img = await createImageBitmap(blob);
      const w = img.width, h = img.height;
      const side = Math.round(Math.min(w, h * 0.55));
      const sx = Math.max(0, Math.round((w - side) / 2));
      const sy = Math.max(0, Math.round(h * 0.04));
      const canvas = new OffscreenCanvas(side, side);
      const c = canvas.getContext('2d');
      c.drawImage(img, sx, sy, side, side, 0, 0, side, side);
      const out = await canvas.convertToBlob({ type: 'image/png' });
      if (img.close) img.close();
      return out || blob;
    } catch (_) {
      return blob;
    }
  }

  async _uploadAvatarToComfy(comfyUrl) {
    const ctx = this._getCtx() || this.ctx;
    const charId = ctx?.characterId;
    if (charId === undefined || charId === null) return null;
    const char = ctx.characters?.[charId];
    const avatarFile = char?.avatar;
    if (!avatarFile || avatarFile === 'none.png') return null;
    // ST karakter görselini /characters/<avatar>'dan çek
    // Subdirectory path'leri (tinder-batch/...) için her segmenti ayrı encode et.
    const encodedPath = avatarFile.split('/').map(encodeURIComponent).join('/');
    const imgResp = await fetch(`/characters/${encodedPath}`, { credentials: 'include' });
    if (!imgResp.ok) {
      console.error('[AutoGen] Avatar fetch failed:', imgResp.status, encodedPath);
      return null;
    }
    // Yüz bölgesine kırp (selfie ile aynı): kare-değil avatar'da ComfyUI
    // merkezden kırpıp gövdeyi alıyordu → FaceID kimliği zayıf.
    const blob = await this._cropToFaceRegion(await imgResp.blob());
    const safe = String(avatarFile).replace(/[^\w.-]/g, '_');
    const form = new FormData();
    form.append('image', new File([blob], safe, { type: 'image/png' }));
    form.append('overwrite', 'true');
    form.append('type', 'input');
    const up = await fetch(`${comfyUrl}/upload/image`, { method: 'POST', body: form });
    if (!up.ok) return null;
    const j = await up.json().catch(() => ({}));
    return j.name || safe;
  }

  // -----------------------------------------------------------
  // v0.8.15: ControlNet poz — sahne tag'lerine göre poz referansı seç.
  // SCENE_POSE_REFS sıralı; ilk eşleşen kazanır (explicit > couple > solo).
  // Eşleşme yoksa null → ControlNet atlanır.
  // -----------------------------------------------------------
  _selectPoseRef(tags) {
    const tagSet = new Set((Array.isArray(tags) ? tags : []).map(t => String(t).toLowerCase()));
    for (const entry of SCENE_POSE_REFS) {
      if (entry.tags.some(t => tagSet.has(t.toLowerCase()))) return entry.file;
    }
    // Eşleşme yoksa default: dik duran solo poz
    return 'solo/standing.png';
  }

  // Poz referans görselini extension klasöründen çekip ComfyUI input'a yükle.
  // Dosya yoksa (kütüphane henüz boş) null döner → ControlNet graceful atlanır.
  async _uploadPoseRefToComfy(comfyUrl, poseFile) {
    try {
      const url = `/scripts/extensions/third-party/companion-orchestrator/pose-library/${poseFile}`;
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) return null; // dosya yok → kütüphane boş
      const blob = await resp.blob();
      const safe = 'pose_' + String(poseFile).replace(/[^\w.-]/g, '_');
      const form = new FormData();
      form.append('image', new File([blob], safe, { type: 'image/png' }));
      form.append('overwrite', 'true');
      form.append('type', 'input');
      const up = await fetch(`${comfyUrl}/upload/image`, { method: 'POST', body: form });
      if (!up.ok) return null;
      const j = await up.json().catch(() => ({}));
      return j.name || safe;
    } catch (_) {
      return null;
    }
  }

  // ControlNet zincirini conditioning'e enjekte et. KSampler'ın positive/negative
  // girişleri ControlNetApplyAdvanced çıkışlarına yönlendirilir.
  _injectControlNet(workflow, poseRefName) {
    const ids = Object.keys(workflow).map(Number).filter(n => !Number.isNaN(n));
    let nxt = (ids.length ? Math.max(...ids) : 0) + 1;
    const NID = () => String(nxt++);

    const cnLoader = NID();
    workflow[cnLoader] = {
      class_type: 'ControlNetLoader',
      inputs: { control_net_name: this.settings.controlNetModel },
      _meta: { title: 'ControlNet Yükle (poz)' },
    };
    const poseImg = NID();
    workflow[poseImg] = {
      class_type: 'LoadImage',
      inputs: { image: poseRefName },
      _meta: { title: 'Poz Referansı (ham görsel)' },
    };
    // Depth preprocessor: ham poz görselinden depth map çıkar (depth ControlNet
    // depth map ister, ham RGB değil). Bu sayede poz kütüphanesi normal görsel olabilir.
    const depth = NID();
    workflow[depth] = {
      class_type: 'DepthAnythingV2Preprocessor',
      inputs: { image: [poseImg, 0], ckpt_name: 'depth_anything_v2_vitl.pth', resolution: 512 },
      _meta: { title: 'Depth Çıkar (poz→depth)' },
    };

    const strength = (typeof this.settings.controlNetStrength === 'number') ? this.settings.controlNetStrength : 0.55;
    const startP = (typeof this.settings.controlNetStartPercent === 'number') ? this.settings.controlNetStartPercent : 0.0;
    const endP = (typeof this.settings.controlNetEndPercent === 'number') ? this.settings.controlNetEndPercent : 0.7;

    for (const [, node] of Object.entries(workflow)) {
      if (node?.class_type === 'KSampler' && node.inputs?.positive && node.inputs?.negative) {
        const apply = NID();
        workflow[apply] = {
          class_type: 'ControlNetApplyAdvanced',
          inputs: {
            positive: node.inputs.positive,
            negative: node.inputs.negative,
            control_net: [cnLoader, 0],
            image: [depth, 0],
            strength, start_percent: startP, end_percent: endP,
          },
          _meta: { title: 'ControlNet Uygula (poz)' },
        };
        node.inputs.positive = [apply, 0];
        node.inputs.negative = [apply, 1];
      }
    }
  }

  // -----------------------------------------------------------
  // v0.8.7: Yüklenen workflow'a IP-Adapter FaceID zincirini enjekte et.
  // KSampler(lar)ın model girişi FaceID node'undan geçirilir. cubiq
  // IPAdapter_plus API'si (selfie ile aynı). ID çakışmasını önlemek için
  // mevcut max id'den sonra yeni id'ler üretilir.
  // -----------------------------------------------------------
  _injectFaceId(workflow, refName) {
    const ids = Object.keys(workflow).map(Number).filter(n => !Number.isNaN(n));
    let nxt = (ids.length ? Math.max(...ids) : 0) + 1;
    const NID = () => String(nxt++);
    const ipm = NID(), clv = NID(), ins = NID(), lim = NID();
    workflow[ipm] = { class_type: 'IPAdapterModelLoader', inputs: { ipadapter_file: 'ip-adapter-faceid-plusv2_sdxl.bin' } };
    workflow[clv] = { class_type: 'CLIPVisionLoader', inputs: { clip_name: 'CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors' } };
    workflow[ins] = { class_type: 'IPAdapterInsightFaceLoader', inputs: { provider: 'ROCM' } };
    workflow[lim] = { class_type: 'LoadImage', inputs: { image: refName } };
    const w = (typeof this.settings.faceIdWeight === 'number') ? this.settings.faceIdWeight : 0.85;
    const loraS = (typeof this.settings.faceIdLoraStrength === 'number') ? this.settings.faceIdLoraStrength : 0.7;
    for (const [, node] of Object.entries(workflow)) {
      if (node?.class_type === 'KSampler' && node.inputs?.model) {
        const src = node.inputs.model;
        // faceid-plusv2 kimlik için companion LoRA'sının UNet'e uygulanmasını
        // ŞART koşar. Bu olmadan yüz tutarlı ama avatar'a benzemiyordu.
        const lora = NID();
        workflow[lora] = {
          class_type: 'LoraLoaderModelOnly',
          inputs: { model: src, lora_name: 'ip-adapter-faceid-plusv2_sdxl_lora.safetensors', strength_model: loraS },
        };
        const fid = NID();
        workflow[fid] = {
          class_type: 'IPAdapterFaceID',
          inputs: {
            model: [lora, 0], ipadapter: [ipm, 0], image: [lim, 0],
            weight: w, weight_faceidv2: 1.5, weight_type: 'linear', combine_embeds: 'concat',
            start_at: 0.0, end_at: 1.0, embeds_scaling: 'V only',
            clip_vision: [clv, 0], insightface: [ins, 0],
          },
        };
        node.inputs.model = [fid, 0];
      }
    }
  }

  // -----------------------------------------------------------
  // v0.8.11: ReActor face-swap enjeksiyonu. SaveImage'ın bağlı olduğu
  // VAEDecode çıkışına ReActorFaceSwap node'u ekler; kaynak yüz = avatar.
  // Selfie workflow'u ile aynı swap parametreleri kullanılır.
  // -----------------------------------------------------------
  _injectReActor(workflow, refName) {
    const ids = Object.keys(workflow).map(Number).filter(n => !Number.isNaN(n));
    let nxt = (ids.length ? Math.max(...ids) : 0) + 1;
    const NID = () => String(nxt++);

    const loadImgId = NID();
    workflow[loadImgId] = {
      class_type: 'LoadImage',
      inputs: { image: refName },
      _meta: { title: 'Referans Yüz (avatar)' },
    };

    for (const [, node] of Object.entries(workflow)) {
      if (node?.class_type === 'SaveImage' && node.inputs?.images) {
        const src = node.inputs.images; // e.g. ["8", 0] — VAEDecode çıkışı
        const reactorId = NID();
        workflow[reactorId] = {
          class_type: 'ReActorFaceSwap',
          inputs: {
            enabled: true,
            input_image: src,
            source_image: [loadImgId, 0],
            swap_model: 'inswapper_128.onnx',
            facedetection: 'retinaface_resnet50',
            face_restore_model: 'GFPGANv1.4.pth',
            face_restore_visibility: 1,
            codeformer_weight: 0.5,
            detect_gender_input: 'no',
            detect_gender_source: 'no',
            input_faces_index: '0',
            source_faces_index: '0',
            console_log_level: 1,
          },
          _meta: { title: 'ReActor Face Swap (kimlik = avatar)' },
        };
        node.inputs.images = [reactorId, 0];
      }
    }
  }

  // -----------------------------------------------------------
  // Send to ComfyUI
  // -----------------------------------------------------------
  async sendToComfy(workflow) {
    const resp = await fetch(`${this.settings.comfyuiUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      const msg = err?.node_errors ? Object.keys(err.node_errors).join(', ') : resp.statusText;
      this.toast(`ComfyUI reddetti: ${msg}`, 'error');
      console.error('[Companion AutoGen] ComfyUI error:', err);
      return null;
    }

    const result = await resp.json();
    return result.prompt_id;
  }

  // -----------------------------------------------------------
  // Wait for completion (polling ComfyUI history)
  // -----------------------------------------------------------
  async waitForCompletion(promptId, timeoutMs = 90000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 1000));
      const resp = await fetch(`${this.settings.comfyuiUrl}/history/${promptId}`);
      if (!resp.ok) continue;
      const data = await resp.json();
      const entry = data[promptId];
      if (entry?.status?.completed) {
        const filename = entry.outputs?.['9']?.images?.[0]?.filename;
        return filename || null;
      }
    }
    this.toast('⏱️ Üretim zaman aşımına uğradı', 'warning');
    return null;
  }

  // -----------------------------------------------------------
  // Inject to ST chat — Kazuma pattern: ComfyUI blob → base64 → ST upload → extra.media
  // extra.image = direkt ComfyUI URL ST tarafından render edilmiyor (Kazuma'nın
  // appendMediaToMessage + saved path yaklaşımı gerekiyor).
  // -----------------------------------------------------------
  async injectToChat(filename, prompt, targetMessage = null) {
    const ctx = this._getCtx() || this.ctx;
    if (!ctx) {
      console.warn('[Companion AutoGen] injectToChat: no ctx');
      return;
    }
    // Öncelikle: targetMessage (gerçek AI cevabı) verilmişse onu kullan
    // Yoksa: son gerçek AI (assistant) mesajını bul
    let target = targetMessage;
    if (!target) {
      for (let i = ctx.chat.length - 1; i >= 0; i--) {
        const m = ctx.chat[i];
        if (!m.is_user && m.mes && m.mes.length > 5) {
          target = m;
          break;
        }
      }
    }
    if (!target) {
      console.warn('[Companion AutoGen] injectToChat: no AI message found');
      return;
    }

    // 1) ComfyUI'dan blob olarak çek
    const imageUrl = `${this.settings.comfyuiUrl}/view?filename=${filename}&type=output`;
    const imgResp = await fetch(imageUrl);
    if (!imgResp.ok) {
      console.error('[AutoGen] ComfyUI görsel çekme başarısız:', imgResp.status, filename);
      return;
    }
    const blob = await imgResp.blob();

    // 2) base64'e çevir
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    // 3) ST'ye yükle (Kazuma'nın saveBase64AsFile pattern'i: /api/images/upload)
    const charName = (() => {
      try {
        const char = ctx.characters?.[ctx.characterId];
        return (char?.name || 'AutoGen').replace(/[^\w]/g, '_');
      } catch (_) { return 'AutoGen'; }
    })();
    const ts = Date.now();
    const uploadResp = await fetch('/api/images/upload', {
      method: 'POST',
      headers: ctx.getRequestHeaders ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64, format: 'png', ch_name: charName, filename: `autogen_${ts}` }),
    });
    if (!uploadResp.ok) {
      console.error('[AutoGen] ST image upload başarısız:', uploadResp.status);
      return;
    }
    const { path: savedPath } = await uploadResp.json();

    // 4) extra.media'ya ekle (Kazuma'nın appendMediaToMessage pattern'i)
    if (!target.extra) target.extra = {};
    if (!target.extra.media) target.extra.media = [];
    target.extra.media_display = 'gallery';
    target.extra.media.push({ url: savedPath, type: 'image', source: 'generated', title: '🎨 Companion AutoGen' });
    target.extra.media_index = target.extra.media.length - 1;

    // 5) DOM'a ekle — appendMediaToMessage global'sa kullan, yoksa MESSAGE_UPDATED
    const msgIdx = ctx.chat.indexOf(target);
    if (typeof appendMediaToMessage === 'function') {
      const msgEl = document.querySelector(`[mesid="${msgIdx}"]`);
      appendMediaToMessage(target, msgEl);
    } else if (ctx.eventSource && ctx.eventTypes?.MESSAGE_UPDATED) {
      ctx.eventSource.emit && ctx.eventSource.emit(ctx.eventTypes.MESSAGE_UPDATED, target.messageId ?? msgIdx);
    }

    // 6) Kaydet
    if (ctx.saveChat) {
      try { await ctx.saveChat(); } catch (e) { console.warn('saveChat failed:', e); }
    }

    console.log('[Companion AutoGen] ✅ Görsel chat\'e eklendi:', savedPath, '→ msg idx', msgIdx);
  }

  // -----------------------------------------------------------
  // History
  // -----------------------------------------------------------
  _saveHistory(entry) {
    if (!this.settings.history) this.settings.history = [];
    this.settings.history.unshift(entry);
    this.settings.history = this.settings.history.slice(0, 10);
  }

  getHistory() {
    return this.settings.history || [];
  }

  // -----------------------------------------------------------
  // Manual generation (called from UI)
  // -----------------------------------------------------------
  async generateNow() {
    const ctx = this._getCtx();
    if (!ctx?.chat?.length) {
      this.toast('Chat boş', 'warning');
      return;
    }
    // Son gerçek AI (assistant) mesajını bul
    // skip system/template/html messages
    let lastAiMsg = null;
    for (let i = ctx.chat.length - 1; i >= 0; i--) {
      const m = ctx.chat[i];
      if (m.is_user) continue;
      if (m.mes && !m.mes.startsWith('<div') && m.mes.length > 5) {
        lastAiMsg = m;
        break;
      }
    }
    if (!lastAiMsg) {
      // fallback: son mesaj
      lastAiMsg = ctx.chat[ctx.chat.length - 1];
    }
    if (!lastAiMsg) {
      this.toast('Üretilecek mesaj yok', 'warning');
      return;
    }
    console.log('[Companion AutoGen] generateNow using msg:', lastAiMsg.mes.slice(0, 60));
    await this.generate(lastAiMsg);
  }

  // -----------------------------------------------------------
  // Toast helper
  // -----------------------------------------------------------
  toast(msg, type = 'info') {
    const ctx = this.ctx;
    if (ctx.toastr) {
      ctx.toastr[type]?.(msg) || ctx.toastr.info?.(msg);
    } else if (window.toastr) {
      window.toastr[type]?.(msg) || window.toastr.info?.(msg);
    } else {
      console.log(`[Companion AutoGen ${type}]:`, msg);
    }
  }

  // -----------------------------------------------------------
  // Summary (status panel için)
  // -----------------------------------------------------------
  summary() {
    const s = this.settings || {};
    // Aktif LoRA stack sayısını bul (dinamik 3-stack veya legacy loras)
    const spice = this._getCurrentSpice?.() ?? 0;
    let loraCount = 0;
    try {
      if (spice >= 4 && Array.isArray(s.lorasExplicit)) loraCount = s.lorasExplicit.length;
      else if (spice >= 3 && Array.isArray(s.lorasNsfw))  loraCount = s.lorasNsfw.length;
      else if (Array.isArray(s.lorasSfw))                  loraCount = s.lorasSfw.length;
      else if (Array.isArray(s.loras))                     loraCount = s.loras.length;
    } catch (_) { loraCount = 0; }
    return {
      enabled: s.enabled,
      trigger: s.trigger,
      workflow: s.workflowFile,
      loraCount,
      lastGen: s.history?.[0]?.timestamp
        ? new Date(s.history[0].timestamp).toLocaleTimeString('tr-TR')
        : '—',
      historyCount: s.history?.length || 0,
    };
  }
}

// =====================================================================
// Singleton instance
// =====================================================================

const autoGenInstance = new AutoGen();
export const autoGenModule = {
  name: 'auto_gen',
  displayName: '🎬 Otomatik Üretici',
  description: 'AI mesajı geldiğinde context-aware görsel üretir (Kazuma\'yı bypass)',
  toggleKey: 'autoGenEnabled',
  // Proxy all methods to singleton
  init: (orch) => autoGenInstance.init(orch),
  setEnabled: (enabled) => autoGenInstance.setEnabled(enabled),
  generateNow: () => autoGenInstance.generateNow(),
  getHistory: () => autoGenInstance.getHistory(),
  buildPrompt: (msg) => autoGenInstance.buildPrompt(msg),
  extractSceneTags: (text) => autoGenInstance._extractSceneIntimateTags(text),
  selectPoseRef: (tags) => autoGenInstance._selectPoseRef(tags),
  resolveSceneCount: (text, sceneTags) => autoGenInstance._resolveSceneCount(text, sceneTags),
  resolveFaceMode: (sceneTags) => autoGenInstance._resolveFaceMode(sceneTags),
  isGroupScene: (sceneTags) => autoGenInstance._isGroupScene(sceneTags),
  isCoupleScene: (sceneTags) => autoGenInstance._isCoupleScene(sceneTags),
  countPeopleInGroupPose: (text, sceneTags) => autoGenInstance._countPeopleInGroupPose(text, sceneTags),
  summary: () => autoGenInstance.summary(),
  // Settings reference
  get settings() { return autoGenInstance.settings; },
};
