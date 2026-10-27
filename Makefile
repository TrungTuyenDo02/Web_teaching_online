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

dev-board-local: ## Máy chủ bảng thử cục bộ cho /dev/whiteboard (khóa ngẫu nhiên, dữ liệu tạm)
	cd services/whiteboard-sync && npm run dev:local

# Thử bảng bằng tablet cùng Wi-Fi: make dev-board-lan LAN_IP=192.168.1.9 (cửa sổ 1) và make dev-web-lan LAN_IP=192.168.1.9 (cửa sổ 2)
WEB_PORT ?= 5173
require-lan-ip:
	$(if $(LAN_IP),,$(error Thiếu LAN_IP (IP Wi-Fi của laptop, xem ipconfig), vd. make dev-board-lan LAN_IP=192.168.1.9))

dev-board-lan: require-lan-ip ## Máy chủ bảng thử mở cho Wi-Fi: LAN_IP=<IP laptop> [WEB_PORT=5173], in mã ghép nối
	cd services/whiteboard-sync && npm run dev:local -- --lan=$(LAN_IP) --web-port=$(WEB_PORT)

dev-web-lan: require-lan-ip ## Web dev mở cho Wi-Fi (không nạp file môi trường): LAN_IP=<IP laptop> [WEB_PORT=5173]
	cd apps/web && LAN_IP=$(LAN_IP) npm run dev -- --mode lan --port $(WEB_PORT) --strictPort

# Thử bảng bằng tablet qua cáp USB (không cần Wi-Fi): make dev-board-local, make dev-web, rồi make tablet-usb
tablet-usb: ## Nối tablet Android qua cáp USB (cần adb): chuyển cổng web 5173, cấp token 8789, bảng 8790 về laptop
	@command -v adb >/dev/null || { echo "Chưa có adb: cài Android SDK Platform-Tools, xem docs/tablet-wifi.md"; exit 1; }
	adb reverse tcp:5173 tcp:5173
	adb reverse tcp:8789 tcp:8789
	adb reverse tcp:8790 tcp:8790
	@echo "Trên tablet mở Chrome: http://localhost:5173/dev/whiteboard  (gỡ: adb reverse --remove-all)"

test: test-api test-board test-evals ## Chạy toàn bộ test cục bộ và eval xác định

test-api:
	cd apps/api && ../../$(BIN)/pytest

test-board:
	cd services/whiteboard-sync && npm test

test-evals: ## Eval E0 xác định (không gọi AI hay đọc bí mật)
	$(BIN)/python -m evals.run --suite E0

lint: ## Kiểm tra kiểu code và định dạng
	$(BIN)/ruff check --config apps/api/pyproject.toml apps/api evals
	$(BIN)/ruff format --check --config apps/api/pyproject.toml apps/api evals
	$(BIN)/python apps/api/scripts/check_time_usage.py
	cd apps/web && npm run typecheck
	cd services/whiteboard-sync && npm run typecheck

test-e2e-smoke: ## Test trình duyệt nhóm @smoke (Playwright, dữ liệu giả, không gọi dịch vụ thật)
	cd apps/web && npm run test:e2e:smoke

test-e2e: ## Test trình duyệt đầy đủ, gồm nhóm @slow
	cd apps/web && npm run test:e2e

build-web: ## Build web
	cd apps/web && npm run build

# Thử với người dùng thật qua Cloudflare quick tunnel (docs/operations.md): API cổng API_PORT, bảng 8787, rồi
# cloudflared tunnel --url http://127.0.0.1:4173. Chế độ tunnel ép web gọi /api cùng địa chỉ với trang.
tunnel-web: ## Build web rồi phục vụ ở 127.0.0.1:4173, proxy /api và /board (WebSocket) [API_PORT=8010]
	cd apps/web && npm run build -- --mode tunnel && API_PORT=$(or $(API_PORT),8010) npm run preview -- --mode tunnel

.PHONY: help install install-api install-web install-board dev-api dev-web dev-board dev-board-local dev-board-lan dev-web-lan require-lan-ip tablet-usb test test-api test-board test-evals test-e2e test-e2e-smoke lint build-web tunnel-web
