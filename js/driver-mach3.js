window.CNCApp = window.CNCApp || {};

CNCApp.Mach3BridgeDriver = {
  id: 'mach3',
  label: '🔌 Mach3 Bridge (127.0.0.1:8765)',
  baseUrl: 'http://127.0.0.1:8765',
  connected: false,
  status: 'DISCONNECTED',
  lastError: null,
  loadedGcodeHash: '',
  bridgeToken: '',
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

  _addLowered: function(dispId) {
    var id = parseInt(dispId, 10);
    if (!id) return;
    if (!Array.isArray(this.coords.loweredDispensers)) this.coords.loweredDispensers = [];
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
      if (this.coords.loweredDispensers[i] !== id) out.push(this.coords.loweredDispensers[i]);
    }
    this.coords.loweredDispensers = out;
  },

  _ensureBridgeToken: function(cb) {
    var self = this;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', this.baseUrl + '/bridge_token', true);
    xhr.timeout = 4000;
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          var data = JSON.parse(xhr.responseText);
          if (!data || !data.token) throw new Error('Недостасува bridge token.');
          self.bridgeToken = String(data.token);
          if (typeof cb === 'function') cb(null);
        } catch (e) {
          if (typeof cb === 'function') cb(e);
        }
      } else {
        if (typeof cb === 'function') cb(new Error('Неуспешно добивање bridge безбедносен token.'));
      }
    };
    xhr.onerror = function() {
      if (typeof cb === 'function') cb(new Error('Неуспешно добивање bridge безбедносен token.'));
    };
    xhr.ontimeout = xhr.onerror;
    xhr.send();
  },

  _request: function(method, path, bodyObj, cb) {
    var self = this;
    if (String(method).toUpperCase() === 'POST' && !this.bridgeToken) {
      this._ensureBridgeToken(function(tokenErr) {
        if (tokenErr) {
          if (typeof cb === 'function') cb(tokenErr);
          return;
        }
        self._request(method, path, bodyObj, cb);
      });
      return;
    }

    var sendRequest = function() {
    var xhr = new XMLHttpRequest();
    var done = false;

    function finish(err, data) {
      if (done) return;
      done = true;
      if (typeof cb === 'function') cb(err, data);
    }

    try {
      xhr.open(method, self.baseUrl + path, true);
      if (String(method).toUpperCase() === 'GET' && path === '/status') {
        xhr.timeout = 1800;
      } else if (path === '/load_gcode' || path === '/load_and_run') {
        xhr.timeout = 25000;
      } else {
        xhr.timeout = 8000;
      }
      if (bodyObj !== null && bodyObj !== undefined) {
        xhr.setRequestHeader('Content-Type', 'application/json');
      }
      if (String(method).toUpperCase() === 'POST' && self.bridgeToken) {
        xhr.setRequestHeader('X-Bridge-Token', self.bridgeToken);
      }

      xhr.onreadystatechange = function() {
        if (xhr.readyState !== 4) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var parsed = xhr.responseText ? JSON.parse(xhr.responseText) : {};
            self.lastError = parsed.error || null;
            finish(null, parsed);
          } catch (e) {
            finish(new Error('Невалиден одговор од Mach3Bridge.exe'));
          }
        } else {
          var errMsg = 'Нема врска со Mach3Bridge.exe (' + self.baseUrl + '). Проверете дали е стартуван или користете Симулатор.';
          if (xhr.responseText) {
            try {
              var errJson = JSON.parse(xhr.responseText);
              if (errJson && errJson.error) errMsg = errJson.error;
            } catch (e2) {}
          }
          self.lastError = errMsg;
          finish(new Error(errMsg));
        }
      };

      xhr.ontimeout = function() {
        var msg = 'Mach3Bridge.exe не одговори навреме (' + self.baseUrl + ').';
        self.lastError = msg;
        finish(new Error(msg));
      };

      xhr.onerror = function() {
        var msg = 'Нема врска со Mach3Bridge.exe (' + self.baseUrl + '). Проверете дали е стартуван или изберете Симулатор.';
        self.lastError = msg;
        finish(new Error(msg));
      };

      if (bodyObj !== null && bodyObj !== undefined) {
        xhr.send(JSON.stringify(bodyObj));
      } else {
        xhr.send();
      }
    } catch (ex) {
      var msg = 'Грешка при комуникација со Mach3 Bridge: ' + ex.message;
      self.lastError = msg;
      finish(new Error(msg));
    }
    };
    sendRequest();
  },

  _applyRemoteSnapshot: function(data) {
    if (!data) return this.getSnapshot();
    var st = String(data.status || 'IDLE').toUpperCase();
    if (st !== 'IDLE' && st !== 'RUNNING' && st !== 'HOLD' && st !== 'ESTOP' && st !== 'DISCONNECTED') {
      st = 'IDLE';
    }
    if (data.mach3Connected === false) {
      this.lastError = data.error || 'Mach3Bridge.exe работи, но Mach3 не е стартуван на овој компјутер.';
    }
    this.status = st;
    this.coords.x = parseFloat(data.x) || 0;
    this.coords.y = parseFloat(data.y) || 0;
    this.coords.feedrate = parseFloat(data.feedrate) || 0;
    this.coords.lineNum = parseInt(data.lineNum, 10) || 0;
    this.coords.totalLines = parseInt(data.totalLines, 10) || 0;
    if (typeof data.valveOpen === 'boolean') {
      this.coords.valveOpen = data.valveOpen;
    }
    if (Array.isArray(data.loweredDispensers)) {
      this.coords.loweredDispensers = data.loweredDispensers.slice();
    }
    if (data.activeDispenserId) {
      this.coords.activeDispenserId = parseInt(data.activeDispenserId, 10) || 1;
    }
    if (typeof data.loadedGcodeHash === 'string') {
      this.loadedGcodeHash = data.loadedGcodeHash;
    }
    return this.getSnapshot();
  },

  getSnapshot: function() {
    return {
      driverId: this.id,
      connected: this.connected,
      status: this.connected ? this.status : 'DISCONNECTED',
      coords: {
        x: parseFloat((this.coords.x || 0).toFixed(3)),
        y: parseFloat((this.coords.y || 0).toFixed(3)),
        feedrate: Math.round(this.coords.feedrate || 0),
        lineNum: this.coords.lineNum || 0,
        totalLines: this.coords.totalLines || 0,
        activeDispenserId: this.coords.activeDispenserId || 1,
        loweredDispensers: Array.isArray(this.coords.loweredDispensers) ? this.coords.loweredDispensers.slice() : [],
        valveOpen: !!this.coords.valveOpen
      },
      lastError: this.lastError
    };
  },

  _buildConfigPayload: function(machineObj) {
    var m = machineObj || (CNCApp.State ? CNCApp.State.machine : {}) || {};
    var list = Array.isArray(m.dispensers) ? m.dispensers : [];
    var outDisp = [];
    for (var i = 0; i < list.length; i++) {
      var did = list[i].id || (i + 1);
      outDisp.push({
        id: list[i].id,
        lowerCmd: list[i].lowerCmd || ('M11 P' + (3 + did)),
        raiseCmd: list[i].raiseCmd || ('M10 P' + (3 + did))
      });
    }
    return {
      valveOpenCmd: m.valveOpenCmd || 'M11 P3',
      valveCloseCmd: m.valveCloseCmd || 'M10 P3',
      homeCommand: m.homeCommand || 'G28.1 X2 Y2',
      parkCommand: m.parkCommand || 'G1 X1 Y1 F2000',
      feed: Math.round(parseFloat(m.moveClickSpeed) || 3000) || 3000,
      dispensers: outDisp
    };
  },

  syncConfig: function(cb) {
    var payload = this._buildConfigPayload();
    this._request('POST', '/config', payload, function(err, data) {
      if (typeof cb === 'function') cb(err, data);
    });
  },

  connect: function(cb) {
    var self = this;
    this._request('GET', '/status', null, function(err, data) {
      if (err) {
        self.connected = false;
        self.status = 'DISCONNECTED';
        self.loadedGcodeHash = '';
        if (typeof cb === 'function') cb(err, self.getSnapshot());
        return;
      }
      self.connected = true;
      var snap = self._applyRemoteSnapshot(data);
      self.syncConfig();
      if (CNCApp.Storage) {
        if (typeof CNCApp.Storage.syncOrRecoverBridgeTemp === 'function') {
          CNCApp.Storage.syncOrRecoverBridgeTemp();
        } else if (typeof CNCApp.Storage.saveToBridgeTemp === 'function') {
          CNCApp.Storage.saveToBridgeTemp();
        }
      }
      if (typeof cb === 'function') cb(null, snap);
    });
  },

  disconnect: function(cb) {
    this.connected = false;
    this.status = 'DISCONNECTED';
    this.loadedGcodeHash = '';
    this.bridgeToken = '';
    this.coords.loweredDispensers = [];
    this.coords.valveOpen = false;
    this.lastError = null;
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  getStatus: function(cb) {
    if (!this.connected) {
      if (typeof cb === 'function') cb(null, this.getSnapshot());
      return;
    }
    var self = this;
    this._request('GET', '/status', null, function(err, data) {
      if (err) {
        if (typeof cb === 'function') cb(err, self.getSnapshot());
        return;
      }
      var snap = self._applyRemoteSnapshot(data);
      if (typeof cb === 'function') cb(null, snap);
    });
  },

  isGcodeLoaded: function(gcodeHash) {
    return !!(
      this.connected &&
      this.loadedGcodeHash &&
      gcodeHash &&
      this.loadedGcodeHash === gcodeHash &&
      this.coords.totalLines > 0
    );
  },

  loadGcode: function(gcodeText, meta, cb) {
    if (!this.connected) {
      if (typeof cb === 'function') cb(new Error('Mach3 Bridge не е поврзан.'));
      return;
    }
    var self = this;
    var cfg = this._buildConfigPayload(meta && meta.machine ? meta.machine : null);
    var gHash = (meta && meta.gcodeHash) ? String(meta.gcodeHash) : '';
    var payload = {
      gcode: gcodeText,
      gcodeHash: gHash,
      filename: (meta && meta.projectName) ? meta.projectName : 'job.tap',
      valveOpenCmd: cfg.valveOpenCmd,
      valveCloseCmd: cfg.valveCloseCmd,
      dispensers: cfg.dispensers
    };
    this._request('POST', '/load_gcode', payload, function(err, data) {
      if (err) {
        self.loadedGcodeHash = '';
        if (typeof cb === 'function') cb(err);
        return;
      }
      if (!data || data.mach3Connected === false || !data.loaded) {
        self.loadedGcodeHash = '';
        var msg = (data && data.error) ? data.error : 'Mach3 не потврди вчитување на G-кодот.';
        if (typeof cb === 'function') cb(new Error(msg));
        return;
      }
      var snap = self._applyRemoteSnapshot(data);
      snap.loaded = true;
      snap.loadedGcodeHash = self.loadedGcodeHash || gHash;
      if (typeof cb === 'function') cb(null, snap);
    });
  },

  runLoaded: function(cb) {
    if (!this.connected) {
      if (typeof cb === 'function') cb(new Error('Mach3 Bridge не е поврзан.'));
      return;
    }
    var self = this;
    this._request('POST', '/run_loaded', {}, function(err, data) {
      if (err) {
        if (typeof cb === 'function') cb(err);
        return;
      }
      if (data && data.mach3Connected === false) {
        if (typeof cb === 'function') cb(new Error(data.error || 'Mach3 не е поврзан.'));
        return;
      }
      var snap = self._applyRemoteSnapshot(data);
      if (typeof cb === 'function') cb(null, snap);
    });
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

  pause: function(cb) {
    var self = this;
    this._request('POST', '/pause', {}, function(err, data) {
      if (err) { if (typeof cb === 'function') cb(err); return; }
      if (typeof cb === 'function') cb(null, self._applyRemoteSnapshot(data));
    });
  },

  resume: function(cb) {
    var self = this;
    this._request('POST', '/resume', {}, function(err, data) {
      if (err) { if (typeof cb === 'function') cb(err); return; }
      if (typeof cb === 'function') cb(null, self._applyRemoteSnapshot(data));
    });
  },

  stop: function(cb) {
    var self = this;
    var cfg = this._buildConfigPayload();
    this._request('POST', '/stop', cfg, function(err, data) {
      if (err) { if (typeof cb === 'function') cb(err); return; }
      self.coords.loweredDispensers = [];
      self.coords.valveOpen = false;
      if (typeof cb === 'function') cb(null, self._applyRemoteSnapshot(data));
    });
  },

  reset: function(cb) {
    var self = this;
    var cfg = this._buildConfigPayload();
    this._request('POST', '/reset', cfg, function(err, data) {
      if (err) { if (typeof cb === 'function') cb(err); return; }
      self.coords.loweredDispensers = [];
      self.coords.valveOpen = false;
      if (typeof cb === 'function') cb(null, self._applyRemoteSnapshot(data));
    });
  },

  jog: function(axis, stepMm, cb) {
    var self = this;
    if (axis !== 'X' && axis !== 'Y') {
      if (typeof cb === 'function') cb(new Error('Неподдржана оска (само X и Y).'));
      return;
    }
    this._request('POST', '/jog', { axis: axis, step: parseFloat(stepMm) || 0 }, function(err, data) {
      if (err) { if (typeof cb === 'function') cb(err); return; }
      if (typeof cb === 'function') cb(null, self._applyRemoteSnapshot(data));
    });
  },

  zeroAxis: function(axis, cb) {
    var self = this;
    this._request('POST', '/zero', { axis: axis }, function(err, data) {
      if (err) { if (typeof cb === 'function') cb(err); return; }
      if (typeof cb === 'function') cb(null, self._applyRemoteSnapshot(data));
    });
  },

  moveTo: function(x, y, feedrate, cb) {
    var self = this;
    var feed = Math.round(parseFloat(feedrate) || 3000);
    var cmd = 'G90 G1 X' + parseFloat(x).toFixed(3) + ' Y' + parseFloat(y).toFixed(3) + ' F' + feed;
    this._request('POST', '/mdi', { cmd: cmd }, function(err, data) {
      if (err) { if (typeof cb === 'function') cb(err); return; }
      if (typeof cb === 'function') cb(null, self._applyRemoteSnapshot(data));
    });
  },

  runQuickCommand: function(cmdStr, cb) {
    var self = this;
    this._request('POST', '/mdi', { cmd: String(cmdStr || '') }, function(err, data) {
      if (err) { if (typeof cb === 'function') cb(err); return; }
      if (typeof cb === 'function') cb(null, self._applyRemoteSnapshot(data));
    });
  },

  sendCommand: function(cmdStr, cb) {
    var self = this;
    var upper = String(cmdStr || '').toUpperCase().trim();
    var m = CNCApp.State.machine;
    var valveOpenCmd = String(m.valveOpenCmd || 'M11 P3').toUpperCase().trim();
    var valveCloseCmd = String(m.valveCloseCmd || 'M10 P3').toUpperCase().trim();

    var bodyObj = { cmd: String(cmdStr || '') };
    if (upper.indexOf('PULSE:') === 0) {
      bodyObj.openCmd = valveOpenCmd;
      bodyObj.closeCmd = valveCloseCmd;
    }

    this._request('POST', '/mdi', bodyObj, function(err, data) {
      if (err) { if (typeof cb === 'function') cb(err); return; }

      if (upper.indexOf('PULSE:') === 0) {
        self.coords.valveOpen = false;
      } else {
        var cmdLines = upper.split(/\r?\n/);
        for (var lIdx = 0; lIdx < cmdLines.length; lIdx++) {
          var lineCode = cmdLines[lIdx].split(';')[0].trim();
          if (!lineCode) continue;
          if (valveOpenCmd && lineCode === valveOpenCmd) {
            self.coords.valveOpen = true;
          } else if (valveCloseCmd && lineCode === valveCloseCmd) {
            self.coords.valveOpen = false;
          } else if (m && Array.isArray(m.dispensers)) {
            for (var i = 0; i < m.dispensers.length; i++) {
              var d = m.dispensers[i];
              var dLower = String(d.lowerCmd || '').toUpperCase().trim();
              var dRaise = String(d.raiseCmd || '').toUpperCase().trim();
              if (dLower && lineCode === dLower) {
                self._addLowered(d.id);
                break;
              }
              if (dRaise && lineCode === dRaise) {
                self._removeLowered(d.id);
                break;
              }
            }
          }
        }
      }

      if (typeof cb === 'function') cb(null, self._applyRemoteSnapshot(data));
    });
  },

  raiseAllDispensers: function(dispensers, cb) {
    var list = Array.isArray(dispensers) ? dispensers : [];
    var self = this;
    var m = CNCApp.State.machine || {};
    var feed = Math.round(parseFloat(m.moveClickSpeed) || 3000) || 3000;
    var baseX = parseFloat(this.coords && this.coords.x) || 0;
    var seqLines = [];
    var dir = 1;

    for (var i = 0; i < list.length; i++) {
      var rCmd = String(list[i].raiseCmd || ('M10 P' + (3 + (list[i].id || (i + 1))))).trim();
      if (!rCmd) continue;
      var targetX = (dir === 1) ? (baseX + 0.001) : baseX;
      dir = -dir;
      seqLines.push(rCmd);
      seqLines.push('G1 X' + targetX.toFixed(3) + ' F' + feed);
    }

    if (seqLines.length === 0) {
      this._request('POST', '/mdi', { cmd: 'RAISE_ALL', raiseCmds: [], feed: feed }, function(err, data) {
        if (err) { if (typeof cb === 'function') cb(err); return; }
        self.coords.loweredDispensers = [];
        if (typeof cb === 'function') cb(null, self._applyRemoteSnapshot(data));
      });
      return;
    }

    this._request('POST', '/mdi', { cmd: seqLines.join('\n') }, function(err, data) {
      if (err) {
        if (typeof cb === 'function') cb(err);
        return;
      }
      self.coords.loweredDispensers = [];
      if (typeof cb === 'function') cb(null, self._applyRemoteSnapshot(data));
    });
  }
};