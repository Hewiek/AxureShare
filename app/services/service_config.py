"""服务配置：管理员在后台维护的键值参数（DB 优先，环境变量兜底）。"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

from app.extensions import db
from app.models import SystemConfig


@dataclass(frozen=True)
class ConfigSpec:
    """已知配置项的展示与回退定义。"""

    key: str
    label: str
    category: str
    secret: bool = False
    placeholder: str = ""
    help_text: str = ""
    env_fallbacks: tuple[str, ...] = field(default_factory=tuple)


KNOWN_CONFIGS: tuple[ConfigSpec, ...] = (
    ConfigSpec(
        key="SQLALCHEMY_DATABASE_URI",
        label="数据库连接串",
        category="服务器",
        secret=True,
        placeholder="sqlite:///app.db",
        help_text="仅在应用启动时读取，修改后需重启服务生效。",
        env_fallbacks=("SQLALCHEMY_DATABASE_URI",),
    ),
    ConfigSpec(
        key="SITE_BASE_URL",
        label="站点访问地址",
        category="服务器",
        placeholder="http://127.0.0.1:5000",
        help_text="对外分享原型链接时使用的服务器基础地址；浏览器扩展的「服务器地址」也由此下发。",
        env_fallbacks=("SITE_BASE_URL",),
    ),
    ConfigSpec(
        key="STORAGE_QUOTA_MB",
        label="存储配额 (MB)",
        category="服务器",
        placeholder="1024",
        help_text="原型列表侧边栏展示的存储总配额，仅用于展示。",
        env_fallbacks=("STORAGE_QUOTA_MB",),
    ),
    ConfigSpec(
        key="STORAGE_MODE",
        label="存储方式",
        category="存储配置",
        placeholder="local",
        help_text="local=本地文件夹；sftp=上传到 SFTP 服务器。请在「存储配置」页顶部的存储方式设置中选择。",
        env_fallbacks=("STORAGE_MODE",),
    ),
    ConfigSpec(
        key="STORAGE_TOTAL_MB",
        label="可支配总空间 (MB)",
        category="存储配置",
        placeholder="10240",
        help_text="所有用户可用空间之和必须小于该值。本地模式默认 10G，服务器模式请填写服务器实际可支配空间。",
        env_fallbacks=("STORAGE_TOTAL_MB",),
    ),
    ConfigSpec(
        key="STORAGE_LOCAL_FOLDER",
        label="本地存储文件夹",
        category="存储配置",
        placeholder="如 D:\\prototype_files 或 /data/prototype_files",
        help_text="本地存储模式下新上传原型文件的存放根目录（其下自动分 prototypes/source_files/attachments 子目录）。",
        env_fallbacks=("STORAGE_LOCAL_FOLDER",),
    ),
    ConfigSpec(
        key="SFTP_HOST",
        label="SFTP 服务器地址",
        category="存储配置",
        placeholder="如 192.168.1.10",
        help_text="服务器存储模式下的 SFTP 主机地址。",
        env_fallbacks=("SFTP_HOST",),
    ),
    ConfigSpec(
        key="SFTP_PORT",
        label="SFTP 端口",
        category="存储配置",
        placeholder="22",
        env_fallbacks=("SFTP_PORT",),
    ),
    ConfigSpec(
        key="SFTP_USER",
        label="SFTP 用户名",
        category="存储配置",
        env_fallbacks=("SFTP_USER",),
    ),
    ConfigSpec(
        key="SFTP_PASSWORD",
        label="SFTP 密码",
        category="存储配置",
        secret=True,
        help_text="留空则不覆盖已保存的密码。",
        env_fallbacks=("SFTP_PASSWORD",),
    ),
    ConfigSpec(
        key="SFTP_REMOTE_DIR",
        label="服务器存放目录",
        category="存储配置",
        placeholder="如 /srv/prototype_files",
        help_text="原型文件在 SFTP 服务器上的存放根目录（其下自动分 prototypes/source_files/attachments 子目录）。",
        env_fallbacks=("SFTP_REMOTE_DIR",),
    ),
)

_KNOWN_BY_KEY: dict[str, ConfigSpec] = {spec.key: spec for spec in KNOWN_CONFIGS}


def get_spec(key: str) -> ConfigSpec | None:
    return _KNOWN_BY_KEY.get(key)


def get_config(key: str, default: str = "") -> str:
    """读取配置值：数据库优先，其次环境变量列表，最后 default。"""

    row = SystemConfig.query.filter_by(key=key).first()
    if row and row.value.strip():
        return row.value.strip()
    spec = _KNOWN_BY_KEY.get(key)
    env_names = spec.env_fallbacks if spec else (key,)
    for env_name in env_names:
        value = os.environ.get(env_name, "").strip()
        if value:
            return value
    return default


def is_from_db(key: str) -> bool:
    row = SystemConfig.query.filter_by(key=key).first()
    return bool(row and row.value.strip())


def set_config(key: str, value: str, user_id: int | None = None) -> SystemConfig:
    row = SystemConfig.query.filter_by(key=key).first()
    if not row:
        row = SystemConfig(key=key)
        db.session.add(row)
    row.value = value.strip()
    row.updated_by_id = user_id
    db.session.commit()
    return row


def delete_config(key: str) -> None:
    row = SystemConfig.query.filter_by(key=key).first()
    if row:
        db.session.delete(row)
        db.session.commit()


def mask_value(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "****"
    return f"{value[:4]}...{value[-4:]}"


def resolve_for_display(key: str) -> dict[str, Any]:
    """返回某配置项的展示信息：当前值、来源（数据库/环境变量/默认值）。"""

    spec = _KNOWN_BY_KEY.get(key)
    row = SystemConfig.query.filter_by(key=key).first()
    value = ""
    source = "default"
    if row and row.value.strip():
        value = row.value.strip()
        source = "db"
    else:
        for env_name in (spec.env_fallbacks if spec else (key,)):
            env_value = os.environ.get(env_name, "").strip()
            if env_value:
                value = env_value
                source = f"env:{env_name}"
                break
    return {
        "spec": spec,
        "key": key,
        "value": value,
        "stored_value": row.value if row else "",
        "source": source,
        "updated_at": row.updated_at if row else None,
        "updated_by": row.updated_by.username if row and row.updated_by else None,
    }
