// LG webOS adapter: the app talks to the same local interface the desktop app uses, on the TV's own address.
(function (root) {
  var BUTTONS = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'ENTER', 'BACK', 'EXIT', 'HOME', 'QMENU', 'INFO', 'GUIDE', 'VOLUMEUP', 'VOLUMEDOWN',
    'MUTE', 'CHANNELUP', 'CHANNELDOWN', 'PLAY', 'PAUSE', 'STOP', 'REWIND', 'FASTFORWARD', 'RED', 'GREEN', 'YELLOW', 'BLUE',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  var CAPABILITIES = ['apps', 'inputs', 'text', 'textDelete', 'volumeSet', 'mute', 'screenOff', 'powerOff', 'pointer', 'capture'];
  var ENDPOINTS = ['ws://127.0.0.1:3000', 'wss://127.0.0.1:3001'];

  function Adapter(options) {
    this.manifest = options.manifest;
    this.storage = options.storage;
    this.onStatus = options.onStatus;
    this.endpoints = options.endpoints || ENDPOINTS;
    this.ws = null;
    this.pointer = null;
    this.nextId = 1;
    this.pending = {};
    this.state = {};
    this.model = 'LG webOS';
  }

  Adapter.prototype.start = function () {
    this._open(0);
  };

  Adapter.prototype._open = function (index) {
    var self = this;
    var ws = new WebSocket(this.endpoints[index]);
    var opened = false;
    ws.onopen = function () {
      opened = true;
      self.ws = ws;
      self._register();
    };
    ws.onmessage = function (event) { self._onMessage(JSON.parse(event.data)); };
    ws.onclose = function () {
      if (!opened && index + 1 < self.endpoints.length) {
        self._open(index + 1);
        return;
      }
      self.ws = null;
      self.pointer = null;
      self.onStatus('tv-offline');
      setTimeout(function () { self._open(0); }, 5000);
    };
    ws.onerror = function () {};
  };

  Adapter.prototype._register = function () {
    var payload = { forcePairing: false, pairingType: 'PROMPT', manifest: this.manifest };
    var key = this.storage.getItem('ssapKey');
    if (key) payload['client-key'] = key;
    this.ws.send(JSON.stringify({ type: 'register', id: 'register', payload: payload }));
  };

  Adapter.prototype._onMessage = function (msg) {
    if (msg.id === 'register') {
      if (msg.type === 'registered') {
        this.storage.setItem('ssapKey', msg.payload['client-key']);
        this.onStatus('tv-ready');
        this._afterRegister();
      } else if (msg.type === 'error') {
        if (this.storage.getItem('ssapKey')) {
          this.storage.removeItem('ssapKey');
          this._register();
        } else {
          this.onStatus('tv-refused');
        }
      } else if (msg.payload && msg.payload.pairingType) {
        this.onStatus('tv-approve');
      }
      return;
    }
    if (msg.id === 'volume' || msg.id === 'app') {
      var p = msg.payload || {};
      if (p.volumeStatus) {
        this.state.volume = p.volumeStatus.volume;
        this.state.muted = p.volumeStatus.muteStatus;
      } else if (p.volume !== undefined) {
        this.state.volume = p.volume;
        this.state.muted = p.muted;
      }
      if (p.appId !== undefined) this.state.appId = p.appId;
      return;
    }
    var callback = this.pending[msg.id];
    if (!callback) return;
    delete this.pending[msg.id];
    var payload = msg.payload || {};
    if (msg.type === 'error' || payload.returnValue === false) callback(new Error(msg.error || payload.errorText || 'Failed'));
    else callback(null, payload);
  };

  Adapter.prototype._afterRegister = function () {
    var self = this;
    this.ws.send(JSON.stringify({ type: 'subscribe', id: 'volume', uri: 'ssap://audio/getVolume' }));
    this.ws.send(JSON.stringify({ type: 'subscribe', id: 'app', uri: 'ssap://com.webos.applicationManager/getForegroundAppInfo' }));
    this._request('ssap://system/getSystemInfo', {}, function (err, info) {
      if (!err && info.modelName) self.model = info.modelName;
    });
  };

  Adapter.prototype._request = function (uri, payload, callback) {
    if (!this.ws) {
      callback(new Error('The TV is not ready'));
      return;
    }
    var id = 'req' + this.nextId;
    this.nextId += 1;
    var self = this;
    this.pending[id] = callback;
    setTimeout(function () {
      if (self.pending[id]) {
        delete self.pending[id];
        callback(new Error('The TV did not answer'));
      }
    }, 8000);
    this.ws.send(JSON.stringify({ type: 'request', id: id, uri: uri, payload: payload }));
  };

  Adapter.prototype._withPointer = function (callback) {
    var self = this;
    if (this.pointer && this.pointer.readyState === 1) {
      callback(null, this.pointer);
      return;
    }
    this._request('ssap://com.webos.service.networkinput/getPointerInputSocket', {}, function (err, result) {
      if (err) {
        callback(err);
        return;
      }
      var socket = new WebSocket(result.socketPath);
      socket.onopen = function () {
        self.pointer = socket;
        callback(null, socket);
      };
      socket.onerror = function () { callback(new Error('No input channel')); };
    });
  };

  Adapter.prototype._pointerSend = function (text, done) {
    this._withPointer(function (err, socket) {
      if (err) {
        done(err);
        return;
      }
      socket.send(text);
      done(null);
    });
  };

  Adapter.prototype.info = function () {
    return { brand: 'webos', model: this.model, capabilities: CAPABILITIES, buttons: BUTTONS };
  };

  Adapter.prototype.getState = function (done) { done(null, this.state); };

  Adapter.prototype.button = function (name, done) {
    var upper = String(name).toUpperCase();
    if (BUTTONS.indexOf(upper) < 0) {
      done(new Error('Unknown button'));
      return;
    }
    this._pointerSend('type:button\nname:' + upper + '\n\n', done);
  };

  Adapter.prototype.move = function (dx, dy, done) {
    this._pointerSend('type:move\ndx:' + Math.round(dx) + '\ndy:' + Math.round(dy) + '\ndown:0\n\n', done);
  };

  Adapter.prototype.click = function (done) { this._pointerSend('type:click\n\n', done); };

  Adapter.prototype.scroll = function (dx, dy, done) {
    this._pointerSend('type:scroll\ndx:' + Math.round(dx) + '\ndy:' + Math.round(dy) + '\n\n', done);
  };

  Adapter.prototype.insertText = function (text, done) {
    this._request('ssap://com.webos.service.ime/insertText', { text: String(text), replace: false }, done);
  };

  Adapter.prototype.deleteCharacters = function (count, done) {
    this._request('ssap://com.webos.service.ime/deleteCharacters', { count: Number(count) }, done);
  };

  Adapter.prototype.sendEnter = function (done) {
    this._request('ssap://com.webos.service.ime/sendEnterKey', {}, done);
  };

  Adapter.prototype.listApps = function (done) {
    this._request('ssap://com.webos.applicationManager/listLaunchPoints', {}, function (err, result) {
      if (err) {
        done(err);
        return;
      }
      done(null, (result.launchPoints || []).map(function (p) { return { id: p.id, title: p.title }; }));
    });
  };

  Adapter.prototype.launchApp = function (id, done) {
    this._request('ssap://com.webos.applicationManager/launch', { id: String(id) }, done);
  };

  Adapter.prototype.listInputs = function (done) {
    this._request('ssap://tv/getExternalInputList', {}, function (err, result) {
      if (err) {
        done(err);
        return;
      }
      done(null, (result.devices || []).map(function (d) { return { id: d.id, label: d.label || d.id }; }));
    });
  };

  Adapter.prototype.switchInput = function (id, done) {
    this._request('ssap://tv/switchInput', { inputId: String(id) }, done);
  };

  Adapter.prototype.setVolume = function (volume, done) {
    this._request('ssap://audio/setVolume', { volume: Math.max(0, Math.min(100, Math.round(volume))) }, done);
  };

  Adapter.prototype.setMute = function (mute, done) {
    this._request('ssap://audio/setMute', { mute: Boolean(mute) }, done);
  };

  Adapter.prototype.powerOff = function (done) { this._request('ssap://system/turnOff', {}, done); };

  Adapter.prototype.screenOff = function (done) {
    this._request('ssap://com.webos.service.tvpower/power/turnOffScreen', { standbyMode: 'active' }, done);
  };

  Adapter.prototype.screenOn = function (done) {
    this._request('ssap://com.webos.service.tvpower/power/turnOnScreen', { standbyMode: 'active' }, done);
  };

  Adapter.prototype.capture = function (done) {
    this._request('ssap://tv/executeOneShot', {}, function (err, result) {
      if (err || !result.imageUri) {
        done(err || new Error('No picture'));
        return;
      }
      var xhr = new XMLHttpRequest();
      xhr.open('GET', result.imageUri);
      xhr.responseType = 'arraybuffer';
      xhr.timeout = 10000;
      xhr.onload = function () {
        if (xhr.status !== 200) {
          done(new Error('Picture download failed: ' + xhr.status));
          return;
        }
        var mime = String(xhr.getResponseHeader('Content-Type') || 'image/jpeg').split(';')[0];
        done(null, { mime: mime, data: root.TvSession.toBase64(new Uint8Array(xhr.response)) });
      };
      xhr.onerror = function () { done(new Error('Picture download failed')); };
      xhr.ontimeout = xhr.onerror;
      xhr.send();
    });
  };

  root.TvWebosAdapter = Adapter;
}(window));
