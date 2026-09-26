import json
import os
import logging
from typing import Any, Dict

logger = logging.getLogger(__name__)

DEFAULT_CONFIG: Dict[str, Any] = {
    "pet": {
        "name": "Desktop Companion",
        "width": 160,
        "height": 160,
        "scale": 1.0,
        "stay_on_top": True,
        "enable_roaming": True,
        "roam_speed": 2,
        "roam_chance": 0.3
    },
    "animations": {
        "idle": "assets/custom_animations/idle",
        "walk": "assets/custom_animations/walk",
        "talk": "assets/custom_animations/talk",
        "dance": "assets/custom_animations/dance",
        "cheer": "assets/custom_animations/cheer",
        "tease": "assets/custom_animations/tease"
    },
    "audio_reactive": {
        "enabled": True,
        "sample_rate": 44100,
        "chunk_size": 2048,
        "rms_threshold": 0.025,
        "dance_cooldown_seconds": 3.0,
        "dance_duration_seconds": 4.0
    },
    "activity_reactions": {
        "enabled": True,
        "check_interval_seconds": 12,
        "game_window_keywords": [
            "steam", "game", "valorant", "league", "genshin", "minecraft",
            "roblox", "fortnite", "cyberpunk", "elden ring", "dota",
            "counter-strike", "apex", "overwatch", "osu"
        ],
        "cheer_probability": 0.6
    },
    "dialogues": {
        "speech_bubble_enabled": True,
        "display_duration_seconds": 4.5,
        "typing_speed_ms": 30,
        "idle_interval_seconds": [20, 45],
        "idle_phrases": [
            "Just hanging out with you!",
            "*yawns* Whatcha working on?",
            "Don't forget to stretch and drink some water!",
            "I'm keeping you company~"
        ],
        "music_phrases": [
            "Ooh, love this beat! 🎵",
            "Vibing to the tune~ 💃",
            "Drop the bass! 🎶"
        ],
        "game_cheer_phrases": [
            "You got this! Win that match!",
            "Nice move! Show them who's boss!",
            "Full focus mode activated! 🚀"
        ],
        "game_tease_phrases": [
            "Did you just miss that? I saw that! 😜",
            "Skill issue? Just kidding, do your best!",
            "Don't choke now! Hehe."
        ],
        "click_phrases": [
            "Hey! That tickles!",
            "*pokes back*",
            "Need something, friend?"
        ]
    }
}

class ConfigManager:
    """Handles loading, validating, and saving configuration settings."""

    def __init__(self, config_path: str = "config.json"):
        self.config_path = os.path.abspath(config_path)
        self.config = self.load_config()

    def load_config(self) -> Dict[str, Any]:
        """Loads configuration from JSON file or creates default if missing."""
        if not os.path.exists(self.config_path):
            logger.info("Config file not found. Creating default config at %s", self.config_path)
            self.save_config(DEFAULT_CONFIG)
            return DEFAULT_CONFIG.copy()

        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return self._merge_defaults(data, DEFAULT_CONFIG)
        except Exception as e:
            logger.error("Failed to read config file (%s). Falling back to defaults.", e)
            return DEFAULT_CONFIG.copy()

    def _merge_defaults(self, current: Dict[str, Any], defaults: Dict[str, Any]) -> Dict[str, Any]:
        """Recursively merges default config keys if missing in current config."""
        merged = defaults.copy()
        for key, val in current.items():
            if isinstance(val, dict) and key in merged and isinstance(merged[key], dict):
                merged[key] = self._merge_defaults(val, merged[key])
            else:
                merged[key] = val
        return merged

    def save_config(self, config_data: Dict[str, Any] = None) -> bool:
        """Saves configuration data to file."""
        if config_data is not None:
            self.config = config_data
        try:
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(self.config, f, indent=2, ensure_ascii=False)
            return True
        except Exception as e:
            logger.error("Failed to save config file: %s", e)
            return False

    def get(self, section: str, key: str = None, default: Any = None) -> Any:
        """Helper to get nested config values safely."""
        sec = self.config.get(section, {})
        if key is None:
            return sec
        if isinstance(sec, dict):
            return sec.get(key, default)
        return default
