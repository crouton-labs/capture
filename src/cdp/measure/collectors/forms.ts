/**
 * `forms.json` collector — native and contenteditable form-control facts:
 * value/placeholder line boxes, caret/selection rects, scroll offsets,
 * visible-substring range, validity state/message, label association,
 * autofill state, pseudo-state facts, and (best-effort) native-part
 * dimensions. Page-provided strings and values are preserved up to their
 * structural output caps.
 *
 * Measurement never touches a control's live `value`/`selectionStart`/
 * `selectionEnd`, and never mutates the DOM: native single-line controls
 * (every type except `textarea`) render their value on exactly one line,
 * so value/placeholder line boxes and caret/selection rects are computed
 * from `measureText` glyph-advance widths on a detached `<canvas>` (the
 * same never-appended pattern `text.ts` uses for its baseline metric)
 * combined with the control's own computed box model — the canvas is
 * created but never appended to the document, so it stays detached and
 * is never page-observable. Multiline
 * `textarea` wrapped-line layout (word-wrap/overflow-wrap/CJK/tabs/
 * white-space) is the browser's line-breaking engine, not reproducible
 * from `measureText` widths alone; rather than reimplement it or
 * silently approximate it, a `textarea`'s wrapped-layout facts (value/
 * placeholder line boxes, caret, selection rects) are reported as
 * factually unavailable (`textLayout: { available: false, reason }`)
 * while every non-layout fact (scroll, dimensions, selection indices,
 * validity, label, value/length, rect, pseudoState, autofill) is still
 * emitted. `contenteditable` regions are real DOM, so they use
 * the real `Selection`/`Range.getClientRects()` APIs directly.
 *
 * Control IDENTITY resolution (mapping each walked control to its stable
 * CDP `backendNodeId`, the cross-artifact join key) also never mutates the
 * DOM AND never assigns anything to `window` or any other page-observable
 * location: the walk's return value is a plain in-memory `{ facts,
 * elements }` object, read back purely through CDP's own remote-object
 * identity — `Runtime.evaluate({returnByValue: false})` hands back an
 * `objectId` for that object with zero page visibility into it,
 * `Runtime.getProperties` resolves `facts`'/`elements`'s own `objectId`s,
 * `Runtime.callFunctionOn({returnByValue: true})` reads `facts` out by
 * value, and a second `Runtime.getProperties` on `elements` resolves each
 * matched control's own `objectId` (the CDP identity bridge), which
 * `describeBackendNodeId` (shared with `geometry.ts`/`hittest.ts`) then
 * turns into a `backendNodeId`. A page can predefine a setter for any
 * global name it can guess; it can observe nothing here, because nothing
 * is ever set on it. No DOM mutation and no page-observable global either,
 * so nothing in the emitted `screenshot.png`/`dom.html`/any other baseline
 * collector running concurrently in the same `Promise.all` can ever
 * observe this collector having run.
 */

import type { CDPClient } from '../../client.js';
import type { Collector, ElementRecord } from '../types.js';
import { capArray, capString, sanitizeString } from '../redaction.js';
import { describeBackendNodeId } from './geometry.js';

/** Hard cap on the rect-array facts (`valueLineBoxes`/`placeholderLines`/`selectionRects`) emitted per control — page-shaped arrays get a factual truncation count for parity with geometry's track cap. */
const MAX_RECTS = 500;

/** Hard cap on controls emitted per snapshot — the single source of truth for the page-side walk's own `MAX_CONTROLS` (interpolated into `FORMS_WALK_EXPRESSION` below) and for the host-side `controlsTruncated` fact, so the two can never drift apart. */
const MAX_FORMS_CONTROLS = 300;

/** The label-association sources this collector recognizes; a page-shaped `source` outside this set normalizes to `'unknown'` (D8b — never spread the raw label object). */
const LABEL_SOURCE_ALLOWLIST = new Set(['for', 'wrapping', 'aria-label', 'aria-labelledby']);

/** Known HTML form-control `type`s, plus this collector's synthetic types (`select`, `textarea`, `contenteditable` — assigned on the page-side walk, not read off a `type` attribute). A page can put anything in a custom element's reported type; anything outside this set is not a real control-type fact and is normalized away. */
const KNOWN_CONTROL_TYPES = new Set([
  'text', 'password', 'email', 'tel', 'url', 'number', 'search',
  'date', 'datetime-local', 'month', 'week', 'time', 'color', 'range',
  'checkbox', 'radio', 'file', 'hidden', 'submit', 'reset', 'button', 'image',
  'select', 'textarea', 'contenteditable',
]);

/** Normalizes a control's `type` to the known allowlist, else `'unknown'`. */
function normalizeControlType(type: string): string {
  return KNOWN_CONTROL_TYPES.has(type) ? type : 'unknown';
}

interface RawRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface RawValidity {
  readonly valid: boolean;
  readonly valueMissing: boolean;
  readonly typeMismatch: boolean;
  readonly patternMismatch: boolean;
  readonly tooLong: boolean;
  readonly tooShort: boolean;
  readonly rangeUnderflow: boolean;
  readonly rangeOverflow: boolean;
  readonly stepMismatch: boolean;
  readonly badInput: boolean;
  readonly customError: boolean;
  readonly message: string;
}

interface RawLabel {
  readonly text: string;
  readonly rect?: RawRect;
  readonly source: 'for' | 'wrapping' | 'aria-label' | 'aria-labelledby';
}

interface RawControlRecord {
  readonly markId: string;
  readonly selector: string;
  readonly tagName: string;
  readonly type: string;
  readonly value: string;
  readonly valuePlaceholder: string | null;
  readonly selectionStart: number | null;
  readonly selectionEnd: number | null;
  readonly scrollLeft: number;
  readonly scrollTop: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly required: boolean;
  readonly pattern: string | null;
  readonly checked: boolean | null;
  readonly multiple: boolean;
  readonly validity: RawValidity | null;
  readonly label: RawLabel | null;
  readonly autofilled: boolean;
  readonly pseudoState: {
    readonly focused: boolean;
    readonly hovered: boolean;
    readonly active: boolean;
    readonly checked: boolean | null;
    readonly disabled: boolean;
    readonly readOnly: boolean;
    readonly invalid: boolean;
    readonly focusVisible: boolean;
  };
  readonly rect: RawRect;
  readonly valueLines: RawRect[];
  readonly placeholderLines: RawRect[];
  readonly caretRect: RawRect | null;
  readonly selectionRects: RawRect[];
  readonly visibleRange: { start: number; end: number } | null;
  /** Set only for `textarea` (multiline) controls: wrapped-line layout cannot be faithfully computed from `measureText` alone, so `valueLines`/`placeholderLines`/`caretRect`/`selectionRects`/`visibleRange` are left empty/null and this carries the factual reason. */
  readonly textLayoutUnavailable: string | null;
  /** `true` when the single-line rects above (`valueLines`/`placeholderLines`/`caretRect`/`selectionRects`) used the `1.2 * font-size` line-height heuristic because Chrome's computed `line-height` was the `normal` keyword rather than a used px value; `false` when a real computed line-height backed them; `null` when this control never computes single-line rects at all (textarea/select/contenteditable/checkable/password/file/range/color). */
  readonly lineHeightApproximate: boolean | null;
  readonly isContentEditable: boolean;
  readonly autocomplete: string | null;
  readonly name: string | null;
  readonly id: string | null;
}

/**
 * The page-side walk. Runs once via `Runtime.evaluate({returnByValue:
 * false})` (see the identity note above). Enumerates
 * `input`/`textarea`/`select`/`contenteditable` controls, reading (never
 * writing) each control's value/selection, and measures rendered text
 * geometry from `measureText` glyph-advance widths on a detached,
 * never-appended `<canvas>` plus the control's own box model (native
 * controls) or the real `Selection`/`Range` API (contenteditable).
 */
const FORMS_WALK_EXPRESSION = `(() => {
  const MAX_CONTROLS = ${MAX_FORMS_CONTROLS};
  const results = [];
  const elements = [];
  let counter = 0;

  function rectOf(r) { return { x: r.x, y: r.y, width: r.width, height: r.height }; }

  function cssSelector(el) {
    if (el.id) return '#' + el.id;
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
      let part = node.tagName.toLowerCase();
      if (node.classList && node.classList.length) {
        part += '.' + Array.from(node.classList).slice(0, 3).join('.');
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = parent;
      depth += 1;
    }
    return parts.join(' > ');
  }

  function isVisible(el) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function labelFor(el) {
    if (el.id) {
      try {
        const lbl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (lbl) return { text: lbl.textContent || '', rect: rectOf(lbl.getBoundingClientRect()), source: 'for' };
      } catch (e) {}
    }
    const wrapping = el.closest('label');
    if (wrapping) return { text: wrapping.textContent || '', rect: rectOf(wrapping.getBoundingClientRect()), source: 'wrapping' };
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return { text: ariaLabel, source: 'aria-label' };
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const ids = labelledBy.split(/\\s+/).filter(Boolean);
      const texts = ids.map((id) => { const n = document.getElementById(id); return n ? (n.textContent || '') : ''; }).filter((t) => t.length);
      if (texts.length) return { text: texts.join(' '), source: 'aria-labelledby' };
    }
    return null;
  }

  function validityOf(el) {
    if (!('validity' in el) || !el.validity) return null;
    const v = el.validity;
    return {
      valid: v.valid,
      valueMissing: !!v.valueMissing,
      typeMismatch: !!v.typeMismatch,
      patternMismatch: !!v.patternMismatch,
      tooLong: !!v.tooLong,
      tooShort: !!v.tooShort,
      rangeUnderflow: !!v.rangeUnderflow,
      rangeOverflow: !!v.rangeOverflow,
      stepMismatch: !!v.stepMismatch,
      badInput: !!v.badInput,
      customError: !!v.customError,
      message: el.validationMessage || '',
    };
  }

  function isAutofilled(el) {
    try { if (el.matches(':autofill')) return true; } catch (e) {}
    try { if (el.matches(':-webkit-autofill')) return true; } catch (e) {}
    return false;
  }

  function selectionOf(el) {
    try {
      return { start: el.selectionStart, end: el.selectionEnd };
    } catch (e) {
      return { start: null, end: null };
    }
  }

  // ---- detached-canvas measurement (native single-line text-like controls) ----
  // A <canvas> is created but NEVER appended anywhere — the same
  // never-appended pattern text.ts uses for its baseline metric — so no
  // MutationObserver on document.body/anywhere else can ever record
  // anything from this measurement. measureText(text).width is the
  // browser's true glyph-advance width for a text run at a given font,
  // which is faithful for a SINGLE-LINE control's rendered text (its value
  // never wraps). Combined with the control's own computed box model, this
  // reproduces value/placeholder line boxes, caret rects, selection rects,
  // and the visible-substring range without ever touching the live DOM.
  let __measureCanvas = null;
  function measureWidth(text, font) {
    if (!__measureCanvas) __measureCanvas = document.createElement('canvas');
    const c = __measureCanvas.getContext('2d');
    if (!c) return 0;
    c.font = font;
    return c.measureText(text).width;
  }

  function fontStringOf(cs) {
    return cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
  }

  function contentBoxOf(el, cs) {
    const rect = el.getBoundingClientRect();
    const bl = parseFloat(cs.borderLeftWidth) || 0;
    const bt = parseFloat(cs.borderTopWidth) || 0;
    const br = parseFloat(cs.borderRightWidth) || 0;
    const bb = parseFloat(cs.borderBottomWidth) || 0;
    const pl = parseFloat(cs.paddingLeft) || 0;
    const pt = parseFloat(cs.paddingTop) || 0;
    const pr = parseFloat(cs.paddingRight) || 0;
    const pb = parseFloat(cs.paddingBottom) || 0;
    return {
      left: rect.left + bl + pl,
      top: rect.top + bt + pt,
      width: Math.max(0, rect.width - bl - br - pl - pr),
      height: Math.max(0, rect.height - bt - bb - pt - pb),
    };
  }

  // lineHeightApproximate is honest per I-4: Chrome's computed line-height
  // for a native control sometimes resolves to the literal keyword normal
  // (not a used px value) rather than a specified length — the common case
  // for a control with no authored line-height — in which case there is no
  // real line-height metric to read, and 1.2 * font-size is a heuristic
  // guess, not a measurement. The flag names exactly that condition so a
  // guessed y/height is never indistinguishable from a metric-backed one.
  function singleLineTop(content, cs) {
    const parsedLineHeight = parseFloat(cs.lineHeight);
    const lineHeightApproximate = !parsedLineHeight;
    const lineHeight = parsedLineHeight || parseFloat(cs.fontSize) * 1.2;
    return { top: content.top + Math.max(0, (content.height - lineHeight) / 2), lineHeight: lineHeight, lineHeightApproximate: lineHeightApproximate };
  }

  function valueLineRect(el, cs, font, text, scrollLeft) {
    if (!text.length) return [];
    const content = contentBoxOf(el, cs);
    const line = singleLineTop(content, cs);
    return [{ x: content.left - scrollLeft, y: line.top, width: measureWidth(text, font), height: line.lineHeight }];
  }

  function caretRectOf(el, cs, font, text, offset, scrollLeft) {
    if (offset === null || offset === undefined) return null;
    const content = contentBoxOf(el, cs);
    const line = singleLineTop(content, cs);
    const safeOffset = Math.max(0, Math.min(offset, text.length));
    const x = content.left - scrollLeft + measureWidth(text.slice(0, safeOffset), font);
    return { x: x, y: line.top, width: 1, height: line.lineHeight };
  }

  function selectionRectsOf(el, cs, font, text, start, end, scrollLeft) {
    if (start === null || end === null || start === end) return [];
    const content = contentBoxOf(el, cs);
    const line = singleLineTop(content, cs);
    const len = text.length;
    const s = Math.max(0, Math.min(start, len));
    const e = Math.max(0, Math.min(end, len));
    const x1 = content.left - scrollLeft + measureWidth(text.slice(0, s), font);
    const x2 = content.left - scrollLeft + measureWidth(text.slice(0, e), font);
    return [{ x: Math.min(x1, x2), y: line.top, width: Math.abs(x2 - x1), height: line.lineHeight }];
  }

  function visibleRangeSingleLine(font, text, scrollLeft, clipWidth) {
    if (!text.length) return { start: 0, end: 0 };
    const len = text.length;
    let lo = 0, hi = len;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (measureWidth(text.slice(0, mid), font) >= scrollLeft) hi = mid; else lo = mid + 1; }
    const start = lo;
    lo = 0; hi = len;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (measureWidth(text.slice(0, mid), font) >= scrollLeft + clipWidth) hi = mid; else lo = mid + 1; }
    const end = Math.max(start, lo);
    return { start, end };
  }

  // ---- contenteditable: real Selection/Range ----
  function computeOffsets(root, range) {
    let start = -1, end = -1, count = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node === range.startContainer) start = count + range.startOffset;
      if (node === range.endContainer) end = count + range.endOffset;
      count += node.textContent.length;
    }
    return { start: start === -1 ? null : start, end: end === -1 ? null : end };
  }

  function contentEditableFacts(el) {
    const text = el.textContent || '';
    const range = document.createRange();
    range.selectNodeContents(el);
    const lines = Array.from(range.getClientRects()).map(rectOf);
    let selectionStart = null, selectionEnd = null, caretRect = null, selectionRects = [];
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const r0 = sel.getRangeAt(0);
      if (el.contains(r0.commonAncestorContainer)) {
        const offsets = computeOffsets(el, r0);
        selectionStart = offsets.start;
        selectionEnd = offsets.end;
        const rects2 = Array.from(r0.getClientRects()).map(rectOf);
        if (r0.collapsed) caretRect = rects2[0] || null;
        else selectionRects = rects2;
      }
    }
    return { text, lines, selectionStart, selectionEnd, caretRect, selectionRects };
  }

  const controls = document.querySelectorAll('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  // I-5: controlsTotal counts every visible candidate control this walk
  // finds — including those past MAX_CONTROLS, cheaply (no measurement work
  // for them) — so the host can report an honest total-vs-kept truncation
  // fact instead of a silent MAX_CONTROLS drop.
  let controlsTotal = 0;
  for (const el of controls) {
    if (!(el instanceof Element)) continue;
    if (!isVisible(el)) continue;
    controlsTotal += 1;
    if (results.length >= MAX_CONTROLS) continue;

    const tagName = el.tagName.toLowerCase();
    const isCE = tagName !== 'input' && tagName !== 'textarea' && tagName !== 'select' && !!el.isContentEditable;
    const cs = getComputedStyle(el);
    const rect = rectOf(el.getBoundingClientRect());
    const markId = 'form-' + (counter++);
    elements.push(el);

    if (tagName === 'select') {
      const selected = el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
      results.push({
        markId, selector: cssSelector(el), tagName, type: 'select',
        value: selected ? (selected.textContent || '') : '', valuePlaceholder: null,
        selectionStart: null, selectionEnd: null,
        scrollLeft: el.scrollLeft || 0, scrollTop: el.scrollTop || 0,
        clientWidth: el.clientWidth, clientHeight: el.clientHeight,
        scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight,
        disabled: !!el.disabled, readOnly: false, required: !!el.required, pattern: null,
        checked: null, multiple: !!el.multiple,
        validity: validityOf(el), label: labelFor(el), autofilled: false,
        pseudoState: {
          focused: document.activeElement === el, hovered: (function () { try { return el.matches(':hover'); } catch (e) { return false; } })(),
          active: (function () { try { return el.matches(':active'); } catch (e) { return false; } })(),
          checked: null, disabled: !!el.disabled, readOnly: false,
          invalid: (function () { try { return el.matches(':invalid'); } catch (e) { return false; } })(),
          focusVisible: (function () { try { return el.matches(':focus-visible'); } catch (e) { return false; } })(),
        },
        rect, valueLines: [], placeholderLines: [], caretRect: null, selectionRects: [], visibleRange: null,
        textLayoutUnavailable: null, lineHeightApproximate: null,
        isContentEditable: false, autocomplete: el.getAttribute('autocomplete'), name: el.getAttribute('name'), id: el.id || null,
      });
      continue;
    }

    if (isCE) {
      const ce = contentEditableFacts(el);
      results.push({
        markId, selector: cssSelector(el), tagName, type: 'contenteditable',
        value: ce.text, valuePlaceholder: el.getAttribute('data-placeholder') || null,
        selectionStart: ce.selectionStart, selectionEnd: ce.selectionEnd,
        scrollLeft: el.scrollLeft || 0, scrollTop: el.scrollTop || 0,
        clientWidth: el.clientWidth, clientHeight: el.clientHeight,
        scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight,
        disabled: false, readOnly: false, required: false, pattern: null,
        checked: null, multiple: false,
        validity: null, label: labelFor(el), autofilled: false,
        pseudoState: {
          focused: document.activeElement === el, hovered: (function () { try { return el.matches(':hover'); } catch (e) { return false; } })(),
          active: (function () { try { return el.matches(':active'); } catch (e) { return false; } })(),
          checked: null, disabled: false, readOnly: false, invalid: false,
          focusVisible: (function () { try { return el.matches(':focus-visible'); } catch (e) { return false; } })(),
        },
        rect, valueLines: ce.lines, placeholderLines: [], caretRect: ce.caretRect, selectionRects: ce.selectionRects,
        visibleRange: null, textLayoutUnavailable: null, lineHeightApproximate: null,
        isContentEditable: true, autocomplete: null, name: null, id: el.id || null,
      });
      continue;
    }

    const type = tagName === 'textarea' ? 'textarea' : (el.getAttribute('type') || 'text').toLowerCase();
    const isCheckable = type === 'checkbox' || type === 'radio';
    const multiline = tagName === 'textarea';
    let value = '';
    try { value = el.value != null ? String(el.value) : ''; } catch (e) {}
    const placeholder = el.getAttribute ? el.getAttribute('placeholder') : null;
    const sel = isCheckable ? { start: null, end: null } : selectionOf(el);

    let valueLines = [], placeholderLines = [], caretRect = null, selectionRects = [], visibleRange = null, textLayoutUnavailable = null, lineHeightApproximate = null;
    // type=password is excluded from canvas text-layout measurement because
    // the control renders masking glyphs rather than the raw characters;
    // measuring raw glyph widths would fabricate caret/line geometry. The
    // value itself is still preserved in the emitted record.
    if (!isCheckable && type !== 'password' && type !== 'file' && type !== 'range' && type !== 'color') {
      if (multiline) {
        // Wrapped-line layout for a <textarea> is the browser's
        // line-breaking engine (word-wrap/overflow-wrap/CJK/tabs/
        // white-space) — not reproducible from measureText widths alone.
        // Report it as factually unavailable rather than approximate it.
        textLayoutUnavailable = 'textarea-wrapping-requires-layout';
      } else {
        const font = fontStringOf(cs);
        // Same content-box/line-height condition every single-line rect below
        // is built from — computed once so the I-4 flag can never drift from
        // the geometry it describes.
        lineHeightApproximate = !parseFloat(cs.lineHeight);
        valueLines = valueLineRect(el, cs, font, value, el.scrollLeft || 0);
        if (!value.length && placeholder) placeholderLines = valueLineRect(el, cs, font, placeholder, el.scrollLeft || 0);
        if (document.activeElement === el) {
          caretRect = caretRectOf(el, cs, font, value, sel.start, el.scrollLeft || 0);
          if (sel.start !== sel.end) selectionRects = selectionRectsOf(el, cs, font, value, sel.start, sel.end, el.scrollLeft || 0);
        }
        const padLeft = parseFloat(cs.paddingLeft) || 0;
        const padRight = parseFloat(cs.paddingRight) || 0;
        const clipWidth = Math.max(0, el.clientWidth - padLeft - padRight);
        visibleRange = visibleRangeSingleLine(font, value, el.scrollLeft || 0, clipWidth);
      }
    }

    results.push({
      markId, selector: cssSelector(el), tagName, type,
      value, valuePlaceholder: placeholder,
      selectionStart: sel.start, selectionEnd: sel.end,
      scrollLeft: el.scrollLeft || 0, scrollTop: el.scrollTop || 0,
      clientWidth: el.clientWidth, clientHeight: el.clientHeight,
      scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight,
      disabled: !!el.disabled, readOnly: !!el.readOnly, required: !!el.required, pattern: el.getAttribute ? el.getAttribute('pattern') : null,
      checked: isCheckable ? !!el.checked : null, multiple: !!el.multiple,
      validity: validityOf(el), label: labelFor(el), autofilled: isAutofilled(el),
      pseudoState: {
        focused: document.activeElement === el, hovered: (function () { try { return el.matches(':hover'); } catch (e) { return false; } })(),
        active: (function () { try { return el.matches(':active'); } catch (e) { return false; } })(),
        checked: isCheckable ? !!el.checked : null, disabled: !!el.disabled, readOnly: !!el.readOnly,
        invalid: (function () { try { return el.matches(':invalid'); } catch (e) { return false; } })(),
        focusVisible: (function () { try { return el.matches(':focus-visible'); } catch (e) { return false; } })(),
      },
      rect, valueLines, placeholderLines, caretRect, selectionRects, visibleRange, textLayoutUnavailable, lineHeightApproximate,
      isContentEditable: false, autocomplete: el.getAttribute ? el.getAttribute('autocomplete') : null,
      name: el.getAttribute ? el.getAttribute('name') : null, id: el.id || null,
    });
  }

  // Frame/shadow scope facts (D5): the walk is top-document, non-piercing,
  // so controls inside iframes / shadow roots are absent from this artifact.
  const iframesNotWalked = document.querySelectorAll('iframe').length;
  let shadowRootsNotWalked = 0;
  const allEls = document.querySelectorAll('*');
  for (const e of allEls) { if (e.shadowRoot) shadowRootsNotWalked++; }
  return {
    facts: { records: results, iframesNotWalked: iframesNotWalked, shadowRootsNotWalked: shadowRootsNotWalked, controlsTotal: controlsTotal },
    elements: elements,
  };
})()`;

interface FormsWalkResult {
  readonly records: RawControlRecord[];
  readonly iframesNotWalked: number;
  readonly shadowRootsNotWalked: number;
  /** Total visible candidate controls the walk found, BEFORE the `MAX_CONTROLS` cap — always `>= records.length`; the gap is what `controlsTruncated` (I-5) reports rather than silently dropping. */
  readonly controlsTotal: number;
}

/** Fixed, factual reason the walk evaluate/bridge could not be read (never a raw exception message, which is unbounded/page-influenced) — present only when {@link FormsJson.available} is `false`. `walk-evaluate-threw` covers `Runtime.evaluate`, the held-container `Runtime.getProperties`, or the held-`facts` `Runtime.callFunctionOn` rejecting outright. `walk-facts-unavailable` covers BOTH a missing `facts` objectId on the held container and a `readHeldValue()` that resolves without throwing but returns `undefined` — either way the required read did not happen, so it collapses to one reason rather than two indistinguishable-in-practice ones (mirrors `hittest.ts`/`text.ts`). */
export type FormsUnavailableReason =
  | 'walk-evaluate-threw'
  | 'walk-evaluate-returned-no-object'
  | 'walk-facts-unavailable'
  /** F17 (I-4/I-5, Layer 2): the held facts object read back fine, but its `records` field was missing/malformed — distinct from `walk-facts-unavailable` (the facts read never happened at all). */
  | 'walk-records-malformed';

/** `forms.json` per-control record shape — mirrors {@link ElementRecord} but requires `backendNodeId: number | null` (never omitted) plus an honest `identityUnresolved` marker when identity resolution failed, the same shape `hittest.ts`/`text.ts` already use (I-3/I-5). */
interface FormsElementRecord extends Omit<ElementRecord, 'backendNodeId'> {
  readonly backendNodeId: number | null;
  /** `true` when {@link backendNodeId} is `null` because identity resolution failed (no bridged `objectId`, or `DOM.describeNode`/`describeBackendNodeId` returned nothing) — never omit this alongside a `null` backendNodeId, so a downstream join can never mistake an unresolved record for a resolved one. Absent (not `false`) when identity resolved. */
  readonly identityUnresolved?: true;
}

/** Builds the honest `{ backendNodeId, identityUnresolved }` pair every control record carries — `null` (never an omitted key) when identity did not resolve, mirroring `hittest.ts`'s `resolvedIdentity` (I-3/I-5). */
function resolvedIdentity(backendNodeId: number | undefined): { backendNodeId: number | null; identityUnresolved?: true } {
  return backendNodeId === undefined ? { backendNodeId: null, identityUnresolved: true } : { backendNodeId };
}

/** `forms.json`'s on-disk shape. */
export interface FormsJson {
  readonly controls: FormsElementRecord[];
  readonly coverage: Record<string, unknown>;
  /** `false` when the walk's held `facts` could not be read — `controls: []` with an all-zero `coverage` is then "could not collect", not "genuinely no form controls on the page" (I-4/I-5). Always `true` on a normal run, including one where the page really has no controls. */
  readonly available: boolean;
  /** Present only when `available` is `false`. */
  readonly unavailableReason?: FormsUnavailableReason;
  readonly bridgeCleanupFailed?: boolean;
}

// ============================================================================
// CDP-only identity bridge — reads the walk's held return value (a plain
// `{ facts, elements }` object CDP hands back as a `RemoteObject`) purely
// through `Runtime.getProperties`/`Runtime.callFunctionOn`/
// `Runtime.releaseObject`. NONE of these ever assigns to `window` or any
// other page-observable location, so a page that predefines a setter for
// a guessed global name (the exact reported attack) has nothing to
// observe: this collector never sets a property on anything the page can
// see.
// ============================================================================

/** Resolves each own-property `objectId` of a held CDP object in one `Runtime.getProperties` round trip — how `facts`/`elements` are found inside the walk's held result container. */
async function ownPropertyObjectIds(client: CDPClient, objectId: string): Promise<Map<string, string>> {
  const propsResult = (await client.send('Runtime.getProperties', {
    objectId,
    ownProperties: true,
  })) as { result?: Array<{ name: string; value?: { objectId?: string } }> };
  const out = new Map<string, string>();
  for (const prop of propsResult.result ?? []) {
    if (prop.value?.objectId) out.set(prop.name, prop.value.objectId);
  }
  return out;
}

/** Reads a held CDP object out by value via one `Runtime.callFunctionOn({returnByValue:true})` round trip on its OWN `objectId` — the only way the by-value `facts` blob (JSON-safe: rects/strings/numbers, no DOM handles) leaves the held reference without ever touching a page-observable global. */
async function readHeldValue<T>(client: CDPClient, objectId: string): Promise<T | undefined> {
  const res = (await client.send('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: 'function() { return this; }',
    returnByValue: true,
  })) as { result?: { value?: T } };
  return res.result?.value;
}

/**
 * Resolves each numeric-index own property of a held live-array `objectId`
 * (the walk's `elements` handle array) to that control's own `objectId` —
 * the CDP identity bridge every `backendNodeId` resolution in this file
 * depends on, sourced from the walk's held return value rather than a
 * page-observable global. `count` bounds the returned array (indices
 * outside `[0, count)` are ignored even if present).
 */
async function resolveIndexedObjectIds(
  client: CDPClient,
  arrayObjectId: string,
  count: number,
): Promise<Array<string | undefined>> {
  const out = new Array<string | undefined>(count).fill(undefined);
  if (count <= 0) return out;
  const propsResult = (await client.send('Runtime.getProperties', {
    objectId: arrayObjectId,
    ownProperties: true,
  })) as { result?: Array<{ name: string; value?: { objectId?: string } }> };
  for (const prop of propsResult.result ?? []) {
    if (!/^\d+$/.test(prop.name)) continue;
    const idx = Number(prop.name);
    if (idx < 0 || idx >= count) continue;
    out[idx] = prop.value?.objectId;
  }
  return out;
}

export const collectForms: Collector = async (ctx) => {
  // The walk's return value is a plain in-memory `{ facts, elements }`
  // object — never a `window` global, never a live-DOM attribute — so
  // nothing another baseline collector or the `screenshot.png`/`dom.html`
  // capture running concurrently in the same `Promise.all` (see
  // `snapshot.ts`) could ever observe. `Runtime.evaluate({returnByValue:
  // false})` hands that object back as a CDP `RemoteObject` (an `objectId`
  // with zero page visibility into it); every held `objectId` (the
  // container, `facts`, `elements`) is released via `Runtime.releaseObject`
  // in `finally`, unconditionally, so cleanup still runs even when the
  // walk or the bridge rejects. A release failure is recorded as the
  // factual `bridgeCleanupFailed` rather than swallowed; it can NEVER
  // imply a contaminated baseline, because object-id bridge cleanup is
  // entirely CDP-session-scoped remote-object memory (freed when the tab
  // closes regardless) and the baseline walk itself mutates nothing
  // page-observable. A thrown top-level evaluate/bridge read
  // (`Runtime.evaluate`, the held-container `Runtime.getProperties`, or
  // the held-`facts` `Runtime.callFunctionOn`) is caught below and turned
  // into an honest `available: false` artifact rather than propagating —
  // cleanup still runs unconditionally via `finally`. The per-control
  // object-id bridge (identity resolution for each already-read record)
  // is separately best-effort: its own failure still emits the record,
  // with identity encoded explicitly as `backendNodeId: null` +
  // `identityUnresolved: true` (never an omitted key — see
  // `resolvedIdentity`).
  let bridgeCleanupFailed = false;
  let walkValue: FormsWalkResult | undefined;
  let objectIds: Array<string | undefined> = [];
  const heldObjectIds: string[] = [];
  // I-4/I-5: distinguishes "the walk's held `facts` could not be read" from
  // "the page really has zero form controls" — both would otherwise collapse
  // to the same `controls: []` with an all-zero coverage, falsely claiming a
  // genuinely-empty read when in fact the required facts read never
  // happened. Mirrors `hittest.ts`'s `available`/`unavailableReason`.
  let available = true;
  let unavailableReason: FormsUnavailableReason | undefined;
  try {
    const walkEval = (await ctx.client.send('Runtime.evaluate', {
      expression: FORMS_WALK_EXPRESSION,
      returnByValue: false,
    })) as { result?: { objectId?: string } };
    const resultObjectId = walkEval.result?.objectId;

    if (resultObjectId) {
      heldObjectIds.push(resultObjectId);
      const containerIds = await ownPropertyObjectIds(ctx.client, resultObjectId);
      const factsObjectId = containerIds.get('facts');
      const elementsObjectId = containerIds.get('elements');

      if (factsObjectId) {
        heldObjectIds.push(factsObjectId);
        walkValue = await readHeldValue<FormsWalkResult>(ctx.client, factsObjectId);
      }

      // A missing `facts` objectId on the held container and a
      // `readHeldValue()` that resolves to `undefined` without throwing are
      // BOTH "the required facts read did not happen" — neither may fall
      // through to the initialized-empty `raw`/`coverage` defaults below
      // looking identical to a genuinely empty page.
      if (walkValue === undefined) {
        available = false;
        unavailableReason = 'walk-facts-unavailable';
      } else if (!Array.isArray(walkValue.records)) {
        // F17 (I-4/I-5, Layer 2): the held facts object itself read back
        // fine, but its `records` field is missing/malformed on an
        // otherwise-present object — a broken facts contract, NOT "the page
        // has zero form controls". `walkValue?.records ?? []` would
        // silently coerce this into a fabricated empty-success result;
        // treat the whole read as unavailable instead (reusing the same
        // all-zero/empty shape as walk-facts-unavailable below).
        available = false;
        unavailableReason = 'walk-records-malformed';
        walkValue = undefined;
      }

      const rawLength = walkValue?.records?.length ?? 0;
      if (elementsObjectId && rawLength > 0) {
        heldObjectIds.push(elementsObjectId);
        try {
          objectIds = await resolveIndexedObjectIds(ctx.client, elementsObjectId, rawLength);
        } catch {
          // Best-effort — records are still written, with identity encoded
          // explicitly as backendNodeId: null + identityUnresolved: true
          // (never an omitted key — see resolvedIdentity).
        }
      }
    } else {
      available = false;
      unavailableReason = 'walk-evaluate-returned-no-object';
    }
  } catch {
    // `Runtime.evaluate`, the held-container `Runtime.getProperties`
    // (`ownPropertyObjectIds`), or the held-`facts` `Runtime.callFunctionOn`
    // (`readHeldValue`) rejected outright — reset to the honest-empty state
    // rather than letting the collector crash without ever writing an
    // unavailable artifact (mirrors `hittest.ts`).
    walkValue = undefined;
    objectIds = [];
    available = false;
    unavailableReason = 'walk-evaluate-threw';
  } finally {
    for (const id of heldObjectIds) {
      try {
        await ctx.client.send('Runtime.releaseObject', { objectId: id });
      } catch {
        bridgeCleanupFailed = true;
      }
    }
  }

  const raw = walkValue?.records ?? [];

  // F18 (I-4/I-5, Layer 2): each coverage field is validated independently
  // of `records` — a malformed/non-number `controlsTotal`/`iframesNotWalked`/
  // `shadowRootsNotWalked` on an otherwise-valid facts object must surface a
  // malformed marker, not silently coerce into a genuine zero/uncapped fact
  // via `?? 0`/`?? raw.length`. Only evaluated when `walkValue` itself is
  // defined (records valid) — when the whole read failed, the top-level
  // `available`/`unavailableReason` already covers it and these per-field
  // markers would be redundant noise.
  const controlsTotalValid = walkValue !== undefined && typeof walkValue.controlsTotal === 'number';
  const controlsTotal = controlsTotalValid ? (walkValue as FormsWalkResult).controlsTotal : raw.length;
  const iframesNotWalkedValid = walkValue !== undefined && typeof walkValue.iframesNotWalked === 'number';
  const shadowRootsNotWalkedValid = walkValue !== undefined && typeof walkValue.shadowRootsNotWalked === 'number';

  const coverage = {
    scope: 'top-document' as const,
    iframesNotWalked: iframesNotWalkedValid ? (walkValue as FormsWalkResult).iframesNotWalked : 0,
    ...(walkValue !== undefined && !iframesNotWalkedValid ? { iframesNotWalkedUnavailable: true } : {}),
    shadowRootsNotWalked: shadowRootsNotWalkedValid ? (walkValue as FormsWalkResult).shadowRootsNotWalked : 0,
    ...(walkValue !== undefined && !shadowRootsNotWalkedValid ? { shadowRootsNotWalkedUnavailable: true } : {}),
    ...(walkValue !== undefined && !controlsTotalValid ? { controlsTotalUnavailable: true } : {}),
    // I-5: the top-level MAX_CONTROLS cap silently dropped excess controls
    // before this fact existed. Same convention as the per-field rect-array
    // truncation counts below — present only when the cap actually dropped
    // something and controlsTotal itself is a valid measured number, so an
    // uncapped snapshot's coverage stays exactly as before.
    ...(controlsTotalValid && controlsTotal > raw.length ? { controlsTotal, controlsTruncated: controlsTotal - raw.length } : {}),
  };

  const controls: FormsElementRecord[] = [];
  // Per-element object IDs (`objectIds`, resolved above) are a SEPARATE
  // remote-object handle per control, distinct from the container/facts/
  // elements-array handles the earlier `finally` already released — each
  // is released here once the loop is done reading through it (unconditionally,
  // even on a mid-loop throw), so no per-control CDP remote-object handle
  // outlives this collector.
  try {
    for (let i = 0; i < raw.length; i += 1) {
      const rec = raw[i];
      const objectId = objectIds[i];
      const backendNodeId = objectId ? await describeBackendNodeId(ctx.client, objectId) : undefined;
      const cappedValue = capString(rec.value);

      const selector = sanitizeString(rec.selector);
      const placeholderSanitized = rec.valuePlaceholder !== null ? sanitizeString(rec.valuePlaceholder) : null;

      // Explicit allowlisted validity/label objects (D8b): never spread the
      // page-shaped record — only the known boolean flags + a sanitized
      // message / an allowlisted source survive.
      const validity = rec.validity
        ? {
            valid: !!rec.validity.valid,
            valueMissing: !!rec.validity.valueMissing,
            typeMismatch: !!rec.validity.typeMismatch,
            patternMismatch: !!rec.validity.patternMismatch,
            tooLong: !!rec.validity.tooLong,
            tooShort: !!rec.validity.tooShort,
            rangeUnderflow: !!rec.validity.rangeUnderflow,
            rangeOverflow: !!rec.validity.rangeOverflow,
            stepMismatch: !!rec.validity.stepMismatch,
            badInput: !!rec.validity.badInput,
            customError: !!rec.validity.customError,
            message: sanitizeString(rec.validity.message),
          }
        : null;

      const label = rec.label
        ? {
            text: sanitizeString(rec.label.text),
            ...(rec.label.rect ? { rect: rec.label.rect } : {}),
            source: LABEL_SOURCE_ALLOWLIST.has(rec.label.source) ? rec.label.source : 'unknown',
          }
        : null;

      const { items: valueLineBoxes, truncated: valueLineBoxesTruncated } = capArray(rec.valueLines, MAX_RECTS);
      const { items: placeholderLines, truncated: placeholderLinesTruncated } = capArray(rec.placeholderLines, MAX_RECTS);
      const { items: selectionRects, truncated: selectionRectsTruncated } = capArray(rec.selectionRects, MAX_RECTS);

      const visibleSubstring = rec.visibleRange
        ? {
            start: rec.visibleRange.start,
            end: rec.visibleRange.end,
            text: sanitizeString(rec.value.slice(rec.visibleRange.start, rec.visibleRange.end)),
          }
        : undefined;

      const record: FormsElementRecord = {
        id: rec.markId,
        selector,
        // objectId missing (no bridge slot) or describeBackendNodeId failing
        // to resolve are BOTH "identity did not resolve" — resolvedIdentity()
        // turns either case into the same honest `backendNodeId: null` +
        // `identityUnresolved: true` shape (I-3/I-5).
        ...resolvedIdentity(backendNodeId),
        type: normalizeControlType(rec.type),
        tagName: sanitizeString(rec.tagName),
        valueLength: rec.value.length,
        text: cappedValue.value,
        value: cappedValue.value,
        ...(cappedValue.capped ? { capped: true } : {}),
        placeholder: placeholderSanitized !== null ? { text: placeholderSanitized, lines: placeholderLines } : undefined,
        ...(placeholderLinesTruncated ? { placeholderLinesTruncated } : {}),
        selectionStart: rec.selectionStart,
        selectionEnd: rec.selectionEnd,
        scroll: { left: rec.scrollLeft, top: rec.scrollTop },
        dimensions: {
          clientWidth: rec.clientWidth,
          clientHeight: rec.clientHeight,
          scrollWidth: rec.scrollWidth,
          scrollHeight: rec.scrollHeight,
        },
        rect: rec.rect,
        valueLineBoxes,
        ...(valueLineBoxesTruncated ? { valueLineBoxesTruncated } : {}),
        caretRect: rec.caretRect,
        selectionRects,
        ...(selectionRectsTruncated ? { selectionRectsTruncated } : {}),
        // Set only for a `textarea`: wrapped-line layout cannot be faithfully
        // computed from `measureText` alone (the browser's line-breaking
        // engine isn't reproducible from glyph-advance widths), so the
        // layout facts above are left empty/null and this names the reason
        // rather than silently approximating them.
        ...(rec.textLayoutUnavailable ? { textLayout: { available: false, reason: rec.textLayoutUnavailable } } : {}),
        // I-4: honest marker for the single-line y/height rects above — `true`
        // when Chrome's computed `line-height` was the `normal` keyword (no
        // real metric to read) and the `1.2 * font-size` heuristic was used
        // instead; omitted entirely for controls that never compute these
        // rects (textarea/select/contenteditable/checkable/password/file/
        // range/color), matching `textLayout` above's N/A-by-omission shape.
        ...(typeof rec.lineHeightApproximate === 'boolean' ? { lineHeightApproximate: rec.lineHeightApproximate } : {}),
        visibleSubstring,
        validity,
        required: rec.required,
        pattern: rec.pattern !== null ? sanitizeString(rec.pattern) : null,
        checked: rec.checked,
        multiple: rec.multiple,
        label,
        autofill: { isAutofilled: rec.autofilled },
        pseudoState: rec.pseudoState,
        // CDP/DOM does not expose native UA-shadow internals for most
        // form-control parts (sliders, spin buttons, calendar pickers) —
        // this object is populated only when a control's native part
        // geometry is independently observable; empty is the honest default.
        nativePartDimensions: {},
        isContentEditable: rec.isContentEditable,
      };
      controls.push(record);
    }
  } finally {
    for (const objectId of objectIds) {
      if (!objectId) continue;
      try {
        await ctx.client.send('Runtime.releaseObject', { objectId });
      } catch {
        bridgeCleanupFailed = true;
      }
    }
  }

  ctx.write.json('forms.json', {
    controls,
    coverage,
    available,
    ...(unavailableReason ? { unavailableReason } : {}),
    ...(bridgeCleanupFailed ? { bridgeCleanupFailed: true } : {}),
  } satisfies FormsJson);
};
