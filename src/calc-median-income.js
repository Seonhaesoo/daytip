(function () {
  var root = document.getElementById("gk-mi-1");
  if (!root) { return; }
  var D = {"table":{"2026":{"label":"2026년 (지금 시행 중)","rows":{"1":2564238,"2":4199292,"3":5359036,"4":6494738,"5":7556719,"6":8555952,"7":9515150}},"2027":{"label":"2027년 (1월부터)","rows":{"1":2736042,"2":4480645,"3":5718091,"4":6929885,"5":8063019,"6":9129201,"7":10152665}}},"benefits":[{"key":"livelihood","name":"생계급여","pct":32,"note":"선정되면 기준액에서 소득인정액을 뺀 만큼 받는다"},{"key":"medical","name":"의료급여","pct":40,"note":"병원비 본인부담이 크게 줄어든다"},{"key":"housing","name":"주거급여","pct":48,"note":"지역·가구원 수에 따라 임차료를 지원한다"},{"key":"education","name":"교육급여","pct":50,"note":"초·중·고 교육활동지원비"}],"bands":[{"pct":50,"name":"교육급여 · 차상위 계층"},{"pct":60,"name":"청년월세 특별지원, 국민취업지원제도 Ⅰ유형"},{"pct":75,"name":"긴급복지지원"},{"pct":100,"name":"에너지바우처, 각종 바우처의 흔한 상한"},{"pct":120,"name":"재난적 의료비"},{"pct":150,"name":"서울형 등 지자체 지원, 국민취업지원 Ⅱ유형"},{"pct":180,"name":"아이돌봄서비스 정부지원 상한"},{"pct":200,"name":"난임 시술비 등"}],"year":"2026"};

  var q = function (name) { return root.querySelector('[data-gk="' + name + '"]'); };
  var elYear = q('year'), elSize = q('size'), elIncome = q('income');
  var elResult = q('result'), elPct = q('pct'), elLine = q('line');
  var elFill = q('barfill'), elMark = q('barmark'), elMarkLabel = q('barmarklabel');
  var elBenefits = q('benefits'), elBands = q('bands');

  // **반올림이다. 내림이 아니다.** 복지부 고시값이 그렇다 — 2027년 1인
  // 의료급여가 2,736,042 × 0.4 = 1,094,416.8 인데 고시는 1,094,417원이다.
  // 내림으로 두면 경계선 가구가 1원 차이로 반대로 판정된다
  var won = function (n) { return Math.round(n).toLocaleString('ko-KR') + '원'; };
  var cutoff = function (base, pct) { return Math.round(base * pct / 100); };

  // 8인 이상은 "1인 늘 때마다 6인과 7인의 차액만큼" 이라는 복지부 규칙으로 늘린다.
  // 표를 10인까지 적어 두면 해마다 고칠 자리가 둘이 된다
  function median(year, size) {
    var rows = D.table[year].rows;
    var top = 7, step = rows[7] - rows[6];
    if (size <= top) { return rows[size]; }
    return rows[top] + step * (size - top);
  }

  function render() {
    var year = elYear.value;
    var size = parseInt(elSize.value, 10) || 1;
    var raw = elIncome.value.trim();
    var base = median(year, size);

    if (raw === '' || isNaN(parseFloat(raw))) { elResult.hidden = true; return; }
    var income = Math.max(0, parseFloat(raw)) * 10000;   // 만원 → 원
    var pct = base > 0 ? (income / base) * 100 : 0;

    elResult.hidden = false;
    elPct.textContent = pct.toFixed(1) + '%';

    var capped = Math.min(pct, 200);
    elFill.style.width = (capped / 200 * 100) + '%';
    elMark.style.left = (capped / 200 * 100) + '%';
    elMarkLabel.textContent = pct > 200 ? '200% 넘음' : '';

    elLine.innerHTML = '가구원 ' + size + '인의 ' + year + '년 기준 중위소득은 <strong>'
      + won(base) + '</strong>입니다. 넣으신 <strong>' + won(income)
      + '</strong>은 그 <strong>' + pct.toFixed(1) + '%</strong>입니다.';

    // 기초생활보장 급여 — 되는 것과 안 되는 것을 같이 보여 준다.
    // 되는 것만 보이면 "왜 안 되지" 가 안 풀린다
    elBenefits.innerHTML = '';
    D.benefits.forEach(function (b) {
      var cut = cutoff(base, b.pct);
      var ok = income <= cut;
      var card = document.createElement('div');
      card.className = 'gk-mi__card' + (ok ? ' is-ok' : '');
      var top = document.createElement('div');
      top.className = 'gk-mi__cardtop';
      var nm = document.createElement('span');
      nm.textContent = b.name + ' (' + b.pct + '%)';
      var tag = document.createElement('span');
      tag.className = 'gk-mi__tag ' + (ok ? 'is-ok' : 'is-no');
      tag.textContent = ok ? '해당' : '초과';
      top.appendChild(nm); top.appendChild(tag);
      var num = document.createElement('div');
      num.className = 'gk-mi__cardnum';
      num.textContent = won(cut);
      var note = document.createElement('div');
      note.className = 'gk-mi__cardnote';
      note.textContent = ok ? b.note : (won(income - cut) + ' 넘습니다');
      card.appendChild(top); card.appendChild(num); card.appendChild(note);
      elBenefits.appendChild(card);
    });

    // 구간표 — 내가 속한 가장 낮은 구간을 짚어 준다
    elBands.innerHTML = '';
    var lowest = null;
    D.bands.forEach(function (b) { if (lowest === null && pct <= b.pct) { lowest = b.pct; } });
    D.bands.forEach(function (b) {
      var cut = cutoff(base, b.pct);
      var ok = income <= cut;
      var tr = document.createElement('tr');
      if (b.pct === lowest) { tr.className = 'is-in'; }
      [b.pct + '%', won(cut), ok ? '해당' : '초과', b.name].forEach(function (v, i) {
        var td = document.createElement('td');
        td.textContent = v;
        if (i === 2) { td.style.color = ok ? 'var(--gk-ok)' : 'var(--gk-no)'; td.style.fontWeight = '700'; }
        tr.appendChild(td);
      });
      elBands.appendChild(tr);
    });
  }

  ['input', 'change'].forEach(function (ev) {
    [elYear, elSize, elIncome].forEach(function (el) { el.addEventListener(ev, render); });
  });
  render();
})();
