"""原型文件存储服务。

支持两种存储方式（在「存储配置」页选择）：
- local：保存到管理员配置的本地文件夹（未配置时使用应用默认 uploads 目录）；
- sftp：上传到 SFTP 服务器的存放目录，本地仅保留只读缓存。

历史存量文件保持原位，读取时按「默认目录 → 当前本地目录 → 服务器缓存」顺序解析。
"""

from __future__ import annotations

import os
import posixpath
import shutil
import zipfile
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterator

from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename

from app.services import service_config


class ZipFileInvalidError(Exception):
    """ZIP 文件无效或损坏。"""


@dataclass(frozen=True)
class PrototypeFilesService:
    """原型相关文件的保存、删除与解压（本地 / SFTP 双模式）。"""

    prototypes_folder: str
    source_files_folder: str
    attachments_folder: str

    # ------------------------------------------------------------------
    # 存储配置解析
    # ------------------------------------------------------------------

    @staticmethod
    def _cfg(key: str, default: str = "") -> str:
        try:
            return service_config.get_config(key, default)
        except Exception:
            return default

    @staticmethod
    def storage_mode() -> str:
        mode = PrototypeFilesService._cfg("STORAGE_MODE", "local").lower()
        return mode if mode in ("local", "sftp") else "local"

    def legacy_folder(self, kind: str) -> str:
        return {
            "prototypes": self.prototypes_folder,
            "source_files": self.source_files_folder,
            "attachments": self.attachments_folder,
        }[kind]

    def active_local_folder(self, kind: str) -> str:
        """当前写入用的本地目录：本地模式且配置了文件夹时用之，否则用默认目录。"""

        base = self._cfg("STORAGE_LOCAL_FOLDER").strip()
        if self.storage_mode() == "local" and base:
            return os.path.join(os.path.expanduser(base), kind)
        return self.legacy_folder(kind)

    def cache_folder(self, kind: str) -> str:
        """SFTP 模式的本地只读缓存目录。"""

        root = os.path.join(os.path.dirname(os.path.abspath(self.prototypes_folder)), "storage_cache")
        return os.path.join(root, kind)

    def sftp_configured(self) -> bool:
        return bool(
            self._cfg("SFTP_HOST").strip()
            and self._cfg("SFTP_USER").strip()
            and self._cfg("SFTP_REMOTE_DIR").strip()
        )

    # ------------------------------------------------------------------
    # SFTP 基础操作
    # ------------------------------------------------------------------

    def _sftp_params(self) -> dict[str, Any]:
        port_text = self._cfg("SFTP_PORT", "22").strip() or "22"
        try:
            port = int(port_text)
        except ValueError:
            port = 22
        return {
            "hostname": self._cfg("SFTP_HOST").strip(),
            "port": port,
            "username": self._cfg("SFTP_USER").strip(),
            "password": self._cfg("SFTP_PASSWORD"),
            "remote_root": "/" + self._cfg("SFTP_REMOTE_DIR").strip().strip("/"),
        }

    @contextmanager
    def _sftp(self) -> Iterator[Any]:
        import paramiko  # 延迟导入：仅服务器存储模式需要

        params = self._sftp_params()
        client = paramiko.SSHClient()
        client.load_system_host_keys()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(
            params["hostname"],
            port=params["port"],
            username=params["username"],
            password=params["password"] or None,
            timeout=15,
        )
        sftp = client.open_sftp()
        try:
            yield sftp, params["remote_root"]
        finally:
            sftp.close()
            client.close()

    @staticmethod
    def _remote_join(remote_root: str, kind: str, *parts: str) -> str:
        return posixpath.join(remote_root, kind, *parts)

    @staticmethod
    def _remote_makedirs(sftp: Any, remote_dir: str) -> None:
        """等效 mkdir -p。"""

        if remote_dir in ("", "/"):
            return
        parent, _ = posixpath.split(remote_dir)
        if parent and parent != remote_dir:
            PrototypeFilesService._remote_makedirs(sftp, parent)
        try:
            sftp.stat(remote_dir)
        except IOError:
            sftp.mkdir(remote_dir)

    def _sftp_upload_file(self, local_path: str, kind: str, *parts: str) -> None:
        with self._sftp() as (sftp, remote_root):
            remote_path = self._remote_join(remote_root, kind, *parts)
            self._remote_makedirs(sftp, posixpath.dirname(remote_path))
            sftp.put(local_path, remote_path)

    def _sftp_download_file(self, kind: str, *parts: str) -> str:
        """下载远程文件到本地缓存，返回本地路径。"""

        local_path = os.path.join(self.cache_folder(kind), *parts)
        os.makedirs(os.path.dirname(local_path), exist_ok=True)

        def walk(sftp: Any, remote_dir: str, local_dir: str) -> None:
            os.makedirs(local_dir, exist_ok=True)
            for entry in sftp.listdir_attr(remote_dir):
                remote_item = posixpath.join(remote_dir, entry.filename)
                local_item = os.path.join(local_dir, entry.filename)
                if entry.st_mode is not None and posixpath.S_ISDIR(entry.st_mode):
                    walk(sftp, remote_item, local_item)
                elif entry.st_mode is not None and posixpath.S_ISREG(entry.st_mode):
                    if os.path.exists(local_item) and os.path.getsize(local_item) == entry.st_size:
                        continue
                    sftp.get(remote_item, local_item)

        with self._sftp() as (sftp, remote_root):
            remote_dir = self._remote_join(remote_root, kind, *parts)
            try:
                stat = sftp.stat(remote_dir)
            except IOError:
                return ""
            if stat.st_mode is not None and posixpath.S_ISDIR(stat.st_mode):
                walk(sftp, remote_dir, local_path)
            else:
                sftp.get(remote_dir, local_path)
        return local_path

    def _sftp_remove_file(self, kind: str, savename: str) -> None:
        try:
            with self._sftp() as (sftp, remote_root):
                try:
                    sftp.remove(self._remote_join(remote_root, kind, savename))
                except IOError:
                    pass
        except Exception:
            pass

    def _sftp_remove_dir(self, kind: str, name: str) -> None:
        try:
            with self._sftp() as (sftp, remote_root):
                self._remote_rmtree(sftp, self._remote_join(remote_root, kind, name))
        except Exception:
            pass

    @staticmethod
    def _remote_rmtree(sftp: Any, remote_dir: str) -> None:
        for entry in sftp.listdir_attr(remote_dir):
            item = posixpath.join(remote_dir, entry.filename)
            if entry.st_mode is not None and posixpath.S_ISDIR(entry.st_mode):
                PrototypeFilesService._remote_rmtree(sftp, item)
            else:
                sftp.remove(item)
        try:
            sftp.rmdir(remote_dir)
        except IOError:
            pass

    def _sftp_upload_dir(self, local_dir: str, kind: str, name: str) -> None:
        with self._sftp() as (sftp, remote_root):
            remote_base = self._remote_join(remote_root, kind, name)
            self._remote_makedirs(sftp, remote_base)
            for root, _dirs, files in os.walk(local_dir):
                rel = os.path.relpath(root, local_dir).replace("\\", "/")
                remote_dir = remote_base if rel == "." else posixpath.join(remote_base, rel)
                self._remote_makedirs(sftp, remote_dir)
                for filename in files:
                    sftp.put(
                        os.path.join(root, filename),
                        posixpath.join(remote_dir, filename),
                    )

    # ------------------------------------------------------------------
    # 读取路径解析
    # ------------------------------------------------------------------

    def _local_candidates(self, kind: str) -> list[str]:
        folders = [self.legacy_folder(kind)]
        for extra in (self.active_local_folder(kind), self.cache_folder(kind)):
            if extra not in folders:
                folders.append(extra)
        return folders

    def existing_local_path(self, kind: str, savename: str) -> str:
        """返回已存在的本地文件路径（默认目录 → 当前本地目录 → 缓存），不存在返回空串。"""

        if not savename:
            return ""
        for folder in self._local_candidates(kind):
            path = os.path.join(folder, savename)
            if os.path.isfile(path):
                return path
        return ""

    def resolve_attachment_path(self, savename: str) -> str:
        return self._resolve_file("attachments", savename)

    def resolve_source_path(self, savename: str) -> str:
        return self._resolve_file("source_files", savename)

    def _resolve_file(self, kind: str, savename: str) -> str:
        path = self.existing_local_path(kind, savename)
        if path or not savename:
            return path or os.path.join(self.legacy_folder(kind), savename)
        if self.storage_mode() == "sftp" and self.sftp_configured():
            downloaded = self._sftp_download_file(kind, savename)
            if downloaded:
                return downloaded
        return os.path.join(self.active_local_folder(kind), savename)

    def existing_prototype_dir(self, proto_uuid: str) -> str:
        """返回已存在的原型解压目录（不触发下载），不存在返回空串。"""

        for folder in self._local_candidates("prototypes"):
            path = os.path.join(folder, proto_uuid)
            if os.path.isdir(path):
                return path
        return ""

    def prototype_dir(self, proto_uuid: str) -> str:
        """返回可读取的原型解压目录；SFTP 模式下需要时下载到缓存。"""

        for folder in self._local_candidates("prototypes"):
            path = os.path.join(folder, proto_uuid)
            if os.path.isdir(path):
                return path
        if self.storage_mode() == "sftp" and self.sftp_configured():
            cached = self._sftp_download_file("prototypes", proto_uuid)
            if cached and os.path.isdir(cached):
                return cached
        return os.path.join(self.active_local_folder("prototypes"), proto_uuid)

    # ------------------------------------------------------------------
    # 目录与空间
    # ------------------------------------------------------------------

    def ensure_folders(self) -> None:
        """确保必要目录存在。"""

        for kind in ("prototypes", "source_files", "attachments"):
            os.makedirs(self.legacy_folder(kind), exist_ok=True)
        if self.storage_mode() == "local":
            base = self._cfg("STORAGE_LOCAL_FOLDER").strip()
            if base:
                for kind in ("prototypes", "source_files", "attachments"):
                    os.makedirs(os.path.join(os.path.expanduser(base), kind), exist_ok=True)

    def available_upload_bytes(self) -> int:
        """返回当前真实还能写入的空间（字节），用于原型上传的可用空间展示。

        需要接入所在服务器的可上传剩余空间探测后返回真实值；
        未接入时返回 0，界面上的可用空间显示为 0。
        """

        return 0

    def total_used_bytes(self) -> int:
        """本地存储模式下，所有存储文件占用的总字节数（所有用户共享）。"""

        total = 0
        for kind in ("prototypes", "source_files", "attachments"):
            for folder in self._local_candidates(kind):
                if not os.path.isdir(folder):
                    continue
                for entry in Path(folder).rglob("*"):
                    if entry.is_file():
                        try:
                            total += entry.stat().st_size
                        except OSError:
                            continue
        return total

    # ------------------------------------------------------------------
    # 写入
    # ------------------------------------------------------------------

    def save_attachment(self, proto_uuid: str, attach_file: FileStorage) -> tuple[str, str]:
        """保存附件文件并返回 (原文件名, 保存名)。"""

        return self._save_upload("attachments", proto_uuid, attach_file)

    def save_source(self, proto_uuid: str, source_file: FileStorage) -> tuple[str, str]:
        """保存源文件并返回 (原文件名, 保存名)。"""

        return self._save_upload("source_files", proto_uuid, source_file)

    def _save_upload(self, kind: str, proto_uuid: str, upload: FileStorage) -> tuple[str, str]:
        original_filename = upload.filename or ""
        safe_filename = secure_filename(original_filename)
        savename = f"{proto_uuid}_{safe_filename}"
        if self.storage_mode() == "sftp":
            local_path = os.path.join(self.cache_folder(kind), savename)
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            upload.save(local_path)
            self._sftp_upload_file(local_path, kind, savename)
        else:
            folder = self.active_local_folder(kind)
            os.makedirs(folder, exist_ok=True)
            upload.save(os.path.join(folder, savename))
        return original_filename, savename

    def delete_attachment(self, savename: str | None) -> None:
        """删除附件文件（所有本地位置 + 服务器）。"""

        self._delete_file("attachments", savename)

    def delete_source(self, savename: str | None) -> None:
        """删除源文件（所有本地位置 + 服务器）。"""

        self._delete_file("source_files", savename)

    def _delete_file(self, kind: str, savename: str | None) -> None:
        if not savename:
            return
        for folder in self._local_candidates(kind):
            fp = os.path.join(folder, savename)
            if os.path.exists(fp):
                os.remove(fp)
        if self.storage_mode() == "sftp" and self.sftp_configured():
            self._sftp_remove_file(kind, savename)

    def delete_prototype_folder(self, proto_uuid: str) -> None:
        """删除原型解压目录（所有本地位置 + 服务器）。"""

        for folder in self._local_candidates("prototypes"):
            proto_path = os.path.join(folder, proto_uuid)
            if os.path.exists(proto_path):
                shutil.rmtree(proto_path)
        if self.storage_mode() == "sftp" and self.sftp_configured():
            self._sftp_remove_dir("prototypes", proto_uuid)

    def save_zip_and_extract(
        self,
        proto_uuid: str,
        zip_file: FileStorage,
        overwrite: bool = False,
        progress_callback: Callable[[int, int], None] | None = None,
    ) -> str:
        """保存 ZIP 并解压，返回解压目录路径。

        SFTP 模式：先解压到本地缓存目录，再整体上传到服务器。
        """

        if self.storage_mode() == "sftp":
            proto_path = os.path.join(self.cache_folder("prototypes"), proto_uuid)
        else:
            proto_path = os.path.join(self.active_local_folder("prototypes"), proto_uuid)
        if overwrite and os.path.exists(proto_path):
            shutil.rmtree(proto_path)
        os.makedirs(proto_path, exist_ok=True)

        zip_filename = secure_filename(zip_file.filename or "")
        zip_filepath = os.path.join(proto_path, zip_filename)
        zip_file.save(zip_filepath)
        try:
            with zipfile.ZipFile(zip_filepath, "r") as zip_ref:
                infos = zip_ref.infolist()
                total_bytes = sum(info.file_size for info in infos)
                extracted_bytes = 0
                if progress_callback:
                    progress_callback(extracted_bytes, total_bytes)
                for info in infos:
                    zip_ref.extract(info, proto_path)
                    extracted_bytes += info.file_size
                    if progress_callback:
                        progress_callback(extracted_bytes, total_bytes)
        except zipfile.BadZipFile as e:
            raise ZipFileInvalidError(str(e)) from e
        finally:
            if os.path.exists(zip_filepath):
                os.remove(zip_filepath)
        if self.storage_mode() == "sftp":
            self._sftp_upload_dir(proto_path, "prototypes", proto_uuid)
        return proto_path
