/**
 * Module dependencies.
 */

var fork = require('child_process').fork
  , qs = require('querystring')
  , eq = require('eq')
  , os = require('os')
  , ms = require('ms')
  , env = process.env.NODE_ENV
  , Distributor = require('distribute')
  , EventEmitter = require('events').EventEmitter
  , debug = require('debug')('up')
  , inherit = require('./inherit')
  , cookie = require('cookie').parse

/**
 * Module exports.
 */

module.exports = exports = UpServer;

/**
 * Version.
 *
 * @api public
 */

exports.version = '0.2.6';

/**
 * Worker constructor.
 *
 * @api public
 */

exports.Worker = Worker;

/**
 * Number of CPUs available.
 */

var cpus = os.cpus().length;

/**
 * Default worker timeout.
 */

var workerTimeout = 'development' == env ? '500ms' : '10m';

/**
 * Default number of workers.
 */

var numWorkers = 'development' == env ? 1 : cpus;

/**
 * Default minimum expected lifetime of a worker.
 * If a worker dies younger, we don't respawn even if keepAlive == true.
 * We want to prevent auto-respawning storms from overloading the system.
 */
var minExpectedLifetime = '20s';

/**
 * UpServer factory/constructor.
 *
 * @param {String} module file
 * @param {Object} options
 * @api public
 */

function UpServer (server, file, opts) {
  if (this == global) return new UpServer(server, file, opts);

  Distributor.call(this, server);

  var self = this;
  opts = opts || {};

  this.file = file;
  this.numWorkers = eq(opts.numWorkers || numWorkers, { cpus: cpus });
  this.workerTimeout = ms(null != opts.workerTimeout
    ? opts.workerTimeout : workerTimeout);
  this.requires = opts.requires || [];
  this.assumeReady = opts.assumeReady === undefined ? true : !!opts.assumeReady;
  this.keepAlive = opts.keepAlive || false;
  this.minExpectedLifetime = ms(opts.minExpectedLifetime != null ? opts.minExpectedLifetime : minExpectedLifetime);
  if (false !== opts.workerPingInterval) {
    this.workerPingInterval = ms(opts.workerPingInterval || '1m');
  }

  this.workers = [];
  this.spawning = [];
  this.lastIndex = -1;

  opts.allocator = opts.allocator || 'cookie';
  if(typeof opts.allocator == 'function' && !(opts.allocator instanceof RegExp))
    this.allocator = opts.allocator;
  else if(opts.allocator == 'socket.io')
    this.allocator = PathAllocator(/^\/socket\.io\/[^\/]*\/(?:xhr-polling|htmlfile|jsonp-polling)\/([^\?]+).*/);
  else if(opts.allocator == 'sockjs')
    this.allocator = PathAllocator(/^(?:\/[^\/]+)*\/(\d+)\/[a-z0-9_]+\/(?:websocket|x[hd]r_\w+|iframe_\w+|jsonp_\w+).*/);
  else if(opts.allocator == 'cookie')
    this.allocator = CookieAllocator('_up');
  else if(opts.allocator instanceof RegExp)
    this.allocator = PathAllocator(opts.allocator);
  else
    this.allocator = PathAllocator(new RegExp(opts.allocator.replace('/', '\\/')));

  if (opts.title) {
    this.title = opts.title;
    process.title = this.title + ' master';
  }

  // setup workers
  this.spawnWorkers(this.numWorkers);
};

/**
 * Inherits from EventEmitter.
 */

inherit(UpServer, Distributor);

/**
 * Reloads the workers.
 *
 * @param {Function} callback
 * @return {UpServer} for chaining
 * @api public
 */

UpServer.prototype.reload = function (fn) {

  // remove all workers in the spawning state
  while (this.spawning.length > 0) {
    this.spawning[0].shutdown();
  }

  if (this.workerTimeout > 0) {
    // snapshot what workers we'll shut down
    var reload = [].concat(this.workers)
      , self = this

    debug('reloading - spawning %d new workers', this.numWorkers);
    this.spawnWorkers(this.numWorkers);

    this.once('spawn', function (worker) {
      debug('worker %s spawned - removing old workers', worker.pid);
      self.emit('reload');
      fn && fn();

      // shut down old workers
      for (var i = 0, l = reload.length; i < l; i++) {
        reload[i].shutdown();
      }
    });
  } else {
    debug('removing old workers');
    for (var i = 0, l = this.workers.length; i < l; i++) {
      this.workers[i].shutdown();
    }

    var self = this

    this.on('terminate', function listener() {
      if (self.workers.length == 0 && self.spawning == 0) {
        debug('all workers removed. spawning %d new workers', self.numWorkers);
        self.spawnWorkers(self.numWorkers);
        self.removeListener('terminate', listener);

        this.once('spawn', function() {
          self.emit('reload');
          fn && fn();
        })
      }
    })
  }

  return this;
};

/**
 * Helper function to spawn multiple workers.
 *
 * @param {Number} number of workers to spawn
 * @api public
 */

UpServer.prototype.spawnWorkers = function (n) {
  debug('spawning %d workers from master %d', n, process.pid);
  for (var i = 0, l = n; i < l; i++) {
    this.spawnWorker();
  }
};

/**
 * Spawns a worker that binds to an available port.
 *
 * @api public
 */

UpServer.prototype.spawnWorker = function (fn) {
  var w = new Worker(this)
    , self = this

  // keep track that we're spawning
  this.spawning.push(w);

  w.on('stateChange', function () {
    switch (w.readyState) {
      case 'spawned':
        self.spawning.splice(self.spawning.indexOf(w), 1);
        self.workers.push(w);
        self.emit('spawn', w);
        break;

      case 'terminating':
      case 'terminated':
        if (~self.spawning.indexOf(w)) {
          self.spawning.splice(self.spawning.indexOf(w), 1);
        }
        if (~self.workers.indexOf(w)) {
          self.workers.splice(self.workers.indexOf(w), 1);
          self.lastIndex = -1;
          if (self.keepAlive && (self.workers.length + self.spawning.length < self.numWorkers)) {
            if (new Date().getTime() - w.birthtime < self.minExpectedLifetime) {
              debug('worker %s found dead at a too young age. won\'t respawn new worker', w.pid);
            }
            else {
              debug('worker %s found dead. spawning 1 new worker', w.pid);
              self.spawnWorker();
            }
          }
        }
        self.emit('terminate', w)
        break;
    }
  });
};

/**
 * Gets the next port in the round.
 *
 * @api private
 */

UpServer.prototype.nextWorker = function () {
  this.lastIndex++;
  if (!this.workers[this.lastIndex]) this.lastIndex = 0;
  return this.workers[this.lastIndex];
};

/**
 * Default HTTP/WS handler (overridden).
 * By default, `up` distributes based on a round robin.
 *
 * @api private
 */

UpServer.prototype.defaultHTTP =
UpServer.prototype.defaultWS = function (req, res, next) {
  var sid = this.allocator(req, res);
  if(this.workers.length && sid !== null) {
    // transport = matcher[1], sid = matcher[2]
    if(typeof(sid) !== 'number') {
      var glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+_/';
      var result = 0;

      sid = sid.split('');
      for(var index = sid.length - 1; index >= 0; index--) {
        result = (result * 64) + glyphs.indexOf(sid[index]);
      }
      sid = result;
    }

    var workerIndex = sid % this.workers.length;
    next(this.workers[workerIndex].port);
  } else if (this.workers.length) {
    next(this.nextWorker().port);
  } else {
    var self = this;
    this.once('spawn', function () {
      next(self.nextWorker().port);
    });
  }
};

function PathAllocator(regex) {
  return function(req, res) {
    var matcher = req.url.match(regex);
    if(matcher && matcher.length > 1) return matcher[1];
    return null;
  }
}

function CookieAllocator(name) {
  return function(req, res) {
    var cookies = {};
    if(req.headers.cookie) cookies = cookie(req.headers.cookie);

    if(!cookies[name]) {
      var target = require('crypto').pseudoRandomBytes(2).toString('hex');
      res.setHeader('Set-Cookie', [name + '=' + target + '; Path=/; HttpOnly']);
      return target;
    } else {
      return cookies[name];
    }
  }
}

/**
 * Worker constructor.
 *
 * @api private
 */

function Worker (server) {
  this.server = server;
  this.readyState = 'spawning';

  var opts = JSON.stringify({
      file: server.file
    , requires: server.requires
    , assumeReady: server.assumeReady
    , pingInterval: server.workerPingInterval
    , title: server.title
  });

  this.proc = fork(__dirname + '/worker.js', [opts], { env: process.env });
  this.proc.on('message', this.onMessage.bind(this));
  this.proc.on('exit', this.onExit.bind(this));
  this.pid = this.proc.pid;
  this.birthtime = new Date().getTime();
  debug('worker %s created', this.pid);
}

/**
 * Inherits from EventEmitter.
 */

Worker.prototype.__proto__ = EventEmitter.prototype;

/**
 * Called upon worker exit.
 * Sudden exits will mean the worker won't go through `terminating` state
 *
 * @api private
 */

Worker.prototype.onExit = function () {
  debug('worker %s exited '
    + ('terminating' != this.readyState ? 'unexpectedly': ''), this.pid);
  this.readyState = 'terminated';
  this.emit('stateChange');
};

/**
 * Handles an incoming message from the worker.
 *
 * @api private
 */

Worker.prototype.onMessage = function (msg) {
  switch (msg.type) {
    case 'addr':
      // avoid spawns after SIGHUP was sent
      if ('spawning' == this.readyState) {
        debug('worker %s listening on port %s', this.pid, msg.addr.port);
        this.port = msg.addr.port;
        this.readyState = 'spawned';
        this.emit('stateChange');
      }
      break;
  }
};

/**
 * Shuts down a worker.
 *
 * @api private
 */

Worker.prototype.shutdown = function () {
  if ('spawned' == this.readyState) {
    var timeout = this.server.workerTimeout;
    debug('telling worker %s to exit in %dms', this.proc.pid, timeout);
    this.proc.send({ type: 'die', time: timeout });
    this.readyState = 'terminating';
    this.emit('stateChange');
  } else if ('spawning' == this.readyState) {
    debug('killing spawning worker %s', this.pid);
    switch (process.platform) {
      case 'win32':
        this.proc.kill();
        break;
      default:
        this.proc.kill('SIGHUP');
    }
    this.readyState = 'terminating';
    this.emit('stateChange');
  }
};

/**
 * Send ready signal from within a worker
 *
 * @api public
 */

exports.ready = function () {
  process.emit('message', { type: 'ready' });
};
