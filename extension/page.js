/* Isolated-world page adapter. Only rendered page elements supply question data. */
(() => {
  if (globalThis.__iclickerBot?.version === '1.3.0') return;
  let selectorErrors = [];
  const visible = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none' && !e.closest('[aria-hidden="true"]') && (typeof e.checkVisibility!=='function'||e.checkVisibility({opacityProperty:true,visibilityProperty:true}));
  const text = e => (e?.innerText || '').trim() || (e?.getAttribute('aria-label') || e?.getAttribute('title') || '').trim();
  const enabled = e => !e.disabled && e.getAttribute('aria-disabled') !== 'true';
  const find = selector => {try{return selector ? [...document.querySelectorAll(selector)].filter(visible) : [];}catch{selectorErrors.push('A configured selector is invalid.');return [];}};
  const unique = selector => { const all = find(selector); return all.length === 1 ? all[0] : null; };
  function path(e) {
    if (!e) return '';
    const parts = [];
    while (e && e !== document.documentElement) {
      let index = 1;
      for (let previous = e.previousElementSibling; previous; previous = previous.previousElementSibling) if (previous.tagName === e.tagName) index++;
      parts.unshift(`${e.tagName.toLowerCase()}:nth-of-type(${index})`);
      e = e.parentElement;
    }
    return 'html > ' + parts.join(' > ');
  }
  function label(e) {
    if (e.labels?.length) return [...e.labels].map(text).join('\n');
    const ref = e.getAttribute('aria-labelledby');
    if (ref) return ref.split(/\s+/).map(id => text(document.getElementById(id))).join(' ');
    return text(e) || e.getAttribute('aria-label') || '';
  }
  function frameIsVisible() {
    if(typeof window==='undefined')return true;
    try{let current=window;while(current!==current.top){if(!current.frameElement||!visible(current.frameElement))return false;current=current.parent;}return true;}catch{return false;}
  }
  function read(selectors = {}) {
    selectorErrors = [];
    const recoveredSelectors=[];
    const body = document.body?.innerText || '';
    const buttons = find('button, [role="button"], input[type="submit"], a');
    const named = pattern => buttons.filter(e => pattern.test(text(e) || e.value || ''));
    const one = elements => elements.length === 1 ? elements[0] : null;
    const select = (key, fallback) => {
      if(!selectors[key])return fallback();
      const matches=find(selectors[key]);
      if(matches.length===1)return matches[0];
      if(matches.length>1){selectorErrors.push(`The configured ${key} selector matches multiple visible elements.`);return null;}
      if(selectorErrors.length)return null;
      const replacement=fallback();
      if(replacement)recoveredSelectors.push(key);
      return replacement;
    };
    const join = select('join', () => unique('#btnJoin') || one(named(/^(?:join(?: (?:the )?(?:class|session|poll))?(?: now)?|join live (?:class|session))$/i)));
    const submitCandidates = named(/^(submit(?: (?:answer|response))?|send (?:answer|response))$/i);
    const submit = select('submit', () => one(submitCandidates));
    const input = select('textInput', () => one(find('main input[type="text"], main input[type="number"], main textarea, [role="main"] input[type="text"], [role="main"] textarea, .polling-page-wrapper input[type="text"], .polling-page-wrapper input[type="number"], .polling-page-wrapper input[type="tel"], .polling-page-wrapper textarea')));
    const questionNode = select('question', () => {
      const known=find('[data-testid="question-text"], [data-question-text], .question-text, .question-body, .question-content, #question-text');
      if(known.length===1)return known[0];
      if(known.length>1){const leaves=known.filter(node=>!known.some(other=>other!==node&&node.contains?.(other)));return one(leaves);}
      return unique('[aria-label="Question text"], [aria-label="Current question"], [data-test="question-text"], [data-testid="question-stem"]');
    });
    let question = text(questionNode);
    if (/^question\s*\d*[:.]?$/i.test(question) || /^(?:hidden by instructor|question (?:is )?hidden)$/i.test(question)) question = '';
    const heading = find('h1,h2,h3,[data-question-id]').find(e => /^question\s+\d+/i.test(text(e)));
    const idNode = selectors.questionId ? unique(selectors.questionId) : heading;
    const questionId = idNode?.getAttribute('data-question-id') || text(idNode);
    const pollingRegions=find('.polling-page-wrapper, [data-testid="poll-question"], [data-testid="active-question"], [role="region"][aria-label="Current question"]');
    const knownPollRoute=/#\/polling(?:[/?]|$)|\/poll(?:\/|[?#]|$)|\/question\/[^/]+/i.test(location.href);
    const explicitSingleType=/(?:^|\n)\s*Multiple Choice\s*(?:\n|$)/i.test(body);
    const iclickerPoll = location.origin === 'https://student.iclicker.com' && (find('.polling-page-wrapper').length === 1 || pollingRegions.length===1 || (knownPollRoute&&!!heading&&explicitSingleType));
    const radios = find('input[type="radio"], [role="radio"]');
    const checks = find('main input[type="checkbox"], [role="main"] input[type="checkbox"], [role="checkbox"][data-option], .polling-page-wrapper input[type="checkbox"]');
    let optionsNodes = selectors.options ? find(selectors.options) : radios.length ? radios : checks;
    if (!optionsNodes.length && !selectors.options) optionsNodes = buttons.filter(e => /^(?:[A-E]|[A-E][.)]\s+.+)$/.test(text(e)));
    if (!optionsNodes.length && !selectors.options && iclickerPoll) optionsNodes = find('.polling-page-wrapper .btn-container > *').filter(e => /^[A-E]$/.test(label(e)));
    const options = optionsNodes.map((e, i) => ({id: `option-${i + 1}`, text: label(e), selector: path(e), enabled: enabled(e)}));
    const multi = optionsNodes.some(e => e.type === 'checkbox' || e.getAttribute('role') === 'checkbox');
    const inputKind = options.length ? (multi ? 'multiple' : 'single') : input ? 'text' : 'unknown';
    const imageNodes = find('.question-image-container img, [data-testid="question-image"], [data-question-image], img[alt="Question image"]');
    const hiddenImage = imageNodes.some(e => /image_hidden|hidden[_ -]?by[_ -]?instructor/i.test((e.currentSrc || e.getAttribute('src') || '') + ' ' + (e.getAttribute('alt') || '')));
    const sharedImages = imageNodes.filter(e => !/image_hidden|hidden[_ -]?by[_ -]?instructor/i.test((e.currentSrc || e.getAttribute('src') || '') + ' ' + (e.getAttribute('alt') || '')) && e.complete && e.naturalWidth >= 120 && e.naturalHeight >= 60);
    const questionImage = iclickerPoll && sharedImages.length === 1 ? {source:sharedImages[0].currentSrc || sharedImages[0].getAttribute('src'),alt:sharedImages[0].getAttribute('alt') || ''} : null;
    const questionSource = question ? 'text' : questionImage ? 'visible_image' : 'absent';
    const contentLoading=questionSource==='absent'&&imageNodes.some(image=>image.complete===false);
    const figures = find('main img, main svg, main canvas, [role="main"] img, [role="main"] svg, [role="main"] canvas, .question-content img, [data-question-text] img, .question-image-container img')
      .filter(e => !e.closest('nav,header,footer,[class*="cookie"],#onetrust-consent-sdk'))
      .map(e => ({type: e.tagName.toLowerCase(), alt: e.getAttribute('alt') || e.getAttribute('aria-label') || '', source: e.currentSrc || e.getAttribute('src') || '', width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height}));
    let state = 'unknown';
    const active = selectors.active ? !!unique(selectors.active) : /(?:waiting for (?:the )?(?:next question|instructor)|please wait for your instructor|you['’]re (?:connected|checked in)|class (?:is )?in (?:session|progress)|poll (?:is )?(?:open|in progress))/i.test(body);
    const ended = selectors.ended ? !!unique(selectors.ended) : /(?:class (?:has )?ended|session (?:has )?ended)/i.test(body);
    const pollClosed = /(?:poll (?:is )?closed|polling (?:has )?(?:stopped|ended))/i.test(body);
    const submitted = selectors.submitted ? !!unique(selectors.submitted) : /(?:answer (?:has been |was )?(?:submitted|recorded|received)|response (?:has been |was )?(?:submitted|recorded|received)|successfully submitted)/i.test(body);
    const history = /return to class history|total questions\s*:/i.test(body);
    const login = !!find('input[type="password"]').length || /\/(?:login|signin|sign-in)(?:[/?#]|$)/i.test(location.href);
    const failed = /(?:access denied|session expired|unable to (?:connect|load)|something went wrong|connection lost)/i.test(body);
    if (login) state = 'login';
    else if (failed) state = 'error';
    else if (join) state = 'join';
    else if (history) state = 'history';
    else if (ended) state = 'ended';
    else if (submitted) state = 'submitted';
    else if (pollClosed) state = 'waiting';
    else if (submit || input || options.length || questionNode) state = 'question';
    else if (active) state = 'waiting';
    else if (/class (?:has )?not started|no (?:active |live )?(?:class|session)|waiting for (?:the )?class|not in session/i.test(body) || (location.origin === 'https://student.iclicker.com' && /#\/courses\/[^/]+\/tab\/default/.test(location.href) && find('.course-wrapper').length)) state = 'idle';
    let problem = '';
    if (state === 'login') problem = 'iClicker login is required. Sign in in the selected Edge tab.';
    if (state === 'error') problem = 'iClicker reports a connection or access failure. Check the selected tab.';
    if (state === 'question' && questionSource === 'absent') problem = hiddenImage ? 'The instructor has hidden the question image. No question text is available; no answer will be guessed.' : 'The complete visible question text is absent or not identified. Please inspect the tab and configure the question selector. No answer will be guessed.';
    if (questionNode && (questionNode.scrollHeight > questionNode.clientHeight + 4) && getComputedStyle(questionNode).overflowY !== 'visible') problem = 'Question text is clipped in a scrollable region. Expand it before answering.';
    if(selectorErrors.length)problem=selectorErrors.join(' ');
    // A disabled Submit before selection is normal. It must become enabled
    // after the answer is entered, before act() can click it.
    const letterLabels = options.map(o => o.text);
    // Official iClicker single-choice UI submits on selecting a letter. Only use
    // this mode on the recognized polling wrapper with an explicit question type.
    const implicitSingle = !submit && !submitCandidates.length && !selectorErrors.length && iclickerPoll && explicitSingleType && inputKind === 'single' && !input && options.length >= 2 && options.length <= 5 && letterLabels.every(t => /^[A-E]$/.test(t)) && new Set(letterLabels).size === options.length;
    if(implicitSingle&&selectors.submit)recoveredSelectors.push('submit mode');
    const submitMode = submit ? 'explicit' : implicitSingle ? 'choice_click' : 'unclear';
    const controlsClear = frameIsVisible() && !selectorErrors.length && (submitMode !== 'unclear') && ((options.length > 0 && options.every(o => o.text && o.enabled) && !input) || (inputKind === 'text' && enabled(input)));
    const timer = one(find('[role="timer"], [data-testid="poll-timer"], .poll-timer'));
    const timing = text(timer).match(/^(?:(\d{1,2}):)?(\d{1,2})(?:\s*(?:s|seconds?))?$/i) || body.match(/time (?:remaining|left)\s*:?\s*(?:(\d{1,2}):)?(\d{1,2})(?:\s*(?:s|seconds?))?/i);
    const remainingSeconds = timing ? Number(timing[1]||0)*60+Number(timing[2]) : null;
    // All rendered question text is passed without truncation. Do not include unrelated history/sidebar text.
    const context = questionNode?.closest('main,[role="main"],article') || questionNode;
    const visibleText = context ? text(context) : question;
    return {state, question, questionSource, questionImage, questionId, options, inputKind, figures, visibleText, controlsClear, submitMode,remainingSeconds,recoveredSelectors,contentLoading,frameVisible:frameIsVisible(),
      submitSelector: path(submit), inputSelector: path(input), joinSelector: path(join),
      url: location.href, sessionId: location.origin + location.pathname + location.hash.split('/questions')[0], problem,
      documentWidth: Math.max(document.documentElement.scrollWidth, innerWidth), documentHeight: Math.max(document.documentElement.scrollHeight, innerHeight)};
  }
  const identity = snapshot => ({sessionId:snapshot.sessionId, questionId:snapshot.questionId,
    question:snapshot.question, options:snapshot.options.map(o=>({id:o.id,text:o.text})),
    inputKind:snapshot.inputKind, questionSource:snapshot.questionSource, questionImage:snapshot.questionImage, figures:snapshot.figures.map(figure=>({type:figure.type,alt:figure.alt,source:figure.source})), join:snapshot.state === 'join'});
  const semantic = snapshot => JSON.stringify({identity:identity(snapshot),state:snapshot.state,problem:snapshot.problem,controlsClear:snapshot.controlsClear,submitMode:snapshot.submitMode});
  let lastSelectors = {};
  let lastSemantic = '';
  async function fingerprint(snapshot) {
    const bytes = new TextEncoder().encode(JSON.stringify(identity(snapshot)));
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  async function capture(selectors) {
    lastSelectors = selectors || {};
    const snapshot = read(selectors);
    lastSemantic = semantic(snapshot);
    snapshot.fingerprint = await fingerprint(snapshot);
    return snapshot;
  }
  async function act(command, selectors) {
    const before = await capture(selectors);
    if(before.frameVisible===false)throw Error('The question frame is no longer visible. No action was taken.');
    if (before.fingerprint !== command.fingerprint) throw Error('Question changed while the solver was working. The old answer was discarded.');
    if (command.kind === 'join') {
      if (before.state !== 'join' || !before.joinSelector) throw Error('The class join control is no longer clear.');
      const join = unique(before.joinSelector);
      if (!join || !enabled(join)) throw Error('The class join button is unavailable.');
      join.click();
      return {phase:'join', fingerprint: before.fingerprint};
    }
    const randomFallback = command.random_fallback === true && before.inputKind === 'single' && before.options.length >= 2;
    if (before.state !== 'question' || (!randomFallback && ((!before.question && before.questionSource !== 'visible_image') || before.problem)) || !before.controlsClear) throw Error('Question text or submission controls are no longer clear.');
    const answer = command.answer;
    if (before.inputKind === 'text') {
      if (answer.option_ids.length || !answer.text_answer.trim()) throw Error('Invalid text answer.');
      const input = unique(before.inputSelector);
      if (!input || !enabled(input)) throw Error('Text answer input is unavailable.');
      const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, answer.text_answer);
      input.dispatchEvent(new Event('input', {bubbles:true}));
      input.dispatchEvent(new Event('change', {bubbles:true}));
      if (input.value !== answer.text_answer) throw Error('The page did not accept the text answer.');
    } else {
      const ids = answer.option_ids;
      if (!ids.length || new Set(ids).size !== ids.length || (before.inputKind === 'single' && ids.length !== 1) || answer.text_answer) throw Error('Invalid choice answer.');
      if (ids.some(id=>!before.options.some(o=>o.id===id))) throw Error('The answer refers to an option that is not visible.');
      if (before.submitMode === 'choice_click') {
        // This click IS submission. Do not click any other option or hunt for a
        // second button. background.js must verify the page's acknowledgment.
        const current = read(selectors);
        if (JSON.stringify(identity(current)) !== JSON.stringify(identity(before)) || current.state !== 'question' || (!randomFallback && current.problem) || !current.controlsClear || current.submitMode !== 'choice_click') throw Error('Question changed immediately before the answer click. Nothing was submitted.');
        const option = current.options.find(o=>o.id===ids[0]);
        const node = unique(option.selector);
        if (!node || !enabled(node) || label(node) !== option.text) throw Error('The single-choice answer control changed.');
        node.click();
        return {phase:'answer',fingerprint:before.fingerprint,submitMode:'choice_click'};
      }
      for (const option of before.options) {
        const node = unique(option.selector);
        if (!node || !enabled(node)) throw Error('An answer option is no longer available.');
        const selected = !!node.checked || node.getAttribute('aria-checked') === 'true' || node.getAttribute('aria-pressed') === 'true';
        const wanted = ids.includes(option.id);
        if ((before.inputKind === 'multiple' && selected !== wanted) || (before.inputKind === 'single' && wanted && !selected)) node.click();
      }
    }
    // Give framework bindings a render turn, then check identity and selected values again.
    await new Promise(resolve=>setTimeout(resolve, 80));
    const after = await capture(selectors);
    if (after.fingerprint !== command.fingerprint || after.state !== 'question' || !after.controlsClear || (!randomFallback && after.problem)) throw Error('Question or controls changed during answer entry. Submission status needs verification.');
    if (after.inputKind !== 'text') {
      for (const option of after.options) {
        const node = unique(option.selector);
        const selected = !!node?.checked || node?.getAttribute('aria-checked') === 'true' || node?.getAttribute('aria-pressed') === 'true' || node?.classList.contains('selected');
        if (selected !== answer.option_ids.includes(option.id)) throw Error('The selected choices could not be verified. Please inspect the tab.');
      }
    }
    const current = read(selectors);
    if (JSON.stringify(identity(current)) !== JSON.stringify(identity(before)) || current.state !== 'question' || (!randomFallback && current.problem) || !current.controlsClear) throw Error('Question changed immediately before submission. Nothing was submitted.');
    if (current.inputKind === 'text' && unique(current.inputSelector)?.value !== answer.text_answer) throw Error('Text input changed before submission. Nothing was submitted.');
    const submit = unique(current.submitSelector);
    if (!submit || !enabled(submit)) throw Error('Submission control is unavailable.');
    submit.click();
    return {phase:'answer', fingerprint: before.fingerprint};
  }
  globalThis.__iclickerBot = {version:'1.3.0',capture, act};
  // DOM/route changes supplement the three-second timer. Semantic comparison
  // ignores unrelated countdown ticks and cookie-banner updates.
  if (typeof MutationObserver !== 'undefined' && globalThis.chrome?.runtime) {
    let debounce;
    const wake = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        try {
          const next = semantic(read(lastSelectors));
          if (next !== lastSemantic) {
            lastSemantic = next;
            chrome.runtime.sendMessage({type:'page-changed'}).catch(()=>{});
          }
        } catch { chrome.runtime.sendMessage({type:'page-changed'}).catch(()=>{}); }
      },200);
    };
    new MutationObserver(wake).observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class','style','hidden','src','disabled','aria-disabled']});
    addEventListener('hashchange',wake);
    addEventListener('popstate',wake);
    addEventListener('load',wake,true);
  }
})();
