# AxureShare 构建任务（使用 .venv 的 Python）
VENV_PY = .venv\Scripts\python.exe

# 打包浏览器插件（读取 extension/manifest.json → 输出 dist/axureshare-upload-helper-{version}.zip）
build-extension:
	@echo ==== 打包浏览器扩展 ====
	python scripts/build_extension.py

# 升级依赖（.venv 环境）
upgrade:
	$(VENV_PY) -m pip install --upgrade pip
	$(VENV_PY) -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# 数据库迁移
db-migrate:
	$(VENV_PY) -m flask db migrate -m "$(msg)"
	$(VENV_PY) -m flask db upgrade

# 本地开发运行（调试模式）
run:
	$(VENV_PY) app.py
