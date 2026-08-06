(function () {
  const root = document.getElementById('quizBuilderCard');
  if (!root || !LECTURER_TOKEN) return;

  const state = {
    questions: [],
    modules: [],
    draftId: null,
    dirty: false,
    previewUrls: [],
  };

  const byId = id => document.getElementById(id);
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `q-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const html = value => String(value ?? '').replace(/[&<>]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[character]));
  const attr = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

  function blankQuestion(type = 'mcq') {
    return {
      key: uid(), type, question: '', marks: 1,
      options: type === 'mcq' ? ['', ''] : [],
      correctIndex: -1, correct_answer: '', image_url: '', file: null,
    };
  }

  function normalizeQuestion(question = {}) {
    const type = ['mcq', 'short', 'long'].includes(question.type) ? question.type : 'mcq';
    const options = type === 'mcq' ? [...(question.options || [])].map(String) : [];
    while (type === 'mcq' && options.length < 2) options.push('');
    const correctAnswer = String(question.correct_answer ?? question.answer ?? '');
    return {
      key: uid(),
      type,
      question: String(question.question || ''),
      marks: Number(question.marks) > 0 ? Number(question.marks) : 1,
      options,
      correctIndex: type === 'mcq' && correctAnswer ? options.findIndex(option => option === correctAnswer) : -1,
      correct_answer: type === 'short' ? correctAnswer : '',
      image_url: String(question.image_url || question.image || ''),
      file: null,
    };
  }

  function currentCorrectAnswer(question) {
    return question.type === 'mcq'
      ? String(question.options[question.correctIndex] || '').trim()
      : question.type === 'short' ? String(question.correct_answer || '').trim() : '';
  }

  function questionPayload(question) {
    return {
      type: question.type,
      question: String(question.question || '').trim(),
      options: question.type === 'mcq' ? question.options.map(option => String(option).trim()).filter(Boolean) : [],
      correct_answer: currentCorrectAnswer(question),
      marks: Number(question.marks) || 0,
      image_url: String(question.image_url || '').trim(),
    };
  }

  function showBuilderMessage(text, kind = 'ok') {
    const box = byId('builderMsg');
    box.replaceChildren();
    const message = document.createElement('div');
    message.className = `msg ${kind}`;
    message.textContent = text;
    box.appendChild(message);
  }

  function setDirty(dirty = true) {
    state.dirty = dirty;
    if (dirty) byId('quizDraftStatus').textContent = 'Unsaved changes';
  }

  function updateSummary() {
    const count = state.questions.length;
    const total = state.questions.reduce((sum, question) => sum + (Number(question.marks) || 0), 0);
    byId('builderQuestionCount').textContent = `${count} question${count === 1 ? '' : 's'}`;
    byId('builderTotalMarks').textContent = `${Number(total.toFixed(2))} total mark${total === 1 ? '' : 's'}`;
  }

  function typeFields(question) {
    if (question.type === 'mcq') {
      return `<div class="question-type-fields"><label>Answer options <span class="muted">— select the correct one</span></label><div class="question-options">${question.options.map((option, index) => `<div class="question-option"><input type="radio" name="correct-${attr(question.key)}" data-correct-index="${index}" aria-label="Mark option ${index + 1} as correct" ${question.correctIndex === index ? 'checked' : ''}><input type="text" data-option-index="${index}" value="${attr(option)}" placeholder="Option ${String.fromCharCode(65 + index)}"><button class="option-remove" type="button" data-action="remove-option" data-index="${index}" aria-label="Remove option ${index + 1}">Remove</button></div>`).join('')}</div><button class="btn secondary" type="button" data-action="add-option">+ Add option</button></div>`;
    }
    if (question.type === 'short') {
      return `<div class="question-type-fields"><label for="short-${attr(question.key)}">Correct short answer</label><input id="short-${attr(question.key)}" type="text" data-field="correct_answer" value="${attr(question.correct_answer)}" placeholder="One or two words"><small class="muted">The marking key can contain a maximum of two words.</small></div>`;
    }
    return '<div class="question-type-fields"><p class="muted">Students write a longer response. This question will wait for manual lecturer marking.</p></div>';
  }

  function imageFields(question) {
    const selected = question.file ? question.file.name : question.image_url;
    const preview = question.image_url ? `<img src="${attr(question.image_url)}" alt="Question image preview">` : '';
    return `<div class="question-image-row"><div><label>Question image (optional)</label><input type="file" accept="image/*" data-image-file></div>${selected ? '<button class="btn secondary" type="button" data-action="clear-image">Remove image</button>' : ''}</div>${selected ? `<div class="question-image-preview">${preview}<small>${html(question.file ? `Selected: ${question.file.name}` : question.image_url)}</small></div>` : ''}`;
  }

  function renderQuestions() {
    const container = byId('quizQuestionsBuilder');
    if (!state.questions.length) {
      container.innerHTML = '<div class="question-empty">No questions yet. Select “Add question” to begin.</div>';
      updateSummary();
      return;
    }
    container.innerHTML = state.questions.map((question, index) => `<article class="question-editor" data-key="${attr(question.key)}"><div class="question-editor-head"><div class="question-number"><span>${index + 1}</span>Question ${index + 1}</div><div class="question-actions"><button type="button" data-action="move-up" ${index === 0 ? 'disabled' : ''}>↑ Up</button><button type="button" data-action="move-down" ${index === state.questions.length - 1 ? 'disabled' : ''}>↓ Down</button><button type="button" data-action="duplicate">Duplicate</button><button type="button" data-action="delete">Delete</button></div></div><div class="question-editor-grid"><div><label>Question type</label><select data-field="type"><option value="mcq" ${question.type === 'mcq' ? 'selected' : ''}>Multiple choice</option><option value="short" ${question.type === 'short' ? 'selected' : ''}>Short answer</option><option value="long" ${question.type === 'long' ? 'selected' : ''}>Long answer</option></select></div><div><label>Marks</label><input type="number" min="0.5" step="0.5" data-field="marks" value="${attr(question.marks)}"></div></div><label>Question</label><textarea data-field="question" placeholder="Write the question students will see">${html(question.question)}</textarea>${typeFields(question)}${imageFields(question)}</article>`).join('');
    updateSummary();
  }

  function questionFor(target) {
    const card = target.closest('[data-key]');
    return card ? state.questions.find(question => question.key === card.dataset.key) : null;
  }

  function replaceQuestions(questions) {
    state.questions = (questions || []).map(normalizeQuestion);
    if (!state.questions.length) state.questions = [blankQuestion()];
    renderQuestions();
  }

  function populateModuleSelect(select, selectedValue = '') {
    select.innerHTML = state.modules.length
      ? '<option value="">Choose a module</option>' + state.modules.map(code => `<option value="${attr(code)}">${html(code)}</option>`).join('')
      : '<option value="">No modules assigned</option>';
    if (selectedValue && state.modules.includes(selectedValue)) select.value = selectedValue;
  }

  async function loadProfile() {
    const profile = await api('/lecturer/me', {}, true);
    state.modules = [...(profile.module_codes || [])].sort();
    const selected = byId('builderModuleCode').value;
    populateModuleSelect(byId('builderModuleCode'), selected || state.modules[0] || '');
    populateModuleSelect(byId('moduleCode'), selected || state.modules[0] || '');
  }

  async function loadDraftList(selectId = state.draftId) {
    const drafts = await api('/lecturer/quiz-drafts', {}, true);
    const select = byId('quizDraftSelect');
    select.innerHTML = drafts.length
      ? '<option value="">Choose a saved draft</option>' + drafts.map(draft => `<option value="${draft.id}">${html(draft.module_code || 'No module')} — ${html(draft.title)} (${draft.question_count})</option>`).join('')
      : '<option value="">No saved drafts</option>';
    if (selectId && drafts.some(draft => draft.id === Number(selectId))) select.value = String(selectId);
    byId('loadQuizDraftBtn').disabled = !drafts.length;
    byId('deleteQuizDraftBtn').disabled = !drafts.length;
  }

  function draftPayload() {
    return {
      title: byId('builderQuizTitle').value.trim() || 'Untitled quiz',
      module_code: byId('builderModuleCode').value,
      questions: state.questions.map(questionPayload),
    };
  }

  async function uploadPendingDraftImages() {
    for (let index = 0; index < state.questions.length; index += 1) {
      const question = state.questions[index];
      if (!question.file) continue;
      byId('quizDraftStatus').textContent = `Uploading image ${index + 1}…`;
      const form = new FormData();
      form.append('image', question.file);
      const result = await api('/lecturer/quiz-builder/image', {method: 'POST', body: form}, true);
      question.image_url = result.image_url;
      question.file = null;
    }
  }

  async function saveDraft() {
    const button = byId('saveQuizDraftBtn');
    button.disabled = true;
    try {
      await uploadPendingDraftImages();
      const path = state.draftId ? `/lecturer/quiz-drafts/${state.draftId}` : '/lecturer/quiz-drafts';
      const result = await api(path, {method: state.draftId ? 'PUT' : 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(draftPayload())}, true);
      state.draftId = result.id;
      setDirty(false);
      renderQuestions();
      await loadDraftList(result.id);
      byId('quizDraftStatus').textContent = `Saved ${formatSAST(result.updated_at)}`;
      showBuilderMessage('Quiz draft saved to your lecturer account.');
    } catch (error) {
      showBuilderMessage(`Could not save draft: ${error.message}`, 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function loadDraft() {
    const id = byId('quizDraftSelect').value;
    if (!id) { showBuilderMessage('Choose a saved draft first.', 'error'); return; }
    if (state.dirty && !confirm('Replace your unsaved builder changes with this draft?')) return;
    try {
      const draft = await api(`/lecturer/quiz-drafts/${id}`, {}, true);
      state.draftId = draft.id;
      byId('builderQuizTitle').value = draft.title;
      populateModuleSelect(byId('builderModuleCode'), draft.module_code);
      replaceQuestions(draft.questions);
      setDirty(false);
      byId('quizDraftStatus').textContent = `Loaded ${formatSAST(draft.updated_at)}`;
      showBuilderMessage(`Loaded draft “${draft.title}”.`);
    } catch (error) { showBuilderMessage(`Could not load draft: ${error.message}`, 'error'); }
  }

  async function deleteDraft() {
    const id = byId('quizDraftSelect').value || state.draftId;
    if (!id) { showBuilderMessage('Choose a saved draft first.', 'error'); return; }
    if (!confirm('Delete this unpublished quiz draft?')) return;
    try {
      await api(`/lecturer/quiz-drafts/${id}`, {method:'DELETE'}, true);
      if (Number(id) === Number(state.draftId)) newQuiz(false);
      await loadDraftList();
      showBuilderMessage('Quiz draft deleted.');
    } catch (error) { showBuilderMessage(`Could not delete draft: ${error.message}`, 'error'); }
  }

  function newQuiz(ask = true) {
    if (ask && state.dirty && !confirm('Discard your unsaved builder changes and start a new quiz?')) return;
    state.draftId = null;
    state.dirty = false;
    byId('builderQuizTitle').value = '';
    populateModuleSelect(byId('builderModuleCode'), state.modules[0] || '');
    byId('quizDraftSelect').value = '';
    byId('quizDraftStatus').textContent = 'New unsaved quiz';
    replaceQuestions([blankQuestion()]);
    byId('builderMsg').replaceChildren();
  }

  async function duplicateQuiz() {
    const quizId = byId('quizSelect').value;
    if (!quizId) { showBuilderMessage('Choose an existing quiz to duplicate.', 'error'); return; }
    if (state.dirty && !confirm('Replace your unsaved builder changes with a copy of this quiz?')) return;
    const button = byId('duplicateQuizBtn');
    button.disabled = true;
    try {
      const quiz = await api(`/lecturer/quizzes/${quizId}`, {}, true);
      state.draftId = null;
      byId('builderQuizTitle').value = `${quiz.title} — copy`;
      populateModuleSelect(byId('builderModuleCode'), quiz.module_code);
      replaceQuestions(quiz.questions);
      setDirty(true);
      showBuilderMessage('Quiz copied into the builder. Review it, then save as a draft or publish.');
      root.scrollIntoView({behavior:'smooth', block:'start'});
    } catch (error) { showBuilderMessage(`Could not duplicate quiz: ${error.message}`, 'error'); }
    finally { button.disabled = false; }
  }

  async function importSpreadsheet() {
    const input = byId('quizSpreadsheetFile');
    if (!input.files.length) { showBuilderMessage('Choose an Excel or CSV file first.', 'error'); return; }
    if (state.dirty && !confirm('Replace the current questions with the imported spreadsheet questions?')) return;
    const button = byId('importSpreadsheetBtn');
    button.disabled = true;
    try {
      const form = new FormData(); form.append('file', input.files[0]);
      const result = await api('/lecturer/quiz/import-spreadsheet', {method:'POST', body:form}, true);
      replaceQuestions(result.questions);
      setDirty(true);
      input.value = '';
      showBuilderMessage(`Imported ${result.num_questions} question${result.num_questions === 1 ? '' : 's'}. Review them before publishing.`);
    } catch (error) { showBuilderMessage(`Import failed: ${error.message}`, 'error'); }
    finally { button.disabled = false; }
  }

  function validateQuiz() {
    const errors = [];
    if (!byId('builderQuizTitle').value.trim()) errors.push('Enter a quiz title');
    if (!byId('builderModuleCode').value) errors.push('Choose an assigned module');
    if (!state.questions.length) errors.push('Add at least one question');
    state.questions.forEach((question, index) => {
      const label = `Question ${index + 1}`;
      const payload = questionPayload(question);
      if (!payload.question) errors.push(`${label}: enter the question text`);
      if (!(payload.marks > 0)) errors.push(`${label}: marks must be greater than zero`);
      if (question.type === 'mcq') {
        if (payload.options.length < 2) errors.push(`${label}: add at least two answer options`);
        if (!payload.correct_answer || !payload.options.includes(payload.correct_answer)) errors.push(`${label}: select the correct option`);
      }
      if (question.type === 'short') {
        if (!payload.correct_answer) errors.push(`${label}: enter the correct short answer`);
        else if (payload.correct_answer.split(/\s+/).filter(Boolean).length > 2) errors.push(`${label}: the short-answer key can contain at most two words`);
      }
    });
    return errors;
  }

  function clearPreviewUrls() {
    state.previewUrls.forEach(url => URL.revokeObjectURL(url));
    state.previewUrls = [];
  }

  function previewQuiz() {
    const errors = validateQuiz();
    if (errors.length) { showBuilderMessage(errors.slice(0, 6).join(' • '), 'error'); return; }
    clearPreviewUrls();
    byId('quizPreviewTitle').textContent = byId('builderQuizTitle').value.trim();
    byId('quizPreviewMeta').textContent = `${byId('builderModuleCode').value} · ${state.questions.length} questions · ${byId('builderTotalMarks').textContent}`;
    byId('quizPreviewQuestions').innerHTML = state.questions.map((question, index) => {
      let imageSource = question.image_url;
      if (question.file) { imageSource = URL.createObjectURL(question.file); state.previewUrls.push(imageSource); }
      const answers = question.type === 'mcq' ? question.options.filter(option => option.trim()).map(option => `<label class="quiz-preview-option"><input type="radio" disabled> ${html(option)}</label>`).join('') : question.type === 'short' ? '<input type="text" disabled placeholder="Student short answer">' : '<textarea disabled placeholder="Student long answer"></textarea>';
      return `<article class="quiz-preview-question"><header><strong>Question ${index + 1}</strong><span class="qmarks">${question.marks} mark${Number(question.marks) === 1 ? '' : 's'}</span></header><p>${html(question.question)}</p>${imageSource ? `<img src="${attr(imageSource)}" alt="Question image">` : ''}${answers}</article>`;
    }).join('');
    const dialog = byId('quizPreviewDialog');
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
  }

  async function publishQuiz() {
    const errors = validateQuiz();
    if (errors.length) { showBuilderMessage(errors.slice(0, 8).join(' • '), 'error'); return; }
    const button = byId('publishQuizBtn');
    button.disabled = true;
    try {
      const legacyQuestions = state.questions.map((question, index) => {
        const payload = questionPayload(question);
        const result = {type: payload.type, question: payload.question, marks: payload.marks};
        if (payload.type === 'mcq') result.options = payload.options;
        if (payload.type === 'mcq' || payload.type === 'short') result.answer = payload.correct_answer;
        if (question.file) {
          const extension = question.file.name.includes('.') ? question.file.name.slice(question.file.name.lastIndexOf('.')) : '';
          result.image = `builder-question-${index + 1}${extension}`;
        } else if (payload.image_url) result.image = payload.image_url;
        return result;
      });
      const form = new FormData();
      const documentBody = {title: byId('builderQuizTitle').value.trim(), questions: legacyQuestions};
      form.append('file', new Blob([JSON.stringify(documentBody)], {type:'application/json'}), 'quiz.json');
      form.append('module_code', byId('builderModuleCode').value);
      state.questions.forEach((question, index) => {
        if (!question.file) return;
        const extension = question.file.name.includes('.') ? question.file.name.slice(question.file.name.lastIndexOf('.')) : '';
        form.append('images', question.file, `builder-question-${index + 1}${extension}`);
      });
      const result = await api('/quiz/upload', {method:'POST', body:form}, true);
      if (state.draftId) await api(`/lecturer/quiz-drafts/${state.draftId}`, {method:'DELETE'}, true).catch(() => null);
      state.draftId = null;
      setDirty(false);
      await Promise.all([loadDraftList(), loadQuizzes()]);
      byId('quizSelect').value = String(result.quiz_id);
      byId('loadStudentsBtn').disabled = false;
      const link = `${location.origin}/static/student.html?module=${encodeURIComponent(result.module_code)}`;
      byId('shareLink').textContent = link;
      byId('shareBox').classList.remove('hidden');
      showBuilderMessage(`Published “${result.title}” with ${result.num_questions} questions. Students in ${result.module_code} can now open it.`);
    } catch (error) { showBuilderMessage(`Could not publish quiz: ${error.message}`, 'error'); }
    finally { button.disabled = false; }
  }

  root.addEventListener('input', event => {
    const question = questionFor(event.target);
    if (!question) return;
    const field = event.target.dataset.field;
    if (field && field !== 'type') question[field] = field === 'marks' ? Number(event.target.value) : event.target.value;
    if (event.target.dataset.optionIndex !== undefined) question.options[Number(event.target.dataset.optionIndex)] = event.target.value;
    setDirty(true); updateSummary();
  });

  root.addEventListener('change', event => {
    const question = questionFor(event.target);
    if (question && event.target.dataset.field === 'type') {
      question.type = event.target.value;
      if (question.type === 'mcq' && question.options.length < 2) question.options = ['', ''];
      if (question.type !== 'mcq') question.correctIndex = -1;
      renderQuestions(); setDirty(true); return;
    }
    if (question && event.target.dataset.correctIndex !== undefined) { question.correctIndex = Number(event.target.dataset.correctIndex); setDirty(true); }
    if (question && event.target.matches('[data-image-file]') && event.target.files.length) { question.file = event.target.files[0]; question.image_url = ''; renderQuestions(); setDirty(true); }
  });

  root.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const question = questionFor(button); if (!question) return;
    const index = state.questions.indexOf(question);
    const action = button.dataset.action;
    if (action === 'move-up' && index > 0) [state.questions[index - 1], state.questions[index]] = [state.questions[index], state.questions[index - 1]];
    if (action === 'move-down' && index < state.questions.length - 1) [state.questions[index + 1], state.questions[index]] = [state.questions[index], state.questions[index + 1]];
    if (action === 'duplicate') state.questions.splice(index + 1, 0, {...question, key:uid(), options:[...question.options]});
    if (action === 'delete') state.questions.splice(index, 1);
    if (action === 'add-option') question.options.push('');
    if (action === 'remove-option' && question.options.length > 2) {
      const optionIndex = Number(button.dataset.index); question.options.splice(optionIndex, 1);
      if (question.correctIndex === optionIndex) question.correctIndex = -1;
      else if (question.correctIndex > optionIndex) question.correctIndex -= 1;
    }
    if (action === 'clear-image') { question.file = null; question.image_url = ''; }
    renderQuestions(); setDirty(true);
  });

  byId('builderQuizTitle').addEventListener('input', () => setDirty(true));
  byId('builderModuleCode').addEventListener('change', event => { byId('moduleCode').value = event.target.value; setDirty(true); });
  byId('newQuizBuilderBtn').addEventListener('click', () => newQuiz(true));
  byId('addQuestionBtn').addEventListener('click', () => { state.questions.push(blankQuestion()); renderQuestions(); setDirty(true); });
  byId('saveQuizDraftBtn').addEventListener('click', saveDraft);
  byId('loadQuizDraftBtn').addEventListener('click', loadDraft);
  byId('deleteQuizDraftBtn').addEventListener('click', deleteDraft);
  byId('duplicateQuizBtn').addEventListener('click', duplicateQuiz);
  byId('importSpreadsheetBtn').addEventListener('click', importSpreadsheet);
  byId('previewQuizBtn').addEventListener('click', previewQuiz);
  byId('publishQuizBtn').addEventListener('click', publishQuiz);
  byId('closeQuizPreviewBtn').addEventListener('click', () => { byId('quizPreviewDialog').close(); clearPreviewUrls(); });
  byId('quizPreviewDialog').addEventListener('close', clearPreviewUrls);
  window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });

  replaceQuestions([blankQuestion()]);
  Promise.all([loadProfile(), loadDraftList()]).catch(error => showBuilderMessage(`Could not start the quiz builder: ${error.message}`, 'error'));
})();
