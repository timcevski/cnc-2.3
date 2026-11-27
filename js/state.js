window.CNCApp = window.CNCApp || {};

CNCApp.State = {
  points: [],
  selectedIndices: new Set(),
  activePointIndex: null,
  lastSelectedRowIndex: null,
  header: '',
  footer: 'G28.1 X2 Y2\r\nG1 X1 Y1 F2000\r\nM5\r\nM30',
  svgData: null,
  svgImage: null,
  svgObjectUrl: null,
  history: [],
  historyIndex: -1,
  isAddMode: false,
  stepIncrement: 0.05,
  shadedDispensers: new Set(),
  showClearanceRings: true,
  showSvg: true,

  DEFAULT_CALIBRATED_DISPENSERS: [
    { id: 1, name: "Боја 1", color: "#2563eb", lowerCmd: "M11 P4", raiseCmd: "M10 P4", offsetX: -0.30, offsetY: 34.45 },
    { id: 2, name: "Боја 2", color: "#059669", lowerCmd: "M11 P5", raiseCmd: "M10 P5", offsetX: 39.70, offsetY: 34.45 },
    { id: 3, name: "Боја 3", color: "#dc2626", lowerCmd: "M11 P6", raiseCmd: "M10 P6", offsetX: 79.70, offsetY: 34.45 },
    { id: 4, name: "Боја 4", color: "#d97706", lowerCmd: "M11 P7", raiseCmd: "M10 P7", offsetX: 119.70, offsetY: 34.45 },
    { id: 5, name: "Боја 5", color: "#7c3aed", lowerCmd: "M11 P8", raiseCmd: "M10 P8", offsetX: 159.70, offsetY: 34.45 }
  ],

  getDefaultDispensers: function() {
    var src = this.DEFAULT_CALIBRATED_DISPENSERS || [];
    var out = [];
    for (var i = 0; i < src.length; i++) {
      var d = src[i];
      out.push({
        id: d.id,
        name: d.name,
        color: d.color,
        lowerCmd: d.lowerCmd,
        raiseCmd: d.raiseCmd,
        offsetX: d.offsetX,
        offsetY: d.offsetY
      });
    }
    return out;
  },

  isLegacyDispenserOffset: function(d1) {
    return !!(d1 && (d1.offsetX === 0.8 || d1.offsetX === -0.4 || d1.offsetY === 36 || d1.offsetY === 34.55));
  },

  migrateLegacyDispensers: function(dispensers, preserveCustomMeta) {
    if (!Array.isArray(dispensers) || dispensers.length === 0) {
      return this.getDefaultDispensers();
    }
    if (!this.isLegacyDispenserOffset(dispensers[0])) {
      return dispensers;
    }
    if (!preserveCustomMeta) {
      return this.getDefaultDispensers();
    }
    for (var i = 0; i < dispensers.length; i++) {
      if (dispensers[i]) {
        dispensers[i].offsetX = parseFloat((-0.30 + i * 40.0).toFixed(3));
        dispensers[i].offsetY = 34.45;
      }
    }
    return dispensers;
  },

  escapeHtml: function(str) {
    return String(str === undefined || str === null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  machine: {
    name: "Стандардна Машина (5 Диспензери)",
    systemDelayLower: 150,
    systemDelayRaise: 150,
    mCommandLatency: 120,
    valveOpenCmd: "M11 P3",
    valveCloseCmd: "M10 P3",
    homeCommand: "G28.1 X2 Y2",
    parkCommand: "G1 X1 Y1 F2000",
    timeUnit: "ms",
    decimalSeparator: ".",
    minX: -5,
    maxX: 350,
    minY: -5,
    maxY: 300,
    moveClickSpeed: 3000,
    dispensers: [
      { id: 1, name: "Боја 1", color: "#2563eb", lowerCmd: "M11 P4", raiseCmd: "M10 P4", offsetX: -0.30, offsetY: 34.45 },
      { id: 2, name: "Боја 2", color: "#059669", lowerCmd: "M11 P5", raiseCmd: "M10 P5", offsetX: 39.70, offsetY: 34.45 },
      { id: 3, name: "Боја 3", color: "#dc2626", lowerCmd: "M11 P6", raiseCmd: "M10 P6", offsetX: 79.70, offsetY: 34.45 },
      { id: 4, name: "Боја 4", color: "#d97706", lowerCmd: "M11 P7", raiseCmd: "M10 P7", offsetX: 119.70, offsetY: 34.45 },
      { id: 5, name: "Боја 5", color: "#7c3aed", lowerCmd: "M11 P8", raiseCmd: "M10 P8", offsetX: 159.70, offsetY: 34.45 }
    ]
  },

  getDefaultMachineConfig: function() {
    return {
      name: "Стандардна Машина (5 Диспензери)",
      systemDelayLower: 150,
      systemDelayRaise: 150,
      mCommandLatency: 120,
      valveOpenCmd: "M11 P3",
      valveCloseCmd: "M10 P3",
      homeCommand: "G28.1 X2 Y2",
      parkCommand: "G1 X1 Y1 F2000",
      timeUnit: "ms",
      decimalSeparator: ".",
      minX: -5,
      maxX: 350,
      minY: -5,
      maxY: 300,
      moveClickSpeed: 3000,
      dispensers: this.getDefaultDispensers()
    };
  },

  loadDefaultMachineProfile: function(callback) {
    var self = this;
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', 'default_machine.json', true);
      xhr.timeout = 2000;
      xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
          if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) {
            try {
              var parsed = JSON.parse(xhr.responseText);
              if (parsed && Array.isArray(parsed.dispensers) && parsed.dispensers.length > 0) {
                if (typeof callback === 'function') callback(null, parsed);
                return;
              }
            } catch (err) {}
          }
          if (typeof callback === 'function') callback(null, self.getDefaultMachineConfig());
        }
      };
      xhr.ontimeout = function() {
        if (typeof callback === 'function') callback(null, self.getDefaultMachineConfig());
      };
      xhr.onerror = function() {
        if (typeof callback === 'function') callback(null, self.getDefaultMachineConfig());
      };
      xhr.send();
    } catch (e) {
      if (typeof callback === 'function') callback(null, self.getDefaultMachineConfig());
    }
  },

  normalizeMachineConfig: function() {
    var m = this.machine;
    if (!m) return;
    if (!Array.isArray(m.dispensers) || m.dispensers.length === 0) {
      m.dispensers = this.getDefaultDispensers();
    }
    if (!m.valveOpenCmd) m.valveOpenCmd = "M11 P3";
    if (!m.valveCloseCmd) m.valveCloseCmd = "M10 P3";
    if (!m.homeCommand) m.homeCommand = "G28.1 X2 Y2";
    if (!m.parkCommand) m.parkCommand = "G1 X1 Y1 F2000";
    if (typeof m.minX !== 'number' || isNaN(m.minX)) m.minX = -5;
    if (typeof m.maxX !== 'number' || isNaN(m.maxX) || m.maxX <= m.minX) m.maxX = 350;
    if (typeof m.minY !== 'number' || isNaN(m.minY)) m.minY = -5;
    if (typeof m.maxY !== 'number' || isNaN(m.maxY) || m.maxY <= m.minY) m.maxY = 300;
    if (typeof m.moveClickSpeed !== 'number' || isNaN(m.moveClickSpeed) || m.moveClickSpeed <= 0) m.moveClickSpeed = 3000;
  },

  createPoint: function(x, y, refPt) {
    var inheritedDispenser = (refPt && refPt.dispenser) ? refPt.dispenser : 1;
    var inheritedSpeed = (refPt && refPt.speed) ? refPt.speed : 1000;
    var inheritedGroup1 = (refPt && refPt.group1) ? refPt.group1 : '';
    var inheritedGroup2 = (refPt && refPt.group2) ? refPt.group2 : '';

    return {
      active: true,
      x: parseFloat(parseFloat(x || 0).toFixed(3)),
      y: parseFloat(parseFloat(y || 0).toFixed(3)),
      speed: inheritedSpeed,
      lower: true,
      valveStart: true,
      time: '',
      valveStop: true,
      raise: true,
      dispenser: inheritedDispenser,
      group1: inheritedGroup1,
      group2: inheritedGroup2
    };
  },

  projectName: 'Нов проект.csv',
  isDirty: false,

  isActiveTabReadOnly: function() {
    if (CNCApp.Machine && typeof CNCApp.Machine.isActiveTabReadOnly === 'function') {
      return CNCApp.Machine.isActiveTabReadOnly();
    }
    if (CNCApp.Tabs) {
      var tab = CNCApp.Tabs.getActiveTab();
      return !!(tab && tab.isRunningOnMachine);
    }
    return false;
  },

  setProjectName: function(name) {
    if (!name || !name.trim()) name = 'Нов проект.csv';
    name = name.trim();
    if (!name.toLowerCase().endsWith('.csv') && !name.toLowerCase().endsWith('.txt')) {
      name += '.csv';
    }
    this.projectName = name;
    this.updateProjectUI();
    if (CNCApp.Tabs) {
      CNCApp.Tabs.syncFromState();
      CNCApp.Tabs.renderTabBar();
    }
    if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
  },

  markDirty: function(dirty) {
    if (dirty === undefined) dirty = true;
    this.isDirty = !!dirty;
    this.updateProjectUI();
    if (CNCApp.Tabs) {
      CNCApp.Tabs.syncFromState();
      CNCApp.Tabs.renderTabBar();
    }
  },

  updateProjectUI: function() {
    var nameEl = document.getElementById('projectNameDisplay');
    var statusEl = document.getElementById('projectSaveStatus');
    var btnSave = document.getElementById('btnSaveProjectCsv');

    if (nameEl) {
      nameEl.innerText = this.projectName || 'Нов проект.csv';
    }

    if (statusEl) {
      if (this.isDirty) {
        statusEl.className = 'proj-status unsaved';
        statusEl.innerHTML = '● Незачувано';
        statusEl.title = 'Имате незачувани измени на дискот/USB!';
      } else {
        statusEl.className = 'proj-status saved';
        statusEl.innerHTML = '✔ Зачувано';
        statusEl.title = 'Сите измени се зачувани во датотеката.';
      }
    }

    if (btnSave) {
      if (this.isDirty) {
        btnSave.classList.add('btn-save-dirty');
        btnSave.title = 'Сними ги незачуваните измени во датотеката (Ctrl+S)';
      } else {
        btnSave.classList.remove('btn-save-dirty');
        btnSave.title = 'Сними Проект (.csv)';
      }
    }
  },

  snapshot: function() {
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }
    this.history.push(JSON.stringify(this.points));
    if (this.history.length > 50) this.history.shift();
    this.historyIndex = this.history.length - 1;
    this.markDirty(true);
    if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
  },

  undo: function() {
    if (this.isActiveTabReadOnly()) return;
    if (CNCApp.Calibration && CNCApp.Calibration.active) {
      alert('⚠️ Прво затворете ја калибрацијата (Сними или Затвори) пред да користите Undo.');
      return;
    }
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.points = JSON.parse(this.history[this.historyIndex]);
      this.markDirty(true);
      if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
      CNCApp.Table.render();
      CNCApp.Canvas.render();
    }
  },

  redo: function() {
    if (this.isActiveTabReadOnly()) return;
    if (CNCApp.Calibration && CNCApp.Calibration.active) {
      alert('⚠️ Прво затворете ја калибрацијата (Сними или Затвори) пред да користите Redo.');
      return;
    }
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.points = JSON.parse(this.history[this.historyIndex]);
      this.markDirty(true);
      if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
      CNCApp.Table.render();
      CNCApp.Canvas.render();
    }
  }
};