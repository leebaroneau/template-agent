# Document Processing Tools — Design Spec

**Date:** 2026-06-02
**Status:** Approved
**Scope:** template-agent image + bundled skill

---

## Problem

Hermes agents receive documents via Telegram and other gateways (PDFs, Word docs, Excel spreadsheets, CSVs) but have no tools to extract content from them. `read_file` handles plain text only; `.docx`/`.xlsx` are explicitly blocked as binary; PDFs are not blocked but return garbled binary content. Agents either fail silently or tell users they cannot process the file.

---

## Design

Three coordinated changes, no framework patching required.

### 1. System packages (apt)

Add to the existing `apt-get install` block in `paperclip/Dockerfile`:

```
tesseract-ocr
tesseract-ocr-eng
tesseract-ocr-osd
poppler-utils
libmagic1
```

- `tesseract-ocr` + lang packs: OCR engine for `pytesseract` (fast, lightweight, no ML models)
- `poppler-utils`: PDF utilities (`pdftotext`, `pdfinfo`) available in terminal
- `libmagic1`: file type detection for `python-magic`

### 2. Python packages (Hermes venv)

Add to the existing `uv pip install --python ./venv/bin/python` line in `paperclip/Dockerfile`, alongside `anthropic` and `faster-whisper`:

```
pymupdf
pytesseract
python-docx
openpyxl
pandas
tabulate
python-magic
marker-pdf
```

| Package | Purpose | Size |
|---|---|---|
| `pymupdf` | Text extraction from digital PDFs (fast, no models) | ~5MB |
| `pytesseract` | Python wrapper for tesseract OCR | <1MB |
| `python-docx` | Read Word `.docx` files | ~1MB |
| `openpyxl` | Read/write Excel `.xlsx` files | ~2MB |
| `pandas` | DataFrame analysis for CSV, Excel, tabular data | ~20MB |
| `tabulate` | Pretty-print tables to text | <1MB |
| `python-magic` | File type detection from content (not extension) | <1MB |
| `marker-pdf` | High-quality OCR + layout for scanned PDFs (surya ML) | ~150MB pip, ~1.5GB models on first use |

**Estimated image size increase:** ~350MB (packages only; models land in volume, not image).

### 3. Model cache persistence

Add to `paperclip/Dockerfile` as image-level defaults:

```dockerfile
ENV HF_HOME=/data/hermes/model-cache \
    TORCH_HOME=/data/hermes/model-cache
```

- `HF_HOME` redirects HuggingFace (surya/transformers) model downloads to the persistent `paperclip-data` volume
- `TORCH_HOME` does the same for PyTorch hub models
- Models download once on first `marker-pdf` call (~1.5GB surya), then persist across container restarts and redeploys
- `/data/hermes/model-cache` matches the existing `*_cache` exclude pattern in both backup scripts — no backup changes needed
- Brands can override in their compose `environment:` block if needed

### 4. Bundled skill: `read-documents`

New skill at `hermes-runtime/skills/read-documents/SKILL.md`.

Auto-deployed by the existing `install_agent_stack_skills()` in `bootstrap-profiles.sh` — symlinked into every profile's `skills/agent-stack/read-documents/` on next container boot. No config changes needed.

**Skill design:**

```yaml
---
name: read-documents
description: Extract text and data from PDF, Word, Excel, and CSV files using
  installed document processing libraries. Handles both digital (text-layer)
  and scanned (OCR) documents.
triggers:
  - "read PDF"
  - "PDF attached"
  - "extract text from"
  - "read this document"
  - ".docx"
  - ".xlsx"
  - "spreadsheet"
  - "analyse this file"
  - "what's in this file"
  - "read the attachment"
---
```

Content covers:

1. **Locating the file** — Telegram inbox path (`/data/hermes/inbox/<chat_id>/`) or agent working dir
2. **Text-layer PDF** (`pymupdf`) — fast, always try first
3. **Scanned PDF** (`marker-pdf`) — high quality, warns about first-use model download (~1.5GB once)
4. **Simple OCR** (`pytesseract`) — faster fallback for simple scans when marker isn't needed
5. **Word `.docx`** (`python-docx`)
6. **Excel `.xlsx`** (`openpyxl` / `pandas`)
7. **CSV / tabular data** (`pandas`)
8. **File type detection** (`python-magic`) — when extension is ambiguous

All processing uses the existing `execute_code` tool (already in `hermes-telegram` and `hermes-cli` toolsets). No new tools or toolset changes.

---

## What is NOT in scope

- Patching `read_file` to auto-detect document types (invasive, upstream concern)
- Pre-downloading surya models at image build time (would add ~1.5GB to image)
- Adding marker-pdf to upstream Hermes `[all]` or `LAZY_DEPS` (upstream policy restricts `[all]`; heavy deps stay brand-stack level)
- PowerPoint `.pptx` (not a current use case; `python-pptx` can be added later)
- Language packs beyond English for tesseract (add per-brand if needed)

---

## Files changed

| File | Change |
|---|---|
| `paperclip/Dockerfile` | Add apt packages to existing install block |
| `paperclip/Dockerfile` | Add pip packages to existing venv install line |
| `paperclip/Dockerfile` | Add `ENV HF_HOME` + `TORCH_HOME` |
| `hermes-runtime/skills/read-documents/SKILL.md` | New bundled skill |

---

## Image size impact

| Component | Before | After |
|---|---|---|
| Image | ~7.0GB | ~7.4GB |
| Model cache (volume, first use) | 0 | ~1.5GB |
| Backup size impact | none | none (`*_cache` excluded) |
