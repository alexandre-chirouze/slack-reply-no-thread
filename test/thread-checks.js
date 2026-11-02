(() => {
  const results = [];
  const check = (name, passed) => { if (!passed) throw new Error(name); results.push(name); };
  const api = window.__slackQuoteReply;
  const thread = document.querySelector('[data-qa="threads_flexpane"]');
  const threadRow = thread?.querySelector('[data-qa="message_container"]');
  const mainRow = document.querySelector('.p-view_contents--primary [data-qa="message_pane"] [data-qa="message_container"]');
  check('Main conversation and thread are both present', !!threadRow && !!mainRow);
  const mainEditor = api.resolveEditor(mainRow);
  const threadEditor = api.resolveEditor(threadRow);
  check('Thread resolves to its own reply composer', !!threadEditor &&
    threadEditor.root.closest('[data-qa="threads_flexpane"]') === thread);
  check('Main conversation remains routed to its own composer', !!mainEditor && mainEditor !== threadEditor &&
    !mainEditor.root.closest('[data-qa="threads_flexpane"]'));
  check('Thread toolbar offers the quote button', !!thread.querySelector('[data-slack-quote-reply][aria-label="Reply with message preview in thread"]'));

  // A thread without a reply composer must not fall through to the main draft.
  const fixture = document.createElement('div');
  fixture.dataset.qa = 'threads_flexpane';
  const row = document.createElement('div');
  row.dataset.qa = 'message_container';
  fixture.append(row);
  const main = mainRow.closest('.p-view_contents--primary');
  main.append(fixture);
  try { check('Missing thread composer never falls back to the main draft', api.resolveEditor(row) === null); }
  finally { fixture.remove(); }
  return { passed: results };
})()
