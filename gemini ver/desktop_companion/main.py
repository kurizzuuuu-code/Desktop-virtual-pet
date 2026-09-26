import sys
import os
import random
import logging
from typing import Optional

from PyQt6.QtWidgets import QApplication
from PyQt6.QtCore import QTimer, QPoint
from PyQt6.QtGui import QGuiApplication

from core.config_manager import ConfigManager
from core.state_manager import StateManager, PetState
from core.audio_listener import AudioListener
from core.activity_tracker import ActivityTracker
from ui.pet_widget import PetWidget
from ui.settings_dialog import SettingsDialog

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] (%(name)s) %(message)s"
)
logger = logging.getLogger("DesktopCompanion")

class DesktopCompanionApp:
    """
    Main Application Controller for Desktop Pet Companion.
    Coordinates audio reactivity, activity/game tracking, autonomous roaming,
    and dialogue systems.
    """

    def __init__(self):
        self.config_manager = ConfigManager("config.json")
        self.state_manager = StateManager(PetState.IDLE)

        # Pet Widget UI
        self.pet_widget = PetWidget(self.config_manager, self.state_manager)

        # Roaming mechanics
        self.roam_timer = QTimer()
        self.roam_timer.timeout.connect(self._handle_roaming)
        self.roam_target_x: Optional[int] = None
        self.is_roaming = False

        # Idle dialogue chatter timer
        self.chatter_timer = QTimer()
        self.chatter_timer.timeout.connect(self._handle_random_chatter)

        # Settings dialog instance
        self.settings_dialog: Optional[SettingsDialog] = None

        # Connect UI signals
        self.pet_widget.clicked_signal.connect(self._handle_pet_clicked)
        self.pet_widget.open_settings_signal.connect(self._open_settings)

        # Initialize Background Services
        self._init_audio_listener()
        self._init_activity_tracker()

        # Position pet initially at the bottom right corner of the primary screen
        self._position_on_screen()

        # Start timers
        self.roam_timer.start(50)  # Smooth 20 FPS movement step
        self._schedule_next_chatter()

    def _position_on_screen(self):
        """Positions pet near bottom right corner."""
        screen = QGuiApplication.primaryScreen().availableGeometry()
        init_x = screen.width() - self.pet_widget.width() - 80
        init_y = screen.height() - self.pet_widget.height() - 40
        self.pet_widget.move(init_x, init_y)
        self.pet_widget.show()

    def _init_audio_listener(self):
        """Initializes background audio monitor for music/beat detection."""
        audio_cfg = self.config_manager.get("audio_reactive")
        if audio_cfg.get("enabled", True):
            self.audio_listener = AudioListener(
                sample_rate=audio_cfg.get("sample_rate", 44100),
                chunk_size=audio_cfg.get("chunk_size", 2048),
                rms_threshold=audio_cfg.get("rms_threshold", 0.025),
                dance_duration=audio_cfg.get("dance_duration_seconds", 4.0),
                on_beat_detected=self._on_music_beat_detected
            )
            self.audio_listener.start()
        else:
            self.audio_listener = None

    def _init_activity_tracker(self):
        """Initializes activity/game window tracker."""
        act_cfg = self.config_manager.get("activity_reactions")
        if act_cfg.get("enabled", True):
            self.activity_tracker = ActivityTracker(
                keywords=act_cfg.get("game_window_keywords", []),
                check_interval=act_cfg.get("check_interval_seconds", 12),
                cheer_probability=act_cfg.get("cheer_probability", 0.6),
                on_game_detected=self._on_game_activity_detected
            )
            self.activity_tracker.start()
        else:
            self.activity_tracker = None

    def _on_music_beat_detected(self, rms_energy: float):
        """Called when background music is detected."""
        curr_state = self.state_manager.current_state
        if curr_state != PetState.DANCE:
            dance_duration = self.config_manager.get("audio_reactive", "dance_duration_seconds", 4.0)
            if self.state_manager.set_state(PetState.DANCE, duration=dance_duration):
                music_phrases = self.config_manager.get("dialogues", "music_phrases", [])
                if music_phrases and random.random() < 0.5:
                    self.pet_widget.speak(random.choice(music_phrases), duration_sec=3.5)

    def _on_game_activity_detected(self, reaction_type: str, window_title: str):
        """Called when a game or target application is active."""
        if reaction_type == "cheer":
            self.state_manager.set_state(PetState.CHEER, duration=5.0)
            phrases = self.config_manager.get("dialogues", "game_cheer_phrases", [])
        else:
            self.state_manager.set_state(PetState.TEASE, duration=5.0)
            phrases = self.config_manager.get("dialogues", "game_tease_phrases", [])

        if phrases:
            self.pet_widget.speak(random.choice(phrases), duration_sec=4.5)

    def _handle_pet_clicked(self):
        """Triggered when user clicks/pokes the pet."""
        self.state_manager.set_state(PetState.TALK, duration=3.0, force=True)
        click_phrases = self.config_manager.get("dialogues", "click_phrases", [])
        if click_phrases:
            self.pet_widget.speak(random.choice(click_phrases), duration_sec=3.5)

    def _handle_roaming(self):
        """Handles smooth autonomous walking across the desktop."""
        pet_cfg = self.config_manager.get("pet")
        if not pet_cfg.get("enable_roaming", True):
            return

        curr_state = self.state_manager.current_state

        # If not currently roaming, randomly decide to start a walk
        if not self.is_roaming:
            if curr_state == PetState.IDLE and random.random() < 0.005:  # ~once every 10-15s
                screen = QGuiApplication.primaryScreen().availableGeometry()
                min_x = 50
                max_x = screen.width() - self.pet_widget.width() - 50
                self.roam_target_x = random.randint(min_x, max_x)
                self.is_roaming = True
                self.state_manager.set_state(PetState.WALK)
            return

        # While roaming
        if self.roam_target_x is not None:
            curr_x = self.pet_widget.x()
            speed = pet_cfg.get("roam_speed", 2)
            dist = self.roam_target_x - curr_x

            if abs(dist) <= speed:
                # Target reached
                self.pet_widget.move(self.roam_target_x, self.pet_widget.y())
                self.is_roaming = False
                self.roam_target_x = None
                self.state_manager.reset_to_idle()
            else:
                step = speed if dist > 0 else -speed
                self.pet_widget.move(curr_x + step, self.pet_widget.y())

    def _schedule_next_chatter(self):
        """Schedules random idle conversation."""
        interval_range = self.config_manager.get("dialogues", "idle_interval_seconds", [20, 45])
        delay_ms = random.randint(int(interval_range[0] * 1000), int(interval_range[1] * 1000))
        self.chatter_timer.start(delay_ms)

    def _handle_random_chatter(self):
        """Speaks random idle dialogue."""
        if self.state_manager.current_state == PetState.IDLE:
            idle_phrases = self.config_manager.get("dialogues", "idle_phrases", [])
            if idle_phrases and random.random() < 0.7:
                self.state_manager.set_state(PetState.TALK, duration=3.5)
                self.pet_widget.speak(random.choice(idle_phrases), duration_sec=4.0)

        self._schedule_next_chatter()

    def _open_settings(self):
        """Opens settings customization dialog."""
        if self.settings_dialog is None:
            self.settings_dialog = SettingsDialog(
                self.config_manager,
                on_save_callback=self.pet_widget.reload_assets
            )
        self.settings_dialog.show()
        self.settings_dialog.raise_()
        self.settings_dialog.activateWindow()

def main():
    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)

    companion = DesktopCompanionApp()

    logger.info("Desktop Pet Companion running. Press Ctrl+C or right-click pet -> Exit to quit.")
    try:
        sys.exit(app.exec())
    except KeyboardInterrupt:
        logger.info("Exiting on KeyboardInterrupt.")

if __name__ == "__main__":
    main()
