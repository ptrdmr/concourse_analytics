#!/usr/bin/env python3
"""
generate_specialty_cocktails_json.py

Reads config/specialty_cocktails.txt and writes public/data/specialty_cocktails.json
Run when the specialty cocktail list changes.
"""

import json
import os

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_FILE = os.path.join(_ROOT, 'config', 'specialty_cocktails.txt')
OUTPUT_FILE = os.path.join(_ROOT, 'public', 'data', 'specialty_cocktails.json')


def main():
    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        names = [line.strip() for line in f if line.strip()]

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(names, f, indent=2)

    print(f'Wrote {len(names)} specialty cocktails to {OUTPUT_FILE}')


if __name__ == '__main__':
    main()
