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

var express = require('express');
var db = express.Router();
var Cloudant = require('cloudant');
var Q = require("q");
var queue = require('seq-queue').createQueue(30000);

// Switch to Standby database credentials if system is under a recovery scenario
if(process.env.RECOVERY && process.env.RECOVERY == "true"){
	if(process.env.standby_username && process.env.standby_password){
		var DB_URL = ['https://', process.env.standby_username, ':', process.env.standby_password, '@', process.env.standby_username, '.cloudant.com'].join('');
		var DB_NAME = process.env.standby_database ? process.env.standby_database : 'standby-simulation_config';
	} else {
		console.error('[ERROR]: The system is under a recovery scenario, but the Standby database credentials were not found. Please, make sure you have "standby_username" and "standby_password" as user-defined environment variables.');
	}
} else if(process.env.REMOTE_DB && process.env.REMOTE_DB == "true"){
	if(process.env.primary_username && process.env.primary_password){
		var DB_URL = ['https://', process.env.primary_username, ':', process.env.primary_password, '@', process.env.primary_username, '.cloudant.com'].join('');
		var DB_NAME = process.env.primary_database ? process.env.primary_database : 'simulation_config';
	} else {
		console.error('[ERROR]: The application is configured to connect with a remote Cloudant instance, but the credentials were not found. Please, make sure you have "primary_username" and "primary_password" as user-defined environment variables.');
	}
} else {
	var VCAP_SERVICES = JSON.parse(process.env.VCAP_SERVICES);
	var DB_URL = VCAP_SERVICES['cloudantNoSQLDB'][0]['credentials'].url;
	var DB_NAME = 'simulation_config';
}

function getDatabase(){
	var deferred = Q.defer();

	cloudant = Cloudant(DB_URL, function(err, cloudant){
	  var db = cloudant.db.use(DB_NAME);
	  cloudant.db.get(DB_NAME, function(err, body){
	    if(err){
	      cloudant.db.create(DB_NAME, function(err, body){
	        if(!err){
	        	deferred.resolve(db);
	        } else {
	        	throw new Error("Cannot connect to database:", DB_NAME);
	        }
	      });
	    } else {
	    	deferred.resolve(db);
	    }
	  });
	});

	return deferred.promise;
}

db.get('/loadDocument/:documentId', function(req, res){
	queue.push(function(task){
		getDatabase().then(function(db){
			db.get(req.params.documentId, function(err, result){
				if(err){
					task.done();
					return res.send({err: err});
				} else {
					task.done();
					return res.send({result: result});
				}
			});
		});
	});
});

db.post('/insertDocument/:documentId', function(req, res){
	var doc = req.body;
	queue.push(function(task){
		getDatabase().then(function(db){
			db.get(req.params.documentId, function(err, resp){
				if(err){
					db.insert(doc, req.params.documentId, function(err, body){
						if(err){
							task.done();
							return res.send({err: err});
						} else {
							task.done();
							return res.send({body: body});
						}
					});
				} else {
					doc._rev = resp._rev;
					db.insert(doc, req.params.documentId, function(err, body){
						if(err){
							task.done();
							return res.send({err: err});
						} else {
							task.done();
							return res.send({body: body});
						}
					});
				}
			});
		});
	});
});

db.post('/setDatabase', function (req, res){
	DB_NAME = req.body.db_name;
	getDatabase().then(function (db){
		db.info(function (err, body){
			res.json({
				"success": true,
				"database": body.db_name
			});
		});
	});
});


db.get('/getDatabase', function (req, res){
	getDatabase().then(function (db){
		db.info(function (err, body){
			res.json({
				"success": true,
				"host": cloudant.config.url.split('@')[1],
				"database": body.db_name
			});
		});
	});
});

module.exports = db;