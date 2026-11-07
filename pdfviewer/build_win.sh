#!/usr/bin/env bash
# Build the Windows .exe from WSL: copies the sources to a Windows folder and runs PyInstaller there
# with Windows Python (building on the \\wsl$ share is slow and breaks PyInstaller's paths).
# Result: C:\Users\<you>\pdfviewer-build\dist\PDFViewer\PDFViewer.exe
set -euo pipefail
cd "$(dirname "$0")"
WIN_HOME=$(wslpath "$(cmd.exe /c 'echo %USERPROFILE%' 2>/dev/null | tr -d '\r')")
OUT="$WIN_HOME/pdfviewer-build"
mkdir -p "$OUT"
rm -rf "$OUT/app" "$OUT/assets" "$OUT/styles"
cp -r app assets styles main.py pdfviewer.spec requirements.txt "$OUT/"
find "$OUT/app" -name __pycache__ -prune -exec rm -rf {} +
cd "$OUT"
if [ ! -f .venv/Scripts/python.exe ]; then
    cmd.exe /c "py -3 -m venv .venv"
fi
cmd.exe /c ".venv\\Scripts\\python -m pip install -q -r requirements.txt pyinstaller pillow"
cmd.exe /c ".venv\\Scripts\\pyinstaller --noconfirm pdfviewer.spec"
echo "built: $OUT/dist/PDFViewer/PDFViewer.exe"
