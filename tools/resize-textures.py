#!/usr/bin/env python3
"""
Resize textures > 512x512 down to max 484x484 while preserving aspect ratio.
Also updates companion Cocos Creator .meta sprite-frame dimensions & vertex buffers.
"""

import os
import sys
import json
from PIL import Image

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

def sprite_frame_vertices(width, height):
    half_w = width / 2.0
    half_h = height / 2.0
    return {
        "rawPosition": [
            -half_w, -half_h, 0,
            half_w, -half_h, 0,
            -half_w, half_h, 0,
            half_w, half_h, 0
        ],
        "indexes": [0, 1, 2, 2, 1, 3],
        "uv": [0, height, width, height, 0, 0, width, 0],
        "nuv": [0, 0, 1, 0, 0, 1, 1, 1],
        "minPos": [-half_w, -half_h, 0],
        "maxPos": [half_w, half_h, 0]
    }

def update_meta_file(meta_path, new_width, new_height):
    if not os.path.exists(meta_path):
        return False
    try:
        with open(meta_path, 'r', encoding='utf-8') as f:
            meta = json.load(f)
        
        changed = False
        sub_metas = meta.get('subMetas', {})
        for sub_id, sub_meta in sub_metas.items():
            if sub_meta.get('importer') == 'sprite-frame':
                user_data = sub_meta.setdefault('userData', {})
                user_data['width'] = new_width
                user_data['height'] = new_height
                user_data['rawWidth'] = new_width
                user_data['rawHeight'] = new_height
                user_data['vertices'] = sprite_frame_vertices(new_width, new_height)
                changed = True
        
        if changed:
            with open(meta_path, 'w', encoding='utf-8') as f:
                json.dump(meta, f, indent=2)
                f.write('\n')
            return True
    except Exception as e:
        print(f"  [WARN] Failed to update meta {meta_path}: {e}")
    return False

def resize_textures(target_dir='assets', max_bound=484, threshold=512, dry_run=False, skip_prefix=('bg_',)):
    print(f"Scanning '{target_dir}' for textures > {threshold}x{threshold} (target max: {max_bound}, skipping prefix {skip_prefix})...")
    processed = []
    
    for root, _, files in os.walk(target_dir):
        for f in files:
            if any(f.startswith(prefix) for prefix in skip_prefix):
                continue
            ext = os.path.splitext(f)[1].lower()
            if ext in ['.png', '.jpg', '.jpeg', '.webp', '.tga', '.bmp']:
                full_path = os.path.join(root, f)
                try:
                    with Image.open(full_path) as img:
                        w, h = img.size
                        if w > threshold or h > threshold:
                            scale = float(max_bound) / max(w, h)
                            nw = max(1, round(w * scale))
                            nh = max(1, round(h * scale))
                            mode = img.mode
                            fmt = img.format or ext.replace('.', '').upper()
                            size_before = os.path.getsize(full_path)
                            processed.append({
                                'path': full_path,
                                'old_size': (w, h),
                                'new_size': (nw, nh),
                                'bytes_before': size_before,
                                'mode': mode,
                                'format': fmt,
                                'ext': ext
                            })
                except Exception as e:
                    print(f"  [ERROR] Could not read {full_path}: {e}")

    print(f"Found {len(processed)} textures to resize.\n")
    
    total_bytes_before = 0
    total_bytes_after = 0

    for item in processed:
        path = item['path']
        w, h = item['old_size']
        nw, nh = item['new_size']
        rel_path = os.path.relpath(path).replace('\\', '/')
        bytes_before = item['bytes_before']
        total_bytes_before += bytes_before

        if not dry_run:
            with Image.open(path) as img:
                # Use Lanczos resampling
                resample_filter = Image.Resampling.LANCZOS if hasattr(Image, 'Resampling') else Image.LANCZOS
                resized = img.resize((nw, nh), resample_filter)
                
                # Save based on format
                if item['ext'] == '.png':
                    resized.save(path, format='PNG', optimize=True)
                elif item['ext'] in ['.jpg', '.jpeg']:
                    resized.save(path, format='JPEG', quality=90, optimize=True)
                elif item['ext'] == '.webp':
                    resized.save(path, format='WEBP', quality=90)
                else:
                    resized.save(path)
            
            bytes_after = os.path.getsize(path)
            total_bytes_after += bytes_after
            meta_updated = update_meta_file(f"{path}.meta", nw, nh)
            
            savings_pct = (1.0 - (bytes_after / bytes_before)) * 100 if bytes_before > 0 else 0
            print(f"[OK] {rel_path}")
            print(f"     {w}x{h} -> {nw}x{nh} | {bytes_before / 1024:.1f} KB -> {bytes_after / 1024:.1f} KB (-{savings_pct:.1f}%){' [meta updated]' if meta_updated else ''}")
        else:
            print(f"[DRY-RUN] {rel_path}: {w}x{h} -> {nw}x{nh} ({bytes_before / 1024:.1f} KB)")

    if not dry_run and processed:
        total_saved_kb = (total_bytes_before - total_bytes_after) / 1024
        pct = (1.0 - (total_bytes_after / total_bytes_before)) * 100 if total_bytes_before > 0 else 0
        print(f"\n==========================================")
        print(f"SUCCESS: Resized {len(processed)} texture(s)")
        print(f"Disk Size: {total_bytes_before / 1024:.1f} KB -> {total_bytes_after / 1024:.1f} KB (Saved {total_saved_kb:.1f} KB, -{pct:.1f}%)")
        print(f"==========================================")

if __name__ == '__main__':
    dry = '--dry-run' in sys.argv
    threshold = 484
    for arg in sys.argv[1:]:
        if arg.startswith('--threshold='):
            threshold = int(arg.split('=')[1])
        elif arg.startswith('--max='):
            max_bound = int(arg.split('=')[1])
    resize_textures(dry_run=dry, threshold=threshold, max_bound=484, skip_prefix=('bg_',))

