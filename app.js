/********************************************************* {COPYRIGHT-TOP} ***
* IBM Confidential
* OCO Source Materials
* IoT for Electronics - SVL720160500
*
* (C) Copyright IBM Corp. 2016  All Rights Reserved.
*
* The source code for this program is not published or otherwise
* divested of its trade secrets, irrespective of what has been
* deposited with the U.S. Copyright Office.
********************************************************* {COPYRIGHT-END} **/
require('events').EventEmitter.defaultMaxListeners = 100;

//process.env.STAGING = 1;

var cors = require('cors');
var express = require('express');
var path = require('path');
var _ = require("underscore");
var app = express();
module.exports = app;

var appEnv = require("cfenv").getAppEnv();
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var debug = require('debug')('virtualDevices:server');
var http = require('http');
var WebSocketServer = require('ws').Server
var routes = require('./routes/index');
var apiRouter = require('./routes/api');
var dbRouter = require('./routes/db');
var acousticRouter = require('./routes/acoustic');

dumpError = function(msg, err) {
	if (typeof err === 'object') {
		msg = (msg) ? msg : "";
		var message = "***********ERROR: " + msg + " *************\n";
		if (err.message) {
			message += '\nMessage: ' + err.message;
		}
		if (err.stack) {
			message += '\nStacktrace:\n';
			message += '====================\n';
			message += err.stack;
			message += '====================\n';
		}
		console.error(message);
	} else {
		console.error('dumpError :: argument is not an object');
	}
};


//view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(cors());
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(function (req, res, next) {
	res.set({
		'Cache-Control': 'no-store',
		'Pragma': 'no-cache'
	});
	//force https
	if(!appEnv.isLocal && req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] == 'http')
		res.redirect('https://' + req.headers.host + req.url);
	else
		next();
});

app.use('/', routes);
app.use('/api', apiRouter);
app.use('/api/db', dbRouter);
app.use('/api/acoustic', acousticRouter);

//catch 404 and forward to error handler
app.use(function(req, res, next) {
	var err = new Error('Not Found');
	err.status = 404;
	next(err);
});

//error handlers

//development error handler
//will print stacktrace
if (app.get('env') === 'development') {
	app.use(function(err, req, res, next) {
		dumpError(null, err);
		res.status(err.status || 500);
		res.render('error', {
			message: err.message,
			error: err
		});
	});
}

//production error handler
//no stacktraces leaked to user
app.use(function(err, req, res, next) {
	dumpError(null, err);
	res.status(err.status || 500);
	res.render('error', {
		message: err.message,
		error: {}
	});
});

/**
 * Get port from environment and store in Express.
 */

var port = normalizePort(appEnv.port || '3000');
app.set('port', port);

/**
 * Create HTTP server.
 */

var server = http.createServer(app);

/**
 * Listen on provided port, on all network interfaces.
 */

server.listen(port);
server.on('error', onError);
server.on('listening', onListening);

//set the server in the app object
app.server = server;
/**
 * Normalize a port into a number, string, or false.
 */

function normalizePort(val) {
	var port = parseInt(val, 10);

	if (isNaN(port)) {
		// named pipe
		return val;
	}

	if (port >= 0) {
		// port number
		return port;
	}

	return false;
}

/**
 * Event listener for HTTP server "error" event.
 */

function onError(error) {
	if (error.syscall !== 'listen') {
		throw error;
	}

	var bind = typeof port === 'string'
		? 'Pipe ' + port
				: 'Port ' + port;

	// handle specific listen errors with friendly messages
	switch (error.code) {
	case 'EACCES':
		console.error(bind + ' requires elevated privileges');
		process.exit(1);
		break;
	case 'EADDRINUSE':
		console.error(bind + ' is already in use');
		process.exit(1);
		break;
	default:
		throw error;
	}
}

/**
 * Event listener for HTTP server "listening" event.
 */

function onListening() {
	var addr = server.address();
	var bind = typeof addr === 'string'
		? 'pipe ' + addr
				: 'port ' + addr.port;
	debug('Listening on ' + bind);

	var devicesManager = require("./devicesManager");
//	web socket for index page
	var wss = new WebSocketServer({ server: app.server, path :  '/serverStatus'});
	wss.on('connection', function(ws) {
		var id = setInterval(function() {
			var stats = devicesManager.getStats();
			_.extend(stats, process.memoryUsage());
			ws.send(JSON.stringify(stats), function() { /* ignore errors */ });
		}, 5000);
		console.log('started server status client interval');
		ws.on('close', function() {
			console.log('stopping server status client interval');
			clearInterval(id);
		});
	});
}

process.on('uncaughtException', function(err){
	console.log('An error has occured.');
});
