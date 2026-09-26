import sys
import time
import random
import threading
import subprocess
import logging
from typing import Callable, List, Optional

logger = logging.getLogger(__name__)

# Try importing pygetwindow for Windows
try:
    if sys.platform == 'win32':
        import pygetwindow as gw
    else:
        gw = None
except ImportError:
    gw = None

try:
    import psutil
except ImportError:
    psutil = None

class ActivityTracker:
    """
    Monitors user activity and the currently active foreground window/game,
    triggering cheering or teasing reactions.
    """

    def __init__(
        self,
        keywords: List[str],
        check_interval: float = 12.0,
        cheer_probability: float = 0.6,
        on_game_detected: Optional[Callable[[str, str], None]] = None
    ):
        self.keywords = [k.lower() for k in keywords]
        self.check_interval = check_interval
        self.cheer_probability = cheer_probability
        self.on_game_detected = on_game_detected  # callback(reaction_type: 'cheer'|'tease', window_title: str)

        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._last_active_game = ""
        self._last_reaction_time = 0.0

    def start(self):
        """Starts the activity monitoring thread."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self._thread.start()
        logger.info("ActivityTracker thread started (interval: %.1fs)", self.check_interval)

    def stop(self):
        """Stops the monitoring thread."""
        self._running = False

    def get_active_window_title(self) -> str:
        """Retrieves active foreground window title across platforms."""
        title = ""
        try:
            if sys.platform == 'win32' and gw is not None:
                active_win = gw.getActiveWindow()
                if active_win:
                    title = active_win.title
            elif sys.platform == 'darwin':
                cmd = "osascript -e 'tell application \"System Events\" to get name of first application process whose frontmost is true'"
                res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=1)
                title = res.stdout.strip()
            elif sys.platform.startswith('linux'):
                cmd = "xdotool getwindowfocus getwindowname"
                res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=1)
                title = res.stdout.strip()
        except Exception as e:
            logger.debug("Failed to get active window title: %s", e)

        # Fallback to checking running processes if title is empty
        if not title and psutil is not None:
            try:
                for proc in psutil.process_iter(['name']):
                    pname = (proc.info['name'] or '').lower()
                    for kw in self.keywords:
                        if kw in pname:
                            return pname
            except Exception:
                pass

        return title

    def _monitor_loop(self):
        """Periodic loop checking active windows."""
        while self._running:
            try:
                title = self.get_active_window_title().lower()
                now = time.time()

                if title:
                    is_game = any(kw in title for kw in self.keywords)
                    if is_game:
                        # React if enough time passed (cooldown ~25-45s)
                        if now - self._last_reaction_time > random.uniform(25.0, 45.0):
                            self._last_reaction_time = now
                            self._last_active_game = title
                            reaction = "cheer" if random.random() < self.cheer_probability else "tease"
                            logger.info("Game detected ('%s') -> Triggering reaction: %s", title, reaction)
                            if self.on_game_detected:
                                self.on_game_detected(reaction, title)

            except Exception as e:
                logger.error("Error in activity tracker loop: %s", e)

            time.sleep(self.check_interval + random.uniform(0.5, 2.0))
