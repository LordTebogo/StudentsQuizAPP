(() => {
  const $ = id => document.getElementById(id);
  const urls = new Map();
  const human = bytes => bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
  const name = (file, extension) => `${file.name.replace(/\.[^.]+$/, '')}-compressed.${extension}`;
  function clear(id) {
    if (urls.has(id)) URL.revokeObjectURL(urls.get(id));
    urls.delete(id);
    $(id).replaceChildren();
  }
  function message(id, value) { $(id).textContent = value; }
  function ready(id, file, blob, extension, preview) {
    clear(id);
    const url = URL.createObjectURL(blob); urls.set(id, url);
    const summary = document.createElement('p');
    summary.textContent = `${human(file.size)} → ${human(blob.size)} (${Math.round((1 - blob.size / file.size) * 100)}% ${blob.size <= file.size ? 'smaller' : 'larger'})`;
    const link = document.createElement('a');
    link.className = 'btn'; link.href = url; link.download = name(file, extension); link.textContent = 'Download compressed file';
    $(id).append(summary, link);
    if (preview) { const image = document.createElement('img'); image.src = url; image.alt = 'Compressed image preview'; $(id).append(image); }
    link.click();
  }
  const quality = $('imageQuality');
  quality.addEventListener('input', () => $('imageQualityValue').textContent = `${quality.value}%`);
  async function compressVideoFast(file, maxWidth, bitrate, onProgress) {
    if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') throw Error('Native video encoding is unavailable.');
    const {Input, Output, ALL_FORMATS, BlobSource, BufferTarget, Mp4OutputFormat, Conversion} = await import('https://cdn.jsdelivr.net/npm/mediabunny@1.62.1/+esm');
    const input = new Input({source: new BlobSource(file), formats: ALL_FORMATS});
    try {
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) throw Error('No video track was found.');
      const sourceWidth = await videoTrack.getDisplayWidth();
      const output = new Output({format: new Mp4OutputFormat(), target: new BufferTarget()});
      const conversion = await Conversion.init({
        input, output, tracks: 'primary',
        video: {width: Math.min(sourceWidth, maxWidth), codec: 'avc', bitrate, frameRate: 24, hardwareAcceleration: 'prefer-hardware', forceTranscode: true},
      });
      if (!conversion.isValid || conversion.discardedTracks.length) throw Error('This browser cannot keep every track in fast mode.');
      conversion.onProgress = progress => onProgress(Math.round(progress * 100));
      await conversion.execute();
      if (!output.target.buffer?.byteLength) throw Error('Fast encoding produced an empty file.');
      return new Blob([output.target.buffer], {type: 'video/mp4'});
    } finally { input.dispose(); }
  }
  $('compressImage').addEventListener('click', async () => {
    const file = $('imageFile').files[0]; if (!file) return message('imageResult', 'Choose an image first.');
    const button = $('compressImage'); button.disabled = true; clear('imageResult'); message('imageResult', 'Compressing image…');
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
      const scale = Math.min(1, Number($('imageSize').value) / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d'); if (!context) throw Error('Canvas is unavailable in this browser.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const preferred = file.type === 'image/png' || file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
      const blob = await new Promise(resolve => canvas.toBlob(resolve, preferred, Number(quality.value) / 100));
      if (!blob) throw Error('This browser could not encode the image.');
      ready('imageResult', file, blob, blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg', true);
    } catch (error) { message('imageResult', error.message || 'Image compression failed.'); }
    finally { bitmap?.close(); button.disabled = false; }
  });
  $('compressVideo').addEventListener('click', async () => {
    const file = $('videoFile').files[0]; if (!file) return message('videoResult', 'Choose a video first.');
    const button = $('compressVideo'), progress = $('videoProgress'); button.disabled = true; progress.hidden = false; progress.value = 0; clear('videoResult'); message('videoResult', 'Preparing fast compression…');
    try {
      const blob = await compressVideoFast(file, Number($('videoSize').value), Number($('videoBitrate').value), value => { progress.value = value; });
      ready('videoResult', file, blob, 'mp4');
      button.disabled = false; progress.hidden = true;
      return;
    } catch (_) {
      progress.value = 0;
      message('videoResult', 'Fast encoding is unavailable for this file or browser. Using compatible compression…');
    }
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/mp4'];
    const mimeType = typeof MediaRecorder !== 'undefined' && types.find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType || !HTMLCanvasElement.prototype.captureStream) { button.disabled = false; progress.hidden = true; return message('videoResult', 'Video compression is unavailable in this browser. Try a current version of Chrome, Edge, or Firefox.'); }
    message('videoResult', 'Preparing video…');
    const sourceUrl = URL.createObjectURL(file), video = document.createElement('video'); video.src = sourceUrl; video.playsInline = true; video.preload = 'auto';
    let context, stream, timer, recorder;
    try {
      await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(Error('This browser cannot read the selected video.')); });
      if (!Number.isFinite(video.duration) || video.duration <= 0) throw Error('Video duration is unavailable.');
      if (!video.videoWidth || !video.videoHeight) throw Error('This video has no readable picture track.');
      const width = Math.min(video.videoWidth, Number($('videoSize').value));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(2, Math.round(width / 2) * 2); canvas.height = Math.max(2, Math.round(canvas.width * video.videoHeight / video.videoWidth / 2) * 2);
      const drawing = canvas.getContext('2d'); if (!drawing) throw Error('Canvas is unavailable.');
      stream = canvas.captureStream(24);
      try {
        const AudioContextType = window.AudioContext || window.webkitAudioContext;
        if (AudioContextType) {
          context = new AudioContextType();
          const source = context.createMediaElementSource(video), destination = context.createMediaStreamDestination();
          source.connect(destination); destination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
          await context.resume();
        }
      } catch { if (context) await context.close(); context = null; }
      const actualType = stream.getAudioTracks().length ? mimeType : (types.find(type => !type.includes('opus') && MediaRecorder.isTypeSupported(type)) || mimeType);
      recorder = new MediaRecorder(stream, {mimeType: actualType, videoBitsPerSecond: Number($('videoBitrate').value), audioBitsPerSecond: 96000});
      const chunks = [];
      const finished = new Promise((resolve, reject) => { recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); }; recorder.onerror = event => reject(event.error || Error('Video encoding failed.')); recorder.onstop = () => resolve(new Blob(chunks, {type: actualType.split(';')[0]})); });
      const draw = () => { if (video.paused || video.ended) return; drawing.drawImage(video, 0, 0, canvas.width, canvas.height); requestAnimationFrame(draw); };
      video.onended = () => { if (recorder.state !== 'inactive') recorder.stop(); };
      recorder.start(1000); await video.play(); draw();
      message('videoResult', 'Compressing video…');
      timer = setInterval(() => { progress.value = Math.min(100, Math.round(video.currentTime / video.duration * 100)); }, 500);
      const blob = await finished;
      if (!blob.size) throw Error('The browser produced an empty video.');
      progress.value = 100; ready('videoResult', file, blob, actualType.startsWith('video/mp4') ? 'mp4' : 'webm');
    } catch (error) { if (recorder?.state === 'recording') recorder.stop(); message('videoResult', error.message || 'Video compression failed.'); }
    finally { clearInterval(timer); video.pause(); video.removeAttribute('src'); video.load(); stream?.getTracks().forEach(track => track.stop()); if (context) await context.close(); URL.revokeObjectURL(sourceUrl); button.disabled = false; progress.hidden = true; }
  });
  window.addEventListener('pagehide', () => urls.forEach(url => URL.revokeObjectURL(url)));
})();
