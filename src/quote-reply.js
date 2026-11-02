(() => {
  'use strict';
  const KEY = '__slackQuoteReply';
  const VERSION = '1.2.1';
  if (window[KEY]?.version === VERSION) return;
  window[KEY]?.dispose();

  const ROW = '[data-qa="message_container"]';
  const BAR = '[data-qa="message-actions"]';
  const BUTTON = '[data-slack-quote-reply]';
  const PRIMARY = '.p-view_contents--primary';
  const THREAD = '[data-qa="threads_flexpane"]';
  const EDITOR = '[data-qa="message_input_container"] [data-qa="texty_input"][contenteditable="true"]';
  const THREAD_EDITOR = '[data-qa="reply_container"] [data-qa="texty_input"][contenteditable="true"]';
  const cleanups = new AbortController();
  let frame = 0;
  let noticeTimer;
  let disposed = false;

  const style = document.createElement('style');
  style.id = 'slack-quote-reply-style';
  style.textContent = `
    ${BUTTON} { width:auto!important; padding:0 9px!important; gap:5px; font-size:12px!important; white-space:nowrap; }
    ${BUTTON}:focus-visible { outline:2px solid #36c5f0; outline-offset:2px; }
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

  function mount() {
    frame = 0;
    if (disposed) return;
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
      if (record.target instanceof Element && record.target.matches(BAR)) return true;
      return [...record.addedNodes].some(node => node instanceof Element &&
        !node.matches(BUTTON) && (node.matches(`${BAR}, ${EDITOR}, ${THREAD_EDITOR}`) ||
          node.querySelector(`${BAR}, ${EDITOR}, ${THREAD_EDITOR}`)));
    });
    if (relevant) frame = requestAnimationFrame(mount);
  });
  observer.observe(document.body, { childList: true, subtree: true });
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
      document.querySelectorAll(BUTTON).forEach(button => button.remove());
      document.getElementById('slack-quote-reply-notice')?.remove();
      style.remove();
      delete window[KEY];
    },
  };
  mount();
})();
