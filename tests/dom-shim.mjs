class Node {
  constructor(nodeType) {
    this.nodeType = nodeType;
    this.parentNode = null;
    this.childNodes = [];
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  append(...items) {
    for (const item of items) {
      if (item == null || item === false) continue;
      const node = item.nodeType ? item : text(String(item));
      if (node.parentNode) node.parentNode.removeChild(node);
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }

  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }

  get textContent() {
    if (this.nodeType === 3) return this.nodeValue;
    return this.childNodes.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this.childNodes = [];
    if (value != null && value !== '') {
      const node = text(String(value));
      node.parentNode = this;
      this.childNodes = [node];
    }
  }
}

class TextNode extends Node {
  constructor(value) {
    super(3);
    this.nodeValue = String(value);
  }
}

class Element extends Node {
  constructor(tag) {
    super(1);
    this.tagName = String(tag).toUpperCase();
    this.attrs = Object.create(null);
    this._className = '';
    this.listeners = {};
  }

  get className() {
    return this._className;
  }

  set className(value) {
    this._className = value == null ? '' : String(value);
    this.attrs.class = this._className;
  }

  set innerHTML(_value) {
    throw new Error('innerHTML is disabled');
  }

  get innerHTML() {
    throw new Error('innerHTML is disabled');
  }

  setAttribute(name, value) {
    const string = String(value);
    this.attrs[name] = string;
    if (name === 'class') this._className = string;
  }

  getAttribute(name) {
    return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null;
  }

  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }

  focus() {}

  setSelectionRange() {}

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const out = [];
    walk(this, (el) => {
      if (matchesSelector(el, selector)) out.push(el);
    });
    return out;
  }
}

function text(value) {
  return new TextNode(value);
}

function walk(node, visit) {
  for (const child of node.childNodes) {
    if (child.nodeType !== 1) continue;
    visit(child);
    walk(child, visit);
  }
}

function matchesSelector(el, selector) {
  const steps = selector.trim().split(/\s+/).filter(Boolean);
  if (!matchesCompound(el, steps[steps.length - 1])) return false;
  let cursor = el;
  for (let index = steps.length - 2; index >= 0; index -= 1) {
    cursor = cursor.parentNode;
    while (cursor && cursor.nodeType === 1 && !matchesCompound(cursor, steps[index])) {
      cursor = cursor.parentNode;
    }
    if (!cursor || cursor.nodeType !== 1) return false;
  }
  return true;
}

function matchesCompound(el, compound) {
  const match = /^(?:([A-Za-z][A-Za-z0-9-]*))?(?:#([A-Za-z0-9_-]+))?((?:\.[A-Za-z0-9_-]+)*)((?:\[[^\]]+\])*)$/.exec(compound);
  if (!match) return false;
  const [, tag, id, classPart, attrPart] = match;
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  if (id && el.getAttribute('id') !== id) return false;
  if (classPart) {
    const have = new Set((el.className || '').split(/\s+/).filter(Boolean));
    for (const cls of classPart.split('.').filter(Boolean)) {
      if (!have.has(cls)) return false;
    }
  }
  if (attrPart) {
    const attrRe = /\[([A-Za-z0-9_-]+)(?:="([^"]*)")?\]/g;
    let found;
    let seen = 0;
    while ((found = attrRe.exec(attrPart))) {
      seen += found[0].length;
      const actual = el.getAttribute(found[1]);
      if (actual == null) return false;
      if (found[2] != null && actual !== found[2]) return false;
    }
    if (seen !== attrPart.length) return false;
  }
  return true;
}

export function installDom() {
  const document = {
    activeElement: null,
    body: new Element('body'),
    createElement(tag) {
      return new Element(tag);
    },
    createElementNS(_ns, tag) {
      return new Element(tag);
    },
    createTextNode(value) {
      return text(value);
    },
    getElementById(id) {
      return this.body.querySelector(`#${id}`);
    },
  };
  globalThis.document = document;
  return document;
}
