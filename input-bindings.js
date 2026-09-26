/** Shared mouse/key binding helpers for main + renderer. */
(function (root) {
  const DRAG_ACTIONS = [
    'LeftClick',
    'RightClick',
    'MiddleClick',
    'Ctrl+LeftClick',
    'Shift+LeftClick',
    'Alt+LeftClick',
    'Ctrl+RightClick',
  ];

  const PET_ACTIONS = [
    'HoverMove',
    'RightClickHold',
    'LeftClickHold',
    'LeftClickRepeated',
    'LeftClick',
    'Shift+LeftClick',
    'Ctrl+LeftClick',
    'MiddleClick',
  ];

  const DEFAULTS = {
    dragAction: 'RightClick',
    petAction: 'HoverMove',
  };

  const VK = {
    left: 0x01,
    right: 0x02,
    middle: 0x04,
    shift: 0x10,
    ctrl: 0x11,
    alt: 0x12,
  };

  function normalizeAction(value, allowed, fallback) {
    const v = String(value || '').trim();
    return allowed.includes(v) ? v : fallback;
  }

  function parseBinding(raw) {
    const value = String(raw || '').trim();
    if (!value) return null;
    if (value === 'HoverMove') return { type: 'hover', button: -1, ctrl: false, shift: false, alt: false };

    let type = 'click';
    let token = value;
    if (token.endsWith('Hold')) {
      type = 'hold';
      token = token.slice(0, -4);
    } else if (token.endsWith('Repeated')) {
      type = 'repeat';
      token = token.slice(0, -8);
    }

    let ctrl = false;
    let shift = false;
    let alt = false;
    let button = 0;
    for (const part of token.split('+')) {
      const p = part.trim().toLowerCase();
      if (!p) continue;
      if (p === 'ctrl' || p === 'control') ctrl = true;
      else if (p === 'shift') shift = true;
      else if (p === 'alt') alt = true;
      else if (p === 'leftclick' || p === 'left') button = 0;
      else if (p === 'middleclick' || p === 'middle') button = 1;
      else if (p === 'rightclick' || p === 'right') button = 2;
    }
    return { type, button, ctrl, shift, alt };
  }

  function eventMatchesBinding(binding, event) {
    if (!binding || binding.type === 'hover' || !event) return false;
    if (event.button !== binding.button) return false;
    if (!!binding.ctrl !== !!event.ctrlKey) return false;
    if (!!binding.shift !== !!event.shiftKey) return false;
    if (!!binding.alt !== !!event.altKey) return false;
    return true;
  }

  function mouseVk(button) {
    if (button === 0) return VK.left;
    if (button === 1) return VK.middle;
    if (button === 2) return VK.right;
    return VK.left;
  }

  function bindingsSharePointer(a, b) {
    if (!a || !b || a.type === 'hover' || b.type === 'hover') return false;
    return a.button === b.button && a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt;
  }

  const api = {
    DRAG_ACTIONS,
    PET_ACTIONS,
    DEFAULTS,
    VK,
    normalizeAction,
    parseBinding,
    eventMatchesBinding,
    mouseVk,
    bindingsSharePointer,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.PetInputBindings = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
