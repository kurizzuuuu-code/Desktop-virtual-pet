import enum
import time
import logging
from typing import Callable, List, Optional

logger = logging.getLogger(__name__)

class PetState(str, enum.Enum):
    IDLE = "idle"
    WALK = "walk"
    TALK = "talk"
    DANCE = "dance"
    CHEER = "cheer"
    TEASE = "tease"

class StateManager:
    """
    Manages the current animation state of the desktop companion,
    handling state priorities, timeouts, and change callbacks.
    """

    # Priority ranking (higher number = higher priority)
    STATE_PRIORITY = {
        PetState.IDLE: 1,
        PetState.WALK: 2,
        PetState.TALK: 3,
        PetState.CHEER: 4,
        PetState.TEASE: 4,
        PetState.DANCE: 5,
    }

    def __init__(self, initial_state: PetState = PetState.IDLE):
        self._current_state = initial_state
        self._state_start_time = time.time()
        self._state_duration: Optional[float] = None
        self._listeners: List[Callable[[PetState, PetState], None]] = []

    @property
    def current_state(self) -> PetState:
        # Check if temporary state has expired
        if self._state_duration is not None:
            if time.time() - self._state_start_time >= self._state_duration:
                self.set_state(PetState.IDLE, duration=None, force=True)
        return self._current_state

    def add_listener(self, callback: Callable[[PetState, PetState], None]):
        """Registers a callback for state changes: callback(old_state, new_state)"""
        self._listeners.append(callback)

    def set_state(self, new_state: PetState, duration: Optional[float] = None, force: bool = False) -> bool:
        """
        Attempts to transition to a new state.
        Returns True if transition succeeded, False if blocked by higher priority state.
        """
        old_state = self._current_state

        if not force:
            curr_priority = self.STATE_PRIORITY.get(old_state, 1)
            new_priority = self.STATE_PRIORITY.get(new_state, 1)

            # If current state has an active unexpired duration and higher priority, reject
            if self._state_duration is not None and (time.time() - self._state_start_time < self._state_duration):
                if new_priority < curr_priority:
                    return False

        if old_state != new_state:
            logger.debug("State transition: %s -> %s (duration=%s)", old_state, new_state, duration)
            self._current_state = new_state
            self._state_start_time = time.time()
            self._state_duration = duration

            for listener in self._listeners:
                try:
                    listener(old_state, new_state)
                except Exception as e:
                    logger.error("Error in state change listener: %s", e)
            return True
        else:
            # Refresh duration if same state
            if duration is not None:
                self._state_start_time = time.time()
                self._state_duration = duration
            return True

    def reset_to_idle(self):
        """Forces return to IDLE state."""
        self.set_state(PetState.IDLE, duration=None, force=True)
