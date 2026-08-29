/**
 * Minimal DOM good enough to boot the real Application against the real
 * index.html markup, headlessly.
 *
 * The stubs in tests/hit-canvas-stub.js and the DOM stubs inside
 * canvas-stack.test.js / canvas-interaction.test.js answer `getElementById`
 * with null: they exist so a *single* controller can be exercised without a
 * page. Booting the whole app needs the opposite — every id in index.html has
 * to resolve, keep its inline style, hold children and fire listeners — so
 * this module parses index.html into a small element tree with the handful of
 * DOM APIs src/ui, src/core and src/shell actually touch.
 *
 * It is not a browser: no layout, no CSS cascade, no default actions. What it
 * does guarantee is that ids, containment, classes, inline styles and event
 * dispatch behave the way the shell wiring assumes.
 */

/** Elements that never have children or a closing tag. */
const VOID_TAGS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

/** Elements whose content is text, not markup. */
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea']);

/** `flex-direction` -> `flexDirection`, so inline styles read back like the DOM's. */
function camelCase(prop) {
    return prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

class MiniText {
    constructor(data) {
        this.nodeType = 3;
        this.data = String(data);
        this.parentNode = null;
    }
    get textContent() { return this.data; }
    set textContent(value) { this.data = String(value); }
    get parentElement() { return this.parentNode; }
}

/** A DOM event: enough of the interface for bubbling, target and defaults. */
class MiniEvent {
    constructor(type, init = {}) {
        this.type = type;
        this.target = null;
        this.currentTarget = null;
        this.defaultPrevented = false;
        this.propagationStopped = false;
        Object.assign(this, init);
    }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() { this.propagationStopped = true; }
    stopImmediatePropagation() { this.propagationStopped = true; }
}

/** Shared listener bookkeeping for elements, the document and the window. */
class EventTargetBase {
    constructor() {
        /** @type {Map<string, Function[]>} */
        this.listeners = new Map();
    }
    addEventListener(type, handler) {
        if (typeof handler !== 'function') return;
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(handler);
    }
    removeEventListener(type, handler) {
        const list = this.listeners.get(type);
        if (!list) return;
        const i = list.indexOf(handler);
        if (i >= 0) list.splice(i, 1);
    }
    /** Count registrations for one event type — how duplicate-listener leaks are caught. */
    listenerCount(type) {
        return (this.listeners.get(type) || []).length;
    }
    fire(event) {
        const list = this.listeners.get(event.type);
        if (!list) return;
        event.currentTarget = this;
        for (const handler of list.slice()) {
            handler.call(this, event);
            if (event.propagationStopped) return;
        }
    }
}

export class MiniElement extends EventTargetBase {
    constructor(tagName, ownerDocument) {
        super();
        this.nodeType = 1;
        this.tagName = String(tagName).toUpperCase();
        this.ownerDocument = ownerDocument;
        this.parentNode = null;
        /** @type {Array<MiniElement|MiniText>} */
        this.childNodes = [];
        /** @type {Map<string,string>} */
        this.attributes = new Map();
        this.style = {};
        /** Set by innerHTML when given markup this DOM does not parse (SVG icons). */
        this.rawHtml = null;
        // Form-ish properties components read and write directly.
        this.value = '';
        this.checked = false;
        this.disabled = false;
        this.selectionStart = 0;
        this.selectionEnd = 0;
        this.scrollTop = 0;
        this.isContentEditable = false;
        this.rect = null;
    }

    // --- identity -------------------------------------------------------
    get id() { return this.attributes.get('id') || ''; }
    set id(value) { this.attributes.set('id', String(value)); }
    get className() { return this.attributes.get('class') || ''; }
    set className(value) { this.attributes.set('class', String(value)); }

    get classList() {
        const owner = this;
        const read = () => (owner.className || '').split(/\s+/).filter(Boolean);
        const write = (list) => { owner.className = list.join(' '); };
        return {
            get length() { return read().length; },
            contains: (name) => read().includes(name),
            add: (...names) => {
                const list = read();
                for (const n of names) if (n && !list.includes(n)) list.push(n);
                write(list);
            },
            remove: (...names) => write(read().filter(n => !names.includes(n))),
            toggle: (name, force) => {
                const list = read();
                const has = list.includes(name);
                const want = force === undefined ? !has : Boolean(force);
                if (want && !has) list.push(name);
                if (!want && has) return (write(list.filter(n => n !== name)), false);
                write(list);
                return want;
            }
        };
    }

    get dataset() {
        const owner = this;
        return new Proxy({}, {
            get: (_, key) => owner.attributes.get(`data-${String(key).replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`),
            set: (_, key, value) => {
                owner.attributes.set(`data-${String(key).replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`, String(value));
                return true;
            },
            has: (_, key) => owner.attributes.has(`data-${String(key)}`),
            ownKeys: () => Array.from(owner.attributes.keys())
                .filter(k => k.startsWith('data-'))
                .map(k => camelCase(k.slice(5))),
            getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true })
        });
    }

    setAttribute(name, value) {
        const key = String(name).toLowerCase();
        this.attributes.set(key, String(value));
        if (key === 'style') this.applyStyleText(String(value));
    }
    getAttribute(name) {
        const v = this.attributes.get(String(name).toLowerCase());
        return v === undefined ? null : v;
    }
    hasAttribute(name) { return this.attributes.has(String(name).toLowerCase()); }
    removeAttribute(name) { this.attributes.delete(String(name).toLowerCase()); }

    /** Parse an inline `style="a:b; c:d"` string into this.style. */
    applyStyleText(text) {
        for (const decl of text.split(';')) {
            const i = decl.indexOf(':');
            if (i < 0) continue;
            const prop = decl.slice(0, i).trim();
            if (!prop) continue;
            this.style[camelCase(prop)] = decl.slice(i + 1).trim();
        }
    }

    // --- tree -----------------------------------------------------------
    get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
    get children() { return this.childNodes.filter(n => n.nodeType === 1); }
    get firstChild() { return this.childNodes[0] || null; }
    get firstElementChild() { return this.children[0] || null; }
    get nextSibling() {
        const sibs = this.parentNode?.childNodes || [];
        return sibs[sibs.indexOf(this) + 1] || null;
    }

    appendChild(node) {
        if (!node) return node;
        node.parentNode?.removeChild?.(node);
        node.parentNode = this;
        this.childNodes.push(node);
        this.rawHtml = null;
        return node;
    }
    insertBefore(node, ref) {
        if (!ref) return this.appendChild(node);
        const i = this.childNodes.indexOf(ref);
        if (i < 0) return this.appendChild(node);
        node.parentNode?.removeChild?.(node);
        node.parentNode = this;
        this.childNodes.splice(i, 0, node);
        return node;
    }
    removeChild(node) {
        const i = this.childNodes.indexOf(node);
        if (i >= 0) {
            this.childNodes.splice(i, 1);
            node.parentNode = null;
        }
        return node;
    }
    replaceChild(next, prev) {
        const i = this.childNodes.indexOf(prev);
        if (i < 0) return prev;
        next.parentNode?.removeChild?.(next);
        next.parentNode = this;
        this.childNodes[i] = next;
        prev.parentNode = null;
        return prev;
    }
    remove() { this.parentNode?.removeChild(this); }
    contains(node) {
        for (let n = node; n; n = n.parentNode) if (n === this) return true;
        return false;
    }

    // --- content --------------------------------------------------------
    get textContent() {
        return this.childNodes.map(n => n.textContent).join('');
    }
    set textContent(value) {
        for (const child of this.childNodes) child.parentNode = null;
        this.childNodes = [];
        this.rawHtml = null;
        const text = value == null ? '' : String(value);
        if (text) this.appendChild(new MiniText(text));
    }

    get innerHTML() {
        if (this.rawHtml !== null) return this.rawHtml;
        return this.childNodes.map(serialize).join('');
    }
    set innerHTML(html) {
        for (const child of this.childNodes) child.parentNode = null;
        this.childNodes = [];
        // Only ShapeLibrary's SVG previews ever set markup here; keep the
        // string so innerHTML round-trips without a second parser pass.
        this.rawHtml = html ? String(html) : null;
    }

    // --- queries --------------------------------------------------------
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) {
        const out = [];
        for (const el of descendants(this)) {
            if (matches(el, selector, this)) out.push(el);
        }
        return out;
    }
    matches(selector) { return matches(this, selector, this); }
    closest(selector) {
        for (let el = this; el && el.nodeType === 1; el = el.parentElement) {
            if (matches(el, selector, el)) return el;
        }
        return null;
    }

    // --- interaction ----------------------------------------------------
    getBoundingClientRect() {
        return this.rect || { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 };
    }
    get offsetWidth() { return this.getBoundingClientRect().width; }
    get offsetHeight() { return this.getBoundingClientRect().height; }
    get clientWidth() { return this.offsetWidth; }
    get clientHeight() { return this.offsetHeight; }
    focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
    blur() {
        if (this.ownerDocument?.activeElement === this) this.ownerDocument.activeElement = null;
    }
    select() {}
    scrollIntoView() {}
    setPointerCapture() {}
    releasePointerCapture() {}

    /** Canvas support: handed the context factory the document was built with. */
    getContext(kind) {
        if (!this._ctx) this._ctx = this.ownerDocument?.createContext?.(this, kind) ?? null;
        return this._ctx;
    }

    dispatchEvent(event) {
        event.target = event.target || this;
        for (let node = this; node; node = node.parentElement) {
            node.fire(event);
            if (event.propagationStopped) return !event.defaultPrevented;
        }
        // Real bubbling continues past <html> to document and then window.
        const doc = this.ownerDocument;
        if (doc && !event.propagationStopped) doc.fire(event);
        if (doc?.defaultView && !event.propagationStopped) doc.defaultView.fire(event);
        return !event.defaultPrevented;
    }

    click() {
        return this.dispatchEvent(new MiniEvent('click', { button: 0, bubbles: true }));
    }
}

function serialize(node) {
    if (node.nodeType === 3) return node.data;
    const attrs = Array.from(node.attributes.entries())
        .map(([k, v]) => ` ${k}="${v}"`).join('');
    const tag = node.tagName.toLowerCase();
    if (VOID_TAGS.has(tag)) return `<${tag}${attrs}>`;
    return `<${tag}${attrs}>${node.innerHTML}</${tag}>`;
}

/** Depth-first element descendants of `root`, excluding root itself. */
function* descendants(root) {
    for (const child of root.childNodes) {
        if (child.nodeType !== 1) continue;
        yield child;
        yield* descendants(child);
    }
}

// --- selector matching --------------------------------------------------
// Supports the shapes the app actually uses: tag, #id, .class, [attr],
// [attr="value"], :scope, descendant and `>` combinators, comma lists.

function parseSelector(selector) {
    return String(selector).split(',').map(part => {
        const tokens = part.trim().split(/\s*(>)\s*|\s+/).filter(Boolean);
        const steps = [];
        let combinator = null;
        for (const token of tokens) {
            if (token === '>') { combinator = '>'; continue; }
            steps.push({ compound: token, combinator: combinator ?? (steps.length ? ' ' : null) });
            combinator = null;
        }
        return steps;
    });
}

function matchCompound(el, compound, scope) {
    if (!el || el.nodeType !== 1) return false;
    const parts = compound.match(/^[a-zA-Z*][\w-]*|[.#][\w-]+|\[[^\]]+\]|:scope/g) || [];
    for (const part of parts) {
        if (part === ':scope') {
            if (el !== scope) return false;
        } else if (part.startsWith('#')) {
            if (el.id !== part.slice(1)) return false;
        } else if (part.startsWith('.')) {
            if (!el.classList.contains(part.slice(1))) return false;
        } else if (part.startsWith('[')) {
            const m = part.slice(1, -1).match(/^([\w-]+)(?:\s*=\s*["']?([^"']*)["']?)?$/);
            if (!m) return false;
            if (!el.hasAttribute(m[1])) return false;
            if (m[2] !== undefined && el.getAttribute(m[1]) !== m[2]) return false;
        } else if (part !== '*') {
            if (el.tagName !== part.toUpperCase()) return false;
        }
    }
    return parts.length > 0;
}

function matches(el, selector, scope) {
    for (const steps of parseSelector(selector)) {
        if (matchSteps(el, steps, steps.length - 1, scope)) return true;
    }
    return false;
}

function matchSteps(el, steps, index, scope) {
    if (index < 0) return true;
    const step = steps[index];
    if (!matchCompound(el, step.compound, scope)) return false;
    if (index === 0) return true;
    const combinator = step.combinator;
    if (combinator === '>') return matchSteps(el.parentElement, steps, index - 1, scope);
    for (let a = el.parentElement; a; a = a.parentElement) {
        if (matchSteps(a, steps, index - 1, scope)) return true;
    }
    return false;
}

// --- parsing ------------------------------------------------------------

/**
 * Parse an HTML string into a document-like tree.
 * @param {string} html
 * @param {{createContext?: (el: MiniElement, kind: string) => any}} [options]
 */
export function parseHTML(html, options = {}) {
    const doc = new MiniDocument(options.createContext);
    const root = doc.documentElement;
    const stack = [root];
    const top = () => stack[stack.length - 1];
    let i = 0;

    while (i < html.length) {
        const lt = html.indexOf('<', i);
        if (lt < 0) {
            addText(top(), html.slice(i));
            break;
        }
        if (lt > i) addText(top(), html.slice(i, lt));

        if (html.startsWith('<!--', lt)) {
            const end = html.indexOf('-->', lt);
            i = end < 0 ? html.length : end + 3;
            continue;
        }
        if (html.startsWith('<!', lt)) {
            const end = html.indexOf('>', lt);
            i = end < 0 ? html.length : end + 1;
            continue;
        }
        if (html.startsWith('</', lt)) {
            const end = html.indexOf('>', lt);
            const name = html.slice(lt + 2, end).trim().toLowerCase();
            for (let s = stack.length - 1; s > 0; s--) {
                if (stack[s].tagName === name.toUpperCase()) {
                    stack.length = s;
                    break;
                }
            }
            i = end < 0 ? html.length : end + 1;
            continue;
        }

        const end = findTagEnd(html, lt);
        const raw = html.slice(lt + 1, end);
        const selfClosing = raw.endsWith('/');
        const body = selfClosing ? raw.slice(0, -1) : raw;
        const nameMatch = body.match(/^[\w:-]+/);
        if (!nameMatch) { i = end + 1; continue; }
        const name = nameMatch[0].toLowerCase();
        const el = doc.createElement(name);
        for (const [, attr, , value] of body.slice(name.length)
            .matchAll(/([\w:.-]+)(\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)) {
            const clean = value === undefined
                ? ''
                : value.replace(/^["']|["']$/g, '');
            el.setAttribute(attr, clean);
        }
        top().appendChild(el);
        i = end + 1;

        if (VOID_TAGS.has(name) || selfClosing) continue;
        if (RAW_TEXT_TAGS.has(name)) {
            const close = html.toLowerCase().indexOf(`</${name}`, i);
            const text = html.slice(i, close < 0 ? html.length : close);
            if (name === 'textarea') el.value = text;
            addText(el, text);
            i = close < 0 ? html.length : html.indexOf('>', close) + 1;
            continue;
        }
        stack.push(el);
    }

    doc.body = root.querySelector('body') || root;
    doc.head = root.querySelector('head') || root;
    return doc;
}

/** Skip past quoted attribute values so `>` inside one does not end the tag. */
function findTagEnd(html, start) {
    let quote = null;
    for (let i = start + 1; i < html.length; i++) {
        const c = html[i];
        if (quote) { if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'") { quote = c; continue; }
        if (c === '>') return i;
    }
    return html.length;
}

function addText(parent, text) {
    if (!text) return;
    parent.appendChild(new MiniText(text));
}

export class MiniDocument extends EventTargetBase {
    constructor(createContext) {
        super();
        this.nodeType = 9;
        this.documentElement = new MiniElement('html', this);
        this.body = this.documentElement;
        this.head = this.documentElement;
        this.activeElement = null;
        this.defaultView = null;
        this.createContext = createContext || (() => null);
    }
    createElement(tag) { return new MiniElement(tag, this); }
    createElementNS(_ns, tag) { return new MiniElement(tag, this); }
    createTextNode(text) { return new MiniText(text); }
    getElementById(id) {
        if (!id) return null;
        for (const el of descendants(this.documentElement)) {
            if (el.id === id) return el;
        }
        return null;
    }
    querySelector(selector) { return this.documentElement.querySelector(selector); }
    querySelectorAll(selector) { return this.documentElement.querySelectorAll(selector); }
    /** Dispatch straight at the document (DOMContentLoaded, keydown, ...). */
    dispatchEvent(event) {
        event.target = event.target || this;
        this.fire(event);
        if (this.defaultView && !event.propagationStopped) this.defaultView.fire(event);
        return !event.defaultPrevented;
    }
}

/** A window-like global with the properties the app reads. */
export class MiniWindow extends EventTargetBase {
    constructor(doc) {
        super();
        this.document = doc;
        this.innerWidth = 1280;
        this.innerHeight = 800;
        this.devicePixelRatio = 1;
        doc.defaultView = this;
    }
    getComputedStyle() { return { lineHeight: '16px' }; }
    dispatchEvent(event) {
        event.target = event.target || this;
        this.fire(event);
        return !event.defaultPrevented;
    }
}

export { MiniEvent, MiniText };
