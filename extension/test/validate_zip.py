"""校验扩展产出的 ZIP 与服务端落盘结果。

用法：
  python validate_zip.py <zip路径> <fixture目录>
  python validate_zip.py <zip路径> <fixture目录> <服务器地址> <原型ID>   # 追加校验落盘目录
"""

import os
import sqlite3
import sys
import zipfile


def walk(root_dir):
    out = set()
    for base, _dirs, files in os.walk(root_dir):
        for name in files:
            rel = os.path.relpath(os.path.join(base, name), root_dir).replace("\\", "/")
            out.add(rel)
    return out


def main():
    zip_path, fixture_dir = sys.argv[1], sys.argv[2]

    expected = {n for n in walk(fixture_dir) if n != "images/孤立文件.png"}
    with zipfile.ZipFile(zip_path) as zf:
        bad = zf.testzip()
        names = {i.filename for i in zf.infolist() if not i.is_dir()}
        if bad is not None:
            print(f"ZIP_BAD 首个损坏文件: {bad}")
            return 1
        if names != expected:
            print("ZIP_BAD 文件集合不一致")
            print("  缺少:", sorted(expected - names))
            print("  多余:", sorted(names - expected))
            return 1
        mismatched = []
        for name in sorted(names):
            with zf.open(name) as fp:
                packed = fp.read()
            with open(os.path.join(fixture_dir, name.replace("/", os.sep)), "rb") as fp:
                source = fp.read()
            if packed != source:
                mismatched.append(name)
        if mismatched:
            print("ZIP_BAD 内容不一致:", mismatched)
            return 1
        # 文本资源应走 deflate（过小或不可压缩时回退 store 是预期行为），已压缩的图片同理
        MIN_DEFLATE_BYTES = 512
        store_only = [
            i.filename
            for i in zf.infolist()
            if i.filename.lower().endswith((".html", ".js", ".css"))
            and i.file_size >= MIN_DEFLATE_BYTES
            and i.compress_type != zipfile.ZIP_DEFLATED
        ]
        deflated = sum(1 for i in zf.infolist() if i.compress_type == zipfile.ZIP_DEFLATED)
        raw = sum(1 for i in zf.infolist() if i.compress_type == zipfile.ZIP_STORED)
        if store_only:
            print("COMP_BAD 可压缩文本条目未压缩:", store_only)
            return 1
        if not deflated:
            print("COMP_BAD 没有任何条目走 deflate")
            return 1
        text_total = sum(
            1
            for i in zf.infolist()
            if i.filename.lower().endswith((".html", ".js", ".css")) and i.file_size >= MIN_DEFLATE_BYTES
        )
        shrunk = all(
            i.compress_size < i.file_size
            for i in zf.infolist()
            if i.compress_type == zipfile.ZIP_DEFLATED
        )
        if not shrunk:
            print("COMP_BAD deflate 条目压缩后未变小")
            return 1
        print(f"ZIP_OK 条目 {len(names)} 全部可解压且字节一致")
        print(f"COMP_OK deflate={deflated} stored={raw}（其中 {text_total} 个达标文本条目全部变小）")

    if len(sys.argv) > 4:
        _server, proto_id = sys.argv[3], int(sys.argv[4])
        fixture_dir = os.path.abspath(fixture_dir)
        repo_dir = os.path.dirname(os.path.dirname(os.path.dirname(fixture_dir)))
        db_path = os.path.join(repo_dir, "instance", "app.db")
        proto_dir = os.path.join(repo_dir, "uploads", "prototypes")
        conn = sqlite3.connect(db_path)
        try:
            uuid = conn.execute("select uuid from prototype where id=?", (proto_id,)).fetchone()[0]
        finally:
            conn.close()
        proto_dir = os.path.join(proto_dir, uuid)
        if not os.path.isdir(proto_dir):
            print("STORE_BAD 未找到解压目录", proto_dir)
            return 1
        stored = walk(proto_dir)
        if stored != expected:
            print("STORE_BAD 落盘集合不一致")
            print("  缺少:", sorted(expected - stored))
            print("  多余:", sorted(stored - expected))
            return 1
        for name in sorted(stored):
            # 服务端 process_ai 会把 AI 挂件注入并改写落盘的 HTML，故 HTML 只比存在性
            if name.lower().endswith((".html", ".htm")):
                continue
            a = os.path.getsize(os.path.join(proto_dir, name.replace("/", os.sep)))
            b = os.path.getsize(os.path.join(fixture_dir, name.replace("/", os.sep)))
            if a != b:
                print("STORE_BAD 大小不一致", name, a, b)
                return 1
        html_ok = all(
            os.path.exists(os.path.join(proto_dir, n.replace("/", os.sep)))
            for n in stored
            if n.lower().endswith((".html", ".htm"))
        )
        if not html_ok:
            print("STORE_BAD HTML 条目缺失")
            return 1
        print(f"STORE_OK 服务端解压目录 {len(stored)} 个文件与源一致（HTML 由服务端注入挂件后体积会变）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
