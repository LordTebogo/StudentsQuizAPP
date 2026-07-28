(() => {
  const path = location.pathname;
  const studentPage = path.endsWith('/lessons_student.html');
  const lecturerPage = path.endsWith('/lessons_lecturer.html');
  if (!studentPage && !lecturerPage) return;
  const stylesheet = document.createElement('link'); stylesheet.rel='stylesheet'; stylesheet.href='/static/lesson-insights.css'; document.head.appendChild(stylesheet);
  const escapeText = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  async function downloadPdf(url, headers, filename) {
    const response = await fetch(url, {headers}); if(!response.ok) throw new Error('Could not download this script.');
    const blob=await response.blob(),objectUrl=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=objectUrl;link.download=filename;link.click();URL.revokeObjectURL(objectUrl);
  }

  if (studentPage) {
    const video=document.getElementById('lessonVideo'),resultBox=document.getElementById('myResultBox');
    if(video) video.addEventListener('play',async()=>{
      if(typeof currentLesson==='undefined'||!currentLesson||video.dataset.reportedLesson===String(currentLesson.lesson_id))return;
      video.dataset.reportedLesson=String(currentLesson.lesson_id);
      try{await api(`/student/lessons/${currentLesson.lesson_id}/view`,{method:'POST'});}catch(_){video.dataset.reportedLesson='';}
    });
    async function addStudentDownload(){
      if(!resultBox||resultBox.querySelector('[data-lesson-result-download]')||typeof currentLesson==='undefined'||!currentLesson)return;
      const studentId=document.getElementById('studentId')?.value.trim();if(!studentId)return;
      try{const mine=await api(`/lesson/${currentLesson.lesson_id}/my-submission?student_id=${encodeURIComponent(studentId)}`);if(!mine.submitted)return;const button=document.createElement('button');button.type='button';button.className='btn secondary';button.dataset.lessonResultDownload=mine.submission_id;button.textContent='Download my script';resultBox.appendChild(button);}catch(_){}
    }
    if(resultBox)new MutationObserver(addStudentDownload).observe(resultBox,{childList:true});
    document.addEventListener('click',async event=>{const button=event.target.closest('[data-lesson-result-download]');if(!button)return;button.disabled=true;try{await downloadPdf(`/student/lesson/submission/${button.dataset.lessonResultDownload}/pdf`,{'X-Student-Token':sessionStorage.getItem('studentToken')||''},'lesson_quiz_script.pdf');}catch(error){alert(error.message);}finally{button.disabled=false;}});
  }

  if (lecturerPage) {
    let analytics=new Map();
    async function loadAnalytics(){
      try{const lessons=await api('/lecturer/lessons',{},true);analytics=new Map(lessons.map(item=>[String(item.id),item]));document.querySelectorAll('#lessonSelect option[value]').forEach(option=>{const item=analytics.get(option.value);if(item&&!option.dataset.analytics){option.textContent+=` · ${item.unique_viewers} viewer${item.unique_viewers===1?'':'s'}`;option.dataset.analytics='true';}});showMetric(document.getElementById('lessonSelect')?.value);}catch(_){}
    }
    function showMetric(lessonId){
      const item=analytics.get(String(lessonId));if(!item)return;let metric=document.getElementById('lessonViewMetric');if(!metric){metric=document.createElement('div');metric.id='lessonViewMetric';metric.className='lesson-view-metric';document.getElementById('previewDescription')?.insertAdjacentElement('afterend',metric);}metric.innerHTML=`<strong>${item.unique_viewers}</strong><span>unique video viewer${item.unique_viewers===1?'':'s'}</span><small>${item.video_starts} total play${item.video_starts===1?'':'s'}</small>`;
    }
    function addSubmissionDownloads(){
      const header=document.querySelector('#submissionsTable thead tr');if(header&&!header.querySelector('[data-script-heading]')){const th=document.createElement('th');th.dataset.scriptHeading='true';th.textContent='Script';header.appendChild(th);}
      document.querySelectorAll('#submissionsBody tr[data-id]').forEach(row=>{if(row.querySelector('[data-lesson-submission-pdf]'))return;const cell=document.createElement('td');cell.innerHTML=`<button class="row-download-btn" type="button" data-lesson-submission-pdf="${escapeText(row.dataset.id)}">PDF</button>`;const button=cell.querySelector('button');button.addEventListener('click',async event=>{event.preventDefault();event.stopPropagation();button.disabled=true;try{await downloadPdf(`/lecturer/lesson/submission/${button.dataset.lessonSubmissionPdf}/pdf`,{'X-Lecturer-Token':sessionStorage.getItem('lecturerToken')||''},`lesson_submission_${button.dataset.lessonSubmissionPdf}.pdf`);}catch(error){alert(error.message);}finally{button.disabled=false;}});row.appendChild(cell);});
    }
    const select=document.getElementById('lessonSelect');if(select){new MutationObserver(loadAnalytics).observe(select,{childList:true});select.addEventListener('change',()=>setTimeout(loadAnalytics,0));}
    const body=document.getElementById('submissionsBody');if(body)new MutationObserver(addSubmissionDownloads).observe(body,{childList:true});
    loadAnalytics();addSubmissionDownloads();
  }
})();
