# Полоска прогресса для консоли (Windows, macOS, Linux) без сторонних библиотек.
#   [2/3] Фото квестов     ██████████░░░░░░░░░░░░░░  42%  221/526 файлов · 13.1 МБ
import sys
import threading
import time

WIDTH = 24


def _bar_chars():
    """Блоки █░, а если консоль их не умеет (старая кодировка) — # и -."""
    try:
        "█░".encode(getattr(sys.stdout, "encoding", None) or "ascii")
        return "█", "░"
    except (UnicodeEncodeError, LookupError):
        return "#", "-"


FULL, EMPTY = _bar_chars()


def mb(n):
    return f"{n / 1024 / 1024:.1f} МБ"


class Progress:
    """total — сколько всего (файлов или байт, если in_bytes); None — заранее неизвестно.
    estimate — примерный размер в байтах, когда точный неизвестен: полоска тогда приблизительная."""

    def __init__(self, title, total=None, step=None, unit="файлов", in_bytes=False, estimate=None):
        self.label = f"[{step}] {title}" if step else title
        self.total, self.unit, self.in_bytes, self.estimate = total, unit, in_bytes, estimate
        self.finished = False
        self.done = self.bytes = 0
        self.lock = threading.Lock()
        # Если вывод перенаправлен в файл, перерисовывать строку незачем — печатаем только итог
        self.live = sys.stdout.isatty()
        self.last_draw = 0.0
        self._draw(force=True)

    def advance(self, count=1, nbytes=0):
        with self.lock:
            self.done += nbytes if self.in_bytes else count
            self.bytes += nbytes
            self._draw()

    def _bar(self, frac, approx=False):
        filled = int(WIDTH * frac)
        return f"{FULL * filled}{EMPTY * (WIDTH - filled)} {'~' if approx else ''}{frac:.0%}  "

    def _line(self, extra=""):
        if self.total:
            bar = self._bar(min(self.done / self.total, 1))
            amount = (f"{mb(self.done)} из {mb(self.total)}" if self.in_bytes
                      else f"{self.done}/{self.total} {self.unit}" + (f" · {mb(self.bytes)}" if self.bytes else ""))
        elif self.finished:
            bar, amount = self._bar(1), f"скачано {mb(self.bytes)}"
        elif self.estimate:
            # Точный размер неизвестен — примерная полоска, до конца не доходит, пока идёт скачивание
            bar = self._bar(min(self.bytes / self.estimate, 0.99), approx=True)
            amount = f"{mb(self.bytes)} из ~{mb(self.estimate)}"
        else:
            bar, amount = "", f"скачано {mb(self.bytes)}"
        return f"{self.label:<24} {bar}{amount}{extra}"

    def _draw(self, force=False):
        now = time.monotonic()
        if not self.live or (not force and now - self.last_draw < 0.1):
            return
        self.last_draw = now
        sys.stdout.write("\r" + self._line() + "   ")
        sys.stdout.flush()

    def finish(self, extra=""):
        with self.lock:
            self.finished = True
            line = self._line(extra)
        sys.stdout.write(("\r" if self.live else "") + line + "   \n")
        sys.stdout.flush()
