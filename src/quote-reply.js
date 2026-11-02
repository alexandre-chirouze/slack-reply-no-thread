(() => {
  'use strict';
  const KEY = '__slackQuoteReply';
  const VERSION = '1.3.1';
  if (window[KEY]?.version === VERSION) return;
  window[KEY]?.dispose();

  const ROW = '[data-qa="message_container"]';
  const BAR = '[data-qa="message-actions"]';
  const BUTTON = '[data-slack-quote-reply]';
  const PRIMARY = '.p-view_contents--primary';
  const THREAD = '[data-qa="threads_flexpane"]';
  const EDITOR = '[data-qa="message_input_container"] [data-qa="texty_input"][contenteditable="true"]';
  const THREAD_EDITOR = '[data-qa="reply_container"] [data-qa="texty_input"][contenteditable="true"]';
  const CARD = '[data-qa="forwarded_message_card"]';
  const PREVIEW = '[data-slack-reply-preview-toggle]';
  const previews = new Map();
  const previewCards = new WeakMap();
  const previewGroups = new Map();
  const cleanups = new AbortController();
  let frame = 0;
  let noticeTimer;
  let disposed = false;

  const style = document.createElement('style');
  style.id = 'slack-quote-reply-style';
  style.textContent = `
    ${BUTTON} { width:auto!important; padding:0 9px!important; gap:5px; font-size:12px!important; white-space:nowrap; }
    ${BUTTON}:focus-visible { outline:2px solid #36c5f0; outline-offset:2px; }
    [data-slack-reply-preview-collapsed], [data-slack-reply-reference-hidden] { display:none!important; }
    [data-slack-reply-context] { min-width:0; margin-bottom:3px; }
    [data-slack-reply-context-row] .c-message_kit__gutter__left {
      translate:0 var(--sqr-context-height, 24px); }
    ${PREVIEW} { display:flex; position:relative; align-items:center; gap:6px;
      width:100%; min-width:0; height:24px; box-sizing:border-box; padding:0;
      border:0; border-radius:0; background:transparent; color:inherit;
      text-align:left; font-family:inherit; font-size:13px; line-height:20px; cursor:pointer; }
    ${PREVIEW}::before { content:""; position:absolute; left:-28px; top:11px;
      width:20px; height:12px; border-top:2px solid #8887; border-left:2px solid #8887;
      border-top-left-radius:6px; pointer-events:none; }
    ${PREVIEW}:focus-visible { outline:2px solid #36c5f0; outline-offset:2px; border-radius:3px; }
    ${PREVIEW} .sqr-preview-avatar { width:16px; height:16px; border-radius:50%; object-fit:cover; flex:none; }
    ${PREVIEW} .sqr-preview-author { overflow:hidden; text-overflow:ellipsis;
      white-space:nowrap; max-width:30%; flex:0 1 auto; font-size:13px; font-weight:600; opacity:.75; }
    ${PREVIEW} .sqr-preview-text { display:block; flex:1 1 0; min-width:0; overflow:hidden;
      text-overflow:ellipsis; white-space:nowrap; font-size:13px; line-height:20px; font-weight:400; opacity:.8; }
    ${PREVIEW} .sqr-preview-action { flex:none; font-size:12px; line-height:20px; opacity:.45; }
    ${PREVIEW}:hover .sqr-preview-text, ${PREVIEW}:hover .sqr-preview-author { opacity:1; }
    #slack-quote-reply-notice { position:fixed; bottom:28px; left:50%; transform:translateX(-50%); z-index:10000;
      max-width:440px; padding:12px 18px; background:#252529; color:white; border:1px solid #777;
      border-radius:8px; box-shadow:0 3px 18px #0005; font:14px/1.4 system-ui; pointer-events:none; }
  `;
  document.head.append(style);

  function notify(message) {
    document.getElementById('slack-quote-reply-notice')?.remove();
    const notice = document.createElement('div');
    notice.id = 'slack-quote-reply-notice';
    notice.setAttribute('role', 'status');
    notice.textContent = message;
    document.body.append(notice);
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => notice.remove(), 4500);
  }

  function messageLink(row) {
    const channel = row.getAttribute('data-msg-channel-id');
    const timestamp = row.getAttribute('data-msg-ts');
    if (!/^[CDG][A-Z0-9]+$/.test(channel || '') || !/^\d+\.\d{6}$/.test(timestamp || '')) return null;
    const path = `/archives/${channel}/p${timestamp.replace('.', '')}`;
    // Only use the selected message's native timestamp link. A message body or
    // embedded preview can contain links to entirely different messages.
    for (const anchor of row.querySelectorAll('a.c-timestamp[href]')) {
      if (anchor.closest(ROW) !== row) continue;
      try {
        const url = new URL(anchor.getAttribute('href'));
        if (url.protocol === 'https:' && url.hostname.endsWith('.slack.com') &&
            !url.username && !url.password && !url.port && url.pathname === path) return url.href;
      } catch { /* Ignore missing or malformed permalinks. */ }
    }
    return null;
  }

  function resolveEditor(row) {
    // Resolve the thread first, then the main conversation. Never fall back to
    // a focused editor or another pane if the source pane's editor is absent.
    const thread = row.closest(THREAD);
    const scope = thread || row.closest(PRIMARY);
    if (!scope || (!thread && !row.closest('[data-qa="message_pane"]'))) return null;
    const scopeDialog = scope.closest('[role="dialog"]');
    const editors = [...scope.querySelectorAll(thread ? THREAD_EDITOR : EDITOR)].filter(e => {
      const dialog = e.closest('[role="dialog"]');
      return e.getClientRects().length && dialog === scopeDialog && e.closest(THREAD) === thread;
    });
    if (editors.length !== 1) return null;
    const editor = editors[0];
    const quill = editor.closest('[data-qa="message_input"]')?.__quill;
    if (!quill || quill.root !== editor || typeof quill.updateContents !== 'function' ||
        typeof quill.getContents !== 'function' || !quill.isEnabled()) return null;
    return quill;
  }

  function insertReply(quill, link) {
    if (!link) throw new Error('This message does not have a usable message link.');
    const length = quill.getLength();
    if (length + link.length + 1 > 39000) throw new Error('The reply and draft are too long for one message.');
    quill.history?.cutoff();
    // Retain the draft including its final newline and line formatting. Append
    // a compact link label with the full permalink as its target, so Slack can
    // still render its native preview on send.
    // The original final line is the answer line, above the linked message.
    quill.updateContents({ ops: [
      { retain: length },
      { insert: '↗', attributes: { link } },
      { insert: '\n' },
    ] }, 'user');
    quill.history?.cutoff();
    quill.setSelection(length - 1, 0, 'user');
    quill.focus();
  }

  function reply(row) {
    const quill = row.isConnected && resolveEditor(row);
    if (!quill) { notify('Open the reply box for this conversation or thread to reply to a message.'); return; }
    try { insertReply(quill, messageLink(row)); }
    catch (error) { notify(error.message); }
  }

  function previewContent(card) {
    const author = card.querySelector('[data-qa="message_attachment_author_name"]')?.textContent.trim() || 'Message';
    const header = card.firstElementChild;
    const context = header?.querySelector('[class*="context__"]')?.textContent.trim() || '';
    const timestamp = header?.querySelector('[data-qa="attachment-footer-timestamp"]')?.textContent.trim() || '';
    const body = card.querySelector('[data-qa="message_attachment_slack_msg_text"]');
    // Keep this summary plain text. Never duplicate native interactive controls,
    // links or mentions into the toggle button. Expanded mode uses the real card.
    const blocks = new Set(['DIV', 'P', 'LI', 'BLOCKQUOTE', 'PRE', 'UL', 'OL']);
    function read(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      if (node.tagName === 'IMG') return node.getAttribute('alt') || '';
      if (node.tagName === 'BR') return '\n';
      if (['BUTTON', 'SCRIPT', 'STYLE'].includes(node.tagName) || node.getAttribute('aria-hidden') === 'true') return '';
      let value = '';
      for (const child of node.childNodes) {
        if (blocks.has(child.nodeName) && value && !value.endsWith('\n')) value += '\n';
        value += read(child);
        if (blocks.has(child.nodeName) && !value.endsWith('\n')) value += '\n';
      }
      return value;
    }
    const text = (body && read(body).replace(/\n\s*\n/g, '\n').trim()) || 'Open message preview';
    const avatar = header?.querySelector('img')?.getAttribute('src') || '';
    const sourceLink = header?.querySelector('a[href]')?.getAttribute('href') || '';
    return { author, context, timestamp, text, avatar, sourceLink };
  }

  function setPreviewExpanded(card, button, expanded) {
    card.toggleAttribute('data-slack-reply-preview-collapsed', !expanded);
    previews.get(card)?.shell.toggleAttribute('data-slack-reply-preview-collapsed', !expanded);
    button.setAttribute('aria-expanded', String(expanded));
    button.querySelector('.sqr-preview-action').textContent = expanded ? '▴' : '▾';
    button.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} reply from ${button.dataset.previewAuthor}: ${button.querySelector('.sqr-preview-text').textContent.slice(0, 300)}`);
  }

  function restorePreview(card, entry) {
    card.removeAttribute('data-slack-reply-preview-collapsed');
    entry.shell.removeAttribute('data-slack-reply-preview-collapsed');
    entry.references.forEach(element => element.removeAttribute('data-slack-reply-reference-hidden'));
    entry.button.remove();
  }

  function updatePreviewReferences(entry, sourceLink) {
    // The tiny source link stays in the sent message. Hide only its redundant
    // local display, and only when its URL matches this preview exactly.
    entry.references.forEach(element => element.removeAttribute('data-slack-reply-reference-hidden'));
    entry.references = [];
    for (const anchor of entry.row.querySelectorAll('[data-qa="message-text"] a[href]')) {
      if (anchor.closest(ROW) !== entry.row || anchor.closest(CARD) || anchor.textContent.trim() !== '↗' ||
        anchor.getAttribute('href') !== sourceLink) continue;
      const line = anchor.closest('.p-rich_text_section, p');
      const element = line?.textContent.trim() === '↗' ? line : anchor;
      element.dataset.slackReplyReferenceHidden = 'true';
      entry.references.push(element);
    }
  }

  function mountPreviews() {
    for (const [card, entry] of previews) {
      if (!card.isConnected || !entry.button.isConnected || card.closest(ROW) !== entry.row) {
        restorePreview(card, entry);
        previews.delete(card);
      }
    }
    for (const [row, group] of previewGroups) {
      if (!row.isConnected || !group.childElementCount) {
        group.remove();
        row.removeAttribute('data-slack-reply-context-row');
        row.style.removeProperty('--sqr-context-height');
        previewGroups.delete(row);
      }
    }
    for (const card of document.querySelectorAll(CARD)) {
      // Place context above the replying author's name without moving Slack's
      // React-owned card. Leave other preview types and unsupported views alone.
      const row = card.closest(ROW);
      const host = row && [...row.querySelectorAll('[data-qa="message_content"]')]
        .find(element => element.closest(ROW) === row && !element.closest(CARD));
      const scope = row?.closest(THREAD) || row?.closest(PRIMARY);
      // Slack can mark the main conversation itself as a dialog. Exclude only
      // dialogs nested inside that pane, matching the composer routing rule.
      if (!host || !scope || (!row.closest(THREAD) && !row.closest('[data-qa="message_pane"]')) ||
          card.closest('[role="dialog"]') !== scope.closest('[role="dialog"]')) continue;
      const content = previewContent(card);
      const signature = JSON.stringify(content);
      let entry = previews.get(card);
      if (entry?.signature === signature) {
        updatePreviewReferences(entry, content.sourceLink);
        continue;
      }
      const expanded = entry?.sourceLink === content.sourceLink && entry.button.getAttribute('aria-expanded') === 'true';
      if (!entry) {
        let group = previewGroups.get(row);
        if (!group) {
          group = document.createElement('div');
          group.dataset.slackReplyContext = 'true';
          host.prepend(group);
          previewGroups.set(row, group);
          row.dataset.slackReplyContextRow = 'true';
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.slackReplyPreviewToggle = 'true';
        group.append(button);
        row.style.setProperty('--sqr-context-height', `${group.childElementCount * 24 + 3}px`);
        entry = { button, row, references: [], shell: card.closest('[data-qa="message_attachment_default"]') || card };
        previews.set(card, entry);
        previewCards.set(button, card);
      }
      entry.signature = signature;
      entry.sourceLink = content.sourceLink;
      const { button } = entry;
      button.dataset.previewAuthor = content.author;
      button.title = [content.context, content.timestamp, 'Click to expand or collapse'].filter(Boolean).join(' · ');
      const span = (className, text) => {
        const element = document.createElement('span');
        element.className = className;
        element.textContent = text;
        return element;
      };
      button.replaceChildren();
      if (content.avatar) {
        const avatar = document.createElement('img');
        avatar.className = 'sqr-preview-avatar';
        avatar.src = content.avatar;
        avatar.alt = '';
        button.append(avatar);
      }
      button.append(span('sqr-preview-author', content.author),
        span('sqr-preview-text', content.text.replace(/\s+/g, ' ')), span('sqr-preview-action', ''));
      updatePreviewReferences(entry, content.sourceLink);
      setPreviewExpanded(card, button, !!expanded);
    }
  }

  function mount() {
    frame = 0;
    if (disposed) return;
    mountPreviews();
    for (const bar of document.querySelectorAll(BAR)) {
      if (bar.querySelector(BUTTON)) continue;
      const row = bar.closest(ROW);
      if (!row || !messageLink(row) || !resolveEditor(row)) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.slackQuoteReply = 'true';
      button.className = 'c-button-unstyled c-icon_button c-icon_button--size_smedium c-message_actions__button c-icon_button--default';
      const destination = row.closest(THREAD) ? 'thread' : 'conversation';
      button.setAttribute('aria-label', `Reply with message preview in ${destination}`);
      button.title = `Reply with message preview in ${destination}`;
      button.textContent = '❝ Reply';
      bar.prepend(button);
    }
  }

  const observer = new MutationObserver(records => {
    if (frame || disposed) return;
    const relevant = records.some(record => {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (target?.closest(PREVIEW)) return false;
      if (target?.closest(CARD)) return true;
      if (target?.closest('[data-qa="message-text"]')?.closest(ROW)?.querySelector(CARD)) return true;
      if (target?.matches(BAR)) return true;
      if ([...record.removedNodes].some(node => node instanceof Element &&
        (node.matches(`${CARD}, ${PREVIEW}, [data-slack-reply-context]`) || node.querySelector(CARD)))) return true;
      return [...record.addedNodes].some(node => node instanceof Element &&
        !node.matches(`${BUTTON}, ${PREVIEW}`) && (node.matches(`${BAR}, ${EDITOR}, ${THREAD_EDITOR}, ${CARD}`) ||
          node.querySelector(`${BAR}, ${EDITOR}, ${THREAD_EDITOR}, ${CARD}`)));
    });
    if (relevant) frame = requestAnimationFrame(mount);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['href', 'src'] });
  // Capture the compact button before Slack's card/container click handlers.
  // Native links and buttons in an expanded card keep their normal behavior.
  document.addEventListener('click', event => {
    const button = event.target instanceof Element && event.target.closest(PREVIEW);
    if (!button) return;
    const card = previewCards.get(button);
    if (!card?.isConnected || previews.get(card)?.button !== button) return;
    event.preventDefault();
    event.stopPropagation();
    setPreviewExpanded(card, button, button.getAttribute('aria-expanded') !== 'true');
  }, { capture: true, signal: cleanups.signal });
  // Delegate listeners so discarded virtualized messages are not retained.
  document.addEventListener('mousedown', event => {
    if (event.target instanceof Element && event.target.closest(BUTTON)) event.preventDefault();
  }, { signal: cleanups.signal });
  document.addEventListener('click', event => {
    const button = event.target instanceof Element && event.target.closest(BUTTON);
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const row = button.closest(ROW);
    if (row) reply(row);
  }, { signal: cleanups.signal });
  window[KEY] = {
    version: VERSION,
    // Exposed locally for deterministic verification without sending messages.
    messageLink, insertReply, resolveEditor,
    dispose() {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(noticeTimer);
      cleanups.abort();
      for (const [card, entry] of previews) restorePreview(card, entry);
      previews.clear();
      for (const [row, group] of previewGroups) {
        group.remove();
        row.removeAttribute('data-slack-reply-context-row');
        row.style.removeProperty('--sqr-context-height');
      }
      previewGroups.clear();
      document.querySelectorAll(BUTTON).forEach(button => button.remove());
      document.getElementById('slack-quote-reply-notice')?.remove();
      style.remove();
      delete window[KEY];
    },
  };
  mount();
})();
