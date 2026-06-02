---
name: read-documents
description: Extract text and data from PDF, Word (.docx), Excel (.xlsx), and CSV
  files using installed document processing libraries. Handles both digital
  (text-layer) PDFs and scanned (OCR) PDFs.
triggers:
  - "read PDF"
  - "PDF attached"
  - "extract text from"
  - "read this document"
  - "read the attachment"
  - "what's in this file"
  - "analyse this file"
  - ".docx"
  - ".xlsx"
  - "spreadsheet"
  - "read the contract"
  - "read the report"
---

# Reading Documents

All libraries are pre-installed in the Hermes venv. Use `execute_code` to run
the snippets below — no pip installs needed.

## Step 1: Locate the file

Files received via Telegram are stored at:
```
/data/hermes/inbox/<chat_id>/<filename>
```

List recent inbox files:
```python
import os, glob
files = sorted(glob.glob("/data/hermes/inbox/**/*", recursive=True), key=os.path.getmtime, reverse=True)
for f in files[:10]:
    print(f)
```

## Step 2: Detect file type (when extension is ambiguous)

```python
import magic
mime = magic.from_file("/path/to/file", mime=True)
print(mime)
# e.g. "application/pdf"
# "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
# "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
```

## Step 3: Extract content

### PDF — text-layer (digital PDF, fast)

Always try this first. Returns empty string if the PDF is scanned.

```python
import fitz  # pymupdf
doc = fitz.open("/path/to/file.pdf")
text = "\n".join(page.get_text() for page in doc)
doc.close()
if text.strip():
    print(text[:3000])
else:
    print("No text layer — use OCR path below")
```

### PDF — scanned (high-quality OCR via marker-pdf)

Use when the text-layer path returns empty. **First call downloads surya models
(~1.5GB) to `/data/hermes/model-cache/` — takes a few minutes once, then instant.**

```python
from marker.convert import convert_single_pdf
from marker.models import load_all_models
models = load_all_models()
text, _, _ = convert_single_pdf("/path/to/file.pdf", models)
print(text[:3000])
```

### PDF — scanned (fast OCR via tesseract, lower quality)

Faster alternative when layout precision is not needed:

```python
import pytesseract
from pdf2image import convert_from_path
pages = convert_from_path("/path/to/file.pdf")
text = "\n".join(pytesseract.image_to_string(page) for page in pages)
print(text[:3000])
```

### Word document (.docx)

```python
from docx import Document
doc = Document("/path/to/file.docx")
text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
print(text[:3000])
```

### Excel spreadsheet (.xlsx)

```python
import pandas as pd
xl = pd.read_excel("/path/to/file.xlsx", sheet_name=None)
for sheet, df in xl.items():
    print(f"\n=== {sheet} ===")
    print(df.to_string(max_rows=20))
```

### CSV / tabular data

```python
import pandas as pd
df = pd.read_csv("/path/to/file.csv")
print(df.shape)
print(df.dtypes)
print(df.head(10))
print(df.describe())
```

## Tips

- For large PDFs, process page by page and summarise incrementally
- For Excel with many sheets, list them first: `pd.ExcelFile(path).sheet_names`
- For mixed-content PDFs (some pages text, some scanned), use pymupdf per page
  and fall back to marker-pdf only on pages where `page.get_text()` returns nothing
- Use `tabulate` to format DataFrames nicely: `from tabulate import tabulate; print(tabulate(df, headers='keys', tablefmt='pipe'))`
