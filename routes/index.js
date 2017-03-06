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
var router = express.Router();
var appEnv = require("cfenv").getAppEnv();
var sendgrid = require('sendgrid')('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');
var helper = require('sendgrid').mail;

/* Prevent error from favicon. */
router.get('/favicon.ico', function(req, res) {
    res.send(200);
});

/* GET home page. */
router.get('/', function(req, res) {
	var protocol = (appEnv.isLocal) ? 'ws://' : 'wss://';
	var address = (appEnv.isLocal) ? appEnv.bind +  ':' + appEnv.port : appEnv.url.split("://")[1]; 
	var wsurl =  protocol + address + '/serverStatus';
	res.render('index', { wsurl: wsurl });
});

router.post('/contact', function(req, res){
	var body = JSON.parse(JSON.stringify(req.body));

	var country = body['country'];
	var firstName = body['firstName'];
	var lastName = body['lastName'];
	var email = body['email'];
	var phone = body['phone'];
	var company = body['company'];
	var message = body['interest'];

	var mailBody = '';

	mailBody  = ['<strong>', 'Country:', '</strong> ', country].join('');
	mailBody += ['<br>', '<strong>', 'First Name:', '</strong> ', firstName].join('');
	mailBody += ['<br>', '<strong>', 'Last Name:', '</strong> ', lastName].join('');
	mailBody += ['<br>', '<strong>', 'E-mail:', '</strong> ', email].join('');
	mailBody += ['<br>', '<strong>', 'Phone:', '</strong> ', phone].join('');
	mailBody += ['<br>', '<strong>', 'Company:', '</strong> ', company].join('');

	if(message != undefined && message != null && message != "")
		mailBody += ['<br>', '<br>', '<strong>', 'Message:', '</strong> ', escapeHtml(message)].join('');
		
	var from_email = new helper.Email(email);
	var to_email = new helper.Email('alexisrs@br.ibm.com');
	var subject = 'IoT for Electronics Contact Form';
	var content = new helper.Content('text/html', mailBody);
	var mail = new helper.Mail(from_email, subject, to_email, content);

	var request = sendgrid.emptyRequest({
	  method: 'POST',
	  path: '/v3/mail/send',
	  body: mail.toJSON(),
	});
	 
	sendgrid.API(request, function(error, response){
	  if(!error){
	  	res.send();
	  } else {
	  	res.status(500).send(error);
	  }
	});
});

/*
---------------- UTIL FUNCTIONS ----------------
*/

function escapeHtml(s) {
	return s
	.replace(/&/g, "&amp;")
	.replace(/</g, "&lt;")
	.replace(/>/g, "&gt;")
	.replace(/"/g, "&quot;")
	.replace(/'/g, "&#039;");
}

module.exports = router;
