import os
import json
from PyQt6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit,
    QCheckBox, QSpinBox, QDoubleSpinBox, QTextEdit,
    QPushButton, QTabWidget, QWidget, QMessageBox
)
from PyQt6.QtCore import Qt
from core.config_manager import ConfigManager

class SettingsDialog(QDialog):
    """
    Settings and customization dialog for Desktop Pet Companion.
    Allows editing pet behaviors, dialogue lists, and audio thresholds.
    """

    def __init__(self, config_manager: ConfigManager, on_save_callback=None, parent=None):
        super().__init__(parent)
        self.config_manager = config_manager
        self.on_save_callback = on_save_callback

        self.setWindowTitle("Desktop Pet Companion - Settings")
        self.resize(520, 480)
        self.setStyleSheet("""
            QDialog {
                background-color: #1E1E1E;
                color: #FFFFFF;
                font-family: 'Segoe UI', sans-serif;
            }
            QLabel {
                color: #DDDDDD;
                font-size: 12px;
            }
            QTabWidget::pane {
                border: 1px solid #333333;
                background-color: #252526;
                border-radius: 4px;
            }
            QTabBar::tab {
                background: #2D2D30;
                color: #CCCCCC;
                padding: 8px 16px;
                border-top-left-radius: 4px;
                border-top-right-radius: 4px;
            }
            QTabBar::tab:selected {
                background: #3E3E42;
                color: #FFFFFF;
            }
            QLineEdit, QTextEdit, QSpinBox, QDoubleSpinBox {
                background-color: #333337;
                color: #FFFFFF;
                border: 1px solid #434346;
                border-radius: 4px;
                padding: 4px;
            }
            QPushButton {
                background-color: #0E639C;
                color: #FFFFFF;
                border: none;
                border-radius: 4px;
                padding: 8px 16px;
                font-weight: bold;
            }
            QPushButton:hover {
                background-color: #1177BB;
            }
        """)

        self.init_ui()

    def init_ui(self):
        main_layout = QVBoxLayout(self)

        self.tabs = QTabWidget(self)

        # Tab 1: General & Behavior
        general_tab = QWidget()
        gen_layout = QVBoxLayout(general_tab)

        # Pet Name
        gen_layout.addWidget(QLabel("Pet Name:"))
        self.name_edit = QLineEdit(self.config_manager.get("pet", "name", "Desktop Companion"))
        gen_layout.addWidget(self.name_edit)

        # Roaming checkbox
        self.roam_check = QCheckBox("Enable Autonomous Roaming")
        self.roam_check.setChecked(self.config_manager.get("pet", "enable_roaming", True))
        gen_layout.addWidget(self.roam_check)

        # Audio reactivity checkbox & threshold
        self.audio_check = QCheckBox("Enable Music / Audio Dancing Reactivity")
        self.audio_check.setChecked(self.config_manager.get("audio_reactive", "enabled", True))
        gen_layout.addWidget(self.audio_check)

        gen_layout.addWidget(QLabel("Audio Sensitivity (RMS Threshold - Lower = More Sensitive):"))
        self.audio_thresh_spin = QDoubleSpinBox()
        self.audio_thresh_spin.setRange(0.001, 1.0)
        self.audio_thresh_spin.setSingleStep(0.005)
        self.audio_thresh_spin.setValue(self.config_manager.get("audio_reactive", "rms_threshold", 0.025))
        gen_layout.addWidget(self.audio_thresh_spin)

        # Activity tracker
        self.activity_check = QCheckBox("Enable Game / Active Window Reactions (Cheer & Tease)")
        self.activity_check.setChecked(self.config_manager.get("activity_reactions", "enabled", True))
        gen_layout.addWidget(self.activity_check)

        gen_layout.addStretch()
        self.tabs.addTab(general_tab, "Behavior")

        # Tab 2: Dialogue Customization
        dialogue_tab = QWidget()
        diag_layout = QVBoxLayout(dialogue_tab)

        diag_layout.addWidget(QLabel("Idle Remarks (One per line):"))
        self.idle_edit = QTextEdit()
        self.idle_edit.setPlainText("\n".join(self.config_manager.get("dialogues", "idle_phrases", [])))
        diag_layout.addWidget(self.idle_edit)

        diag_layout.addWidget(QLabel("Game Cheering Phrases (One per line):"))
        self.cheer_edit = QTextEdit()
        self.cheer_edit.setPlainText("\n".join(self.config_manager.get("dialogues", "game_cheer_phrases", [])))
        diag_layout.addWidget(self.cheer_edit)

        diag_layout.addWidget(QLabel("Game Teasing Phrases (One per line):"))
        self.tease_edit = QTextEdit()
        self.tease_edit.setPlainText("\n".join(self.config_manager.get("dialogues", "game_tease_phrases", [])))
        diag_layout.addWidget(self.tease_edit)

        self.tabs.addTab(dialogue_tab, "Dialogues")

        main_layout.addWidget(self.tabs)

        # Bottom Buttons
        btn_layout = QHBoxLayout()
        btn_layout.addStretch()

        save_btn = QPushButton("Save & Apply")
        save_btn.clicked.connect(self.save_settings)
        btn_layout.addWidget(save_btn)

        cancel_btn = QPushButton("Cancel")
        cancel_btn.setStyleSheet("background-color: #444444;")
        cancel_btn.clicked.connect(self.reject)
        btn_layout.addWidget(cancel_btn)

        main_layout.addLayout(btn_layout)

    def save_settings(self):
        """Saves values to ConfigManager and closes."""
        self.config_manager.config["pet"]["name"] = self.name_edit.text().strip()
        self.config_manager.config["pet"]["enable_roaming"] = self.roam_check.isChecked()

        self.config_manager.config["audio_reactive"]["enabled"] = self.audio_check.isChecked()
        self.config_manager.config["audio_reactive"]["rms_threshold"] = self.audio_thresh_spin.value()

        self.config_manager.config["activity_reactions"]["enabled"] = self.activity_check.isChecked()

        # Dialogues
        self.config_manager.config["dialogues"]["idle_phrases"] = [
            line.strip() for line in self.idle_edit.toPlainText().split("\n") if line.strip()
        ]
        self.config_manager.config["dialogues"]["game_cheer_phrases"] = [
            line.strip() for line in self.cheer_edit.toPlainText().split("\n") if line.strip()
        ]
        self.config_manager.config["dialogues"]["game_tease_phrases"] = [
            line.strip() for line in self.tease_edit.toPlainText().split("\n") if line.strip()
        ]

        self.config_manager.save_config()
        if self.on_save_callback:
            self.on_save_callback()

        QMessageBox.information(self, "Saved", "Settings saved successfully!")
        self.accept()
