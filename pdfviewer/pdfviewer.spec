# PyInstaller build for Windows. Run from this folder with Windows Python (see README "빌드"):
#   pyinstaller pdfviewer.spec  ->  dist/PDFViewer/PDFViewer.exe
from pathlib import Path

from PySide6.QtGui import QImage, QPainter, Qt
from PySide6.QtSvg import QSvgRenderer

# the .exe icon comes from the same SVG as the window icon; PyInstaller turns the PNG into a
# multi-size .ico with Pillow
icon_png = Path("build/app_icon.png")
icon_png.parent.mkdir(exist_ok=True)
image = QImage(256, 256, QImage.Format.Format_ARGB32)
image.fill(Qt.GlobalColor.transparent)
painter = QPainter(image)
QSvgRenderer("assets/app_icon.svg").render(painter)
painter.end()
image.save(str(icon_png))

a = Analysis(["main.py"], datas=[("styles", "styles"), ("assets", "assets")])
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="PDFViewer", console=False, icon=str(icon_png))
coll = COLLECT(exe, a.binaries, a.datas, name="PDFViewer")  # folder build: starts without unpacking
