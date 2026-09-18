"""本地环境初始化：目录、.env、数据库。

用 .venv 的 python 运行：python scripts/init_local.py
可重复执行；不会改动已有数据库。
"""

from __future__ import annotations

import os
import secrets
import subprocess
import sys
import types
from importlib import util as importlib_util

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(BASE_DIR, ".env")
ENV_EXAMPLE_PATH = os.path.join(BASE_DIR, ".env.example")
DB_PATH = os.path.join(BASE_DIR, "instance", "app.db")

REQUIRED_DIRS = (
    "instance",
    os.path.join("uploads", "prototypes"),
    os.path.join("uploads", "source_files"),
    os.path.join("uploads", "attachments"),
)


def log(step: str, message: str) -> None:
    print(f"[{step}] {message}")


def ensure_dirs() -> None:
    for rel in REQUIRED_DIRS:
        path = os.path.join(BASE_DIR, rel)
        os.makedirs(path, exist_ok=True)
    log("dirs", "已就绪: " + ", ".join(REQUIRED_DIRS))


def read_example_settings() -> list[str]:
    """取 .env.example 的非密钥项原值，密钥项留空待填。"""

    fallback = [
        "MAIN_AI_BASE_URL=https://api.deepseek.com",
        "MAIN_AI_MODEL=deepseek-chat",
        "SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1",
        "EMBEDDING_MODEL=BAAI/bge-m3",
    ]
    if not os.path.exists(ENV_EXAMPLE_PATH):
        return fallback

    result: list[str] = []
    with open(ENV_EXAMPLE_PATH, "r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = (part.strip() for part in line.split("=", 1))
            if "API_KEY" in key.upper() or "*" in value:
                result.append(f"{key}=")
            else:
                result.append(f"{key}={value}")
    return result or fallback


def ensure_env() -> None:
    if os.path.exists(ENV_PATH):
        log("env", ".env 已存在，跳过")
        return

    lines = [
        "# 应用安全密钥（init_local.py 生成）",
        f"SECRET_KEY={secrets.token_hex(32)}",
        f"HASHIDS_SALT={secrets.token_hex(16)}",
        "HASHIDS_MIN_LENGTH=6",
        "",
        "# AI 答疑功能：只需填 API_KEY，填好后自动开启；不填则相关功能关闭，其余不受影响",
        "# 注意：BASE_URL / MODEL 不要留空，留空会覆盖代码里的默认值导致请求失败",
    ]
    lines.extend(read_example_settings())

    with open(ENV_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")
    log("env", f"已生成 .env（密钥随机，AI 密钥待填）: {ENV_PATH}")


def load_models_module():
    """加载 app.models，但不执行 app/__init__.py（它在导入时即 create_app）。"""

    pkg = types.ModuleType("app")
    pkg.__path__ = [os.path.join(BASE_DIR, "app")]
    sys.modules.setdefault("app", pkg)
    sys.path.insert(0, BASE_DIR)

    from flask import Flask

    from app.extensions import db

    for name in ("extensions", "models"):
        module_name = f"app.{name}"
        if module_name in sys.modules:
            continue
        spec = importlib_util.spec_from_file_location(module_name, os.path.join(BASE_DIR, "app", f"{name}.py"))
        module = importlib_util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)

    import app.models  # noqa: F401  注册所有表

    return Flask, db


def existing_tables() -> list[str]:
    if not os.path.exists(DB_PATH):
        return []
    import sqlite3

    conn = sqlite3.connect(DB_PATH)
    try:
        rows = conn.execute("select name from sqlite_master where type='table'").fetchall()
    finally:
        conn.close()
    return sorted(r[0] for r in rows)


def init_database() -> None:
    tables = existing_tables()
    business_tables = [t for t in tables if t != "alembic_version"]
    if business_tables:
        log("db", f"数据库已有 {len(business_tables)} 张表，未做任何修改（迁移版本见 flask db current）")
        return

    Flask, db = load_models_module()
    flask_app = Flask("init_local")
    flask_app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + DB_PATH.replace("\\", "/")
    flask_app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    db.init_app(flask_app)
    with flask_app.app_context():
        db.create_all()

    # 迁移链缺少建表的初始版本，全新库无法 flask db upgrade，故直接标记到 head
    env = dict(os.environ, FLASK_APP="app.py")
    subprocess.run(
        [sys.executable, "-m", "flask", "db", "stamp", "head"],
        cwd=BASE_DIR,
        env=env,
        check=True,
        stdout=subprocess.DEVNULL,
    )
    with flask_app.app_context():
        rows = [r[0] for r in db.session.execute(db.text("select name from sqlite_master where type='table' order by name"))]
    log("db", f"已建表并标记迁移版本为 head: {DB_PATH}")
    log("db", "表: " + ", ".join(rows))


def main() -> int:
    if not os.path.exists(os.path.join(BASE_DIR, "app")):
        print("请在项目根目录的虚拟环境中运行本脚本", file=sys.stderr)
        return 1
    try:
        import flask  # noqa: F401
    except ImportError:
        print("未检测到 Flask，请先安装依赖：pip install -r requirements.txt", file=sys.stderr)
        return 1

    ensure_dirs()
    ensure_env()
    init_database()
    print("\n下一步：python app.py  → http://localhost:7855 （默认管理员 admin/123456，请尽快改密码）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
