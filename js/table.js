window.CNCApp = window.CNCApp || {};

CNCApp.Table = {
  dragSourceIndex: null,

  _isLockedForEdit: function() {
    if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) return true;
    return false;
  },

  updateSelectionUI: function() {
    const tb = document.getElementById('tableBody');
    const pts = CNCApp.State.points || [];
    if (!tb || tb.children.length !== pts.length) {
      this.render();
      return;
    }
    const countBadge = document.getElementById('selectedCount');
    if (countBadge) {
      countBadge.innerText = 'Селектирани: ' + CNCApp.State.selectedIndices.size;
    }
    for (let i = 0; i < tb.children.length; i++) {
      const tr = tb.children[i];
      if (CNCApp.State.selectedIndices.has(i)) tr.classList.add('selected');
      else tr.classList.remove('selected');
      if (CNCApp.State.activePointIndex === i) tr.classList.add('active-focus');
      else tr.classList.remove('active-focus');
    }
  },

  render: function() {
    this.enforceDispenserSafety();
    this.bindContextMenu();
    const tb = document.getElementById('tableBody');
    tb.innerHTML = '';
    const pts = CNCApp.State.points;
    const countBadge = document.getElementById('selectedCount');
    countBadge.innerText = 'Селектирани: ' + CNCApp.State.selectedIndices.size;
    const step = CNCApp.State.stepIncrement || 0.05;
    const isReadOnly = this._isLockedForEdit();
    const disAttr = isReadOnly ? 'disabled' : '';
    const frag = document.createDocumentFragment();

    pts.forEach((p, idx) => {
      const tr = document.createElement('tr');
      tr.id = 'row-' + idx;
      tr.dataset.index = idx;
      if (CNCApp.State.selectedIndices.has(idx)) tr.classList.add('selected');
      if (CNCApp.State.activePointIndex === idx) tr.classList.add('active-focus');
      if (!p.active) tr.classList.add('inactive-row');

      const esc = (CNCApp.State && typeof CNCApp.State.escapeHtml === 'function')
        ? CNCApp.State.escapeHtml
        : function(s) { return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };

      tr.innerHTML = `
        <td class="drag-handle" draggable="${isReadOnly ? 'false' : 'true'}" title="${isReadOnly ? 'Заклучено додека машината работи' : 'Повлечи за прередување'}">☰</td>
        <td data-field="active" title="Десен клик за опции"><input type="checkbox" ${p.active ? 'checked' : ''} ${disAttr} onchange="CNCApp.Table.updateField(${idx}, 'active', this.checked)"></td>
        <td>${idx + 1}</td>
        <td><input type="number" data-col="x" step="${step}" value="${p.x.toFixed(3)}" ${disAttr} onchange="CNCApp.Table.updateField(${idx}, 'x', parseFloat(parseFloat(this.value).toFixed(3)))"></td>
        <td><input type="number" data-col="y" step="${step}" value="${p.y.toFixed(3)}" ${disAttr} onchange="CNCApp.Table.updateField(${idx}, 'y', parseFloat(parseFloat(this.value).toFixed(3)))"></td>
        <td><input type="number" value="${Math.round(p.speed)}" ${disAttr} onchange="CNCApp.Table.updateField(${idx}, 'speed', Math.round(parseFloat(this.value) || 1000))"></td>
        <td data-field="lower" title="Десен клик за опции"><input type="checkbox" ${p.lower ? 'checked' : ''} ${disAttr} onchange="CNCApp.Table.updateField(${idx}, 'lower', this.checked)"></td>
        <td data-field="valveStart" title="Десен клик за опции"><input type="checkbox" ${p.valveStart ? 'checked' : ''} ${disAttr} onchange="CNCApp.Table.updateField(${idx}, 'valveStart', this.checked)"></td>
        <td><input type="number" value="${p.time !== '' ? Math.round(p.time) : ''}" placeholder="" style="width:42px" ${disAttr} onchange="CNCApp.Table.updateField(${idx}, 'time', this.value !== '' ? Math.round(parseFloat(this.value)) : '')"></td>
        <td data-field="valveStop" title="Десен клик за опции"><input type="checkbox" ${p.valveStop ? 'checked' : ''} ${disAttr} onchange="CNCApp.Table.updateField(${idx}, 'valveStop', this.checked)"></td>
        <td data-field="raise" title="Десен клик за опции"><input type="checkbox" ${p.raise ? 'checked' : ''} ${disAttr} onchange="CNCApp.Table.updateField(${idx}, 'raise', this.checked)"></td>
        <td>
          <select ${disAttr} onchange="CNCApp.Table.updateField(${idx}, 'dispenser', parseInt(this.value))">
            ${CNCApp.State.machine.dispensers.map(d => `<option value="${d.id}" ${p.dispenser === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
          </select>
        </td>
        <td><input type="text" value="${esc(p.group1)}" ${disAttr} onchange="CNCApp.Table.updateField(${idx}, 'group1', this.value)"></td>
        <td><input type="text" value="${esc(p.group2)}" ${disAttr} onchange="CNCApp.Table.updateField(${idx}, 'group2', this.value)"></td>
      `;

      const handle = tr.querySelector('.drag-handle');
      handle.addEventListener('dragstart', (e) => {
        if (this._isLockedForEdit() || (CNCApp.Calibration && CNCApp.Calibration.active)) {
          e.preventDefault();
          return;
        }
        CNCApp.Table.dragSourceIndex = idx;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', idx);
      });

      tr.addEventListener('dragover', (e) => {
        e.preventDefault();
        tr.classList.add('drag-over');
      });

      tr.addEventListener('dragleave', () => {
        tr.classList.remove('drag-over');
      });

      tr.addEventListener('drop', (e) => {
        e.preventDefault();
        tr.classList.remove('drag-over');
        if (CNCApp.Calibration && CNCApp.Calibration.active) return;
        const fromIdx = CNCApp.Table.dragSourceIndex;
        const toIdx = idx;
        if (fromIdx !== null && fromIdx !== toIdx) {
          CNCApp.Table.moveRow(fromIdx, toIdx);
        }
      });

      tr.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.classList.contains('drag-handle')) return;
        if (CNCApp.Calibration && CNCApp.Calibration.active) return;

        if (e.shiftKey && CNCApp.State.lastSelectedRowIndex !== null) {
          const start = Math.min(CNCApp.State.lastSelectedRowIndex, idx);
          const end = Math.max(CNCApp.State.lastSelectedRowIndex, idx);
          if (!e.ctrlKey) CNCApp.State.selectedIndices.clear();
          for (let r = start; r <= end; r++) {
            CNCApp.State.selectedIndices.add(r);
          }
        } else {
          if (!e.ctrlKey) CNCApp.State.selectedIndices.clear();
          CNCApp.State.selectedIndices.add(idx);
          CNCApp.State.lastSelectedRowIndex = idx;
        }

        CNCApp.State.activePointIndex = idx;
        CNCApp.Table.updateSelectionUI();
        CNCApp.Canvas.render();
      });

      frag.appendChild(tr);
    });

    tb.appendChild(frag);

    CNCApp.GCode.updateCycleTime();
    CNCApp.Table.updateGroupDropdown();
  },

  moveRow: function(fromIdx, toIdx) {
    if (this._isLockedForEdit()) return;
    if (CNCApp.Calibration && CNCApp.Calibration.active) {
      alert('⚠️ Прво затворете ја калибрацијата пред да го менувате редоследот на точките.');
      return;
    }
    const moved = CNCApp.State.points.splice(fromIdx, 1)[0];
    CNCApp.State.points.splice(toIdx, 0, moved);

    CNCApp.State.selectedIndices.clear();
    CNCApp.State.selectedIndices.add(toIdx);
    CNCApp.State.activePointIndex = toIdx;
    CNCApp.State.lastSelectedRowIndex = toIdx;

    this.enforceDispenserSafety();
    CNCApp.State.snapshot();
    this.render();
    CNCApp.Canvas.render();
    this.scrollToRow(toIdx);
  },

  moveSelectedUp: function() {
    if (this._isLockedForEdit()) return;
    if (CNCApp.Calibration && CNCApp.Calibration.active) {
      alert('⚠️ Прво затворете ја калибрацијата пред да го менувате редоследот на точките.');
      return;
    }
    const sel = Array.from(CNCApp.State.selectedIndices).sort((a, b) => a - b);
    if (sel.length === 0 || sel[0] === 0) return;

    sel.forEach(idx => {
      const temp = CNCApp.State.points[idx - 1];
      CNCApp.State.points[idx - 1] = CNCApp.State.points[idx];
      CNCApp.State.points[idx] = temp;
    });

    const newSel = new Set(sel.map(i => i - 1));
    CNCApp.State.selectedIndices = newSel;
    if (CNCApp.State.activePointIndex !== null && CNCApp.State.activePointIndex > 0) {
      CNCApp.State.activePointIndex--;
    }

    this.enforceDispenserSafety();
    CNCApp.State.snapshot();
    this.render();
    CNCApp.Canvas.render();
    this.scrollToRow(Array.from(newSel)[0]);
  },

  moveSelectedDown: function() {
    if (this._isLockedForEdit()) return;
    if (CNCApp.Calibration && CNCApp.Calibration.active) {
      alert('⚠️ Прво затворете ја калибрацијата пред да го менувате редоследот на точките.');
      return;
    }
    const sel = Array.from(CNCApp.State.selectedIndices).sort((a, b) => b - a);
    if (sel.length === 0 || sel[0] >= CNCApp.State.points.length - 1) return;

    sel.forEach(idx => {
      const temp = CNCApp.State.points[idx + 1];
      CNCApp.State.points[idx + 1] = CNCApp.State.points[idx];
      CNCApp.State.points[idx] = temp;
    });

    const newSel = new Set(sel.map(i => i + 1));
    CNCApp.State.selectedIndices = newSel;
    if (CNCApp.State.activePointIndex !== null && CNCApp.State.activePointIndex < CNCApp.State.points.length - 1) {
      CNCApp.State.activePointIndex++;
    }

    this.enforceDispenserSafety();
    CNCApp.State.snapshot();
    this.render();
    CNCApp.Canvas.render();
    this.scrollToRow(Array.from(newSel)[0]);
  },

  updateField: function(idx, field, val) {
    if (this._isLockedForEdit()) {
      this.render();
      return;
    }
    if (CNCApp.Calibration && CNCApp.Calibration.active) {
      alert('⚠️ Прво затворете ја калибрацијата (Сними или Затвори) пред да менувате полиња во табелата.');
      this.render();
      return;
    }
    if (field === 'active') {
      this.enforceActiveSafety(idx, val);
      CNCApp.State.points[idx][field] = val;
      this.enforceDispenserSafety();
      this.render();
    } else {
      if (field === 'speed' && CNCApp.State.selectedIndices.has(idx) && CNCApp.State.selectedIndices.size > 1) {
        CNCApp.State.selectedIndices.forEach(sIdx => {
          if (CNCApp.State.points[sIdx]) CNCApp.State.points[sIdx].speed = val;
        });
        this.render();
      } else {
        CNCApp.State.points[idx][field] = val;
        if (field === 'dispenser') {
          this.enforceDispenserSafety();
          this.render();
        }
      }
    }
    CNCApp.State.snapshot();
    CNCApp.Canvas.render();
    CNCApp.GCode.updateCycleTime();
    if (field === 'group1' || field === 'group2') {
      CNCApp.Table.updateGroupDropdown();
    }
  },

  updateRow: function(idx) {
    const tr = document.getElementById('row-' + idx);
    if (!tr || !CNCApp.State.points[idx]) return;
    const xInp = tr.querySelector('input[data-col="x"]');
    const yInp = tr.querySelector('input[data-col="y"]');
    if (xInp) xInp.value = CNCApp.State.points[idx].x.toFixed(3);
    if (yInp) yInp.value = CNCApp.State.points[idx].y.toFixed(3);
  },

  scrollToRow: function(idx) {
    var tr = document.getElementById('row-' + idx);
    if (!tr) return;
    var scrollWrap = tr.closest ? tr.closest('.table-scroll') : document.querySelector('.table-scroll');
    if (scrollWrap) {
      var thead = scrollWrap.querySelector ? scrollWrap.querySelector('thead') : null;
      var stickyHeaderH = (thead && thead.offsetHeight) ? thead.offsetHeight : 26;
      if (idx <= 1) {
        scrollWrap.scrollTop = 0;
      } else {
        var rowMinus2 = document.getElementById('row-' + (idx - 2));
        if (rowMinus2) {
          scrollWrap.scrollTop = Math.max(0, rowMinus2.offsetTop - stickyHeaderH);
        } else {
          var rowH = tr.offsetHeight || 26;
          scrollWrap.scrollTop = Math.max(0, tr.offsetTop - (rowH * 2) - stickyHeaderH);
        }
      }
      return;
    }
    try {
      tr.scrollIntoView(false);
    } catch (e) {}
  },

  insertNewPointAt: function(x, y) {
    if (this._isLockedForEdit()) return;
    if (CNCApp.Calibration && CNCApp.Calibration.active) {
      alert('⚠️ Прво затворете ја калибрацијата пред да додавате нови точки.');
      return;
    }
    let refPt = null;
    let targetIdx = CNCApp.State.points.length;

    if (CNCApp.State.activePointIndex !== null && CNCApp.State.activePointIndex < CNCApp.State.points.length) {
      refPt = CNCApp.State.points[CNCApp.State.activePointIndex];
      targetIdx = CNCApp.State.activePointIndex + 1;
    } else if (CNCApp.State.selectedIndices.size > 0) {
      const selArr = Array.from(CNCApp.State.selectedIndices).sort((a, b) => a - b);
      const lastSel = selArr[selArr.length - 1];
      refPt = CNCApp.State.points[lastSel];
      targetIdx = lastSel + 1;
    } else if (CNCApp.State.points.length > 0) {
      refPt = CNCApp.State.points[CNCApp.State.points.length - 1];
      targetIdx = CNCApp.State.points.length;
    }

    const pt = CNCApp.State.createPoint(x, y, refPt);

    if (targetIdx < CNCApp.State.points.length) {
      CNCApp.State.points.splice(targetIdx, 0, pt);
    } else {
      CNCApp.State.points.push(pt);
    }

    CNCApp.State.activePointIndex = targetIdx;
    CNCApp.State.selectedIndices.clear();
    CNCApp.State.selectedIndices.add(targetIdx);
    CNCApp.State.lastSelectedRowIndex = targetIdx;
    this.enforceDispenserSafety();
    CNCApp.State.snapshot();
    this.render();
    CNCApp.Canvas.render();
    this.scrollToRow(targetIdx);
  },

  updateGroupDropdown: function() {
    const sel = document.getElementById('selByGroup');
    if (!sel) return;
    const curVal = sel.value;
    const groups = new Set();
    CNCApp.State.points.forEach(p => {
      if (p.group1 && p.group1.trim()) groups.add(p.group1.trim());
      if (p.group2 && p.group2.trim()) groups.add(p.group2.trim());
    });

    sel.innerHTML = '<option value="">-- Избери група --</option>';
    if (groups.size === 0) {
      sel.innerHTML = '<option value="">-- Нема групи --</option>';
    } else {
      const esc = (CNCApp.State && typeof CNCApp.State.escapeHtml === 'function')
        ? CNCApp.State.escapeHtml
        : function(s) { return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
      Array.from(groups).sort().forEach(g => {
        const eg = esc(g);
        sel.innerHTML += `<option value="${eg}">${eg}</option>`;
      });
    }
    sel.value = curVal;
  },

  enforceActiveSafety: function(idx, newActiveVal) {
    const pts = CNCApp.State.points;
    if (!pts || !pts[idx]) return;
    const cur = pts[idx];

    if (!newActiveVal) {
      if (cur.raise || cur.valveStop) {
        for (let i = idx - 1; i >= 0; i--) {
          if (pts[i].active) {
            pts[i].valveStop = true;
            pts[i].raise = true;
            break;
          }
        }
      }

      if (cur.lower || cur.valveStart) {
        for (let i = idx + 1; i < pts.length; i++) {
          if (pts[i].active) {
            pts[i].lower = true;
            pts[i].valveStart = true;
            break;
          }
        }
      }
    } else {
      if (cur.raise || cur.valveStop) {
        for (let i = idx - 1; i >= 0; i--) {
          if (pts[i].active) {
            if (pts[i].dispenser === cur.dispenser && (pts[i].time === '' || pts[i].time === 0)) {
              pts[i].valveStop = false;
              pts[i].raise = false;
            }
            break;
          }
        }
      }
    }
  },

  enforceDispenserSafety: function() {
    const pts = CNCApp.State.points;
    if (!pts || pts.length < 2) return false;
    let modified = false;
    let prevActive = null;

    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i];
      if (!cur || !cur.active) continue;
      if (prevActive && prevActive.dispenser !== cur.dispenser) {
        if (!prevActive.raise) {
          prevActive.raise = true;
          modified = true;
        }
        if (!prevActive.valveStop) {
          prevActive.valveStop = true;
          modified = true;
        }
        // Првата точка од новиот диспензер мора да се спушти пред да дозира
        if (!cur.lower) {
          cur.lower = true;
          modified = true;
        }
      }
      prevActive = cur;
    }
    return modified;
  },

  bindContextMenu: function() {
    const table = document.getElementById('pointsTable');
    if (!table || this._contextMenuBound) return;
    this._contextMenuBound = true;

    const speedHeader = table.querySelector('th[data-field="speed"]');
    if (speedHeader) {
      speedHeader.addEventListener('click', (e) => {
        e.preventDefault();
        if (this._isLockedForEdit()) return;
        CNCApp.Table.promptBulkSpeed();
      });
    }

    table.addEventListener('contextmenu', (e) => {
      if (this._isLockedForEdit()) return;
      if (CNCApp.Calibration && CNCApp.Calibration.active) return;
      const cell = e.target.closest('[data-field]');
      if (!cell) return;

      const field = cell.dataset.field;
      if (!field) return;

      e.preventDefault();
      e.stopPropagation();

      const tr = cell.closest('tr');
      if (tr && tr.dataset && tr.dataset.index !== undefined) {
        const rowIdx = parseInt(tr.dataset.index);
        if (CNCApp.State.selectedIndices.size === 0 || !CNCApp.State.selectedIndices.has(rowIdx)) {
          CNCApp.State.selectedIndices.add(rowIdx);
          CNCApp.State.activePointIndex = rowIdx;
          CNCApp.Table.updateSelectionUI();
          CNCApp.Canvas.render();
        }
      }

      CNCApp.Table.showContextMenu(e.clientX, e.clientY, field);
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#tableContextMenu')) {
        CNCApp.Table.closeContextMenu();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') CNCApp.Table.closeContextMenu();
    });
  },

  showContextMenu: function(x, y, field) {
    this.closeContextMenu();

    const fieldNames = {
      active: 'Акт (Активно во G-код)',
      lower: 'Доле (Спушти главата)',
      valveStart: 'Боја ст. (Отвори вентил)',
      valveStop: 'Боја стп. (Затвори вентил)',
      raise: 'Горе (Крени главата)',
      speed: 'Брзина (Feedrate F)'
    };

    const title = fieldNames[field] || field;
    const selCount = CNCApp.State.selectedIndices.size;
    if (selCount === 0) return;

    const menu = document.createElement('div');
    menu.id = 'tableContextMenu';
    menu.className = 'table-context-menu';
    menu.style.left = Math.min(x, window.innerWidth - 250) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 200) + 'px';

    if (field === 'speed') {
      menu.innerHTML = `
        <div class="context-menu-header">⚡ Брзина (Feedrate) - ${selCount} точки</div>
        <div class="context-menu-item" id="ctxSelectIntermediate">
          <span style="color:#059669;font-weight:bold;">⚡</span> Селектирај само меѓуточки во линија
        </div>
        <div class="context-menu-item" id="ctxSetSpeed">
          <span style="color:#2563eb;font-weight:bold;">✏️</span> Постави брзина за селектираните...
        </div>
        <div class="context-menu-item" id="ctxSpeedPlus10">
          <span style="color:#10b981;font-weight:bold;">▲</span> Зголеми за +10%
        </div>
        <div class="context-menu-item" id="ctxSpeedMinus10">
          <span style="color:#ef4444;font-weight:bold;">▼</span> Намали за -10%
        </div>
      `;

      document.body.appendChild(menu);

      document.getElementById('ctxSelectIntermediate').onclick = (e) => {
        e.stopPropagation();
        CNCApp.Table.selectIntermediatePoints();
        CNCApp.Table.closeContextMenu();
      };

      document.getElementById('ctxSetSpeed').onclick = (e) => {
        e.stopPropagation();
        CNCApp.Table.closeContextMenu();
        CNCApp.Table.promptBulkSpeed();
      };

      document.getElementById('ctxSpeedPlus10').onclick = (e) => {
        e.stopPropagation();
        CNCApp.Table.scaleSpeed(1.10);
        CNCApp.Table.closeContextMenu();
      };

      document.getElementById('ctxSpeedMinus10').onclick = (e) => {
        e.stopPropagation();
        CNCApp.Table.scaleSpeed(0.90);
        CNCApp.Table.closeContextMenu();
      };
      return;
    }

    menu.innerHTML = `
      <div class="context-menu-header">📋 ${title} (${selCount} селектирани)</div>
      <div class="context-menu-item" id="ctxCheckAll">
        <span style="color:#10b981;font-weight:bold;">✔</span> Чекирај за сите (${selCount})
      </div>
      <div class="context-menu-item" id="ctxUncheckAll">
        <span style="color:#ef4444;font-weight:bold;">✖</span> Одчекирај за сите (${selCount})
      </div>
      <div class="context-menu-item" id="ctxToggleAll">
        <span style="color:#2563eb;font-weight:bold;">🔄</span> Инвертирај состојба
      </div>
    `;

    document.body.appendChild(menu);

    document.getElementById('ctxCheckAll').onclick = (e) => {
      e.stopPropagation();
      CNCApp.Table.bulkSetCheckbox(field, true);
      CNCApp.Table.closeContextMenu();
    };

    document.getElementById('ctxUncheckAll').onclick = (e) => {
      e.stopPropagation();
      CNCApp.Table.bulkSetCheckbox(field, false);
      CNCApp.Table.closeContextMenu();
    };

    document.getElementById('ctxToggleAll').onclick = (e) => {
      e.stopPropagation();
      CNCApp.Table.bulkToggleCheckbox(field);
      CNCApp.Table.closeContextMenu();
    };
  },

  closeContextMenu: function() {
    const existing = document.getElementById('tableContextMenu');
    if (existing) existing.remove();
  },

  _applyBulkActiveChanges: function(changes) {
    const pts = CNCApp.State.points;
    if (!pts || !changes || changes.length === 0) return;

    const snapshotFlags = [];
    for (let k = 0; k < changes.length; k++) {
      const ch = changes[k];
      const p = pts[ch.idx];
      if (!p) continue;
      snapshotFlags.push({
        idx: ch.idx,
        prevActive: !!p.active,
        nextActive: !!ch.nextActive,
        lower: !!p.lower,
        valveStart: !!p.valveStart,
        valveStop: !!p.valveStop,
        raise: !!p.raise
      });
    }

    for (let k = 0; k < snapshotFlags.length; k++) {
      const item = snapshotFlags[k];
      pts[item.idx].active = item.nextActive;
    }

    snapshotFlags.sort(function(a, b) { return a.idx - b.idx; });

    for (let k = 0; k < snapshotFlags.length; k++) {
      const item = snapshotFlags[k];
      if (item.prevActive && !item.nextActive) {
        if (item.raise || item.valveStop) {
          for (let i = item.idx - 1; i >= 0; i--) {
            if (pts[i] && pts[i].active) {
              pts[i].valveStop = true;
              pts[i].raise = true;
              break;
            }
          }
        }
        if (item.lower || item.valveStart) {
          for (let i = item.idx + 1; i < pts.length; i++) {
            if (pts[i] && pts[i].active) {
              pts[i].lower = true;
              pts[i].valveStart = true;
              break;
            }
          }
        }
      }
    }

    for (let k = 0; k < snapshotFlags.length; k++) {
      const item = snapshotFlags[k];
      if (!item.prevActive && item.nextActive) {
        const cur = pts[item.idx];
        if (cur && (cur.raise || cur.valveStop)) {
          for (let i = item.idx - 1; i >= 0; i--) {
            if (pts[i] && pts[i].active) {
              if (pts[i].dispenser === cur.dispenser && (pts[i].time === '' || pts[i].time === 0)) {
                pts[i].valveStop = false;
                pts[i].raise = false;
              }
              break;
            }
          }
        }
      }
    }
  },

  bulkSetCheckbox: function(field, val) {
    if (this._isLockedForEdit()) return;
    const sel = CNCApp.State.selectedIndices;
    if (sel.size === 0) return;
    if (field === 'active') {
      const changes = [];
      sel.forEach(idx => {
        if (CNCApp.State.points[idx] && CNCApp.State.points[idx].active !== val) {
          changes.push({ idx: idx, nextActive: val });
        }
      });
      this._applyBulkActiveChanges(changes);
    } else {
      sel.forEach(idx => {
        if (CNCApp.State.points[idx]) {
          CNCApp.State.points[idx][field] = val;
        }
      });
    }
    this.enforceDispenserSafety();
    CNCApp.State.snapshot();
    this.render();
    CNCApp.Canvas.render();
    CNCApp.GCode.updateCycleTime();
  },

  bulkToggleCheckbox: function(field) {
    if (this._isLockedForEdit()) return;
    const sel = CNCApp.State.selectedIndices;
    if (sel.size === 0) return;
    if (field === 'active') {
      const changes = [];
      sel.forEach(idx => {
        if (CNCApp.State.points[idx]) {
          changes.push({ idx: idx, nextActive: !CNCApp.State.points[idx].active });
        }
      });
      this._applyBulkActiveChanges(changes);
    } else {
      sel.forEach(idx => {
        if (CNCApp.State.points[idx]) {
          CNCApp.State.points[idx][field] = !CNCApp.State.points[idx][field];
        }
      });
    }
    this.enforceDispenserSafety();
    CNCApp.State.snapshot();
    this.render();
    CNCApp.Canvas.render();
    CNCApp.GCode.updateCycleTime();
  },

  selectIntermediatePoints: function() {
    const pts = CNCApp.State.points;
    if (!pts || pts.length === 0) return;

    function isIntermediate(p) {
      return p.active && !p.lower && !p.valveStart && !p.valveStop && !p.raise;
    }

    const currentSel = Array.from(CNCApp.State.selectedIndices).sort((a, b) => a - b);
    const newSel = new Set();

    if (currentSel.length > 1) {
      currentSel.forEach(idx => {
        if (isIntermediate(pts[idx])) {
          newSel.add(idx);
        }
      });

      if (newSel.size === 0) {
        const start = currentSel[0];
        const end = currentSel[currentSel.length - 1];
        for (let i = start; i <= end; i++) {
          if (isIntermediate(pts[i])) newSel.add(i);
        }
      }
    } else if (currentSel.length === 1 || (CNCApp.State.activePointIndex !== null && CNCApp.State.activePointIndex >= 0)) {
      const targetIdx = currentSel.length === 1 ? currentSel[0] : CNCApp.State.activePointIndex;
      const targetDisp = pts[targetIdx].dispenser;

      let lineStart = targetIdx;
      while (lineStart > 0 && pts[lineStart - 1].dispenser === targetDisp && !pts[lineStart - 1].raise && !pts[lineStart - 1].valveStop) {
        lineStart--;
        if (pts[lineStart].lower || pts[lineStart].valveStart) break;
      }

      let lineEnd = targetIdx;
      while (lineEnd < pts.length - 1 && pts[lineEnd].dispenser === targetDisp && !pts[lineEnd].raise && !pts[lineEnd].valveStop) {
        lineEnd++;
        if (pts[lineEnd].raise || pts[lineEnd].valveStop) break;
      }

      for (let i = lineStart; i <= lineEnd; i++) {
        if (isIntermediate(pts[i])) newSel.add(i);
      }
    } else {
      pts.forEach((p, idx) => {
        if (isIntermediate(p)) newSel.add(idx);
      });
    }

    if (newSel.size > 0) {
      CNCApp.State.selectedIndices = newSel;
      const firstIdx = Array.from(newSel)[0];
      CNCApp.State.activePointIndex = firstIdx;
      CNCApp.State.lastSelectedRowIndex = firstIdx;
      this.updateSelectionUI();
      CNCApp.Canvas.render();
      this.scrollToRow(firstIdx);
    } else {
      alert("ℹ️ Не се пронајдени меѓуточки (точки без Доле/Горе/Вентил) во избраната селекција.");
    }
  },

  promptBulkSpeed: function() {
    if (this._isLockedForEdit()) return;
    const sel = CNCApp.State.selectedIndices;
    if (sel.size === 0) {
      this.selectIntermediatePoints();
    }
    if (CNCApp.State.selectedIndices.size === 0) return;

    const firstSel = Array.from(CNCApp.State.selectedIndices)[0];
    const firstPt = CNCApp.State.points[firstSel];
    const curSpeed = Math.round((firstPt && firstPt.speed) || 1000);
    const valStr = prompt(`Внесете нова брзина (Feedrate F) за ${CNCApp.State.selectedIndices.size} селектирани точки:`, curSpeed);
    if (valStr === null) return;
    const newSpeed = Math.round(parseFloat(valStr));
    if (isNaN(newSpeed) || newSpeed <= 0) {
      alert("Внесете валидна позитивна вредност за брзина.");
      return;
    }

    CNCApp.State.selectedIndices.forEach(idx => {
      if (CNCApp.State.points[idx]) {
        CNCApp.State.points[idx].speed = newSpeed;
      }
    });

    CNCApp.State.snapshot();
    this.render();
    CNCApp.Canvas.render();
    CNCApp.GCode.updateCycleTime();
  },

  scaleSpeed: function(factor) {
    if (this._isLockedForEdit()) return;
    const sel = CNCApp.State.selectedIndices;
    if (sel.size === 0) return;
    sel.forEach(idx => {
      const p = CNCApp.State.points[idx];
      if (p && p.speed > 0) {
        p.speed = Math.max(50, Math.round(p.speed * factor));
      }
    });
    CNCApp.State.snapshot();
    this.render();
    CNCApp.Canvas.render();
    CNCApp.GCode.updateCycleTime();
  }
};