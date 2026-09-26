from PyQt6.QtWidgets import QWidget, QLabel, QVBoxLayout, QGraphicsDropShadowEffect
from PyQt6.QtCore import Qt, QTimer, QPoint
from PyQt6.QtGui import QColor, QPainter, QBrush, QPen, QPolygon, QFont

class SpeechBubble(QWidget):
    """
    A stylized, floating comic-book speech bubble that appears over the pet.
    Supports typewriter text animations and auto-dismissal.
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint |
            Qt.WindowType.WindowStaysOnTopHint |
            Qt.WindowType.SubWindow
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating, True)

        self.full_text = ""
        self.current_char_idx = 0

        # Typewriter timer
        self.type_timer = QTimer(self)
        self.type_timer.timeout.connect(self._type_next_char)

        # Hide timer
        self.hide_timer = QTimer(self)
        self.hide_timer.setSingleShot(True)
        self.hide_timer.timeout.connect(self.hide)

        # Layout & Label
        layout = QVBoxLayout(self)
        layout.setContentsMargins(15, 12, 15, 20)  # extra bottom margin for tail

        self.label = QLabel("", self)
        self.label.setWordWrap(True)
        self.label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.label.setFont(QFont("Segoe UI", 10, QFont.Weight.Medium))
        self.label.setStyleSheet("color: #1A1A1A; background: transparent;")

        layout.addWidget(self.label)
        self.setMaximumWidth(260)
        self.setMinimumWidth(120)

    def speak(self, text: str, duration_sec: float = 4.5, typing_speed_ms: int = 25):
        """Displays text with typewriter effect and auto-hides after duration."""
        self.full_text = text
        self.current_char_idx = 0
        self.label.setText("")
        self.adjustSize()
        self.show()

        self.type_timer.stop()
        self.hide_timer.stop()

        if typing_speed_ms > 0:
            self.type_timer.start(typing_speed_ms)
        else:
            self.label.setText(self.full_text)
            self.adjustSize()

        # Start dismissal timer after full duration
        self.hide_timer.start(int(duration_sec * 1000))

    def _type_next_char(self):
        if self.current_char_idx < len(self.full_text):
            self.current_char_idx += 1
            self.label.setText(self.full_text[:self.current_char_idx])
            self.adjustSize()
        else:
            self.type_timer.stop()

    def paintEvent(self, event):
        """Draws rounded speech bubble with pointer tail."""
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        # Main bubble body rectangle
        rect_width = self.width() - 4
        rect_height = self.height() - 14

        # Background & Border
        brush = QBrush(QColor(255, 255, 255, 245))
        pen = QPen(QColor(40, 40, 40, 200), 1.5)

        painter.setBrush(brush)
        painter.setPen(pen)
        painter.drawRoundedRect(2, 2, rect_width, rect_height, 12, 12)

        # Pointer triangle pointing down towards the pet
        triangle = QPolygon([
            QPoint(int(self.width() * 0.45), rect_height + 2),
            QPoint(int(self.width() * 0.55), rect_height + 2),
            QPoint(int(self.width() * 0.50), rect_height + 12)
        ])
        painter.drawPolygon(triangle)
        # Erase internal border between bubble and tail
        painter.setPen(QPen(QColor(255, 255, 255, 245), 2))
        painter.drawLine(int(self.width() * 0.46), rect_height + 2, int(self.width() * 0.54), rect_height + 2)
