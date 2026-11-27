window.CNCApp = window.CNCApp || {};

const NARROW_CHANNEL_CLEARANCE_MM = 0.65;
const LOCAL_PINCH_CLEARANCE_MM = 0.6;
const DEEP_NARROW_CLEARANCE_MM = 0.45;
const SPARSE_FILL_AREA_PX2 = 50000;
const LOCAL_PINCH_MIN_AREA_PX2 = 40000;
const MAX_LOCAL_PINCH_CLUSTERS_PER_ISLAND = 8;

CNCApp.SvgGenerator = {
  currentSvgString: null,
  parsedShapes: [],
  detectedFillColors: [],
  detectedStrokeColors: [],
  colorMapping: new Map(), // hexColor -> dispenserId (0 means Ignore / Do not fill)
  svgBounds: { minX: 0, minY: 0, width: 100, height: 100 },
  detectedPhysicalWidthMm: null,
  detectedPhysicalHeightMm: null,

  sampleSvgs: {
    star: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <polygon points="50,5 64,36 98,36 70,57 81,91 50,70 19,91 30,57 2,36 36,36" 
           fill="#2563eb" stroke="#1d4ed8" stroke-width="1.5" />
  <circle cx="50" cy="50" r="14" fill="#dc2626" stroke="#991b1b" stroke-width="1" />
</svg>`,

    flower3Color: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <circle cx="60" cy="60" r="14" fill="#d97706" />
  <path d="M 60 46 C 45 20, 75 20, 60 46 Z" fill="#2563eb" />
  <path d="M 74 60 C 100 45, 100 75, 74 60 Z" fill="#2563eb" />
  <path d="M 60 74 C 75 100, 45 100, 60 74 Z" fill="#2563eb" />
  <path d="M 46 60 C 20 75, 20 45, 46 60 Z" fill="#2563eb" />
  <circle cx="85" cy="35" r="7" fill="#059669" />
  <circle cx="85" cy="85" r="7" fill="#059669" />
  <circle cx="35" cy="85" r="7" fill="#059669" />
  <circle cx="35" cy="35" r="7" fill="#059669" />
</svg>`,

    channelsAndPockets: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40" width="60mm" height="40mm">
  <!-- Тест канали широк 1.2мм и езерца со стеснување -->
  <path d="M 10 10 L 50 10 L 50 12 L 10 12 Z" fill="#2563eb" />
  <path d="M 10 18 C 10 14, 18 14, 18 18 C 18 20, 15 21, 15 24 C 15 27, 18 28, 18 32 C 18 36, 10 36, 10 32 C 10 28, 13 27, 13 24 C 13 21, 10 20, 10 18 Z" fill="#059669" />
  <path d="M 25 18 L 45 18 L 45 32 L 43 32 L 43 20 L 36 20 L 36 32 L 34 32 L 34 20 L 27 20 L 27 32 L 25 32 Z" fill="#dc2626" />
</svg>`
  },

  openModal: function(initialSvgText) {
    if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) {
      alert('🔒 SVG генераторот е заклучен додека тековниот таб активно работи на машината. Отворете нов таб (➕ Нов таб) за друг проект.');
      return;
    }
    if (CNCApp.Machine && typeof CNCApp.Machine.isBusy === 'function' && CNCApp.Machine.isBusy()) {
      var msg = '⚠️ ПРЕДУПРЕДУВАЊЕ ЗА СТАБИЛНОСТ (Windows XP / Mach3):\n\nМашината активно извршува програма! Тешката растерска пресметка за SVG патека може привремено да го оптовари процесорот.\n\n';
      msg += 'Дали сте сигурни дека сакате да го отворите SVG генераторот сега?';
      if (!confirm(msg)) return;
    }

    const modal = document.getElementById('svgGeneratorModal');
    if (!modal) return;

    if (initialSvgText) {
      this.currentSvgString = initialSvgText;
    } else if (CNCApp.State.svgData) {
      this.currentSvgString = CNCApp.State.svgData;
    } else {
      this.currentSvgString = this.sampleSvgs.channelsAndPockets;
    }

    this.parseAndAnalyze(this.currentSvgString);
    this.updateModalUI();
    modal.style.display = 'flex';
  },

  closeModal: function() {
    const modal = document.getElementById('svgGeneratorModal');
    if (modal) modal.style.display = 'none';
  },

  parseDimensionToMm: function(dimStr, defaultDpi) {
    if (defaultDpi === undefined) defaultDpi = 96;
    if (!dimStr) return null;
    const s = String(dimStr).trim().toLowerCase();
    if (s.indexOf('%') !== -1) return null;
    if (s.endsWith('mm')) return parseFloat(s);
    if (s.endsWith('cm')) return parseFloat(s) * 10;
    if (s.endsWith('in')) return parseFloat(s) * 25.4;
    if (s.endsWith('pt')) return parseFloat(s) * (25.4 / 72);
    if (s.endsWith('px')) return parseFloat(s) * (25.4 / defaultDpi);
    const n = parseFloat(s);
    return isNaN(n) ? null : n * (25.4 / defaultDpi);
  },

  parseAndAnalyze: function(svgText) {
    this.currentSvgString = svgText;
    this.parsedShapes = [];
    this.detectedFillColors = [];
    this.detectedStrokeColors = [];
    this.colorMapping.clear();
    this.detectedPhysicalWidthMm = null;
    this.detectedPhysicalHeightMm = null;

    if (!svgText || !svgText.trim()) return;

    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (!svgEl) return;

    const cssRules = {};
    const styleTags = doc.querySelectorAll('style');
    Array.prototype.forEach.call(styleTags, st => {
      const txt = st.textContent || '';
      const regex = /\.([a-zA-Z0-9_-]+)\s*\{([^}]+)\}/g;
      let match;
      while ((match = regex.exec(txt)) !== null) {
        const clsName = match[1];
        const decls = match[2];
        cssRules[clsName] = cssRules[clsName] || {};
        decls.split(';').forEach(d => {
          const parts = d.split(':');
          if (parts.length === 2) {
            const k = parts[0].trim().toLowerCase();
            const v = parts[1].trim();
            cssRules[clsName][k] = v;
          }
        });
      }
    });

    const rawW = svgEl.getAttribute('width');
    const rawH = svgEl.getAttribute('height');
    const parsedW_mm = this.parseDimensionToMm(rawW);
    const parsedH_mm = this.parseDimensionToMm(rawH);

    let vb = svgEl.getAttribute('viewBox');
    let minX = 0, minY = 0, vbWidth = 100, vbHeight = 100;
    if (vb) {
      const parts = vb.trim().split(/[\s,]+/).map(parseFloat);
      if (parts.length === 4) {
        minX = parts[0];
        minY = parts[1];
        vbWidth = parts[2];
        vbHeight = parts[3];
      }
    } else if (parsedW_mm && parsedH_mm) {
      vbWidth = parsedW_mm;
      vbHeight = parsedH_mm;
    }

    this.svgBounds = { minX, minY, width: vbWidth, height: vbHeight };

    if (parsedW_mm && parsedW_mm > 0) {
      this.detectedPhysicalWidthMm = parseFloat(parsedW_mm.toFixed(3));
      this.detectedPhysicalHeightMm = parsedH_mm ? parseFloat(parsedH_mm.toFixed(3)) : parseFloat(((parsedW_mm * vbHeight) / vbWidth).toFixed(3));
    } else {
      this.detectedPhysicalWidthMm = Math.round(vbWidth);
      this.detectedPhysicalHeightMm = Math.round(vbHeight);
    }

    const selectors = ['path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse'];
    const nodes = svgEl.querySelectorAll(selectors.join(','));

    const fillSet = new Set();
    const strokeSet = new Set();

    Array.prototype.forEach.call(nodes, (node, nodeIdx) => {
      let fillVal = node.getAttribute('fill');
      let strokeVal = node.getAttribute('stroke');

      const classAttr = node.getAttribute('class') || '';
      const classes = classAttr.split(/\s+/).filter(Boolean);
      for (let cls of classes) {
        if (cssRules[cls]) {
          if (!fillVal && cssRules[cls].fill) fillVal = cssRules[cls].fill;
          if (!strokeVal && cssRules[cls].stroke) strokeVal = cssRules[cls].stroke;
        }
      }

      if (node.style) {
        if (!fillVal && node.style.fill) fillVal = node.style.fill;
        if (!strokeVal && node.style.stroke) strokeVal = node.style.stroke;
      }

      const isFillNone = !fillVal || fillVal === 'none' || fillVal === 'transparent';
      const isStrokeNone = !strokeVal || strokeVal === 'none' || strokeVal === 'transparent';

      const normFill = isFillNone ? null : this.normalizeColorToHex(fillVal);
      const normStroke = isStrokeNone ? null : this.normalizeColorToHex(strokeVal);

      if (normFill) fillSet.add(normFill);
      if (normStroke) strokeSet.add(normStroke);

      const dStrings = this.convertNodeToPathStrings(node);
      dStrings.forEach(d => {
        if (d && d.trim().length > 1) {
          const matrix = this.getNodeSvgMatrix(node);
          this.parsedShapes.push({
            d: d.trim(),
            fillColor: normFill,
            strokeColor: normStroke,
            nodeType: node.tagName.toLowerCase(),
            elementIndex: nodeIdx,
            svgMatrix: matrix
          });
        }
      });
    });

    this.detectedFillColors = Array.from(fillSet);
    this.detectedStrokeColors = Array.from(strokeSet);

    this.detectedFillColors.forEach(hex => {
      if (hex === '#ffffff') {
        this.colorMapping.set(hex, 0);
      } else {
        const matchedDisp = this.findClosestDispenser(hex);
        this.colorMapping.set(hex, matchedDisp.id);
      }
    });

    if (this.detectedFillColors.length === 0) {
      this.detectedStrokeColors.forEach(hex => {
        const matchedDisp = this.findClosestDispenser(hex);
        this.colorMapping.set(hex, matchedDisp.id);
      });
    }
  },

  normalizeColorToHex: function(colorStr) {
    if (!colorStr) return null;
    const c = colorStr.trim().toLowerCase();
    if (c === 'none' || c === 'transparent') return null;

    if (c.startsWith('#')) {
      if (c.length === 4) {
        return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
      }
      return c.substring(0, 7);
    }

    try {
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.fillStyle = c;
      return ctx.fillStyle;
    } catch (e) {
      return null;
    }
  },

  findClosestDispenser: function(hexColor) {
    const dispensers = CNCApp.State.machine.dispensers || [];
    if (dispensers.length === 0) return { id: 1, name: 'Боја 1' };

    const rgb1 = this.hexToRgb(hexColor);
    let bestDist = Infinity;
    let bestDisp = dispensers[0];

    dispensers.forEach(d => {
      const rgb2 = this.hexToRgb(d.color);
      const dist = Math.hypot(rgb1.r - rgb2.r, rgb1.g - rgb2.g, rgb1.b - rgb2.b);
      if (dist < bestDist) {
        bestDist = dist;
        bestDisp = d;
      }
    });

    return bestDisp;
  },

  hexToRgb: function(hex) {
    let clean = (hex || '#000000').replace('#', '');
    if (clean.length === 3) {
      clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
    }
    const num = parseInt(clean, 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  },

  identitySvgMatrix: function() {
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  },

  multiplySvgMatrices: function(left, right) {
    return {
      a: left.a * right.a + left.c * right.b,
      b: left.b * right.a + left.d * right.b,
      c: left.a * right.c + left.c * right.d,
      d: left.b * right.c + left.d * right.d,
      e: left.a * right.e + left.c * right.f + left.e,
      f: left.b * right.e + left.d * right.f + left.f
    };
  },

  parseSvgTransformList: function(transformText) {
    let matrix = this.identitySvgMatrix();
    if (!transformText) return matrix;

    const regex = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
    let match;
    while ((match = regex.exec(String(transformText))) !== null) {
      const name = match[1].toLowerCase();
      const values = match[2].trim().split(/[\s,]+/).map(parseFloat).filter(v => !isNaN(v));
      let next = this.identitySvgMatrix();

      if (name === 'matrix' && values.length === 6) {
        next = { a: values[0], b: values[1], c: values[2], d: values[3], e: values[4], f: values[5] };
      } else if (name === 'translate') {
        next.e = values[0] || 0;
        next.f = values[1] || 0;
      } else if (name === 'scale') {
        next.a = values[0] || 1;
        next.d = values.length > 1 ? (values[1] || 1) : (values[0] || 1);
      } else if (name === 'rotate') {
        const angle = (values[0] || 0) * Math.PI / 180;
        next = { a: Math.cos(angle), b: Math.sin(angle), c: -Math.sin(angle), d: Math.cos(angle), e: 0, f: 0 };
        if (values.length === 3) {
          const cx = values[1], cy = values[2];
          next = this.multiplySvgMatrices(
            this.multiplySvgMatrices({ a: 1, b: 0, c: 0, d: 1, e: cx, f: cy }, next),
            { a: 1, b: 0, c: 0, d: 1, e: -cx, f: -cy }
          );
        }
      } else if (name === 'skewx') {
        next.c = Math.tan((values[0] || 0) * Math.PI / 180);
      } else if (name === 'skewy') {
        next.b = Math.tan((values[0] || 0) * Math.PI / 180);
      }

      matrix = this.multiplySvgMatrices(matrix, next);
    }
    return matrix;
  },

  getNodeSvgMatrix: function(node) {
    const ancestors = [];
    let current = node;
    while (current) {
      if (current.nodeType === 1) ancestors.unshift(current);
      current = current.parentElement;
    }

    let matrix = this.identitySvgMatrix();
    ancestors.forEach(element => {
      const local = this.parseSvgTransformList(element.getAttribute('transform'));
      matrix = this.multiplySvgMatrices(matrix, local);
    });
    return matrix;
  },

  convertNodeToPathStrings: function(node) {
    const tag = node.tagName.toLowerCase();

    if (tag === 'path') {
      const d = (node.getAttribute('d') || '').trim();
      return d ? [d] : [];
    }

    if (tag === 'line') {
      const x1 = node.getAttribute('x1') || 0;
      const y1 = node.getAttribute('y1') || 0;
      const x2 = node.getAttribute('x2') || 0;
      const y2 = node.getAttribute('y2') || 0;
      return [`M ${x1} ${y1} L ${x2} ${y2}`];
    }

    if (tag === 'polyline' || tag === 'polygon') {
      const rawPoints = (node.getAttribute('points') || '').trim();
      const coords = rawPoints.split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n));
      if (coords.length < 4) return [];

      let d = `M ${coords[0]} ${coords[1]}`;
      for (let i = 2; i < coords.length; i += 2) {
        d += ` L ${coords[i]} ${coords[i + 1]}`;
      }
      if (tag === 'polygon') d += ' Z';
      return [d];
    }

    if (tag === 'rect') {
      const x = parseFloat(node.getAttribute('x') || 0);
      const y = parseFloat(node.getAttribute('y') || 0);
      const w = parseFloat(node.getAttribute('width') || 0);
      const h = parseFloat(node.getAttribute('height') || 0);
      return [`M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`];
    }

    if (tag === 'circle') {
      const cx = parseFloat(node.getAttribute('cx') || 0);
      const cy = parseFloat(node.getAttribute('cy') || 0);
      const r = parseFloat(node.getAttribute('r') || 0);
      if (r <= 0) return [];
      return [`M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy}`];
    }

    if (tag === 'ellipse') {
      const cx = parseFloat(node.getAttribute('cx') || 0);
      const cy = parseFloat(node.getAttribute('cy') || 0);
      const rx = parseFloat(node.getAttribute('rx') || 0);
      const ry = parseFloat(node.getAttribute('ry') || 0);
      if (rx <= 0 || ry <= 0) return [];
      return [`M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`];
    }

    return [];
  },

  updateModalUI: function() {
    const previewBox = document.getElementById('svgGenPreviewSvg');
    const colorMappingList = document.getElementById('svgGenColorList');
    const statsLabel = document.getElementById('svgGenStats');
    const targetWidthInp = document.getElementById('svgGenTargetWidth');

    if (previewBox) {
      previewBox.innerHTML = this.currentSvgString || '<div style="color:#94a3b8;padding:20px;">Нема вчитано SVG</div>';
    }

    if (targetWidthInp) {
      if (this.detectedPhysicalWidthMm && this.detectedPhysicalWidthMm > 0) {
        targetWidthInp.value = this.detectedPhysicalWidthMm;
      } else {
        const detectedW = this.svgBounds ? Math.round(this.svgBounds.width) : 50;
        targetWidthInp.value = Math.min(Math.max(detectedW, 20), 150);
      }
    }

    const fillsCount = this.detectedFillColors.length;
    const strokesCount = this.detectedStrokeColors.length;

    if (statsLabel) {
      let dimText = this.detectedPhysicalWidthMm ? `${this.detectedPhysicalWidthMm} × ${this.detectedPhysicalHeightMm} mm` : `${Math.round(this.svgBounds.width)} × ${Math.round(this.svgBounds.height)} pt`;
      statsLabel.innerText = `Димензии: ${dimText} | Полиња за полнење: ${fillsCount} | Линии: ${strokesCount}`;
    }

    if (colorMappingList) {
      colorMappingList.innerHTML = '';
      const colorsToShow = fillsCount > 0 ? this.detectedFillColors : this.detectedStrokeColors;

      if (colorsToShow.length === 0) {
        colorMappingList.innerHTML = '<span style="color:#64748b;font-size:11px;">Не се детектирани бои. Ќе се користи Боја 1.</span>';
      } else {
        const dispensers = CNCApp.State.machine.dispensers || [];
        colorsToShow.forEach(hex => {
          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.alignItems = 'center';
          row.style.marginBottom = '5px';
          row.style.padding = '4px 6px';
          row.style.background = '#ffffff';
          row.style.borderRadius = '4px';
          row.style.border = '1px solid #e2e8f0';

          const mappedDisp = this.colorMapping.get(hex);
          const currentDispId = (mappedDisp !== undefined && mappedDisp !== null) ? mappedDisp : 1;
          const esc = (CNCApp.State && typeof CNCApp.State.escapeHtml === 'function')
            ? CNCApp.State.escapeHtml
            : function(s) { return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };

          let dispOptions = `<option value="0" ${currentDispId === 0 ? 'selected' : ''}>🚫 Игнорирај (Не пополнувај)</option>`;
          dispOptions += dispensers.map(d =>
            `<option value="${d.id}" ${d.id === currentDispId ? 'selected' : ''}>${esc(d.name)} (${esc(d.color)})</option>`
          ).join('');

          row.innerHTML = `
            <span style="display:inline-block;width:18px;height:18px;border-radius:4px;background:${hex};border:1px solid #94a3b8;box-shadow:0 1px 2px rgba(0,0,0,0.15);margin-right:8px;"></span>
            <span style="font-family:monospace;font-size:11px;min-width:65px;font-weight:600;color:#1e293b;margin-right:8px;">${hex}</span>
            <span style="font-size:11px;color:#64748b;margin-right:8px;">➔ Диспензер:</span>
            <select class="inp inp-sm" style="flex:1;">
              ${dispOptions}
            </select>
          `;

          const sel = row.querySelector('select');
          sel.onchange = (e) => {
            this.colorMapping.set(hex, parseInt(e.target.value));
          };

          colorMappingList.appendChild(row);
        });
      }
    }
  },

  computeEDT: function(binaryGrid, w, h) {
    const inf = 1e9;
    const d1 = new Float32Array(w * h);

    for (let x = 0; x < w; x++) {
      let dist = inf;
      for (let y = 0; y < h; y++) {
        dist = binaryGrid[y * w + x] === 0 ? 0 : dist + 1;
        d1[y * w + x] = dist;
      }
      dist = inf;
      for (let y = h - 1; y >= 0; y--) {
        dist = binaryGrid[y * w + x] === 0 ? 0 : dist + 1;
        if (dist < d1[y * w + x]) d1[y * w + x] = dist;
      }
    }

    const dt = new Float32Array(w * h);
    const s = new Float32Array(w);
    const t = new Int32Array(w);

    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      let q = 0;
      s[0] = -inf;
      t[0] = 0;

      for (let u = 1; u < w; u++) {
        const f_u = d1[rowOffset + u] * d1[rowOffset + u];
        while (q >= 0) {
          const t_q = t[q];
          const f_t = d1[rowOffset + t_q] * d1[rowOffset + t_q];
          const sep = (f_u - f_t + u * u - t_q * t_q) / (2.0 * (u - t_q));
          if (sep <= s[q]) {
            q--;
          } else {
            q++;
            t[q] = u;
            s[q] = sep;
            break;
          }
        }
        if (q < 0) {
          q = 0;
          t[0] = u;
          s[0] = -inf;
        }
      }

      for (let u = w - 1; u >= 0; u--) {
        while (q > 0 && s[q] > u) q--;
        const t_q = t[q];
        const d1Val = d1[rowOffset + t_q];
        dt[rowOffset + u] = Math.sqrt(d1Val * d1Val + (u - t_q) * (u - t_q));
      }
    }

    return dt;
  },

  samplePocketMedialAxis: function(pathsForColor, options) {
    const {
      targetWidthMm = 60,
      targetHeightMm = 40,
      stepMm = 2.0,
      minClearanceMm = 0.18,
      tipMarginMm = 0.8,
      invertY = true,
      offsetX = 0,
      offsetY = 0,
      canvasResolution: requestedRes = 20,
      enableRdp = true,
      rdpToleranceMm = 0.08
    } = options;

    // Безбедносно ограничување на растерската меморија за екстремно големи табли (XP 32-bit заштита)
    const maxDimMm = Math.max(targetWidthMm, targetHeightMm, 1);
    const canvasResolution = (maxDimMm * requestedRes > 3200)
      ? Math.max(8, Math.floor(3200 / maxDimMm))
      : requestedRes;

    const bounds = this.svgBounds;
    const canvasW = Math.max(10, Math.ceil(targetWidthMm * canvasResolution));
    const canvasH = Math.max(10, Math.ceil(targetHeightMm * canvasResolution));

    const offCanvas = document.createElement('canvas');
    offCanvas.width = canvasW;
    offCanvas.height = canvasH;
    const ctx = offCanvas.getContext('2d');
    if (!ctx) return [];

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasW, canvasH);

    ctx.save();
    const scaleX = canvasW / bounds.width;
    const scaleY = canvasH / bounds.height;
    ctx.scale(scaleX, scaleY);
    ctx.translate(-bounds.minX, -bounds.minY);

    ctx.fillStyle = '#000000';
    for (let pObj of pathsForColor) {
      try {
        const p2d = new Path2D(pObj.d);
        const m = pObj.svgMatrix || this.identitySvgMatrix();
        ctx.save();
        ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
        ctx.fill(p2d, 'evenodd');
        ctx.restore();
      } catch (e) {}
    }
    ctx.restore();

    const imgData = ctx.getImageData(0, 0, canvasW, canvasH);
    const pixels = imgData.data;
    const binaryGrid = new Uint8Array(canvasW * canvasH);

    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] < 128 && pixels[i + 3] > 128) {
        binaryGrid[i / 4] = 1;
      }
    }

    const islandGrid = new Int32Array(canvasW * canvasH);
    let nextIslandId = 1;
    const islandMeta = new Map();

    const dx8 = [-1, 0, 1, -1, 1, -1, 0, 1];
    const dy8 = [-1, -1, -1, 0, 0, 1, 1, 1];

    for (let y = 0; y < canvasH; y++) {
      const row = y * canvasW;
      for (let x = 0; x < canvasW; x++) {
        const idx = row + x;
        if (binaryGrid[idx] === 1 && islandGrid[idx] === 0) {
          const currentId = nextIslandId++;
          let count = 0;
          let minX = x, maxX = x, minY = y, maxY = y;

          const queue = [idx];
          islandGrid[idx] = currentId;
          let qHead = 0;

          while (qHead < queue.length) {
            const curr = queue[qHead++];
            count++;
            const cx = curr % canvasW;
            const cy = Math.floor(curr / canvasW);

            if (cx < minX) minX = cx;
            if (cx > maxX) maxX = cx;
            if (cy < minY) minY = cy;
            if (cy > maxY) maxY = cy;

            for (let k = 0; k < 8; k++) {
              const nx = cx + dx8[k];
              const ny = cy + dy8[k];
              if (nx >= 0 && nx < canvasW && ny >= 0 && ny < canvasH) {
                const nIdx = ny * canvasW + nx;
                if (binaryGrid[nIdx] === 1 && islandGrid[nIdx] === 0) {
                  islandGrid[nIdx] = currentId;
                  queue.push(nIdx);
                }
              }
            }
          }

          islandMeta.set(currentId, {
            id: currentId,
            minX: minX,
            maxX: maxX,
            minY: minY,
            maxY: maxY,
            pixelCount: count,
            centerX: (minX + maxX) / 2,
            centerY: (minY + maxY) / 2
          });
        }
      }
    }

    const edt = this.computeEDT(binaryGrid, canvasW, canvasH);

    for (let y = 0; y < canvasH; y++) {
      const row = y * canvasW;
      for (let x = 0; x < canvasW; x++) {
        const iId = islandGrid[row + x];
        if (iId > 0) {
          const d = edt[row + x];
          const meta = islandMeta.get(iId);
          if (meta && (!meta.peakD || d > meta.peakD)) {
            meta.peakD = d;
            meta.peakX = x;
            meta.peakY = y;
          }
        }
      }
    }

    const minClearancePx = minClearanceMm * canvasResolution;
    const tipMarginPx = (tipMarginMm || 0.8) * canvasResolution;
    const probeR = Math.max(3, Math.round(1.2 * canvasResolution));
    const probeRSq = probeR * probeR;

    const candidates = [];

    for (let y = 2; y < canvasH - 2; y++) {
      const row = y * canvasW;
      for (let x = 2; x < canvasW - 2; x++) {
        const d = edt[row + x];
        if (d < minClearancePx) continue;

        const iId = islandGrid[row + x] || 1;
        const iMeta = islandMeta.get(iId);

        const isRidge = (
          (d >= edt[row + x - 1] && d >= edt[row + x + 1]) ||
          (d >= edt[(y - 1) * canvasW + x] && d >= edt[(y + 1) * canvasW + x]) ||
          (d >= edt[(y - 1) * canvasW + x - 1] && d >= edt[(y + 1) * canvasW + x + 1]) ||
          (d >= edt[(y - 1) * canvasW + x + 1] && d >= edt[(y + 1) * canvasW + x - 1])
        );

        if (!isRidge && d < minClearancePx * 1.4) continue;

        let sumDx = 0, sumDy = 0, count = 0;
        const yStart = Math.max(0, y - probeR);
        const yEnd = Math.min(canvasH - 1, y + probeR);
        for (let py = yStart; py <= yEnd; py++) {
          const dy = py - y;
          const maxDx = Math.floor(Math.sqrt(probeRSq - dy * dy));
          const pRow = py * canvasW;
          const xStart = Math.max(0, x - maxDx);
          const xEnd = Math.min(canvasW - 1, x + maxDx);
          for (let px = xStart; px <= xEnd; px++) {
            if (binaryGrid[pRow + px] === 1) {
              sumDx += (px - x);
              sumDy += dy;
              count++;
            }
          }
        }

        const meanDx = count > 0 ? (sumDx / count) : 0;
        const meanDy = count > 0 ? (sumDy / count) : 0;
        const offsetDist = Math.hypot(meanDx, meanDy);

        const isSmallIsland = (iMeta && iMeta.pixelCount < 80);
        const isNarrowTip = (d < 0.7 * canvasResolution && offsetDist > probeR * 0.3);
        if (!isSmallIsland && !isNarrowTip && offsetDist > probeR * 0.35 && d < tipMarginPx) {
          continue;
        }

        const tipPenalty = (!isSmallIsland && !isNarrowTip) ? (offsetDist / probeR) * (canvasResolution * 0.5) : 0;
        const score = d - tipPenalty + (isRidge ? 2.5 : 0.0);

        candidates.push({ x, y, d, score, islandId: iId, isRidge });
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    const stepPx = Math.max(1, stepMm * canvasResolution);
    const narrowClearancePx = NARROW_CHANNEL_CLEARANCE_MM * canvasResolution;
    const islandSpacingPx = new Map();
    islandMeta.forEach(meta => {
      const isNarrowOnly = meta.peakD < narrowClearancePx;
      const needsSparseSampling = !isNarrowOnly && meta.pixelCount < SPARSE_FILL_AREA_PX2;
      const spacingFactor = isNarrowOnly ? 1.1 : (needsSparseSampling ? 1.65 : 1);
      islandSpacingPx.set(meta.id, stepPx * spacingFactor);
    });
    const gridCell = stepPx * 1.65;
    const gridW = Math.ceil(canvasW / gridCell);
    const spatialGrid = new Map();

    const selectedPoints = [];

    islandMeta.forEach(meta => {
      if (meta.peakD >= minClearancePx) {
        selectedPoints.push({
          x: meta.peakX,
          y: meta.peakY,
          d: meta.peakD,
          islandId: meta.id,
          islandPixelCount: meta.pixelCount,
          isPeak: true
        });
        const gx = Math.floor(meta.peakX / gridCell);
        const gy = Math.floor(meta.peakY / gridCell);
        const key = gy * gridW + gx;
        if (!spatialGrid.has(key)) spatialGrid.set(key, []);
        spatialGrid.get(key).push({ x: meta.peakX, y: meta.peakY, islandId: meta.id });
      }
    });

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const gx = Math.floor(c.x / gridCell);
      const gy = Math.floor(c.y / gridCell);

      let tooClose = false;
      const minSpacingPx = islandSpacingPx.get(c.islandId) || stepPx;
      const minSpacingSq = minSpacingPx * minSpacingPx;
      for (let dx = -1; dx <= 1 && !tooClose; dx++) {
        for (let dy = -1; dy <= 1 && !tooClose; dy++) {
          const key = (gy + dy) * gridW + (gx + dx);
          const list = spatialGrid.get(key);
          if (list) {
            for (let j = 0; j < list.length; j++) {
              const p = list[j];
              if (p.islandId === c.islandId) {
                const distSq = (c.x - p.x) * (c.x - p.x) + (c.y - p.y) * (c.y - p.y);
                if (distSq < minSpacingSq) {
                  tooClose = true;
                  break;
                }
              }
            }
          }
        }
      }

      if (!tooClose) {
        const iMeta760 = islandMeta.get(c.islandId);
        selectedPoints.push({
          x: c.x,
          y: c.y,
          d: c.d,
          islandId: c.islandId,
          islandPixelCount: (iMeta760 && iMeta760.pixelCount) || 40
        });
        const key = gy * gridW + gx;
        if (!spatialGrid.has(key)) spatialGrid.set(key, []);
        spatialGrid.get(key).push({ x: c.x, y: c.y, islandId: c.islandId });
      }
    }

    const islandsWithDeepNarrowRegions = new Set(
      selectedPoints
        .filter(point => point.d < DEEP_NARROW_CLEARANCE_MM * canvasResolution)
        .map(point => point.islandId)
    );
    const pinchClusterDistancePx = stepPx * 2;
    const pinchSnapDistancePx = stepPx * 0.8;
    const pinchClustersByIsland = new Map();
    for (const candidate of candidates) {
      const meta = islandMeta.get(candidate.islandId);
      if (!meta || meta.pixelCount < LOCAL_PINCH_MIN_AREA_PX2 ||
          !islandsWithDeepNarrowRegions.has(candidate.islandId) ||
          candidate.d < LOCAL_PINCH_CLEARANCE_MM * canvasResolution ||
          candidate.d >= narrowClearancePx || !candidate.isRidge) {
        continue;
      }

      const centerX = (meta.minX + meta.maxX) / 2;
      const centerY = (meta.minY + meta.maxY) / 2;
      const maxCenterDistance = Math.hypot(meta.maxX - meta.minX, meta.maxY - meta.minY) / 2;
      if (Math.hypot(candidate.x - centerX, candidate.y - centerY) < maxCenterDistance * 0.5) continue;

      const clusters = pinchClustersByIsland.get(candidate.islandId) || [];
      if (clusters.some(point => Math.hypot(candidate.x - point.x, candidate.y - point.y) < pinchClusterDistancePx)) {
        continue;
      }
      clusters.push(candidate);
      pinchClustersByIsland.set(candidate.islandId, clusters);
    }

    const islandsWithLocalizedPinches = new Set(
      Array.from(pinchClustersByIsland.entries())
        .filter(([, clusters]) => clusters.length <= MAX_LOCAL_PINCH_CLUSTERS_PER_ISLAND)
        .map(([islandId]) => islandId)
    );
    const pinchSeedsByIsland = new Map();
    for (const candidate of candidates) {
      const meta = islandMeta.get(candidate.islandId);
      if (!meta || meta.pixelCount < LOCAL_PINCH_MIN_AREA_PX2 ||
          !islandsWithDeepNarrowRegions.has(candidate.islandId) ||
          !islandsWithLocalizedPinches.has(candidate.islandId) ||
          candidate.d < LOCAL_PINCH_CLEARANCE_MM * canvasResolution ||
          candidate.d >= narrowClearancePx || !candidate.isRidge) {
        continue;
      }

      const centerX = (meta.minX + meta.maxX) / 2;
      const centerY = (meta.minY + meta.maxY) / 2;
      const maxCenterDistance = Math.hypot(meta.maxX - meta.minX, meta.maxY - meta.minY) / 2;
      if (Math.hypot(candidate.x - centerX, candidate.y - centerY) < maxCenterDistance * 0.5) continue;

      const islandPinches = pinchSeedsByIsland.get(candidate.islandId) || [];
      if (islandPinches.some(p => Math.hypot(candidate.x - p.x, candidate.y - p.y) < pinchClusterDistancePx)) {
        continue;
      }

      const nearbyPoint = selectedPoints
        .filter(p => p.islandId === candidate.islandId && !p.isLocalPinchCandidate)
        .sort((a, b) =>
          Math.hypot(candidate.x - a.x, candidate.y - a.y) -
          Math.hypot(candidate.x - b.x, candidate.y - b.y)
        )[0];
      if (nearbyPoint && Math.hypot(candidate.x - nearbyPoint.x, candidate.y - nearbyPoint.y) <= pinchSnapDistancePx) {
        nearbyPoint.x = candidate.x;
        nearbyPoint.y = candidate.y;
        nearbyPoint.d = candidate.d;
        nearbyPoint.isLocalPinchCandidate = true;
      } else {
        selectedPoints.push({
          x: candidate.x,
          y: candidate.y,
          d: candidate.d,
          islandId: candidate.islandId,
          islandPixelCount: meta.pixelCount,
          isLocalPinchCandidate: true
        });
      }
      islandPinches.push({ x: candidate.x, y: candidate.y });
      pinchSeedsByIsland.set(candidate.islandId, islandPinches);
    }

    if (selectedPoints.length === 0) return [];

    const relaxRadius = Math.round(stepPx * 0.95);
    const relaxRadiusSq = relaxRadius * relaxRadius;

    for (let iter = 0; iter < 2; iter++) {
      for (let i = 0; i < selectedPoints.length; i++) {
        const pt = selectedPoints[i];
        if (pt.isPeak || pt.isLocalPinchCandidate) continue;

        let sumX = 0, sumY = 0, cnt = 0;
        const xMin = Math.max(0, pt.x - relaxRadius);
        const xMax = Math.min(canvasW - 1, pt.x + relaxRadius);
        const yMin = Math.max(0, pt.y - relaxRadius);
        const yMax = Math.min(canvasH - 1, pt.y + relaxRadius);

        for (let py = yMin; py <= yMax; py++) {
          const rowP = py * canvasW;
          const dy = py - pt.y;
          for (let px = xMin; px <= xMax; px++) {
            if (binaryGrid[rowP + px] !== 1) continue;
            if (islandGrid[rowP + px] !== pt.islandId) continue;
            const dx = px - pt.x;
            const dSq = dx * dx + dy * dy;
            if (dSq > relaxRadiusSq) continue;

            let closestDistSq = dSq;
            let isClosest = true;
            for (let j = 0; j < selectedPoints.length; j++) {
              if (i === j) continue;
              const other = selectedPoints[j];
              if (other.islandId !== pt.islandId) continue;
              const odx = px - other.x;
              const ody = py - other.y;
              const otherDistSq = odx * odx + ody * ody;
              if (otherDistSq < closestDistSq) {
                isClosest = false;
                break;
              }
            }

            if (isClosest) {
              sumX += px;
              sumY += py;
              cnt++;
            }
          }
        }

        if (cnt > 5) {
          const targetCx = Math.round(sumX / cnt);
          const targetCy = Math.round(sumY / cnt);

          let bestX = targetCx;
          let bestY = targetCy;
          let bestD = edt[targetCy * canvasW + targetCx] || 0;

          for (let sy = Math.max(1, targetCy - 6); sy <= Math.min(canvasH - 2, targetCy + 6); sy++) {
            const sRow = sy * canvasW;
            for (let sx = Math.max(1, targetCx - 6); sx <= Math.min(canvasW - 2, targetCx + 6); sx++) {
              if (binaryGrid[sRow + sx] === 1 && islandGrid[sRow + sx] === pt.islandId) {
                const sD = edt[sRow + sx];
                if (sD > bestD) {
                  bestD = sD;
                  bestX = sx;
                  bestY = sy;
                }
              }
            }
          }

          if (bestD >= minClearancePx && bestD >= pt.d * 0.85) {
            pt.x = bestX;
            pt.y = bestY;
            pt.d = bestD;
          }
        }
      }
    }

    const mmPoints = selectedPoints.map(sp => {
      const normX = sp.x / canvasResolution;
      let normY = sp.y / canvasResolution;
      if (invertY) {
        normY = targetHeightMm - normY;
      }
      return {
        x: parseFloat((normX + offsetX).toFixed(3)),
        y: parseFloat((normY + offsetY).toFixed(3)),
        clearance: parseFloat((sp.d / canvasResolution).toFixed(3)),
        islandId: sp.islandId || 1,
        islandPixelCount: sp.islandPixelCount || 40,
        isPeak: sp.isPeak,
        isLocalPinchCandidate: sp.isLocalPinchCandidate,
        px: sp.x,
        py: sp.y,
        resScale: canvasResolution
      };
    });

    const pointsByIsland = new Map();
    for (let pt of mmPoints) {
      const iId = pt.islandId || 1;
      if (!pointsByIsland.has(iId)) {
        pointsByIsland.set(iId, []);
      }
      pointsByIsland.get(iId).push(pt);
    }

    const islandList = [];
    pointsByIsland.forEach((pts, iId) => {
      let sumX = 0, sumY = 0;
      pts.forEach(p => { sumX += p.x; sumY += p.y; });
      islandList.push({
        id: iId,
        points: pts,
        avgX: sumX / pts.length,
        avgY: sumY / pts.length
      });
    });

    function isLineSegmentClear(x1, y1, x2, y2, targetIslandId, minWallDist) {
      if (minWallDist === undefined) minWallDist = 1.0;
      const dist = Math.hypot(x2 - x1, y2 - y1);
      const steps = Math.max(4, Math.ceil(dist * 1.5));
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const cx = Math.round(x1 + t * (x2 - x1));
        const cy = Math.round(y1 + t * (y2 - y1));
        if (cx < 0 || cx >= canvasW || cy < 0 || cy >= canvasH) return false;
        const idx = cy * canvasW + cx;
        if (binaryGrid[idx] !== 1) return false;
        if (targetIslandId && islandGrid && islandGrid[idx] !== targetIslandId) return false;
        if (minWallDist > 0 && edt[idx] < minWallDist) return false;
      }
      return true;
    }

    function findCornerWaypoint(pA, pB, islandId) {
      let bestCand = null;
      let bestCost = Infinity;

      const minX = Math.min(pA.px, pB.px) - 30;
      const maxX = Math.max(pA.px, pB.px) + 30;
      const minY = Math.min(pA.py, pB.py) - 30;
      const maxY = Math.max(pA.py, pB.py) + 30;

      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        if (c.islandId !== islandId) continue;
        if (c.d < minClearancePx) continue;
        if (c.x < minX || c.x > maxX || c.y < minY || c.y > maxY) continue;

        if (!isLineSegmentClear(pA.px, pA.py, c.x, c.y, islandId, 1.0)) continue;
        if (!isLineSegmentClear(c.x, c.y, pB.px, pB.py, islandId, 1.0)) continue;

        const d1 = Math.hypot(c.x - pA.px, c.y - pA.py);
        const d2 = Math.hypot(pB.px - c.x, pB.py - c.y);
        const detour = d1 + d2;
        const cost = detour - (c.d * 0.4);

        if (cost < bestCost) {
          bestCost = cost;
          bestCand = c;
        }
      }

      if (!bestCand) return null;

      const normX = bestCand.x / canvasResolution;
      let normY = bestCand.y / canvasResolution;
      if (invertY) {
        normY = targetHeightMm - normY;
      }

      return {
        x: parseFloat((normX + offsetX).toFixed(3)),
        y: parseFloat((normY + offsetY).toFixed(3)),
        clearance: parseFloat((bestCand.d / canvasResolution).toFixed(3)),
        islandId: islandId,
        islandPixelCount: pA.islandPixelCount || 40,
        isCornerWaypoint: true,
        islandIndex: pA.islandIndex,
        px: bestCand.x,
        py: bestCand.y
      };
    }

    const rawOrdered = [];
    let currentHeadX = 0;
    let currentHeadY = invertY ? targetHeightMm : 0;
    let islandOrderNum = 1;
    let strokeOrderNum = 1;

    while (islandList.length > 0) {
      let bestIslandIdx = 0;
      let bestIslandCost = Infinity;

      for (let i = 0; i < islandList.length; i++) {
        const isl = islandList[i];
        let minEntryDist = Infinity;
        for (let p of isl.points) {
          const dx = p.x - currentHeadX;
          const dy = (p.y - currentHeadY) * 1.35;
          const cost = Math.hypot(dx, dy);
          if (cost < minEntryDist) minEntryDist = cost;
        }
        if (minEntryDist < bestIslandCost) {
          bestIslandCost = minEntryDist;
          bestIslandIdx = i;
        }
      }

      const activeIsland = islandList.splice(bestIslandIdx, 1)[0];
      const islandPoints = activeIsland.points;
      const sourceIsland = islandMeta.get(activeIsland.id);
      const maxConnectedDistance = stepMm *
        ((sourceIsland && sourceIsland.peakD >= narrowClearancePx) ? 4 : 2.5);
      const possibleNeighbors = islandPoints.map(() => []);

      for (let i = 0; i < islandPoints.length; i++) {
        for (let j = i + 1; j < islandPoints.length; j++) {
          const pointA = islandPoints[i];
          const pointB = islandPoints[j];
          const distance = Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);
          if (distance <= maxConnectedDistance &&
              isLineSegmentClear(pointA.px, pointA.py, pointB.px, pointB.py, activeIsland.id, 0.8)) {
            possibleNeighbors[i].push({ index: j, distance });
            possibleNeighbors[j].push({ index: i, distance });
          }
        }
      }

      const preferredNeighbors = possibleNeighbors.map((neighbors, pointIndex) => {
        if (neighbors.length <= 2) return neighbors.map(neighbor => neighbor.index);

        let bestPair = null;
        let bestScore = Infinity;
        for (let i = 0; i < neighbors.length; i++) {
          for (let j = i + 1; j < neighbors.length; j++) {
            const origin = islandPoints[pointIndex];
            const first = islandPoints[neighbors[i].index];
            const second = islandPoints[neighbors[j].index];
            const ax = first.x - origin.x, ay = first.y - origin.y;
            const bx = second.x - origin.x, by = second.y - origin.y;
            const lengths = Math.hypot(ax, ay) * Math.hypot(bx, by);
            const cosine = lengths > 0 ? (ax * bx + ay * by) / lengths : 1;
            const score = cosine + (neighbors[i].distance + neighbors[j].distance) / (maxConnectedDistance * 100);
            if (score < bestScore) {
              bestScore = score;
              bestPair = [neighbors[i].index, neighbors[j].index];
            }
          }
        }
        return bestPair || [neighbors[0].index];
      });

      const routeNeighbors = islandPoints.map(() => []);
      for (let i = 0; i < preferredNeighbors.length; i++) {
        for (const neighborIndex of preferredNeighbors[i]) {
          if (preferredNeighbors[neighborIndex].includes(i)) {
            routeNeighbors[i].push(neighborIndex);
          }
        }
      }

      for (let i = 0; i < routeNeighbors.length; i++) {
        if (routeNeighbors[i].length > 0) continue;
        const nearest = possibleNeighbors[i]
          .filter(neighbor => routeNeighbors[neighbor.index].length < 2)
          .sort((a, b) => a.distance - b.distance)[0];
        if (nearest) {
          routeNeighbors[i].push(nearest.index);
          routeNeighbors[nearest.index].push(i);
        }
      }

      const pointComponents = [];
      const componentVisited = new Set();
      for (let i = 0; i < islandPoints.length; i++) {
        if (componentVisited.has(i)) continue;
        const component = [];
        const queue = [i];
        componentVisited.add(i);
        for (let q = 0; q < queue.length; q++) {
          const current = queue[q];
          component.push(current);
          for (const neighbor of routeNeighbors[current]) {
            if (!componentVisited.has(neighbor)) {
              componentVisited.add(neighbor);
              queue.push(neighbor);
            }
          }
        }
        pointComponents.push(component);
      }

      function tracePointRoute(component, startIndex) {
        const componentSet = new Set(component);
        const route = [];
        const visited = new Set();
        let previousIndex = -1;
        let currentIndex = startIndex;
        while (currentIndex >= 0 && !visited.has(currentIndex)) {
          route.push(islandPoints[currentIndex]);
          visited.add(currentIndex);
          const nextCandidates = routeNeighbors[currentIndex]
            .filter(index => componentSet.has(index) && index !== previousIndex && !visited.has(index));
          if (nextCandidates.length === 0) break;
          if (nextCandidates.length > 1) {
            const current = islandPoints[currentIndex];
            if (previousIndex < 0) {
              nextCandidates.sort((a, b) =>
                Math.hypot(islandPoints[a].x - current.x, islandPoints[a].y - current.y) -
                Math.hypot(islandPoints[b].x - current.x, islandPoints[b].y - current.y)
              );
            } else {
              const previous = islandPoints[previousIndex];
              const incomingX = current.x - previous.x, incomingY = current.y - previous.y;
              const incomingLength = Math.hypot(incomingX, incomingY);
              nextCandidates.sort((a, b) => {
                const nextA = islandPoints[a], nextB = islandPoints[b];
                const scoreA = (incomingX * (nextA.x - current.x) + incomingY * (nextA.y - current.y)) /
                  (incomingLength * Math.hypot(nextA.x - current.x, nextA.y - current.y));
                const scoreB = (incomingX * (nextB.x - current.x) + incomingY * (nextB.y - current.y)) /
                  (incomingLength * Math.hypot(nextB.x - current.x, nextB.y - current.y));
                return scoreB - scoreA;
              });
            }
          }
          previousIndex = currentIndex;
          currentIndex = nextCandidates[0];
        }
        return route;
      }

      const pendingComponents = pointComponents.slice();
      while (pendingComponents.length > 0) {
        let bestComponentIndex = 0;
        let bestRoute = null;
        let bestEntryCost = Infinity;

        for (let i = 0; i < pendingComponents.length; i++) {
          const component = pendingComponents[i];
          const endpoints = component.filter(index => routeNeighbors[index].length <= 1);
          const starts = endpoints.length > 0 ? endpoints : component;
          for (const startIndex of starts) {
            const route = tracePointRoute(component, startIndex);
            if (route.length !== component.length) continue;
            const entryCost = Math.hypot(route[0].x - currentHeadX, (route[0].y - currentHeadY) * 1.35);
            if (entryCost < bestEntryCost) {
              bestEntryCost = entryCost;
              bestComponentIndex = i;
              bestRoute = route;
            }
          }
        }

        if (!bestRoute) {
          const component = pendingComponents[0];
          bestRoute = component.map(index => islandPoints[index]);
          bestComponentIndex = 0;
        }

        bestRoute.forEach(point => {
          point.islandIndex = islandOrderNum;
          point.strokeId = strokeOrderNum;
          rawOrdered.push(point);
          currentHeadX = point.x;
          currentHeadY = point.y;
        });
        strokeOrderNum++;
        pendingComponents.splice(bestComponentIndex, 1);
      }

      islandOrderNum++;
    }

    const ordered = [];
    for (let i = 0; i < rawOrdered.length; i++) {
      ordered.push(rawOrdered[i]);
      if (i < rawOrdered.length - 1) {
        const p1 = rawOrdered[i];
        const p2 = rawOrdered[i + 1];
        if (p1.islandIndex === p2.islandIndex && p1.strokeId === p2.strokeId) {
          if (!isLineSegmentClear(p1.px, p1.py, p2.px, p2.py, p1.islandId, 1.0)) {
            const cornerWp = findCornerWaypoint(p1, p2, p1.islandId);
            if (cornerWp) {
              cornerWp.strokeId = p1.strokeId;
              ordered.push(cornerWp);
            }
          }
        }
      }
    }

    for (let i = 0; i < ordered.length - 1; i++) {
      const pCurr = ordered[i];
      const pNext = ordered[i + 1];

      if (pCurr.islandIndex === pNext.islandIndex && pCurr.strokeId === pNext.strokeId) {
        const dMm = Math.hypot(pNext.x - pCurr.x, pNext.y - pCurr.y);
        const sourceIsland = islandMeta.get(pCurr.islandId);
        const maxConnectedDistance = stepMm *
          ((sourceIsland && sourceIsland.peakD >= narrowClearancePx) ? 4 : 2.5);
        if (dMm <= maxConnectedDistance && isLineSegmentClear(pCurr.px, pCurr.py, pNext.px, pNext.py, pCurr.islandId, 0.8)) {
          pCurr.connectedNext = true;
          pNext.connectedPrev = true;
        }
      }
    }

    const simplified = [];

    if (!enableRdp) {
      simplified.push(...ordered);
    } else {
      let chainStart = 0;
      while (chainStart < ordered.length) {
        let chainEnd = chainStart;
        while (chainEnd < ordered.length - 1 &&
               ordered[chainEnd].connectedNext &&
               ordered[chainEnd + 1].islandIndex === ordered[chainEnd].islandIndex &&
               ordered[chainEnd + 1].strokeId === ordered[chainEnd].strokeId) {
          chainEnd++;
        }

        const chain = ordered.slice(chainStart, chainEnd + 1);
        if (chain.length <= 2) {
          chain.forEach(pt => simplified.push(pt));
        } else {
          function rdp(pts, eps) {
            if (pts.length <= 2) return pts;
            const pFirst = pts[0];
            const pLast = pts[pts.length - 1];
            const lineLen = Math.hypot(pLast.x - pFirst.x, pLast.y - pFirst.y);
            let dMax = 0;
            let idxMax = 0;

            for (let k = 1; k < pts.length - 1; k++) {
              const pt = pts[k];
              let d = 0;
              if (lineLen < 0.0001) {
                d = Math.hypot(pt.x - pFirst.x, pt.y - pFirst.y);
              } else {
                d = Math.abs((pLast.y - pFirst.y) * pt.x - (pLast.x - pFirst.x) * pt.y + pLast.x * pFirst.y - pLast.y * pFirst.x) / lineLen;
              }
              if (d > dMax) {
                dMax = d;
                idxMax = k;
              }
            }

            const hasImportantWaypoint = pts.slice(1, pts.length - 1).some((p, index) => {
              if (p.isCornerWaypoint || p.isLocalPinchCandidate) return true;
              if (!p.isPeak) return false;
              const prevClearance = pts[index].clearance;
              const nextClearance = pts[index + 2].clearance;
              return p.clearance > Math.max(prevClearance, nextClearance) + 0.3;
            });
            if (!hasImportantWaypoint && dMax <= eps && isLineSegmentClear(pFirst.px, pFirst.py, pLast.px, pLast.py, pFirst.islandId, 1.0)) {
              pFirst.connectedNext = true;
              pLast.connectedPrev = true;
              return [pFirst, pLast];
            }

            if (idxMax === 0) return [pFirst, pLast];

            const leftPart = rdp(pts.slice(0, idxMax + 1), eps);
            const rightPart = rdp(pts.slice(idxMax), eps);
            return leftPart.slice(0, leftPart.length - 1).concat(rightPart);
          }

          const rdpSimplified = rdp(chain, rdpToleranceMm);

          for (let k = 0; k < rdpSimplified.length; k++) {
            if (k > 0) rdpSimplified[k].connectedPrev = true;
            if (k < rdpSimplified.length - 1) rdpSimplified[k].connectedNext = true;
            simplified.push(rdpSimplified[k]);
          }
        }
        chainStart = chainEnd + 1;
      }
    }

    // Детекција на остри агли (< 73°) — точките ОСТАНУВААТ СТРОГО на медијалната оска со безбеден клиренс
    for (let i = 1; i < simplified.length - 1; i++) {
      const pPrev = simplified[i - 1];
      const pCurr = simplified[i];
      const pNext = simplified[i + 1];

      if (pCurr.connectedPrev && pCurr.connectedNext &&
          pPrev.islandIndex === pCurr.islandIndex && pCurr.islandIndex === pNext.islandIndex &&
          pPrev.strokeId === pCurr.strokeId && pCurr.strokeId === pNext.strokeId) {
        const v1x = pCurr.x - pPrev.x;
        const v1y = pCurr.y - pPrev.y;
        const v2x = pNext.x - pCurr.x;
        const v2y = pNext.y - pCurr.y;
        const l1 = Math.hypot(v1x, v1y);
        const l2 = Math.hypot(v2x, v2y);

        if (l1 > 0.05 && l2 > 0.05) {
          const u1x = v1x / l1;
          const u1y = v1y / l1;
          const u2x = v2x / l2;
          const u2y = v2y / l2;
          const dot = u1x * u2x + u1y * u2y;

          if (dot < -0.3) {
            pCurr.isAcuteCorner = true;
          }
          if (l1 >= 4.0 || l2 >= 4.0) {
            pCurr.isLongStraightSegment = true;
          }
        }
      }
    }

    for (let i = 0; i < simplified.length - 1; i++) {
      const pA = simplified[i];
      const pB = simplified[i + 1];
      const dist = Math.hypot(pB.x - pA.x, pB.y - pA.y);
      const samePocket = (pA.islandIndex === pB.islandIndex);
      const sameStroke = pA.strokeId === pB.strokeId;
      const clearLine = isLineSegmentClear(pA.px, pA.py, pB.px, pB.py);
      pA.canInCavitySkimToNext = sameStroke && ((samePocket && dist <= 5.0) || (clearLine && dist <= 15.0));
    }

    for (let i = simplified.length - 1; i >= 0; i--) {
      const point = simplified[i];
      const meta = islandMeta.get(point.islandId);
      if (meta && meta.pixelCount >= LOCAL_PINCH_MIN_AREA_PX2 &&
          meta.peakD >= narrowClearancePx && point.clearance < narrowClearancePx &&
          !point.isPeak && !point.isLocalPinchCandidate &&
          !point.connectedPrev && !point.connectedNext &&
          !point.canInCavitySkimToNext) {
        simplified.splice(i, 1);
      }
    }

    for (let i = 0; i < simplified.length - 1; i++) {
      const pA = simplified[i];
      const pB = simplified[i + 1];
      const dist = Math.hypot(pB.x - pA.x, pB.y - pA.y);
      const samePocket = (pA.islandIndex === pB.islandIndex);
      const sameStroke = pA.strokeId === pB.strokeId;
      const clearLine = isLineSegmentClear(pA.px, pA.py, pB.px, pB.py);
      pA.canInCavitySkimToNext = sameStroke && ((samePocket && dist <= 5.0) || (clearLine && dist <= 15.0));
    }

    // Строга гаранција за безбедносен клиренс од ѕидовите
    for (let pt of simplified) {
      const d = edt[pt.py * canvasW + pt.px];
      if (d < minClearancePx) {
        let bestPx = pt.px, bestPy = pt.py, bestD = d;
        let found = false;
        for (let r = 1; r <= 15 && !found; r++) {
          for (let dy = -r; dy <= r && !found; dy++) {
            for (let dx = -r; dx <= r && !found; dx++) {
              const nx = pt.px + dx;
              const ny = pt.py + dy;
              if (nx >= 0 && nx < canvasW && ny >= 0 && ny < canvasH) {
                const nIdx = ny * canvasW + nx;
                if (binaryGrid[nIdx] === 1 && islandGrid[nIdx] === pt.islandId) {
                  const nd = edt[nIdx];
                  if (nd >= minClearancePx) {
                    bestPx = nx;
                    bestPy = ny;
                    bestD = nd;
                    found = true;
                  }
                }
              }
            }
          }
        }
        pt.px = bestPx;
        pt.py = bestPy;
        const normX = bestPx / canvasResolution;
        let normY = bestPy / canvasResolution;
        if (invertY) normY = targetHeightMm - normY;
        pt.x = parseFloat((normX + offsetX).toFixed(3));
        pt.y = parseFloat((normY + offsetY).toFixed(3));
        pt.clearance = parseFloat((bestD / canvasResolution).toFixed(3));
      }
    }

    const volumeStride = Math.max(1, Math.ceil(Math.sqrt((canvasW * canvasH) / 2500000)));
    const volumeW = Math.ceil(canvasW / volumeStride);
    const volumeH = Math.ceil(canvasH / volumeStride);
    const volumeCells = volumeW * volumeH;
    const volumeOwner = new Int32Array(volumeCells);
    const volumeQueue = new Int32Array(volumeCells);
    const fillAreas = new Float64Array(simplified.length);
    const cellAreaMm2 = (volumeStride * volumeStride) / (canvasResolution * canvasResolution);
    let queueTail = 0;

    function sourcePixelIndex(vx, vy) {
      const px = Math.min(canvasW - 1, vx * volumeStride + Math.floor(volumeStride / 2));
      const py = Math.min(canvasH - 1, vy * volumeStride + Math.floor(volumeStride / 2));
      return py * canvasW + px;
    }

    for (let i = 0; i < simplified.length; i++) {
      const point = simplified[i];
      let vx = Math.min(volumeW - 1, Math.floor(point.px / volumeStride));
      let vy = Math.min(volumeH - 1, Math.floor(point.py / volumeStride));
      let seed = sourcePixelIndex(vx, vy);
      if (binaryGrid[seed] !== 1 || islandGrid[seed] !== point.islandId || volumeOwner[vy * volumeW + vx]) {
        let found = false;
        for (let radius = 1; radius <= 2 && !found; radius++) {
          for (let dy = -radius; dy <= radius && !found; dy++) {
            for (let dx = -radius; dx <= radius && !found; dx++) {
              const nx = vx + dx, ny = vy + dy;
              if (nx < 0 || nx >= volumeW || ny < 0 || ny >= volumeH) continue;
              const nSeed = sourcePixelIndex(nx, ny);
              if (binaryGrid[nSeed] === 1 && islandGrid[nSeed] === point.islandId && !volumeOwner[ny * volumeW + nx]) {
                vx = nx;
                vy = ny;
                seed = nSeed;
                found = true;
              }
            }
          }
        }
        if (!found) continue;
      }

      const cell = vy * volumeW + vx;
      volumeOwner[cell] = i + 1;
      volumeQueue[queueTail++] = cell;
    }

    let queueHead = 0;
    while (queueHead < queueTail) {
      const cell = volumeQueue[queueHead++];
      const vx = cell % volumeW;
      const vy = Math.floor(cell / volumeW);
      const ownerId = volumeOwner[cell];
      const sourceIdx = sourcePixelIndex(vx, vy);
      const islandId = islandGrid[sourceIdx];
      fillAreas[ownerId - 1] += cellAreaMm2;

      for (let dy = -1; dy <= 1; dy++) {
        const ny = vy + dy;
        if (ny < 0 || ny >= volumeH) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = vx + dx;
          if (nx < 0 || nx >= volumeW) continue;
          const nextCell = ny * volumeW + nx;
          if (volumeOwner[nextCell]) continue;
          const nextIdx = sourcePixelIndex(nx, ny);
          if (binaryGrid[nextIdx] !== 1 || islandGrid[nextIdx] !== islandId) continue;
          volumeOwner[nextCell] = ownerId;
          volumeQueue[queueTail++] = nextCell;
        }
      }
    }

    simplified.forEach((point, index) => {
      point.fillAreaMm2 = fillAreas[index];
    });

    return simplified;
  },

  generatePoints: function(options) {
    let {
      mode = 'pockets',
      stepMm = 2.0,
      targetWidthMm = 60,
      invertY = true,
      offsetX = 0,
      offsetY = 0,
      speed = 650,
      travelNearSpeed = 1200,
      travelFarSpeed = 5000,
      minClearanceMm = 0.18,
      tipMarginMm = 0.8,
      dropTimeMs = 50,
      acuteTipDwellMs = 30,
      enableRdp = true,
      rdpToleranceMm = 0.08,
      depthMm = 1.0,
      flowRateQ = 16.5,
      useCapillary = true,
      autoVolumetricSpeed = true,
      groupByDispenser = true,
      adaptiveStep = false
    } = options;

    stepMm = Math.max(0.5, Math.min(10, Number(stepMm) || 2));
    targetWidthMm = Math.max(1, Math.min(1000, Number(targetWidthMm) || 60));
    minClearanceMm = Math.max(0.05, Math.min(10, Number(minClearanceMm) || 0.18));
    tipMarginMm = Math.max(0, Math.min(20, Number(tipMarginMm) || 0.8));
    speed = Math.max(50, Math.min(950, Math.round(Number(speed) || 650)));
    travelNearSpeed = Math.max(50, Math.min(9500, Math.round(Number(travelNearSpeed) || 1200)));
    travelFarSpeed = Math.max(50, Math.min(9500, Math.round(Number(travelFarSpeed) || 5000)));
    depthMm = Math.max(0.1, Math.min(20, Number(depthMm) || 1));
    flowRateQ = Math.max(0.1, Math.min(10000, Number(flowRateQ) || 16.5));

    if (!this.parsedShapes || this.parsedShapes.length === 0) {
      alert("⚠️ Нема детектирани векторски патеки во овој SVG фајл.");
      return [];
    }

    const bounds = this.svgBounds || { minX: 0, minY: 0, width: 100, height: 100 };
    const targetHeightMm = parseFloat(((targetWidthMm * bounds.height) / bounds.width).toFixed(3));

    if (mode === 'pockets') {
      const finalPoints = [];
      const narrowPointIndices = new Set();
      const dispenserGroupOffset = {};

      const shapesByFill = new Map();
      this.parsedShapes.forEach(shape => {
        if (!shape.fillColor) return;
        const fill = shape.fillColor;
        if (!shapesByFill.has(fill)) shapesByFill.set(fill, []);
        shapesByFill.get(fill).push(shape);
      });

      const sortedFills = Array.from(shapesByFill.keys()).sort((a, b) => {
        const mA = this.colorMapping.get(a);
        const mB = this.colorMapping.get(b);
        const dispA = (mA !== undefined && mA !== null) ? mA : 1;
        const dispB = (mB !== undefined && mB !== null) ? mB : 1;
        return dispA - dispB;
      });

      sortedFills.forEach((fillHex, groupIdx) => {
        const mFill = this.colorMapping.get(fillHex);
        const dispId = (mFill !== undefined && mFill !== null) ? mFill : 1;
        if (dispId <= 0) return;

        const shapes = shapesByFill.get(fillHex);
        const effectiveStepMm = adaptiveStep
          ? Math.max(0.5, Math.min(stepMm, minClearanceMm * 6))
          : stepMm;
        const sampledPoints = this.samplePocketMedialAxis(shapes, {
          targetWidthMm,
          targetHeightMm,
          stepMm: effectiveStepMm,
          minClearanceMm,
          tipMarginMm,
          invertY,
          offsetX,
          offsetY,
          canvasResolution: 20,
          enableRdp,
          rdpToleranceMm,
          acuteTipDwellMs
        });
        const maxClearanceByIsland = new Map();
        sampledPoints.forEach(sp => {
          const islandId = sp.islandIndex || 1;
          maxClearanceByIsland.set(islandId, Math.max(maxClearanceByIsland.get(islandId) || 0, sp.clearance || 0));
        });

        const baseGroupOffset = dispenserGroupOffset[dispId] || 0;
        let maxGroupNumForDisp = baseGroupOffset;

        sampledPoints.forEach((sp, pIdx) => {
          const ptObj = CNCApp.State.createPoint(sp.x, sp.y);
          ptObj.dispenser = dispId;
          ptObj.clearance = sp.clearance;
          const localIslandIdx = sp.islandIndex || (groupIdx + 1);
          const uniqueIslandNum = baseGroupOffset + localIslandIdx;
          if (uniqueIslandNum > maxGroupNumForDisp) maxGroupNumForDisp = uniqueIslandNum;
          ptObj.group1 = 'D' + dispId + '-' + uniqueIslandNum;
          ptObj.group2 = '';

          const isConnPrev = !!sp.connectedPrev;
          const isConnNext = !!sp.connectedNext;
          const islandId = sp.islandIndex || 1;
          const isNarrowIsland = (maxClearanceByIsland.get(islandId) || 0) < NARROW_CHANNEL_CLEARANCE_MM;
          const isLocalPinch = !!sp.isLocalPinchCandidate;
          const isNarrowDot = isNarrowIsland || isLocalPinch;
          const pointAreaMm2 = Math.max(0, sp.fillAreaMm2 || 0);
          const localWidthMm = Math.max(0.1, (sp.clearance || 0.5) * 2);
          const dropAreaMm2 = isNarrowDot ? localWidthMm * effectiveStepMm : pointAreaMm2;
          const pointVolumeMm3 = dropAreaMm2 * depthMm;
          const calculatedDropTime = Math.max(30, Math.min(1000,
            Math.round((pointVolumeMm3 / flowRateQ * 1000) / 10) * 10
          ));

          let supportLengthMm = 0;
          if (isConnPrev && pIdx > 0) {
            supportLengthMm += Math.hypot(sp.x - sampledPoints[pIdx - 1].x, sp.y - sampledPoints[pIdx - 1].y) / 2;
          }
          if (isConnNext && pIdx < sampledPoints.length - 1) {
            supportLengthMm += Math.hypot(sampledPoints[pIdx + 1].x - sp.x, sampledPoints[pIdx + 1].y - sp.y) / 2;
          }
          const movingCoverageMm2 = localWidthMm * supportLengthMm;
          const excessFillAreaMm2 = Math.max(0, pointAreaMm2 - movingCoverageMm2);
          const calculatedFillDwell = Math.max(0, Math.min(1000,
            Math.round((excessFillAreaMm2 * depthMm / flowRateQ * 1000) / 10) * 10
          ));

          const prevPtObj = finalPoints.length > 0 ? finalPoints[finalPoints.length - 1] : null;
          const canSkimToNext = (pIdx < sampledPoints.length - 1) && !!sp.canInCavitySkimToNext;
          const wasPrevSkimmedDown = prevPtObj && pIdx > 0 &&
            sampledPoints[pIdx - 1].strokeId === sp.strokeId &&
            prevPtObj.group1 === ptObj.group1 && !prevPtObj.raise;

          let lineBaseSpeed = speed;
          if (autoVolumetricSpeed) {
            const channelWidthMm = Math.max(0.1, localWidthMm);
            const idealSpeed = Math.round((60 * flowRateQ) / (channelWidthMm * depthMm));
            lineBaseSpeed = Math.max(50, Math.min(950, idealSpeed));
          }

          if (isConnPrev && isConnNext) {
            ptObj.lower = false;
            ptObj.valveStart = false;
            ptObj.time = sp.isAcuteCorner
              ? Math.max(acuteTipDwellMs || 30, calculatedFillDwell)
              : (calculatedFillDwell >= 30 ? calculatedFillDwell : '');
            ptObj.valveStop = false;
            ptObj.raise = false;
            ptObj.speed = lineBaseSpeed;
          } else if (!isConnPrev && isConnNext) {
            ptObj.lower = !wasPrevSkimmedDown;
            ptObj.valveStart = true;
            ptObj.time = calculatedFillDwell >= 30 ? calculatedFillDwell : '';
            ptObj.valveStop = false;
            ptObj.raise = false;
            ptObj.speed = lineBaseSpeed;
          } else if (isConnPrev && !isConnNext) {
            ptObj.lower = false;
            ptObj.valveStart = false;
            ptObj.time = calculatedFillDwell >= 30 ? calculatedFillDwell : '';
            ptObj.valveStop = true;
            ptObj.raise = !canSkimToNext;
            ptObj.speed = lineBaseSpeed;
          } else if (canSkimToNext) {
            ptObj.lower = !wasPrevSkimmedDown;
            ptObj.valveStart = true;
            ptObj.time = '';
            ptObj.valveStop = false;
            ptObj.raise = false;
            ptObj.speed = lineBaseSpeed;
          } else {
            ptObj.lower = !wasPrevSkimmedDown;
            ptObj.valveStart = true;
            ptObj.time = useCapillary ? calculatedDropTime : dropTimeMs;
            ptObj.valveStop = true;
            ptObj.raise = !canSkimToNext;
            ptObj.speed = lineBaseSpeed;
          }

          if (isNarrowDot) {
            narrowPointIndices.add(finalPoints.length);
            ptObj.lower = true;
            ptObj.valveStart = true;
            ptObj.time = useCapillary ? calculatedDropTime : dropTimeMs;
            ptObj.valveStop = true;
            ptObj.raise = true;
          }

          finalPoints.push(ptObj);
        });

        dispenserGroupOffset[dispId] = maxGroupNumForDisp;
      });

      if (finalPoints.length === 0) {
        alert("⚠️ Не беа пронајдени затворени полиња со доволна ширина за дозирање со овие параметри.");
        return [];
      }

      for (let i = 0; i < finalPoints.length; i++) {
        const point = finalPoints[i];
        if (!narrowPointIndices.has(i)) continue;
        const prev = finalPoints[i - 1];
        const next = finalPoints[i + 1];
        if (prev && prev.group1 === point.group1 && !narrowPointIndices.has(i - 1)) {
          prev.valveStop = true;
          prev.raise = true;
        }
        if (next && next.group1 === point.group1 && !narrowPointIndices.has(i + 1)) {
          next.lower = true;
          next.valveStart = true;
        }
      }

      finalPoints.forEach((p, idx) => {
        if (idx === 0) {
          p.speed = p.lower || p.valveStart
            ? Math.min(950, p.speed || speed)
            : travelFarSpeed;
          return;
        }
        const prev = finalPoints[idx - 1];
        const dist = Math.hypot(p.x - prev.x, p.y - prev.y);
        const isDispensingMove = p.lower || p.valveStart || (!prev.raise && !prev.valveStop);

        if (isDispensingMove) {
          p.speed = Math.min(950, p.speed || speed);
        } else if (p.dispenser !== prev.dispenser) {
          p.speed = travelFarSpeed;
        } else if (prev.raise) {
          p.speed = (dist > 10.0) ? travelFarSpeed : travelNearSpeed;
        } else {
          if (!p.speed) p.speed = speed;
        }
      });

      if (finalPoints.length > 0) {
        finalPoints[finalPoints.length - 1].raise = true;
      }

      return finalPoints;
    }

    let tempSvg = document.getElementById('__temp_svg_sampler__');
    if (!tempSvg) {
      tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      tempSvg.id = '__temp_svg_sampler__';
      tempSvg.style.position = 'absolute';
      tempSvg.style.width = '0';
      tempSvg.style.height = '0';
      tempSvg.style.visibility = 'hidden';
      document.body.appendChild(tempSvg);
    }
    tempSvg.innerHTML = '';

    let scaleRatio = targetWidthMm / bounds.width;
    const rawSegments = [];

    this.parsedShapes.forEach((item, elemIdx) => {
      const activeColor = item.fillColor || item.strokeColor || '#2563eb';
      const mAct = this.colorMapping.get(activeColor);
      const dispId = (mAct !== undefined && mAct !== null) ? mAct : 1;
      if (dispId <= 0) return;

      const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathEl.setAttribute('d', item.d);
      if (item.svgMatrix) {
        const m = item.svgMatrix;
        pathEl.setAttribute('transform', `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`);
      }
      tempSvg.appendChild(pathEl);

      try {
        const totalLen = pathEl.getTotalLength();
        if (totalLen <= 0.001) return;

        const stepInSvg = Math.max(0.2, stepMm / scaleRatio);
        const numSteps = Math.max(1, Math.round(totalLen / stepInSvg));
        const actualStep = totalLen / numSteps;

        const pts = [];
        for (let i = 0; i <= numSteps; i++) {
          const dist = i === numSteps ? totalLen : i * actualStep;
          const pt = pathEl.getPointAtLength(dist);
          pts.push({ x: pt.x, y: pt.y });
        }

        if (pts.length > 0) {
          rawSegments.push({
            dispenser: dispId,
            points: pts,
            originalColor: activeColor,
            segmentId: elemIdx + 1
          });
        }
      } catch (err) {
      } finally {
        tempSvg.removeChild(pathEl);
      }
    });

    if (rawSegments.length === 0) {
      alert("⚠️ Не можеше да се извлечат точки од контурите на овој SVG.");
      return [];
    }

    let orderedSegments = rawSegments;
    if (groupByDispenser) {
      orderedSegments = [...rawSegments].sort((a, b) => a.dispenser - b.dispenser);
    }

    const finalPoints = [];
    const dispSegmentCounter = {};

    orderedSegments.forEach((seg) => {
      const pts = seg.points;
      const totalInSeg = pts.length;
      dispSegmentCounter[seg.dispenser] = (dispSegmentCounter[seg.dispenser] || 0) + 1;
      const segGroupLabel = 'D' + seg.dispenser + '-' + dispSegmentCounter[seg.dispenser];

      pts.forEach((p, pIdx) => {
        const normX = (p.x - bounds.minX) * scaleRatio;
        let normY = (p.y - bounds.minY) * scaleRatio;
        if (invertY) normY = targetHeightMm - normY;

        const worldX = parseFloat((normX + offsetX).toFixed(3));
        const worldY = parseFloat((normY + offsetY).toFixed(3));

        const ptObj = CNCApp.State.createPoint(worldX, worldY);
        ptObj.dispenser = seg.dispenser;
        ptObj.speed = speed;
        ptObj.group1 = segGroupLabel;
        ptObj.group2 = '';

        if (mode === 'lines') {
          if (pIdx === 0) {
            ptObj.lower = true;
            ptObj.valveStart = true;
            ptObj.valveStop = false;
            ptObj.raise = false;
            ptObj.time = '';
          } else if (pIdx === totalInSeg - 1) {
            ptObj.lower = false;
            ptObj.valveStart = false;
            ptObj.valveStop = true;
            ptObj.raise = true;
            ptObj.time = '';
          } else {
            ptObj.lower = false;
            ptObj.valveStart = false;
            ptObj.valveStop = false;
            ptObj.raise = false;
            ptObj.time = '';
          }
        } else {
          ptObj.lower = true;
          ptObj.valveStart = true;
          ptObj.time = dropTimeMs;
          ptObj.valveStop = true;
          ptObj.raise = true;
        }

        finalPoints.push(ptObj);
      });
    });

    return finalPoints;
  },

  applyToProject: function(replaceExisting) {
    if (replaceExisting === undefined) replaceExisting = true;
    if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) {
      alert('⛔ Овој таб моментално работи на машината и е заклучен за промени! Отворете нов таб (➕ Нов таб) за да ја зачувате генерираната патека.');
      return;
    }
    const modeEl = document.querySelector('input[name="svgGenMode"]:checked');
    const mode = (modeEl && modeEl.value) ? modeEl.value : 'pockets';
    const elStep = document.getElementById('svgGenStep');
    const stepMm = parseFloat(elStep ? elStep.value : '') || 2.0;
    const elTargetWidth = document.getElementById('svgGenTargetWidth');
    const targetWidthMm = parseFloat(elTargetWidth ? elTargetWidth.value : '') || (this.detectedPhysicalWidthMm || 60);
    const elInvertY = document.getElementById('svgGenInvertY');
    const invertY = elInvertY ? !!elInvertY.checked : true;
    const elOffsetX = document.getElementById('svgGenOffsetX');
    const offsetX = parseFloat(elOffsetX ? elOffsetX.value : '') || 0;
    const elOffsetY = document.getElementById('svgGenOffsetY');
    const offsetY = parseFloat(elOffsetY ? elOffsetY.value : '') || 0;
    const elSpeed = document.getElementById('svgGenSpeed');
    const speed = Math.round(parseFloat(elSpeed ? elSpeed.value : '') || 650);
    const elTravelNear = document.getElementById('svgGenTravelNearSpeed');
    const travelNearSpeed = Math.round(parseFloat(elTravelNear ? elTravelNear.value : '') || 1200);
    const elTravelFar = document.getElementById('svgGenTravelFarSpeed');
    const travelFarSpeed = Math.round(parseFloat(elTravelFar ? elTravelFar.value : '') || 5000);
    const elMinClearance = document.getElementById('svgGenMinClearance');
    const minClearanceMm = parseFloat(elMinClearance ? elMinClearance.value : '') || 0.18;
    const elTipMargin = document.getElementById('svgGenTipMargin');
    const tipMarginMm = parseFloat(elTipMargin ? elTipMargin.value : '') || 0.8;
    const elDropTime = document.getElementById('svgGenDropTime');
    const dropTime = Math.round(parseFloat(elDropTime ? elDropTime.value : '') || 50);
    const elAcuteDwell = document.getElementById('svgGenAcuteTipDwell');
    const acuteTipDwell = Math.round(parseFloat(elAcuteDwell ? elAcuteDwell.value : '') || 30);
    const elRdp = document.getElementById('svgGenRdpSimplify');
    const enableRdp = elRdp ? !!elRdp.checked : true;
    const elDepth = document.getElementById('svgGenDepth');
    const depthMm = elDepth ? parseFloat(elDepth.value) : 1.0;
    const elFlowRate = document.getElementById('svgGenFlowRate');
    const flowRateQ = elFlowRate ? parseFloat(elFlowRate.value) : 16.5;
    const elCapillary = document.getElementById('svgGenCapillary');
    const useCapillary = elCapillary ? !!elCapillary.checked : true;
    const elAutoVolSpeed = document.getElementById('svgGenAutoVolumetricSpeed');
    const autoVolumetricSpeed = elAutoVolSpeed ? !!elAutoVolSpeed.checked : true;
    const elGroupByColor = document.getElementById('svgGenGroupByColor');
    const groupByColor = elGroupByColor ? !!elGroupByColor.checked : true;
    const elAdaptiveStep = document.getElementById('svgGenAdaptiveStep');
    const adaptiveStep = elAdaptiveStep ? !!elAdaptiveStep.checked : false;

    if (targetWidthMm < 1 || targetWidthMm > 1000 ||
        stepMm < 0.5 || stepMm > 10 ||
        minClearanceMm < 0.05 || minClearanceMm > 10 ||
        speed < 50 || speed > 950 ||
        travelNearSpeed < 50 || travelNearSpeed > 9500 ||
        travelFarSpeed < 50 || travelFarSpeed > 9500 ||
        tipMarginMm < 0 || tipMarginMm > 20 ||
        dropTime < 0 || dropTime > 5000 ||
        acuteTipDwell < 0 || acuteTipDwell > 5000 ||
        !Number.isFinite(depthMm) || depthMm < 0.1 || depthMm > 20 ||
        !Number.isFinite(flowRateQ) || flowRateQ < 0.1 || flowRateQ > 10000) {
      alert('⚠️ Некои SVG параметри се надвор од дозволениот опсег.\n\nПроверете ширина, чекор, клиренс, брзини и времена пред генерирање.');
      return;
    }

    const newPoints = this.generatePoints({
      mode,
      stepMm,
      targetWidthMm,
      invertY,
      offsetX,
      offsetY,
      speed,
      travelNearSpeed,
      travelFarSpeed,
      minClearanceMm,
      tipMarginMm,
      dropTimeMs: dropTime,
      acuteTipDwellMs: acuteTipDwell,
      enableRdp,
      depthMm,
      flowRateQ,
      useCapillary,
      autoVolumetricSpeed,
      groupByDispenser: groupByColor,
      adaptiveStep
    });

    if (newPoints.length === 0) return;

    if (replaceExisting) {
      CNCApp.State.points = newPoints;
    } else {
      CNCApp.State.points = CNCApp.State.points.concat(newPoints);
    }

    if (this.currentSvgString && CNCApp.Parser) {
      CNCApp.Parser.loadSvgContent(this.currentSvgString);
    }

    CNCApp.Table.enforceDispenserSafety();
    CNCApp.State.selectedIndices.clear();
    CNCApp.State.activePointIndex = 0;
    CNCApp.State.selectedIndices.add(0);
    CNCApp.State.snapshot();
    CNCApp.Table.render();
    CNCApp.Canvas.resetView();
    CNCApp.GCode.updateCycleTime();

    this.closeModal();

    let modeTitle = '🎯 Тежишта на полиња и оски на канали (Полнење)';
    if (mode === 'lines') modeTitle = '📏 Контури (Линии)';
    if (mode === 'dots') modeTitle = '⚪ Капки по контури';

    alert(`🎉 Успешно се генерирани ${newPoints.length} точки од SVG фајлот!\n\n` +
          `• Режим: ${modeTitle}\n` +
          `• Чекор: ${stepMm} mm\n` +
          `• Q: ${flowRateQ} mm³/s (експериментално, некалибрирано)\n` +
          `• Максимална работна брзина: 950 mm/min\n` +
          `⚠️ Проверете ја патеката и дозирањето пред работа на машината.\n` +
          `• Ширина на модел: ${targetWidthMm} mm\n` +
          `• Време за циклус: ${document.getElementById('cycleTimeDisplay').innerText}`);
  }
};