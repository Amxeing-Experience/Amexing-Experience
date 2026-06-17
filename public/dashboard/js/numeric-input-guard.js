/**
 * Numeric input guard.
 *
 * Prevents letters (and other non-numeric characters) from being entered in
 * every <input type="number"> across the dashboard. Works for typing, pasting
 * and drag-and-drop. Uses event delegation on the document so it also applies
 * to inputs that are added to the DOM dynamically (modals, datatables, etc.).
 *
 * A field is allowed to contain:
 *   - digits 0-9 (always)
 *   - a decimal point '.' (only when step allows decimals)
 *   - a leading minus '-' (only when the field allows negatives: min < 0 or no min)
 *
 * Created by Denisse Maldonado
 */
(function numericInputGuard() {
  'use strict';

  function isNumberInput(el) {
    return !!el
      && el.tagName === 'INPUT'
      && (el.getAttribute('type') || '').toLowerCase() === 'number'
      && !el.readOnly
      && !el.disabled;
  }

  function allowsNegative(el) {
    const min = el.getAttribute('min');
    return min === null || min === '' || parseFloat(min) < 0;
  }

  function allowsDecimal(el) {
    const step = el.getAttribute('step');
    if (step === null || step === '') {
      return false; // default step is 1 -> integers only
    }
    if (step === 'any') {
      return true;
    }
    const parsed = parseFloat(step);
    return !Number.isNaN(parsed) && parsed % 1 !== 0;
  }

  function charIsAllowed(ch, el) {
    if (ch >= '0' && ch <= '9') {
      return true;
    }
    if (ch === '.' && allowsDecimal(el)) {
      return true;
    }
    if (ch === '-' && allowsNegative(el)) {
      return true;
    }
    return false;
  }

  function textIsAllowed(text, el) {
    for (let i = 0; i < text.length; i += 1) {
      if (!charIsAllowed(text[i], el)) {
        return false;
      }
    }
    return true;
  }

  // Primary guard: blocks insertion of any disallowed character from keyboard,
  // paste or drop. Deletions / history operations pass through (e.data is null).
  document.addEventListener('beforeinput', function onBeforeInput(e) {
    const el = e.target;
    if (!isNumberInput(el)) {
      return;
    }
    if (e.data == null) {
      return;
    }
    if (!textIsAllowed(e.data, el)) {
      e.preventDefault();
    }
  }, true);

  // Fallback for browsers that don't fire beforeinput on number inputs.
  document.addEventListener('keydown', function onKeyDown(e) {
    const el = e.target;
    if (!isNumberInput(el)) {
      return;
    }
    // Let shortcuts (copy/paste/select-all), function and navigation keys work.
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) {
      return;
    }
    if (!charIsAllowed(e.key, el)) {
      e.preventDefault();
    }
  }, true);

  // Paste fallback: keep only the valid characters instead of rejecting silently.
  document.addEventListener('paste', function onPaste(e) {
    const el = e.target;
    if (!isNumberInput(el)) {
      return;
    }
    const clipboard = e.clipboardData || window.clipboardData;
    if (!clipboard) {
      return;
    }
    const text = clipboard.getData('text');
    if (text == null || textIsAllowed(text, el)) {
      return;
    }
    e.preventDefault();
    let sanitized = '';
    for (let i = 0; i < text.length; i += 1) {
      if (charIsAllowed(text[i], el)) {
        sanitized += text[i];
      }
    }
    if (sanitized) {
      try {
        el.setRangeText(sanitized, el.selectionStart || 0, el.selectionEnd || 0, 'end');
      } catch (err) {
        // Number inputs may not support selection ranges; append as fallback.
        el.value = (el.value || '') + sanitized;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, true);
}());
