# Скачивает свежий список квестов с tarkov.dev (на русском) и пишет его в quests.js.
# Квесты из extra_quests.json (взяты с eft.su) добавляются, если их ещё нет на tarkov.dev.
# Список Каппы — kappa_quests.json (с tarkov-market), связи «предыдущий квест» —
# tarkov.dev + eftsu_previous.json (с eft.su).
# Предметы для квестов и убежища пишутся в items.js, их иконки — в папку img/.
# Запуск: python3 update_quests.py
import hashlib
import json
import re
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from progress_bar import Progress

# Старые консоли Windows (cp866) не умеют часть символов — пусть вывод их заменяет, а не падает
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(errors="replace")

BASE = "https://json.tarkov.dev/"
HERE = Path(__file__).parent
IMG = HERE / "img"

# Деньги в списке предметов не нужны: счётчик на сотни тысяч рублей бесполезен
CURRENCIES = {
    "5449016a4bdc2d6f028b456f",  # Рубли
    "5696686a4bdc2da3298b456a",  # Доллары
    "569668774bdc2da2298b4568",  # Евро
}

# Порядок вкладок как в игре
TRADER_ORDER = [
    "54cb50c76803fa8b248b4571",  # Прапор
    "54cb57776803fa99248b456e",  # Терапевт
    "579dc571d53a0658a154fbec",  # Скупщик
    "58330581ace78e27b8b10cee",  # Лыжник
    "5935c25fb3acc3127c3d8cd9",  # Миротворец
    "5a7c2eca46aef81a7ca2145d",  # Механик
    "5ac3b934156ae10c4430e83c",  # Барахольщик
    "5c0647fdd443bc2504c2d371",  # Егерь
    "6617beeaa9cfa777ca915b7c",  # Реф
    "638f541a29ffd1183d187f57",  # Смотритель
    "656f0f98d80a697f855d34b1",  # Водитель БТР
]


def load(mode, name, bar):
    req = urllib.request.Request(f"{BASE}{mode}/{name}", headers={"User-Agent": "eft-quests"})
    try:
        chunks = []
        with urllib.request.urlopen(req, timeout=60) as r:
            while True:
                chunk = r.read(1 << 18)
                if not chunk:
                    break
                chunks.append(chunk)
                bar.advance(0, len(chunk))
        bar.advance(1)
        return json.loads(b"".join(chunks))["data"]
    except (urllib.error.URLError, OSError) as e:
        print()
        sys.exit(f"Не удалось скачать данные с json.tarkov.dev ({e}). Проверь интернет или попробуй через VPN. "
                 f"Готовый трекер без Python — архив со страницы релизов.")


# Режимы сайта и соответствующие режимы tarkov.dev
MODES = {"pvp": "regular", "pve": "pve", "season": "pvp-season"}

# Все файлы данных, которые нужны с tarkov.dev
SOURCES = [(src, "tasks") for src in MODES.values()] + [(src, "tasks_ru") for src in MODES.values()]
SOURCES += [("regular", "traders_ru"), ("regular", "maps_ru"), ("regular", "items"), ("regular", "items_ru")]
SOURCES += [(src, "hideout") for src in MODES.values()] + [("regular", "hideout_ru")]

print("Обновление трекера: данные tarkov.dev, фото квестов и иконки предметов.")
bar = Progress("Данные tarkov.dev", len(SOURCES), step="1/3")
data = {(src, name): load(src, name, bar) for src, name in SOURCES}
bar.finish()

tasks_by_mode = {m: data[src, "tasks"]["tasks"] for m, src in MODES.items()}
ru = {k: v for src in ("pvp-season", "pve", "regular") for k, v in data[src, "tasks_ru"].items()}
traders_ru = data["regular", "traders_ru"]
maps_ru = data["regular", "maps_ru"]
items = data["regular", "items"]["items"]
items_ru = data["regular", "items_ru"]
hideout_by_mode = {m: data[src, "hideout"] for m, src in MODES.items()}
hideout_ru = data["regular", "hideout_ru"]
trader_by_name = {traders_ru.get(f"{i} Nickname"): i for i in TRADER_ORDER}


def needs(t):
    """Предметы, которые нужно сдать или заложить по квесту."""
    out = []
    for o in t.get("objectives", []):
        if o["type"] not in ("giveItem", "plantItem"):
            continue
        ids = [i for i in o.get("items", []) if i not in CURRENCIES]
        if not ids:
            continue
        out.append({
            "items": ids,
            "count": o.get("count") or 1,
            "fir": bool(o.get("foundInRaid")),
            "plant": o["type"] == "plantItem",
            "optional": bool(o.get("optional")),
            # Для «любой из нескольких» показываем текст цели
            "text": ru.get(o["description"], o["description"]) if len(ids) > 1 else None,
        })
    return out


def convert(t, modes):
    return {
        "id": t["id"],
        "slug": t.get("normalizedName"),  # адрес квеста на eft.su
        "name": ru.get(t["name"], t["name"]),
        "trader": t["trader"],
        "level": t.get("minPlayerLevel") or 1,
        "map": maps_ru.get(f"{t['map']} Name") if t.get("map") else None,
        "kappa": bool(t.get("kappaRequired")),
        "faction": t.get("factionName") if t.get("factionName") in ("BEAR", "USEC") else None,
        "wiki": t.get("wikiLink"),
        "objectives": [
            ru.get(o["description"], o["description"]) + (" (необязательно)" if o.get("optional") else "")
            for o in t.get("objectives", [])
        ],
        "modes": modes,  # в каких режимах есть квест: pvp, pve, season
        # Только требования «квест выполнен»; «взят» и «провален» не отслеживаем
        "requires": [r["task"] for r in t.get("taskRequirements", []) if r.get("status") == ["complete"]],
        # Лояльность (level) или репутация (reputation) у торговца
        "traderReqs": [
            {"trader": r["trader"], "type": r["requirementType"], "compare": r["compareMethod"], "value": r["value"]}
            for r in t.get("traderRequirements", [])
            if r["requirementType"] in ("level", "reputation")
        ],
        "needs": needs(t),
        # Нужные ключи по картам
        "keys": [
            {"map": maps_ru.get(f"{k['map']} Name") if k.get("map") else None, "keys": k["keys"]}
            for k in t.get("neededKeys") or [] if k.get("keys")
        ],
        "image": f"img/quests/{t['id']}.webp" if t.get("taskImageLink") else None,
        "imageUrl": t.get("taskImageLink"),
    }


# Каждый квест один раз; данные берём из первого режима, где он есть
quests = []
for i in dict.fromkeys(i for tasks in tasks_by_mode.values() for i in tasks):
    modes = [m for m, tasks in tasks_by_mode.items() if i in tasks]
    quests.append(convert(tasks_by_mode[modes[0]][i], modes))

known = {q["id"] for q in quests}
extra = json.loads((HERE / "extra_quests.json").read_text(encoding="utf-8"))
added = 0
for e in extra:
    if e["id"] in known:
        continue  # tarkov.dev уже знает этот квест
    added += 1
    quests.append({
        "id": e["id"],
        "slug": e["link"].rstrip("/").rsplit("/", 1)[-1],
        "name": e["name"],
        "trader": e["trader"],
        "level": e["level"] or 1,
        "map": e["map"],
        "kappa": False,
        "faction": None,
        "wiki": e["link"],
        "objectives": [],
        "modes": ["pvp", "pve"],
        "maybeSeason": True,  # есть ли в сезоне — неизвестно, показываем отдельной группой
        "requires": [],
        "traderReqs": [],
        "needs": [],
        "keys": [],
        "image": None,
        "imageUrl": None,
    })

# Сезонные квесты и сюжетные главы с русской вики (CC BY-NC-SA), собраны вручную в браузере
WIKI_URL = "https://escapefromtarkov.fandom.com/ru/wiki/"
GENITIVE = {"Прапора": "Прапор", "Терапевта": "Терапевт", "Скупщика": "Скупщик", "Лыжника": "Лыжник",
            "Миротворца": "Миротворец", "Механика": "Механик", "Барахольщика": "Барахольщик", "Егеря": "Егерь"}
wiki_ss = json.loads((HERE / "wiki_story_season.json").read_text(encoding="utf-8"))
story_id = {s["title"]: f"story-{s['pageid']}" for s in wiki_ss["story"]}
season_id = {s["title"]: f"wiki-{s['pageid']}" for s in wiki_ss["season"]}
season_guides = {}


def block_texts(blocks):
    return [b["text"] for b in blocks or [] if b["t"] in ("p", "li")]


# Строки-заголовки таблиц с вики («Иконка · Название предмета · …») — шум
TABLE_HEADERS = ("Иконка · ", "Название предмета · ")
missing_shots = set()


def strip_table_headers(entry):
    """Убирает шум и скриншоты, которых нет в папке img/wiki."""
    for part in ("important", "walkthrough", "notes"):
        if part in entry:
            kept = []
            for b in entry[part]:
                if b.get("text", "").startswith(TABLE_HEADERS):
                    continue
                if b["t"] == "img" and not (HERE / b["file"]).exists():
                    missing_shots.add(b["file"])
                    continue
                kept.append(b)
            entry[part] = kept


# Первый подзаголовок «Выполнение»/«Прохождение» дублирует заголовок раздела на странице
for entry in wiki_ss["season"] + wiki_ss["story"]:
    strip_table_headers(entry)
    walk = entry.get("walkthrough") or []
    if walk and walk[0]["t"] == "h" and walk[0]["text"] in ("Выполнение", "Прохождение"):
        entry["walkthrough"] = walk[1:]


for s in wiki_ss["season"]:
    req_text = " ".join(block_texts(s.get("important")))
    level = re.search(r"получил (\d+) уров", req_text)
    trader_reqs = [
        {"trader": trader_by_name[GENITIVE[name]], "type": "level", "compare": ">=", "value": int(ll)}
        for ll, name in re.findall(r"(\d+) уровень лояльности у (\w+)", req_text) if name in GENITIVE
    ]
    qid = season_id[s["title"]]
    quests.append({
        "id": qid,
        "slug": None,
        "name": s["title"],
        "trader": trader_by_name.get(s.get("trader"), s.get("trader")),
        "level": int(level.group(1)) if level else 1,
        "map": s.get("map"),
        "kappa": False,
        "faction": None,
        "wiki": WIKI_URL + s["title"],
        "objectives": block_texts(s.get("steps")),
        "modes": ["season"],
        "requires": [season_id[p] for p in s.get("prev", []) if p in season_id],
        "storyReqs": [story_id[p] for p in s.get("prev", []) if p in story_id],
        "traderReqs": trader_reqs,
        "needs": [],
        "keys": [],
        "image": None,
        "imageUrl": None,
    })
    season_guides[qid] = {"title": s["title"], "edited": s.get("edited", ""),
                          **{k: s[k] for k in ("important", "walkthrough", "notes") if s.get(k)}}

by_id = {q["id"]: q for q in quests}

kappa_ids = {r["id"] for r in json.loads((HERE / "kappa_quests.json").read_text(encoding="utf-8"))}
for q in quests:
    q["kappa"] = q["kappa"] or q["id"] in kappa_ids
unknown = kappa_ids - by_id.keys()
if unknown:
    print(f"Внимание: {len(unknown)} квестов из kappa_quests.json не найдено: {sorted(unknown)}")

for q in quests:
    q["requires"] = [i for i in q["requires"] if i in by_id]


def depends_on(start, target):
    """Требует ли квест start (через цепочку предыдущих) квест target."""
    seen, stack = set(), [start]
    while stack:
        i = stack.pop()
        if i == target:
            return True
        if i not in seen:
            seen.add(i)
            stack.extend(by_id[i]["requires"])
    return False


for r in json.loads((HERE / "eftsu_previous.json").read_text(encoding="utf-8")):
    q = by_id.get(r["id"])
    if not q or r["previous"] not in by_id or r["previous"] in q["requires"]:
        continue
    # Связь, которая замкнула бы круг, — ошибка в данных: такой квест никогда бы не открылся
    if depends_on(r["previous"], r["id"]):
        print(f"Пропущена связь с eft.su (замкнутый круг): {r['name']} ← {r['previous_name']}")
        continue
    q["requires"].append(r["previous"])

quests.sort(key=lambda q: (q["level"], q["name"]))


# Картинки, которые не скачались, и серверы, которые перестали отвечать
failed_downloads = []
down_hosts = set()
fail_streak = {}
fail_lock = threading.Lock()


def download_file(url, path):
    """Скачивает файл. Возвращает размер или 0, если не вышло.
    Ошибка сети не прерывает скрипт: файл пропускается, сайт работает и без него."""
    host = urllib.parse.urlsplit(url).hostname
    if host not in down_hosts:
        for _ in range(2):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "eft-quests"})
                with urllib.request.urlopen(req, timeout=20) as r:
                    data = r.read()
                # Сначала во временный файл: оборванная загрузка не оставит битую картинку
                part = path.with_name(path.name + ".part")
                part.write_bytes(data)
                part.replace(path)
                with fail_lock:
                    fail_streak[host] = 0
                return len(data)
            except (urllib.error.URLError, OSError):
                pass
    with fail_lock:
        failed_downloads.append(url)
        fail_streak[host] = fail_streak.get(host, 0) + 1
        # Много неудач подряд — сервер недоступен, дальше не ждём на каждой картинке
        if fail_streak[host] >= 8:
            down_hosts.add(host)
    return 0


def fetch_all(title, step, jobs):
    """Скачивает недостающие файлы (url, путь) с полоской прогресса. Возвращает число новых."""
    bar = Progress(title, len(jobs), step=step)

    def one(job):
        url, path = job
        size = 0 if path.exists() else download_file(url, path)
        bar.advance(1, size)
        return 1 if size else 0

    failed_before = len(failed_downloads)
    with ThreadPoolExecutor(8) as pool:
        fresh = sum(pool.map(one, jobs))
    failed = len(failed_downloads) - failed_before
    bar.finish(f"  (новых {fresh}" + (f", не скачано {failed})" if failed else ")"))
    return fresh


# Картинки квестов
(IMG / "quests").mkdir(parents=True, exist_ok=True)
fetch_all("Фото квестов", "2/3", [(q["imageUrl"], HERE / q["image"]) for q in quests if q["image"]])
for q in quests:
    del q["imageUrl"]

trader_ids = {q["trader"] for q in quests}
order = [i for i in TRADER_ORDER if i in trader_ids] + sorted(trader_ids - set(TRADER_ORDER))
traders = [{"id": i, "name": traders_ru.get(f"{i} Nickname", i)} for i in order]

(HERE / "quests.js").write_text(
    "// Сгенерировано update_quests.py из данных tarkov.dev и extra_quests.json. Не редактировать вручную.\n"
    f"window.TRADERS = {json.dumps(traders, ensure_ascii=False)};\n"
    f"window.QUESTS = {json.dumps(quests, ensure_ascii=False, separators=(',', ':'))};\n",
    encoding="utf-8",
)
print(f"Готово: {len(quests)} квестов (из них с eft.su: {added}), для Каппы {sum(q['kappa'] for q in quests)}")

def build_stations(hideout):
    """Убежище: модули и предметы для каждого уровня."""
    stations = []
    for s in hideout.values():
        levels = []
        for lv in sorted(s["levels"], key=lambda l: l["level"]):
            lv_needs = [
                {"item": r["item"], "count": r["count"], "fir": bool(r.get("attributes", {}).get("foundInRaid"))}
                for r in lv["itemRequirements"] if r["item"] not in CURRENCIES
            ]
            levels.append({"level": lv["level"], "needs": lv_needs})
        if any(lv["needs"] for lv in levels):
            stations.append({"id": s["id"], "name": hideout_ru.get(s["name"], s["name"]), "levels": levels})
    return sorted(stations, key=lambda s: s["name"])


# В сезоне своё убежище (другие требования и без «найдено в рейде»)
stations_by_mode = {m: build_stations(h) for m, h in hideout_by_mode.items()}
hideout_needs = [n for stations in stations_by_mode.values() for s in stations for lv in s["levels"] for n in lv["needs"]]

# Предметы, которые встречаются в квестах и убежище
key_ids = {i for q in quests for k in q["keys"] for i in k["keys"]}
used = {i for q in quests for n in q["needs"] for i in n["items"]} | key_ids
used |= {n["item"] for n in hideout_needs}
# Иконки скачиваем для одиночных предметов, первого предмета из «любой из» и ключей
with_icon = {n["items"][0] for q in quests for n in q["needs"]} | key_ids
with_icon |= {n["item"] for n in hideout_needs}

item_info = {}
for i in sorted(used):
    it = items.get(i)
    if not it:
        continue
    item_info[i] = {
        "name": items_ru.get(f"{i} Name", i),
        "short": items_ru.get(f"{i} ShortName", ""),
        "icon": f"img/{i}.webp" if i in with_icon and it.get("iconLink") else None,
    }

fetch_all("Иконки предметов", "3/3",
          [(items[i]["iconLink"], IMG / f"{i}.webp") for i, v in item_info.items() if v["icon"]])

(HERE / "items.js").write_text(
    "// Сгенерировано update_quests.py из данных tarkov.dev. Не редактировать вручную.\n"
    f"window.ITEMS = {json.dumps(item_info, ensure_ascii=False, separators=(',', ':'))};\n"
    f"window.HIDEOUT = {json.dumps(stations_by_mode, ensure_ascii=False, separators=(',', ':'))};\n",
    encoding="utf-8",
)
print(f"Предметы: {len(item_info)}, модулей убежища: {len(stations_by_mode['pvp'])}")

# Сюжетные главы. Связи между главами, которых нет на русской вики, — из tarkov-data-overlay
CHAPTER_REQS = {"Небеса в огне": ["Тур"], "Билет": ["Небеса в огне"]}
# Торговец → шаг «Тура», после которого он открывается (разделы «Награды» на вики)
TOUR_UNLOCKS = {
    "5ac3b934156ae10c4430e83c": "Поговорить с Барахольщиком",            # Барахольщик
    "58330581ace78e27b8b10cee": "Рассказать Барахольщику о результатах",  # Лыжник
    "5a7c2eca46aef81a7ca2145d": "Передать Лыжнику 5 предметов",           # Механик
    "54cb50c76803fa8b248b4571": "Передать Механику 2 предмета",           # Прапор
    "5935c25fb3acc3127c3d8cd9": "Выжить на локации Лес",                  # Миротворец
}

story = []
for order, s in enumerate(wiki_ss["story"], 1):
    cid = story_id[s["title"]]
    steps, seen = [], {}
    for b in s.get("steps", []):
        if b["t"] == "img":
            continue
        if b["t"] == "h":
            steps.append({"h": b["text"]})
            continue
        # id шага — по тексту, чтобы отметки не съезжали при пересборке данных
        n = seen[b["text"]] = seen.get(b["text"], 0) + 1
        sid = f"{cid}-{hashlib.sha1(b['text'].encode()).hexdigest()[:8]}-{n}"
        steps.append({"id": sid, "text": b["text"], "optional": b["text"].startswith("(опционально)")})
    reqs = list(dict.fromkeys(s.get("prev", []) + CHAPTER_REQS.get(s["title"], [])))
    story.append({
        "id": cid,
        "name": s["title"].replace(" (глава истории)", ""),
        "title": s["title"],
        "order": order,
        "edited": s.get("edited", ""),
        "requires": [story_id[r] for r in reqs if r in story_id],
        "steps": steps,
        **{k: s[k] for k in ("important", "walkthrough", "notes") if s.get(k)},
    })

tour = next(c for c in story if c["name"] == "Тур")
trader_unlocks = {}
for trader, prefix in TOUR_UNLOCKS.items():
    step = next((st for st in tour["steps"] if st.get("text", "").startswith(prefix)), None)
    if step:
        trader_unlocks[trader] = {"chapter": tour["id"], "step": step["id"], "text": step["text"]}
    else:
        print(f"Внимание: в «Туре» не найден шаг «{prefix}…»")

(HERE / "story.js").write_text(
    "// Сюжетные главы с https://escapefromtarkov.fandom.com/ru (CC BY-NC-SA). Сгенерировано update_quests.py.\n"
    f"window.STORY = {json.dumps(story, ensure_ascii=False, separators=(',', ':'))};\n"
    f"window.TRADER_UNLOCKS = {json.dumps(trader_unlocks, ensure_ascii=False, separators=(',', ':'))};\n",
    encoding="utf-8",
)
print(f"Сюжетных глав: {len(story)}, шагов: {sum(1 for c in story for st in c['steps'] if 'id' in st)}, "
      f"торговцев открывает «Тур»: {len(trader_unlocks)}, сезонных квестов с вики: {len(season_guides)}")

# Прохождения с русской вики (CC BY-NC-SA). wiki_guides.json собирается вручную в браузере:
# вики закрыта проверкой Cloudflare, поэтому скрипт её не скачивает
guides_path = HERE / "wiki_guides.json"
if guides_path.exists():
    guides = {**json.loads(guides_path.read_text(encoding="utf-8")), **season_guides}
    for g in guides.values():
        strip_table_headers(g)
    (HERE / "guides.js").write_text(
        "// Прохождения с https://escapefromtarkov.fandom.com/ru (CC BY-NC-SA). Сгенерировано update_quests.py.\n"
        f"window.GUIDES = {json.dumps(guides, ensure_ascii=False, separators=(',', ':'))};\n",
        encoding="utf-8",
    )
    print(f"Прохождений с вики: {sum(1 for g in guides.values() if g.get('walkthrough'))}")
if missing_shots:
    print(f"Скриншотов нет в папке img/wiki (пропущены): {len(missing_shots)}")
if failed_downloads:
    hosts = sorted({urllib.parse.urlsplit(u).hostname for u in failed_downloads})
    print(f"\nНе скачано картинок: {len(failed_downloads)} — не отвечает {', '.join(hosts)}.\n"
          f"Трекер работает и без них (вместо картинок будут пустые места). Запусти скрипт ещё раз позже "
          f"или через VPN — докачаются только недостающие. Либо возьми готовый архив со страницы релизов.")
