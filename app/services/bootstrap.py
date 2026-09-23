"""启动阶段的初始化逻辑。"""

from __future__ import annotations

from sqlalchemy import inspect, text

from app.extensions import db
from app.models import User


def ensure_user_contact_columns() -> None:
    """为已存在的 user 表补充 phone 列（轻量级 SQLite 迁移）。"""

    inspector = inspect(db.engine)
    if "user" not in inspector.get_table_names():
        return
    columns = {c["name"] for c in inspector.get_columns("user")}
    with db.engine.begin() as conn:
        if "phone" not in columns:
            conn.execute(text("ALTER TABLE user ADD COLUMN phone VARCHAR(20)"))
        if "storage_quota_mb" not in columns:
            conn.execute(text("ALTER TABLE user ADD COLUMN storage_quota_mb INTEGER DEFAULT 1024"))


def ensure_default_admin() -> None:
    """确保存在默认管理员账户。"""

    if User.query.filter_by(username="admin").first():
        return
    admin_user = User(username="admin", role="admin")
    admin_user.set_password("123456")
    db.session.add(admin_user)
    db.session.commit()

