#!/usr/bin/env python3
"""
Poz kütüphanesi self-bootstrap: her poz tipinden bir referans görseli
ComfyUI'da (txt2img) üretip pose-library/ altına kaydeder.
Bu görseller ControlNet depth preprocessor'a beslenir (vücut duruşu kaynağı).
"""
import json, time, urllib.request, urllib.error, os, sys

COMFY = "http://192.168.68.66:8001"
HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = "cyberrealisticPony_v170.safetensors"

# (dosya yolu, poz açıklaması) — depth için net tam-boy vücut duruşu önemli
POSES = [
    # ---- explicit (çift) ----
    ("explicit/missionary.png",  "two people having sex, missionary position, woman lying on her back on bed, legs raised and apart, man on top between her legs, full body view"),
    ("explicit/cowgirl.png",     "woman riding on top, cowgirl position, sitting upright straddling partner lying down, full body side view"),
    ("explicit/reverse_cowgirl.png", "woman riding on top, reverse cowgirl position, facing away from partner, full body rear view"),
    ("explicit/doggystyle.png",  "woman on all fours on bed, kneeling on hands and knees, partner behind, rear view, full body"),
    ("explicit/standing_doggy.png", "woman bent over, hands on wall or table, standing doggy style, partner behind, full body side view"),
    ("explicit/oral.png",        "person kneeling between partner's legs, oral sex pose, partner lying back, full body view"),
    ("explicit/sixty_nine.png",  "couple in 69 position, both performing and receiving oral, lying on bed perpendicular, full body top view"),
    ("explicit/prone_bone.png",  "woman lying face down on bed, partner on top from behind, prone bone position, full body side view"),
    ("explicit/spooning.png",    "couple lying on their sides spooning, both bodies parallel on bed, side view full body"),
    # ---- couple (samimi, clothed veya yarı çıplak) ----
    ("couple/straddling.png",    "woman straddling partner who is sitting, facing each other, sitting on lap, full body"),
    ("couple/against_wall.png",  "couple standing pressed against a wall, embracing face to face, standing full body"),
    ("couple/embrace.png",       "couple standing embracing in a tight hug, face to face, full body"),
    ("couple/kiss.png",          "couple standing close kissing, face to face, upper body and full body"),
    ("couple/lap_sit_legs_over.png", "woman sitting on man's lap on couch, legs draped over his, leaning back into his chest, casual clothed, full body"),
    ("couple/facing_window.png", "couple standing in front of a large window at night, man behind woman holding her waist, both looking out, city lights, full body rear view"),
    ("couple/dining_table.png",  "couple at a dining table standing close, man pressing against woman's back, her hands on the table, full body"),
    # ---- solo ----
    ("solo/lying.png",           "single woman lying on her back on a bed, relaxed, legs slightly apart, full body view from above"),
    ("solo/arching.png",         "single woman on bed arching her back, kneeling, full body side view"),
    ("solo/sitting.png",         "single woman sitting on edge of bed, upright, full body front view"),
    ("solo/standing.png",        "single woman standing straight, full body front view, natural pose"),
    ("solo/over_the_shoulder.png", "single woman looking back over her shoulder, 3/4 rear view, hair swept to one side, neck and back visible, full body"),
    ("solo/bathroom_mirror.png", "single woman taking a mirror selfie in bathroom, phone in hand, full body reflection, bathroom tiles background"),
    # ---- clothed (public/office, non-sexual) ----
    ("clothed/flirting_office_desk.png", "woman leaning against office desk, hip out, looking over shoulder, work clothes, full body office background"),
    ("clothed/flirting_elevator.png", "woman standing in elevator, leaning against wall, slight smile, looking at camera, office clothes, full body"),
    ("clothed/flirting_balcony.png", "woman standing on balcony at night, leaning on railing, looking back at camera, dress flowing, city lights background, full body"),

    # ---- v0.8.x — Batch 2: çeşitleme + günlük hayat + ortam genişletme (25 → 52) ----

    # ---- oral_variants (açı çeşitliliği) ----
    ("oral_variants/facial.png", "man ejaculating on woman's face, she is kneeling and looking up, cum on face and chin, full body front view"),
    ("oral_variants/deepthroat.png", "woman performing deepthroat, man's cock deep in her throat, kneeling position, side view, full body"),
    ("oral_variants/cunnilingus_giver.png", "man kneeling between woman's legs performing cunnilingus, she is on her back on bed, full body side view"),
    ("oral_variants/cunnilingus_receiver.png", "woman receiving cunnilingus, lying on her back, head thrown back, partner between her legs, full body top view"),

    # ---- combo (anal ayrı dosya) ----
    ("combo/anal_doggy.png", "anal sex doggy style, woman on all fours, partner behind, rear view with visible penetration, full body"),
    ("combo/anal_cowgirl.png", "anal sex cowgirl position, woman riding on top facing partner, full body side view"),

    # ---- couple (intimate çeşitleme) ----
    ("couple/shower_together.png", "couple in shower together, water streaming, pressed against tile wall, wet hair, full body side view"),
    ("couple/bath_together.png", "couple in bathtub together, bubbles, she leans back against his chest, his arms around her, full body side view"),
    ("couple/couch_makeout.png", "couple making out on couch, him lying on top of her, deep kiss, full body 3/4 view"),
    ("couple/morning_under_covers.png", "couple in bed under covers in morning, only their heads and shoulders visible, soft light, intimate, bedhead hair"),

    # ---- v0.8.x Batch 3: couple genişletme (11 → 39) ----
    # ---- romantik / samimi ----
    ("couple/slow_dance.png", "couple slow dancing in a living room, him holding her waist, her hand on his shoulder, face to face, romantic lighting, full body"),
    ("couple/forehead_kiss.png", "couple embracing, man kissing woman on her forehead, her eyes closed, gentle hold, soft lighting, upper body and hands"),
    ("couple/carrying_bride.png", "man carrying woman in his arms bridal style, her arms around his neck, she laughing, romantic moment, full body"),
    ("couple/wedding_kiss.png", "couple in wedding attire kissing at altar, bride in white dress, groom in suit, holding hands, full body front view"),
    ("couple/first_meet.png", "couple meeting for first time at cafe, standing, slightly nervous posture, eye contact, soft daylight, full body 3/4 view"),
    # ---- intimate / NSFW (trust 5+) ----
    ("couple/standing_kiss_wall.png", "couple in passionate standing kiss, him lifting her against a wall, her legs wrapped around his waist, full body side view"),
    ("couple/lap_makeout.png", "couple making out on couch, woman sitting on man's lap facing him, deep kiss, her hands in his hair, full body front view"),
    ("couple/bedside_intimate.png", "woman sitting on edge of bed, partner standing in front of her between her legs, intimate, full body front view"),
    ("couple/shower_washing.png", "couple in shower, woman washing man's hair or shoulders, intimate moment, water streaming, full body side view"),
    # ---- morning / domestic (trust 7+) ----
    ("couple/cooking_together.png", "couple cooking together in kitchen, back to back, her stirring pot, him chopping vegetables, cozy kitchen light, full body"),
    ("couple/brunch_table.png", "couple at brunch table, sitting across from each other, eye contact, coffee cups, soft morning light through window, full body"),
    ("couple/waking_up_couple.png", "couple in bed waking up, lying face to face, soft smile, bedhead hair, morning light, upper body and pillows"),
    ("couple/laundry_together.png", "couple doing laundry together, throwing clothes at each other playfully, laundry basket, soft indoor light, full body fun pose"),
    # ---- gece / public ----
    ("couple/rooftop_stars.png", "couple lying on rooftop under blanket, watching stars, her head on his chest, night sky, full body side view"),
    ("couple/taxi_ride.png", "couple in backseat of taxi at night, her head on his shoulder, his arm around her, city lights through window, full body"),
    ("couple/park_bench.png", "couple sitting on park bench at sunset, shoulder to shoulder, her head on his shoulder, golden hour, full body side view"),
    # ---- outdoor / tatil ----
    ("couple/beach_sunset.png", "couple on beach at sunset, embracing from behind, watching sun set over ocean, golden light, full body rear view"),
    ("couple/picnic_blanket.png", "couple on picnic blanket in grass, sitting side by side, sharing food, sunny day, full body 3/4 view"),
    ("couple/hiking_peak.png", "couple at mountain peak, holding hands, looking at view, hiking gear, blue sky, full body front view"),
    ("couple/boat_ride.png", "couple on small boat, her sitting between his legs, his arms around her, water around, sunny day, full body rear view"),
    # ---- parti / kutlama ----
    ("couple/party_grind.png", "couple dancing close at club, her back against his chest, his hands on her hips, dark club lights, full body"),
    ("couple/new_year_kiss.png", "couple kissing at midnight new year, fireworks in background, party attire, champagne glass, full body"),
    ("couple/anniversary_dance.png", "couple slow dancing at anniversary, candle light, formal attire, his hand on her back, full body side view"),
    # ---- spicy (trust 9+) ----
    ("couple/shower_intimate.png", "couple in shower in intimate embrace, water streaming, his arms around her from behind, full body side view"),
    ("couple/pool_hot_tub.png", "couple in hot tub or pool, embracing in water, steam rising, her back against his chest, full body side view"),
    ("couple/balcony_night.png", "couple on apartment balcony at night, his arms around her from behind, looking at city lights, full body rear view"),

    # ---- solo (günlük hayat + fitness) ----
    ("solo/selfie_couch.png", "single woman taking selfie on couch, legs crossed, casual clothes, soft indoor light, full body front view"),
    ("solo/squatting.png", "single woman in deep squat position, fitness pose, gym clothes, full body front view"),
    ("solo/stretching_yoga.png", "single woman in yoga stretching pose, downward dog or warrior, yoga mat, gym clothes, full body side view"),

    # ---- office (iş hayatı, günlük) ----
    ("office/presentation_pose.png", "single woman giving a presentation, standing in front of whiteboard, gesturing with hand, business clothes, office background, full body"),
    ("office/desk_working.png", "single woman working at office desk, sitting upright, laptop open, focus expression, business casual, side view, full body"),
    ("office/water_cooler.png", "single woman at office water cooler, refilling bottle, casual pose, office background, full body side view"),

    # ---- work (genel, sahadan) ----
    ("work/laptop_cafe.png", "single woman working on laptop at cafe, sitting at small table, latte on side, casual clothes, cafe background, full body side view"),
    ("work/standing_desk.png", "single woman working at standing desk, focused, computer screen visible, business casual, office background, full body side view"),

    # ---- party / club (gece hayatı) ----
    ("party/club_dancing.png", "single woman dancing in club, arms raised, cocktail dress, club lights, full body dynamic pose"),
    ("party/cocktail_bar.png", "single woman sitting at cocktail bar, drink in hand, cocktail dress, bar background, full body 3/4 view"),
    ("party/balcony_smoking.png", "single woman on party balcony at night, leaning on railing, cocktail dress, looking at city lights, full body rear view"),

    # ---- beach / outdoor (yaz, tatil) ----
    ("beach/beach_walking.png", "single woman walking on beach, sundress, barefoot on sand, ocean in background, full body side view"),
    ("beach/poolside.png", "single woman at poolside, sitting on lounge chair, bikini, sunglasses, sun, full body 3/4 view"),
    ("beach/sunbathing.png", "single woman sunbathing on beach towel, lying on stomach, bikini, full body top view"),

    # ---- home / domestic (günlük ev hayatı) ----
    ("home/cooking.png", "single woman cooking in kitchen, standing at counter, casual home clothes, kitchen background, full body side view"),
    ("home/reading_book.png", "single woman reading book on couch, legs tucked under, cozy sweater, soft lamp light, full body side view"),
    ("home/couch_tv.png", "single woman watching TV on couch, sitting upright, remote in hand, casual home clothes, full body front view"),

    # ---- public tease (gerçekçi, off-office) ----
    ("public/car_backseat.png", "couple in backseat of car, kissing, her hand on his chest, intimate, full body side view through window"),
    ("public/taxi_backseat.png", "single woman in backseat of taxi, looking out window, profile view, casual clothes, full body side view"),
]

NEG = "lowres, bad anatomy, deformed, extra limbs, missing limbs, mutation, blurry, watermark, text, multiple views, cropped"
PREFIX = "score_9, score_8_up, score_7_up, simple background, clear full body composition, "

def build_wf(prompt, seed):
    return {
        "4": {"inputs": {"ckpt_name": MODEL}, "class_type": "CheckpointLoaderSimple"},
        "5": {"inputs": {"width": 832, "height": 1216, "batch_size": 1}, "class_type": "EmptyLatentImage"},
        "6": {"inputs": {"text": PREFIX + prompt, "clip": ["4", 1]}, "class_type": "CLIPTextEncode"},
        "7": {"inputs": {"text": NEG, "clip": ["4", 1]}, "class_type": "CLIPTextEncode"},
        "3": {"inputs": {"seed": seed, "steps": 26, "cfg": 6, "sampler_name": "euler_ancestral",
                          "scheduler": "karras", "denoise": 1, "model": ["4", 0],
                          "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0]},
               "class_type": "KSampler"},
        "8": {"inputs": {"samples": ["3", 0], "vae": ["4", 2]}, "class_type": "VAEDecode"},
        "9": {"inputs": {"filename_prefix": "poseref", "images": ["8", 0]}, "class_type": "SaveImage"},
    }

def post(path, data):
    req = urllib.request.Request(COMFY + path, data=json.dumps(data).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())

def get(path):
    return json.loads(urllib.request.urlopen(COMFY + path, timeout=30).read())

def main():
    for i, (relpath, prompt) in enumerate(POSES):
        out = os.path.join(HERE, relpath)
        print(f"[{i+1}/{len(POSES)}] {relpath} ...", flush=True)
        seed = 1000 + i * 7
        pid = post("/prompt", {"prompt": build_wf(prompt, seed)})["prompt_id"]
        # poll history
        fname = None
        for _ in range(120):
            time.sleep(2)
            h = get(f"/history/{pid}")
            if pid in h:
                outs = h[pid].get("outputs", {})
                for nid, o in outs.items():
                    if "images" in o and o["images"]:
                        fname = o["images"][0]["filename"]
                        sub = o["images"][0].get("subfolder", "")
                        break
                if fname:
                    break
        if not fname:
            print(f"   ✗ üretilemedi (timeout)")
            continue
        # download
        q = f"/view?filename={urllib.parse.quote(fname)}&type=output"
        if sub:
            q += f"&subfolder={urllib.parse.quote(sub)}"
        img = urllib.request.urlopen(COMFY + q, timeout=30).read()
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "wb") as f:
            f.write(img)
        print(f"   ✓ kaydedildi ({len(img)//1024} KB)")

if __name__ == "__main__":
    import urllib.parse
    main()
