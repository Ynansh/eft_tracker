# Докачивает скриншоты прохождений (папка img/wiki) для лёгкого архива трекера.
# Скриншоты берутся из репозитория на GitHub: с самой вики скрипты скачивать нельзя.
# Работает, пока репозиторий публичный. Запуск: python3 get_screenshots.py
import re
import shutil
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

from progress_bar import Progress

# Старые консоли Windows (cp866) не умеют часть символов — пусть вывод их заменяет, а не падает
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(errors="replace")

REPO = "Ynansh/eft_tracker"
BRANCH = "main"
URL = f"https://codeload.github.com/{REPO}/zip/refs/heads/{BRANCH}"

# Примерный размер архива репозитория: GitHub не сообщает его заранее, а полоске нужен ориентир
APPROX_SIZE = 72 * 1024 * 1024

HERE = Path(__file__).parent
DEST = HERE / "img" / "wiki"
SHOT = re.compile(r"[^/]+/img/wiki/([0-9a-f]{16}\.webp)")  # <папка репозитория>/img/wiki/<имя>.webp


def download(url, path):
    req = urllib.request.Request(url, headers={"User-Agent": "eft-tracker-screenshots"})
    with urllib.request.urlopen(req, timeout=60) as r, open(path, "wb") as f:
        # GitHub не всегда сообщает размер архива — тогда показываем, сколько уже скачано
        size = int(r.headers.get("Content-Length") or 0) or None
        bar = Progress("Скачивание", size, step="1/2", in_bytes=True, estimate=APPROX_SIZE)
        while True:
            chunk = r.read(1 << 18)
            if not chunk:
                break
            f.write(chunk)
            bar.advance(0, len(chunk))
        bar.finish()


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        archive = Path(tmp) / "repo.zip"
        print(f"Скачиваю скриншоты прохождений с github.com/{REPO} (архив репозитория, около 72 МБ)…")
        try:
            download(URL, archive)
        except urllib.error.HTTPError as e:
            print()
            sys.exit(f"Не получилось скачать ({e.code}). Возможно, репозиторий стал приватным — "
                     f"скачайте полный архив (eft-tracker-full) со страницы релизов.")
        except urllib.error.URLError as e:
            print()
            sys.exit(f"Нет связи с GitHub: {e.reason}")

        try:
            z = zipfile.ZipFile(archive)
        except zipfile.BadZipFile:
            sys.exit("GitHub прислал не архив. Попробуй ещё раз позже.")
        with z:
            shots = [(name, m.group(1)) for name in z.namelist() for m in [SHOT.fullmatch(name)] if m]
            bar = Progress("Распаковка", len(shots), step="2/2", unit="скриншотов")
            added = kept = 0
            for name, file in shots:
                target = DEST / file
                if target.exists():
                    kept += 1
                else:
                    with z.open(name) as src, open(target, "wb") as dst:
                        shutil.copyfileobj(src, dst)
                    added += 1
                bar.advance(1)
            bar.finish()
    print(f"Готово: новых скриншотов {added}, уже были {kept}. Обнови страницу трекера.")


if __name__ == "__main__":
    main()
