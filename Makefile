.DEFAULT_GOAL := help
PY := python3
VENV := apps/api/.venv
# venv trên Windows nằm ở Scripts/, trên Linux/macOS ở bin/
BIN := $(VENV)/$(if $(filter Windows_NT,$(OS)),Scripts,bin)

# Windows: chạy lệnh bằng sh của Git thay vì cmd.exe, để PowerShell cũng gọi make được
ifeq ($(OS),Windows_NT)
GIT_USR_BIN := $(subst mingw64/libexec/git-core,usr/bin,$(shell git --exec-path))
SHELL := $(GIT_USR_BIN)/sh.exe
export PATH := $(GIT_USR_BIN);$(PATH)
endif

help: ## Liệt kê các lệnh
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-18s %s\n", $$1, $$2}'

install: install-api install-web install-board ## Cài tất cả phụ thuộc

install-api: ## Tạo venv và cài phụ thuộc cho API
	$(PY) -m venv $(VENV)
	$(BIN)/pip install -r apps/api/requirements-dev.txt

install-web: ## Cài phụ thuộc cho web
	cd apps/web && npm ci

install-board: ## Cài phụ thuộc cho máy chủ bảng viết
	cd services/whiteboard-sync && npm ci

dev-api: ## Chạy API (cần file .env ở thư mục gốc)
	cd apps/api && ../../$(BIN)/uvicorn app.main:app --reload --port 8000

dev-web: ## Chạy web
	cd apps/web && npm run dev

dev-board: ## Chạy máy chủ đồng bộ bảng viết
	cd services/whiteboard-sync && npm run dev

test: test-api test-board ## Chạy toàn bộ test

test-api:
	cd apps/api && ../../$(BIN)/pytest

test-board:
	cd services/whiteboard-sync && npm test

lint: ## Kiểm tra kiểu code và định dạng
	$(BIN)/ruff check apps/api
	$(BIN)/ruff format --check apps/api
	cd apps/web && npm run typecheck
	cd services/whiteboard-sync && npm run typecheck

build-web: ## Build web
	cd apps/web && npm run build

.PHONY: help install install-api install-web install-board dev-api dev-web dev-board test test-api test-board lint build-web
