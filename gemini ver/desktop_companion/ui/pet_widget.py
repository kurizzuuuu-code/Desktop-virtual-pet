import os
import glob
import math
import random
import logging
from typing import Dict, Optional, List

from PyQt6.QtWidgets import QWidget, QLabel, QMenu
from PyQt6.QtCore import Qt, QTimer, QPoint, QSize, pyqtSignal
from PyQt6.QtGui import (
    QPainter, QColor, QBrush, QPen, QMovie, QPixmap,
    QCursor, QAction
)

from core.state_manager import StateManager, PetState
from core.config_manager import ConfigManager
from ui.speech_bubble import SpeechBubble

logger = logging.getLogger(__name__)

class PetWidget(QWidget):
    """
    Main desktop pet companion window.
    Features:
    - Transparent, frameless, always-on-top window
    - Draggable and interactive
    - Custom user GIF / image animation loader
    - Synchronized speech bubble overlay
    """

    state_changed_signal = pyqtSignal(str)
    clicked_signal = pyqtSignal()
    open_settings_signal = pyqtSignal()

    def __init__(self, config_manager: ConfigManager, state_manager: StateManager):
        super().__init__()
        self.config_manager = config_manager
        self.state_manager = state_manager

        # Window settings
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint |
            Qt.WindowType.WindowStaysOnTopHint |
            Qt.WindowType.SubWindow
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)

        # Dimensions
        pet_cfg = self.config_manager.get("pet")
        self.pet_width = pet_cfg.get("width", 160)
        self.pet_height = pet_cfg.get("height", 160)
        self.resize(self.pet_width, self.pet_height)

        # Dragging state
        self._drag_pos = QPoint()
        self._is_dragging = False

        # Speech bubble
        self.speech_bubble = SpeechBubble()

        # Animation assets cache: { PetState: QMovie | List[QPixmap] | None }
        self.custom_movies: Dict[PetState, QMovie] = {}
        self.custom_pixmaps: Dict[PetState, List[QPixmap]] = {}
        self.current_frame_idx = 0

        # Animation timers
        self.anim_timer = QTimer(self)
        self.anim_timer.timeout.connect(self._on_animation_tick)
        self.anim_timer.start(50)  # 20 FPS for animation updates

        # Animation motion variables
        self.tick_counter = 0
        self.bounce_offset_y = 0.0
        self.tilt_angle = 0.0

        # Load user custom assets
        self.reload_assets()

        # Connect state manager listener
        self.state_manager.add_listener(self._on_state_changed)

    def reload_assets(self):
        """Loads user-provided GIFs or images for each state from disk."""
        self.custom_movies.clear()
        self.custom_pixmaps.clear()

        anim_paths = self.config_manager.get("animations")
        for state in PetState:
            folder_or_path = anim_paths.get(state.value, f"assets/custom_animations/{state.value}")
            abs_path = os.path.abspath(folder_or_path)

            if os.path.isfile(abs_path):
                self._load_file_asset(state, abs_path)
            elif os.path.isdir(abs_path):
                # Search for GIFs first, then image sequences
                gifs = glob.glob(os.path.join(abs_path, "*.gif"))
                if gifs:
                    self._load_file_asset(state, gifs[0])
                else:
                    imgs = sorted(glob.glob(os.path.join(abs_path, "*.png")) +
                                  glob.glob(os.path.join(abs_path, "*.jpg")) +
                                  glob.glob(os.path.join(abs_path, "*.webp")))
                    if imgs:
                        pixmaps = [QPixmap(img).scaled(
                            self.pet_width, self.pet_height,
                            Qt.AspectRatioMode.KeepAspectRatio,
                            Qt.TransformationMode.SmoothTransformation
                        ) for img in imgs]
                        self.custom_pixmaps[state] = pixmaps
                        logger.info("Loaded %d image frames for state '%s'", len(pixmaps), state.value)

        self.update()

    def _load_file_asset(self, state: PetState, filepath: str):
        if filepath.lower().endswith(".gif"):
            movie = QMovie(filepath)
            movie.setScaledSize(QSize(self.pet_width, self.pet_height))
            movie.frameChanged.connect(lambda: self.update())
            self.custom_movies[state] = movie
            logger.info("Loaded custom GIF for state '%s': %s", state.value, filepath)
        else:
            pix = QPixmap(filepath).scaled(
                self.pet_width, self.pet_height,
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation
            )
            self.custom_pixmaps[state] = [pix]
            logger.info("Loaded custom static image for state '%s': %s", state.value, filepath)

    def _on_state_changed(self, old_state: PetState, new_state: PetState):
        """Triggered when state transitions."""
        if old_state in self.custom_movies:
            self.custom_movies[old_state].stop()

        if new_state in self.custom_movies:
            self.custom_movies[new_state].start()

        self.current_frame_idx = 0
        self.state_changed_signal.emit(new_state.value)
        self.update()

    def _on_animation_tick(self):
        """Updates internal animation counters and triggers redraw."""
        self.tick_counter += 1
        curr_state = self.state_manager.current_state

        # State-based movements (rhythm / waddle)
        if curr_state == PetState.DANCE:
            self.bounce_offset_y = math.sin(self.tick_counter * 0.4) * 8.0
            self.tilt_angle = math.sin(self.tick_counter * 0.2) * 12.0
        elif curr_state == PetState.WALK:
            self.bounce_offset_y = abs(math.sin(self.tick_counter * 0.3)) * 5.0
            self.tilt_angle = math.sin(self.tick_counter * 0.3) * 6.0
        elif curr_state == PetState.CHEER:
            self.bounce_offset_y = -abs(math.sin(self.tick_counter * 0.5)) * 12.0
            self.tilt_angle = 0.0
        elif curr_state == PetState.TEASE:
            self.bounce_offset_y = 0.0
            self.tilt_angle = math.sin(self.tick_counter * 0.4) * 15.0
        elif curr_state == PetState.TALK:
            self.bounce_offset_y = math.sin(self.tick_counter * 0.2) * 2.0
            self.tilt_angle = 0.0
        else:  # IDLE
            self.bounce_offset_y = math.sin(self.tick_counter * 0.08) * 2.0
            self.tilt_angle = 0.0

        # Cycle multi-frame pixmaps if available
        if curr_state in self.custom_pixmaps and len(self.custom_pixmaps[curr_state]) > 1:
            self.current_frame_idx = (self.current_frame_idx + 1) % len(self.custom_pixmaps[curr_state])

        self.update()

    def paintEvent(self, event):
        """Renders user custom assets."""
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        curr_state = self.state_manager.current_state

        # 1. Custom GIF for current state
        if curr_state in self.custom_movies:
            movie = self.custom_movies[curr_state]
            current_pix = movie.currentPixmap()
            if not current_pix.isNull():
                painter.drawPixmap(0, int(self.bounce_offset_y), current_pix)
                return

        # 2. Custom Image / Frame Sequence for current state
        if curr_state in self.custom_pixmaps and self.custom_pixmaps[curr_state]:
            frames = self.custom_pixmaps[curr_state]
            pix = frames[self.current_frame_idx % len(frames)]
            painter.drawPixmap(0, int(self.bounce_offset_y), pix)
            return

        # 3. Fallback to Idle custom asset if current state asset is missing
        if PetState.IDLE in self.custom_movies:
            movie = self.custom_movies[PetState.IDLE]
            current_pix = movie.currentPixmap()
            if not current_pix.isNull():
                painter.drawPixmap(0, int(self.bounce_offset_y), current_pix)
                return

        if PetState.IDLE in self.custom_pixmaps and self.custom_pixmaps[PetState.IDLE]:
            frames = self.custom_pixmaps[PetState.IDLE]
            pix = frames[self.current_frame_idx % len(frames)]
            painter.drawPixmap(0, int(self.bounce_offset_y), pix)
            return

    def speak(self, text: str, duration_sec: float = 4.5):
        """Displays text in speech bubble above the pet."""
        self.update_speech_bubble_position()
        dialogues_cfg = self.config_manager.get("dialogues")
        typing_speed = dialogues_cfg.get("typing_speed_ms", 30)
        self.speech_bubble.speak(text, duration_sec=duration_sec, typing_speed_ms=typing_speed)

    def update_speech_bubble_position(self):
        """Aligns speech bubble directly centered above the pet widget."""
        bubble_x = self.x() + (self.width() - self.speech_bubble.width()) // 2
        bubble_y = max(10, self.y() - self.speech_bubble.height() - 8)
        self.speech_bubble.move(bubble_x, bubble_y)

    def moveEvent(self, event):
        super().moveEvent(event)
        self.update_speech_bubble_position()

    # Mouse Events for dragging & clicking
    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self._drag_pos = event.globalPosition().toPoint() - self.frameGeometry().topLeft()
            self._is_dragging = False
            event.accept()

    def mouseMoveEvent(self, event):
        if event.buttons() == Qt.MouseButton.LeftButton:
            self._is_dragging = True
            self.move(event.globalPosition().toPoint() - self._drag_pos)
            event.accept()

    def mouseReleaseEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            if not self._is_dragging:
                self.clicked_signal.emit()
            self._is_dragging = False
            event.accept()

    def contextMenuEvent(self, event):
        """Right-click context menu."""
        menu = QMenu(self)
        menu.setStyleSheet("""
            QMenu {
                background-color: #242424;
                color: #FFFFFF;
                border: 1px solid #3E3E3E;
                border-radius: 6px;
                padding: 4px;
            }
            QMenu::item {
                padding: 6px 20px;
                border-radius: 4px;
            }
            QMenu::item:selected {
                background-color: #4A90E2;
            }
        """)

        # State sub-menu
        state_menu = menu.addMenu("Perform Animation")
        for st in PetState:
            act = state_menu.addAction(st.value.capitalize())
            act.triggered.connect(lambda checked, s=st: self.state_manager.set_state(s, duration=5.0, force=True))

        menu.addSeparator()

        # Reload Assets
        reload_act = menu.addAction("Reload Custom Assets")
        reload_act.triggered.connect(self.reload_assets)

        # Settings
        settings_act = menu.addAction("Settings & Customization")
        settings_act.triggered.connect(lambda: self.open_settings_signal.emit())

        menu.addSeparator()

        # Exit
        exit_act = menu.addAction("Exit Companion")
        exit_act.triggered.connect(self.close_all)

        menu.exec(QCursor.pos())

    def close_all(self):
        self.speech_bubble.close()
        self.close()
