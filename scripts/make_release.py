# Собирает два архива для релиза на GitHub в папку release/:
#   eft-tracker-full-<дата>.zip — всё готовое к запуску, со скриншотами вики и tarkov.help
#   eft-tracker-lite-<дата>.zip — то же без скриншотов (img/wiki и img/th);
#     скриншоты потом можно докачать: python3 scripts/get_screenshots.py и python3 scripts/get_th_screenshots.py
# Перед сборкой обнови данные: python3 scripts/update_quests.py
# Запуск из папки трекера: python3 scripts/make_release.py
import datetime
import sys
import zipfile
from pathlib import Path

# Старые консоли Windows (cp866) не умеют часть символов — пусть вывод их заменяет, а не падает
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(errors="replace")

HERE = Path(__file__).resolve().parent.parent  # корень трекера: скрипт лежит в scripts/
OUT = HERE / "release"
ROOT = "eft-tracker"  # папка внутри архива

# Что не кладём в архив
SKIP_DIRS = {".git", "release", "__pycache__", ".claude"}
SKIP_FILES = {".DS_Store", ".gitignore"}
# Без этих файлов сайт не работает — их создаёт update_quests.py
REQUIRED = ["data/quests.js", "data/items.js", "data/story.js", "data/guides.js", "img/quests"]


def project_files():
    for path in sorted(HERE.rglob("*")):
        rel = path.relative_to(HERE)
        if path.is_file() and not SKIP_DIRS & set(rel.parts) and path.name not in SKIP_FILES:
            yield rel


def build(name, files):
    path = OUT / name
    with zipfile.ZipFile(path, "w") as z:
        for rel in files:
            # Картинки уже сжаты, их не пережимаем — так быстрее
            method = zipfile.ZIP_STORED if rel.suffix in (".webp", ".png", ".jpg") else zipfile.ZIP_DEFLATED
            z.write(HERE / rel, f"{ROOT}/{rel.as_posix()}", compress_type=method)
    print(f"{name}: {path.stat().st_size / 1024 / 1024:.1f} МБ, файлов {len(files)}")


missing = [r for r in REQUIRED if not (HERE / r).exists()]
if missing:
    raise SystemExit(f"Нет {', '.join(missing)} — сначала запусти python3 scripts/update_quests.py")

OUT.mkdir(exist_ok=True)
stamp = datetime.date.today().isoformat()
files = list(project_files())

build(f"eft-tracker-full-{stamp}.zip", files)
# Лёгкий: без папок img/wiki и img/th. Ссылки на скриншоты остаются: скриншоты tarkov.help страница
# возьмёт с сайта, а отсутствующие скриншоты вики спрячет
build(f"eft-tracker-lite-{stamp}.zip", [r for r in files if r.parts[:2] not in (("img", "wiki"), ("img", "th"))])
