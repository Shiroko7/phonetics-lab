# phonetics-lab
#
# Two processes make up the app:
#
#   web  - the Vite dev server on :5173, which is the whole app and works alone
#   api  - the local scoring service on :8000, which is the accurate path
#
# `make dev` runs both. The web app probes the API on startup and uses it when
# it answers, falling back to the in-browser recogniser when it does not, so
# `make web` on its own is a complete app — just a less accurate one.
#
# The API binds to 127.0.0.1 and recordings are scored on this machine.
# Optional free online reference voices send only reference text to Edge TTS.

UV  ?= uv
NPM ?= npm

# Recipes are single commands with no shell builtins, so this works whether make
# invokes cmd.exe (the usual case on Windows) or a POSIX shell. Running the two
# servers together goes through `concurrently` rather than `&` backgrounding for
# the same reason.

.DEFAULT_GOAL := help
.PHONY: help install install-web install-api dev web api build check check-web check-api health clean clean-web clean-api

help:
	@echo "phonetics-lab"
	@echo ""
	@echo "  make install   install both halves (npm + uv)"
	@echo "  make dev       run web :5173 and api :8000 together"
	@echo "  make web       run the web app alone (browser recogniser only)"
	@echo "  make api       run the scoring service alone"
	@echo "  make health    ask the running api what it loaded"
	@echo "  make check     run both test suites"
	@echo "  make build     production build of the web app"
	@echo "  make clean     remove build output, venv and caches"
	@echo ""
	@echo "First run downloads ~1.2 GB of model weights; they are cached after."

## Setup ----------------------------------------------------------------------

install: install-web install-api

install-web:
	$(NPM) install

install-api:
	$(UV) sync --directory backend

## Running --------------------------------------------------------------------

dev:
	$(NPM) run dev

web:
	$(NPM) run dev:web

api:
	$(NPM) run dev:api

health:
	$(UV) run --directory backend python -m app.cli health

## Checks ---------------------------------------------------------------------

check: check-web check-api

check-web:
	$(NPM) run check

check-api:
	$(UV) run --directory backend python -m app.cli check
	$(UV) run --directory backend python -m unittest test_voice

## Build and teardown ---------------------------------------------------------

build:
	$(NPM) run build

clean: clean-web clean-api

clean-web:
	$(NPM) run clean

clean-api:
	$(UV) run --directory backend python -m app.cli clean
