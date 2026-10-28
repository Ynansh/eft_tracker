# Скачивает скриншоты прохождений с tarkov.help в папку img/th, чтобы страница квеста
# показывала их без интернета и не зависела от сайта. Список картинок — tarkov_help.json.
# Уже скачанные пропускаются, поэтому скрипт можно запускать повторно. Запуск из папки трекера: python3 scripts/get_th_screenshots.py
import json
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from progress_bar import Progress, mb

# Старые консоли Windows (cp866) не умеют часть символов — пусть вывод их заменяет, а не падает
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(errors="replace")

ROOT = Path(__file__).resolve().parent.parent  # корень трекера: скрипт лежит в scripts/
DEST = ROOT / "img" / "th"
# Скриншоты из статей. Иконки предметов, торговцев и значки лояльности не берём — это не скриншоты
SHOTS = "/production/img/articles/"
# Чужой сайт: качаем в несколько потоков, но немного
WORKERS = 4


def local_name(url):
    """Имя файла на диске — как в адресе (страница квеста ищет его так же)."""
    return urllib.parse.unquote(url.rsplit("/", 1)[1])


def main():
    data = json.loads((ROOT / "sources" / "tarkov_help.json").read_text(encoding="utf-8"))
    urls = sorted({u for q in data["quests"].values() for u in q["images"] if SHOTS in u})
    DEST.mkdir(parents=True, exist_ok=True)
    todo = [u for u in urls if not (DEST / local_name(u)).exists()]
    print(f"Скриншоты tarkov.help: всего {len(urls)}, уже скачано {len(urls) - len(todo)}, осталось {len(todo)}.")
    if not todo:
        return

    failed = []
    streak = [0]  # неудачи подряд: сайт мог перестать отвечать
    lock = threading.Lock()
    bar = Progress("Скриншоты tarkov.help", len(todo))

    def one(url):
        if streak[0] >= 8:
            failed.append(url)
            bar.advance(1)
            return
        path = DEST / local_name(url)
        quoted = urllib.parse.quote(url, safe=":/()")
        for _ in range(2):
            try:
                req = urllib.request.Request(quoted, headers={"User-Agent": "eft-tracker-screenshots"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    body = r.read()
                # Сначала во временный файл: оборванная загрузка не оставит битую картинку
                part = path.with_name(path.name + ".part")
                part.write_bytes(body)
                part.replace(path)
                with lock:
                    streak[0] = 0
                bar.advance(1, len(body))
                return
            except (urllib.error.URLError, OSError):
                pass
        with lock:
            failed.append(url)
            streak[0] += 1
        bar.advance(1)

    with ThreadPoolExecutor(WORKERS) as pool:
        list(pool.map(one, todo))
    bar.finish(f"  (новых {len(todo) - len(failed)}" + (f", не скачано {len(failed)})" if failed else ")"))

    total = sum(p.stat().st_size for p in DEST.iterdir() if p.is_file())
    print(f"В папке img/th: {mb(total)}.")
    if failed:
        print(f"\nНе скачано: {len(failed)} — tarkov.help не отвечает или картинку убрали. Страница квеста покажет "
              f"их прямо с сайта, если он доступен. Запусти скрипт ещё раз позже — докачаются только недостающие.")


try:
    main()
except KeyboardInterrupt:
    print("\nОстановлено. Запусти ещё раз — докачаются только недостающие.")
