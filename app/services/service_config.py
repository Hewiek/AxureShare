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
        key="MAIN_AI_BASE_URL",
        label="主模型服务地址",
        category="AI 服务",
        placeholder="https://api.xiaomimimo.com/v1",
        help_text="OpenAI 兼容接口的 Base URL，留空则使用环境变量或默认值。",
        env_fallbacks=("MAIN_AI_BASE_URL",),
    ),
    ConfigSpec(
        key="MAIN_AI_API_KEY",
        label="主模型 API Key",
        category="AI 服务",
        secret=True,
        help_text="调用主模型问答服务使用的密钥。",
        env_fallbacks=("MAIN_AI_API_KEY",),
    ),
    ConfigSpec(
        key="MAIN_AI_MODEL",
        label="主模型名称",
        category="AI 服务",
        placeholder="mimo-v2-flash",
        env_fallbacks=("MAIN_AI_MODEL", "AIN_AI_MODEL"),
    ),
    ConfigSpec(
        key="SILICONFLOW_BASE_URL",
        label="向量模型服务地址",
        category="向量/Embedding 服务",
        placeholder="https://api.siliconflow.cn/v1",
        env_fallbacks=("SILICONFLOW_BASE_URL",),
    ),
    ConfigSpec(
        key="SILICONFLOW_API_KEY",
        label="向量模型 API Key",
        category="向量/Embedding 服务",
        secret=True,
        help_text="调用 Embedding 服务使用的密钥，未配置时知识库检索不可用。",
        env_fallbacks=("SILICONFLOW_API_KEY",),
    ),
    ConfigSpec(
        key="EMBEDDING_MODEL",
        label="向量模型名称",
        category="向量/Embedding 服务",
        placeholder="BAAI/bge-m3",
        env_fallbacks=("EMBEDDING_MODEL",),
    ),
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
        help_text="项目列表侧边栏展示的存储总配额，仅用于展示。",
        env_fallbacks=("STORAGE_QUOTA_MB",),
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
    if spec:
        for env_name in spec.env_fallbacks:
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
    elif spec:
        for env_name in spec.env_fallbacks:
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
