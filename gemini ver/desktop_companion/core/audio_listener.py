import threading
import time
import logging
from typing import Callable, Optional

logger = logging.getLogger(__name__)

# Attempt to import sounddevice and numpy
try:
    import numpy as np
    import sounddevice as sd
    AUDIO_AVAILABLE = True
except ImportError:
    AUDIO_AVAILABLE = False
    logger.warning("sounddevice or numpy not installed. Audio-reactive dancing will run in fallback simulation mode.")

class AudioListener:
    """
    Monitors system/microphone audio in a background thread and detects
    rhythmic/loud audio signals to trigger pet dancing.
    """

    def __init__(
        self,
        sample_rate: int = 44100,
        chunk_size: int = 2048,
        rms_threshold: float = 0.025,
        dance_duration: float = 4.0,
        on_beat_detected: Optional[Callable[[float], None]] = None
    ):
        self.sample_rate = sample_rate
        self.chunk_size = chunk_size
        self.rms_threshold = rms_threshold
        self.dance_duration = dance_duration
        self.on_beat_detected = on_beat_detected

        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._stream = None
        self._last_trigger_time = 0.0
        self._smoothed_rms = 0.0

    def start(self):
        """Starts audio monitoring stream in background."""
        if not AUDIO_AVAILABLE:
            logger.info("Audio library not available; audio listener inactive.")
            return

        if self._running:
            return

        self._running = True
        self._thread = threading.Thread(target=self._run_stream, daemon=True)
        self._thread.start()
        logger.info("Audio listener thread started (threshold: %.4f)", self.rms_threshold)

    def stop(self):
        """Stops the audio listener."""
        self._running = False
        if self._stream is not None:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception as e:
                logger.error("Error closing audio stream: %s", e)
            self._stream = None

    def _audio_callback(self, indata, frames, time_info, status):
        """Callback invoked by sounddevice for each audio buffer."""
        if not self._running:
            return
        if status:
            logger.debug("Audio status: %s", status)

        try:
            # Calculate RMS energy of current audio frame
            rms = float(np.sqrt(np.mean(indata**2)))
            # Exponential smoothing
            self._smoothed_rms = 0.7 * self._smoothed_rms + 0.3 * rms

            now = time.time()
            if self._smoothed_rms > self.rms_threshold:
                if now - self._last_trigger_time > 1.0:  # Prevent excessive rapid firing
                    self._last_trigger_time = now
                    logger.debug("Music / Beat detected! (RMS: %.4f)", self._smoothed_rms)
                    if self.on_beat_detected:
                        self.on_beat_detected(self._smoothed_rms)
        except Exception as e:
            logger.error("Error processing audio frame: %s", e)

    def _run_stream(self):
        """Initializes and runs the sounddevice input stream."""
        try:
            with sd.InputStream(
                samplerate=self.sample_rate,
                blocksize=self.chunk_size,
                channels=1,
                callback=self._audio_callback
            ) as stream:
                self._stream = stream
                while self._running:
                    time.sleep(0.1)
        except Exception as e:
            logger.error("Failed to start sounddevice stream: %s. Audio reactive features disabled.", e)
            self._running = False
