
/**
 * Test dependencies
 */

var up = require('../lib/up')
  , http = require('http')
  , expect = require('expect.js')
  , request = require('superagent')
  , cookie = require('cookie').parse

/**
 * Suite.
 */

describe('sticky', function () {

  it('should make xhr-polling socketio workers sticky', function (done) {
    var httpServer = http.Server().listen(6009, onListen)
      , srv = up(httpServer, __dirname + '/server', { numWorkers: 2 })
      , url = 'http://localhost:6009/socket.io/1/xhr-polling/123?t=123';

    function onListen (err) {
      if (err) return done(err);
      srv.on('spawn', onSpawn(srv, url, function(res) { return res.body.pid; }, done));
    }
  });

  it('should make htmlfile socketio workers sticky', function (done) {
    var httpServer = http.Server().listen(6010, onListen)
      , srv = up(httpServer, __dirname + '/server', { numWorkers: 2 })
      , url = 'http://localhost:6009/socket.io/1/htmlfile/123?t=123';

    function onListen (err) {
      if (err) return done(err);
      srv.on('spawn', onSpawn(srv, url, function(res) { return res.body.pid; }, done));
    }
  });

  it('should make jsonp-polling socketio workers sticky', function (done) {
    var httpServer = http.Server().listen(6011, onListen)
      , srv = up(httpServer, __dirname + '/server', { numWorkers: 2 })
      , url = 'http://localhost:6009/socket.io/1/jsonp-polling/123?t=123';

    function onListen (err) {
      if (err) return done(err);
      srv.on('spawn', onSpawn(srv, url, function(res) { return res.body.pid; }, done));
    }
  });

  it('should make xhr-polling sockjs workers sticky', function (done) {
    var httpServer = http.Server().listen(6012, onListen)
      , srv = up(httpServer, __dirname + '/server', { numWorkers: 2, allocator: 'sockjs' })
      , url = 'http://localhost:6012/io/1/123/xhr_polling?t=123';

    function onListen (err) {
      if (err) return done(err);
      srv.on('spawn', onSpawn(srv, url, function(res) { return res.body.pid; }, done));
    }
  });

  it('should make custom allocator workers sticky', function (done) {
    var httpServer = http.Server().listen(6013, onListen)
      , srv = up(httpServer, __dirname + '/server', { numWorkers: 2, allocator: '^/server(\\d+)/.*' })
      , url = 'http://localhost:6013/server1/test';

    function onListen (err) {
      if (err) return done(err);
      srv.on('spawn', onSpawn(srv, url, function(res) { return res.body.pid; }, done));
    }
  });

  it('should make cookie allocators sticky', function(done) {
    var httpServer = http.Server().listen(6014, onListen)
      , srv = up(httpServer, __dirname + '/server', { numWorkers: 2, allocator: 'cookie' })
      , url = 'http://localhost:6014/';

    var agent = request.agent();

    function onListen (err) {
      if (err) return done(err);
      srv.on('spawn', onSpawn(srv, url, function(res) {
        return res.body.pid;
      }, done));
    }
  });

  function onSpawn (srv, url, pid, done) {
    return  function () {
      // count workers
      if (2 != srv.workers.length) return;

      request.get(url, function (res) {
        var pid1 = pid(res);
        expect(pid1).to.be.a('number');

        var sid = res.headers['set-cookie'].join('').match(/_up=(.{4})/);
        if(sid && sid.length > 1) sid = sid[1];
        else sid = null;

        request.get(url).set('cookie', '_up=' + sid).end(function (res) {
          var pid2 = pid(res);
          expect(pid2).to.be.a('number');
          expect(pid2).to.equal(pid1);

          request.get(url).set('cookie', '_up=' + sid).end(function (res) {
            var pid3 = pid(res);
            expect(pid3).to.be.a('number');
            expect(pid3).to.equal(pid1);

            request.get(url).set('cookie', '_up=' + sid).end(function (res) {
              var pid4 = pid(res);
              expect(pid4).to.be.a('number');
              expect(pid4).to.equal(pid1);
              
              request.get(url).set('cookie', '_up=' + sid).end(function (res) {
                var pid5 = pid(res);
                expect(pid5).to.be.a('number');
                expect(pid5).to.equal(pid1);

                request.get(url).set('cookie', '_up=' + sid).end(function (res) {
                  var pid6 = pid(res);
                  expect(pid6).to.be.a('number');
                  expect(pid6).to.equal(pid1);
                  done();
                });
              });
            });
          });
        });
      });
    }
  }

});
