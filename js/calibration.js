/**
 * CNC Dispenser V2.1.7 - Calibration & Offset Manager
 * Лебдечки прозорец над табелата за прецизна калибрација на дизни и офсети
 * (Десниот 2D график останува 100% отклучен и видлив)
 */

(function() {
  'use strict';

  window.CNCApp = window.CNCApp || {};

  var Calibration = {
    active: false,
    activeDispenserId: 1,
    mode: 'nozzle_shift_natural', // 'nozzle_shift_natural', 'nozzle_shift_inverse', 'old_project'
    nudgeStep: 0.05, // mm
    deltaX: 0.0,
    deltaY: 0.0,
    initialPointsMap: new Map(), // index -> { x, y }
    previousShadedSet: null,
    _isDraggingWin: false,
    _winDragOffsetX: 0,
    _winDragOffsetY: 0,

    init: function() {
      this.bindEvents();
      this.bindWindowDrag();
    },

    _escapeHtml: function(str) {
      if (CNCApp.State && typeof CNCApp.State.escapeHtml === 'function') {
        return CNCApp.State.escapeHtml(str);
      }
      return String(str === undefined || str === null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    },

    bindWindowDrag: function() {
      var self = this;
      var header = document.getElementById('calibDragHeader');
      var panel = document.getElementById('calibrationSidePanel');
      if (!header || !panel) return;

      header.addEventListener('mousedown', function(e) {
        if (e.target && e.target.tagName === 'BUTTON') return;
        e.preventDefault();
        var rect = panel.getBoundingClientRect();
        self._isDraggingWin = true;
        self._winDragOffsetX = e.clientX - rect.left;
        self._winDragOffsetY = e.clientY - rect.top;
      });

      window.addEventListener('mousemove', function(e) {
        if (!self._isDraggingWin) return;
        var w = panel.offsetWidth || 460;
        var h = panel.offsetHeight || 220;
        var nextLeft = e.clientX - self._winDragOffsetX;
        var nextTop = e.clientY - self._winDragOffsetY;

        var maxLeft = Math.max(10, window.innerWidth - w - 10);
        var maxTop = Math.max(10, window.innerHeight - h - 10);
        if (nextLeft < 6) nextLeft = 6;
        if (nextLeft > maxLeft) nextLeft = maxLeft;
        if (nextTop < 6) nextTop = 6;
        if (nextTop > maxTop) nextTop = maxTop;

        panel.style.left = Math.round(nextLeft) + 'px';
        panel.style.top = Math.round(nextTop) + 'px';
      });

      window.addEventListener('mouseup', function() {
        self._isDraggingWin = false;
      });
    },

    bindEvents: function() {
      var self = this;

      var btnToggle = document.getElementById('btnOpenCalibration');
      if (btnToggle) {
        btnToggle.onclick = function() {
          if (self.active) {
            self.cancel();
          } else {
            self.open();
          }
        };
      }

      var btnCloseHeader = document.getElementById('btnCalibCloseHeader');
      if (btnCloseHeader) {
        btnCloseHeader.onclick = function() {
          self.cancel();
        };
      }

      var btnCancel = document.getElementById('btnCalibCancel');
      if (btnCancel) {
        btnCancel.onclick = function() {
          self.cancel();
        };
      }

      var btnApply = document.getElementById('btnCalibApply');
      if (btnApply) {
        btnApply.onclick = function() {
          self.applyCurrentDispenser(false);
        };
      }

      var btnApplyNext = document.getElementById('btnCalibApplyNext');
      if (btnApplyNext) {
        btnApplyNext.onclick = function() {
          self.applyAndNext();
        };
      }

      var selMode = document.getElementById('calibModeSelect');
      if (selMode) {
        selMode.onchange = function() {
          self.mode = selMode.value;
          self.updateUI();
        };
      }

      var selStep = document.getElementById('calibStepSelect');
      if (selStep) {
        selStep.onchange = function() {
          self.nudgeStep = parseFloat(selStep.value) || 0.05;
        };
      }

      var bUp = document.getElementById('btnCalibNudgeUp');
      var bDown = document.getElementById('btnCalibNudgeDown');
      var bLeft = document.getElementById('btnCalibNudgeLeft');
      var bRight = document.getElementById('btnCalibNudgeRight');

      if (bUp) bUp.onclick = function() { self.nudge(0, self.nudgeStep); };
      if (bDown) bDown.onclick = function() { self.nudge(0, -self.nudgeStep); };
      if (bLeft) bLeft.onclick = function() { self.nudge(-self.nudgeStep, 0); };
      if (bRight) bRight.onclick = function() { self.nudge(self.nudgeStep, 0); };

      var bResetShift = document.getElementById('btnCalibResetShift');
      if (bResetShift) {
        bResetShift.onclick = function() {
          self.revertToInitialPoints();
        };
      }
    },

    open: function() {
      if (CNCApp.Machine && typeof CNCApp.Machine.isBusy === 'function' && CNCApp.Machine.isBusy()) {
        alert('⛔ Не смее да се калибрираат офсетите на машината додека машината активно работи!');
        return;
      }
      if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) {
        alert('🔒 Овој таб моментално е заклучен (Read-Only).');
        return;
      }

      // Исклучи Add-Mode и Оди-на-клик за безбедно влечење точки при калибрација
      if (CNCApp.State.isAddMode) {
        CNCApp.State.isAddMode = false;
      }
      if (CNCApp.Machine && CNCApp.Machine.isMoveToClickMode) {
        CNCApp.Machine.setMoveToClickMode(false);
      } else if (CNCApp.App && typeof CNCApp.App.refreshToolbarStates === 'function') {
        CNCApp.App.refreshToolbarStates();
      }

      this.active = true;
      this.deltaX = 0.0;
      this.deltaY = 0.0;

      this.previousShadedSet = new Set(CNCApp.State.shadedDispensers || []);

      var panel = document.getElementById('calibrationSidePanel');
      if (panel) {
        panel.style.top = '98px';
        panel.style.left = '10px';
        panel.style.display = 'flex';
      }

      var btnToggle = document.getElementById('btnOpenCalibration');
      if (btnToggle) {
        btnToggle.classList.add('active');
        btnToggle.innerHTML = '🎯 Калибрација: ВКЛ';
      }

      this.renderDispenserButtons();

      var dispensers = CNCApp.State.machine.dispensers || [];
      var targetId = this.activeDispenserId;
      var exists = false;
      for (var i = 0; i < dispensers.length; i++) {
        if (dispensers[i].id === targetId) {
          exists = true;
          break;
        }
      }
      if (!exists && dispensers.length > 0) {
        targetId = dispensers[0].id;
      }
      this.selectDispenser(targetId || 1);
    },

    closeUI: function() {
      this.active = false;
      this.deltaX = 0.0;
      this.deltaY = 0.0;
      this.initialPointsMap.clear();
      this._isDraggingWin = false;

      var panel = document.getElementById('calibrationSidePanel');
      if (panel) {
        panel.style.display = 'none';
      }

      var btnToggle = document.getElementById('btnOpenCalibration');
      if (btnToggle) {
        btnToggle.classList.remove('active');
        btnToggle.innerHTML = '🎯 Калибрација';
      }

      if (this.previousShadedSet) {
        CNCApp.State.shadedDispensers = new Set(this.previousShadedSet);
        this.previousShadedSet = null;
      } else {
        CNCApp.State.shadedDispensers.clear();
      }

      if (CNCApp.App && typeof CNCApp.App.renderCanvasDispenserFilters === 'function') {
        CNCApp.App.renderCanvasDispenserFilters();
      }
      CNCApp.Canvas.render();
      CNCApp.Table.render();
    },

    cancel: function() {
      this.revertToInitialPoints();
      this.closeUI();
    },

    closeBeforeTabChange: function() {
      if (!this.active) return true;
      if (this.deltaX !== 0 || this.deltaY !== 0) {
        var keepSwitch = confirm(
          '⚠️ Имате незачувано поместување во калибрацијата за Д' + this.activeDispenserId + '.\n\n' +
          'OK = Отфрли ги незачуваните промени и продолжи\n' +
          'Cancel = Остани на калибрацијата'
        );
        if (!keepSwitch) return false;
      }
      this.cancel();
      return true;
    },

    renderDispenserButtons: function() {
      var self = this;
      var container = document.getElementById('calibDispenserBtnGroup');
      if (!container) return;

      container.innerHTML = '';
      var dispensers = CNCApp.State.machine.dispensers || [];

      for (var i = 0; i < dispensers.length; i++) {
        (function(d) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'calib-disp-btn' + (self.activeDispenserId === d.id ? ' active' : '');
          btn.setAttribute('data-calib-disp-id', String(d.id));
          btn.innerHTML =
            '<span class="calib-disp-dot" style="background:' + self._escapeHtml(d.color || '#2563eb') + '"></span>' +
            '<strong>Д' + d.id + '</strong> ' +
            '<span style="font-size:10px;color:#64748b;">(' + self._escapeHtml(d.name) + ')</span>';

          btn.onclick = function() {
            if (d.id === self.activeDispenserId) return;
            if (self.deltaX !== 0 || self.deltaY !== 0) {
              var conf = confirm('Имате незачувано поместување за Д' + self.activeDispenserId + '.\nДали сакате да го снимите пред да преминете на Д' + d.id + '?');
              if (conf) {
                self.applyCurrentDispenser(true);
              } else {
                self.revertToInitialPoints();
              }
            }
            self.selectDispenser(d.id);
          };

          container.appendChild(btn);
        })(dispensers[i]);
      }
    },

    selectDispenser: function(dispId) {
      var self = this;
      this.activeDispenserId = dispId;
      this.deltaX = 0.0;
      this.deltaY = 0.0;
      this.initialPointsMap.clear();

      var container = document.getElementById('calibDispenserBtnGroup');
      if (container) {
        var btns = container.querySelectorAll('.calib-disp-btn');
        var dispensers = CNCApp.State.machine.dispensers || [];
        for (var i = 0; i < btns.length; i++) {
          if (dispensers[i] && dispensers[i].id === dispId) {
            btns[i].classList.add('active');
          } else {
            btns[i].classList.remove('active');
          }
        }
      }

      // ИЗОЛАЦИЈА: Другите бои влегуваат во shadedDispensers (во Canvas се скриени во режим на калибрација)
      CNCApp.State.shadedDispensers.clear();
      var allDisps = CNCApp.State.machine.dispensers || [];
      for (var k = 0; k < allDisps.length; k++) {
        if (allDisps[k].id !== dispId) {
          CNCApp.State.shadedDispensers.add(allDisps[k].id);
        }
      }

      CNCApp.State.selectedIndices.clear();
      var pts = CNCApp.State.points || [];
      for (var pIdx = 0; pIdx < pts.length; pIdx++) {
        if (pts[pIdx].dispenser === dispId) {
          CNCApp.State.selectedIndices.add(pIdx);
          self.initialPointsMap.set(pIdx, { x: pts[pIdx].x, y: pts[pIdx].y });
        }
      }

      if (CNCApp.App && typeof CNCApp.App.renderCanvasDispenserFilters === 'function') {
        CNCApp.App.renderCanvasDispenserFilters();
      }
      CNCApp.Canvas.render();
      CNCApp.Table.render();

      this.updateUI();
    },

    updateUI: function() {
      var list = CNCApp.State.machine.dispensers || [];
      var d = { offsetX: 0, offsetY: 0, name: 'Боја ' + this.activeDispenserId };
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === this.activeDispenserId) {
          d = list[i];
          break;
        }
      }

      var lblCurOffset = document.getElementById('calibCurOffsetDisplay');
      if (lblCurOffset) {
        lblCurOffset.textContent = 'Офсет: X=' + (d.offsetX || 0).toFixed(3) + ', Y=' + (d.offsetY || 0).toFixed(3);
      }

      var lblShift = document.getElementById('calibLiveShiftVal');
      if (lblShift) {
        var sX = (this.deltaX > 0 ? '+' : '') + this.deltaX.toFixed(3);
        var sY = (this.deltaY > 0 ? '+' : '') + this.deltaY.toFixed(3);
        lblShift.textContent = 'ΔX: ' + sX + ' | ΔY: ' + sY;
        lblShift.className = 'calib-badge ' + ((this.deltaX !== 0 || this.deltaY !== 0) ? 'calib-badge-live' : 'calib-badge-neutral');
      }

      var lblCount = document.getElementById('calibPointsCountBadge');
      if (lblCount) {
        lblCount.textContent = this.initialPointsMap.size + ' точки';
      }
    },

    onPointsMoved: function(dx, dy) {
      if (!this.active) return;
      this.deltaX = parseFloat((this.deltaX + dx).toFixed(3));
      this.deltaY = parseFloat((this.deltaY + dy).toFixed(3));
      this.updateUI();
    },

    nudge: function(dx, dy) {
      if (!this.active || this.initialPointsMap.size === 0) return;

      this.deltaX = parseFloat((this.deltaX + dx).toFixed(3));
      this.deltaY = parseFloat((this.deltaY + dy).toFixed(3));

      var self = this;
      this.initialPointsMap.forEach(function(initPos, idx) {
        var p = CNCApp.State.points[idx];
        if (p) {
          p.x = parseFloat((initPos.x + self.deltaX).toFixed(3));
          p.y = parseFloat((initPos.y + self.deltaY).toFixed(3));
          CNCApp.Table.updateRow(idx);
        }
      });

      CNCApp.Canvas.render();
      this.updateUI();
    },

    revertToInitialPoints: function() {
      this.initialPointsMap.forEach(function(initPos, idx) {
        var p = CNCApp.State.points[idx];
        if (p) {
          p.x = initPos.x;
          p.y = initPos.y;
          CNCApp.Table.updateRow(idx);
        }
      });

      this.deltaX = 0.0;
      this.deltaY = 0.0;
      CNCApp.Canvas.render();
      this.updateUI();
    },

    applyCurrentDispenser: function(stayInCalib) {
      var list = CNCApp.State.machine.dispensers || [];
      var d = null;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === this.activeDispenserId) {
          d = list[i];
          break;
        }
      }

      if (!d) {
        if (!stayInCalib) this.closeUI();
        return;
      }

      var dx = this.deltaX;
      var dy = this.deltaY;

      if (dx === 0 && dy === 0) {
        if (!stayInCalib) {
          alert('ℹ️ Нема направено никакво поместување за Д' + d.id + '.');
          this.closeUI();
        }
        return;
      }

      var oldOffsetX = d.offsetX || 0;
      var oldOffsetY = d.offsetY || 0;
      var finalNewOffsetX = oldOffsetX;
      var finalNewOffsetY = oldOffsetY;

      var selModeEl = document.getElementById('calibModeSelect');
      var chosenMode = selModeEl ? selModeEl.value : this.mode;

      if (chosenMode === 'nozzle_shift_natural') {
        // ОПЦИЈА 1 Природно: Точките на цртежот се враќаат на своето место врз сликата!
        this.initialPointsMap.forEach(function(initPos, idx) {
          var p = CNCApp.State.points[idx];
          if (p) {
            p.x = initPos.x;
            p.y = initPos.y;
            CNCApp.Table.updateRow(idx);
          }
        });
        finalNewOffsetX = parseFloat((oldOffsetX + dx).toFixed(3));
        finalNewOffsetY = parseFloat((oldOffsetY + dy).toFixed(3));
      } else if (chosenMode === 'nozzle_shift_inverse') {
        // ОПЦИЈА 1 Инверзно: Капката паднала таму, дизната оди спротивно
        this.initialPointsMap.forEach(function(initPos, idx) {
          var p = CNCApp.State.points[idx];
          if (p) {
            p.x = initPos.x;
            p.y = initPos.y;
            CNCApp.Table.updateRow(idx);
          }
        });
        finalNewOffsetX = parseFloat((oldOffsetX - dx).toFixed(3));
        finalNewOffsetY = parseFloat((oldOffsetY - dy).toFixed(3));
      } else {
        // ОПЦИЈА 2 Стар проект: Точките остануваат на новата порамнета позиција!
        finalNewOffsetX = parseFloat((oldOffsetX - dx).toFixed(3));
        finalNewOffsetY = parseFloat((oldOffsetY - dy).toFixed(3));
        CNCApp.State.snapshot();
      }

      d.offsetX = finalNewOffsetX;
      d.offsetY = finalNewOffsetY;

      var self = this;
      this.initialPointsMap.forEach(function(_, idx) {
        var p = CNCApp.State.points[idx];
        if (p) {
          self.initialPointsMap.set(idx, { x: p.x, y: p.y });
        }
      });

      this.deltaX = 0.0;
      this.deltaY = 0.0;

      CNCApp.Storage.saveAutoSave(true);
      if (CNCApp.Machine && CNCApp.Machine.activeDriverId === 'mach3' && CNCApp.Mach3BridgeDriver && CNCApp.Mach3BridgeDriver.connected) {
        CNCApp.Mach3BridgeDriver.syncConfig();
      }

      this.updateUI();
      CNCApp.Table.render();
      CNCApp.Canvas.render();

      if (!stayInCalib) {
        alert(
          '✅ Успешна калибрација за Д' + d.id + ' (' + d.name + ')!\n\n' +
          '• Стар офсет: X=' + oldOffsetX.toFixed(3) + ', Y=' + oldOffsetY.toFixed(3) + ' mm\n' +
          '• Нов офсет: X=' + finalNewOffsetX.toFixed(3) + ', Y=' + finalNewOffsetY.toFixed(3) + ' mm'
        );
        this.closeUI();
      }
    },

    applyAndNext: function() {
      if (this.deltaX !== 0 || this.deltaY !== 0) {
        this.applyCurrentDispenser(true);
      }

      var dispensers = CNCApp.State.machine.dispensers || [];
      if (dispensers.length === 0) return;

      var curIdx = 0;
      for (var i = 0; i < dispensers.length; i++) {
        if (dispensers[i].id === this.activeDispenserId) {
          curIdx = i;
          break;
        }
      }

      var nextIdx = (curIdx + 1) % dispensers.length;
      var nextDisp = dispensers[nextIdx];
      this.selectDispenser(nextDisp.id);
    }
  };

  CNCApp.Calibration = Calibration;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      Calibration.init();
    });
  } else {
    Calibration.init();
  }
})();