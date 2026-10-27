# Скачивает свежий список квестов с tarkov.dev (на русском) и пишет его в quests.js.
# Квесты из extra_quests.json (взяты с eft.su) добавляются, если их ещё нет на tarkov.dev.
# Связи «предыдущий квест» и квесты, которых нет на tarkov.dev, — tarkov_market.json (с tarkov-market).
# Для квестов, которых нет на tarkov-market, — связи tarkov.dev. Список Каппы — отметки tarkov.help
# (tarkov_help.json) и «Коллекционер» с его цепочкой из игровых данных tarkov.dev.
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


def objective_text(o):
    """Цель на русском с количеством из игровых данных: «Устранить бойцов ЧВК… ×5»."""
    text = ru.get(o["description"], o["description"])
    count = o.get("count") or 0
    # Число уже есть в тексте («Передать 3 …») — второй раз не пишем
    if count > 1 and not re.search(rf"(?<!\d){count}(?!\d)", text.replace(" ", "")):
        text += f" ×{count}"
    return text + (" (необязательно)" if o.get("optional") else "")


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
        "objectives": [objective_text(o) for o in t.get("objectives", [])],
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

# Квесты и связи с tarkov-market (tarkov_market.json — блок «Requirements» на страницах квестов).
# Названия там английские, сопоставляем по странице английской вики
TM_TRADERS = {
    "Prapor": "54cb50c76803fa8b248b4571", "Therapist": "54cb57776803fa99248b456e",
    "Fence": "579dc571d53a0658a154fbec", "Skier": "58330581ace78e27b8b10cee",
    "Peacekeeper": "5935c25fb3acc3127c3d8cd9", "Mechanic": "5a7c2eca46aef81a7ca2145d",
    "Ragman": "5ac3b934156ae10c4430e83c", "Jaeger": "5c0647fdd443bc2504c2d371",
    "Ref": "6617beeaa9cfa777ca915b7c", "Lightkeeper": "638f541a29ffd1183d187f57",
    "BTR_Driver": "656f0f98d80a697f855d34b1",
}
# «Reach loyalty level N with all traders except Fence and Ref»
MAIN_TRADERS = ["Prapor", "Therapist", "Skier", "Peacekeeper", "Mechanic", "Ragman", "Jaeger"]
# Требование «шаг сюжета» на tarkov-market → начало текста шага на русской вики
TM_STORY_STEPS = {
    "Unlock direct access to Lighthouse": "Обеспечить доступ на локацию Маяк",
    "Tell Mechanic that you found transport to the icebreaker": "Сообщить Механику, что транспорт на ледокол найден",
    "Hand over the hard drives from compartment C-1": "Попросить у Механика помощи с расшифровкой жёстких дисков",
}


def tm_key(title):
    """Название страницы английской вики → ключ для сопоставления."""
    title = re.sub(r"\s*\(quest\)$", "", urllib.parse.unquote(title).replace("_", " ").lower())
    return re.sub(r"[^a-z0-9]+", "-", title).strip("-")


tm = json.loads((HERE / "tarkov_market.json").read_text(encoding="utf-8"))
wiki_tm = json.loads((HERE / "wiki_tm_quests.json").read_text(encoding="utf-8"))["pages"]
# Ключ → квесты у нас. Их бывает несколько: версии для BEAR и USEC или варианты одного квеста
# в разных ветках (у Водителя БТР), которые tarkov-market показывает одним квестом
ours = {}
for q in quests:
    if "pvp" not in q["modes"]:
        continue
    wiki = q.get("wiki") or ""
    keys = {tm_key(q["slug"])} if q.get("slug") else set()
    if "/wiki/" in wiki and "/ru/wiki/" not in wiki:
        keys.add(tm_key(wiki.split("/wiki/", 1)[1]))
    for k in keys:
        ours.setdefault(k, []).append(q)

tm_ids = {}  # название на tarkov-market → id квестов у нас
tm_guides = {}
for e in tm:
    found = ours.get(tm_key(e["wiki"])) or ours.get(tm_key(e["name"]))
    if found:
        tm_ids[e["name"]] = [q["id"] for q in found]
        continue
    page = wiki_tm.get(e["wiki"])
    if not page:
        continue  # временные квесты событий: без страницы на русской вики не добавляем
    qid = f"tm-{e['uid']}"
    tm_ids[e["name"]] = [qid]
    strip_table_headers(page)
    walk = page.get("walkthrough") or []
    if walk and walk[0]["t"] == "h" and walk[0]["text"] in ("Выполнение", "Прохождение"):
        page["walkthrough"] = walk[1:]
    quests.append({
        "id": qid,
        "slug": None,
        "name": page["title"],
        "trader": TM_TRADERS[e["trader"]],
        "level": next((int(r.split()[1]) for r in e["require"] if r.startswith("Level ")), 1),
        "map": page.get("map"),
        "kappa": False,  # Каппа — по tarkov.help, ниже
        "faction": None,
        "wiki": WIKI_URL + page["title"],
        "objectives": block_texts(page.get("steps")),
        "modes": ["pvp", "pve"],
        "maybeSeason": True,
        "requires": [],
        "traderReqs": [],
        "needs": [],
        "keys": [],
        "image": None,
        "imageUrl": None,
    })
    tm_guides[qid] = {"title": page["title"], "edited": page.get("edited", ""),
                      **{k: page[k] for k in ("important", "walkthrough", "notes") if page.get(k)}}

by_id = {q["id"]: q for q in quests}

# Связи с tarkov-market заменяют связи tarkov.dev. «Requires one of» — одна группа «любой из».
# «After taking» (открывается, когда другой квест взят) не отслеживаем: отметки «взят» у нас нет
steps_by_text = [(st["text"], st["id"]) for c in story for st in c["steps"] if "id" in st]
def is_branch(ids):
    """Варианты одного квеста в разных ветках (а не версии для BEAR и USEC)."""
    return len(ids) > 1 and not all(by_id[i]["faction"] for i in ids)


for e in tm:
    ids = tm_ids.get(e["name"])
    if not ids:
        continue
    reqs, groups, any_of, steps = [], [], [], []
    for line in e["req"]:
        kind, _, rest = line.partition(": ")
        if kind in ("Requires quest", "Requires one of"):
            if rest not in tm_ids:
                print(f"Внимание: tarkov-market, «{e['name']}» требует неизвестный квест «{rest}»")
            elif kind == "Requires one of":
                any_of += tm_ids[rest]
            elif is_branch(tm_ids[rest]):
                groups.append(tm_ids[rest])  # подойдёт вариант из любой ветки
            else:
                reqs += tm_ids[rest]  # версия другой фракции отсеется на сайте
        for en, ru_prefix in TM_STORY_STEPS.items():
            if line.startswith(en):
                found = [sid for text, sid in steps_by_text if text.startswith(ru_prefix)]
                steps += found
                if not found:
                    print(f"Внимание: в сюжете не найден шаг «{ru_prefix}…» для «{e['name']}»")
    for q in map(by_id.get, ids):
        if steps:
            q["storySteps"] = steps  # хотя бы один из этих шагов сюжета
        # У вариантов в разных ветках свои связи — точнее, чем общие на tarkov-market
        if is_branch(ids):
            continue
        q["requires"] = list(reqs)
        q["requiresAny"] = groups + ([any_of] if any_of else [])
        if not q["requiresAny"]:
            del q["requiresAny"]
    q = by_id[ids[0]]
    if q["id"].startswith("tm-"):
        ll = {}
        for r in e["require"]:
            m = re.match(r"(\w+) · Loyalty level (\d)", r)
            if m:
                ll[m.group(1)] = int(m.group(2))
        for line in e["req"]:
            m = re.match(r"Reach loyalty level (\d) with all traders except Fence and Ref", line)
            if m:
                ll.update({t: max(ll.get(t, 0), int(m.group(1))) for t in MAIN_TRADERS})
        q["traderReqs"] = [{"trader": TM_TRADERS[t], "type": "level", "compare": ">=", "value": v}
                           for t, v in ll.items()]

# «After taking X»: квест открывается, когда X взят, а взять X можно после его предыдущих квестов
for e in tm:
    for line in e["req"]:
        kind, _, rest = line.partition(": ")
        # У вариантов в разных ветках связи из tarkov.dev
        if kind != "After taking" or rest not in tm_ids or e["name"] not in tm_ids or is_branch(tm_ids[e["name"]]):
            continue
        for q in map(by_id.get, tm_ids[e["name"]]):
            for x in tm_ids[rest]:
                q["requires"] += [r for r in by_id[x]["requires"] if r not in q["requires"] and r != q["id"]]

# Квесты PvP, которых нет на tarkov-market: возможно, устарели или убраны из игры
tm_matched = {i for ids in tm_ids.values() for i in ids}
for q in quests:
    if "pvp" in q["modes"] and q["id"] not in tm_matched:
        q["notOnTM"] = True

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


# Связь, которая замыкает круг, — ошибка в данных: такой квест никогда бы не открылся
for q in quests:
    for r in list(q["requires"]):
        if depends_on(r, q["id"]):
            q["requires"].remove(r)
            print(f"Пропущена связь (замкнутый круг): {q['name']} ← {by_id[r]['name']}")


def name_key(name):
    """Название для сравнения: без знаков, приписок в скобках и латинских букв-двойников в русском тексте."""
    name = re.sub(r"\s*\([^)]*\)$", "", name.lower().replace("ё", "е"))
    if re.search("[а-я]", name):
        name = name.translate(str.maketrans("aceopxy", "асеорху"))
    return re.sub(r"[^0-9a-zа-я]+", "", name)


# Страницы квестов на tarkov.help (tarkov_help.json собран вручную в браузере): ссылка на гайд и скриншоты.
# Скриншоты страница берёт из папки img/th (её заполняет get_th_screenshots.py), а если файла нет — с tarkov.help
th_path = HERE / "tarkov_help.json"
th_quests = json.loads(th_path.read_text(encoding="utf-8"))["quests"] if th_path.exists() else {}
th_by_key = {}
for slug, t in th_quests.items():
    m = re.search(r"\s*\[(BEAR|USEC)\]$", t["name"])
    th_by_key[(name_key(t["name"][:m.start()] if m else t["name"]), m.group(1) if m else None)] = slug
th_shots = {}
for q in quests:
    if q["modes"] == ["season"]:
        continue  # на tarkov.help сезонных квестов нет
    key = name_key(q["name"])
    slug = next(filter(None, (th_by_key.get((key, f)) for f in (q["faction"], None, "USEC", "BEAR"))), None)
    if slug:
        q["th"] = slug
        # Каппа: отметка tarkov.help «Требуется для Коллекционера» (вдобавок к отметке tarkov.dev)
        q["kappa"] = q["kappa"] or th_quests[slug].get("kappa", False)
        # Только скриншоты из статей: иконки предметов и торговцев в галерее не нужны
        shots = [u for u in th_quests[slug]["images"] if "/production/img/articles/" in u]
        if shots:
            th_shots[q["id"]] = shots
th_linked = {q.get("th") for q in quests}
lost = [t["name"] for s, t in th_quests.items() if t.get("kappa") and s not in th_linked]
if lost:
    print(f"Внимание: квесты Каппы с tarkov.help, которых нет у нас: {', '.join(lost)}")

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
    "// Сгенерировано update_quests.py из данных tarkov.dev, tarkov-market и extra_quests.json. Не редактировать вручную.\n"
    f"window.TRADERS = {json.dumps(traders, ensure_ascii=False)};\n"
    f"window.QUESTS = {json.dumps(quests, ensure_ascii=False, separators=(',', ':'))};\n",
    encoding="utf-8",
)
print(f"Готово: {len(quests)} квестов (из них с eft.su: {added}, с tarkov-market: {len(tm_guides)}), "
      f"для Каппы {sum(q['kappa'] for q in quests)}, нет на tarkov-market: {sum(1 for q in quests if q.get('notOnTM'))}")

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
    guides = {**json.loads(guides_path.read_text(encoding="utf-8")), **season_guides, **tm_guides}
    for g in guides.values():
        strip_table_headers(g)
    for qid, urls in th_shots.items():
        guides.setdefault(qid, {})["thShots"] = urls
    # Свои прохождения (guides_own.json): короткий пересказ по игровым данным, вики и tarkov.help.
    # Показываются первыми, текст с вики под ними сворачивается
    own_path = HERE / "guides_own.json"
    own = json.loads(own_path.read_text(encoding="utf-8")) if own_path.exists() else {}
    for qid, g in own.items():
        if qid in by_id:
            guides.setdefault(qid, {})["own"] = g
        else:
            print(f"Внимание: в guides_own.json неизвестный квест {qid}")
    (HERE / "guides.js").write_text(
        "// Прохождения с https://escapefromtarkov.fandom.com/ru (CC BY-NC-SA). Сгенерировано update_quests.py.\n"
        f"window.GUIDES = {json.dumps(guides, ensure_ascii=False, separators=(',', ':'))};\n",
        encoding="utf-8",
    )
    print(f"Прохождений с вики: {sum(1 for g in guides.values() if g.get('walkthrough'))}, "
          f"квестов со ссылкой на tarkov.help: {sum(1 for q in quests if q.get('th'))}, "
          f"со скриншотами оттуда: {len(th_shots)}")
if missing_shots:
    print(f"Скриншотов нет в папке img/wiki (пропущены): {len(missing_shots)}")
if failed_downloads:
    hosts = sorted({urllib.parse.urlsplit(u).hostname for u in failed_downloads})
    print(f"\nНе скачано картинок: {len(failed_downloads)} — не отвечает {', '.join(hosts)}.\n"
          f"Трекер работает и без них (вместо картинок будут пустые места). Запусти скрипт ещё раз позже "
          f"или через VPN — докачаются только недостающие. Либо возьми готовый архив со страницы релизов.")
