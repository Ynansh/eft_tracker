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

# Старые консоли Windows (cp866) не умеют часть символов — пусть вывод их заменяет, а не падает
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(errors="replace")

REPO = "Ynansh/eft_tracker"
BRANCH = "main"
URL = f"https://codeload.github.com/{REPO}/zip/refs/heads/{BRANCH}"

HERE = Path(__file__).parent
DEST = HERE / "img" / "wiki"
SHOT = re.compile(r"[^/]+/img/wiki/([0-9a-f]{16}\.webp)")  # <папка репозитория>/img/wiki/<имя>.webp


def download(url, path):
    req = urllib.request.Request(url, headers={"User-Agent": "eft-tracker-screenshots"})
    with urllib.request.urlopen(req, timeout=60) as r, open(path, "wb") as f:
        got = 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            got += len(chunk)
            print(f"\rСкачано {got / 1024 / 1024:.0f} МБ", end="", flush=True)
    print()


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        archive = Path(tmp) / "repo.zip"
        print(f"Скачиваю скриншоты с github.com/{REPO}…")
        try:
            download(URL, archive)
        except urllib.error.HTTPError as e:
            sys.exit(f"Не получилось скачать ({e.code}). Возможно, репозиторий стал приватным — "
                     f"скачайте полный архив (eft-tracker-full) со страницы релизов.")
        except urllib.error.URLError as e:
            sys.exit(f"Нет связи с GitHub: {e.reason}")

        added = kept = 0
        with zipfile.ZipFile(archive) as z:
            for name in z.namelist():
                m = SHOT.fullmatch(name)
                if not m:
                    continue
                target = DEST / m.group(1)
                if target.exists():
                    kept += 1
                    continue
                with z.open(name) as src, open(target, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                added += 1
    print(f"Готово: новых скриншотов {added}, уже были {kept}. Обнови страницу трекера.")


if __name__ == "__main__":
    main()
