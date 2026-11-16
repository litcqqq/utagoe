/**
 * End-to-end checks for the 1.0.1 features (1-5), run against the built
 * extension in dist/ with a minimal DOM so the real render path is exercised
 * rather than individual functions in isolation.
 *
 * Covered:
 *   1. Furigana / kana output modes
 *   2. Tap-to-fix inline editor
 *   3. Translation line
 *   4. Confidence badges
 *   5. Vocabulary CSV export
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn) {
  try {
    const result = fn();
    if (result === false) throw new Error('assertion returned false');
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    failures.push(`${name}: ${err && err.message}`);
    console.log(`  FAIL ${name} -> ${err && err.message}`);
  }
}

async function checkAsync(name, fn) {
  try {
    const result = await fn();
    if (result === false) throw new Error('assertion returned false');
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    failures.push(`${name}: ${err && err.message}`);
    console.log(`  FAIL ${name} -> ${err && err.message}`);
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message || 'assertion failed');
}

// ---------------------------------------------------------------------------
// A very small DOM: enough for querySelectorAll by class, className/classList,
// attributes, children, and appendChild/prependChild. Writing a real DOM here
// would hide the very bugs these tests exist to catch.
// ---------------------------------------------------------------------------

function createElement(tag, doc) {
  const el = {
    tagName: String(tag).toUpperCase(),
    _attrs: {},
    _children: [],
    parentElement: null,
    ownerDocument: doc,
    textContent: '',
    _className: '',
    style: { setProperty() {}, removeProperty() {} },
    listeners: {},

    get className() {
      return this._className;
    },
    set className(value) {
      this._className = String(value || '');
    },

    get classList() {
      const self = this;
      return {
        add(...names) {
          const set = new Set(self._className.split(/\s+/).filter(Boolean));
          names.forEach(n => set.add(n));
          self._className = Array.from(set).join(' ');
        },
        remove(...names) {
          const set = new Set(self._className.split(/\s+/).filter(Boolean));
          names.forEach(n => set.delete(n));
          self._className = Array.from(set).join(' ');
        },
        contains(name) {
          return self._className.split(/\s+/).includes(name);
        },
        toggle(name, force) {
          const has = this.contains(name);
          const want = force === undefined ? !has : Boolean(force);
          if (want) this.add(name);
          else this.remove(name);
          return want;
        }
      };
    },

    setAttribute(name, value) {
      this._attrs[name] = String(value);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null;
    },
    removeAttribute(name) {
      delete this._attrs[name];
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this._attrs, name);
    },

    appendChild(child) {
      child.parentElement = this;
      this._children.push(child);
      return child;
    },
    prependChild(child) {
      child.parentElement = this;
      this._children.unshift(child);
      return child;
    },
    remove() {
      if (!this.parentElement) return;
      const idx = this.parentElement._children.indexOf(this);
      if (idx >= 0) this.parentElement._children.splice(idx, 1);
      this.parentElement = null;
    },

    addEventListener(type, handler) {
      (this.listeners[type] = this.listeners[type] || []).push(handler);
    },

    getBoundingClientRect() {
      return { top: 10, bottom: 30, left: 15, right: 100, width: 85, height: 20 };
    },
    focus() {},
    select() {},

    get childElementCount() {
      return this._children.length;
    },
    get childNodes() {
      return this._children;
    },
    get firstChild() {
      return this._children[0] || null;
    },
    get innerText() {
      return this.textContent;
    },
    set innerText(value) {
      this.textContent = String(value);
    },
    contains(other) {
      if (other === this) return true;
      return this._children.some((c) => c === other || (typeof c.contains === 'function' && c.contains(other)));
    },

    get innerHTML() {
      return this._innerHTML || '';
    },
    set innerHTML(value) {
      this._innerHTML = String(value);
    },

    querySelectorAll(selector) {
      return findAllByClass(this, selector);
    },
    querySelector(selector) {
      const all = findAllByClass(this, selector);
      return all.length ? all[0] : null;
    }
  };

  el._innerHTML = '';
  return el;
}

// Supports ".class", ":scope > .class", "[attr=value]" and "[attr]" plus a
// comma-separated list of those. Anything else returns nothing on purpose: if
// production code starts using a selector shape this stub cannot honour, the
// tests must fail loudly instead of silently passing.
function findAllByClass(rootEl, selector) {
  const raw = String(selector || '').trim();
  if (!raw) return [];

  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const seen = new Set();
    const out = [];
    for (const part of parts) {
      for (const el of findAllByClass(rootEl, part)) {
        if (seen.has(el)) continue;
        seen.add(el);
        out.push(el);
      }
    }
    return out;
  }

  let scopeOnly = false;
  let spec = raw;

  if (spec.startsWith(':scope > ')) {
    scopeOnly = true;
    spec = spec.slice(':scope > '.length).trim();
  }

  const match = (el) => {
    if (spec.startsWith('.')) {
      return el.className.split(/\s+/).includes(spec.slice(1));
    }
    const attrEq = spec.match(/^\[([\w-]+)="([^"]*)"\]$/);
    if (attrEq) {
      return el.getAttribute(attrEq[1]) === attrEq[2];
    }
    const attrOnly = spec.match(/^\[([\w-]+)\]$/);
    if (attrOnly) {
      return el.getAttribute(attrOnly[1]) !== null;
    }
    return null; // unsupported selector shape
  };

  const probe = match({ className: '', getAttribute: () => null });
  if (probe === null) {
    throw new Error(`dom-harness: unsupported selector "${selector}"`);
  }

  const results = [];
  const walk = (node) => {
    for (const child of node._children) {
      if (match(child)) results.push(child);
      walk(child);
    }
  };

  if (scopeOnly) {
    for (const child of rootEl._children) {
      if (match(child)) results.push(child);
    }
  } else {
    walk(rootEl);
  }

  return results;
}

function createDocument() {
  const doc = {
    _root: null,
    body: null,
    readyState: 'complete',
    documentElement: { style: { setProperty() {} } },
    _listeners: {}
  };

  doc.createElement = (tag) => createElement(tag, doc);
  doc.querySelectorAll = (sel) => findAllByClass(doc._root, sel);
  doc.querySelector = (sel) => {
    const all = findAllByClass(doc._root, sel);
    return all.length ? all[0] : null;
  };
  doc.addEventListener = (type, handler) => {
    (doc._listeners[type] = doc._listeners[type] || []).push(handler);
  };
  doc.dispatch = (type, event) => {
    for (const handler of doc._listeners[type] || []) handler(event);
  };

  doc._root = createElement('html', doc);
  doc.body = createElement('body', doc);
  doc._root.appendChild(doc.body);

  return doc;
}

// Exported as getters: plain properties would snapshot the counters at require
// time, so a caller would always read 0 no matter how many checks ran.
module.exports = {
  createDocument,
  createElement,
  check,
  checkAsync,
  assert,
  get passed() { return passed; },
  get failed() { return failed; },
  failures,
  DIST,
  ROOT
};
