
/**
 * Module dependencies.
 */

var express = require('express')

/**
 * Initialize server
 */

var app = express();

/**
 * Default route.
 */

app.get('*', function (req, res) {
  res.send({ pid: process.pid, title: process.title });
});

/**
 * Exports.
 */

module.exports = app;
