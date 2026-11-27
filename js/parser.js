window.CNCApp = window.CNCApp || {};

CNCApp.Parser = {
  _parseNum: function(val) {
    return parseFloat(String(val === undefined || val === null ? '' : val).replace(',', '.'));
  },

  parseTxt: function(text) {
    if (!text) return [];
    const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = cleanText.split('\n');
    const newPoints = [];

    for (let line of lines) {
      let trimmed = line.trim();
      if (!trimmed) continue;

      let matchX = trimmed.match(/[Xx]\s*([+-]?\d+(?:[.,]\d+)?)/);
      let matchY = trimmed.match(/[Yy]\s*([+-]?\d+(?:[.,]\d+)?)/);
      if (matchX && matchY) {
        let x = parseFloat(matchX[1].replace(',', '.'));
        let y = parseFloat(matchY[1].replace(',', '.'));
        if (!isNaN(x) && !isNaN(y)) {
          newPoints.push(CNCApp.State.createPoint(x, y));
          continue;
        }
      }

      let normalized = trimmed.replace(/(\d+),(\d+)/g, '$1.$2');
      let tokens = normalized.split(/[\s,;\t]+/).map(t => parseFloat(t)).filter(t => !isNaN(t));

      if (tokens.length === 2) {
        newPoints.push(CNCApp.State.createPoint(tokens[0], tokens[1]));
      } else if (tokens.length === 3 && Number.isInteger(tokens[0])) {
        newPoints.push(CNCApp.State.createPoint(tokens[1], tokens[2]));
      } else if (tokens.length >= 2) {
        for (let i = 0; i < tokens.length - 1; i += 2) {
          newPoints.push(CNCApp.State.createPoint(tokens[i], tokens[i + 1]));
        }
      }
    }

    return newPoints;
  },

  // Увоз на стар CSV со Comma-Replace
  parseLegacyCsv: function(text) {
    if (!text) return { points: [], header: '', footer: '' };
    const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = cleanText.split('\n');
    const newPoints = [];
    let headerStr = '', footerStr = '';

    for (let line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('Header:')) {
        headerStr = trimmed.replace('Header:', '').trim();
        continue;
      }
      if (trimmed.startsWith('Footer:')) {
        footerStr = trimmed.replace('Footer:', '').trim();
        continue;
      }
      const cols = trimmed.split(';');
      if (cols.length >= 10) {
        const rawX = this._parseNum(cols[1]);
        const rawY = this._parseNum(cols[2]);

        if (!isNaN(rawX) && !isNaN(rawY)) {
          const colStr = cols[9] || '';
          const match = colStr.match(/\d+/);
          const dispId = match ? parseInt(match[0]) : 1;

          const disp = CNCApp.State.machine.dispensers.find(d => d.id === dispId) || { offsetX: 0, offsetY: 0 };

          // ОДЗЕМАЊЕ НА ОФСЕТ (-) кон релативна нула (0,0)
          const realX = parseFloat((rawX - (disp.offsetX || 0)).toFixed(3));
          const realY = parseFloat((rawY - (disp.offsetY || 0)).toFixed(3));

          const pt = CNCApp.State.createPoint(realX, realY);
          const parsedSpeed = this._parseNum(cols[3]);
          const parsedTime = this._parseNum(cols[6]);
          pt.speed = Math.round(!isNaN(parsedSpeed) && parsedSpeed > 0 ? parsedSpeed : 1000);
          pt.lower = cols[4] ? cols[4].toLowerCase() === 'true' : true;
          pt.valveStart = cols[5] ? cols[5].toLowerCase() === 'true' : true;
          pt.time = (cols[6] !== '' && !isNaN(parsedTime)) ? Math.round(parsedTime) : '';
          pt.valveStop = cols[7] ? cols[7].toLowerCase() === 'true' : true;
          pt.raise = cols[8] ? cols[8].toLowerCase() === 'true' : true;
          pt.dispenser = dispId;
          pt.group1 = cols[10] || '';
          pt.group2 = '';
          newPoints.push(pt);
        }
      }
    }
    return { points: newPoints, header: headerStr, footer: footerStr };
  },

  parseProjectCsv: function(text) {
    if (!text) return { points: [], header: '', footer: '', svg: '', fileDispensers: null };
    const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = cleanText.split('\n');
    const newPoints = [];
    let headerStr = '', footerStr = '', svgBase64 = '';
    let fileDispensers = null;

    for (let line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('#DISP_CONFIG:')) {
        try {
          const cfg = JSON.parse(trimmed.substring(13).trim());
          if (Array.isArray(cfg) && cfg.length > 0) {
            // Зачувај го само за споредба/опционално преземање — НИКОГАШ не пребришувај глобални офсети тивко!
            fileDispensers = cfg;
          }
        } catch (e) {}
        continue;
      }
      if (trimmed.startsWith('#SVG:')) {
        svgBase64 = trimmed.substring(5).trim();
        continue;
      }
      if (trimmed.startsWith('Header:')) {
        headerStr = trimmed.replace('Header:', '').trim().replace(/\\n/g, '\n');
        continue;
      }
      if (trimmed.startsWith('Footer:')) {
        footerStr = trimmed.replace('Footer:', '').trim().replace(/\\n/g, '\n');
        if (footerStr === 'G28.1 X2 Y2;M5;M30' || !footerStr.includes('G1 X1 Y1 F2000')) {
          footerStr = "G28.1 X2 Y2\r\nG1 X1 Y1 F2000\r\nM5\r\nM30";
        }
        continue;
      }
      const cols = trimmed.split(';');
      const parsedX = (cols.length >= 13) ? this._parseNum(cols[2]) : NaN;
      if (cols.length >= 13 && !isNaN(parsedX)) {
        const parsedY = this._parseNum(cols[3]);
        const parsedSpeed = this._parseNum(cols[4]);
        const parsedTime = this._parseNum(cols[7]);
        const pt = {
          active: cols[0].toLowerCase() === 'true',
          x: parseFloat(parsedX.toFixed(3)) || 0,
          y: (!isNaN(parsedY) ? parseFloat(parsedY.toFixed(3)) : 0) || 0,
          speed: Math.round(!isNaN(parsedSpeed) && parsedSpeed > 0 ? parsedSpeed : 1000),
          lower: cols[5].toLowerCase() === 'true',
          valveStart: cols[6].toLowerCase() === 'true',
          time: (cols[7] !== '' && !isNaN(parsedTime)) ? Math.round(parsedTime) : '',
          valveStop: cols[8].toLowerCase() === 'true',
          raise: cols[9].toLowerCase() === 'true',
          dispenser: parseInt(cols[10], 10) || 1,
          group1: cols[11] || '',
          group2: cols[12] || ''
        };
        if (cols[13] !== undefined && cols[13].trim() !== '') {
          const clr = this._parseNum(cols[13]);
          if (!isNaN(clr) && clr > 0) {
            pt.clearance = clr;
          }
        }
        newPoints.push(pt);
      }
    }
    return { points: newPoints, header: headerStr, footer: footerStr, svg: svgBase64, fileDispensers: fileDispensers };
  },

  exportProjectCsv: function() {
    let out = [];
    out.push("# CNC DISPENSER PROJECT V2.3");
    out.push("#DISP_CONFIG:" + JSON.stringify(CNCApp.State.machine.dispensers));
    if (CNCApp.State.svgData) {
      out.push("#SVG:" + btoa(unescape(encodeURIComponent(CNCApp.State.svgData))));
    }
    out.push("Header:" + (CNCApp.State.header ? CNCApp.State.header.replace(/\r?\n/g, '\\n') : ''));
    out.push("Footer:" + (CNCApp.State.footer ? CNCApp.State.footer.replace(/\r?\n/g, '\\n') : ''));
    out.push("Активно;Р.бр.;X;Y;Брзина;Доле;Боја старт;Време;Боја стоп;Горе;Боја;Група 1;Група 2;Клиренс");

    CNCApp.State.points.forEach((p, idx) => {
      out.push([
        p.active,
        idx + 1,
        p.x.toFixed(3),
        p.y.toFixed(3),
        Math.round(p.speed),
        p.lower,
        p.valveStart,
        p.time !== '' && p.time > 0 ? Math.round(p.time) : '',
        p.valveStop,
        p.raise,
        p.dispenser,
        p.group1,
        p.group2,
        (p.clearance !== undefined && p.clearance !== null && !isNaN(p.clearance)) ? p.clearance : ''
      ].join(';'));
    });

    return out.join('\r\n');
  },

  loadSvgContent: function(svgText, options) {
    var opts = options || {};
    if (CNCApp.State.svgObjectUrl) {
      try { URL.revokeObjectURL(CNCApp.State.svgObjectUrl); } catch (e) {}
      CNCApp.State.svgObjectUrl = null;
    }
    CNCApp.State.svgData = svgText;
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    CNCApp.State.svgObjectUrl = url;
    const img = new Image();
    img.onload = function() {
      CNCApp.State.svgImage = img;
      CNCApp.State.showSvg = true;
      if (typeof CNCApp.updateSvgToggleUI === 'function') CNCApp.updateSvgToggleUI();
      if (CNCApp.Tabs) CNCApp.Tabs.syncFromState();
      if (opts.skipResetView) {
        CNCApp.Canvas.render();
      } else {
        CNCApp.Canvas.resetView();
      }
      if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
    };
    img.src = url;
  }
};