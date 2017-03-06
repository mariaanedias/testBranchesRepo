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
var devicesManager = require('../devicesManager');
var router = express.Router();
var basicAuth = require('basic-auth');
var appEnv = require("cfenv").getAppEnv();

var API_KEY = "b52f6b93-5b22-4e76-a765-b3c8ad7a72a8";
var API_TOKEN = "21b750f1-43ee-4c92-a11e-1a30ff503feb";	

var authenticate = function(req,res,next){
	function unauthorized(res) {
		res.set('WWW-Authenticate', 'Basic realm=Authorization Required');
		return res.status(401).end();
	};
	var user = basicAuth(req);
	if (!user || !user.name || !user.pass) {
		return unauthorized(res);
	};
	if (user.name === API_KEY && user.pass === API_TOKEN) {
		return next();
	} else {
		return unauthorized(res);
	};
};

router.all('/*', authenticate );

router.post('/startSimulation', function(req, res) {	
	if((!req.body.architecture || !req.body.simulation) && !req.body.simulationConfig)
		return res.status(400).send("bad params");
	
	var config = (req.body.simulationConfig) ? req.body.simulationConfig : devicesManager.getSimulationConfig(req.body.architecture, req.body.simulation);
	
	var manager = devicesManager.createDeviceManager(config);
	return res.send({wsurl: manager.wsurl, architectureRevision: manager.architectureRevision, simulationRevision: manager.simulationRevision, deviceStatus: manager.getAllDevicesStatus()});
});

router.get('/simulationStatus/:simulationID', function(req, res) {
	var manager = devicesManager.getDeviceManager(req.params.simulationID);
	if(!manager)
		return res.send({running : false});
	return res.send({running : true, wsurl: manager.wsurl, architectureRevision: manager.architectureRevision, simulationRevision: manager.simulationRevision, expirationDate: new Date(manager.expirationDate).toString(), deviceStatus: manager.getAllDevicesStatus()});
});

router['delete']('/terminateSimulation/:simulationID', function(req, res) {
	var manager = devicesManager.getDeviceManager(req.params.simulationID);
	if(!manager)
		return res.status(404).end();
	
	devicesManager.terminateSimualtion(req.params.simulationID);
	return res.send({terminated : true});
});

router.get('/listAll', function(req, res){
	var result = {};
	var managers = devicesManager.getAllDeviceManagers();

	for(var manager in managers){
		result[manager] = managers[manager].getAllDevicesStatus();
	}
	return res.send(result);
});

module.exports = router;