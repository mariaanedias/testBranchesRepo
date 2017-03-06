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

module.exports = virtualDevice;
var ibmiotf = require("ibmiotf");
var _eval = require('eval');
var _ = require("underscore");

const nodeUtils = require('util');
const EventEmitter = require('events');

function virtualDevice(deviceModel, deviceInstance, sessionID, connect){
	// Initialize necessary properties from `EventEmitter` in this instance
	EventEmitter.call(this);

	this.resetDeviceArch(deviceModel);

	//device instance id
	this.deviceID = deviceInstance.deviceID;
	//device instance iotF credentials
	var iotFOrg = (deviceInstance.iotFCredentials.org) ? deviceInstance.iotFCredentials.org : deviceInstance.iotFCredentials.uuid.split(":")[1];
	var domain = process.env.STAGING == 1 ? "staging.internetofthings.ibmcloud.com" : "internetofthings.ibmcloud.com";

	this.creds = {
			"org" : iotFOrg,
			"id" : this.deviceID,
			"type" : this.deviceType,
			"domain": domain,
			"auth-method" : "token",
			"auth-token" : deviceInstance.iotFCredentials.password
	};
	//set last attributes values from last run
	_.each(deviceInstance.lastRunAttributesValues, function(runVal){
		if(!_.isUndefined(runVal.value))
			this[runVal.name] = runVal.value;
	},this);

	//create iotf device client
	this.deviceClient =  new ibmiotf.IotfManagedDevice(this.creds);
	//setup iotf client callbacks
	this.deviceClient.on("connect", _.bind(this.onConnected, this));
	this.deviceClient.on("disconnect", _.bind(this.onDisconnect, this));
	this.deviceClient.on("command", _.bind(this.onCommand, this));
	this.deviceClient.on("dmAction", _.bind(this.onDmAction, this));
	this.deviceClient.on("firmwareDownload", _.bind(this.onFirmwareDownload, this));
	this.deviceClient.on("firmwareUpdate", _.bind(this.onFirmwareUpdate, this));
	this.deviceClient.on("error", _.bind(this.onError, this));

	Object.observe(this, _.bind(this.onPropertyChange, this))
	//done init - run on init behavior code
	this.onInit();

	//start Periodic actions
	this.startPeriodicAction();

	//if was connected then connect
	if(deviceInstance.connected || connect)
		this.connect();
};

//Inherit functions from `EventEmitter`'s prototype
nodeUtils.inherits(virtualDevice, EventEmitter);

virtualDevice.prototype.resetDeviceArch = function(deviceModel){
	//rest old arch
	//delete attributes
	if(this.deviceAttributes){
		_.each(this.deviceAttributes, function(attrName){
			delete this[attrName];
		}, this);
	}
	//delete old send functions
	if(this.mqttOutputs){
		_.each(this.mqttOutputs, function(mqttOutput){
			delete this['send' + mqttOutput.name + 'Message'];
		}, this);
	}
	//remove cached user code
	//? needs to be done ? delete virtualDevice.prototype.behaviorCodeCache[deviceModel.guid];

	//device type
	this.deviceType = deviceModel.name;
	this.archDeviceGuid = deviceModel.guid;
	//keep the device model attributes
	this.deviceAttributes = _.indexBy(deviceModel.attributes, "name");
	//create same attributes on this device and init with default value
	_.each(deviceModel.attributes, function(attribute){
		var defaultValue;
		if(attribute.dataType == 'Number') {
			defaultValue = 0;
		} else if(attribute.dataType == 'Boolean') {
			defaultValue = false;
		} else {
			defaultValue = "";
		}

		if(attribute.dataType != 'Number' && attribute.dataType != 'Boolean'){
			if(attribute.defaultValue && attribute.defaultValue.trim() != '')
				defaultValue = attribute.defaultValue.trim();
		} else {
			if(attribute.defaultValue)
				defaultValue = attribute.defaultValue;
		}

		this[attribute.name] = defaultValue;

	}, this);


	//device inputs
	this.mqttInputs = {};
	_.each(deviceModel.mqttInputs,
			function(mqttInput){
		var deviceInput = {
				name: mqttInput.name,
				patternType : mqttInput.pattern.type,
				patternRate : mqttInput.pattern.rate,
				qos : mqttInput.qos,
				payload : (mqttInput.payload) ? mqttInput.payload.split(',') : []
		};
		this.mqttInputs[mqttInput.name] = deviceInput;
	}, this);

	//device outputs
	this.mqttOutputs = {};
	//map of attributes to messages the are sent on attribute change
	this.onChangeAttr2MsgMap = {};
	_.each(deviceModel.mqttOutputs,
			function(mqttOutput){
		var deviceOutput = {
				name: mqttOutput.name,
				patternType : mqttOutput.pattern.type,
				patternRate : mqttOutput.pattern.rate,
				qos : mqttOutput.qos,
				payload : (mqttOutput.payload) ? mqttOutput.payload.split(',') : []
		};


		//create send<message name>Message function
		this['send' + mqttOutput.name + 'Message'] = _.wrap(_.bind(this.sendMessage, this), function(func) {
			return func(mqttOutput.name);
		});

		//cache attributes that trigger a message on change
		if(deviceOutput.patternType == "OnChange"){
			_.each(deviceOutput.payload, function(attName){
				this.onChangeAttr2MsgMap[attName] = (this.onChangeAttr2MsgMap[attName]) ? this.onChangeAttr2MsgMap[attName] : [];
				this.onChangeAttr2MsgMap[attName].push(deviceOutput.name);
			},this)
		}
		this.mqttOutputs[mqttOutput.name] = deviceOutput;
	}, this);


	//device behavior code
	_.extend(this, deviceModel.simulation);

};

virtualDevice.prototype.isConnected = function(){
	return this.deviceClient.isConnected;
};

virtualDevice.prototype.destroy = function(){
	clearInterval(this.setIntervalId);
	this.stopPeriodicAction();
	this.stopPeriodicMessages();
	this.disconnect();
	this.removeAllListeners("attributesChange");
	this.removeAllListeners("connected");
	this.removeAllListeners("disconnected");
	this.removeAllListeners("dmAction");
	this.removeAllListeners("firmwareDownload");
	this.removeAllListeners("firmwareUpdate");
	this.removeAllListeners("connectionError");
	this.removeAllListeners("behaviorRuntimeError");
	this.removeAllListeners("behaviorCodeError");
};

virtualDevice.prototype.onPropertyChange = function(changes){
	//collect device attributes modifications
	var changedAttributesValueMap = {};
	//collect messages that are triggered from this change
	var messages2Send = [];

	_.each(changes, function(change){
		if(this.onChangeAttr2MsgMap[change.name])//if the change is in attribute that triggeres an on change message
			messages2Send = messages2Send.concat(messages2Send, this.onChangeAttr2MsgMap[change.name]);//add messages to send

		if(this.deviceAttributes[change.name] && changedAttributesValueMap[change.name] == undefined)
			changedAttributesValueMap[change.name] = this[change.name];
	}, this);


	messages2Send = _.uniq(messages2Send);	//remove duplicates
	_.each(messages2Send, function(msgName){
		this.sendMessage(msgName);		//send message
	}, this);


	if(!_.isEmpty(changedAttributesValueMap))
		this.emit("attributesChange", this, changedAttributesValueMap);
}

virtualDevice.prototype.onInit = function(){
	if(this.onInitCode)
		this.runBehaviorCode(this.onInitCode, "onInit");
};

virtualDevice.prototype.sendMessage = function(msgName){
	if(!this.isConnected()){
		console.error("disconnected: cannot send message");
		return;
	}
	var outputMsg = this.mqttOutputs[msgName];
	if(!outputMsg){
		console.error("Unknown message: " + msgName);
		return;
	}
	var payload = {};
	_.each(outputMsg.payload, function(attrName){
		if(!this[attrName] == undefined) {
			console.error("no such attribute " + attrName + " used as payload in message " + msgName);
		}
		else
			payload[attrName] = this[attrName];

	},this)

	payload = JSON.stringify(payload);
	this.deviceClient.publish(outputMsg.name, "json",'{"d" : ' + payload + '}', parseInt(outputMsg.qos));


};

virtualDevice.prototype.startPeriodicAction = function(){
	if(this.periodActionIntervalId)
		return;//already running
	if(this.onRunningCode){
		var _this = this;
		this.onRunningPeriodSec = (this.onRunningPeriodSec) ? this.onRunningPeriodSec : 1;
		this.periodActionIntervalId = setInterval(function() {
			_this.runBehaviorCode(_this.onRunningCode, "While Running");
		}, this.onRunningPeriodSec * 1000);
	}
};

virtualDevice.prototype.stopPeriodicAction = function(){
	if(this.periodActionIntervalId){
		clearInterval(this.periodActionIntervalId);
		this.periodActionIntervalId = null;
	}
};

virtualDevice.prototype.startPeriodicMessages = function(){
	if(this.periodicMessagesIntervals)
		return;//already running
	this.periodicMessagesIntervals = [];
	var _this = this;
	_.each(this.mqttOutputs, function(outPutMsg){
		if(outPutMsg.patternType == 'Periodic'){
			var rate = (outPutMsg.patternRate) ? outPutMsg.patternRate : 1;
			var intervalID = setInterval(function(){
				_this.sendMessage(outPutMsg.name);
			}, rate * 1000);
			this.periodicMessagesIntervals.push(intervalID);
		}
	}, this);
};

virtualDevice.prototype.stopPeriodicMessages = function(){
	_.each(this.periodicMessagesIntervals, function(intervalID){
		clearInterval(intervalID);
	});
	this.periodicMessagesIntervals = null;
};

virtualDevice.prototype.connect = function(){
	try {
		this.deviceClient.connect();
	} catch (e) {
		this.dumpError("error on connect", e);
	}
};

virtualDevice.prototype.disconnect = function(){
	try {
		this.deviceClient.disconnect();
	} catch (e) {
		if(e.message.indexOf("Client is not connected") != -1){
			console.log("already disconnected");
		} else {
			this.dumpError("error on disconnect", e);
		}
	}
};

virtualDevice.prototype.onConnected = function(){
	this.deviceClient.manage(4000, true, true);
	this.emit("connected", this);
	if(this.onConnectedCode)
		this.runBehaviorCode(this.onConnectedCode, "onConnected");
	this.startPeriodicMessages();
};

virtualDevice.prototype.onDisconnect = function(){
	this.emit("disconnected", this);
	this.stopPeriodicMessages();
};

virtualDevice.prototype.onCommand = function(commandName,format,payload,topic){
	this.emit("deviceCommand", this);
	if(this.onMessageReceptionCode)
		this.runBehaviorCode(this.onMessageReceptionCode, "onMessageReception", {message: commandName, payload: payload, topic: topic});
};

virtualDevice.prototype.onDmAction = function(request){
	this.emit("dmAction", this, request.action);
	var deviceClient = this.deviceClient;
	var _this = this;
	if(deviceClient.isRebootAction(request)) {
		try {
			//process.reboot(1);
			deviceClient.respondDeviceAction(request,deviceClient.RESPONSECODE.ACCEPTED);
			setTimeout(function(){
				_this.disconnect();
				setTimeout(function(){
					_this.connect();
				}, 3000);
			}, 3000);
		} catch(e) {
			deviceClient.respondDeviceAction(request,deviceClient.RESPONSECODE.INTERNAL_ERROR,"Cannot do reboot now : "+e);
		}
	} else if(deviceClient.isFactoryResetAction(request)) {
		try {
			//process.fact_reset(1);
			deviceClient.respondDeviceAction(request,deviceClient.RESPONSECODE.ACCEPTED);
			setTimeout(function(){
				_this.disconnect();
				setTimeout(function(){
					_this.connect();
				}, 3000);
			}, 3000);
		} catch(e) {
			deviceClient.respondDeviceAction(request,deviceClient.RESPONSECODE.INTERNAL_ERROR,"Cannot do factory reset now : "+e);
		}
	}
};

virtualDevice.prototype.onFirmwareDownload = function(request){
	this.emit("firmwareDownload", this);
	var deviceClient = this.deviceClient;
	deviceClient.changeState(deviceClient.FIRMWARESTATE.DOWNLOADING);
	// Download the firmware
	setTimeout(function(){
		deviceClient.changeState(deviceClient.FIRMWARESTATE.DOWNLOADED);
	}, 5000);
};

virtualDevice.prototype.onFirmwareUpdate = function(request){
	this.emit("firmwareUpdate", this);
	var deviceClient = this.deviceClient;
	deviceClient.changeUpdateState(deviceClient.FIRMWAREUPDATESTATE.IN_PROGRESS);
	//Update the firmware
	setTimeout(function(){
		deviceClient.changeUpdateState(deviceClient.FIRMWAREUPDATESTATE.SUCCESS);
		deviceClient.changeState(deviceClient.FIRMWARESTATE.IDLE);
	}, 5000);
};

virtualDevice.prototype.onError = function(err){
	this.emit("connectionError", this, err);

	if(err.message.indexOf("Connection refused") == -1 && err.message.indexOf("Iotfclient is offline") == -1){
		this.dumpError("error in iotF client " , err);
	}
};

virtualDevice.prototype.runBehaviorCode = function(code, hookName, args){
	var argsNames = "";
	var argsValues = [];
	if(args){
		argsNames = _.keys(args).toString();
		argsValues = _.values(args);
	}
	var behaviorFunc = this.getBehaviorCodeFunction(argsNames, code, (hookName) ? hookName : "");
	if(behaviorFunc){
		try{
			behaviorFunc.apply(this, argsValues);
		}
		catch (e) {
			this.emit("behaviorRuntimeError", this, e, hookName);
			this.dumpError("error while running  behavior code at " + hookName , e);
		}
	}
};

virtualDevice.prototype.behaviorCodeCache = {};

virtualDevice.prototype.getBehaviorCodeFunction = function(argsNames, code, hookName){
	var cache = virtualDevice.prototype.behaviorCodeCache[this.archDeviceGuid];
	if(cache && cache[argsNames + code + hookName]){
		if(cache[argsNames + code + hookName] == "INVALID")
			return null;
		else
			return cache[argsNames + code + hookName]; //use cached function
	}

	//create new function
	var scope = {console: console, _ : _};
	try{
		var wrappingFunction = _eval("module.exports = function("+ argsNames +"){" + code  + "}", scope, true);
		//cache the function
		cache = (cache) ? cache : {};
		cache[argsNames + code + hookName] = wrappingFunction;
		virtualDevice.prototype.behaviorCodeCache[this.archDeviceGuid] = cache;

		return wrappingFunction;
	}
	catch (e) {
		cache = (cache) ? cache : {};
		cache[argsNames + code + hookName] = "INVALID";
		this.emit("behaviorCodeError", this, e, hookName);
		this.dumpError("error evaluating behavior code at " + hookName + " code: " + code , e);
		virtualDevice.prototype.behaviorCodeCache[this.archDeviceGuid] = cache;
		return null;
	}
}

virtualDevice.prototype.dumpError = function(msg, err) {
	msg = (msg)? msg : "";
	msg = "in device " + this.deviceType + " id:" + this.deviceID + " message: " + msg;
	dumpError(msg,err);
};
