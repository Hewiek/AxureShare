"""Jinja2 模板过滤器。"""

from datetime import datetime, timedelta

def datetime_cn(value: datetime | None, format: str = "%Y-%m-%d %H:%M") -> str:
    """将 UTC 时间转换为北京时间并格式化。
    
    Args:
        value: UTC 时间对象
        format: 格式化字符串
        
    Returns:
        格式化后的北京时间字符串
    """
    if value is None:
        return ""
    
    # 转换为北京时间 (UTC+8)
    beijing_time = value + timedelta(hours=8)
    return beijing_time.strftime(format)

def file_size_cn(value: int | float | None) -> str:
    """将字节数格式化为易读的空间大小（B/KB/MB/GB/TB）。"""

    try:
        size = float(value or 0)
    except (TypeError, ValueError):
        size = 0.0
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024:
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.2f} {unit}"
        size /= 1024
    return f"{size:.2f} TB"
