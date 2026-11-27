window.CNCApp = window.CNCApp || {};

CNCApp.SimulatorDriver = {
  id: 'simulator',
  label: '🧪 Симулатор (Тест)',
  connected: false,
  status: 'DISCONNECTED', // DISCONNECTED | IDLE | RUNNING | HOLD | ESTOP
  speedMultiplier: 1,
  lastError: null,
  coords: {
    x: 0,
    y: 0,
    feedrate: 0,
    lineNum: 0,
    totalLines: 0,
    activeDispenserId: 1,
    loweredDispensers: [],
    valveOpen: false
  },

  _timer: null,
  _pulseTimer: null,
  _steps: [],
  _loadedSteps: [],
  _loadedTotalLines: 0,
  _loadedHash: '',
  _stepIndex: 0,
  _stepElapsedMs: 0,
  _stepDurationMs: 0,
  _segStartX: 0,
  _segStartY: 0,
  _segTargetX: 0,
  _segTargetY: 0,
  _lastTickMs: 0,

  setSpeedMultiplier: function(mult) {
    var m = parseInt(mult, 10);
    if (m === 1 || m === 5 || m === 15) {
      this.speedMultiplier = m;
    }
  },

  _addLowered: function(dispId) {
    var id = parseInt(dispId, 10);
    if (!id) return;
    if (!Array.isArray(this.coords.loweredDispensers)) {
      this.coords.loweredDispensers = [];
    }
    if (this.coords.loweredDispensers.indexOf(id) === -1) {
      this.coords.loweredDispensers.push(id);
      this.coords.loweredDispensers.sort(function(a, b) { return a - b; });
    }
    this.coords.activeDispenserId = id;
  },

  _removeLowered: function(dispId) {
    var id = parseInt(dispId, 10);
    if (!id || !Array.isArray(this.coords.loweredDispensers)) return;
    var out = [];
    for (var i = 0; i < this.coords.loweredDispensers.length; i++) {
      if (this.coords.loweredDispensers[i] !== id) {
        out.push(this.coords.loweredDispensers[i]);
      }
    }
    this.coords.loweredDispensers = out;
  },

  _clearLowered: function() {
    this.coords.loweredDispensers = [];
  },

  _hasLowered: function() {
    return Array.isArray(this.coords.loweredDispensers) && this.coords.loweredDispensers.length > 0;
  },

  _getLimits: function() {
    var m = (CNCApp.State && CNCApp.State.machine) ? CNCApp.State.machine : {};
    return {
      minX: (typeof m.minX === 'number' && !isNaN(m.minX)) ? m.minX : -5,
      maxX: (typeof m.maxX === 'number' && !isNaN(m.maxX)) ? m.maxX : 350,
      minY: (typeof m.minY === 'number' && !isNaN(m.minY)) ? m.minY : -5,
      maxY: (typeof m.maxY === 'number' && !isNaN(m.maxY)) ? m.maxY : 300
    };
  },

  _validateBounds: function(x, y) {
    var lim = this._getLimits();
    if (x < lim.minX || x > lim.maxX) {
      return 'Координатата X=' + x.toFixed(3) + 'mm е надвор од лимитите на машината [' + lim.minX + ' .. ' + lim.maxX + ' mm].';
    }
    if (y < lim.minY || y > lim.maxY) {
      return 'Координатата Y=' + y.toFixed(3) + 'mm е надвор од лимитите на машината [' + lim.minY + ' .. ' + lim.maxY + ' mm].';
    }
    return null;
  },

  _copyCoords: function() {
    return {
      x: parseFloat((this.coords.x || 0).toFixed(3)),
      y: parseFloat((this.coords.y || 0).toFixed(3)),
      feedrate: Math.round(this.coords.feedrate || 0),
      lineNum: this.coords.lineNum || 0,
      totalLines: this.coords.totalLines || 0,
      activeDispenserId: this.coords.activeDispenserId || 1,
      loweredDispensers: Array.isArray(this.coords.loweredDispensers) ? this.coords.loweredDispensers.slice() : [],
      valveOpen: !!this.coords.valveOpen
    };
  },

  connect: function(cb) {
    this.connected = true;
    this.lastError = null;
    if (this.status === 'DISCONNECTED') {
      this.status = 'IDLE';
    }
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  disconnect: function(cb) {
    this._stopLoop();
    if (this._pulseTimer) {
      clearTimeout(this._pulseTimer);
      this._pulseTimer = null;
    }
    this.connected = false;
    this.status = 'DISCONNECTED';
    this.coords.feedrate = 0;
    this.coords.valveOpen = false;
    this._clearLowered();
    this._steps = [];
    this._loadedSteps = [];
    this._loadedTotalLines = 0;
    this._loadedHash = '';
    this._stepIndex = 0;
    this.lastError = null;
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  getSnapshot: function() {
    return {
      driverId: this.id,
      connected: this.connected,
      status: this.status,
      coords: this._copyCoords(),
      lastError: this.lastError
    };
  },

  getStatus: function(cb) {
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  _buildStepsFromGcode: function(gcodeText, meta) {
    var lines = String(gcodeText || '').split(/\r?\n/);
    var m = (meta && meta.machine) ? meta.machine : CNCApp.State.machine;
    var timeUnit = (m && m.timeUnit) ? m.timeUnit : 'ms';
    var mLatencyMs = (m && m.mCommandLatency) ? parseInt(m.mCommandLatency, 10) : 120;
    var valveOpenCmd = (m && m.valveOpenCmd) ? String(m.valveOpenCmd).toUpperCase().trim() : 'M11 P3';
    var valveCloseCmd = (m && m.valveCloseCmd) ? String(m.valveCloseCmd).toUpperCase().trim() : 'M10 P3';
    var dispensers = (m && Array.isArray(m.dispensers)) ? m.dispensers : [];

    var curFeed = 1000;
    var isRelative = false;
    var steps = [];

    function matchesCmdPrefix(lineUpper, cmdUpper) {
      if (!cmdUpper) return false;
      return (lineUpper === cmdUpper || lineUpper.indexOf(cmdUpper + ' ') === 0);
    }

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i].trim();
      if (!raw) continue;
      var codeOnly = raw.split(';')[0].trim();
      if (!codeOnly) continue;
      var upper = codeOnly.toUpperCase();

      if (/\bG91\b/.test(upper)) isRelative = true;
      if (/\bG90\b/.test(upper)) isRelative = false;

      if (/\bG28\.1\b/.test(upper)) {
        var hxMatch = upper.match(/X\s*([+-]?\d+(?:[.,]\d+)?)/);
        var hyMatch = upper.match(/Y\s*([+-]?\d+(?:[.,]\d+)?)/);
        var approachX = hxMatch ? parseFloat(hxMatch[1].replace(',', '.')) : 2;
        var approachY = hyMatch ? parseFloat(hyMatch[1].replace(',', '.')) : 2;
        steps.push({
          type: 'MOVE',
          lineNum: i + 1,
          x: approachX,
          y: approachY,
          feedrate: 3000,
          relative: false,
          raw: raw
        });
        steps.push({
          type: 'MOVE',
          lineNum: i + 1,
          x: 0,
          y: 0,
          feedrate: 400,
          relative: false,
          resetZeroAfter: true,
          raw: raw
        });
        continue;
      }

      if (/\bG4\b/.test(upper)) {
        var mp = upper.match(/P\s*(\d+(?:[.,]\d+)?)/);
        var pVal = mp ? parseFloat(mp[1].replace(',', '.')) : 0;
        var dwellMs = (timeUnit === 's') ? (pVal * 1000) : pVal;
        if (isNaN(dwellMs) || dwellMs < 20) dwellMs = 20;
        steps.push({
          type: 'DWELL',
          lineNum: i + 1,
          durationMs: dwellMs,
          raw: raw
        });
        continue;
      }

      if (matchesCmdPrefix(upper, valveOpenCmd)) {
        steps.push({
          type: 'CMD',
          lineNum: i + 1,
          durationMs: mLatencyMs,
          action: 'VALVE_OPEN',
          raw: raw
        });
      } else if (matchesCmdPrefix(upper, valveCloseCmd)) {
        steps.push({
          type: 'CMD',
          lineNum: i + 1,
          durationMs: mLatencyMs,
          action: 'VALVE_CLOSE',
          raw: raw
        });
      } else {
        for (var dIdx = 0; dIdx < dispensers.length; dIdx++) {
          var d = dispensers[dIdx];
          var lCmd = String(d.lowerCmd || '').toUpperCase().trim();
          var rCmd = String(d.raiseCmd || '').toUpperCase().trim();
          if (matchesCmdPrefix(upper, lCmd)) {
            steps.push({
              type: 'CMD',
              lineNum: i + 1,
              durationMs: mLatencyMs,
              action: 'DISP_LOWER',
              dispenserId: d.id,
              raw: raw
            });
            break;
          }
          if (matchesCmdPrefix(upper, rCmd)) {
            steps.push({
              type: 'CMD',
              lineNum: i + 1,
              durationMs: mLatencyMs,
              action: 'DISP_RAISE',
              dispenserId: d.id,
              raw: raw
            });
            break;
          }
        }
      }

      if (/\bM5\b/.test(upper)) {
        steps.push({
          type: 'CMD',
          lineNum: i + 1,
          durationMs: 40,
          action: 'STOP_SPINDLE',
          raw: raw
        });
      }

      if (/\bG(?:0|1|00|01)\b/.test(upper) || /[XY]\s*[+-]?\d/.test(upper)) {
        var mx = upper.match(/X\s*([+-]?\d+(?:[.,]\d+)?)/);
        var my = upper.match(/Y\s*([+-]?\d+(?:[.,]\d+)?)/);
        var mf = upper.match(/F\s*(\d+(?:[.,]\d+)?)/);
        if (mf) {
          var parsedF = parseFloat(mf[1].replace(',', '.'));
          if (!isNaN(parsedF) && parsedF > 0) curFeed = parsedF;
        }
        if (mx || my) {
          steps.push({
            type: 'MOVE',
            lineNum: i + 1,
            x: mx ? parseFloat(mx[1].replace(',', '.')) : null,
            y: my ? parseFloat(my[1].replace(',', '.')) : null,
            feedrate: curFeed,
            relative: isRelative,
            raw: raw
          });
        }
      }
    }

    return { steps: steps, totalLines: lines.length };
  },

  isGcodeLoaded: function(gcodeHash) {
    return !!(
      this.connected &&
      this._loadedHash &&
      gcodeHash &&
      this._loadedHash === gcodeHash &&
      this._loadedSteps &&
      this._loadedSteps.length > 0
    );
  },

  loadGcode: function(gcodeText, meta, cb) {
    if (!this.connected) {
      if (typeof cb === 'function') cb(new Error('Симулаторот не е поврзан.'));
      return;
    }
    if (this.status === 'RUNNING' || this.status === 'HOLD') {
      if (typeof cb === 'function') cb(new Error('Машината веќе извршува програма или се движи.'));
      return;
    }

    var built = this._buildStepsFromGcode(gcodeText, meta);
    if (built.steps.length === 0) {
      this._loadedSteps = [];
      this._loadedTotalLines = 0;
      this._loadedHash = '';
      if (typeof cb === 'function') cb(new Error('Генерираниот G-код нема активни команди за извршување.'));
      return;
    }

    this._loadedSteps = built.steps;
    this._loadedTotalLines = built.totalLines;
    this._loadedHash = (meta && meta.gcodeHash) ? String(meta.gcodeHash) : ('L' + built.totalLines);
    this.coords.lineNum = 0;
    this.coords.totalLines = built.totalLines;
    this.lastError = null;

    var snap = this.getSnapshot();
    snap.loaded = true;
    snap.loadedGcodeHash = this._loadedHash;
    if (typeof cb === 'function') cb(null, snap);
  },

  runLoaded: function(cb) {
    if (!this.connected) {
      if (typeof cb === 'function') cb(new Error('Симулаторот не е поврзан.'));
      return;
    }
    if (this.status === 'RUNNING' || this.status === 'HOLD') {
      if (typeof cb === 'function') cb(new Error('Машината веќе извршува програма или се движи.'));
      return;
    }
    if (this.status === 'ESTOP') {
      if (typeof cb === 'function') cb(new Error('Машината е во СТОП/RESET состојба. Притиснете RESET прво.'));
      return;
    }
    if (!this._loadedSteps || this._loadedSteps.length === 0) {
      if (typeof cb === 'function') cb(new Error('Во симулаторот нема вчитан G-код.'));
      return;
    }

    this._stopLoop();
    this._steps = this._loadedSteps.slice();
    this._stepIndex = -1;
    this._stepElapsedMs = 0;
    this._stepDurationMs = 0;
    this.coords.lineNum = 0;
    this.coords.totalLines = this._loadedTotalLines || this._steps.length;
    this.status = 'RUNNING';
    this.lastError = null;

    this._advanceToStep(0);
    this._startLoop();
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  loadAndRun: function(gcodeText, meta, cb) {
    var self = this;
    this.loadGcode(gcodeText, meta, function(loadErr) {
      if (loadErr) {
        if (typeof cb === 'function') cb(loadErr);
        return;
      }
      self.runLoaded(cb);
    });
  },

  moveTo: function(targetX, targetY, feedrate, cb) {
    if (!this.connected || this.status !== 'IDLE') {
      if (typeof cb === 'function') cb(new Error('Движењето е дозволено само кога машината е СПРЕМНА (IDLE).'));
      return;
    }
    if (this._hasLowered() || this.coords.valveOpen) {
      if (typeof cb === 'function') cb(new Error('⛔ Безбедносна блокада: подигнете ги сите диспензери и затворете го вентилот пред движење!'));
      return;
    }

    var tx = parseFloat(targetX);
    var ty = parseFloat(targetY);
    if (isNaN(tx) || isNaN(ty)) {
      if (typeof cb === 'function') cb(new Error('Невалидни целни координати.'));
      return;
    }
    var errLim = this._validateBounds(tx, ty);
    if (errLim) {
      if (typeof cb === 'function') cb(new Error('⛔ ' + errLim));
      return;
    }

    var feed = Math.round(parseFloat(feedrate) || 3000);
    this._stopLoop();
    this._steps = [{
      type: 'MOVE',
      lineNum: 1,
      x: tx,
      y: ty,
      feedrate: feed,
      raw: 'G90 G1 X' + tx.toFixed(3) + ' Y' + ty.toFixed(3) + ' F' + feed
    }];
    this._stepIndex = -1;
    this._stepElapsedMs = 0;
    this._stepDurationMs = 0;
    this.coords.lineNum = 0;
    this.coords.totalLines = 1;
    this.status = 'RUNNING';
    this.lastError = null;

    this._advanceToStep(0);
    this._startLoop();
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  runQuickCommand: function(cmdStr, cb) {
    if (!this.connected || this.status !== 'IDLE') {
      if (typeof cb === 'function') cb(new Error('Брзите команди се дозволени само кога машината е СПРЕМНА (IDLE).'));
      return;
    }
    if (this._hasLowered() || this.coords.valveOpen) {
      if (typeof cb === 'function') cb(new Error('⛔ Безбедносна блокада: прво подигнете ги сите диспензери и затворете го вентилот!'));
      return;
    }

    var built = this._buildStepsFromGcode(String(cmdStr || ''), { machine: CNCApp.State.machine });
    if (built.steps.length === 0) {
      if (typeof cb === 'function') cb(new Error('Непозната брза команда: ' + cmdStr));
      return;
    }

    for (var i = 0; i < built.steps.length; i++) {
      var st = built.steps[i];
      if (st.type === 'MOVE' && !st.resetZeroAfter) {
        var chkX = (st.x !== null) ? st.x : this.coords.x;
        var chkY = (st.y !== null) ? st.y : this.coords.y;
        var bErr = this._validateBounds(chkX, chkY);
        if (bErr) {
          if (typeof cb === 'function') cb(new Error('⛔ ' + bErr));
          return;
        }
      }
    }

    this._stopLoop();
    this._steps = built.steps;
    this._stepIndex = -1;
    this._stepElapsedMs = 0;
    this._stepDurationMs = 0;
    this.coords.lineNum = 0;
    this.coords.totalLines = built.totalLines;
    this.status = 'RUNNING';
    this.lastError = null;

    this._advanceToStep(0);
    this._startLoop();
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  _advanceToStep: function(idx) {
    if (idx >= this._steps.length) {
      this._finishJob();
      return false;
    }
    this._stepIndex = idx;
    this._stepElapsedMs = 0;
    var step = this._steps[idx];
    this.coords.lineNum = step.lineNum;

    if (step.type === 'MOVE') {
      this._segStartX = this.coords.x;
      this._segStartY = this.coords.y;
      if (step.relative) {
        this._segTargetX = parseFloat((this._segStartX + (step.x !== null ? step.x : 0)).toFixed(3));
        this._segTargetY = parseFloat((this._segStartY + (step.y !== null ? step.y : 0)).toFixed(3));
      } else {
        this._segTargetX = (step.x !== null) ? step.x : this.coords.x;
        this._segTargetY = (step.y !== null) ? step.y : this.coords.y;
      }
      this.coords.feedrate = step.feedrate || 1000;

      var dx = this._segTargetX - this._segStartX;
      var dy = this._segTargetY - this._segStartY;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var feedMmPerSec = (this.coords.feedrate || 1000) / 60;
      var moveMs = (feedMmPerSec > 0) ? ((dist / feedMmPerSec) * 1000) : 20;
      if (dist > 0.01) moveMs += 60;
      this._stepDurationMs = Math.max(20, moveMs);
    } else if (step.type === 'DWELL') {
      this.coords.feedrate = 0;
      this._stepDurationMs = Math.max(20, step.durationMs || 50);
    } else if (step.type === 'CMD') {
      this.coords.feedrate = 0;
      this._stepDurationMs = Math.max(20, step.durationMs || 80);
      if (step.action === 'VALVE_OPEN') {
        this.coords.valveOpen = true;
      } else if (step.action === 'VALVE_CLOSE') {
        this.coords.valveOpen = false;
      } else if (step.action === 'DISP_LOWER') {
        this._addLowered(step.dispenserId || 1);
      } else if (step.action === 'DISP_RAISE') {
        this._removeLowered(step.dispenserId || 1);
      } else if (step.action === 'STOP_SPINDLE') {
        this.coords.valveOpen = false;
        this._clearLowered();
      }
    }
    return true;
  },

  _finishJob: function() {
    this._stopLoop();
    this.status = 'IDLE';
    this.coords.feedrate = 0;
    this.coords.valveOpen = false;
    this._clearLowered();
    this._steps = [];
    this._stepIndex = 0;
  },

  _startLoop: function() {
    var self = this;
    this._lastTickMs = Date.now();
    this._timer = setInterval(function() {
      self._tick();
    }, 50);
  },

  _stopLoop: function() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  },

  _tick: function() {
    var now = Date.now();
    var rawDt = now - (this._lastTickMs || now);
    this._lastTickMs = now;
    if (this.status !== 'RUNNING') return;
    if (rawDt <= 0) rawDt = 50;
    if (rawDt > 250) rawDt = 250;

    var remainingDt = rawDt * (this.speedMultiplier || 1);

    while (remainingDt > 0 && this.status === 'RUNNING') {
      var step = this._steps[this._stepIndex];
      if (!step) {
        this._finishJob();
        break;
      }
      var needed = this._stepDurationMs - this._stepElapsedMs;
      if (remainingDt >= needed) {
        if (step.type === 'MOVE') {
          if (step.resetZeroAfter) {
            this.coords.x = 0;
            this.coords.y = 0;
          } else {
            this.coords.x = this._segTargetX;
            this.coords.y = this._segTargetY;
          }
        }
        remainingDt -= needed;
        if (!this._advanceToStep(this._stepIndex + 1)) {
          break;
        }
      } else {
        this._stepElapsedMs += remainingDt;
        if (step.type === 'MOVE' && this._stepDurationMs > 0) {
          var t = this._stepElapsedMs / this._stepDurationMs;
          this.coords.x = this._segStartX + (this._segTargetX - this._segStartX) * t;
          this.coords.y = this._segStartY + (this._segTargetY - this._segStartY) * t;
        }
        remainingDt = 0;
      }
    }
  },

  pause: function(cb) {
    if (this.status === 'RUNNING') {
      this.status = 'HOLD';
      this.coords.feedrate = 0;
    }
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  resume: function(cb) {
    if (this.status === 'HOLD') {
      this._lastTickMs = Date.now();
      this.status = 'RUNNING';
    }
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  stop: function(cb) {
    this._stopLoop();
    if (this._pulseTimer) {
      clearTimeout(this._pulseTimer);
      this._pulseTimer = null;
    }
    this.status = 'ESTOP';
    this.coords.feedrate = 0;
    this.coords.valveOpen = false;
    this._clearLowered();
    this._steps = [];
    this._stepIndex = 0;
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  reset: function(cb) {
    if (!this.connected) {
      if (typeof cb === 'function') cb(new Error('Симулаторот не е поврзан.'));
      return;
    }
    this._stopLoop();
    if (this._pulseTimer) {
      clearTimeout(this._pulseTimer);
      this._pulseTimer = null;
    }
    // Имитација на Mach3 RESET прекинувач (ESTOP <-> IDLE) со сигурно подигање/затворање излези
    this.status = (this.status === 'ESTOP') ? 'IDLE' : 'ESTOP';
    this.coords.feedrate = 0;
    this.coords.valveOpen = false;
    this._clearLowered();
    this.coords.lineNum = 0;
    this.coords.totalLines = 0;
    this.lastError = null;
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  jog: function(axis, stepMm, cb) {
    if (!this.connected || this.status !== 'IDLE') {
      if (typeof cb === 'function') cb(new Error('Jog е дозволен само кога машината е СПРЕМНА (IDLE).'));
      return;
    }
    if (axis !== 'X' && axis !== 'Y') {
      if (typeof cb === 'function') cb(new Error('Неподдржана оска (само X и Y).'));
      return;
    }
    var delta = parseFloat(stepMm) || 0;
    var nextX = (axis === 'X') ? parseFloat((this.coords.x + delta).toFixed(3)) : this.coords.x;
    var nextY = (axis === 'Y') ? parseFloat((this.coords.y + delta).toFixed(3)) : this.coords.y;
    var bErr = this._validateBounds(nextX, nextY);
    if (bErr) {
      this.lastError = bErr;
      if (typeof cb === 'function') cb(new Error('⛔ ' + bErr));
      return;
    }

    this.lastError = null;
    this.coords.x = nextX;
    this.coords.y = nextY;
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  zeroAxis: function(axis, cb) {
    if (!this.connected || this.status !== 'IDLE') {
      if (typeof cb === 'function') cb(new Error('Zero е дозволено само кога машината е СПРЕМНА (IDLE).'));
      return;
    }
    if (axis === 'X' || axis === 'XY' || axis === 'ALL') this.coords.x = 0;
    if (axis === 'Y' || axis === 'XY' || axis === 'ALL') this.coords.y = 0;
    this.lastError = null;
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  sendCommand: function(cmdStr, cb) {
    if (!this.connected || this.status !== 'IDLE') {
      if (typeof cb === 'function') cb(new Error('Рачна команда е дозволена само во IDLE режим.'));
      return;
    }
    var rawText = String(cmdStr || '');
    var upper = rawText.toUpperCase().trim();
    var m = CNCApp.State.machine || {};
    var timeUnit = m.timeUnit || 'ms';
    var valveOpenCmd = String(m.valveOpenCmd || 'M11 P3').toUpperCase().trim();
    var valveCloseCmd = String(m.valveCloseCmd || 'M10 P3').toUpperCase().trim();
    var dispensers = Array.isArray(m.dispensers) ? m.dispensers : [];
    var self = this;

    if (upper === 'RAISE_ALL') {
      this._clearLowered();
      this.lastError = null;
      if (typeof cb === 'function') cb(null, this.getSnapshot());
      return;
    }

    if (upper.indexOf('PULSE:') === 0) {
      var parts = upper.split(':');
      var pulseMs = parseInt(parts[parts.length - 1], 10) || 100;
      if (this._pulseTimer) clearTimeout(this._pulseTimer);
      this.coords.valveOpen = true;
      this._pulseTimer = setTimeout(function() {
        self.coords.valveOpen = false;
        self._pulseTimer = null;
      }, pulseMs);
      this.lastError = null;
      if (typeof cb === 'function') cb(null, this.getSnapshot());
      return;
    }

    var cmdLines = rawText.split(/\r?\n/);
    var relMode = false;

    function applySingleLine(lineUpper) {
      if (/\bG91\b/.test(lineUpper)) relMode = true;
      if (/\bG90\b/.test(lineUpper)) relMode = false;

      if (valveOpenCmd && (lineUpper === valveOpenCmd || lineUpper.indexOf(valveOpenCmd + ' ') === 0)) {
        self.coords.valveOpen = true;
      } else if (valveCloseCmd && (lineUpper === valveCloseCmd || lineUpper.indexOf(valveCloseCmd + ' ') === 0)) {
        self.coords.valveOpen = false;
      } else {
        for (var i = 0; i < dispensers.length; i++) {
          var d = dispensers[i];
          var dLow = String(d.lowerCmd || '').toUpperCase().trim();
          var dHigh = String(d.raiseCmd || '').toUpperCase().trim();
          if (dLow && (lineUpper === dLow || lineUpper.indexOf(dLow + ' ') === 0)) {
            self._addLowered(d.id);
            break;
          }
          if (dHigh && (lineUpper === dHigh || lineUpper.indexOf(dHigh + ' ') === 0)) {
            self._removeLowered(d.id);
            break;
          }
        }
      }

      if ((/\bG(?:0|1|00|01)\b/.test(lineUpper) || /[XY]\s*[+-]?\d/.test(lineUpper)) && !/\bG4\b/.test(lineUpper)) {
        var mx = lineUpper.match(/X\s*([+-]?\d+(?:[.,]\d+)?)/);
        var my = lineUpper.match(/Y\s*([+-]?\d+(?:[.,]\d+)?)/);
        if (mx) {
          var xv = parseFloat(mx[1].replace(',', '.'));
          if (!isNaN(xv)) {
            self.coords.x = parseFloat((relMode ? (self.coords.x + xv) : xv).toFixed(3));
          }
        }
        if (my) {
          var yv = parseFloat(my[1].replace(',', '.'));
          if (!isNaN(yv)) {
            self.coords.y = parseFloat((relMode ? (self.coords.y + yv) : yv).toFixed(3));
          }
        }
      }
    }

    var deferredIdx = -1;
    var deferredMs = 0;
    for (var l = 0; l < cmdLines.length; l++) {
      var ln = cmdLines[l].split(';')[0].trim().toUpperCase();
      if (!ln) continue;
      if (/\bG4\b/.test(ln)) {
        var mp = ln.match(/P\s*(\d+(?:[.,]\d+)?)/);
        var pVal = mp ? parseFloat(mp[1].replace(',', '.')) : 100;
        var ms = (timeUnit === 's') ? (pVal * 1000) : pVal;
        if (isNaN(ms) || ms < 20) ms = 100;
        deferredIdx = l + 1;
        deferredMs = ms;
        break;
      }
      applySingleLine(ln);
    }

    if (deferredIdx !== -1 && deferredIdx < cmdLines.length) {
      if (this._pulseTimer) clearTimeout(this._pulseTimer);
      var tailLines = cmdLines.slice(deferredIdx);
      this._pulseTimer = setTimeout(function() {
        for (var k = 0; k < tailLines.length; k++) {
          var tLn = tailLines[k].split(';')[0].trim().toUpperCase();
          if (tLn) applySingleLine(tLn);
        }
        self._pulseTimer = null;
      }, deferredMs);
    }

    this.lastError = null;
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  raiseAllDispensers: function(dispensers, cb) {
    if (!this.connected || this.status !== 'IDLE') {
      if (typeof cb === 'function') cb(new Error('Подигање е дозволено само во IDLE режим.'));
      return;
    }
    this._clearLowered();
    this.lastError = null;
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  }
};