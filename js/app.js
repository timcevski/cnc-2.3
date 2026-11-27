window.CNCApp = window.CNCApp || {};

document.addEventListener('DOMContentLoaded', function() {
  if (CNCApp.State && typeof CNCApp.State.normalizeMachineConfig === 'function') {
    CNCApp.State.normalizeMachineConfig();
  }
  CNCApp.Canvas.init();

  function escapeHtml(str) {
    if (CNCApp.State && typeof CNCApp.State.escapeHtml === 'function') {
      return CNCApp.State.escapeHtml(str);
    }
    return String(str === undefined || str === null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderCanvasDispenserFilters() {
    const container = document.getElementById('dispenserFilterButtons');
    if (!container) return;
    container.innerHTML = '';
    CNCApp.State.shadedDispensers = CNCApp.State.shadedDispensers || new Set();

    CNCApp.State.machine.dispensers.forEach(d => {
      const isShaded = CNCApp.State.shadedDispensers.has(d.id);
      const btn = document.createElement('button');
      btn.className = 'btn btn-xs';
      btn.style.display = 'inline-flex';
      btn.style.alignItems = 'center';
      btn.style.padding = '1px 5px';
      btn.style.fontSize = '10px';
      btn.style.fontWeight = '600';
      btn.style.cursor = 'pointer';
      btn.style.transition = '0.15s';
      btn.title = `Клик: вклучи/исклучи (shade) за ${d.name}. Alt+Клик: изолирај само овој диспензер.`;

      if (isShaded) {
        btn.style.background = '#f1f5f9';
        btn.style.color = '#94a3b8';
        btn.style.borderColor = '#cbd5e1';
        btn.style.opacity = '0.6';
        btn.style.textDecoration = 'line-through';
        btn.innerHTML = `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#cbd5e1;margin-right:3px;"></span>${escapeHtml(d.name)}`;
      } else {
        btn.style.background = '#ffffff';
        btn.style.color = '#0f172a';
        btn.style.borderColor = d.color;
        btn.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)';
        btn.innerHTML = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${escapeHtml(d.color)};margin-right:3px;"></span>${escapeHtml(d.name)}`;
      }

      btn.onclick = (e) => {
        if (CNCApp.Calibration && CNCApp.Calibration.active) {
          alert('⚠️ Затворете ја калибрацијата пред да ги менувате филтрите за бои.');
          return;
        }
        if (e.altKey) {
          CNCApp.State.shadedDispensers.clear();
          CNCApp.State.machine.dispensers.forEach(otherD => {
            if (otherD.id !== d.id) CNCApp.State.shadedDispensers.add(otherD.id);
          });
        } else {
          if (CNCApp.State.shadedDispensers.has(d.id)) {
            CNCApp.State.shadedDispensers.delete(d.id);
          } else {
            CNCApp.State.shadedDispensers.add(d.id);
          }
        }
        renderCanvasDispenserFilters();
        CNCApp.Canvas.render();
      };

      container.appendChild(btn);
    });

    if (CNCApp.State.shadedDispensers.size > 0) {
      const btnAll = document.createElement('button');
      btnAll.className = 'btn btn-xs';
      btnAll.style.fontSize = '10px';
      btnAll.style.padding = '1px 5px';
      btnAll.style.color = '#2563eb';
      btnAll.style.fontWeight = 'bold';
      btnAll.innerText = 'Сите';
      btnAll.title = 'Прикажи ги сите диспензери одеднаш';
      btnAll.onclick = () => {
        if (CNCApp.Calibration && CNCApp.Calibration.active) {
          alert('⚠️ Затворете ја калибрацијата пред да ги менувате филтрите за бои.');
          return;
        }
        CNCApp.State.shadedDispensers.clear();
        renderCanvasDispenserFilters();
        CNCApp.Canvas.render();
      };
      container.appendChild(btnAll);
    }
  }

  const btnToggleSvg = document.getElementById('btnToggleSvg');
  function updateSvgToggleUI() {
    if (!btnToggleSvg) return;
    const isVisible = CNCApp.State.showSvg !== false;
    btnToggleSvg.style.display = 'inline-flex';
    btnToggleSvg.style.alignItems = 'center';
    btnToggleSvg.style.padding = '1px 6px';
    btnToggleSvg.style.fontSize = '10.5px';
    btnToggleSvg.style.fontWeight = '600';
    btnToggleSvg.style.cursor = 'pointer';
    btnToggleSvg.style.transition = '0.15s';

    if (isVisible) {
      btnToggleSvg.style.background = '#ffffff';
      btnToggleSvg.style.color = '#1e293b';
      btnToggleSvg.style.borderColor = '#6366f1';
      btnToggleSvg.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)';
      btnToggleSvg.style.opacity = '1.0';
      btnToggleSvg.style.textDecoration = 'none';
      btnToggleSvg.innerHTML = '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#6366f1;margin-right:3px;"></span>🖼️ SVG';
      btnToggleSvg.title = 'Клик: исклучи приказ на SVG подлогата на графикот';
    } else {
      btnToggleSvg.style.background = '#f1f5f9';
      btnToggleSvg.style.color = '#94a3b8';
      btnToggleSvg.style.borderColor = '#cbd5e1';
      btnToggleSvg.style.boxShadow = 'none';
      btnToggleSvg.style.opacity = '0.6';
      btnToggleSvg.style.textDecoration = 'line-through';
      btnToggleSvg.innerHTML = '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#cbd5e1;margin-right:3px;"></span>🖼️ SVG';
      btnToggleSvg.title = 'Клик: вклучи приказ на SVG подлогата на графикот';
    }
  }
  CNCApp.updateSvgToggleUI = updateSvgToggleUI;

  if (btnToggleSvg) {
    btnToggleSvg.onclick = () => {
      CNCApp.State.showSvg = (CNCApp.State.showSvg === false) ? true : false;
      updateSvgToggleUI();
      if (CNCApp.Tabs) CNCApp.Tabs.syncFromState();
      CNCApp.Canvas.render();
      if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
    };
    updateSvgToggleUI();
  }

  const btnToggleAdd = document.getElementById('btnToggleAddMode');
  function updateAddModeUI() {
    if (!btnToggleAdd) return;
    if (CNCApp.State.isAddMode) {
      btnToggleAdd.innerText = "➕ Точка: ВКЛ";
      btnToggleAdd.className = "btn btn-xs btn-addmode-on";
    } else {
      btnToggleAdd.innerText = "➕ Точка: ИСКЛ";
      btnToggleAdd.className = "btn btn-xs btn-addmode-off";
    }
  }

  const btnToggleClearance = document.getElementById('btnToggleClearance');
  function updateClearanceToggleUI() {
    if (!btnToggleClearance) return;
    if (CNCApp.State.showClearanceRings !== false) {
      btnToggleClearance.innerText = "⭕ Клиренс: ВКЛ";
      btnToggleClearance.style.background = "#f0fdf4";
      btnToggleClearance.style.color = "#166534";
    } else {
      btnToggleClearance.innerText = "⭕ Клиренс: ИСКЛ";
      btnToggleClearance.style.background = "#f1f5f9";
      btnToggleClearance.style.color = "#64748b";
    }
  }

  function populateDispenserSelectors() {
    const bColor = document.getElementById('batchColor');
    const selColor = document.getElementById('selByColor');
    bColor.innerHTML = '<option value="">-- Избери --</option>';
    selColor.innerHTML = '<option value="">-- По боја --</option>';
    CNCApp.State.machine.dispensers.forEach(d => {
      bColor.innerHTML += `<option value="${d.id}">${escapeHtml(d.name)}</option>`;
      selColor.innerHTML += `<option value="${d.id}">${escapeHtml(d.name)}</option>`;
    });
    renderCanvasDispenserFilters();
    if (CNCApp.Machine && typeof CNCApp.Machine.refreshDispenserSelect === 'function') {
      CNCApp.Machine.refreshDispenserSelect();
    }
  }

  function refreshToolbarStates() {
    populateDispenserSelectors();
    updateAddModeUI();
    updateSvgToggleUI();
    updateClearanceToggleUI();
    if (CNCApp.Machine && typeof CNCApp.Machine.refreshUI === 'function') {
      CNCApp.Machine.refreshUI();
    }
  }

  function decodeBase64Utf8(b64) {
    try {
      return decodeURIComponent(escape(atob(b64)));
    } catch (e) {
      return atob(b64);
    }
  }

  function fallbackDownloadSave(content, defaultName, mime) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = defaultName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() {
      try { URL.revokeObjectURL(url); } catch (e) {}
    }, 1500);
    return true;
  }

  function saveWithPicker(content, defaultName, mime, options) {
    var opts = options || {};
    if (window.showSaveFilePicker) {
      var ext = defaultName.indexOf('.') !== -1 ? '.' + defaultName.split('.').pop() : '.csv';
      var acceptObj = {};
      acceptObj[mime] = [ext];
      return window.showSaveFilePicker({
        suggestedName: defaultName,
        types: [{ description: 'Фајл', accept: acceptObj }]
      }).then(function(handle) {
        return handle.createWritable().then(function(writable) {
          return writable.write(content).then(function() {
            return writable.close().then(function() {
              if (opts.updateProjectName && handle && handle.name) {
                CNCApp.State.setProjectName(handle.name);
              }
              return true;
            });
          });
        });
      }).catch(function(err) {
        if (err && err.name === 'AbortError') return false;
        return fallbackDownloadSave(content, defaultName, mime);
      });
    }
    return Promise.resolve(fallbackDownloadSave(content, defaultName, mime));
  }

  function saveCurrentProject() {
    var csvContent = CNCApp.Parser.exportProjectCsv();
    var defaultName = CNCApp.State.projectName || 'cnc_project.csv';
    return saveWithPicker(csvContent, defaultName, 'text/csv', { updateProjectName: true })
      .then(function(saved) {
        if (saved !== false) {
          CNCApp.State.markDirty(false);
          if (CNCApp.Storage) CNCApp.Storage.saveAutoSave(true);
          return true;
        }
        return false;
      });
  }

  // 3-ОПЦИСКИ ДИЈАЛОГ ЗА НЕЗАЧУВАНИ ИЗМЕНИ
  var unsavedModalEl = document.getElementById('unsavedModal');
  var unsavedTitleEl = document.getElementById('unsavedModalTitle');
  var unsavedMsgEl = document.getElementById('unsavedModalMessage');
  var btnUnsavedSave = document.getElementById('btnUnsavedSave');
  var btnUnsavedDiscard = document.getElementById('btnUnsavedDiscard');
  var btnUnsavedCancel = document.getElementById('btnUnsavedCancel');
  var btnCloseUnsavedModal = document.getElementById('btnCloseUnsavedModal');
  var pendingUnsavedProceed = null;

  function closeUnsavedModal() {
    if (unsavedModalEl) unsavedModalEl.style.display = 'none';
    if (btnUnsavedSave) btnUnsavedSave.disabled = false;
    pendingUnsavedProceed = null;
  }

  function openUnsavedModal(titleText, messageHtml, onProceed) {
    if (!unsavedModalEl) {
      if (confirm(String(titleText || '') + '\n\nДали сакате да продолжите без да ги снимите промените?')) {
        if (typeof onProceed === 'function') onProceed();
      }
      return;
    }
    if (unsavedTitleEl) unsavedTitleEl.innerText = titleText || 'Незачувани измени';
    if (unsavedMsgEl) unsavedMsgEl.innerHTML = messageHtml || '';
    if (btnUnsavedSave) btnUnsavedSave.disabled = false;
    pendingUnsavedProceed = (typeof onProceed === 'function') ? onProceed : null;
    unsavedModalEl.style.display = 'flex';
  }

  if (btnUnsavedCancel) btnUnsavedCancel.onclick = closeUnsavedModal;
  if (btnCloseUnsavedModal) btnCloseUnsavedModal.onclick = closeUnsavedModal;
  if (btnUnsavedDiscard) {
    btnUnsavedDiscard.onclick = function() {
      var cb = pendingUnsavedProceed;
      closeUnsavedModal();
      if (cb) cb();
    };
  }
  if (btnUnsavedSave) {
    btnUnsavedSave.onclick = function() {
      var cb = pendingUnsavedProceed;
      btnUnsavedSave.disabled = true;
      saveCurrentProject().then(function(savedOk) {
        btnUnsavedSave.disabled = false;
        if (savedOk) {
          closeUnsavedModal();
          if (cb) cb();
        }
      }).catch(function() {
        btnUnsavedSave.disabled = false;
      });
    };
  }

  // ДИЈАЛОГ ЗА СПОРЕДБА НА ОФСЕТИ ПРИ ОТВОРАЊЕ .CSV ПРОЕКТ
  var csvOffsetsModalEl = document.getElementById('csvOffsetsModal');
  var csvOffsetsMsgEl = document.getElementById('csvOffsetsMessage');
  var csvOffsetsCompEl = document.getElementById('csvOffsetsComparison');
  var btnCsvKeepCurrent = document.getElementById('btnCsvKeepCurrent');
  var btnCsvUseFile = document.getElementById('btnCsvUseFile');
  var btnCloseCsvOffsetsModal = document.getElementById('btnCloseCsvOffsetsModal');
  var pendingCsvDispensers = null;

  function dispensersDiffer(currentList, fileList) {
    if (!Array.isArray(fileList) || fileList.length === 0) return false;
    if (!Array.isArray(currentList) || currentList.length !== fileList.length) return true;
    for (var i = 0; i < currentList.length; i++) {
      var a = currentList[i] || {};
      var b = fileList[i] || {};
      if (a.id !== b.id) return true;
      if (Math.abs((parseFloat(a.offsetX) || 0) - (parseFloat(b.offsetX) || 0)) > 0.0005) return true;
      if (Math.abs((parseFloat(a.offsetY) || 0) - (parseFloat(b.offsetY) || 0)) > 0.0005) return true;
      if (String(a.lowerCmd || '') !== String(b.lowerCmd || '')) return true;
      if (String(a.raiseCmd || '') !== String(b.raiseCmd || '')) return true;
    }
    return false;
  }

  function closeCsvOffsetsModal() {
    if (csvOffsetsModalEl) csvOffsetsModalEl.style.display = 'none';
    pendingCsvDispensers = null;
  }

  function openCsvOffsetsModal(fileName, fileDispensers) {
    if (!csvOffsetsModalEl) return;
    pendingCsvDispensers = JSON.parse(JSON.stringify(fileDispensers));

    if (csvOffsetsMsgEl) {
      csvOffsetsMsgEl.innerHTML =
        'Датотеката <strong>"' + escapeHtml(fileName) + '"</strong> содржи поинакви машински офсети/конфигурација на диспензери од моментално поставените на машината.<br>' +
        'За ваша безбедност, тековните офсети се <strong>задржани</strong>. Изберете дали сакате да останат тековните или да ги преземете од фајлот:';
    }

    if (csvOffsetsCompEl) {
      var cur = CNCApp.State.machine.dispensers || [];
      var maxLen = Math.max(cur.length, fileDispensers.length);
      var rowsHtml = '';
      for (var i = 0; i < maxLen; i++) {
        var cD = cur[i];
        var fD = fileDispensers[i];
        var cStr = cD ? ('X=' + Number(cD.offsetX || 0).toFixed(3) + ', Y=' + Number(cD.offsetY || 0).toFixed(3) + ' (' + escapeHtml(cD.lowerCmd || '') + ')') : '—';
        var fStr = fD ? ('X=' + Number(fD.offsetX || 0).toFixed(3) + ', Y=' + Number(fD.offsetY || 0).toFixed(3) + ' (' + escapeHtml(fD.lowerCmd || '') + ')') : '—';
        var diff = (!cD || !fD || Math.abs((cD.offsetX || 0) - (fD.offsetX || 0)) > 0.0005 || Math.abs((cD.offsetY || 0) - (fD.offsetY || 0)) > 0.0005 || String(cD.lowerCmd || '') !== String(fD.lowerCmd || ''));
        rowsHtml += '<div style="padding:3px 4px;border-bottom:1px solid #e2e8f0;' + (diff ? 'background:#fffbeb;' : '') + '">' +
          '<strong>Д' + (cD ? cD.id : (fD ? fD.id : (i + 1))) + ':</strong> ' +
          'Тековно: <span style="color:#1e40af;">' + cStr + '</span> | ' +
          'Во фајл: <span style="color:#b45309;">' + fStr + '</span>' +
          '</div>';
      }
      csvOffsetsCompEl.innerHTML = rowsHtml;
    }

    csvOffsetsModalEl.style.display = 'flex';
  }

  if (btnCsvKeepCurrent) btnCsvKeepCurrent.onclick = closeCsvOffsetsModal;
  if (btnCloseCsvOffsetsModal) btnCloseCsvOffsetsModal.onclick = closeCsvOffsetsModal;
  if (btnCsvUseFile) {
    btnCsvUseFile.onclick = function() {
      if (Array.isArray(pendingCsvDispensers) && pendingCsvDispensers.length > 0) {
        CNCApp.State.machine.dispensers = pendingCsvDispensers;
        if (typeof CNCApp.State.normalizeMachineConfig === 'function') {
          CNCApp.State.normalizeMachineConfig();
        }
        refreshToolbarStates();
        CNCApp.Table.render();
        CNCApp.Canvas.render();
        CNCApp.Storage.saveAutoSave(true);
        if (CNCApp.Machine && CNCApp.Machine.activeDriverId === 'mach3' && CNCApp.Mach3BridgeDriver && CNCApp.Mach3BridgeDriver.connected) {
          CNCApp.Mach3BridgeDriver.syncConfig();
        }
      }
      closeCsvOffsetsModal();
    };
  }

  // ДИНАМИЧКИ ДИСПЕНЗЕРИ (1 ДО N) ВО ПРИВРЕМЕНА КОПИЈА ДО „ЗАЧУВАЈ И ЗАТВОРИ“
  let draftDispensers = [];

  function syncDraftDispensersFromTable() {
    const rows = document.querySelectorAll('#dispensersTableBody tr');
    for (let i = 0; i < rows.length; i++) {
      if (!draftDispensers[i]) continue;
      const inputs = rows[i].querySelectorAll('input');
      if (inputs.length >= 6) {
        draftDispensers[i].name = inputs[0].value;
        draftDispensers[i].color = inputs[1].value;
        draftDispensers[i].lowerCmd = inputs[2].value;
        draftDispensers[i].raiseCmd = inputs[3].value;
        draftDispensers[i].offsetX = parseFloat(inputs[4].value) || 0;
        draftDispensers[i].offsetY = parseFloat(inputs[5].value) || 0;
      }
    }
  }

  function renderSettingsDispensers() {
    const tb = document.getElementById('dispensersTableBody');
    tb.innerHTML = '';
    draftDispensers.forEach((d, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${d.id}</td>
        <td><input type="text" value="${escapeHtml(d.name)}" class="inp inp-sm" style="width:90px"></td>
        <td><input type="color" value="${escapeHtml(d.color)}" style="width:34px;height:24px"></td>
        <td><input type="text" value="${escapeHtml(d.lowerCmd)}" class="inp inp-sm" style="width:72px"></td>
        <td><input type="text" value="${escapeHtml(d.raiseCmd)}" class="inp inp-sm" style="width:72px"></td>
        <td><input type="number" step="0.05" value="${d.offsetX}" class="inp inp-sm" style="width:70px"></td>
        <td><input type="number" step="0.05" value="${d.offsetY}" class="inp inp-sm" style="width:70px"></td>
        <td><button type="button" class="btn btn-xs btn-danger" onclick="CNCApp.App.deleteDispenser(${idx})">🗑️</button></td>
      `;
      tb.appendChild(tr);
    });
  }

  CNCApp.App = {
    renderCanvasDispenserFilters: renderCanvasDispenserFilters,
    refreshToolbarStates: refreshToolbarStates,
    isTabSwitchLocked: function() {
      return !!(CNCApp.Machine && typeof CNCApp.Machine.isTabSwitchLocked === 'function' && CNCApp.Machine.isTabSwitchLocked());
    },
    saveCurrentProject: saveCurrentProject,
    openUnsavedModal: openUnsavedModal,
    deleteDispenser: function(index) {
      syncDraftDispensersFromTable();
      if (draftDispensers.length <= 1) {
        alert("Мора да остане минимум 1 диспензер!");
        return;
      }
      draftDispensers.splice(index, 1);
      renderSettingsDispensers();
    }
  };

  // ИНИЦИЈАЛИЗАЦИЈА НА СОСТОЈБА И ТАБОВИ
  if (!CNCApp.Storage.loadAutoSave()) {
    if (CNCApp.Tabs) {
      CNCApp.Tabs.initWithDefaultDemo();
    } else {
      CNCApp.State.points.push(CNCApp.State.createPoint(10, 10));
      CNCApp.State.points.push(CNCApp.State.createPoint(25, 20));
      CNCApp.State.points.push(CNCApp.State.createPoint(35, 10));
      CNCApp.State.snapshot();
      CNCApp.State.markDirty(false);
      refreshToolbarStates();
      CNCApp.Table.render();
      CNCApp.Canvas.resetView();
      CNCApp.State.updateProjectUI();
    }
  }

  if (CNCApp.Machine && typeof CNCApp.Machine.init === 'function') {
    CNCApp.Machine.init();
  }

  const btnNewTab = document.getElementById('btnNewTab');
  if (btnNewTab) {
    btnNewTab.onclick = function() {
      if (CNCApp.Tabs) CNCApp.Tabs.newTab(true);
    };
  }

  const btnMenuNewProject = document.getElementById('btnMenuNewProject');
  if (btnMenuNewProject) {
    btnMenuNewProject.onclick = function() {
      if (CNCApp.Tabs) CNCApp.Tabs.newTab(true);
    };
  }

  // Интерактивност на главното мени (100% XP / Chrome 49 компатибилно без NodeList.forEach)
  const menuBar = document.getElementById('appMenuBar');
  if (menuBar) {
    const dropdownWrappers = menuBar.querySelectorAll('.menu-item-dropdown');

    function closeAllMenus() {
      for (var i = 0; i < dropdownWrappers.length; i++) {
        dropdownWrappers[i].classList.remove('open');
      }
    }

    for (var mIdx = 0; mIdx < dropdownWrappers.length; mIdx++) {
      (function(wrapper) {
        const trigger = wrapper.querySelector('.menu-trigger-btn');
        if (!trigger) return;

        trigger.addEventListener('click', function(e) {
          const content = wrapper.querySelector('.menu-dropdown-content');
          if (!content) return;

          e.stopPropagation();
          const isOpen = wrapper.classList.contains('open');
          closeAllMenus();
          if (!isOpen) {
            wrapper.classList.add('open');
          }
        });

        wrapper.addEventListener('mouseenter', function() {
          var anyOpen = false;
          for (var j = 0; j < dropdownWrappers.length; j++) {
            if (dropdownWrappers[j].classList.contains('open')) {
              anyOpen = true;
              break;
            }
          }
          if (anyOpen) {
            const content = wrapper.querySelector('.menu-dropdown-content');
            if (content) {
              closeAllMenus();
              wrapper.classList.add('open');
            }
          }
        });
      })(dropdownWrappers[mIdx]);
    }

    document.addEventListener('click', function(e) {
      if (!menuBar.contains(e.target)) {
        closeAllMenus();
      }
    });

    const actionItems = menuBar.querySelectorAll('.menu-action-item');
    for (var aIdx = 0; aIdx < actionItems.length; aIdx++) {
      actionItems[aIdx].addEventListener('click', function() {
        closeAllMenus();
      });
    }

    const btnMenuUndo = document.getElementById('btnMenuUndo');
    if (btnMenuUndo) btnMenuUndo.onclick = function() { if (CNCApp.State) CNCApp.State.undo(); };

    const btnMenuRedo = document.getElementById('btnMenuRedo');
    if (btnMenuRedo) btnMenuRedo.onclick = function() { if (CNCApp.State) CNCApp.State.redo(); };

    const btnMenuAddPoint = document.getElementById('btnMenuAddPoint');
    if (btnMenuAddPoint) btnMenuAddPoint.onclick = function() {
      const btn = document.getElementById('btnAddPoint');
      if (btn) btn.click();
    };

    const btnMenuDeleteSelected = document.getElementById('btnMenuDeleteSelected');
    if (btnMenuDeleteSelected) btnMenuDeleteSelected.onclick = function() {
      const btn = document.getElementById('btnDeleteSelected');
      if (btn) btn.click();
    };

    const btnMenuMoveUp = document.getElementById('btnMenuMoveUp');
    if (btnMenuMoveUp) btnMenuMoveUp.onclick = function() {
      if (CNCApp.Table) CNCApp.Table.moveSelectedUp();
    };

    const btnMenuMoveDown = document.getElementById('btnMenuMoveDown');
    if (btnMenuMoveDown) btnMenuMoveDown.onclick = function() {
      if (CNCApp.Table) CNCApp.Table.moveSelectedDown();
    };

    const btnMenuPresetLine = document.getElementById('btnMenuPresetLine');
    if (btnMenuPresetLine) btnMenuPresetLine.onclick = function() {
      const btn = document.getElementById('btnPresetLine');
      if (btn) btn.click();
    };
  }

  const btnCloseProject = document.getElementById('btnCloseProject');
  if (btnCloseProject) {
    btnCloseProject.onclick = function() {
      if (CNCApp.Tabs) {
        CNCApp.Tabs.closeTab(CNCApp.Tabs.activeTabId, false);
      }
    };
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const openMenu = document.querySelector('.menu-item-dropdown.open');
      if (openMenu) {
        openMenu.classList.remove('open');
        return;
      }
      if (csvOffsetsModalEl && csvOffsetsModalEl.style.display === 'flex') {
        e.preventDefault();
        closeCsvOffsetsModal();
        return;
      }
      if (unsavedModalEl && unsavedModalEl.style.display === 'flex') {
        e.preventDefault();
        closeUnsavedModal();
        return;
      }
      var gpModal = document.getElementById('gcodePreviewModal');
      if (gpModal && gpModal.style.display === 'flex') {
        e.preventDefault();
        gpModal.style.display = 'none';
        return;
      }
    }

    if ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === 's') {
      e.preventDefault();
      var saveBtn = document.getElementById('btnSaveProjectCsv');
      if (saveBtn) saveBtn.click();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      var openBtn = document.getElementById('btnOpenProjectCsv');
      if (openBtn) openBtn.click();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      if (CNCApp.Tabs) CNCApp.Tabs.newTab(true);
      return;
    }

    if (unsavedModalEl && unsavedModalEl.style.display === 'flex') return;
    if (csvOffsetsModalEl && csvOffsetsModalEl.style.display === 'flex') return;
    var settingsModalEl = document.getElementById('settingsModal');
    if (settingsModalEl && settingsModalEl.style.display === 'flex') return;
    var svgModalEl = document.getElementById('svgGeneratorModal');
    if (svgModalEl && svgModalEl.style.display === 'flex') return;
    var gpModalEl = document.getElementById('gcodePreviewModal');
    if (gpModalEl && gpModalEl.style.display === 'flex') return;

    const tag = document.activeElement ? document.activeElement.tagName : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    // ИТЕН СТОП (Emergency Stop): Escape го сопира циклусот доколку машината работи
    if (e.key === 'Escape') {
      if (CNCApp.Machine && (CNCApp.Machine.isBusy() || CNCApp.Machine.status === 'RUNNING')) {
        e.preventDefault();
        CNCApp.Machine.stopJob();
        return;
      }
    }

    // Кратенка за Операторски мод (F8 или Ctrl+O)
    if (e.key === 'F8' || ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === 'o')) {
      e.preventDefault();
      if (CNCApp.Machine && typeof CNCApp.Machine.toggleOperatorMode === 'function') {
        CNCApp.Machine.toggleOperatorMode();
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        if (CNCApp.State) CNCApp.State.redo();
      } else {
        if (CNCApp.State) CNCApp.State.undo();
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      if (CNCApp.State) CNCApp.State.redo();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      const btn = document.getElementById('btnSelectAll');
      if (btn) btn.click();
      return;
    }

    if (e.key === 'Delete') {
      e.preventDefault();
      const btn = document.getElementById('btnDeleteSelected');
      if (btn) btn.click();
      return;
    }

    if (!(CNCApp.Calibration && CNCApp.Calibration.active)) {
      if (e.key && e.key.indexOf('Arrow') === 0 && CNCApp.Machine && typeof CNCApp.Machine.handleKeyboardArrow === 'function') {
        if (CNCApp.Machine.handleKeyboardArrow(e)) return;
      }
    }

    if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) return;
    if (CNCApp.State.selectedIndices.size === 0) return;

    const step = (CNCApp.Calibration && CNCApp.Calibration.active && CNCApp.Calibration.nudgeStep)
      ? CNCApp.Calibration.nudgeStep
      : (CNCApp.State.stepIncrement || 0.05);
    let dx = 0, dy = 0;
    if (e.key === 'ArrowUp') dy = step;
    else if (e.key === 'ArrowDown') dy = -step;
    else if (e.key === 'ArrowLeft') dx = -step;
    else if (e.key === 'ArrowRight') dx = step;
    else return;

    e.preventDefault();

    if (CNCApp.Calibration && CNCApp.Calibration.active) {
      CNCApp.Calibration.nudge(dx, dy);
      return;
    }

    CNCApp.State.selectedIndices.forEach(idx => {
      const p = CNCApp.State.points[idx];
      if (p) {
        p.x = parseFloat((p.x + dx).toFixed(3));
        p.y = parseFloat((p.y + dy).toFixed(3));
        CNCApp.Table.updateRow(idx);
      }
    });

    CNCApp.Canvas.render();
    CNCApp.State.snapshot();
  });

  if (btnToggleAdd) {
    updateAddModeUI();
    btnToggleAdd.onclick = () => {
      if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) return;
      if (CNCApp.Calibration && CNCApp.Calibration.active) {
        alert('⚠️ Затворете ја калибрацијата пред да додавате нови точки.');
        return;
      }
      CNCApp.State.isAddMode = !CNCApp.State.isAddMode;
      if (CNCApp.State.isAddMode && CNCApp.Machine && CNCApp.Machine.isMoveToClickMode) {
        CNCApp.Machine.isMoveToClickMode = false;
        CNCApp.Machine.refreshUI();
      }
      updateAddModeUI();
      if (CNCApp.Tabs) CNCApp.Tabs.syncFromState();
      if (CNCApp.Canvas) CNCApp.Canvas.render();
      if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
    };
  }

  const btnToggleMoveClick = document.getElementById('btnToggleMoveToClick');
  if (btnToggleMoveClick) {
    btnToggleMoveClick.onclick = () => {
      if (CNCApp.Calibration && CNCApp.Calibration.active) {
        alert('⚠️ Затворете ја калибрацијата пред да го користите „Оди на клик“.');
        return;
      }
      if (CNCApp.Machine && typeof CNCApp.Machine.setMoveToClickMode === 'function') {
        CNCApp.Machine.setMoveToClickMode(!CNCApp.Machine.isMoveToClickMode);
        if (CNCApp.Tabs) CNCApp.Tabs.syncFromState();
        if (CNCApp.Canvas) CNCApp.Canvas.render();
      }
    };
  }

  document.getElementById('btnResetView').onclick = () => {
    CNCApp.Canvas.resetView();
  };

  document.getElementById('btnClearSvg').onclick = () => {
    if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) return;
    if (CNCApp.State.svgObjectUrl) {
      try { URL.revokeObjectURL(CNCApp.State.svgObjectUrl); } catch (e) {}
      CNCApp.State.svgObjectUrl = null;
    }
    CNCApp.State.svgData = null;
    CNCApp.State.svgImage = null;
    if (CNCApp.SvgGenerator) CNCApp.SvgGenerator.currentSvgString = null;
    updateSvgToggleUI();
    CNCApp.State.markDirty(true);
    CNCApp.Canvas.render();
    if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
  };

  if (btnToggleClearance) {
    updateClearanceToggleUI();
    btnToggleClearance.onclick = () => {
      CNCApp.State.showClearanceRings = (CNCApp.State.showClearanceRings === false) ? true : false;
      updateClearanceToggleUI();
      if (CNCApp.Tabs) CNCApp.Tabs.syncFromState();
      CNCApp.Canvas.render();
      if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
    };
  }

  document.getElementById('btnAddPoint').onclick = () => {
    if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) return;
    CNCApp.Table.insertNewPointAt(20, 20);
  };

  document.getElementById('btnMoveUp').onclick = () => CNCApp.Table.moveSelectedUp();
  document.getElementById('btnMoveDown').onclick = () => CNCApp.Table.moveSelectedDown();

  document.getElementById('btnDeleteSelected').onclick = () => {
    if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) return;
    if (CNCApp.Calibration && CNCApp.Calibration.active) {
      alert('⚠️ Прво затворете ја калибрацијата пред да бришете точки.');
      return;
    }
    const sel = CNCApp.State.selectedIndices;
    if (sel.size === 0) return;
    CNCApp.State.points = CNCApp.State.points.filter((_, idx) => !sel.has(idx));
    sel.clear();
    CNCApp.State.activePointIndex = null;
    CNCApp.State.lastSelectedRowIndex = null;
    CNCApp.State.snapshot();
    CNCApp.Table.render();
    CNCApp.Canvas.render();
  };

  document.getElementById('btnUndo').onclick = () => CNCApp.State.undo();
  document.getElementById('btnRedo').onclick = () => CNCApp.State.redo();

  document.getElementById('btnApplyBatchValues').onclick = () => {
    if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) return;
    if (CNCApp.Calibration && CNCApp.Calibration.active) {
      alert('⚠️ Прво затворете ја калибрацијата пред масовни измени.');
      return;
    }
    const sel = CNCApp.State.selectedIndices;
    if (sel.size === 0) return;

    const bColor = document.getElementById('batchColor');
    const bSpeed = document.getElementById('batchSpeed');
    const bTime = document.getElementById('batchTime');
    const bOffsetX = document.getElementById('batchOffsetX');
    const bOffsetY = document.getElementById('batchOffsetY');
    const bGroup1 = document.getElementById('batchGroup1');
    const bGroup2 = document.getElementById('batchGroup2');

    const col = parseInt(bColor.value);
    const spd = parseFloat(bSpeed.value);
    const tm = bTime.value !== '' ? parseFloat(bTime.value) : null;
    const ox = parseFloat(bOffsetX.value) || 0;
    const oy = parseFloat(bOffsetY.value) || 0;
    const g1 = bGroup1.value;
    const g2 = bGroup2.value;

    sel.forEach(idx => {
      const p = CNCApp.State.points[idx];
      if (col) p.dispenser = col;
      if (!isNaN(spd) && spd > 0) p.speed = Math.round(spd);
      if (tm !== null) p.time = Math.round(tm);
      if (ox !== 0) p.x = parseFloat((p.x + ox).toFixed(3));
      if (oy !== 0) p.y = parseFloat((p.y + oy).toFixed(3));
      if (g1) p.group1 = g1;
      if (g2) p.group2 = g2;
    });

    bColor.value = '';
    bSpeed.value = '';
    bTime.value = '';
    bOffsetX.value = '0';
    bOffsetY.value = '0';
    bGroup1.value = '';
    bGroup2.value = '';

    CNCApp.State.snapshot();
    CNCApp.Table.render();
    CNCApp.Canvas.render();
  };

  const btnLine = document.getElementById('btnPresetLine');
  if (btnLine) {
    btnLine.onclick = () => {
      if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) return;
      if (CNCApp.Calibration && CNCApp.Calibration.active) {
        alert('⚠️ Прво затворете ја калибрацијата.');
        return;
      }
      const sel = Array.from(CNCApp.State.selectedIndices).sort((a, b) => a - b);
      if (sel.length < 2) {
        alert("⚠️ За да формирате линија, потребно е да селектирате минимум 2 последователни точки.");
        return;
      }

      const firstDisp = CNCApp.State.points[sel[0]].dispenser;
      const hasMixedDispensers = sel.some(idx => CNCApp.State.points[idx].dispenser !== firstDisp);
      if (hasMixedDispensers) {
        alert("⛔ БЕЗБЕДНОСНА БЛОКАДА: Не може да се креира континуирана линија меѓу точки со различни бои/диспензери!\n\nСите селектирани точки мора да припаѓаат на ИСТ диспензер. За премин на друг диспензер, машината мора задолжително да го подигне алатот (Горе) за да се спречи судир или влечење на боја по материјалот.");
        return;
      }

      for (let i = 0; i < sel.length - 1; i++) {
        if (sel[i + 1] !== sel[i] + 1) {
          alert("⚠️ БЕЗБЕДНОСНА ПРОВЕРКА: Селектираните точки мора да бидат строго последователни во табелата (без прескокнување редови).");
          return;
        }
      }

      sel.forEach((idx, i) => {
        const p = CNCApp.State.points[idx];
        p.active = true;
        if (i === 0) {
          p.lower = true;
          p.valveStart = true;
          p.valveStop = false;
          p.raise = false;
        } else if (i === sel.length - 1) {
          p.lower = false;
          p.valveStart = false;
          p.valveStop = true;
          p.raise = true;
        } else {
          p.lower = false;
          p.valveStart = false;
          p.valveStop = false;
          p.raise = false;
        }
      });

      CNCApp.Table.enforceDispenserSafety();
      CNCApp.State.snapshot();
      CNCApp.Table.render();
      CNCApp.Canvas.render();
      CNCApp.GCode.updateCycleTime();
    };
  }

  document.getElementById('btnSpeedPlus5').onclick = () => scaleField('speed', 1.05);
  document.getElementById('btnSpeedMinus5').onclick = () => scaleField('speed', 0.95);
  document.getElementById('btnTimePlus5').onclick = () => scaleField('time', 1.05);
  document.getElementById('btnTimeMinus5').onclick = () => scaleField('time', 0.95);

  function scaleField(fld, factor) {
    if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) return;
    if (CNCApp.Calibration && CNCApp.Calibration.active) return;
    const sel = CNCApp.State.selectedIndices;
    if (sel.size === 0) return;
    sel.forEach(idx => {
      let v = parseFloat(CNCApp.State.points[idx][fld]) || 0;
      if (v > 0) {
        CNCApp.State.points[idx][fld] = Math.round(v * factor);
      }
    });
    CNCApp.State.snapshot();
    CNCApp.Table.render();
  }

  document.getElementById('btnSelectAll').onclick = () => {
    if (CNCApp.Calibration && CNCApp.Calibration.active) return;
    CNCApp.State.points.forEach((_, idx) => CNCApp.State.selectedIndices.add(idx));
    CNCApp.Table.render();
    CNCApp.Canvas.render();
  };
  document.getElementById('btnDeselectAll').onclick = () => {
    if (CNCApp.Calibration && CNCApp.Calibration.active) return;
    CNCApp.State.selectedIndices.clear();
    CNCApp.Table.render();
    CNCApp.Canvas.render();
  };
  document.getElementById('btnInvertSelect').onclick = () => {
    if (CNCApp.Calibration && CNCApp.Calibration.active) return;
    const cur = new Set(CNCApp.State.selectedIndices);
    CNCApp.State.selectedIndices.clear();
    CNCApp.State.points.forEach((_, idx) => {
      if (!cur.has(idx)) CNCApp.State.selectedIndices.add(idx);
    });
    CNCApp.Table.render();
    CNCApp.Canvas.render();
  };

  const btnSelInter = document.getElementById('btnSelectIntermediate');
  if (btnSelInter) {
    btnSelInter.onclick = () => {
      if (CNCApp.Calibration && CNCApp.Calibration.active) return;
      CNCApp.Table.selectIntermediatePoints();
    };
  }
  const btnSelPass = document.getElementById('btnSelectPassPoints');
  if (btnSelPass) {
    btnSelPass.onclick = () => {
      if (CNCApp.Calibration && CNCApp.Calibration.active) return;
      CNCApp.Table.selectIntermediatePoints();
    };
  }
  document.getElementById('selByColor').onchange = (e) => {
    if (CNCApp.Calibration && CNCApp.Calibration.active) return;
    const val = parseInt(e.target.value);
    if (!val) return;
    CNCApp.State.selectedIndices.clear();
    CNCApp.State.points.forEach((p, idx) => {
      if (p.dispenser === val) CNCApp.State.selectedIndices.add(idx);
    });
    CNCApp.Table.render();
    CNCApp.Canvas.render();
  };
  document.getElementById('selByGroup').onchange = (e) => {
    if (CNCApp.Calibration && CNCApp.Calibration.active) return;
    const txt = e.target.value;
    if (!txt) return;
    CNCApp.State.selectedIndices.clear();
    CNCApp.State.points.forEach((p, idx) => {
      if (p.group1 === txt || p.group2 === txt) CNCApp.State.selectedIndices.add(idx);
    });
    CNCApp.Table.render();
    CNCApp.Canvas.render();
  };

  document.getElementById('cycleTimeBox').onclick = () => {
    const t = CNCApp.GCode.telemetry;
    const mTotal = Math.floor(t.totalSec / 60);
    const sTotal = Math.round(t.totalSec % 60);
    const mMove = Math.floor(t.travelSec / 60);
    const sMove = Math.round(t.travelSec % 60);
    const mDwell = Math.floor(t.dwellSec / 60);
    const sDwell = Math.round(t.dwellSec % 60);
    alert(`📊 Детална статистика на програмот:\n\n` +
          `⏱️ Вкупно време: ${mTotal}м ${sTotal}с\n` +
          `🚗 Време на движење со рампи: ${mMove}м ${sMove}с\n` +
          `💧 Време на дозирање + M-латенција: ${mDwell}м ${sDwell}с\n` +
          `📏 Вкупна физичка патека: ${(t.totalDistMm / 1000).toFixed(3)} метри`);
  };

  const fileInp = document.getElementById('fileInput');
  let currentFileMode = '';

  function canModifyActiveTabForFileLoad() {
    var activeTab = CNCApp.Tabs ? CNCApp.Tabs.getActiveTab() : null;
    if (activeTab && activeTab.isRunningOnMachine) {
      alert('⛔ Овој таб моментално се извршува на машината и не смее да се пребрише со нова датотека. Отворете нов таб (➕ Нов таб) за друг проект.');
      return false;
    }
    return true;
  }

  function applyLoadedFileToCurrentTab(mode, fileName, txt) {
    if (mode === 'TXT') {
      var ptsTxt = CNCApp.Parser.parseTxt(txt);
      if (CNCApp.Tabs) {
        CNCApp.Tabs.resetActiveTabForLoadedData({
          clearSvg: true,
          points: ptsTxt,
          projectName: fileName
        });
      } else {
        CNCApp.State.points = ptsTxt;
        CNCApp.State.setProjectName(fileName);
        CNCApp.State.snapshot();
        CNCApp.State.markDirty(false);
        CNCApp.Table.render();
        CNCApp.Canvas.resetView();
      }
      if (CNCApp.SvgGenerator) CNCApp.SvgGenerator.currentSvgString = null;
    } else if (mode === 'LEGACY_CSV') {
      var resLegacy = CNCApp.Parser.parseLegacyCsv(txt);
      if (CNCApp.Tabs) {
        CNCApp.Tabs.resetActiveTabForLoadedData({
          clearSvg: true,
          points: resLegacy.points,
          header: resLegacy.header,
          footer: resLegacy.footer,
          projectName: fileName
        });
      } else {
        CNCApp.State.points = resLegacy.points;
        CNCApp.State.header = resLegacy.header;
        CNCApp.State.footer = resLegacy.footer;
        CNCApp.State.setProjectName(fileName);
        CNCApp.State.snapshot();
        CNCApp.State.markDirty(false);
        CNCApp.Table.render();
        CNCApp.Canvas.resetView();
      }
      if (CNCApp.SvgGenerator) CNCApp.SvgGenerator.currentSvgString = null;
    } else if (mode === 'PROJECT_CSV') {
      var resProj = CNCApp.Parser.parseProjectCsv(txt);
      var shouldClearSvg = !resProj.svg;
      if (CNCApp.Tabs) {
        CNCApp.Tabs.resetActiveTabForLoadedData({
          clearSvg: shouldClearSvg,
          points: resProj.points,
          header: resProj.header,
          footer: resProj.footer,
          projectName: fileName
        });
      } else {
        CNCApp.State.points = resProj.points;
        CNCApp.State.header = resProj.header;
        CNCApp.State.footer = resProj.footer;
        CNCApp.State.setProjectName(fileName);
        CNCApp.State.snapshot();
        CNCApp.State.markDirty(false);
        CNCApp.Table.render();
        CNCApp.Canvas.resetView();
      }

      if (resProj.svg) {
        var decodedSvg = decodeBase64Utf8(resProj.svg);
        CNCApp.Parser.loadSvgContent(decodedSvg);
        if (CNCApp.SvgGenerator) CNCApp.SvgGenerator.currentSvgString = decodedSvg;
      } else if (CNCApp.SvgGenerator) {
        CNCApp.SvgGenerator.currentSvgString = null;
      }
      populateDispenserSelectors();

      // Зачувај ги постоечките офсети на машината и прашај преку дијалог само ако фајлот има поинакви
      if (resProj.fileDispensers && dispensersDiffer(CNCApp.State.machine.dispensers, resProj.fileDispensers)) {
        openCsvOffsetsModal(fileName, resProj.fileDispensers);
      }
    }
  }

  document.getElementById('btnOpenTxt').onclick = () => {
    if (!canModifyActiveTabForFileLoad()) return;
    currentFileMode = 'TXT';
    fileInp.accept = '.txt,text/plain';
    fileInp.click();
  };
  document.getElementById('btnOpenLegacyCsv').onclick = () => {
    if (!canModifyActiveTabForFileLoad()) return;
    currentFileMode = 'LEGACY_CSV';
    fileInp.accept = '.csv,.txt,text/csv';
    fileInp.click();
  };
  document.getElementById('btnOpenProjectCsv').onclick = () => {
    if (!canModifyActiveTabForFileLoad()) return;
    currentFileMode = 'PROJECT_CSV';
    fileInp.accept = '.csv,.txt,text/csv';
    fileInp.click();
  };
  document.getElementById('btnLoadSvg').onclick = () => {
    if (!canModifyActiveTabForFileLoad()) return;
    currentFileMode = 'SVG';
    fileInp.accept = '.svg,image/svg+xml';
    fileInp.click();
  };

  fileInp.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    var modeForLoad = currentFileMode;
    const reader = new FileReader();

    if (modeForLoad === 'SVG') {
      reader.onload = (evt) => {
        const svgContent = evt.target.result;
        CNCApp.Parser.loadSvgContent(svgContent);
        CNCApp.State.markDirty(true);
        if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
        if (CNCApp.SvgGenerator) {
          CNCApp.SvgGenerator.currentSvgString = svgContent;
          setTimeout(() => {
            if (confirm("Вчитан е SVG фајл! Дали сакате да го отворите волшебникот за автоматско генерирање на CNC патека со точки за диспензерите?")) {
              CNCApp.SvgGenerator.openModal(svgContent);
            }
          }, 150);
        }
      };
      reader.readAsText(file);
    } else {
      reader.onload = (evt) => {
        const txt = evt.target.result;
        if (CNCApp.State.isDirty) {
          openUnsavedModal(
            "Отворање нова датотека",
            "Тековниот проект <strong>\"" + escapeHtml(CNCApp.State.projectName) + "\"</strong> содржи незачувани измени.<br>Дали сакате да ги зачувате пред да ја вчитате <strong>\"" + escapeHtml(file.name) + "\"</strong> во овој таб?",
            function() {
              applyLoadedFileToCurrentTab(modeForLoad, file.name, txt);
            }
          );
        } else {
          applyLoadedFileToCurrentTab(modeForLoad, file.name, txt);
        }
      };
      reader.readAsText(file);
    }
    fileInp.value = '';
  };

  document.getElementById('btnSaveProjectCsv').onclick = () => {
    saveCurrentProject();
  };

  const projectBadge = document.getElementById('projectInfoBadge');
  if (projectBadge) {
    projectBadge.onclick = () => {
      if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) {
        alert('🔒 Не може да се преименува проектот додека активно работи на машината.');
        return;
      }
      const cur = CNCApp.State.projectName || 'Нов проект.csv';
      const entered = prompt('Внесете ново име за проектот:', cur);
      if (entered && entered.trim()) {
        CNCApp.State.setProjectName(entered.trim());
        CNCApp.State.markDirty(true);
        if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
      }
    };
  }

  window.addEventListener('beforeunload', (e) => {
    var hasDirty = CNCApp.Tabs ? CNCApp.Tabs.hasAnyUnsavedChanges() : CNCApp.State.isDirty;
    var machineBusy = CNCApp.Machine && typeof CNCApp.Machine.isBusy === 'function' && CNCApp.Machine.isBusy();
    if (hasDirty || machineBusy) {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });

  const btnExportAi = document.getElementById('btnExportForAi');
  if (btnExportAi) {
    btnExportAi.onclick = () => {
      const csvContent = CNCApp.Parser.exportProjectCsv();
      const numPts = CNCApp.State.points.length;
      const hasSvg = !!CNCApp.State.svgData;

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(csvContent).then(() => {
          alert(`✅ ИСКОПИРАНО ВО CLIPBOARD!\n\n` +
                `• Вкупно работни точки: ${numPts}\n` +
                `• SVG содржина: ${hasSvg ? 'ВКЛУЧЕНА во податоците' : 'Нема SVG'}\n\n` +
                `Сега само кликнете во полето за порака во разговорот со AI и притиснете Ctrl+V (Paste)!`);
        }).catch(() => {
          prompt("Ископирајте го кодот со Ctrl+A и Ctrl+C, па пастирајте го во чатот со AI:", csvContent);
        });
      } else {
        prompt("Ископирајте го кодот со Ctrl+A и Ctrl+C, па пастирајте го во чатот со AI:", csvContent);
      }
    };
  }

  let currentGeneratedGcode = '';

  function openGcodePreview() {
    if (CNCApp.Machine && typeof CNCApp.Machine.checkActivePointsBounds === 'function') {
      var violations = CNCApp.Machine.checkActivePointsBounds();
      if (violations.length > 0) {
        var firstV = violations[0];
        var proceedExport = confirm(
          '⚠️ ПРЕДУПРЕДУВАЊЕ (Работни лимити):\n\n' +
          violations.length + ' активна/и точка/и со пресметан офсет ги надминуваат границите на машината!\n' +
          'Пример: Точка #' + firstV.rowNum + ' (' + firstV.dispenserName + ') -> X=' + firstV.machX.toFixed(2) + ', Y=' + firstV.machY.toFixed(2) + '\n' +
          firstV.message + '\n\nДали сепак сакате да го прегледате G-кодот (.tap)?'
        );
        if (!proceedExport) return;
      }
    }

    currentGeneratedGcode = CNCApp.GCode.generate();
    var linesArr = currentGeneratedGcode.split('\n');
    var linesCount = linesArr.length;

    var previewModal = document.getElementById('gcodePreviewModal');
    var previewText = document.getElementById('gcodePreviewText');
    var statLines = document.getElementById('gcodeStatLines');
    var statTime = document.getElementById('gcodeStatTime');
    var statDist = document.getElementById('gcodeStatDist');
    var statMode = document.getElementById('gcodeStatMode');
    var subTitle = document.getElementById('gcodePreviewSubTitle');

    if (previewText) previewText.value = currentGeneratedGcode;
    if (statLines) statLines.innerText = linesCount;

    var timeText = document.getElementById('cycleTimeDisplay') ? document.getElementById('cycleTimeDisplay').innerText.replace('Време: ', '') : '~0с';
    var distText = document.getElementById('cycleSubDisplay') ? document.getElementById('cycleSubDisplay').innerText.replace('Патека: ', '') : '0m';
    if (statTime) statTime.innerText = timeText;
    if (statDist) statDist.innerText = distText;

    var m = CNCApp.State.machine || {};
    var isM11 = (m.valveOpenCmd && /\bM1[01]\b/i.test(m.valveOpenCmd));
    if (statMode) {
      if (isM11) {
        statMode.innerText = 'Режим: Унифициран M10/M11 (' + (m.valveOpenCmd || 'M11 P3') + '/' + (m.valveCloseCmd || 'M10 P3') + ' + 0.001mm микро-чекор)';
        statMode.style.background = '#dbeafe';
        statMode.style.color = '#1e40af';
        statMode.style.borderColor = '#93c5fd';
      } else {
        statMode.innerText = 'Режим: Унифициран (' + (m.valveOpenCmd || 'M103') + '/' + (m.valveCloseCmd || 'M203') + ' + 0.001mm микро-чекор)';
        statMode.style.background = '#fef3c7';
        statMode.style.color = '#92400e';
        statMode.style.borderColor = '#f59e0b';
      }
    }

    var projName = CNCApp.State.projectName || 'Нов проект.csv';
    var tapName = projName.replace(/\.csv$/i, '') + '.tap';
    if (subTitle) subTitle.innerText = 'Генериран код за: ' + tapName;

    if (previewModal) previewModal.style.display = 'flex';
  }

  document.getElementById('btnExportGcode').onclick = openGcodePreview;

  const btnCloseGcodePreview = document.getElementById('btnCloseGcodePreview');
  const btnCancelGcodePreview = document.getElementById('btnCancelGcodePreview');
  const gcodePreviewModal = document.getElementById('gcodePreviewModal');
  if (btnCloseGcodePreview) btnCloseGcodePreview.onclick = () => { if (gcodePreviewModal) gcodePreviewModal.style.display = 'none'; };
  if (btnCancelGcodePreview) btnCancelGcodePreview.onclick = () => { if (gcodePreviewModal) gcodePreviewModal.style.display = 'none'; };

  const btnCopyGcodePreview = document.getElementById('btnCopyGcodePreview');
  if (btnCopyGcodePreview) {
    btnCopyGcodePreview.onclick = () => {
      if (!currentGeneratedGcode) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(currentGeneratedGcode).then(() => {
          var origText = btnCopyGcodePreview.innerText;
          btnCopyGcodePreview.innerText = '✔ Ископирано!';
          setTimeout(() => { btnCopyGcodePreview.innerText = origText; }, 1500);
        }).catch(() => {
          var t = document.getElementById('gcodePreviewText');
          if (t) { t.select(); document.execCommand('copy'); }
        });
      } else {
        var t = document.getElementById('gcodePreviewText');
        if (t) { t.select(); document.execCommand('copy'); }
      }
    };
  }

  const btnSaveGcodeFromPreview = document.getElementById('btnSaveGcodeFromPreview');
  if (btnSaveGcodeFromPreview) {
    btnSaveGcodeFromPreview.onclick = () => {
      if (!currentGeneratedGcode) currentGeneratedGcode = CNCApp.GCode.generate();
      var projName = CNCApp.State.projectName || 'dispenser_program.csv';
      var defaultTapName = projName.replace(/\.csv$/i, '') + '.tap';
      if (!defaultTapName.toLowerCase().endsWith('.tap')) defaultTapName += '.tap';
      saveWithPicker(currentGeneratedGcode, defaultTapName, 'text/plain', { updateProjectName: false });
    };
  }

  const btnRunFromGcodePreview = document.getElementById('btnRunFromGcodePreview');
  if (btnRunFromGcodePreview) {
    btnRunFromGcodePreview.onclick = () => {
      if (gcodePreviewModal) gcodePreviewModal.style.display = 'none';
      if (CNCApp.Machine && typeof CNCApp.Machine.startActiveTabJob === 'function') {
        CNCApp.Machine.startActiveTabJob();
      }
    };
  }

  function detectM10M11ModeInSettings() {
    const vOpen = (document.getElementById('modalValveOpenCmd').value || '').trim();
    if (/\bM1[01]\s+P\d+/i.test(vOpen)) return true;
    for (let i = 0; i < draftDispensers.length; i++) {
      if (draftDispensers[i] && /\bM1[01]\s+P\d+/i.test(draftDispensers[i].lowerCmd || '')) {
        return true;
      }
    }
    return false;
  }

  document.getElementById('btnAddDispenser').onclick = () => {
    syncDraftDispensersFromTable();
    let maxId = 0;
    let maxPin = 3;
    for (let i = 0; i < draftDispensers.length; i++) {
      const d = draftDispensers[i];
      if (!d) continue;
      if (d.id > maxId) maxId = d.id;
      const pMatch = String(d.lowerCmd || '').match(/\bP(\d+)\b/i);
      if (pMatch) {
        const pinNum = parseInt(pMatch[1], 10);
        if (!isNaN(pinNum) && pinNum > maxPin) maxPin = pinNum;
      }
    }
    const nextId = draftDispensers.length > 0 ? maxId + 1 : 1;
    const lastDisp = draftDispensers[draftDispensers.length - 1] || { offsetX: -40.3, offsetY: 34.45 };
    const palette = ["#2563eb", "#059669", "#dc2626", "#d97706", "#7c3aed", "#ec4899", "#06b6d4", "#84cc16"];
    const nextColor = palette[(nextId - 1) % palette.length];

    const usePinMode = detectM10M11ModeInSettings();
    let newLower, newRaise;
    if (usePinMode) {
      const nextPin = Math.max(maxPin + 1, 3 + nextId);
      newLower = "M11 P" + nextPin;
      newRaise = "M10 P" + nextPin;
    } else {
      newLower = "M" + (103 + nextId);
      newRaise = "M" + (203 + nextId);
    }

    draftDispensers.push({
      id: nextId,
      name: "Боја " + nextId,
      color: nextColor,
      lowerCmd: newLower,
      raiseCmd: newRaise,
      offsetX: parseFloat((lastDisp.offsetX + 40.0).toFixed(3)),
      offsetY: lastDisp.offsetY
    });
    renderSettingsDispensers();
  };

  const modal = document.getElementById('settingsModal');
  document.getElementById('btnOpenSettings').onclick = () => {
    if (CNCApp.Machine && typeof CNCApp.Machine.isBusy === 'function' && CNCApp.Machine.isBusy()) {
      alert('⛔ Не смеат да се менуваат глобалните поставки на машината (офсети, M-команди) додека машината активно работи!');
      return;
    }
    if (CNCApp.Calibration && CNCApp.Calibration.active) {
      alert('⚠️ Прво затворете го прозорецот за калибрација пред да ги отворите Поставките.');
      return;
    }
    if (CNCApp.State.migrateLegacyDispensers) {
      CNCApp.State.machine.dispensers = CNCApp.State.migrateLegacyDispensers(CNCApp.State.machine.dispensers, false);
    }
    if (!CNCApp.State.footer || CNCApp.State.footer === 'G28.1 X2 Y2;M5;M30' || !CNCApp.State.footer.includes('G1 X1 Y1 F2000')) {
      CNCApp.State.footer = "G28.1 X2 Y2\r\nG1 X1 Y1 F2000\r\nM5\r\nM30";
    }
    if (typeof CNCApp.State.normalizeMachineConfig === 'function') {
      CNCApp.State.normalizeMachineConfig();
    }

    draftDispensers = JSON.parse(JSON.stringify(CNCApp.State.machine.dispensers || []));

    document.getElementById('modalHeaderCode').value = CNCApp.State.header;
    document.getElementById('modalFooterCode').value = CNCApp.State.footer;
    document.getElementById('modalValveOpenCmd').value = CNCApp.State.machine.valveOpenCmd || 'M11 P3';
    document.getElementById('modalValveCloseCmd').value = CNCApp.State.machine.valveCloseCmd || 'M10 P3';
    document.getElementById('modalHomeCmd').value = CNCApp.State.machine.homeCommand || 'G28.1 X2 Y2';
    document.getElementById('modalParkCmd').value = CNCApp.State.machine.parkCommand || 'G1 X1 Y1 F2000';
    document.getElementById('modalTimeUnit').value = CNCApp.State.machine.timeUnit || 'ms';
    document.getElementById('modalDecimalSeparator').value = CNCApp.State.machine.decimalSeparator || '.';
    document.getElementById('modalMLatency').value = CNCApp.State.machine.mCommandLatency || 120;
    document.getElementById('modalDelayLower').value = CNCApp.State.machine.systemDelayLower;
    document.getElementById('modalDelayRaise').value = CNCApp.State.machine.systemDelayRaise;
    document.getElementById('modalStepIncrement').value = CNCApp.State.stepIncrement || 0.05;
    document.getElementById('modalMinX').value = CNCApp.State.machine.minX;
    document.getElementById('modalMaxX').value = CNCApp.State.machine.maxX;
    document.getElementById('modalMinY').value = CNCApp.State.machine.minY;
    document.getElementById('modalMaxY').value = CNCApp.State.machine.maxY;
    document.getElementById('modalMoveClickSpeed').value = CNCApp.State.machine.moveClickSpeed;

    renderSettingsDispensers();
    modal.style.display = 'flex';
  };

  const btnPresetM10M11 = document.getElementById('btnPresetM10M11');
  if (btnPresetM10M11) {
    btnPresetM10M11.onclick = () => {
      syncDraftDispensersFromTable();
      document.getElementById('modalValveOpenCmd').value = 'M11 P3';
      document.getElementById('modalValveCloseCmd').value = 'M10 P3';
      for (let i = 0; i < draftDispensers.length; i++) {
        draftDispensers[i].lowerCmd = 'M11 P' + (i + 4);
        draftDispensers[i].raiseCmd = 'M10 P' + (i + 4);
      }
      renderSettingsDispensers();
    };
  }

  const btnPresetMacros = document.getElementById('btnPresetMacros');
  if (btnPresetMacros) {
    btnPresetMacros.onclick = () => {
      syncDraftDispensersFromTable();
      document.getElementById('modalValveOpenCmd').value = 'M103';
      document.getElementById('modalValveCloseCmd').value = 'M203';
      for (let i = 0; i < draftDispensers.length; i++) {
        const dId = draftDispensers[i].id || (i + 1);
        draftDispensers[i].lowerCmd = 'M' + (103 + dId);
        draftDispensers[i].raiseCmd = 'M' + (203 + dId);
      }
      renderSettingsDispensers();
    };
  }

  const btnResetCal = document.getElementById('btnResetCalibratedDispensers');
  if (btnResetCal) {
    btnResetCal.onclick = () => {
      CNCApp.State.loadDefaultMachineProfile((err, defMachine) => {
        const mCfg = defMachine ? JSON.parse(JSON.stringify(defMachine)) : CNCApp.State.getDefaultMachineConfig();
        draftDispensers = JSON.parse(JSON.stringify(mCfg.dispensers || []));
        document.getElementById('modalFooterCode').value = "G28.1 X2 Y2\r\nG1 X1 Y1 F2000\r\nM5\r\nM30";
        document.getElementById('modalValveOpenCmd').value = mCfg.valveOpenCmd || 'M11 P3';
        document.getElementById('modalValveCloseCmd').value = mCfg.valveCloseCmd || 'M10 P3';
        document.getElementById('modalHomeCmd').value = mCfg.homeCommand || 'G28.1 X2 Y2';
        document.getElementById('modalParkCmd').value = mCfg.parkCommand || 'G1 X1 Y1 F2000';
        document.getElementById('modalTimeUnit').value = mCfg.timeUnit || 'ms';
        document.getElementById('modalDecimalSeparator').value = mCfg.decimalSeparator || '.';
        document.getElementById('modalMLatency').value = mCfg.mCommandLatency || 120;
        document.getElementById('modalDelayLower').value = mCfg.systemDelayLower || 150;
        document.getElementById('modalDelayRaise').value = mCfg.systemDelayRaise || 150;
        document.getElementById('modalMinX').value = (typeof mCfg.minX === 'number') ? mCfg.minX : -5;
        document.getElementById('modalMaxX').value = (typeof mCfg.maxX === 'number') ? mCfg.maxX : 350;
        document.getElementById('modalMinY').value = (typeof mCfg.minY === 'number') ? mCfg.minY : -5;
        document.getElementById('modalMaxY').value = (typeof mCfg.maxY === 'number') ? mCfg.maxY : 300;
        document.getElementById('modalMoveClickSpeed').value = mCfg.moveClickSpeed || 3000;
        renderSettingsDispensers();
        alert('⚡ Фабричките поставки се вчитани во прозорецот! Кликнете „Зачувај и Затвори“ за да ги потврдите.');
      });
    };
  }

  document.getElementById('btnCloseSettings').onclick = () => {
    draftDispensers = [];
    modal.style.display = 'none';
  };

  document.getElementById('btnSaveSettings').onclick = () => {
    const pMinX = parseFloat(document.getElementById('modalMinX').value);
    const pMaxX = parseFloat(document.getElementById('modalMaxX').value);
    const pMinY = parseFloat(document.getElementById('modalMinY').value);
    const pMaxY = parseFloat(document.getElementById('modalMaxY').value);
    const pMoveF = parseFloat(document.getElementById('modalMoveClickSpeed').value);

    if (!isNaN(pMinX) && !isNaN(pMaxX) && pMaxX <= pMinX) {
      alert('⚠️ Максималната X граница (Макс X) мора да биде поголема од Мин X!');
      return;
    }
    if (!isNaN(pMinY) && !isNaN(pMaxY) && pMaxY <= pMinY) {
      alert('⚠️ Максималната Y граница (Макс Y) мора да биде поголема од Мин Y!');
      return;
    }
    if (!isNaN(pMoveF) && pMoveF <= 0) {
      alert('⚠️ Брзината за „Оди на клик“ (F) мора да биде поголема од 0!');
      return;
    }

    syncDraftDispensersFromTable();
    if (!Array.isArray(draftDispensers) || draftDispensers.length === 0) {
      alert('⚠️ Мора да има барем 1 диспензер!');
      return;
    }

    CNCApp.State.header = document.getElementById('modalHeaderCode').value;
    CNCApp.State.footer = document.getElementById('modalFooterCode').value;
    CNCApp.State.machine.valveOpenCmd = document.getElementById('modalValveOpenCmd').value.trim() || 'M11 P3';
    CNCApp.State.machine.valveCloseCmd = document.getElementById('modalValveCloseCmd').value.trim() || 'M10 P3';
    CNCApp.State.machine.homeCommand = document.getElementById('modalHomeCmd').value.trim() || 'G28.1 X2 Y2';
    CNCApp.State.machine.parkCommand = document.getElementById('modalParkCmd').value.trim() || 'G1 X1 Y1 F2000';
    CNCApp.State.machine.timeUnit = document.getElementById('modalTimeUnit').value;
    CNCApp.State.machine.decimalSeparator = document.getElementById('modalDecimalSeparator').value;
    CNCApp.State.machine.mCommandLatency = parseInt(document.getElementById('modalMLatency').value) || 120;
    CNCApp.State.machine.systemDelayLower = parseInt(document.getElementById('modalDelayLower').value) || 150;
    CNCApp.State.machine.systemDelayRaise = parseInt(document.getElementById('modalDelayRaise').value) || 150;
    CNCApp.State.stepIncrement = parseFloat(document.getElementById('modalStepIncrement').value) || 0.05;
    CNCApp.State.machine.minX = isNaN(pMinX) ? -5 : pMinX;
    CNCApp.State.machine.maxX = isNaN(pMaxX) ? 350 : pMaxX;
    CNCApp.State.machine.minY = isNaN(pMinY) ? -5 : pMinY;
    CNCApp.State.machine.maxY = isNaN(pMaxY) ? 300 : pMaxY;
    CNCApp.State.machine.moveClickSpeed = isNaN(pMoveF) ? 3000 : Math.round(pMoveF);

    CNCApp.State.machine.dispensers = JSON.parse(JSON.stringify(draftDispensers));
    if (typeof CNCApp.State.normalizeMachineConfig === 'function') {
      CNCApp.State.normalizeMachineConfig();
    }

    refreshToolbarStates();
    CNCApp.Table.render();
    CNCApp.Canvas.render();
    CNCApp.Storage.saveAutoSave(true);
    if (CNCApp.Machine && CNCApp.Machine.activeDriverId === 'mach3' && CNCApp.Mach3BridgeDriver && CNCApp.Mach3BridgeDriver.connected) {
      CNCApp.Mach3BridgeDriver.syncConfig();
    }
    if (CNCApp.Machine && typeof CNCApp.Machine.refreshUI === 'function') {
      CNCApp.Machine.refreshUI();
    }
    draftDispensers = [];
    modal.style.display = 'none';
  };

  document.getElementById('btnExportMachineProfile').onclick = () => {
    syncDraftDispensersFromTable();
    const previewMachine = JSON.parse(JSON.stringify(CNCApp.State.machine));
    previewMachine.dispensers = draftDispensers;
    const prof = JSON.stringify(previewMachine, null, 2);
    saveWithPicker(prof, 'machine_profile.json', 'application/json', { updateProjectName: false });
  };

  const profInp = document.getElementById('machineProfileInput');
  document.getElementById('btnImportMachineProfile').onclick = () => profInp.click();
  profInp.onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (evt) => {
      try {
        const parsedProfile = JSON.parse(evt.target.result);
        if (!parsedProfile || typeof parsedProfile !== 'object' || !Array.isArray(parsedProfile.dispensers) || parsedProfile.dispensers.length === 0) {
          alert('Невалиден профил! Датотеката мора да содржи валидна листа со барем 1 диспензер.');
          return;
        }
        draftDispensers = JSON.parse(JSON.stringify(parsedProfile.dispensers));
        if (parsedProfile.valveOpenCmd) document.getElementById('modalValveOpenCmd').value = parsedProfile.valveOpenCmd;
        if (parsedProfile.valveCloseCmd) document.getElementById('modalValveCloseCmd').value = parsedProfile.valveCloseCmd;
        if (parsedProfile.homeCommand) document.getElementById('modalHomeCmd').value = parsedProfile.homeCommand;
        if (parsedProfile.parkCommand) document.getElementById('modalParkCmd').value = parsedProfile.parkCommand;
        if (parsedProfile.timeUnit) document.getElementById('modalTimeUnit').value = parsedProfile.timeUnit;
        if (parsedProfile.decimalSeparator) document.getElementById('modalDecimalSeparator').value = parsedProfile.decimalSeparator;
        if (parsedProfile.mCommandLatency) document.getElementById('modalMLatency').value = parsedProfile.mCommandLatency;
        if (parsedProfile.systemDelayLower) document.getElementById('modalDelayLower').value = parsedProfile.systemDelayLower;
        if (parsedProfile.systemDelayRaise) document.getElementById('modalDelayRaise').value = parsedProfile.systemDelayRaise;
        if (typeof parsedProfile.minX === 'number') document.getElementById('modalMinX').value = parsedProfile.minX;
        if (typeof parsedProfile.maxX === 'number') document.getElementById('modalMaxX').value = parsedProfile.maxX;
        if (typeof parsedProfile.minY === 'number') document.getElementById('modalMinY').value = parsedProfile.minY;
        if (typeof parsedProfile.maxY === 'number') document.getElementById('modalMaxY').value = parsedProfile.maxY;
        if (typeof parsedProfile.moveClickSpeed === 'number') document.getElementById('modalMoveClickSpeed').value = parsedProfile.moveClickSpeed;
        renderSettingsDispensers();
        alert('📂 Профилот е вчитан во прозорецот. Кликнете „Зачувај и Затвори“ за да го примените.');
      } catch (err) { alert('Невалиден профил!'); }
    };
    r.readAsText(f);
    profInp.value = '';
  };

  // --- НАСТАНИ ЗА АВТОМАТСКИ ГЕНЕРАТОР НА SVG ---
  const btnOpenSvgGenTop = document.getElementById('btnOpenSvgGenTop');
  if (btnOpenSvgGenTop) {
    btnOpenSvgGenTop.onclick = () => {
      if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) {
        alert('🔒 SVG генераторот е заклучен додека тековниот таб активно работи на машината. Отворете нов таб (➕ Нов таб) за друг проект.');
        return;
      }
      if (CNCApp.Calibration && CNCApp.Calibration.active) {
        alert('⚠️ Прво затворете ја калибрацијата пред да го отворите SVG генераторот.');
        return;
      }
      if (CNCApp.SvgGenerator) CNCApp.SvgGenerator.openModal();
    };
  }

  const btnCloseSvgGen = document.getElementById('btnCloseSvgGen');
  if (btnCloseSvgGen) {
    btnCloseSvgGen.onclick = () => {
      if (CNCApp.SvgGenerator) CNCApp.SvgGenerator.closeModal();
    };
  }

  const btnCancelSvgGen = document.getElementById('btnCancelSvgGen');
  if (btnCancelSvgGen) {
    btnCancelSvgGen.onclick = () => {
      if (CNCApp.SvgGenerator) CNCApp.SvgGenerator.closeModal();
    };
  }

  const btnSvgGenLoadFile = document.getElementById('btnSvgGenLoadFile');
  const svgGenFileInput = document.getElementById('svgGenFileInput');
  if (btnSvgGenLoadFile && svgGenFileInput) {
    btnSvgGenLoadFile.onclick = () => svgGenFileInput.click();
    svgGenFileInput.onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = (evt) => {
        if (CNCApp.SvgGenerator) {
          CNCApp.SvgGenerator.parseAndAnalyze(evt.target.result);
          CNCApp.SvgGenerator.updateModalUI();
        }
      };
      r.readAsText(f);
      svgGenFileInput.value = '';
    };
  }

  const btnSvgGenUseCurrent = document.getElementById('btnSvgGenUseCurrent');
  if (btnSvgGenUseCurrent) {
    btnSvgGenUseCurrent.onclick = () => {
      if (!CNCApp.State.svgData) {
        alert("⚠️ Во моментов нема вчитано SVG на платното. Вчитајте SVG или изберете еден од готовите тест примероци.");
        return;
      }
      if (CNCApp.SvgGenerator) {
        CNCApp.SvgGenerator.parseAndAnalyze(CNCApp.State.svgData);
        CNCApp.SvgGenerator.updateModalUI();
      }
    };
  }

  const btnSvgSampleChannels = document.getElementById('btnSvgSampleChannels');
  if (btnSvgSampleChannels) {
    btnSvgSampleChannels.onclick = () => {
      if (CNCApp.SvgGenerator) {
        CNCApp.SvgGenerator.parseAndAnalyze(CNCApp.SvgGenerator.sampleSvgs.channelsAndPockets);
        CNCApp.SvgGenerator.updateModalUI();
      }
    };
  }

  const btnSvgSampleStar = document.getElementById('btnSvgSampleStar');
  if (btnSvgSampleStar) {
    btnSvgSampleStar.onclick = () => {
      if (CNCApp.SvgGenerator) {
        CNCApp.SvgGenerator.parseAndAnalyze(CNCApp.SvgGenerator.sampleSvgs.star);
        CNCApp.SvgGenerator.updateModalUI();
      }
    };
  }

  const btnSvgSampleFlower = document.getElementById('btnSvgSampleFlower');
  if (btnSvgSampleFlower) {
    btnSvgSampleFlower.onclick = () => {
      if (CNCApp.SvgGenerator) {
        CNCApp.SvgGenerator.parseAndAnalyze(CNCApp.SvgGenerator.sampleSvgs.flower3Color);
        CNCApp.SvgGenerator.updateModalUI();
      }
    };
  }

  const btnSvgGenPasteCode = document.getElementById('btnSvgGenPasteCode');
  if (btnSvgGenPasteCode) {
    btnSvgGenPasteCode.onclick = () => {
      const pasted = prompt("Пастирајте го вашиот SVG XML код овде (<svg ...> ... </svg>):");
      if (pasted && pasted.includes('<svg')) {
        if (CNCApp.SvgGenerator) {
          CNCApp.SvgGenerator.parseAndAnalyze(pasted);
          CNCApp.SvgGenerator.updateModalUI();
        }
      } else if (pasted) {
        alert("Невалиден SVG код!");
      }
    };
  }

  const btnSvgGenReplace = document.getElementById('btnSvgGenReplace');
  if (btnSvgGenReplace) {
    btnSvgGenReplace.onclick = () => {
      if (CNCApp.SvgGenerator) CNCApp.SvgGenerator.applyToProject(true);
    };
  }

  const btnSvgGenAppend = document.getElementById('btnSvgGenAppend');
  if (btnSvgGenAppend) {
    btnSvgGenAppend.onclick = () => {
      if (CNCApp.SvgGenerator) CNCApp.SvgGenerator.applyToProject(false);
    };
  }
});