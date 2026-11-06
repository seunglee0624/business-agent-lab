import multiprocessing
import sys


def main():
    multiprocessing.freeze_support()  # render workers must not re-run the app in a PyInstaller .exe
    # GUI imports live here: spawned render workers re-import this module and must stay light
    from PySide6.QtWidgets import QApplication

    from app import theme
    from app.main_window import MainWindow

    app = QApplication(sys.argv)
    app.setOrganizationName("pdfviewer")  # QSettings location
    app.setApplicationName("pdfviewer")
    theme.apply(app)
    window = MainWindow()
    window.show()
    for path in sys.argv[1:]:  # one tab each
        window.open_file(path)
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
