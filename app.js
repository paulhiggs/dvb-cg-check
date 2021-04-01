// node.js - https://nodejs.org/en/
// express framework - https://expressjs.com/en/4x/api.html
const express=require("express")

const fs=require("fs"), path=require("path")

// command line arguments - https://github.com/75lb/command-line-args
const commandLineArgs=require('command-line-args')

// favourite icon - https://www.npmjs.com/package/serve-favicon
const favicon=require("serve-favicon")

const fetch=require("node-fetch")

// morgan - https://github.com/expressjs/morgan
const morgan=require("morgan")

// express-fileupload - https://github.com/richardgirges/express-fileupload#readme
const fileUpload=require('express-fileupload')
	
const https=require("https")
const keyFilename=path.join(".", "selfsigned.key"), certFilename=path.join(".", "selfsigned.crt")

const phlib=require('./phlib/phlib')

const ErrorList=require("./dvb-common/ErrorList.js")

// the content guide validation
const cgCheck=require('./cg-check.js')


/**
 * constructs HTML output of the errors found in the content guide analysis
 *
 * @param {boolean} URLmode   if true ask for a URL to a content guide, if false ask for a file
 * @param {Object}  res       the Express result 
 * @param {string}  lastInput the url or file name previously used - used to keep the form intact
 * @param {string}  lastType  the previously request type - used to keep the form intact
 * @param {string}  error     a single error message to display on the form, generally related to loading the content to validate
 * @param {ErrorList}  errors    the errors and warnings found during the content guide validation
 */
 function drawForm(URLmode, res, lastInput=null, lastType=null, error=null, errors=null) {

	const TABLE_STYLE="<style>table {border-collapse: collapse;border: 1px solid black;} th, td {text-align: left; padding: 8px; }	tr:nth-child(even) {background-color: #f2f2f2;}	</style>"
	const FORM_TOP="<html><head>"+TABLE_STYLE+"<title>DVB-I Content Guide Validator</title></head><body>";
	const PAGE_HEADING="<h1>DVB-I Content Guide Validator</h1>";

	const ENTRY_FORM_URL=`<form method=\"post\"><p><i>URL:</i></p><input type=\"url\" name=\"CGurl\" value=\"${lastInput ? lastInput : ""}\"/><input type=\"submit\" value=\"submit\"/>`
	const ENTRY_FORM_FILE=`<form method=\"post\" encType=\"multipart/form-data\"><p><i>FILE:</i></p><input type=\"file\" name=\"CGfile\" value=\"${lastInput ? lastInput : ""}\"/><input type=\"submit\" value=\"submit\"/>`

	const ENTRY_FORM_REQUEST_TYPE_HEADER="<p><i>REQUEST TYPE:</i></p>";

	const ENTRY_FORM_REQUEST_TYPE_ID="requestType";

	const FORM_END="</form>";

	const RESULT_WITH_INSTRUCTION="<br><p><i>Results:</i></p>";
	const SUMMARY_FORM_HEADER="<table><tr><th>item</th><th>count</th></tr>";
	function DETAIL_FORM_HEADER(mode) {
		return `<table><tr><th>code</th><th>${mode}</th></tr>`
	}
	const FORM_BOTTOM="</body></html>";	

    res.write(FORM_TOP);    
    res.write(PAGE_HEADING);
    res.write(URLmode?ENTRY_FORM_URL:ENTRY_FORM_FILE)

	res.write(ENTRY_FORM_REQUEST_TYPE_HEADER);

	if (!lastType) lastType=cgCheck.supportedRequests[0].value;
	cgCheck.supportedRequests.forEach(choice => {
		res.write("<input type=\"radio\" name="+ENTRY_FORM_REQUEST_TYPE_ID.quote()+" value="+choice.value.quote());
		if (lastType==choice.value)
			res.write(" checked")
		res.write(">"+choice.label+"</input>")
	});
	res.write(FORM_END);
    res.write(RESULT_WITH_INSTRUCTION);
	if (error) 
		res.write("<p>"+error+"</p>");
	let resultsShown=false
	if (errors) {
		let tableHeader=false
		for (let i of errors.counts) {
			if (errors.counts[i]!=0) {
				if (!tableHeader) {
					res.write(SUMMARY_FORM_HEADER);
					tableHeader=true;
				}
				res.write("<tr><td>"+phlib.HTMLize(i)+"</td><td>"+errors.counts[i]+"</td></tr>");
				resultsShown=true;
			}
		}
		for (let i of errors.countsWarn) {
			if (errors.countsWarn[i]!=0) {
				if (!tableHeader) {
					res.write(SUMMARY_FORM_HEADER);
					tableHeader=true;
				}
				res.write("<tr><td><i>"+phlib.HTMLize(i)+"</i></td><td>"+errors.countsWarn[i]+"</td></tr>");
				resultsShown=true;
			}
		}
		if (tableHeader) res.write("</table><br/>");

		tableHeader=false;
		errors.messages.forEach(function(value) {
			if (!tableHeader) {
				res.write(DETAIL_FORM_HEADER("errors"))
				tableHeader=true;                    
			}
			if (value.includes(errors.delim)) {
				let x=value.split(errors.delim)
				res.write("<tr><td>"+phlib.HTMLize(x[0])+"</td><td>"+phlib.HTMLize(x[1])+"</td></tr>");	
			}
			else 
				res.write("<tr><td></td><td>"+phlib.HTMLize(value)+"</td></tr>")
			resultsShown=true;
		});
		if (tableHeader) res.write("</table><br/>");

		tableHeader=false;
		errors.messagesWarn.forEach(function(value)	{
			if (!tableHeader) {
				res.write(DETAIL_FORM_HEADER("warnings"))
				tableHeader=true;                    
			}
			if (value.includes(errors.delim)) {
				let x=value.split(errors.delim)
				res.write("<tr><td>"+x[0]+"</td><td>"+phlib.HTMLize(x[1])+"</td></tr>");	
			}
			else 
				res.write("<tr><td></td><td>"+phlib.HTMLize(value)+"</td></tr>")

			resultsShown=true;
		});
		if (tableHeader) res.write("</table>");        
	}
	if (!error && !resultsShown) res.write("no errors or warnings");

	res.write(FORM_BOTTOM)

	return new Promise((resolve, reject) => {
		resolve(res)
	})
}


/**
 * Synchronously reads a file (if it exists)
 * 
 * @param {String} filename 	The name of the file to read
 * @returns {Buffer} the buffer containing the data from the file, or null if there is a problem reading
 */
function readmyfile(filename) {
    try {
        let stats=fs.statSync(filename)
        if (stats.isFile()) return fs.readFileSync(filename); 
    }
    catch (err) {console.log(err.code, err.path)}
    return null;
}


/**
 * checks is an object has none of its own properties
 * 
 * @param {Object} obj 	The object to check 
 * @returns {Booolean} true if the object does not contain ant local properties
 */
function isEmpty(obj) {
    for(let key in obj) {
        if(obj.hasOwnProperty(key))
            return false;
    }
    return true;
}


/**
 * Process the content guide specificed for errors and display them
 *
 * @param {Object} req The request from Express
 * @param {Object} res The HTTP response to be sent to the client
 */ 
function processQuery(req, res) {
    if (isEmpty(req.query)) {
		drawForm(true, res)  
		res.end();
	}  
    else if (req && req.query && req.query.CGurl) {
		function handleErrors(response) {
			if (!response.ok) {
				throw Error(response.statusText)
			}
			return response
		}
		fetch(req.query.CGurl)
			.then(handleErrors)
			.then(response => response.text())
			.then(res => cgCheck.validateContentGuide(res.replace(/(\r\n|\n|\r|\t)/gm, ""), req.body.requestType))
			.then(errs => drawForm(true, res, req.query.CGurl, req.body.requestType, null, errs))
			.then(res => res.end())
			.catch(error => {
				drawForm(true, res, req.query.CGurl, req.body.requestType, `error (${error}) handling ${req.query.CGurl}`)
				res.status(400)
				res.end()
			})
    }
	else {
        drawForm(true, res, req.query.CGurl, req.body.requestType, "URL not specified")
        res.status(400)
		res.end()
	}
}


/**
 * Process the content guide specificed by a file name for errors and display them
 *
 * @param {Object} req The request from Express
 * @param {Object} res The HTTP response to be sent to the client
 */ 
function processFile(req, res) {
    if (isEmpty(req.query)) 
        drawForm(false, res);    
    else if (req && req.files && req.files.CGfile) {
        let CGxml=null, errs=new ErrorList(), fname="***"
		if (req && req.files && req.files.CGfile) fname=req.files.CGfile.name;
        try {
            CGxml=req.files.CGfile.data;
        }
        catch (err) {
            errs.pushCode("PF001", `retrieval of FILE ${fname} failed`)
        }
		if (CGxml) 
			cgCheck.doValidateContentGuide(CGxml.toString().replace(/(\r\n|\n|\r|\t)/gm, ""), req.body.requestType, errs);
		
        drawForm(false, res, fname, req.body.requestType, null, errs);
    }
	else {
        drawForm(false, res, req.files.CGfile.name, req.body.requestType, "File not specified")
        res.status(400)
	}
    res.end();
}


// command line options
const DEFAULT_HTTP_SERVICE_PORT=3020;
const optionDefinitions=[
  { name: 'urls', alias: 'u', type: Boolean, defaultValue: false},
  { name: 'port', alias: 'p', type: Number, defaultValue:DEFAULT_HTTP_SERVICE_PORT },
  { name: 'sport', alias: 's', type: Number, defaultValue:DEFAULT_HTTP_SERVICE_PORT+1 }
]
const options=commandLineArgs(optionDefinitions)

// read in the validation data
cgCheck.loadDataFiles(options.urls)

//middleware
morgan.token("protocol", function getProtocol(req) {
    return req.protocol;
});
morgan.token("parseErr", function getParseErr(req) {
    if (req.parseErr) return "("+req.parseErr+")";
    return "";
});
morgan.token("agent", function getAgent(req) {
    return "("+req.headers["user-agent"]+")";
});
morgan.token("cgLoc", function getCheckedLocation(req) {
	if (req.files && req.files.CGfile) return "["+req.files.CGfile.name+"]";
    if (req.query.CGurl) return "["+req.query.CGurl+"]";
	return "[*]";
});

var app=express();
app.use(morgan(":remote-addr :protocol :method :url :status :res[content-length] - :response-time ms :agent :parseErr :cgLoc"));

app.use(express.static(__dirname));
app.set('view engine', 'ejs');
app.use(fileUpload());

// initialize Express
app.use(express.urlencoded({ extended: true }));

app.use(favicon(path.join('phlib', 'ph-icon.ico')))

// handle HTTP POST requests to /check
app.post("/check", function(req, res) {
    req.query.CGurl=req.body.CGurl;
    processQuery(req, res);
});

// handle HTTP GET requests to /check
app.get("/check", function(req, res) {
    processQuery(req, res);
});

// handle HTTP POST requests to /checkFile
app.post("/checkFile", function(req, res) {
	req.query.CGfile=req.body.CGfile;
    processFile(req, res);
});

// handle HTTP GET requests to /checkFile
app.get("/checkFile", function(req, res) {
    processFile(req, res);
});

// dont handle any other requests
app.get("*", function(req, res) {
    res.status(404).end();
});


// start the HTTP server
var http_server=app.listen(options.port, function() {
    console.log(`HTTP listening on port number ${http_server.address().port}`);
});


// start the HTTPS server
// sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout ./selfsigned.key -out selfsigned.crt

var https_options={
    key:readmyfile(keyFilename),
    cert:readmyfile(certFilename)
};

if (https_options.key && https_options.cert) {
	if (options.sport==options.port)
		options.sport=options.port+1
		
    var https_server=https.createServer(https_options, app);
    https_server.listen(options.sport, function() {
        console.log(`HTTPS listening on port number ${https_server.address().port}` )
    });
}
