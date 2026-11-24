/* 食安智荐 · 交互逻辑
 * 纯前端实现，无后端依赖。核心函数 recognizeDish() 与 buildMealPlan()
 * 可替换为真实大模型 API 调用，接口约定见 README.md。 */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'shian_zhijian_history_v1';
  let currentResult = null;
  let regenSeed = 0;
  let customRestrictions = [];
  let uploadedFile = null;

  /* ---------------- 食材解析 ---------------- */

  const UNIT_FACTOR = {
    g: 1, '克': 1, '毫升': 1, ml: 1,
    '碗': 200, '杯': 200, '个': 60, '根': 100,
    '片': 30, '勺': 10, '份': 100, '只': 100, '块': 80
  };

  function parseAmount(food, text) {
    const m = text.match(/([\d.]+)\s*(g|克|毫升|ml|碗|杯|个|根|片|勺|份|只|块)?/i);
    if (m) {
      const num = parseFloat(m[1]);
      const unit = (m[2] || 'g').toLowerCase();
      const factor = UNIT_FACTOR[unit] || 1;
      return Math.round(num * factor);
    }
    if (/少许|少量|适量|一点点/.test(text)) return Math.round(food.d * 0.3);
    return food.d;
  }

  function matchFood(part) {
    let best = null;
    for (const food of FOOD_DB) {
      if (part.includes(food.n) && (!best || food.n.length > best.n.length)) best = food;
    }
    return best;
  }

  function parseIngredients(text) {
    if (!text || !text.trim()) return [];
    const parts = text.split(/[,，、;；\n]+/).map((s) => s.trim()).filter(Boolean);
    const out = [];
    parts.forEach((part) => {
      const food = matchFood(part);
      if (food) out.push({ food, grams: parseAmount(food, part), raw: part });
    });
    return out;
  }

  function calcNutrition(items) {
    const sum = { kcal: 0, protein: 0, carb: 0, fat: 0 };
    items.forEach(({ food, grams }) => {
      const r = grams / 100;
      sum.kcal += food.k * r;
      sum.protein += food.p * r;
      sum.carb += food.c * r;
      sum.fat += food.f * r;
    });
    return {
      kcal: Math.round(sum.kcal),
      protein: Math.round(sum.protein),
      carb: Math.round(sum.carb),
      fat: Math.round(sum.fat)
    };
  }

  /* ---------------- 识别（可替换为多模态模型） ---------------- */

  function recognizeDish(textInput, file) {
    const name = file ? (file.name || '') : '';
    let dish = null;
    for (const candidate of DISH_LIBRARY) {
      if (candidate.kw.some((k) => name.toLowerCase().includes(k.toLowerCase()))) {
        dish = candidate; break;
      }
    }
    const parsed = parseIngredients(textInput);
    if (!dish && parsed.length) {
      const names = parsed.slice(0, 2).map((x) => x.food.n);
      dish = { name: names.join(' + ') + ' 组合', ing: parsed.map((x) => x.raw) };
    }
    if (!dish) {
      dish = DISH_LIBRARY[(new Date().getDate() + regenSeed) % DISH_LIBRARY.length];
    }
    const ingredients = parsed.length ? parsed.map((x) => x.raw) : dish.ing.slice();
    const confidence = parsed.length >= 3 ? '识别置信度：较高'
      : parsed.length ? '识别置信度：中等' : '候选识别 · 请确认';
    return { name: dish.name, ingredients, confidence };
  }

  /* ---------------- 食谱生成（可替换为大模型 API） ---------------- */

  function restrictionTags(list) {
    const tags = [];
    list.forEach((r) => {
      if (r === '不辣') tags.push('辣');
      else if (r === '素食') tags.push('素');
      else if (r === '海鲜') tags.push('海鲜');
      else if (r === '花生') tags.push('花生');
      else if (r === '乳制品') tags.push('乳制品');
      else tags.push(r);
    });
    return tags;
  }

  function isAllowed(meal, tags) {
    const hay = (meal.name + meal.ing).toLowerCase();
    return tags.every((t) => {
      if (!t) return true;
      if (t === '素') return !/(鸡|牛|猪|鱼|虾|蛋|肉|三文鱼|牛油果奶)/.test(hay) && !meal.tags.includes('海鲜');
      if (t === '海鲜') return !/鱼|虾|海鲜|三文鱼/.test(hay) && !meal.tags.includes('海鲜');
      if (t === '乳制品') return !/牛奶|酸奶|奶酪|乳制品/.test(hay) && !meal.tags.includes('乳制品');
      if (t === '花生') return !/花生/.test(hay);
      return !hay.includes(t.toLowerCase()) && !meal.tags.some((x) => x.includes(t));
    });
  }

  function seededPick(arr, seed) {
    if (!arr.length) return null;
    return arr[Math.abs(seed) % arr.length];
  }

  function buildMealPlan(goal, restrictions, seed) {
    const tags = restrictionTags(restrictions);
    const result = [];
    ['breakfast', 'lunch', 'dinner'].forEach((type, idx) => {
      const pool = MEAL_LIBRARY[type].filter((m) => isAllowed(m, tags));
      const preferred = pool.filter((m) => m.goal === goal);
      const use = preferred.length ? preferred : pool.length ? pool : MEAL_LIBRARY[type];
      const picked = seededPick(use, seed + idx * 3);
      result.push(Object.assign({ type }, picked));
    });
    return result;
  }

  /* ---------------- 渲染 ---------------- */

  function renderNutrition(n, goal) {
    const target = GOAL_TARGET[goal];
    const cards = [
      { cls: 'kcal',    name: '热量',   value: n.kcal,    unit: 'kcal', max: target.kcal,    note: '参考全天目标 ' + target.kcal + ' kcal' },
      { cls: 'protein', name: '蛋白质', value: n.protein, unit: 'g',    max: target.protein, note: '参考全天目标 ' + target.protein + ' g' },
      { cls: 'carb',    name: '碳水',   value: n.carb,    unit: 'g',    max: target.carb,    note: '参考全天目标 ' + target.carb + ' g' },
      { cls: 'fat',     name: '脂肪',   value: n.fat,     unit: 'g',    max: target.fat,     note: '参考全天目标 ' + target.fat + ' g' }
    ];
    $('nutritionGrid').innerHTML = cards.map((c) => {
      const pct = Math.min(100, Math.round(c.value / c.max * 100));
      return '<div class="nutri-card ' + c.cls + '">' +
        '<div class="nutri-top"><span class="nutri-name">' + c.name + '</span><span class="nutri-unit">' + c.unit + '</span></div>' +
        '<div class="nutri-value">' + c.value + '<small>' + c.unit + '</small></div>' +
        '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="nutri-note">' + c.note + '</div></div>';
    }).join('');
    $('goalBadge').textContent = '目标：' + GOAL_LABEL[goal];
  }

  function renderMeals(meals) {
    const label = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' };
    $('mealGrid').innerHTML = meals.map((m) => {
      if (!m) return '';
      return '<article class="meal-card">' +
        '<div class="meal-head"><b>' + label[m.type] + ' · ' + m.name + '</b><span>约 ' + m.min + ' 分钟</span></div>' +
        '<div class="meal-body">' +
        '<h4>食材</h4><p class="meal-ing">' + m.ing + '</p>' +
        '<h4>做法</h4><ol class="steps">' + m.steps.map((s) => '<li>' + s + '</li>').join('') + '</ol>' +
        '<div class="meal-kcal">估算 ' + m.kcal + ' kcal · 蛋白质 ' + m.protein + ' g' + (m.goal === 'gain' ? ' · 高蛋白优选' : m.goal === 'cut' ? ' · 控卡优选' : '') + '</div>' +
        '</div></article>';
    }).join('');
  }

  function renderIdentify(info) {
    $('dishName').textContent = info.name;
    $('confidence').textContent = info.confidence;
    $('ingredientTags').innerHTML = info.ingredients.map((i) => '<span class="ing-tag">' + escapeHtml(i) + '</span>').join('');
    $('resultSubtitle').textContent = info.confidence === '候选识别 · 请确认'
      ? '图片识别为演示候选，请在下方确认或修改食材后再参考结果。'
      : '下面结果由内置知识库与规则引擎生成，请按实际情况确认。';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------------- 流程动画 ---------------- */

  function animateSteps(done) {
    const items = document.querySelectorAll('.process-list li');
    $('processing').hidden = false;
    items.forEach((li) => { li.className = ''; });
    let i = 0;
    const timer = setInterval(() => {
      if (i > 0) items[i - 1].className = 'done';
      if (i < items.length) items[i].className = 'active';
      i += 1;
      if (i > items.length) {
        clearInterval(timer);
        setTimeout(() => { $('processing').hidden = true; done(); }, 220);
      }
    }, 300);
  }

  /* ---------------- 主流程 ---------------- */

  function runAnalysis(scroll) {
    const goal = document.querySelector('input[name="goal"]:checked').value;
    const restrictions = Array.from(document.querySelectorAll('input[name="restrict"]:checked')).map((x) => x.value)
      .concat(customRestrictions);
    const text = $('ingredients').value.trim();
    if (!text && !uploadedFile) {
      $('formError').textContent = '请上传一张菜品照片，或至少输入一种食材。';
      $('formError').hidden = false;
      $('ingredients').focus();
      return;
    }
    $('formError').hidden = true;

    $('submitBtn').disabled = true;
    $('submitText').textContent = '分析之中…';
    $('submitBtn').querySelector('.btn-spinner').hidden = false;
    $('result').hidden = true;

    animateSteps(() => {
      const info = recognizeDish(text, uploadedFile);
      const items = parseIngredients(info.ingredients.join('，'));
      const nutrition = calcNutrition(items);
      const meals = buildMealPlan(goal, restrictions, regenSeed);
      currentResult = { info, items, nutrition, meals, goal, restrictions, text, time: new Date().toISOString() };

      renderIdentify(info);
      renderNutrition(nutrition, goal);
      renderMeals(meals);
      $('avoidBadge').textContent = restrictions.length ? '已避开：' + restrictions.join('、') : '未设置忌口';
      $('result').hidden = false;

      $('submitBtn').disabled = false;
      $('submitText').textContent = '生成分析与食谱';
      $('submitBtn').querySelector('.btn-spinner').hidden = true;
      if (scroll !== false) $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /* ---------------- 历史记录 ---------------- */

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); }
    catch (e) { return []; }
  }

  function saveHistory() {
    if (!currentResult) return;
    const list = loadHistory();
    list.unshift({
      time: currentResult.time,
      dish: currentResult.info.name,
      kcal: currentResult.nutrition.kcal,
      goal: currentResult.goal,
      restrictions: currentResult.restrictions,
      ingredients: currentResult.info.ingredients,
      text: currentResult.text
    });
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, 10)));
      renderHistory();
      $('saveBtn').textContent = '✓ 已保存';
      setTimeout(() => { $('saveBtn').textContent = '保存本次'; }, 1600);
    } catch (e) {
      $('saveBtn').textContent = '保存失败';
    }
  }

  function renderHistory() {
    const list = loadHistory();
    const box = $('historyList');
    if (!list.length) {
      box.innerHTML = '<div class="history-empty">还没有记录。完成一次分析后点「保存本次」，就会出现在这里。</div>';
      return;
    }
    box.innerHTML = list.map((r, idx) => {
      const d = new Date(r.time);
      const time = isNaN(d.getTime()) ? '' : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      return '<div class="history-item"><div><h4>' + escapeHtml(r.dish) + '</h4><small>' + time + ' · ' + (GOAL_LABEL[r.goal] || '') + ' · ' + r.kcal + ' kcal</small></div>' +
        '<div class="hist-meta"><small>' + (r.restrictions.length ? '已避开 ' + r.restrictions.join('、') : '无忌口') + '</small>' +
        '<button type="button" class="link-btn hist-load" data-idx="' + idx + '">载入</button>' +
        '<button type="button" class="link-btn hist-del" data-idx="' + idx + '">删除</button></div></div>';
    }).join('');

    box.querySelectorAll('.hist-load').forEach((btn) => btn.addEventListener('click', () => {
      const r = loadHistory()[Number(btn.dataset.idx)];
      if (!r) return;
      $('ingredients').value = r.text || r.ingredients.join('，');
      const goalInput = document.querySelector('input[name="goal"][value="' + r.goal + '"]');
      if (goalInput) goalInput.checked = true;
      document.querySelectorAll('input[name="restrict"]').forEach((x) => {
        x.checked = r.restrictions.includes(x.value);
      });
      customRestrictions = r.restrictions.filter((x) => !Array.from(document.querySelectorAll('input[name="restrict"]')).some((y) => y.value === x));
      renderCustomTags();
      $('analyzer').scrollIntoView({ behavior: 'smooth' });
    }));

    box.querySelectorAll('.hist-del').forEach((btn) => btn.addEventListener('click', () => {
      const list2 = loadHistory();
      list2.splice(Number(btn.dataset.idx), 1);
      localStorage.setItem(STORE_KEY, JSON.stringify(list2));
      renderHistory();
    }));
  }

  /* ---------------- 自定义忌口 ---------------- */

  function renderCustomTags() {
    $('customTags').innerHTML = customRestrictions.map((t, i) =>
      '<span class="ing-tag">' + escapeHtml(t) + ' <button type="button" class="link-btn del-custom" data-idx="' + i + '" aria-label="删除">×</button></span>'
    ).join('');
    $('customTags').querySelectorAll('.del-custom').forEach((btn) => btn.addEventListener('click', () => {
      customRestrictions.splice(Number(btn.dataset.idx), 1);
      renderCustomTags();
    }));
  }

  /* ---------------- 事件绑定 ---------------- */

  function initUpload() {
    const zone = $('dropZone');
    const input = $('imageInput');
    zone.addEventListener('click', (e) => {
      if (e.target.id !== 'removeImage') input.click();
    });
    zone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    input.addEventListener('change', () => {
      if (input.files && input.files[0]) showImage(input.files[0]);
    });
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => {
      e.preventDefault(); zone.classList.add('dragover');
    }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => {
      e.preventDefault(); zone.classList.remove('dragover');
    }));
    zone.addEventListener('drop', (e) => {
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && f.type.startsWith('image/')) showImage(f);
    });
    $('removeImage').addEventListener('click', (e) => {
      e.stopPropagation();
      uploadedFile = null;
      input.value = '';
      $('previewWrap').hidden = true;
      $('dropPlaceholder').hidden = false;
    });
  }

  function showImage(file) {
    if (!file.type.startsWith('image/')) {
      $('formError').textContent = '请选择图片文件（JPG / PNG / WEBP）。';
      $('formError').hidden = false;
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      $('formError').textContent = '图片请小于 8MB。';
      $('formError').hidden = false;
      return;
    }
    uploadedFile = file;
    $('formError').hidden = true;
    const reader = new FileReader();
    reader.onload = (e) => {
      $('previewImg').src = e.target.result;
      $('dropPlaceholder').hidden = true;
      $('previewWrap').hidden = false;
    };
    reader.readAsDataURL(file);
  }

  function bindEvents() {
    initUpload();

    $('analyzeForm').addEventListener('submit', (e) => {
      e.preventDefault();
      regenSeed = 0;
      runAnalysis(true);
    });

    $('addRestrict').addEventListener('click', () => {
      const v = $('customRestrict').value.trim();
      if (v && !customRestrictions.includes(v) && customRestrictions.length < 5) {
        customRestrictions.push(v);
        $('customRestrict').value = '';
        renderCustomTags();
      }
    });
    $('customRestrict').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); $('addRestrict').click(); }
    });

    $('editIdentifyBtn').addEventListener('click', () => {
      if (!currentResult) return;
      $('editDish').value = currentResult.info.name;
      $('editIngredients').value = currentResult.info.ingredients.join('，');
      $('identifyView').hidden = true;
      $('identifyEdit').hidden = false;
    });
    $('cancelEdit').addEventListener('click', () => {
      $('identifyEdit').hidden = true;
      $('identifyView').hidden = false;
    });
    $('applyEdit').addEventListener('click', () => {
      if (!currentResult) return;
      const name = $('editDish').value.trim();
      const ing = $('editIngredients').value.split(/[,，、;；\n]+/).map((s) => s.trim()).filter(Boolean);
      if (!name || !ing.length) return;
      currentResult.info = {
        name, ingredients: ing, confidence: '已由用户修正 ✓'
      };
      currentResult.items = parseIngredients(ing.join('，'));
      currentResult.nutrition = calcNutrition(currentResult.items);
      currentResult.text = ing.join('，');
      renderIdentify(currentResult.info);
      renderNutrition(currentResult.nutrition, currentResult.goal);
      $('identifyEdit').hidden = true;
      $('identifyView').hidden = false;
    });

    $('regenerateBtn').addEventListener('click', () => {
      if (!currentResult) return;
      regenSeed += 1;
      const meals = buildMealPlan(currentResult.goal, currentResult.restrictions, regenSeed);
      currentResult.meals = meals;
      renderMeals(meals);
      $('regenerateBtn').textContent = '✓ 已换一批';
      setTimeout(() => { $('regenerateBtn').textContent = '↻ 重新生成食谱'; }, 1300);
    });

    $('saveBtn').addEventListener('click', saveHistory);
    $('clearHistory').addEventListener('click', () => {
      if (!loadHistory().length) return;
      if (window.confirm('确定清空全部历史记录吗？')) {
        localStorage.removeItem(STORE_KEY);
        renderHistory();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    renderHistory();
    renderCustomTags();
  });
})();
