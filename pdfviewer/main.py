import logging
import multiprocessing
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

LOG_BYTES, LOG_BACKUPS = 1_000_000, 2  # 1 MB × 3 files


def setup_logging(folder):
    """Log to folder/pdfviewer.log; returns its path."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "pdfviewer.log"
    handler = RotatingFileHandler(path, maxBytes=LOG_BYTES, backupCount=LOG_BACKUPS, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root = logging.getLogger()
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    return path


def main():
    multiprocessing.freeze_support()  # render workers must not re-run the app in a PyInstaller .exe
    # GUI imports live here: spawned render workers re-import this module and must stay light
    from PySide6.QtCore import QStandardPaths
    from PySide6.QtWidgets import QApplication, QMessageBox

    from app import theme
    from app.icons import app_icon
    from app.main_window import MainWindow

    app = QApplication(sys.argv)
    app.setOrganizationName("pdfviewer")  # QSettings and log location
    app.setApplicationName("pdfviewer")
    log_path = setup_logging(QStandardPaths.writableLocation(QStandardPaths.StandardLocation.AppDataLocation))

    def excepthook(kind, error, trace):  # a bug in a slot: record it and keep the app running
        logging.getLogger("pdfviewer").error("unhandled error", exc_info=(kind, error, trace))
        QMessageBox.critical(None, "오류", f"문제가 생겼어요. 같은 일이 반복되면 이 로그 파일을 보내 주세요.\n\n{log_path}")

    sys.excepthook = excepthook
    theme.apply(app)
    app.setWindowIcon(app_icon())
    window = MainWindow()
    window.show()
    for path in sys.argv[1:]:  # one tab each
        window.open_file(path)
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
