# Up

Zero-downtime reloads built on top of the
[distribute](http://github.com/learnboost/distribute) load balancer.

Simply running

```bash
$ up --port 80 --watch my-http-server.js
```

Will start `my-http-server.js` on port 80, then reload it with no downtime
when files change in the working directory.

## Features

- Works with Node 0.6+
- Works at the HTTP request level. It never drops requests or destroys
  `Keep-Alive` sockets while reloading.
- Compatible with any HTTP server.
- Easy-to-use CLI interface for development with automatic reloading
  upon file changes.
- Gracefully handles reloads with syntax errors during development.
- Built on [distribute](http://github.com/learnboost/distribute).
- Supports transpilers such as CoffeeScript.
- Supports Socket.IO and SockJS (as well as other frameworks with session-unique URLs)

## Setup

Make sure you structure your code so that your `http` server lives in a
separate module that can be `require`d.

**server.js**

```js
module.exports = http.Server(function (req, res) {
  res.writeHead(200);
  res.end('Hello World');
});
```

### A) CLI

To get the `up` command, make sure to install with the `-g` flag:

```bash
$ npm install -g up
```

**Usage: up [options] <file>**

The `up` command accepts the following options:

- `-p`/`--port`

  - The port to listen on. Not required if the module already `listen`s.
  - Defaults to `3000`.

- `-w`/`--watch`

  - Whether to watch for changes.
  - Watches the working directory for changes.

- `-r`/`--require` `<mod>`

  - Specifies a module to require from each worker.
  - Can be used multiple times.
  - Tranpilers such as CoffeeScript can be supported with `--require|-r coffee-script`

- `-n`/`--number`

  - Number of workers. It gets evaluated with
    [eq.js](https://gist.github.com/1590954).
  - You can optionally use the `cpus` variable. eg: `cpus + 2`.
  - You can use all the `Math` methods. eg: `round(cpus / 2)`.
  - Defaults to number of CPUS, or `1` if `NODE_ENV` is `development`.

- `-t`/`--timeout`

  - Number of ms after which a worker is killed once it becomes inactive.
  - Strings like `'10s'` are accepted.
  - Defaults to `'10m'`, or `'500ms'` if `NODE_ENV` is `development`.

- `-k`/`--keepalive`

  - start a new worker after one dies unexpectedly

- `-f`/`--pidfile`

  - A filename to write the pid to
  - If specified, restarts can be achieved with: "kill -s SIGUSR2 `cat pidfile.txt`"

- `-T`/`--title`

  - A value to give `process.title`.
  - Defaults to `up`.
  - The value will be appended with `master` or `worker` (e.g "up master", "up worker").

- `-A`/`--allocator`

  - A choice between `socket.io`, `sockjs`, `cookie` or a `Regex`
  - Defaults to `cookie`
  - Regex values should have their first group contain the server specific ID, or session ID

### B) JavaScript API

```js
var up = require('up')
  , master = http.Server().listen(3000)

// initialize up
var srv = up(master, __dirname + '/server');

process.on('SIGUSR2', function () {
  srv.reload();
});
```

`require('up')` exports the `UpServer` constructor, which takes three
parameters:

- server (`http.Server`) server to accept connections on
- module (`String`) absolute path to the module.
- options (`Object`)
  - `numWorkers`: (`Number`|`String`): see `--workers` above.
  - `workerTimeout`: (`Number`|`String`): see `--timeout` above.
  - `title`: (`String`): see `--title` above.
  - `assumeReady`: (`Boolean`): see Worker readiness below.
  - `keepAlive`: (`Boolean`): see `--keepalive` above.
  - `minExpectedLifetime`: (`Number`|`String`): Number of ms a worker is
    expected to live. Don't auto-respawn if a worker dies earlier. Strings
    like `'10s'` are accepted. Defaults to `'20s'`.
  - `allocator` : (`String`|`RegExp`): Either one of [`socket.io`, `sockjs`]
    or a regex who's first group returns the server ID to direct the request
    to (just needs to be a fixed ID for that session).

## Middleware

An `UpServer` inherits from a `Distributor`, which means you can `use()`
any [distribute](http://github.com/learnboost/distribute) middleware.

The main difference is that the "default handler" of up (ie: the last
function in the middleware chain) is the one that executes the
round-robin load balancing.

## Reloading

To reload the workers, call `srv.reload()`. In the example above and CLI,
this is called by sending the `SIGUSR2` signal:

```bash
$ kill -s SIGUSR2 <process id>
```

If you're running with `up` CLI, this command is output to stderr for your
convenience.

The CLI tool also auto-reloads if you pass the `--watch` option and a file
changes in the working directory.

### Strategy

1. An up server starts with an arbitrary number of workers, which defaults
to the number of CPUs.
2. When a reload instruction is received, it spawns an identical number of
workers.
3. Upon the first of those workers binding to a port, any subsequent
**requests** are sent to that worker, and all the workers containing old
code are discarded.
4. The discarded workers could have been processing requests, so they only
truly die after the configured `workerTimeout`, which defaults to 10
minutes in production. This means that if a user was uploading a file, his
request will be processed without interruptions.
5. As other workers bind and become available, they join the round-robin
round.

### Worker readiness

By default up assume that new workers are ready for new connections,
immediately after they have been required. This can be changed by setting
`assumeReady` to `false`, on the `options` object when initializing
the up server through the JavaScript API.

The worker then needs to tell up, when it's ready, like this:
```js
var up = require('up');
// Dummy async event
setTimeout(function(){
	up.ready();
}, 1000);
```

### Request Allocation

In the interest of making `up` compatible with as many libraries and routing
strategies as possible - we've provided a means to change the fixed allocation
logic used by it. In most cases requests are allocated round-robbin style, but
in some situations it is necessary to ensure that certain requests always go
to the same server - for example, when using WebSockets.

To achieve this, simply specify the `--allocator` option and provide a Regular
Expression which selects (as its first matching group) the session or relative
server ID to route requests to.

```bash
$ up --allocator "^/server(\\d+)/.*" --port 80 my-http-server.js
```

There are a number of built-in allocators which can be referred to by name:

 - `socket.io` provides a Socket.IO compatible allocator.
 - `sockjs` provides an eager SockJS compatible allocator - we recommend you
   create your own for large scale systems.
 - `cookie` automatically assigns a session specific `_up` cookie which is used
   to provide request routing for that user for the duration of their session.
   It is compatible with `primus` and should work with any transport which passes
   cookies for requests.

```bash
$ up --allocator sockjs --port 80 my-http-server.js
```

## Credits

(The MIT License)

Copyright (c) 2011 Guillermo Rauch &lt;guillermo@learnboost.com&gt;

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
