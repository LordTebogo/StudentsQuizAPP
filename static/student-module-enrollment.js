(function () {
  const STYLE_ID = 'moduleEnrollmentStyles';

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      body.module-enrollment-open { overflow: hidden; }
      .module-enrollment-overlay { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; padding: 20px; background: rgba(2, 8, 22, .82); backdrop-filter: blur(12px); }
      .module-enrollment-dialog { width: min(720px, 100%); max-height: min(820px, calc(100vh - 40px)); overflow: auto; border: 1px solid rgba(80, 222, 246, .34); border-radius: 28px; padding: clamp(24px, 5vw, 44px); color: #f5f8ff; background: linear-gradient(145deg, #10213d 0%, #09142a 58%, #101a38 100%); box-shadow: 0 30px 90px rgba(0, 0, 0, .55); }
      .module-enrollment-kicker { display: inline-flex; align-items: center; gap: 8px; color: #63e6d4; font: 700 .76rem/1.2 var(--font-mono, monospace); letter-spacing: .1em; text-transform: uppercase; }
      .module-enrollment-kicker::before { content: ''; width: 28px; height: 3px; border-radius: 9px; background: linear-gradient(90deg, #63e6d4, #8a7dff); }
      .module-enrollment-dialog h1 { margin: 13px 0 10px; color: #fff; font-size: clamp(1.8rem, 5vw, 3rem); line-height: 1.05; }
      .module-enrollment-intro { margin: 0 0 24px; color: #b9c6dd; font-size: 1rem; line-height: 1.65; }
      .module-enrollment-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 20px 0; }
      .module-enrollment-option { position: relative; display: grid; grid-template-columns: auto 1fr; gap: 12px; align-items: center; min-height: 76px; margin: 0; padding: 14px 16px; border: 1px solid rgba(153, 174, 211, .24); border-radius: 18px; background: rgba(255, 255, 255, .045); cursor: pointer; transition: border-color .2s, background .2s, transform .2s; }
      .module-enrollment-option:hover { transform: translateY(-1px); border-color: rgba(99, 230, 212, .58); }
      .module-enrollment-option:has(input:checked) { border-color: #63e6d4; background: rgba(99, 230, 212, .11); box-shadow: inset 0 0 0 1px rgba(99, 230, 212, .16); }
      .module-enrollment-option input { width: 21px; height: 21px; margin: 0; accent-color: #63e6d4; }
      .module-enrollment-option strong { display: block; color: #fff; font-size: 1rem; }
      .module-enrollment-option small { display: block; margin-top: 4px; color: #9eacc4; }
      .module-enrollment-note { display: flex; gap: 10px; margin: 18px 0; padding: 13px 15px; border-radius: 14px; color: #c9d4e8; background: rgba(138, 125, 255, .1); font-size: .9rem; line-height: 1.5; }
      .module-enrollment-actions { display: flex; align-items: center; gap: 14px; margin-top: 20px; }
      .module-enrollment-save { min-height: 52px; padding: 0 24px; border: 0; border-radius: 15px; color: #061322; background: linear-gradient(135deg, #5ce2d3, #71efb4); font: 800 1rem/1 inherit; cursor: pointer; }
      .module-enrollment-save:disabled { cursor: not-allowed; opacity: .48; }
      .module-enrollment-count { color: #9eacc4; font-size: .88rem; }
      .module-enrollment-message { min-height: 22px; margin-top: 12px; color: #ff9db1; font-size: .9rem; }
      .module-enrollment-empty { padding: 22px; border: 1px dashed rgba(153, 174, 211, .3); border-radius: 16px; color: #b9c6dd; text-align: center; }
      @media (max-width: 620px) { .module-enrollment-overlay { padding: 0; align-items: end; } .module-enrollment-dialog { max-height: 92vh; border-radius: 26px 26px 0 0; padding: 26px 20px max(26px, env(safe-area-inset-bottom)); } .module-enrollment-list { grid-template-columns: 1fr; } .module-enrollment-actions { align-items: stretch; flex-direction: column; } .module-enrollment-save { width: 100%; } }
    `;
    document.head.appendChild(style);
  }

  async function requestEnrollment(token, options) {
    const response = await fetch('/student/module-enrollment', {
      ...options,
      headers: { ...(options && options.headers), 'X-Student-Token': token },
    });
    let data = null;
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error((data && data.detail) || 'Module setup could not be loaded.');
    return data;
  }

  function showDialog(token, enrollment) {
    addStyles();
    document.body.classList.add('module-enrollment-open');
    const overlay = document.createElement('div');
    overlay.className = 'module-enrollment-overlay';
    overlay.innerHTML = `
      <section class="module-enrollment-dialog" role="dialog" aria-modal="true" aria-labelledby="moduleEnrollmentTitle">
        <span class="module-enrollment-kicker">First-time setup</span>
        <h1 id="moduleEnrollmentTitle">Choose your modules</h1>
        <p class="module-enrollment-intro">Select every subject you are currently studying. Your quiz and video lesson pages will then show only content for these modules.</p>
        <div class="module-enrollment-list" id="moduleEnrollmentList"></div>
        <div class="module-enrollment-note"><span aria-hidden="true">🔒</span><span>This is a one-time selection. To add another module later, contact your lecturer or administrator.</span></div>
        <div class="module-enrollment-actions"><button class="module-enrollment-save" type="button" disabled>Save my modules</button><span class="module-enrollment-count">Choose at least one module</span></div>
        <div class="module-enrollment-message" role="alert" aria-live="polite"></div>
      </section>`;
    document.body.appendChild(overlay);

    const list = overlay.querySelector('#moduleEnrollmentList');
    const save = overlay.querySelector('.module-enrollment-save');
    const count = overlay.querySelector('.module-enrollment-count');
    const message = overlay.querySelector('.module-enrollment-message');
    const modules = enrollment.available_modules || [];

    if (!modules.length) {
      list.className = 'module-enrollment-empty';
      list.textContent = 'No modules are available yet. Ask your lecturer or administrator to create your subjects.';
    } else {
      modules.forEach(module => {
        const label = document.createElement('label');
        label.className = 'module-enrollment-option';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = module.module_code;
        const copy = document.createElement('span');
        const title = document.createElement('strong');
        title.textContent = module.module_code;
        const detail = document.createElement('small');
        detail.textContent = `${module.quiz_count || 0} quizzes · ${module.lesson_count || 0} video lessons`;
        copy.append(title, detail);
        label.append(input, copy);
        list.appendChild(label);
      });
    }

    const updateCount = () => {
      const selected = list.querySelectorAll('input:checked').length;
      save.disabled = selected === 0;
      count.textContent = selected ? `${selected} module${selected === 1 ? '' : 's'} selected` : 'Choose at least one module';
    };
    list.addEventListener('change', updateCount);

    return new Promise((resolve, reject) => {
      save.addEventListener('click', async () => {
        const module_codes = [...list.querySelectorAll('input:checked')].map(input => input.value);
        if (!module_codes.length) return;
        save.disabled = true;
        save.textContent = 'Saving…';
        message.textContent = '';
        try {
          const result = await requestEnrollment(token, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ module_codes }),
          });
          overlay.remove();
          document.body.classList.remove('module-enrollment-open');
          resolve(result);
        } catch (error) {
          message.textContent = error.message;
          save.textContent = 'Save my modules';
          updateCount();
        }
      });
    });
  }

  window.ensureStudentModuleEnrollment = async function (token) {
    if (!token) throw new Error('Sign in to choose your modules.');
    const enrollment = await requestEnrollment(token);
    if (enrollment.completed) return enrollment;
    return showDialog(token, enrollment);
  };
})();
