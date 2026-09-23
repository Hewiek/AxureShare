#!/usr/bin/env python3
"""将 extension/ 目录打包为 dist/axureshare-upload-helper-{version}.zip。"""

from __future__ import annotations

import io
import json
import os
import re
import sys
import zipfile
from pathlib import Path

# 项目根目录（本脚本所在仓库的根）
BASE_DIR = Path(__file__).resolve().parent.parent

# extension/ 下需要纳入包的文件（相对于 extension/ 的相对路径）
INCLUDE_FILES = [
    "manifest.json",
    "background.js",
    "content.js",
    "content.css",
    "popup.html",
    "popup.js",
    "popup.css",
    "login.html",
    "login.js",
    "login.css",
    "config.js",
    # lib 目录
    "lib/api.js",
    "lib/discover.js",
    "lib/gather.js",
    "lib/picker.js",
    "lib/zip.js",
]

# 从 extension/manifest.json 读取版本号
def read_version() -> str:
    manifest = BASE_DIR / "extension" / "manifest.json"
    data = json.loads(manifest.read_text(encoding="utf-8"))
    version = data.get("version", "0.0.0")
    if not re.match(r"^\d+\.\d+\.\d+", str(version)):
        raise ValueError(f"manifest.json 中的版本号格式异常: {version}")
    return str(version)


def build_zip(version: str) -> Path:
    dist_dir = BASE_DIR / "dist"
    dist_dir.mkdir(parents=True, exist_ok=True)
    out_path = dist_dir / f"axureshare-upload-helper-{version}.zip"

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel in INCLUDE_FILES:
            src = BASE_DIR / "extension" / rel
            if not src.is_file():
                print(f"  [跳过] {rel}（源文件不存在）")
                continue
            zf.write(src, rel)
            print(f"  [加入] {rel}")

    out_path.write_bytes(buf.getvalue())
    size_kb = out_path.stat().st_size / 1024
    print(f"\n✓ 已生成: {out_path}")
    print(f"  版本: {version}  大小: {size_kb:.1f} KB")
    return out_path


def main() -> None:
    print("=== AxureShare 扩展打包 ===\n")
    version = read_version()
    print(f"读取到版本号: {version}\n")
    build_zip(version)


if __name__ == "__main__":
    main()
