(() => {
  const api = window.__slackQuoteReply;
  const results = [];
  function check(name, condition) { if (!condition) throw new Error(name); results.push(name); }
  const button = document.querySelector('[data-slack-quote-reply]');
  check('Button inserted into native hover toolbar', !!button);
  const row = button.closest('[data-qa="message_container"]');
  const live = api.resolveEditor(row);
  const link = api.messageLink(row);
  check('Selected message resolves to its native permalink', link === row.querySelector('a.c-timestamp').href);
  const original = JSON.stringify(live.getContents());
  const selection = live.getSelection();
  const focus = document.activeElement;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;width:300px;top:0';
  document.body.append(host);
  try {
    const q = new live.constructor(host, { modules: { toolbar: false }, formats: live.options.formats });
    api.insertReply(q, link);
    check('Reply starts with an empty answer line above the message link', q.getText() === '\n↗\n');
    check('Compact arrow link retains the complete message URL and thread context',
      q.root.querySelector('a')?.getAttribute('href') === link && q.root.querySelector('a')?.textContent === '↗');
    check('Answer caret is on the first unlinked, unquoted line', q.getSelection().index === 0 &&
      !q.getFormat(0).link && !q.getFormat(0).blockquote);
    q.insertText(0, 'My answer', 'user');
    check('Typing an answer does not turn it into a link', !q.getFormat(0, 9).link && q.getText() === 'My answer\n↗\n');
    q.history.undo();
    q.history.undo();
    check('One undo removes the inserted reply link after undoing typing', q.getText() === '\n');

    const draft = { ops: [
      { insert: 'Existing answer', attributes: { bold: true } },
      { insert: '\n' },
      { insert: 'Existing link', attributes: { link: 'https://example.com/' } },
      { insert: '\n', attributes: { blockquote: true } },
    ] };
    q.setContents(draft, 'silent');
    q.history.clear();
    const canonicalDraft = JSON.stringify(q.getContents());
    const length = q.getLength();
    api.insertReply(q, link);
    check('Complete formatted draft remains unchanged above the link', JSON.stringify(q.getContents(0, length)) === canonicalDraft);
    check('Caret returns to the end of the existing answer', q.getSelection().index === length - 1);
    check('Message link stays outside draft blockquote formatting', !q.getFormat(length, 1).blockquote);
    q.history.undo();
    check('Single undo restores the exact formatted draft', JSON.stringify(q.getContents()) === canonicalDraft);

    q.setText('x'.repeat(39000), 'silent');
    const oversized = JSON.stringify(q.getContents());
    let rejected = false;
    try { api.insertReply(q, link); } catch { rejected = true; }
    check('Oversized replies fail without changing the draft', rejected && JSON.stringify(q.getContents()) === oversized);

    const fixture = document.createElement('div');
    fixture.dataset.qa = 'message_container';
    fixture.dataset.msgChannelId = 'C123';
    fixture.dataset.msgTs = '1793636117.494059';
    const expected = 'https://example.slack.com/archives/C123/p1793636117494059?thread_ts=1793634669.925859&cid=C123';
    fixture.innerHTML = `<a href="${expected}">Body link</a><a class="c-timestamp" href="https://example.slack.com/archives/C123/p1793634669925859">Embedded preview timestamp</a>`;
    check('Body and other-message preview links are never selected', api.messageLink(fixture) === null);
    const timestamp = document.createElement('a');
    timestamp.className = 'c-timestamp';
    timestamp.href = expected;
    fixture.append(timestamp);
    check('Exact message identity and thread query are preserved', api.messageLink(fixture) === expected);
    for (const invalid of [expected.replace('example.slack.com', 'slack.com.attacker.test'), expected.replace('https:', 'http:'), 'javascript:alert(1)']) {
      timestamp.setAttribute('href', invalid);
      check(`Invalid permalink rejected: ${new URL(invalid).protocol} ${new URL(invalid).hostname}`, api.messageLink(fixture) === null);
    }
    timestamp.href = expected;
    fixture.removeAttribute('data-msg-ts');
    check('Missing source identity cannot select an unrelated link', api.messageLink(fixture) === null);
    check('Real conversation draft remains unchanged', JSON.stringify(live.getContents()) === original);
    return { passed: results };
  } finally {
    host.remove();
    if (focus instanceof HTMLElement) focus.focus();
    if (selection) live.setSelection(selection, 'silent');
  }
})()
