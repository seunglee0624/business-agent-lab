"""Notes kept beside the PDF, never in it: one JSON file per document in the app data folder.
Pure Python; annotation_state.py adds the signals, the save debounce and undo."""
import hashlib
import json
import logging
import os
import time
import uuid
from pathlib import Path

VERSION = 1
log = logging.getLogger(__name__)


def doc_id(path):
    """Identifies a PDF by its content, so a moved or renamed file keeps its notes."""
    digest = hashlib.sha256()
    with open(path, "rb") as file:
        for block in iter(lambda: file.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()[:16]


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def new_id():
    return uuid.uuid4().hex[:12]


class AnnotationStore:
    """One document's notes: {"v", "doc_id", "source_path", "title", "highlights", "notes", "bookmarks",
    "doc_note", "chat"}. Items of a list kind are dicts with an "id"."""

    def __init__(self, folder, doc_id, source_path, title):
        self.path = Path(folder) / f"{doc_id}.json"
        self.problem = None  # why the file on disk could not be used as is, for a warning
        self.read_only = False  # never overwrite what we could not read
        self.dirty = False
        empty = {"v": VERSION, "doc_id": doc_id, "highlights": [], "notes": [], "bookmarks": [], "doc_note": "", "chat": []}
        self.data = {**empty, **self._load()}
        self.data.update(source_path=source_path, title=title)  # where it was last seen; saved with the next change

    def _load(self):
        if not self.path.exists():
            return {}
        try:
            text = self.path.read_text(encoding="utf-8")
        except OSError as error:  # locked or no permission: it may be fine later, so leave it alone
            log.warning("cannot read %s", self.path, exc_info=True)
            self.read_only, self.problem = True, f"메모 파일을 읽지 못해 이번에는 저장하지 않습니다: {error}"
            return {}
        try:
            data = json.loads(text)
            if not isinstance(data, dict):
                raise ValueError("not an object")
            if data.get("v", 0) > VERSION:
                self.read_only, self.problem = True, "새 버전 앱이 만든 메모 파일이라 읽기만 합니다."
                return data
            _check(data)
        except (ValueError, TypeError, KeyError):
            backup = self.path.with_name(self.path.name + ".bak")
            try:
                os.replace(self.path, backup)
            except OSError as error:  # locked or read-only folder: keep the file and don't write over it
                log.warning("cannot move broken notes file %s", self.path, exc_info=True)
                self.read_only, self.problem = True, f"메모 파일이 깨졌는데 옮기지도 못해 이번에는 저장하지 않습니다: {error}"
                return {}
            log.warning("broken notes file moved to %s", backup)
            self.problem = f"메모 파일이 깨져 {backup.name} 으로 옮기고 새로 시작합니다."
            return {}
        return data

    def items(self, kind):
        return self.data[kind]

    def find(self, kind, item_id):
        return next((item for item in self.data[kind] if item["id"] == item_id), None)

    def add(self, kind, item, index=None):
        items = self.data[kind]
        items.insert(len(items) if index is None else index, item)
        self.dirty = True

    def remove(self, kind, item_id):
        self.data[kind].remove(self.find(kind, item_id))
        self.dirty = True

    def update(self, kind, item_id, fields):
        """Changes some fields and stamps "updated", unless fields carry their own (undo restores the old one)."""
        self.find(kind, item_id).update({"updated": now(), **fields})
        self.dirty = True

    def set(self, key, value):
        """A single value such as "doc_note"."""
        self.data[key] = value
        self.dirty = True

    def save(self):
        """Atomic: a crash mid-write leaves the old file whole. Raises OSError (the changes stay in memory)."""
        if self.read_only or not self.dirty:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_name(self.path.name + ".tmp")
        with open(temp, "w", encoding="utf-8") as file:
            json.dump(self.data, file, ensure_ascii=False, indent=1)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temp, self.path)
        self.dirty = False


def _check(data):
    """Raises ValueError/TypeError/KeyError for a file whose shape the app would trip over later."""
    if not isinstance(data, dict):
        raise ValueError("not an object")
    for kind in ("highlights", "notes", "bookmarks", "chat"):
        if not isinstance(data.get(kind, []), list):
            raise ValueError(f"{kind} is not a list")
    if not isinstance(data.get("doc_note", ""), str):
        raise ValueError("doc_note is not text")
    for item in data.get("highlights", []):
        if not (isinstance(item["id"], str) and isinstance(item["page"], int) and isinstance(item["color"], str)
                and isinstance(item["text"], str) and isinstance(item["comment"], str) and len(item["words"]) == 2
                and all(len(quad) == 4 and all(isinstance(v, (int, float)) for v in quad) for quad in item["quads"])):
            raise ValueError("bad highlight")
    for item in data.get("notes", []):
        if not (isinstance(item["id"], str) and isinstance(item["page"], int) and isinstance(item["text"], str)
                and isinstance(item["source"], str)):
            raise ValueError("bad note")
    for item in data.get("bookmarks", []):
        if not (isinstance(item["id"], str) and isinstance(item["page"], int)):
            raise ValueError("bad bookmark")
