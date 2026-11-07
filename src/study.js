/* 데이팁 공부 도구 — 소리 재생(녹음 mp3 / 기계 음성), "공부했어요" 표시(localStorage), 단어장 찾기.
 * 프레임워크 없음. localStorage 가 막혀 있어도 페이지는 그대로 동작한다(표시만 저장되지 않음). */
(function () {
  'use strict';
  var KEY = 'daytip.done.v1';
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* 저장 불가 — 무시 */ } }
  document.querySelectorAll('.js-only').forEach(function (x) { x.hidden = false; });

  /* ---------- 소리 ---------- */
  var player = null, cur = null;
  function stop() {
    if (player) { player.pause(); }
    if ('speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch (e) { /* 무시 */ } }
    if (cur) { cur.classList.remove('playing'); cur = null; }
  }
  function note(el, msg) {
    var n = el.closest('[data-note-target]') ? document.querySelector(el.closest('[data-note-target]').getAttribute('data-note-target')) : document.querySelector('.tts-note');
    if (n) { n.textContent = msg; n.hidden = false; }
  }
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-src],[data-say]');
    if (!el) return;
    e.preventDefault();
    if (cur === el) { stop(); return; }
    stop();
    var src = el.getAttribute('data-src');
    if (src) {
      player = player || new Audio();
      player.src = src; cur = el; el.classList.add('playing');
      player.onended = stop; player.onerror = function () { stop(); note(el, '소리 파일을 불러오지 못했습니다.'); };
      var p = player.play(); if (p && p.catch) p.catch(stop);
      return;
    }
    var say = el.getAttribute('data-say');
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') { note(el, '이 브라우저는 기계 음성을 지원하지 않습니다. 녹음이 있는 글자만 들을 수 있습니다.'); return; }
    var u = new SpeechSynthesisUtterance(say);
    u.lang = el.getAttribute('data-lang') || 'ja-JP'; u.rate = 0.8;
    var voices = speechSynthesis.getVoices ? speechSynthesis.getVoices() : [];
    var v = voices.filter(function (x) { return x.lang && x.lang.replace('_', '-').toLowerCase().indexOf(u.lang.slice(0, 2).toLowerCase()) === 0; })[0];
    if (v) u.voice = v; else if (voices.length) note(el, u.lang.slice(0, 2) === 'ja' ? '이 기기에 일본어 음성이 없어 다른 음성으로 읽습니다.' : '이 기기에 중국어 음성이 없어 다른 음성으로 읽습니다.');
    cur = el; el.classList.add('playing');
    u.onend = stop; u.onerror = stop;
    speechSynthesis.speak(u);
  });

  /* ---------- 공부했어요 ---------- */
  var done = load();
  function apply() {
    document.querySelectorAll('[data-done]').forEach(function (x) {
      var s = x.getAttribute('data-done'), on = !!done[s];
      if (x.type === 'checkbox') x.checked = on; else { x.classList.toggle('on', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); x.textContent = on ? '공부했어요 ✓' : '공부했어요'; }
      var li = x.closest('.day'); if (li) li.classList.toggle('done', on);
    });
    document.querySelectorAll('[data-progress]').forEach(function (p) {
      var list = []; try { list = JSON.parse(p.getAttribute('data-progress')); } catch (e) { /* 무시 */ }
      var n = list.filter(function (s) { return done[s]; }).length;
      var el = p.querySelector('.n'); if (el) el.textContent = n;
      var bar = p.querySelector('.me'); if (bar) bar.style.width = (list.length ? Math.round(n / list.length * 100) : 0) + '%';
      p.classList.toggle('has-progress', n > 0);
    });
    document.querySelectorAll('[data-continue]').forEach(function (a) {
      var list = []; try { list = JSON.parse(a.getAttribute('data-continue')); } catch (e) { /* 무시 */ }
      var any = false, next = null;
      for (var i = 0; i < list.length; i++) { if (done[list[i][0]]) any = true; else if (!next) next = list[i]; }
      if (!any) return;   /* 아직 표시한 게 없으면 기본 링크(목차·첫 수업) 그대로 */
      if (next) { a.href = a.getAttribute('data-base') + next[0] + '/'; a.textContent = next[1] + ' 이어서 공부하기'; }
      else { a.textContent = '여기까지 다 봤어요 — 복습하기'; }
    });
  }
  document.addEventListener('change', function (e) {
    var x = e.target; if (!x.matches || !x.matches('input[data-done]')) return;
    var s = x.getAttribute('data-done'); if (x.checked) done[s] = Date.now(); else delete done[s];
    save(done); apply();
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-done]'); if (!b) return;
    var s = b.getAttribute('data-done'); if (done[s]) delete done[s]; else done[s] = Date.now();
    save(done); apply();
  });
  apply();

  /* ---------- 단어장 찾기 ---------- */
  var f = document.querySelector('.vfilter');
  if (f) {
    var q = f.querySelector('input[type=search]'), ls = f.querySelector('select[name=lang]'), ds = f.querySelector('select[name=day]');
    var cnt = document.querySelector('.vcount'), empty = document.querySelector('.vempty');
    function syncDays() {
      if (!ds || !ls) return;
      var lv = ls.value;
      ds.querySelectorAll('optgroup').forEach(function (g) { var show = !lv || g.getAttribute('data-l') === lv; g.hidden = !show; g.disabled = !show; });
      if (ds.selectedOptions[0] && ds.selectedOptions[0].parentNode.disabled) ds.value = '';
    }
    function run() {
      var t = (q && q.value || '').trim().toLowerCase(), lv = ls ? ls.value : '', dv = ds ? ds.value : '', n = 0;
      document.querySelectorAll('.vday').forEach(function (sec) {
        var okSec = (!lv || sec.getAttribute('data-l') === lv) && (!dv || (sec.getAttribute('data-l') + ':' + sec.getAttribute('data-d')) === dv), show = 0;
        sec.querySelectorAll('.v').forEach(function (li) {
          var ok = okSec && (!t || (li.getAttribute('data-q') || '').toLowerCase().indexOf(t) >= 0);
          li.hidden = !ok; if (ok) { show++; n++; }
        });
        sec.hidden = !show;
      });
      if (cnt) cnt.textContent = n;
      if (empty) empty.hidden = n > 0;
    }
    try { var m = /[?&]q=([^&]*)/.exec(location.search); if (m && q) q.value = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { /* 무시 */ }
    f.addEventListener('submit', function (e) { e.preventDefault(); run(); });
    f.addEventListener('input', run);
    f.addEventListener('change', function () { syncDays(); run(); });
    f.querySelectorAll('[data-reset]').forEach(function (b) { b.addEventListener('click', function () { if (q) q.value = ''; if (ls) ls.value = ''; if (ds) ds.value = ''; syncDays(); run(); }); });
    syncDays(); run();
  }
})();
