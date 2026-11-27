window.CNCApp = window.CNCApp || {};

CNCApp.GCode = {
  telemetry: { totalSec: 0, travelSec: 0, dwellSec: 0, totalDistMm: 0 },

  formatCoord: function(val) {
    var num = (typeof val === 'number') ? val : parseFloat(val);
    if (isNaN(num)) num = 0;
    if (Math.abs(num) < 0.0005) num = 0;
    var str = num.toFixed(3);
    if (CNCApp.State.machine.decimalSeparator === ',') {
      str = str.replace('.', ',');
    }
    return str;
  },

  generate: function(startIndex) {
    const self = this;
    const pts = CNCApp.State.points;
    const m = CNCApp.State.machine;
    const isSec = m.timeUnit === 's';
    let lines = [];

    let currentBaseX = null;
    let isMicroShifted = false;
    let currentFeed = Math.round(m.moveClickSpeed || 3000) || 3000;
    let relMicroToggle = false;

    function formatDwellLine(dwellMs) {
      if (isSec) {
        let dVal = (dwellMs / 1000).toFixed(3);
        if (m.decimalSeparator === ',') dVal = dVal.replace('.', ',');
        return 'G4 P' + dVal;
      }
      return 'G4 P' + Math.round(dwellMs);
    }

    function emitMove(xNum, yNum, feedNum, comment, dispId) {
      currentBaseX = xNum;
      isMicroShifted = false;
      currentFeed = Math.round(feedNum || 1000) || 1000;
      let line = 'G1 X' + self.formatCoord(xNum) + ' Y' + self.formatCoord(yNum) + ' F' + currentFeed;
      let dispTag = dispId ? (' [D' + dispId + ']') : '';
      if (comment) line += ' ' + comment + dispTag;
      else if (dispTag) line += ' ;' + dispTag;
      lines.push(line);
    }

    function emitMCommand(cmd) {
      const cleanCmd = String(cmd || '').trim();
      if (!cleanCmd) return;
      lines.push(cleanCmd);
      if (currentBaseX !== null) {
        isMicroShifted = !isMicroShifted;
        const targetX = isMicroShifted ? (currentBaseX + 0.001) : currentBaseX;
        lines.push('G1 X' + self.formatCoord(targetX) + ' F' + currentFeed);
      } else {
        relMicroToggle = !relMicroToggle;
        let relStep = relMicroToggle ? '0.001' : '-0.001';
        if (m.decimalSeparator === ',') relStep = relStep.replace('.', ',');
        lines.push('G91');
        lines.push('G1 X' + relStep + ' F' + currentFeed);
        lines.push('G90');
      }
    }

    const headerTxt = String(CNCApp.State.header || '').trim();
    if (!/\bG90\b/i.test(headerTxt)) {
      lines.push('G90');
    }
    if (headerTxt) {
      lines.push(headerTxt);
    }

    // Задолжителна глобална безбедносна заштита: затвори вентил и крени ги СИТЕ диспензери пред било какво движење
    lines.push('; === БЕЗБЕДНОСНА ЗАШТИТА: СИТЕ ДИСПЕНЗЕРИ ГОРЕ И ЗАТВОРЕН ВЕНТИЛ ===');
    emitMCommand(m.valveCloseCmd || 'M10 P3');
    var allDisps = (m && Array.isArray(m.dispensers)) ? m.dispensers : [];
    for (var di = 0; di < allDisps.length; di++) {
      var dObj = allDisps[di];
      var rCmd = dObj.raiseCmd || ('M10 P' + (3 + (dObj.id || (di + 1))));
      emitMCommand(rCmd);
    }
    lines.push(formatDwellLine(m.systemDelayRaise || 150));

    const startFromIdx = (typeof startIndex === 'number' && startIndex >= 0 && startIndex < pts.length) ? startIndex : 0;
    let currentDispenser = null;
    let handledStartFromIdx = false;

    if (startFromIdx > 0) {
      // Најди ја претходната активна точка (N-1)
      let prevActiveIdx = -1;
      for (let i = startFromIdx - 1; i >= 0; i--) {
        if (pts[i] && pts[i].active) {
          prevActiveIdx = i;
          break;
        }
      }

      const targetPt = pts[startFromIdx];

      if (prevActiveIdx !== -1 && targetPt && targetPt.active) {
        handledStartFromIdx = true;
        const prevPt = pts[prevActiveIdx];

        // Анализирај ја историската состојба на диспензерот и висината до prevActiveIdx
        let stateDispenser = null;
        let isLowered = false;

        for (let i = 0; i <= prevActiveIdx; i++) {
          const p = pts[i];
          if (!p.active) continue;
          const disp = m.dispensers.find(d => d.id === p.dispenser) || m.dispensers[0];
          if (stateDispenser && stateDispenser.id !== disp.id) {
            isLowered = false;
          }
          stateDispenser = disp;
          if (p.lower) isLowered = true;
          if (p.raise) isLowered = false;
        }

        const prevDisp = stateDispenser || (m.dispensers.find(d => d.id === prevPt.dispenser) || m.dispensers[0]);
        const prevNumX = prevPt.x + (prevDisp.offsetX || 0);
        const prevNumY = prevPt.y + (prevDisp.offsetY || 0);

        const targetDisp = m.dispensers.find(d => d.id === targetPt.dispenser) || m.dispensers[0];
        const targetNumX = targetPt.x + (targetDisp.offsetX || 0);
        const targetNumY = targetPt.y + (targetDisp.offsetY || 0);
        const targetSpd = Math.round(targetPt.speed || 1000);
        const approachSpd = Math.round(m.moveClickSpeed || 3000);

        lines.push(`; === ПОЧНИ ОД ТУКА (Ред #${startFromIdx + 1}) ===`);
        // Безбедно затворање вентил и кревање пред почетното придвижување
        emitMCommand(m.valveCloseCmd);
        emitMCommand(prevDisp.raiseCmd);
        lines.push(formatDwellLine(m.systemDelayRaise));

        // 1. Позиционирање над претходната точка N-1 со подигнат диспензер
        emitMove(prevNumX, prevNumY, approachSpd, `;Безбедно позиционирање над N-1 (#${prevActiveIdx + 1})`, prevDisp.id);

        // Дали целната точка е дел од активна континуирана линија/шуплина?
        // Строга безбедност: спуштање на N-1 е дозволено САМО ако N-1 навистина бил спуштен (isLowered === true) со истиот диспензер!
        const isPartOfActiveLine = isLowered && (prevDisp.id === targetDisp.id);

        if (isPartOfActiveLine) {
          // Случај А (Линија): Спуштање на диспензерот на позиција N-1
          emitMCommand(prevDisp.lowerCmd);
          lines.push(formatDwellLine(m.systemDelayLower));

          // Работно движење кон целната точка N
          emitMove(targetNumX, targetNumY, targetSpd, `;ID:${startFromIdx + 1} G1:${targetPt.group1 || ''} G2:${targetPt.group2 || ''}`, targetDisp.id);

          // Пристигнување на точката N: отворање вентил
          emitMCommand(m.valveOpenCmd);

          const dwell = parseFloat(targetPt.time);
          if (!isNaN(dwell) && dwell > 0) {
            lines.push(formatDwellLine(dwell));
          }
          if (targetPt.valveStop) {
            emitMCommand(m.valveCloseCmd);
          }
          if (targetPt.raise) {
            emitMCommand(targetDisp.raiseCmd);
            lines.push(formatDwellLine(m.systemDelayRaise));
          }
        } else {
          // Случај Б (Самостојна капка или почеток на нова независна линија):
          // Движење подигнат од N-1 до целната точка N
          emitMove(targetNumX, targetNumY, targetSpd, `;ID:${startFromIdx + 1} G1:${targetPt.group1 || ''} G2:${targetPt.group2 || ''}`, targetDisp.id);

          // Целосен нормален циклус на самата точка N
          if (targetPt.lower) {
            emitMCommand(targetDisp.lowerCmd);
            lines.push(formatDwellLine(m.systemDelayLower));
          }
          if (targetPt.valveStart) {
            emitMCommand(m.valveOpenCmd);
          }
          const dwell = parseFloat(targetPt.time);
          if (!isNaN(dwell) && dwell > 0) {
            lines.push(formatDwellLine(dwell));
          }
          if (targetPt.valveStop) {
            emitMCommand(m.valveCloseCmd);
          }
          if (targetPt.raise) {
            emitMCommand(targetDisp.raiseCmd);
            lines.push(formatDwellLine(m.systemDelayRaise));
          }
        }

        currentDispenser = targetDisp;
      }
    }

    // Редовен циклус за преостанатите точки
    const loopStartIndex = handledStartFromIdx ? (startFromIdx + 1) : startFromIdx;

    for (let idx = loopStartIndex; idx < pts.length; idx++) {
      const p = pts[idx];
      if (!p.active) continue;

      const disp = m.dispensers.find(d => d.id === p.dispenser) || m.dispensers[0];

      if (currentDispenser && currentDispenser.id !== disp.id) {
        emitMCommand(m.valveCloseCmd);
        emitMCommand(currentDispenser.raiseCmd);
        lines.push(formatDwellLine(m.systemDelayRaise));
      }
      currentDispenser = disp;

      const numX = p.x + (disp.offsetX || 0);
      const numY = p.y + (disp.offsetY || 0);
      const spd = Math.round(p.speed || 1000);

      emitMove(numX, numY, spd, `;ID:${idx + 1} G1:${p.group1 || ''} G2:${p.group2 || ''}`, disp.id);

      if (p.lower) {
        emitMCommand(disp.lowerCmd);
        lines.push(formatDwellLine(m.systemDelayLower));
      }

      if (p.valveStart) {
        emitMCommand(m.valveOpenCmd);
      }

      const dwell = parseFloat(p.time);
      if (!isNaN(dwell) && dwell > 0) {
        lines.push(formatDwellLine(dwell));
      }

      if (p.valveStop) {
        emitMCommand(m.valveCloseCmd);
      }

      if (p.raise) {
        emitMCommand(disp.raiseCmd);
        lines.push(formatDwellLine(m.systemDelayRaise));
      }
    }

    // БЕЗБЕДНОСНА ЗАШТИТА ПРЕД ФУТЕР:
    // Пред да се извршат линиите од футерот (G28.1, G1 X1 Y1...), задолжително ги затвораме вентилите
    // и ги креваме сите диспензери автоматски влечејќи ги командите од машинските поставки (M10/M11, M203/M204...)
    lines.push('; === БЕЗБЕДНОСНО ЗАТВОРАЊЕ И ПОДИГАЊЕ ПРЕД ФУТЕР ===');
    if (m.valveCloseCmd) {
      emitMCommand(m.valveCloseCmd);
    }
    if (Array.isArray(m.dispensers)) {
      m.dispensers.forEach(function(d) {
        if (d && d.raiseCmd) {
          emitMCommand(d.raiseCmd);
        }
      });
    }
    if (m.systemDelayRaise) {
      lines.push(formatDwellLine(m.systemDelayRaise));
    }

    if (CNCApp.State.footer) {
      const footerLines = CNCApp.State.footer.split(/[\r\n;]+/).map(s => s.trim()).filter(Boolean);
      footerLines.forEach(fl => lines.push(fl));
    }

    return lines.join('\r\n');
  },

  updateCycleTime: function() {
    const pts = CNCApp.State.points.filter(p => p.active);
    const m = CNCApp.State.machine;
    const mLatencySec = (m.mCommandLatency || 120) / 1000;

    let totalSec = 0, travelSec = 0, dwellSec = 0, totalDistMm = 0;
    let lastPhysX = 0, lastPhysY = 0;
    let currentDisp = null;

    pts.forEach((p) => {
      const disp = m.dispensers.find(d => d.id === p.dispenser) || m.dispensers[0];

      const physX = p.x + (disp.offsetX || 0);
      const physY = p.y + (disp.offsetY || 0);

      if (currentDisp && currentDisp.id !== disp.id) {
        dwellSec += (m.systemDelayRaise / 1000) + (mLatencySec * 2);
      }
      currentDisp = disp;

      const dist = Math.hypot(physX - lastPhysX, physY - lastPhysY);
      totalDistMm += dist;

      const feedMmSec = (p.speed || 1000) / 60;
      const pureTravel = dist / feedMmSec;
      const stopAndGoPenalty = dist > 0.01 ? 0.35 : 0;
      travelSec += pureTravel + stopAndGoPenalty;

      if (p.lower) {
        dwellSec += (m.systemDelayLower / 1000) + mLatencySec;
      }
      if (p.valveStart) {
        dwellSec += mLatencySec;
      }
      const t = parseFloat(p.time);
      if (!isNaN(t) && t > 0) {
        dwellSec += t / 1000;
      }
      if (p.valveStop) {
        dwellSec += mLatencySec;
      }
      if (p.raise) {
        dwellSec += (m.systemDelayRaise / 1000) + mLatencySec;
      }

      lastPhysX = physX;
      lastPhysY = physY;
    });

    totalSec = travelSec + dwellSec;
    this.telemetry = { totalSec, travelSec, dwellSec, totalDistMm };

    const min = Math.floor(totalSec / 60);
    const sec = Math.round(totalSec % 60);
    const meters = (totalDistMm / 1000).toFixed(2);

    document.getElementById('cycleTimeDisplay').innerText = `Време: ~${min}м ${sec}с`;
    document.getElementById('cycleSubDisplay').innerText = `Патека: ${meters}m`;
  }
};