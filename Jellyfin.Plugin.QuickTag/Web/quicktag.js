/*
 * QuickTag: Tag mode for jellyfin-web.
 *
 * The header gets a tag button (administrators only). It opens a bar at the top of the
 * screen: pick or create a tag, then click (or arrow-key to and press Space on) any movie,
 * show, season, episode or collection on the page to add or remove that tag. Nothing
 * navigates while Tag mode is on. Served by the QuickTag plugin at /QuickTag/ClientScript.
 */
(function () {
    'use strict';

    if (window.__quickTag) {
        return;
    }
    window.__quickTag = true;

    const TAGGABLE = new Set(['Movie', 'Series', 'Season', 'Episode', 'BoxSet', 'Video', 'MusicVideo']);
    const CARD_SELECTOR = '.card[data-id][data-type], .listItem[data-id][data-type]';
    const STORE_KEY = 'quicktag';
    const MAX_RECENT = 5;
    const MAX_UNDO = 50;

    const state = {
        active: false,
        isAdmin: null,
        tag: null,
        tags: [],            // [{Name, Count}] from the server
        tagged: new Set(),   // ids of items with the current tag
        loadingTag: false,
        pending: 0,          // requests in flight
        refreshTimer: 0,
        recent: [],
        undo: [],            // [{tag, ids, add}]
        cursor: null,        // card element the keyboard is on
        anchor: null,        // last clicked card, for shift-click ranges
        confirm: null,       // {action, timer} while a bulk button waits for its second click
        detailsItem: null    // {Id, Type, Name} of the details page shown
    };

    // ---------- storage (a convenience only: may be unavailable) ----------

    function load() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
            state.recent = Array.isArray(saved.recent) ? saved.recent.slice(0, MAX_RECENT) : [];
            state.tag = typeof saved.tag === 'string' ? saved.tag : null;
            return sessionStorage.getItem(STORE_KEY + '.active') === '1';
        } catch (e) {
            return false;
        }
    }

    function save() {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify({ tag: state.tag, recent: state.recent }));
            sessionStorage.setItem(STORE_KEY + '.active', state.active ? '1' : '0');
        } catch (e) {
            // ignore
        }
    }

    // ---------- server ----------

    function api() {
        return window.ApiClient;
    }

    function request(method, path, body) {
        const client = api();
        const options = { type: method, url: client.getUrl(path), dataType: 'json' };
        if (body !== undefined) {
            options.data = JSON.stringify(body);
            options.contentType = 'application/json';
        }
        return client.ajax(options);
    }

    function fetchTags() {
        return request('GET', 'QuickTag/Tags').then(function (tags) {
            state.tags = tags || [];
            if (list && !list.hidden) {
                openList();
            }
            renderStatus();
        });
    }

    function fetchTagged(tag) {
        return request('GET', 'QuickTag/Items?tag=' + encodeURIComponent(tag));
    }

    function checkAdmin() {
        const client = api();
        if (!client || !client.getCurrentUserId || !client.getCurrentUserId()) {
            return Promise.resolve(false);
        }
        return client.getCurrentUser().then(function (user) {
            return !!(user && user.Policy && user.Policy.IsAdministrator);
        }, function () {
            return false;
        });
    }

    // ---------- styles ----------

    const CSS = `
:root { --qt-top: 0px; --qt-bar-h: 0px; --qt-on: #2fbf71; --qt-accent: #00a4dc; }
.qt-bar { position: fixed; left: 0; right: 0; top: var(--qt-top); z-index: 1100; box-sizing: border-box;
  display: flex; flex-wrap: wrap; align-items: center; gap: .5em .75em; padding: .5em 1em;
  background: rgba(16,16,16,.94); color: #fff; font-size: 14px; line-height: 1.3;
  border-bottom: 2px solid var(--qt-accent); box-shadow: 0 4px 16px rgba(0,0,0,.4);
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
.qt-bar[hidden] { display: none; }
.qt-bar * { box-sizing: border-box; }
.qt-title { font-weight: 600; display: flex; align-items: center; gap: .3em; white-space: nowrap; }
.qt-title .material-icons { color: var(--qt-accent); font-size: 1.4em; }
.qt-picker { position: relative; flex: 0 1 18em; min-width: 11em; }
.qt-input { width: 100%; font: inherit; color: #fff; background: rgba(255,255,255,.08);
  border: 1px solid rgba(255,255,255,.25); border-radius: 6px; padding: .45em .7em; outline: none; }
.qt-input:focus { border-color: var(--qt-accent); background: rgba(255,255,255,.12); }
.qt-list { position: absolute; left: 0; right: 0; top: calc(100% + 4px); margin: 0; padding: 4px 0; list-style: none;
  max-height: 50vh; overflow-y: auto; background: #1f1f1f; border: 1px solid rgba(255,255,255,.2);
  border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.5); }
.qt-list[hidden] { display: none; }
.qt-list li { display: flex; justify-content: space-between; gap: 1em; padding: .45em .8em; cursor: pointer; }
.qt-list li.qt-hl { background: rgba(0,164,220,.3); }
.qt-list li .qt-count { opacity: .6; }
.qt-list li.qt-new { font-style: italic; }
.qt-list li.qt-empty { cursor: default; opacity: .6; }
.qt-chips { display: flex; gap: .35em; flex-wrap: wrap; }
.qt-chip, .qt-btn { font: inherit; color: #fff; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.2);
  border-radius: 999px; padding: .3em .8em; cursor: pointer; white-space: nowrap; }
.qt-btn { border-radius: 6px; display: inline-flex; align-items: center; gap: .3em; }
.qt-btn[hidden] { display: none; }
.qt-btn .material-icons { font-size: 1.2em; }
.qt-chip:hover, .qt-btn:hover:not(:disabled) { background: rgba(255,255,255,.2); }
.qt-chip.qt-current { background: var(--qt-accent); border-color: var(--qt-accent); }
.qt-chip kbd { opacity: .6; font: inherit; font-size: .85em; margin-right: .35em; }
.qt-btn:disabled { opacity: .4; cursor: default; }
.qt-btn.qt-confirming { background: #c0392b; border-color: #c0392b; }
.qt-btn.qt-on { background: var(--qt-on); border-color: var(--qt-on); }
.qt-status { opacity: .85; white-space: nowrap; }
.qt-status b { color: var(--qt-on); }
.qt-spacer { flex: 1 1 auto; }
.qt-msg { color: #ffb4a8; white-space: nowrap; }
.qt-help { flex-basis: 100%; opacity: .75; font-size: .9em; }
.qt-help[hidden] { display: none; }
.qt-help kbd { font: inherit; padding: 0 .35em; border: 1px solid rgba(255,255,255,.35); border-radius: 3px; }
.qt-fab { position: fixed; left: 16px; bottom: 16px; z-index: 1099; width: 48px; height: 48px; border-radius: 50%;
  border: none; background: var(--qt-accent); color: #fff; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,.4); }
.qt-headerButton.qt-active-btn .material-icons { color: var(--qt-accent); }
.qt-appBarButton { display: inline-flex; align-items: center; justify-content: center; padding: 8px; margin: 0 2px;
  border: none; border-radius: 50%; background: none; color: inherit; cursor: pointer; }
.qt-appBarButton:hover { background: rgba(255,255,255,.08); }

body.qt-active .mainAnimatedPage { top: var(--qt-bar-h) !important; }
body.qt-active .qt-card { cursor: copy; scroll-margin-top: calc(var(--qt-top) + var(--qt-bar-h) + 12px); scroll-margin-bottom: 12px; }
body.qt-active .qt-card .cardOverlayContainer,
body.qt-active .qt-card .cardOverlayButton,
body.qt-active .qt-card .listItemButton,
body.qt-active .qt-card .itemSelectionPanel { display: none !important; }
body.qt-active .qt-card .cardScalable,
body.qt-active .qt-card.listItem { position: relative; transition: opacity .15s; }
body.qt-active.qt-has-tag .qt-card:not(.qt-on) .cardScalable,
body.qt-active.qt-has-tag .qt-card.listItem:not(.qt-on) { opacity: .55; }
body.qt-active .qt-card.qt-on .cardScalable { outline: 3px solid var(--qt-on); outline-offset: 2px; border-radius: .2em; }
body.qt-active .qt-card.listItem.qt-on { box-shadow: inset 4px 0 0 var(--qt-on); }
body.qt-active .qt-card.qt-cursor .cardScalable,
body.qt-active .qt-card.listItem.qt-cursor { outline: 3px solid #fff; outline-offset: 2px; opacity: 1; }
body.qt-active .qt-card.qt-on.qt-cursor .cardScalable { outline-color: #b6ffd5; }
.qt-badge { position: absolute; top: .4em; right: .4em; z-index: 5; width: 1.9em; height: 1.9em; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; pointer-events: none;
  background: rgba(0,0,0,.65); color: #fff; border: 2px solid rgba(255,255,255,.7); font-size: 14px; }
.qt-badge .material-icons { font-size: 1.25em; }
.qt-card.listItem .qt-badge { position: static; flex: none; margin-right: .6em; }
body:not(.qt-active) .qt-badge, body:not(.qt-has-tag) .qt-badge { display: none; }
.qt-card:not(.qt-on) .qt-badge { opacity: 0; }
.qt-card:not(.qt-on):hover .qt-badge, .qt-card.qt-cursor:not(.qt-on) .qt-badge { opacity: 1; }
.qt-card.qt-on .qt-badge { background: var(--qt-on); border-color: var(--qt-on); }
.qt-card.qt-busy .qt-badge { animation: qt-pulse .7s ease-in-out infinite alternate; }
@keyframes qt-pulse { from { opacity: .4; } to { opacity: 1; } }
@media (max-width: 600px) { .qt-bar { font-size: 13px; padding: .4em .6em; } .qt-picker { flex-basis: 100%; } .qt-btn .qt-label { display: none; } }
`;

    // ---------- DOM ----------

    let bar = null;
    let input = null;
    let list = null;
    let listItems = [];   // [{name, count, isNew}] currently shown
    let listIndex = -1;

    function el(tag, attrs, children) {
        const node = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (key) {
            if (key === 'class') {
                node.className = attrs[key];
            } else if (key === 'text') {
                node.textContent = attrs[key];
            } else if (key.slice(0, 2) === 'on') {
                node.addEventListener(key.slice(2), attrs[key]);
            } else {
                node.setAttribute(key, attrs[key]);
            }
        });
        (children || []).forEach(function (child) {
            node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
        });
        return node;
    }

    function icon(name) {
        return el('span', { class: 'material-icons', 'aria-hidden': 'true', text: name });
    }

    function button(cls, iconName, label, title, onclick) {
        return el('button', { type: 'button', class: 'qt-btn ' + cls, title: title, onclick: onclick },
            [icon(iconName), el('span', { class: 'qt-label', text: label })]);
    }

    function buildBar() {
        input = el('input', {
            class: 'qt-input', type: 'text', placeholder: 'Choose or create a tag…', autocomplete: 'off',
            spellcheck: 'false', 'aria-label': 'Tag'
        });
        list = el('ul', { class: 'qt-list', role: 'listbox', hidden: '' });
        input.addEventListener('focus', function () {
            input.select();
            openList();
        });
        input.addEventListener('input', openList);
        input.addEventListener('keydown', onInputKey);
        input.addEventListener('blur', function () {
            setTimeout(function () {
                closeList();
                input.value = state.tag || '';
            }, 150);
        });
        list.addEventListener('mousedown', function (e) {
            e.preventDefault();   // keep focus in the input
            const li = e.target.closest('li[data-index]');
            if (li) {
                chooseFromList(Number(li.dataset.index));
            }
        });

        bar = el('div', { class: 'qt-bar', role: 'toolbar', 'aria-label': 'Tag mode' }, [
            el('div', { class: 'qt-title' }, [icon('sell'), 'Tag mode']),
            el('div', { class: 'qt-picker' }, [input, list]),
            el('div', { class: 'qt-chips' }),
            el('span', { class: 'qt-status' }),
            button('qt-details', 'add_circle_outline', 'This title', '', toggleDetailsItem),
            el('span', { class: 'qt-spacer' }),
            el('span', { class: 'qt-msg' }),
            button('qt-all', 'library_add_check', 'Tag all', 'Add the tag to every title on this page', function () {
                bulk(true, this);
            }),
            button('qt-none', 'layers_clear', 'Untag all', 'Remove the tag from every title on this page', function () {
                bulk(false, this);
            }),
            button('qt-undo', 'undo', 'Undo', 'Undo the last change (Ctrl+Z)', undo),
            button('qt-helpbtn', 'keyboard', '', 'Keyboard shortcuts', function () {
                const help = bar.querySelector('.qt-help');
                help.hidden = !help.hidden;
            }),
            button('qt-exit', 'close', 'Done', 'Leave Tag mode (Esc)', function () {
                setActive(false);
            }),
            el('div', { class: 'qt-help', hidden: '' }, [
                'Click a title to add or remove the tag. ',
                el('kbd', { text: 'Shift' }), '+click: the same for every title since the last one clicked. ',
                el('kbd', { text: '← ↑ ↓ →' }), ' move, ',
                el('kbd', { text: 'Space' }), ' / ', el('kbd', { text: 'Enter' }), ' toggle, ',
                el('kbd', { text: '/' }), ' change tag, ',
                el('kbd', { text: '1' }), '–', el('kbd', { text: String(MAX_RECENT) }), ' recent tags, ',
                el('kbd', { text: 'Ctrl+Z' }), ' undo, ',
                el('kbd', { text: 'Esc' }), ' done.'
            ])
        ]);
        bar.hidden = true;
        document.body.appendChild(bar);
        new ResizeObserver(updateBarHeight).observe(bar);
    }

    function updateBarHeight() {
        const h = state.active && bar ? bar.offsetHeight : 0;
        document.documentElement.style.setProperty('--qt-bar-h', h + 'px');
    }

    // Keep the bar just under the app header, which can slide away on scroll
    function updateBarTop() {
        const header = visibleHeader();
        let top = 0;
        if (header) {
            top = Math.max(0, Math.round(header.getBoundingClientRect().bottom));
        }
        document.documentElement.style.setProperty('--qt-top', top + 'px');
    }

    function message(text) {
        if (bar) {
            bar.querySelector('.qt-msg').textContent = text || '';
        }
    }

    // ---------- tag picker ----------

    function openList() {
        const typed = input.value.trim();
        const query = typed.toLowerCase();
        // the field shows the current tag on focus: list every tag then
        const filter = query && !(state.tag && query === state.tag.toLowerCase()) ? query : '';
        const exact = state.tags.some(function (t) {
            return t.Name.toLowerCase() === query;
        });
        listItems = state.tags
            .filter(function (t) {
                return !filter || t.Name.toLowerCase().indexOf(filter) >= 0;
            })
            .map(function (t) {
                return { name: t.Name, count: t.Count };
            });
        if (query && !exact && query.indexOf('|') < 0 && !(state.tag && query === state.tag.toLowerCase())) {
            listItems.unshift({ name: typed, isNew: true });
        }
        listIndex = listItems.length ? 0 : -1;
        renderTagList();
        list.hidden = false;
    }

    function closeList() {
        if (list) {
            list.hidden = true;
        }
    }

    function renderTagList() {
        if (!list) {
            return;
        }
        list.textContent = '';
        if (!listItems.length) {
            const text = input.value.indexOf('|') >= 0 ? 'Tags can’t contain “|”'
                : state.tags.length ? 'No match' : 'No tags yet: type one to create it';
            list.appendChild(el('li', { class: 'qt-empty', text: text }));
            return;
        }
        listItems.forEach(function (item, i) {
            list.appendChild(el('li', {
                'data-index': String(i), role: 'option',
                class: (i === listIndex ? 'qt-hl ' : '') + (item.isNew ? 'qt-new' : '')
            }, item.isNew
                ? ['Create tag “' + item.name + '”']
                : [el('span', { text: item.name }), el('span', { class: 'qt-count', text: String(item.count) })]));
        });
        const hl = list.querySelector('.qt-hl');
        if (hl) {
            hl.scrollIntoView({ block: 'nearest' });
        }
    }

    function onInputKey(e) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (list.hidden) {
                openList();
            } else if (listItems.length) {
                listIndex = (listIndex + (e.key === 'ArrowDown' ? 1 : -1) + listItems.length) % listItems.length;
                renderTagList();
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (listIndex >= 0) {
                chooseFromList(listIndex);
            }
        } else if (e.key === 'Escape' || e.key === 'Tab') {
            if (e.key === 'Escape') {
                e.preventDefault();
            }
            input.blur();
        }
        // keep Jellyfin's own shortcuts out of the text field
        e.stopPropagation();
    }

    function chooseFromList(index) {
        const item = listItems[index];
        if (item) {
            selectTag(item.name);
            closeList();
            input.blur();
        }
    }

    function selectTag(name) {
        const tag = (name || '').trim();
        if (!tag || tag.indexOf('|') >= 0) {
            return;
        }
        // an existing tag keeps its spelling
        const known = state.tags.find(function (t) {
            return t.Name.toLowerCase() === tag.toLowerCase();
        });
        state.tag = known ? known.Name : tag;
        state.recent = [state.tag].concat(state.recent.filter(function (t) {
            return t.toLowerCase() !== state.tag.toLowerCase();
        })).slice(0, MAX_RECENT);
        state.tagged = new Set();
        state.anchor = null;
        if (input) {
            input.value = state.tag;
        }
        save();
        message('');
        renderChips();
        loadTagged();
    }

    function loadTagged() {
        decorateAll();
        if (!state.tag) {
            renderStatus();
            return Promise.resolve();
        }
        const tag = state.tag;
        state.loadingTag = true;
        renderStatus();
        return fetchTagged(tag).then(function (ids) {
            if (state.tag !== tag) {
                return;
            }
            state.tagged = new Set(ids || []);
            state.loadingTag = false;
            decorateAll();
        }, function () {
            state.loadingTag = false;
            message('Could not load the tag’s titles');
            renderStatus();
        });
    }

    // Re-read the tagged set once writes settle: tagging a series also tags its seasons
    // and episodes on the server
    function scheduleRefresh() {
        clearTimeout(state.refreshTimer);
        state.refreshTimer = setTimeout(function () {
            if (state.pending > 0) {
                scheduleRefresh();
                return;
            }
            const tag = state.tag;
            if (!tag) {
                return;
            }
            fetchTagged(tag).then(function (ids) {
                if (state.tag === tag && state.pending === 0) {
                    state.tagged = new Set(ids || []);
                    decorateAll();
                }
            });
            fetchTags();
        }, 1200);
    }

    function renderChips() {
        if (!bar) {
            return;
        }
        const chips = bar.querySelector('.qt-chips');
        chips.textContent = '';
        state.recent.forEach(function (tag, i) {
            chips.appendChild(el('button', {
                type: 'button',
                class: 'qt-chip' + (tag === state.tag ? ' qt-current' : ''),
                title: 'Switch to “' + tag + '” (' + (i + 1) + ')',
                onclick: function () {
                    selectTag(tag);
                }
            }, [el('kbd', { text: String(i + 1) }), tag]));
        });
    }

    // ---------- cards ----------

    function cardFor(target) {
        const card = target && target.closest ? target.closest(CARD_SELECTOR) : null;
        return card && TAGGABLE.has(card.dataset.type) ? card : null;
    }

    function visibleCards() {
        return Array.prototype.filter.call(document.querySelectorAll(CARD_SELECTOR), function (card) {
            return TAGGABLE.has(card.dataset.type) && card.offsetParent !== null && !card.closest('.hide');
        });
    }

    function decorate(card) {
        card.classList.add('qt-card');
        let badge = card.querySelector('.qt-badge');
        if (!badge) {
            badge = el('span', { class: 'qt-badge', 'aria-hidden': 'true' }, [icon('add')]);
            if (card.classList.contains('listItem')) {
                card.insertBefore(badge, card.firstChild);
            } else {
                (card.querySelector('.cardScalable') || card.querySelector('.cardBox') || card).appendChild(badge);
            }
        }
        const on = state.tagged.has(card.dataset.id);
        card.classList.toggle('qt-on', on);
        const want = on ? 'check' : 'add';
        if (badge.firstChild.textContent !== want) {
            badge.firstChild.textContent = want;
        }
    }

    function decorateAll() {
        document.body.classList.toggle('qt-has-tag', !!state.tag);
        if (!state.active) {
            return;
        }
        visibleCards().forEach(decorate);
        if (state.cursor && !state.cursor.isConnected) {
            state.cursor = null;
        }
        renderStatus();
    }

    function undecorateAll() {
        document.querySelectorAll('.qt-card').forEach(function (card) {
            card.classList.remove('qt-card', 'qt-on', 'qt-cursor', 'qt-busy');
            const badge = card.querySelector('.qt-badge');
            if (badge) {
                badge.remove();
            }
        });
        state.cursor = null;
    }

    function renderStatus() {
        if (!bar) {
            return;
        }
        const status = bar.querySelector('.qt-status');
        const cards = visibleCards();
        const hasTag = !!state.tag;
        bar.querySelector('.qt-all').disabled = !hasTag || !cards.length;
        bar.querySelector('.qt-none').disabled = !hasTag || !cards.length;
        bar.querySelector('.qt-undo').disabled = !state.undo.length;
        status.textContent = '';
        if (!hasTag) {
            status.textContent = 'Pick a tag to start';
        } else if (state.loadingTag) {
            status.textContent = 'Loading…';
        } else {
            const ids = new Set(cards.map(function (c) {
                return c.dataset.id;
            }));
            let onPage = 0;
            ids.forEach(function (id) {
                if (state.tagged.has(id)) {
                    onPage++;
                }
            });
            const info = state.tags.find(function (t) {
                return t.Name.toLowerCase() === state.tag.toLowerCase();
            });
            status.appendChild(el('b', { text: String(onPage) }));
            status.appendChild(document.createTextNode(' of ' + ids.size + ' here'
                + (info ? ' · ' + info.Count + ' in library' : ' · new tag')));
        }
        renderDetailsButton();
    }

    // ---------- details page ----------

    function detailsIdFromUrl() {
        const match = /details\?(?:[^#]*&)?id=([0-9a-f]{32})/i.exec(location.hash || location.href);
        return match ? match[1].toLowerCase() : null;
    }

    function refreshDetailsItem() {
        const id = detailsIdFromUrl();
        if (!id) {
            if (state.detailsItem) {
                state.detailsItem = null;
                renderDetailsButton();
            }
            return;
        }
        if (state.detailsItem && state.detailsItem.Id === id) {
            return;
        }
        state.detailsItem = { Id: id, Type: null };
        renderDetailsButton();
        const client = api();
        client.getItem(client.getCurrentUserId(), id).then(function (item) {
            if (state.detailsItem && state.detailsItem.Id === id) {
                state.detailsItem = { Id: id, Type: item.Type, Name: item.Name };
                renderDetailsButton();
            }
        }, function () {
            // leave the button hidden
        });
    }

    function renderDetailsButton() {
        if (!bar) {
            return;
        }
        const btn = bar.querySelector('.qt-details');
        const item = state.detailsItem;
        const show = !!(state.tag && !state.loadingTag && item && TAGGABLE.has(item.Type));
        btn.hidden = !show;
        if (show) {
            const on = state.tagged.has(item.Id);
            btn.classList.toggle('qt-on', on);
            btn.querySelector('.material-icons').textContent = on ? 'check_circle' : 'add_circle_outline';
            btn.title = (on ? 'Remove “' + state.tag + '” from ' : 'Add “' + state.tag + '” to ') + (item.Name || 'this title');
        }
    }

    function toggleDetailsItem() {
        const item = state.detailsItem;
        if (item && state.tag) {
            setTags([item.Id], !state.tagged.has(item.Id), true);
        }
    }

    // ---------- changes ----------

    // Sets the tag on (add) or off the items: the page at once, the server after
    function setTags(ids, add, recordUndo) {
        const tag = state.tag;
        const changed = ids.filter(function (id, i) {
            return ids.indexOf(id) === i && state.tagged.has(id) !== add;
        });
        if (!tag || !changed.length) {
            return Promise.resolve();
        }
        changed.forEach(function (id) {
            if (add) {
                state.tagged.add(id);
            } else {
                state.tagged.delete(id);
            }
        });
        if (recordUndo) {
            state.undo.push({ tag: tag, ids: changed, add: add });
            if (state.undo.length > MAX_UNDO) {
                state.undo.shift();
            }
        }
        markBusy(changed, true);
        decorateAll();
        message('');
        state.pending++;

        return request('POST', 'QuickTag/Apply', { Tag: tag, Add: add ? changed : [], Remove: add ? [] : changed })
            .then(function (result) {
                const failed = (result && result.Failed) || [];
                if (failed.length) {
                    revert(tag, failed, add);
                    message(failed.length + ' title(s) could not be changed');
                }
            }, function (err) {
                revert(tag, changed, add);
                message(err && err.status === 403 ? 'Only administrators can change tags' : 'Could not save: try again');
            })
            .then(function () {
                state.pending--;
                markBusy(changed, false);
                decorateAll();
                scheduleRefresh();
            });
    }

    function revert(tag, ids, add) {
        if (state.tag !== tag) {
            return;
        }
        ids.forEach(function (id) {
            if (add) {
                state.tagged.delete(id);
            } else {
                state.tagged.add(id);
            }
        });
    }

    function markBusy(ids, busy) {
        const set = new Set(ids);
        document.querySelectorAll('.qt-card').forEach(function (card) {
            if (set.has(card.dataset.id)) {
                card.classList.toggle('qt-busy', busy);
            }
        });
    }

    function toggleCard(card, range) {
        if (!state.tag) {
            message('Pick a tag first');
            input.focus();
            return;
        }
        setCursor(card, false);
        if (range && state.anchor && state.anchor.isConnected && state.anchor !== card) {
            const cards = visibleCards();
            const a = cards.indexOf(state.anchor);
            const b = cards.indexOf(card);
            if (a >= 0 && b >= 0) {
                // the range gets whatever the last clicked card was given
                const rangeAdd = state.tagged.has(state.anchor.dataset.id);
                const ids = cards.slice(Math.min(a, b), Math.max(a, b) + 1).map(function (c) {
                    return c.dataset.id;
                });
                state.anchor = card;
                setTags(ids, rangeAdd, true);
                return;
            }
        }
        state.anchor = card;
        setTags([card.dataset.id], !state.tagged.has(card.dataset.id), true);
    }

    function bulk(add, btn) {
        if (!state.tag) {
            return;
        }
        const action = add ? 'all' : 'none';
        const ids = Array.from(new Set(visibleCards().map(function (c) {
            return c.dataset.id;
        }))).filter(function (id) {
            return state.tagged.has(id) !== add;
        });
        if (!ids.length) {
            clearConfirm();
            message(add ? 'Everything here already has the tag' : 'Nothing here has the tag');
            return;
        }
        // Two clicks, not a browser confirm() (that would block the page)
        if (!state.confirm || state.confirm.action !== action) {
            clearConfirm();
            btn.classList.add('qt-confirming');
            btn.querySelector('.qt-label').textContent = (add ? 'Tag ' : 'Untag ') + ids.length + '?';
            state.confirm = { action: action, timer: setTimeout(clearConfirm, 4000) };
            return;
        }
        clearConfirm();
        setTags(ids, add, true);
    }

    function clearConfirm() {
        if (state.confirm) {
            clearTimeout(state.confirm.timer);
            state.confirm = null;
        }
        if (bar) {
            bar.querySelectorAll('.qt-confirming').forEach(function (btn) {
                btn.classList.remove('qt-confirming');
            });
            bar.querySelector('.qt-all .qt-label').textContent = 'Tag all';
            bar.querySelector('.qt-none .qt-label').textContent = 'Untag all';
        }
    }

    function undo() {
        const last = state.undo.pop();
        if (!last) {
            return;
        }
        const ready = last.tag === state.tag && !state.loadingTag
            ? Promise.resolve()
            : (selectTag(last.tag), loadTagged());
        ready.then(function () {
            setTags(last.ids, !last.add, false).then(renderStatus);
        });
    }

    // ---------- keyboard cursor ----------

    function setCursor(card, scroll) {
        if (state.cursor && state.cursor !== card) {
            state.cursor.classList.remove('qt-cursor');
        }
        state.cursor = card;
        if (card) {
            card.classList.add('qt-cursor');
            if (scroll) {
                card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
            }
        }
    }

    function firstCardInView(cards) {
        const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
        return cards.find(function (c) {
            const r = c.getBoundingClientRect();
            return r.top >= barBottom - r.height / 2 && r.top < window.innerHeight && r.left >= 0 && r.left < window.innerWidth;
        }) || cards[0];
    }

    function moveCursor(key) {
        const cards = visibleCards();
        if (!cards.length) {
            return;
        }
        if (!state.cursor || !state.cursor.isConnected || cards.indexOf(state.cursor) < 0) {
            setCursor(firstCardInView(cards), true);
            return;
        }
        const from = state.cursor.getBoundingClientRect();
        const fx = from.left + from.width / 2;
        const fy = from.top + from.height / 2;
        let best = null;
        let bestScore = Infinity;
        cards.forEach(function (card) {
            if (card === state.cursor) {
                return;
            }
            const r = card.getBoundingClientRect();
            const dx = r.left + r.width / 2 - fx;
            const dy = r.top + r.height / 2 - fy;
            const horizontal = key === 'ArrowRight' || key === 'ArrowLeft';
            const sign = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1;
            const primary = (horizontal ? dx : dy) * sign;
            const secondary = horizontal ? dy : dx;
            if (primary <= 4) {
                return;
            }
            // strongly prefer staying in the same row / column
            const score = primary + Math.abs(secondary) * 3;
            if (score < bestScore) {
                bestScore = score;
                best = card;
            }
        });
        if (best) {
            setCursor(best, true);
        }
    }

    function isTyping(target) {
        return target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    }

    function onKeyDown(e) {
        if (!state.active || e.defaultPrevented || isTyping(e.target)) {
            return;
        }
        // leave Jellyfin's own dialogs alone
        if (document.querySelector('.dialogContainer .dialog')) {
            return;
        }
        const key = e.key;
        const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
        let handled = true;
        if (key === 'Escape') {
            setActive(false);
        } else if (/^Arrow/.test(key) && plain) {
            moveCursor(key);
        } else if ((key === ' ' || key === 'Enter') && plain && state.cursor && state.cursor.isConnected) {
            toggleCard(state.cursor, e.shiftKey);
        } else if ((key === '/' || key === 't') && plain) {
            input.focus();
        } else if ((key === 'z' || key === 'Z') && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
            undo();
        } else if (/^[1-9]$/.test(key) && plain && state.recent[Number(key) - 1]) {
            selectTag(state.recent[Number(key) - 1]);
        } else {
            handled = false;
        }
        if (handled) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }

    // ---------- clicks ----------

    function swallow(e) {
        e.preventDefault();
        e.stopImmediatePropagation();
    }

    function onClick(e) {
        if (!state.active || e.button !== 0 || (bar && bar.contains(e.target))) {
            return;
        }
        const card = cardFor(e.target);
        if (!card) {
            return;
        }
        swallow(e);
        toggleCard(card, e.shiftKey);
    }

    // Jellyfin also acts on these (multi-select, drag, text selection): not in Tag mode
    function onPointerish(e) {
        if (!state.active || (bar && bar.contains(e.target)) || !cardFor(e.target)) {
            return;
        }
        if (e.type === 'mousedown') {
            if (e.shiftKey) {
                e.preventDefault();   // no text selection on shift-click
            }
        } else {
            swallow(e);
        }
    }

    // ---------- mode ----------

    function setActive(active) {
        if (active === state.active) {
            return;
        }
        state.active = active;
        if (active) {
            if (!bar) {
                buildBar();
            }
            bar.hidden = false;
            input.value = state.tag || '';
            renderChips();
            updateBarTop();
            document.body.classList.add('qt-active');
            fetchTags().catch(function () {
                message('Could not load tags');
            });
            refreshDetailsItem();
            loadTagged();
            if (!state.tag) {
                setTimeout(function () {
                    input.focus();
                }, 50);
            }
        } else {
            clearConfirm();
            closeList();
            if (bar) {
                bar.hidden = true;
            }
            document.body.classList.remove('qt-active');
            undecorateAll();
        }
        updateBarHeight();
        updateEntryButtons();
        save();
    }

    // ---------- entry points ----------

    let headerButton = null;
    let fab = null;

    function updateEntryButtons() {
        [headerButton, fab].forEach(function (btn) {
            if (btn) {
                btn.classList.toggle('qt-active-btn', state.active);
                btn.title = state.active ? 'Leave Tag mode' : 'Tag mode';
            }
        });
    }

    function toggleButton(cls) {
        return el('button', {
            type: 'button', class: cls, title: 'Tag mode', 'aria-label': 'Tag mode',
            onclick: function () {
                setActive(!state.active);
            }
        }, [icon('sell')]);
    }

    // (offsetParent is null for fixed-position elements such as the headers)
    function isShown(node) {
        return !!node && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
    }

    // jellyfin-web has two headers: the React app bar (library pages in the current
    // layout) and the classic one (other pages); only one is shown at a time
    function visibleHeader() {
        const appBar = document.querySelector('header.MuiAppBar-root');
        if (isShown(appBar)) {
            return appBar;
        }
        const skin = document.querySelector('.skinHeader');
        return isShown(skin) && !skin.classList.contains('hide') ? skin : null;
    }

    // Where the header button goes: before the right-hand buttons' last one (the user menu)
    function headerSlot() {
        const appBarRight = document.querySelector('header.MuiAppBar-root .MuiToolbar-root > .MuiBox-root:last-child');
        if (isShown(appBarRight)) {
            return { parent: appBarRight, before: appBarRight.lastElementChild, cls: 'qt-headerButton qt-appBarButton' };
        }
        const headerRight = document.querySelector('.skinHeader .headerRight');
        if (isShown(headerRight)) {
            return {
                parent: headerRight, before: headerRight.firstChild,
                cls: 'headerButton headerButtonRight paper-icon-button-light qt-headerButton'
            };
        }
        return null;
    }

    function ensureEntryPoint() {
        if (!state.isAdmin) {
            return;
        }
        const slot = headerSlot();
        if (slot) {
            if (!headerButton || headerButton.parentNode !== slot.parent) {
                if (headerButton) {
                    headerButton.remove();
                }
                headerButton = toggleButton(slot.cls);
                slot.parent.insertBefore(headerButton, slot.before);
                updateEntryButtons();
            }
            if (fab) {
                fab.remove();
                fab = null;
            }
        } else if (!fab && document.querySelector(CARD_SELECTOR)) {
            // a layout without the classic header: a floating button instead
            fab = toggleButton('qt-fab');
            document.body.appendChild(fab);
            updateEntryButtons();
        }
    }

    function removeEntryPoints() {
        [headerButton, fab].forEach(function (btn) {
            if (btn) {
                btn.remove();
            }
        });
        headerButton = null;
        fab = null;
    }

    let userId = null;
    let restoreActive = false;

    function onUserMaybeChanged() {
        const client = api();
        const current = client && client.getCurrentUserId ? client.getCurrentUserId() : null;
        if (current === userId) {
            return;
        }
        userId = current;
        state.isAdmin = null;
        if (!current) {
            setActive(false);
            removeEntryPoints();
            return;
        }
        checkAdmin().then(function (isAdmin) {
            if (userId !== current) {
                return;
            }
            state.isAdmin = isAdmin;
            if (isAdmin) {
                ensureEntryPoint();
                if (restoreActive) {
                    restoreActive = false;
                    setActive(true);
                }
            } else {
                setActive(false);
                removeEntryPoints();
            }
        });
    }

    // One observer for everything that appears later: the header, cards (paging,
    // navigation, rows loading in), user changes
    let scheduled = false;

    function onDomChange() {
        if (scheduled) {
            return;
        }
        scheduled = true;
        requestAnimationFrame(function () {
            scheduled = false;
            onUserMaybeChanged();
            ensureEntryPoint();
            if (state.active) {
                updateBarTop();
                decorateAll();
                refreshDetailsItem();
            }
        });
    }

    // Changes QuickTag makes itself (the bar, badges) mustn't wake the observer again
    function isOwn(node) {
        return node.nodeType === 1 && (node.classList.contains('qt-badge') || node === headerButton || node === fab);
    }

    function isForeignChange(record) {
        const target = record.target;
        if ((bar && bar.contains(target)) || (target.closest && target.closest('.qt-badge'))) {
            return false;
        }
        const nodes = Array.prototype.slice.call(record.addedNodes).concat(Array.prototype.slice.call(record.removedNodes));
        return !nodes.length || !nodes.every(isOwn);
    }

    function start() {
        if (!document.body) {
            document.addEventListener('DOMContentLoaded', start);
            return;
        }
        restoreActive = load();
        document.head.appendChild(el('style', { id: 'quicktag-style', text: CSS }));

        new MutationObserver(function (records) {
            if (records.some(isForeignChange)) {
                onDomChange();
            }
        }).observe(document.body, { childList: true, subtree: true });
        window.addEventListener('click', onClick, true);
        ['mousedown', 'contextmenu', 'dragstart', 'dblclick'].forEach(function (type) {
            window.addEventListener(type, onPointerish, true);
        });
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('scroll', function () {
            if (state.active) {
                updateBarTop();
            }
        }, { capture: true, passive: true });
        window.addEventListener('resize', function () {
            if (state.active) {
                updateBarTop();
            }
        });
        window.addEventListener('hashchange', onDomChange);
        window.addEventListener('popstate', onDomChange);
        onDomChange();
    }

    start();
}());
