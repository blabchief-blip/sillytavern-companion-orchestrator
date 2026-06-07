#!/usr/bin/env python3
"""
Poz kütüphanesi self-bootstrap: her poz tipinden bir referans görseli
ComfyUI'da (txt2img) üretip pose-library/ altına kaydeder.
Bu görseller ControlNet depth preprocessor'a beslenir (vücut duruşu kaynağı).
"""
import json, time, urllib.request, urllib.error, os, sys

COMFY = "http://192.168.68.67:8001"
HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = "cyberrealisticPony_v170.safetensors"

# (dosya yolu, poz açıklaması) — depth için net tam-boy vücut duruşu önemli
POSES = [
    ("explicit/missionary.png",  "two people having sex, missionary position, woman lying on her back on bed, legs raised and apart, man on top between her legs, full body view"),
    ("explicit/cowgirl.png",     "woman riding on top, cowgirl position, sitting upright straddling partner lying down, full body side view"),
    ("explicit/doggystyle.png",  "woman on all fours on bed, kneeling on hands and knees, partner behind, rear view, full body"),
    ("explicit/oral.png",        "person kneeling between partner's legs, oral sex pose, partner lying back, full body view"),
    ("explicit/spooning.png",    "couple lying on their sides spooning, both bodies parallel on bed, side view full body"),
    ("couple/straddling.png",    "woman straddling partner who is sitting, facing each other, sitting on lap, full body"),
    ("couple/against_wall.png",  "couple standing pressed against a wall, embracing face to face, standing full body"),
    ("couple/embrace.png",       "couple standing embracing in a tight hug, face to face, full body"),
    ("couple/kiss.png",          "couple standing close kissing, face to face, upper body and full body"),
    ("solo/lying.png",           "single woman lying on her back on a bed, relaxed, legs slightly apart, full body view from above"),
    ("solo/arching.png",         "single woman on bed arching her back, kneeling, full body side view"),
    ("solo/sitting.png",         "single woman sitting on edge of bed, upright, full body front view"),
    ("solo/standing.png",        "single woman standing straight, full body front view, natural pose"),
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
