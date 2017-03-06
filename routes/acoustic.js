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
var fs = require('fs');
var Q = require("q");
var request = require('request').defaults({jar: true});

var acoustic = express.Router();

acoustic.get('/getStatus', function (req, res){
	loginToAcousticService().then(function(){
		res.status(200).json({
			'running': true
		});
	}, function (error){
		res.status(200).json({
			'running': false,
			'reason': error
		});
	});
});

acoustic.post('/analyzeAudio', function (req, res){

	if(!req.body.filename){
		res.status(400).json({
			'error': true,
			'reason': 'The filename of the audio to be analyzed was not provided.'
		});
		return;
	}

	loginToAcousticService().then(function (){
		var filename = req.body.filename;
		postToAcousticService(filename).then(function (body){
			res.status(200).json(body);
		}, function (error){
			res.status(400).json({
				'error': true,
				'reason': error
			});
		});
	}, function (error){
		res.status(400).json({
			'error': true,
			'reason': error
		});
	});
});

function loginToAcousticService(){
	var deferred = Q.defer();

	request({
		method: 'POST',
		url: 'https://crl.ptopenlab.com:8800/iote_acoustic/v1/auth/login',
		form: {email: 'cgirani@br.ibm.com'}
	}, function (error, response, body){
		if(!error){
			if(response.statusCode == 200){
				deferred.resolve(body);
			} else {
				deferred.reject({
					'code': response.statusCode,
					'message': response.statusMessage
				});
			}
		} else {
			deferred.reject(error);
		}
	});

	return deferred.promise;
}

function postToAcousticService(filename){
	var deferred = Q.defer();

	var audioFile = fs.createReadStream('sounds/' + filename);

	audioFile.on('error', function (error){
		deferred.reject(error);
	});

	audioFile.on('readable', function(){
		request({
			method: 'POST',
			url: 'https://crl.ptopenlab.com:8800/iote_acoustic/v1/classification?classifier=MonitorWash',
			formData: {'sounds_files[]': audioFile}
		}, function (error, response, body){
			if(!error){
				if(response.statusCode == 200){
					deferred.resolve(body);
				} else {
					deferred.reject({
						'code': response.statusCode,
						'message': response.statusMessage
					});
				}
			} else {
				deferred.reject(error);
			}
		});
	});

	return deferred.promise;
}

module.exports = acoustic;