# Desktop Pet Companion

A fully interactive, customizable desktop pet companion built with Python and PyQt6.

---

## Quick Start & Running the App

### Option A: Run Directly with Batch / Script (Quickest)
- **Double-click `run.bat`**: Launches the companion (shows console logs for debugging).
- **Double-click `run_silent.vbs`**: Launches the companion cleanly in the background with no command prompt window.

---

### Option B: Build a Standalone Executable (`.exe`)

To compile the project into a standalone Windows executable (`DesktopCompanion.exe`) that doesn't need to be run from source code:

1. **One-Click Build**:
   - Double-click **`build_exe.bat`**.
   - It will automatically install requirements, set up PyInstaller, and build the binary.

2. **Output Location**:
   - Once finished, your standalone application will be generated in:
     ```text
     dist/DesktopCompanion/DesktopCompanion.exe
     ```
   - You can create a desktop shortcut to `DesktopCompanion.exe` and launch it anytime.

---

### Option C: Manual Command Line Execution
1. Install Python 3.9+ from [python.org](https://www.python.org/).
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Run:
   ```bash
   python main.py
   ```

---

## Key Features

1. **Custom Animation Support**:
   - Easily drop in your own transparent animated GIFs (`.gif`) or frame sequences (`.png`, `.webp`, etc.).
   - Supports 6 distinct states: `idle`, `walk`, `talk`, `dance`, `cheer`, and `tease`.

2. **Music-Reactive Dancing**:
   - Monitors background audio / system music in real-time.
   - Detects beats and rhythm energy to trigger the `dance` animation state and cheerful music remarks.

3. **Game & Activity Awareness**:
   - Tracks foreground windows to detect when you are playing games.
   - Automatically watches and triggers dynamic **cheering** ("You got this!") or **teasing** ("Skill issue? 😜") reactions.

4. **Customizable Dialogues & Personalities**:
   - Floating typewriter speech bubble with auto-dismissal.
   - Fully customizable text for idle chatter, music reactions, game cheering, game teasing, and click interactions via `config.json` or the in-app Settings UI.

5. **Interactive & Autonomous**:
   - Draggable anywhere on the screen (always-on-top, transparent background).
   - Autonomous roaming / waddling across the bottom of the screen.
   - Left-click to pet/poke; Right-click for context menu (manual state triggering, asset reloading, settings, exit).

---

## Customizing Your Pet

### Adding Custom GIFs & Sprites
Place your GIF files directly inside the corresponding folders under `assets/custom_animations/`:
- `assets/custom_animations/idle/` (e.g. `idle.gif`)
- `assets/custom_animations/walk/` (e.g. `walk.gif`)
- `assets/custom_animations/talk/` (e.g. `talk.gif`)
- `assets/custom_animations/dance/` (e.g. `dance.gif`)
- `assets/custom_animations/cheer/` (e.g. `cheer.gif`)
- `assets/custom_animations/tease/` (e.g. `tease.gif`)

Right-click the pet and click **Reload Custom Assets** to apply changes instantly without restarting.

### Editing Dialogue & Settings
You can customize everything in `config.json` or right-click the pet and select **Settings & Customization**.
