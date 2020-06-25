// node.js - https://nodejs.org/en/
// express framework - https://expressjs.com/en/4x/api.html
const express=require("express");
var app=express();


const fs=require("fs"), path=require("path");

const ErrorList=require("./dvb-common/ErrorList.js");
const dvbi=require("./dvb-common/DVB-I_definitions.js");
const tva=require("../dvb-common/TVA_definitions.js");

const {isJPEGmime, isPNGmime}=require("./dvb-common/MIME_checks.js");
const {isCRIDURI, isTAGURI}=require("./dvb-common/URI_checks.js");
const {loadCS}=require("./dvb-common/CS_handler.js");

const ISOcountries=require("./dvb-common/ISOcountries.js");
const IANAlanguages=require("./dvb-common/IANAlanguages.js");

// libxmljs - https://github.com/libxmljs/libxmljs
const libxml=require("libxmljs");

//TODO: validation against schema
//const xmllint=require("xmllint");

// morgan - https://github.com/expressjs/morgan
const morgan=require("morgan")


// sync-request - https://github.com/ForbesLindesay/sync-request
const syncRequest=require("sync-request");

const https=require("https");
const HTTP_SERVICE_PORT=3020;
const HTTPS_SERVICE_PORT=HTTP_SERVICE_PORT+1;
const keyFilename=path.join(".","selfsigned.key"), certFilename=path.join(".","selfsigned.crt");

const { parse }=require("querystring");

// https://github.com/alexei/sprintf.js
var sprintf=require("sprintf-js").sprintf,
    vsprintf=require("sprintf-js").vsprintf


// convenience/readability values
const DEFAULT_LANGUAGE="***";

const CG_REQUEST_SCHEDULE_TIME="Time";
const CG_REQUEST_SCHEDULE_NOWNEXT="NowNext";
const CG_REQUEST_SCHEDULE_WINDOW="Window";
const CG_REQUEST_PROGRAM="ProgInfo";
const CG_REQUEST_MORE_EPISODES="MoreEpisodes";
const CG_REQUEST_BS_CATEGORIES="bsCategories";
const CG_REQUEST_BS_LISTS="bsLists";
const CG_REQUEST_BS_CONTENTS="bsContents";

const MAX_UNSIGNED_SHORT=65535;

const TVA_ContentCSFilename=path.join("dvb-common/tva","ContentCS.xml"),
      TVA_FormatCSFilename=path.join("dvb-common/tva","FormatCS.xml"),
      DVBI_ContentSubjectFilename=path.join("dvb-common/dvbi","DVBContentSubjectCS-2019.xml"),
	  DVBI_CreditsItemRolesFilename=path.join(".","CreditsItem@role-values.txt"),
	  DVBIv2_CreditsItemRolesFilename=path.join(".","CreditsItem@role-values-v2.txt");

const REPO_RAW="https://raw.githubusercontent.com/paulhiggs/dvb-cg-check/master/",
      COMMON_REPO_RAW="https://raw.githubusercontent.com/paulhiggs/dvb-common/master/",
      TVA_ContentCSURL=COMMON_REPO_RAW + "tva/" + "ContentCS.xml",
      TVA_FormatCSURL=COMMON_REPO_RAW + "tva/" + "FormatCS.xml",
      DVBI_ContentSubjectURL=COMMON_REPO_RAW + "dvbi/" + "DVBContentSubjectCS-2019.xml",
	  DVBI_CreditsItemRolesURL=REPO_RAW+"CreditsItem@role-values.txt",
	  DVBIv2_CreditsItemRolesURL=REPO_RAW+"CreditsItem@role-values-v2.txt";

const ISO3166_URL=COMMON_REPO_RAW + "iso3166-countries.json",
	  ISO3166_Filename=path.join("dvb-common","iso3166-countries.json");
      

// curl from https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry
const IANA_Subtag_Registry_Filename=path.join("./dvb-common","language-subtag-registry"),
      IANA_Subtag_Registry_URL="https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry";

var allowedGenres=[], allowedCreditItemRoles=[];
var knownCountries=new ISOcountries(false, true);
var knownLanguages=new IANAlanguages();

morgan.token("protocol", function getProtocol(req) {
    return req.protocol;
});
morgan.token("parseErr",function getParseErr(req) {
    if (req.parseErr) return "("+req.parseErr+")";
    return "";
});
morgan.token("agent",function getAgent(req) {
    return "("+req.headers["user-agent"]+")";
});
morgan.token("cgLoc",function getCheckedLocation(req) {
	if (req.files && req.files.CGfile) return "["+req.files.CGfile.name+"]";
    if (req.query.CGurl) return "["+req.query.CGurl+"]";
	return "[*]";
});


app.use(morgan(":remote-addr :protocol :method :url :status :res[content-length] - :response-time ms :agent :parseErr :cgLoc"));

/**
 * determines if a value is in a set of values - simular to 
 *
 * @param {String or Array} values The set of values to check existance in
 * @param {String} value The value to check for existance
 * @return {boolean} if value is in the set of values
 */
function isIn(values, value){
    if (typeof(values)=="string")
        return values==value;
    
    if (typeof(values)=="object") {
        for (var x=0; x<values.length; x++) 
            if (values[x]==value)
                return true;
    }
    return false;
}

/*
 * replace ENTITY strings with a generic characterSet
 *
 * @param {string} str string containing HTML or XML entities (starts with & ends with ;)
 * @return {string} the string with entities replaced with a single character '*'
 */
function unEntity(str) {
	return str.replace(/(&.+;)/ig,"*");
}

/* 
 * convert characters in the string to HTML entities
 *
 * @param {string} str that should be displayed in HTML
 * @return {string} a string with ENTITY representations of < and >
 */
function HTMLize(str) {
	return str.replace(/</g,"&lt;").replace(/>/g,"&gt;");              
}


function CheckLanguage(validator, errs, lang, loc=null, errno=null ) {
	if (!validator) {
		errs.pushCode(errno?errno+"-1":"LA001", "cannot validate language \""+lang+"\""+(loc?" for \""+loc+"\"":""));
		return false;
	}
	if (!validator.isKnown(lang))  {
		errs.pushCode(errno?errno+"-2":"LA002", "language \""+lang+"\" specified"+(loc?" for \""+loc+"\"":"")+" is invalid");	
		return false;
	}
	return true;
}

/**
 * validate the language specified record any errors
 *
 * @param {object} validator  the validation class to use
 * @param {Class}  errs       errors found in validaton
 * @param {Object} node       the XML node whose @lang attribute should be checked
 * @param {string} parentLang the language of the XML element which is the parent of node
 * @returns {string} the @lang attribute of the node element of the parentLang if it does not exist of is not specified
 */
function GetLanguage(validator, errs, node, parentLang, isRequired, errno=null) {
	if (!node) 
		return parentLang;
	if (!node.attr('lang') && isRequired) {
		errs.pushCode(errno?errno:"AC001", "@lang is required for \""+node.name()+"\"");
		return parentLang;		
	}

	if (!node.attr('lang'))
		return parentLang;
	
	var localLang=node.attr('lang').value();
	CheckLanguage(validator, errs, localLang, node.name(), errno);
	return localLang;
}

 
//---------------- CreditsItem@role LOADING ----------------

if(typeof(String.prototype.trim)==="undefined")
{
    String.prototype.trim=function() 
    {
        return String(this).replace(/^\s+|\s+$/g, '');
    };
}

/**
 * add the seperate lines from the buffer into the array 
 *
 * @param {Array} values  the linear list of values 
 * @param {String} data   the list of values, 1 per line
 */
function addRoles(values, data) {
	var lines=data.split('\n');
	for (var line=0; line<lines.length; line++) 
		values.push(lines[line].trim());	
}

/**
 * read the list of valid roles from a file 
 *
 * @param {Array} values         the linear list of values 
 * @param {String} rolesFilename the filename to load
 */
function loadRolesFromFile(values, rolesFilename) {
	console.log("reading Roles from", rolesFilename);
    fs.readFile(rolesFilename, {encoding: "utf-8"}, function(err,data){
        if (!err) 
			addRoles(values, data);
        else 
            console.log(err);
    });
}

/**
 * read the list of valid roles from a network location referenced by a REL  
 *
 * @param {Array} values 	The linear list of values
 * @param {String} rolesURL URL to the load
 */
function loadRolesFromURL(values, rolesURL) { 
	console.log("retrieving Roles from", rolesURL);
	var xhttp=new XmlHttpRequest();
	xhttp.onreadystatechange=function() {
		if (this.readyState==4) {
			if (this.status==200) 
				addRoles(values, xhttp.responseText);
			else console.log("error ("+this.status+") retrieving "+csURL);	
		}
	};
	xhttp.open("GET", csURL, true);
	xhttp.send();
} 

/**
 * loads role values from either a local file or an URL based location
 *
 * @param {Array} values        The linear list of values within the classification scheme
 * @param {boolean} useURL      if true use the URL loading method else use the local file
 * @param {String} roleFilename the filename of the classification scheme
 * @param {String} roleURL      URL to the classification scheme
 * 
 */ 
function loadRoles(values, useURL, roleFilename, roleURL) {
	if (useURL)
		loadRolesFromURL(values,roleURL);
	else loadRolesFromFile(values, roleFilename);	
} 
//----------------------------------------------------------



function isEmpty(obj) {
    for(var key in obj) {
        if(obj.hasOwnProperty(key))
            return false;
    }
    return true;
}


/**
 * checks if the argument complies to the TV Anytime defintion of RatioType
 *
 * @param {string}     str string contining value to check
 * @returns {boolean}  true if the argment is compliant to a tva:RatioType
 */
function isRatioType(str) {
	// <pattern value="\d+:\d+"/>
	const ratioRegex=/^\d+:\d+$/;
	var s=str.match(ratioRegex);
	return s?s[0]===str:false;
}


/**
 * converts a decimal representation of a string to a number
 *
 * @param {string} str    string contining the decimal value
 * @returns {integer}     the decimal representation of the string, or 0 is non-digits are included
 */
function valUnsignedInt(str) {
	var intRegex=/[\d]+/g;
	var s=str.match(intRegex);
	return s[0]===str?parseInt(str, 10):0;
}

/**
 * checks if the argument complies to an XML representation of UTC time
 *
 * @param {string} str string contining the UTC time
 * @returns {boolean}  true if the argment is formatted according to UTC ("Zulu") time
 */ /*
function isUTCTime(str) {
	//	<pattern value="(([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?|(24:00:00(\.0+)?))Z"/>
	const UTCregex=/(([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?|(24:00:00(\.0+)?))Z/g;
	var s=str.match(UTCregex);
	return s?s[0]===str:false;
} */

/**
 * checks if the argument complies to an XML representation of UTC time
 *
 * @param {string} str string contining the UTC time
 * @returns {boolean}  true if the argment is formatted according to UTC ("Zulu") time
 */
function isUTCDateTime(str) {
	const UTCregex=/^[\d]{4}-((0[1-9])|(1[0-2]))-((0[1-9])|1\d|2\d|(3[0-1]))T(([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?|(24:00:00(\.0+)?))Z$/;
	var s=str.match(UTCregex);
	return s?s[0]===str:false;
}

/**
 * checks if the argument complies to an XML representation of UTC time
 *
 * @param {string} duration string contining the UTC time
 * @returns {boolean}  true if the argment is formatted according to UTC ("Zulu") time
 */
function isISODuration(duration) {
	const isoRegex = /^(-|\+)?P(?:([-+]?[0-9,.]*)Y)?(?:([-+]?[0-9,.]*)M)?(?:([-+]?[0-9,.]*)W)?(?:([-+]?[0-9,.]*)D)?(?:T(?:([-+]?[0-9,.]*)H)?(?:([-+]?[0-9,.]*)M)?(?:([-+]?[0-9,.]*)S)?)?$/;
	var s=duration.match(isoRegex);
	return s?s[0]===duration:false;
}
 
 
// credit to https://gist.github.com/adriengibrat/e0b6d16cdd8c584392d8#file-parseduration-es5-js
function parseISOduration(duration) {
	var durationRegex = /^(-)?P(?:(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?|(\d+)W)$/;
	var parsed;
	duration && duration.replace(durationRegex, function (_, sign, year, month, day, hour, minute, second, week) {
		sign = sign ? -1 : 1;
		// parse number for each unit
		var units = [year, month, day, hour, minute, second, week].map(function (num) { return parseInt(num, 10) * sign || 0; });
		parsed = {year: units[0], month: units[1], week: units[6], day: units[2], hour: units[3], minute: units[4], second: units[5]};
	});
	// no regexp match
	if (!parsed) { throw new Error('Invalid duration "' + duration + '"'); }
	/**
	 * Sum or substract parsed duration to date
	 *
	 * @param {Date} date: A valid date instance
	 * @throws {TypeError} When date is not valid
	 * @returns {Date} Date plus or minus duration, according duration sign
	 */
	parsed.add = function add (date) {
		if (Object.prototype.toString.call(date) !== '[object Date]' || isNaN(date.valueOf())) {
			throw new TypeError('Invalid date');
		}
		return new Date(Date.UTC(
			date.getUTCFullYear() + parsed.year,
			date.getUTCMonth() + parsed.month,
			date.getUTCDate() + parsed.day + parsed.week * 7,
			date.getUTCHours() + parsed.hour,
			date.getUTCMinutes() + parsed.minute,
			date.getUTCSeconds() + parsed.second,
			date.getUTCMilliseconds()
		));
	};
	
	return parsed;	
}


/**
 * checks if the argument complies to a DVB locator according to clause 6.4.2 of ETSI TS 102 851 
 * i.e. dvb://<original_network_id>..<service_id> ;<event_id>
 *
 * @param {string} locator string contining the DVB locator
 * @returns {boolean}  true is the argment is formatted as a DVB locator
 */
function isDVBLocator(locator) {
	const locatorRegex = /^dvb:\/\/[\dA-Fa-f]+\.[\dA-Fa-f]*\.[\dA-Fa-f]+;[\dA-Fa-f]+$/;
	var s=locator.match(locatorRegex);
	return s?s[0]===locator:false;
}


/**
 * constructs HTML output of the errors found in the content guide analysis
 *
 * @param {boolean} URLmode   if true ask for a URL to a content guide, if false ask for a file
 * @param {Object}  res       the Express result 
 * @param {string}  lastInput the url or file name previously used - used to keep the form intact
 * @param {string}  lastType  the previously request type - used to keep the form intact
 * @param {Object}  o         the errors and warnings found during the content guide validation
 */
function drawForm(URLmode, res, lastInput, lastType, o) {
	
	const FORM_TOP="<html><head><title>DVB-I Content Guide Validator</title></head><body>";
	const PAGE_HEADING="<h1>DVB-I Content Guide Validator</h1>";
	const ENTRY_FORM_URL="<form method=\"post\"><p><i>URL:</i></p><input type=\"url\" name=\"CGurl\" value=\"%s\"/><input type=\"submit\" value=\"submit\"/>";

	const ENTRY_FORM_FILE="<form method=\"post\" encType=\"multipart/form-data\"><p><i>FILE:</i></p><input type=\"file\" name=\"CGfile\" value=\"%s\"/><input type=\"submit\" value=\"submit\"/>";

	const ENTRY_FORM_REQUEST_TYPE_HEADER="<p><i>REQUEST TYPE:</i></p>";

	const ENTRY_FORM_REQUEST_TYPE_ID="requestType";
	const ENTRY_FORM_REQUEST_TYPES=[{"value":CG_REQUEST_SCHEDULE_TIME,"label":"Schedule Info (time stamp)"},
									{"value":CG_REQUEST_SCHEDULE_NOWNEXT,"label":"Schedule Info (now/next)"},
									{"value":CG_REQUEST_SCHEDULE_WINDOW,"label":"Schedule Info (window)"},
									{"value":CG_REQUEST_PROGRAM,"label":"Program Info"},
									{"value":CG_REQUEST_MORE_EPISODES,"label":"More Episodes"},
									{"value":CG_REQUEST_BS_CATEGORIES,"label":"Box Set Categories"},
									{"value":CG_REQUEST_BS_LISTS,"label":"Box Set Lists"},
									{"value":CG_REQUEST_BS_CONTENTS,"label":"Box Set Contents"}];
	const FORM_END="</form>";
									  
	const RESULT_WITH_INSTRUCTION="<br><p><i>Results:</i></p>";
	const SUMMARY_FORM_HEADER="<table><tr><th>item</th><th>count</th></tr>";
	const FORM_BOTTOM="</body></html>";	
	
    res.write(FORM_TOP);    
    res.write(PAGE_HEADING);
   
    if (URLmode) 
		res.write(sprintf(ENTRY_FORM_URL, lastInput ? lastInput : ""));
	else res.write(sprintf(ENTRY_FORM_FILE, lastInput ? lastInput : ""));
	res.write(ENTRY_FORM_REQUEST_TYPE_HEADER);
	
	if (!lastType) lastType=ENTRY_FORM_REQUEST_TYPES[0].value;
	ENTRY_FORM_REQUEST_TYPES.forEach(choice => {
		res.write("<input type=\"radio\" name=\""+ENTRY_FORM_REQUEST_TYPE_ID+"\" value=\""+choice.value+"\"");
		if (lastType==choice.value)
			res.write(" checked")
		res.write(">"+choice.label+"</input>")
	});
	
	//choice.label.replace(/ /g, '&nbsp;')
	res.write(FORM_END);
	
    res.write(RESULT_WITH_INSTRUCTION);
    if (o) {
        if (o.error) 
            res.write("<p>"+o.error+"</p>");
        var resultsShown=false;
        if (o.errors) {
            var tableHeader=false;
            for (var i in o.errors.counts) {
                if (o.errors.counts[i]!=0) {
                    if (!tableHeader) {
                        res.write(SUMMARY_FORM_HEADER);
                        tableHeader=true;
                    }
                    res.write("<tr><td>"+HTMLize(i)+"</td><td>"+o.errors.counts[i]+"</td></tr>");
                    resultsShown=true;
                }
            }
            for (var i in o.errors.countsWarn) {
                if (o.errors.countsWarn[i]!=0) {
                    if (!tableHeader) {
                        res.write(SUMMARY_FORM_HEADER);
                        tableHeader=true;
                    }
                    res.write("<tr><td><i>"+HTMLize(i)+"</i></td><td>"+o.errors.countsWarn[i]+"</td></tr>");
                    resultsShown=true;
                }
            }
            if (tableHeader) res.write("</table>");

            tableHeader=false;
            o.errors.messages.forEach(function(value)
            {
                if (!tableHeader) {
                    res.write("<table><tr><th>code</th><th>errors</th></tr>");
                    tableHeader=true;                    
                }
				var t=value.replace(/</g,"&lt;").replace(/>/g,"&gt;");
				if (value.includes(o.errors.delim)) {
					var x=value.split(o.errors.delim);
					res.write("<tr><td>"+x[0]+"</td><td>"+HTMLize(x[1])+"</td></tr>");	
				}
				else 
					res.write("<tr><td></td><td>"+HTMLize(t)+"</td></tr>");
                resultsShown=true;
            });
            if (tableHeader) res.write("</table>");
            
            tableHeader=false;
            o.errors.messagesWarn.forEach(function(value)
            {
                if (!tableHeader) {
                    res.write("<table><tr><th>code</th><th>warnings</th></tr>");
                    tableHeader=true;                    
                }
				var t=value.replace(/</g,"&lt;").replace(/>/g,"&gt;");
				if (value.includes(o.errors.delim)) {
					var x=value.split(o.errors.delim);
					res.write("<tr><td>"+x[0]+"</td><td>"+HTMLize(x[1])+"</td></tr>");	
				}
				else 
					res.write("<tr><td></td><td>"+HTMLize(t)+"</td></tr>");

                resultsShown=true;
            });
            if (tableHeader) res.write("</table>");        
        }
        if (!resultsShown) res.write("no errors or warnings");
    }
}

/**
 * check if the node provided contains an RelatedMaterial element for a signalled application
 *
 * @param {Object} node The XML tree node (either a <Service> or a <ServiceInstance>) to be checked
 * @param {string} SCHEMA_PREFIX Used when constructing Xpath queries
 * @param {string} CG_SCHEMA Used when constructing Xpath queries
 * @returns {boolean}  true if the node contains a <RelatedMaterial> element which signals an application else false
 */
function hasSignalledApplication(node, SCHEMA_PREFIX, CG_SCHEMA) {
	var i=1, elem;
    while (elem=node.get(SCHEMA_PREFIX+":"+tva.e_RelatedMaterial+"[" + i++ + "]", CG_SCHEMA)) {
        var hr=elem.get(SCHEMA_PREFIX+":"+tva.e_HowRelated, CG_SCHEMA);
		if (hr && validServiceApplication(hr)) 
			return true;			
    }
    return false;
}

/**
 * check that only the specified child elements are in the parent element, no others
 *
 * @param {string} CG_SCHEMA     Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX Used when constructing Xpath queries
 * @param {Object} parentElement the element whose children should be checked
 * @param {Array}  childElements the element names permitted within the parent
 * @param {string} requestType   the type of content guide request being checked
 * @param {Class}  errs          errors found in validaton
 */
function checkAllowedTopElements(CG_SCHEMA, SCHEMA_PREFIX,  parentElement, childElements, requestType, errs) {
	// check that each of the specifid childElements exists
	childElements.forEach(elem => {
		if (!parentElement.get(SCHEMA_PREFIX+":"+elem, CG_SCHEMA)) 
			errs.pushCode("TE001", "Element "+elem+" not specified in "+parentElement.name());
	});
	
	// check that no additional child elements existance
	var c=0, child;
	while (child=parentElement.child(c++)) {
		if (!isIn(childElements, child.name())) {
			if (child.name()!='text')
				errs.pushCode("TE002", "Element "+child.name()+" not permitted");
		}
	}
}


/**
 * check that the specified child elements are in the parent element
 *
 * @param {string} CG_SCHEMA     Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX Used when constructing Xpath queries
 * @param {Object} parentElement the element whose children should be checked
 * @param {Array}  childElements the element names permitted within the parent
 * @param {string} requestType   the type of content guide request being checked
 * @param {Class}  errs          errors found in validaton
 */
function checkRequiredTopElements(CG_SCHEMA, SCHEMA_PREFIX,  parentElement, childElements, requestType, errs) {
	// check that each of the specifid childElements exists
	childElements.forEach(elem => {
		if (!parentElement.get(SCHEMA_PREFIX+":"+elem, CG_SCHEMA)) 
			errs.pushCode("TE001", "Element <"+elem+"> not specified in <"+parentElement.name()+">");
	});
}


/**
 * check that the specified child elements are in the parent element
 *
 * @param {string} CG_SCHEMA              Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX          Used when constructing Xpath queries
 * @param {Object} parentElement          the element whose children should be checked
 * @param {Array}  mandatoryChildElements the names of elements that are required within the element
 * @param {Array}  optionalChildElements  the names of elements that are optional within the element
 * @param {Class}  errs                   errors found in validaton
 * @param {string} errCode                error code to be used for any error found 
 */
function checkTopElements(CG_SCHEMA, SCHEMA_PREFIX,  parentElement, mandatoryChildElements, optionalChildElements, errs, errCode=null) {
	if (!parentElement) {
		errs.pushCode(errCode?errCode+"-0":"TE000", "checkTopElements() called with a 'null' element to check");
		return;
	}
	
	// check that each of the specifid childElements exists
	mandatoryChildElements.forEach(elem => {
		if (!parentElement.get(SCHEMA_PREFIX+":"+elem, CG_SCHEMA)) 
			errs.pushCode(errCode?errCode+"-1":"TE010", "Mandatory element <"+elem+"> not specified in <"+parentElement.parent().name()+"."+parentElement.name()+">");
	});
	
	// check that no additional child elements existance
	var c=0, child;
	while (child=parentElement.child(c++)) {
		var childName=child.name();
		if (!isIn(mandatoryChildElements, childName) &&!isIn(optionalChildElements, childName)) {
			if (childName!='text')
				errs.pushCode(errCode?errCode+"-2":"TE011", "Element <"+childName+"> is not permitted in <"+parentElement.parent().name()+"."+parentElement.name()+">");
		}
	}
}



/**
 * check that the specified child elements are in the parent element
 *
 * @param {string} CG_SCHEMA          Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX      Used when constructing Xpath queries
 * @param {Object} parentElement      the element whose attributes should be checked
 * @param {Array}  requiredAttributes the element names permitted within the parent
 * @param {Array}  optionalAttributes the element names permitted within the parent
 * @param {Class}  errs               errors found in validaton
 * @param {string} errCode            error code prefix to be used in reports, if not present then use local codes
 */
function checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, parentElement, requiredAttributes, optionalAttributes, errs, errCode=null)
{
	requiredAttributes.forEach(attributeName => {
		if (!parentElement.attr(attributeName))
			errs.pushCode(errCode?errCode+"-1":"AT001", parentElement.name()+"@"+attributeName+" is a required attribute");	
	});
	
	parentElement.attrs().forEach(attribute => {
		if (!isIn(requiredAttributes, attribute.name()) && !isIn(optionalAttributes, attribute.name()))
			errs.pushCode(errCode?errCode+"-2":"AT002", "@"+attribute.name()+" is not permitted in <"+parentElement.name()+">");
	});
}


/**
 * see if the named child element exists in the parent
 *
 * @param {string} CG_SCHEMA        Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX    Used when constructing Xpath queries
 * @param {Object} parentElement    The element to check
 * @param {string} childElement     The name of the element to look for
 * @returns {boolean}  true if the parentElement contains an element with the name specified in childElement else false
 */
function ElementFound(CG_SCHEMA, SCHEMA_PREFIX, parentElement, childElement) {
	var c=0, child;
	while (child=parentElement.child(c++)) {
		if (child.name()==childElement)
			return true;
	}
	return false;
}

/**
 * validate the <Synopsis> elements 
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} BasicDescription    the element whose children should be checked
 * @param {array}  requiredLengths	   @length attributes that are required to be present
 * @param {array}  optionalLengths	   @length attributes that can optionally be present
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 * @param {string} parentLanguage	   the xml:lang of the parent element to ProgramInformation
 * @param {string} errCode             error code prefix to be used in reports, if not present then use local codes
 */
function Validate_Synopsis(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, requiredLengths, optionalLengths, requestType, errs, parentLanguage, errCode=null) {
	
	function synopsisLengthError(label, length) {
		return "length of <"+tva.e_Synopsis+" length=\""+label+"\"> exceeds "+length+" characters"; }
	function singleLengthLangError(length, lang) {
		return "only a single "+tva.e_Synopsis+" is permitted per length ("+length+") and language ("+lang+")"; }
	function requiredSynopsisError(length) {
		return "a "+tva.e_Synopsis+" with @length=\""+length+"\" is required"; }
	
	var s=0, Synopsis, hasShort=false, hasMedium=false, hasLong=false;
	var shortLangs=[], mediumLangs=[], longLangs=[];
	while (Synopsis=BasicDescription.child(s++)) {
		if (Synopsis.name()==tva.e_Synopsis) {
			var synopsisLang=GetLanguage(knownLanguages, errs, Synopsis, parentLanguage);
			var synopsisLength=Synopsis.attr(tva.a_length)?Synopsis.attr(tva.a_length).value():null;
			
			if (synopsisLength) {
				if (isIn(requiredLengths, synopsisLength) || isIn(optionalLengths, synopsisLength)) {
					switch (synopsisLength) {
					case dvbi.SYNOPSIS_SHORT_LABEL:
						if ((unEntity(Synopsis.text()).length) > dvbi.SYNOPSIS_SHORT_LENGTH)
							errs.pushCode(errCode?errCode+"-1":"SY001", synopsisLengthError(dvbi.SYNOPSIS_SHORT_LABEL, dvbi.SYNOPSIS_SHORT_LENGTH));
						hasShort=true;
						break;
					case dvbi.SYNOPSIS_MEDIUM_LABEL:
						if ((unEntity(Synopsis.text()).length) > dvbi.SYNOPSIS_MEDIUM_LENGTH)
							errs.pushCode(errCode?errCode+"-2":"SY002", synopsisLengthError(dvbi.SYNOPSIS_MEDIUM_LABEL, dvbi.SYNOPSIS_MEDIUM_LENGTH));
						hasMedium=true;
						break;
					case dvbi.SYNOPSIS_LONG_LABEL:
						if ((unEntity(Synopsis.text()).length) > dvbi.SYNOPSIS_LONG_LENGTH)
							errs.pushCode(errCode?errCode+"-3":"SY003", synopsisLengthError(dvbi.SYNOPSIS_LONG_LABEL, dvbi.SYNOPSIS_LONG_LENGTH));
						hasLong=true;
						hasLong=true;
						break;						
					}
				}
				else
					errs.pushCode(errCode?errCode+"-4":"SY004", "@"+tva.a_length+"=\""+synopsisLength+"\" is not permitted for this request type");
			}
			else 
				errs.pushCode(errCode?errCode+"-5":"SY005","@"+tva.a_length+" attribute is required for <"+tva.e_Synopsis+">");
		
			if (synopsisLang && synopsisLength) {
				switch (synopsisLength) {
					case dvbi.SYNOPSIS_SHORT_LABEL:
						if (isIn(shortLangs, synopsisLang)) 
							errs.pushCode(errCode?errCode+"-6":"SY006",singleLengthLangError(synopsisLength, synopsisLang));
						else shortLangs.push(synopsisLang);
						break;
					case dvbi.SYNOPSIS_MEDIUM_LABEL:
						if (isIn(mediumLangs, synopsisLang)) 
							errs.pushCode(errCode?errCode+"-7":"SY007",singleLengthLangError(synopsisLength, synopsisLang));
						else mediumLangs.push(synopsisLang);
						break;
					case dvbi.SYNOPSIS_LONG_LABEL:
						if (isIn(longLangs, synopsisLang)) 
							errs.pushCode(errCode?errCode+"-8":"SY008",singleLengthLangError(synopsisLength, synopsisLang));
						else longLangs.push(synopsisLang);
						break;
				}
			}
		}
	}
	// note that current DVB-I specifiction only mandates "medium" length, but all three are checked here
	if (isIn(requiredLengths, dvbi.SYNOPSIS_SHORT_LABEL) && !hasShort)
		errs.pushCode(errCode?errCode+"-9":"SY009",requiredSynopsisError(dvbi.SYNOPSIS_SHORT_LABEL));	
	if (isIn(requiredLengths, dvbi.SYNOPSIS_MEDIUM_LABEL) && !hasMedium)
		errs.pushCode(errCode?errCode+"-10":"SY010",requiredSynopsisError(dvbi.SYNOPSIS_MEDIUM_LABEL));	
	if (isIn(requiredLengths, dvbi.SYNOPSIS_LONG_LABEL) && !hasLong)
		errs.pushCode(errCode?errCode+"-11":"SY011",requiredSynopsisError(dvbi.SYNOPSIS_LONG_LABEL));	
}


/**
 * validate the <Keyword> elements specified
 *
 * @param {string}  CG_SCHEMA           Used when constructing Xpath queries
 * @param {string}  SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object}  BasicDescription    the element whose children should be checked
 * @param {integer} minKeywords         the minimum number of keywords
 * @param {integer} maxKeywords         the maximum number of keywords
 * @param {Class}   errs                errors found in validaton
 * @param {string}  parentLanguage	    the xml:lang of the parent element to ProgramInformation
 * @param {string}  errCode             error code prefix to be used in reports, if not present then use local codes
 */
function ValidateKeyword(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, minKeywords, maxKeywords, errs, parentLanguage, errCode=null) {
	var k=0, Keyword, counts=[];
	while (Keyword=BasicDescription.child(k++)) {
		if (Keyword.name()==tva.e_Keyword) {
			var keywordType=Keyword.attr(tva.a_type) ? Keyword.attr(tva.a_type).value() : dvbi.DEFAULT_KEYWORD_TYPE;
			var keywordLang=GetLanguage(knownLanguages, errs, Keyword, parentLanguage);

			if (counts[keywordLang]===undefined)
				counts[keywordLang]=1
			else counts[keywordLang]++;
			if (keywordType!=dvbi.KEYWORD_TYPE_MAIN && keywordType!=dvbi.KEYWORD_TYPE_OTHER)
				errs.pushCode(errCode?errCode+"-1":"KW001","@"+tva.a_type+"=\""+keywordType+"\" not permitted for <"+tva.e_Keyword+">");
			if (unEntity(Keyword.text()).length > dvbi.MAX_KEYWORD_LENGTH)
				errs.pushCode(errCode?errCode+"-2":"KW002","<"+tva.e_Keyword+"> length is greater than "+dvbi.MAX_KEYWORD_LENGTH);
		}
	}
	for (var i in counts) {
        if (counts[i]!=0 && counts[i]>maxKeywords) 
            errs.pushCode(errCode?errCode+"-3":"KW003","More than "+maxKeywords+" <"+tva.e_Keyword+"> element"+(maxKeywords>1?"s":"")+" specified"+(i==DEFAULT_LANGUAGE?"":" for language \""+i+"\""));
	}
}

/**
 * validate the <Genre> elements specified
 *
 * @param {string}  CG_SCHEMA           Used when constructing Xpath queries
 * @param {string}  SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object}  BasicDescription    the element whose children should be checked
 * @param {integer} minGenres           the minimum number of genre elements
 * @param {integer} maxGenres           the maximum number of genre elements
 * @param {Class}   errs                errors found in validaton
 * @param {string}  errCode             error code prefix to be used in reports, if not present then use local codes
 */
function ValidateGenre(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, minGenres, maxGenres, errs, errCode=null) {
	var g=0, Genre, count=0;
	while (Genre=BasicDescription.child(g++)) {
		if (Genre.name()==tva.e_Genre) {
			count++;
			var genreType=Genre.attr(tva.a_type) ? Genre.attr(tva.a_type).value() : dvbi.DEFAULT_GENRE_TYPE;
			if (genreType!=dvbi.GENRE_TYPE_MAIN)
				errs.pushCode(errCode?errCode+"-1":"GE001","@"+tva.a_type+"=\""+genreType+"\" not permitted for <"+tva.e_Genre+">");
			
			var genreValue=Genre.attr(tva.a_href) ? Genre.attr(tva.a_href).value() : "";
			if (!isIn(allowedGenres, genreValue))
				errs.pushCode(errCode?errCode+"-2":"GE002","invalid @"+tva.a_href+" value \""+genreValue+"\" for <"+tva.e_Genre+">");
		}
	}
	if (count>maxGenres)
		errs.pushCode(errCode?errCode+"-3":"GE003","More than "+maxGenres+" <"+tva.e_Genre+"> element"+(maxGenres>1?"s":"")+" specified");
}

/**
 * validate the <ParentalGuidance> elements specified. 
 *
 * @param {string}  CG_SCHEMA           Used when constructing Xpath queries
 * @param {string}  SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object}  BasicDescription    the element whose children should be checked
 * @param {integer} minPGelements       the minimum number of genre elements
 * @param {integer} maxPGelements       the maximum number of genre elements
 * @param {Class}   errs                errors found in validaton
 * @param {string}  errCode             error code prefix to be used in reports, if not present then use local codes
 */
function ValidateParentalGuidance(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, minPGelements, maxPGelements, errs, errCode=null) {
	// first <ParentalGuidance> element must contain an <mpeg7:MinimumAge> element
	var pg=0, ParentalGuidance, countParentalGuidance=0;
	
	while (ParentalGuidance=BasicDescription.child(pg++)) {
		if (ParentalGuidance.name()==tva.e_ParentalGuidance) {
			countParentalGuidance++;
			
			var pgc=0, pgChild, countExplanatoryText=0;
			while (pgChild=ParentalGuidance.child(pgc++)) {
				
				if (pgChild.name()!="text") {
					
					if (pgChild.name()==tva.e_MinimumAge || pgChild.name()==tva.e_ParentalRating) {
						if (countParentalGuidance==1 && pgChild.name()!=tva.e_MinimumAge)
							errs.pushCode(errCode?errCode+"-1":"PG001", "first <"+tva.e_ParentalGuidance+"> element must contain <mpeg7:"+tva.e_MinimumAge+">");
						
						if (pgChild.name()=="MinimumAge" && countParentalGuidance!=1)
							errs.pushCode(errCode?errCode+"-2":"PG002", "<"+tva.e_MinimumAge+"> must be in the first <"+tva.e_ParentalGuidance+"> element");
						
						if (pgChild.name()==tva.e_ParentalRating) {
							if (!pgChild.attr(tva.a_href))
								NoHrefAttribute(errs, pgChild.name(), ParentalGuidance.name() )
						}
					}
					if (pgChild.name()==tva.e_ExplanatoryText) {
						countExplanatoryText++;
						if (pgChild.attr(tva.a_length)) {
							if (pgChild.attr(tva.a_length).value()!=tva.v_lengthLong)
								errs.pushCode(errCode?errCode+"-3":"PG003", "@"+tva.a_length+"=\""+pgChild.attr(tva.a_length).value()+"\" is not allowed for <"+tva.e_ExplanatoryText+">")
						}
						else 
							errs.pushCode(errCode?errCode+"-4":"PG004", "@"+tva.a_length+"=\""+tva.v_lengthLong+"\" is required for <"+tva.e_ExplanatoryText+">");
						
						if (unEntity(pgChild.text()).length > dvbi.MAX_EXPLANATORY_TEXT_LENGTH)
							errs.pushCode(errCode?errCode+"-5":"PG005", "length of <"+tva.e_ExplanatoryText+"> cannot exceed "+dvbi.MAX_EXPLANATORY_TEXT_LENGTH+"");
					}
				}
			}
			if (countExplanatoryText > 1)
				errs.pushCode(errCode?errCode+"-7":"PG006", "only a single <"+tva.e_ExplanatoryText+"> element is premitted in <"+tva.e_ParentalGuidance+">")
		}
	}
	if (countParentalGuidance>maxPGelements)
		errs.pushCode(errCode?errCode+"-7":"PG007", "no more than "+maxPGelements+" <"+tva.e_ParentalGuidance+"> elements are premitted");
}


/**
 * validate a name (either PersonName of Character) to ensure a single GivenName is present with a single optional FamilyName
 *
 * @param {string}  CG_SCHEMA        Used when constructing Xpath queries
 * @param {string}  SCHEMA_PREFIX    Used when constructing Xpath queries
 * @param {Object}  elem             the element whose children should be checked
 * @param {Class}   errs             errors found in validaton
 * @param {string}  errCode             error code prefix to be used in reports, if not present then use local codes
 */
function ValidateName(CG_SCHEMA, SCHEMA_PREFIX, elem, errs, errCode=null) {
	
	function checkNamePart(elem, parentElem, errs, errcode=null) {
		if (unEntity(elem.text()).length > dvbi.MAX_NAME_PART_LENGTH)	
			errs.pushCode(errCode?errCode:"VN001", "<"+elem.name()+"> in <"+parentElem.name()+"> is longer than "+dvbi.MAX_NAME_PART_LENGTH+" characters");
	}
	var se=0, subElem;
	var familyNameCount=0, givenNameCount=0, otherElemCount=0;
	while (subElem=elem.child(se++)) {
		switch (subElem.name()) {
			case tva.e_GivenName:
				givenNameCount++;
				checkNamePart(subElem, elem, errs, errCode?errCode+"-2":"VN002");
			    break;
			case tva.e_FamilyName:
				familyNameCount++;
				checkNamePart(subElem, elem, errs, errCode?errCode+"-3":"VN003");
			    break;
			default:
				otherElemCount++;			
		}
	}
	if (givenNameCount==0)
		errs.pushCode("VN004", "<"+tva.e_GivenName+"> is mandatory in <"+elem.name()+">");
	if (familyNameCount>1)
		errs.pushCode("VN005", "only a single <"+tva.e_FamilyName+"> is permitted in <"+elem.name()+">");
}

/**
 * validate the <CreditsList> elements specified
 *
 * @param {string}  CG_SCHEMA           Used when constructing Xpath queries
 * @param {string}  SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object}  BasicDescription    the element whose children should be checked
 * @param {Class}   errs                errors found in validaton
 * @param {string}  errCode             error code prefix to be used in reports, if not present then use local codes
 */
function ValidateCreditsList(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, errs, errCode=null) {
	var CreditsList=BasicDescription.get(SCHEMA_PREFIX+":"+tva.e_CreditsList, CG_SCHEMA);
	if (CreditsList) {
		var ci=0, CreditsItem;		
		while (CreditsItem=CreditsList.child(ci++)) {
			if (CreditsItem.name()==tva.e_CreditsItem) {
				if (CreditsItem.attr(tva.a_role)) {
					var CreditsItemRole=CreditsItem.attr(tva.a_role).value();
					if (!isIn(allowedCreditItemRoles, CreditsItemRole))
						errs.pushCode(errCode?errCode+"-1":"CL001", "\""+CreditsItemRole+"\" is not valid for "+tva.e_CreditsItem+"@"+tva.a_role);
				}
				else 
					errs.pushCode(errCode?errCode+"-2":"CL002", tva.e_CreditsItem+"@"+tva.a_role+" not specified")
				var foundPersonName=0, foundCharacter=0, foundOrganizationName=0;
				var s=0, elem;
				while (elem=CreditsItem.child(s++)) {
					switch (elem.name()) {
						case tva.e_PersonName:
							foundPersonName++;
							// required to have a GivenName optionally have a FamilyName
							ValidateName(CG_SCHEMA, SCHEMA_PREFIX, elem, errs );
							break;
						case tva.e_Character:
							foundCharacter++;
							// required to have a GivenName optionally have a FamilyName
							ValidateName(CG_SCHEMA, SCHEMA_PREFIX, elem, errs );
							break;
						case tva.e_OrganizationName:
							foundOrganizationName++;
							if (unEntity(elem.text()).length > dvbi.MAX_ORGANIZATION_NAME_LENGTH)
								errs.pushCode(errCode?errCode+"-3":"CL003", "length of <"+tva.e_OrganizationName+"> in <"+tva.e_CreditsItem+"> exceeds "+dvbi.MAX_ORGANIZATION_NAME_LENGTH+" characters")
							break;
						default:
							if (elem.name()!="text")
								errs.pushCode(errCode?errCode+"-4":"CL004", "extra element <"+elem.name()+"> found in <"+tva.e_CreditsItem+">");
					}
					if (foundPersonName>1)
						errs.pushCode(errCode?errCode+"-5":"CL005", "only a single <"+tva.e_PersonName+"> is permitted in <"+tva.e_CreditsItem+">");
					if (foundCharacter>1)
						errs.pushCode(errCode?errCode+"-6":"CL006", "only a single <"+tva.e_Character+"> is permitted in <"+tva.e_CreditsItem+">");
					if (foundOrganizationName>1)
						errs.pushCode(errCode?errCode+"-7":"CL007", "only a single <"+tva.e_OrganizationName+"> is permitted in <"+tva.e_CreditsItem+">");
					if (foundCharacter>0 && foundPersonName==0)
						errs.pushCode(errCode?errCode+"-8":"CL008", "<"+tva.e_Character+"> in <"+tva.e_CreditsItem+"> requires <"+tva.e_PersonName+">");
					if (foundOrganizationName>0 && (foundPersonName>0 || foundCharacter>0))
						errs.pushCode(errCode?errCode+"-9":"CL009", "<"+tva.e_OrganizationName+"> can only be present when <"+tva.e_PersonName+"> is absent in <"+tva.e_CreditsItem+">");
				}			
				if (foundPersonName>1)
					errs.pushCode(errCode?errCode+"-10":"CL010", "only a single <"+tva.e_PersonName+"> is permitted in <"+tva.e_CreditsItem+">")
				if (foundCharacter>1)
					errs.pushCode(errCode?errCode+"-11":"CL011", "only a single <"+tva.e_Character+"> is permitted in <"+tva.e_CreditsItem+">")
				if (foundOrganizationName>1)
					errs.pushCode(errCode?errCode+"-12":"CL012", "only a single <"+tva.e_OrganizationName+"> is permitted in <"+tva.e_CreditsItem+">")
			}
		}
	}
}

/**
 * validate the <RelatedMaterial> elements specified
 *
 * @param {string}  CG_SCHEMA           Used when constructing Xpath queries
 * @param {string}  SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object}  BasicDescription    the element whose children should be checked
 * @param {integer} minRMelements       the minimum number of RelatedMaterial elements
 * @param {integer} maxRMelements       the maximum number of RelatedMaterial elements
 * @param {Class}   errs                errors found in validaton
 */
function Validate_RelatedMaterial(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, minRMelements, maxRMelements, errs) {
	var rm=0, RelatedMaterial, countRelatedMaterial=0;
	while (RelatedMaterial=BasicDescription.child(rm++)) {
		if (RelatedMaterial.name()==tva.e_RelatedMaterial) {
			countRelatedMaterial++;
			
			// no additional checks are needed - DVB-I client should be robust to any siganlled RelatedMaterial
		}
	}
	if (countRelatedMaterial > maxRMelements)
		errs.pushCode("RM001", "a maximum of "+maxRMelements+" <"+tva.e_RelatedMaterial+"> element"+(maxRMelements>1?"s":"")+" are permitted")
}


/**
 * validate the <RelatedMaterial> elements in  More Episodes response
 *
 * @param {string}  CG_SCHEMA           Used when constructing Xpath queries
 * @param {string}  SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object}  BasicDescription    the element whose children should be checked
 * @param {Class}   errs                errors found in validaton
 */
function Validate_RelatedMaterialMoreEpisodes(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, errs) {
	var rm=0, RelatedMaterial, countRelatedMaterial=0;
	while (RelatedMaterial=BasicDescription.child(rm++)) {
		if (RelatedMaterial.name()==tva.e_RelatedMaterial) {
			countRelatedMaterial++;
	
			// TODO:
			
			// no additional checks are needed - DVB-I client should be robust to any siganlled RelatedMaterial
		}
	}
//	if (countRelatedMaterial > maxRMelements)
//		errs.pushCode("RE001", "a maximum of "+maxRMelements+" <RelatedMaterial> element"+(maxRMelements>1?"s":"")+" are permitted")
}


//------------------------------- ERROR TEMPLATES -------------------------------
/**
 * Add an error message when the a required element is not present
 *
 * @param {Object} errs Errors buffer
 * @param {String} missingElement Name of the missing element
 * @param {string} parentElement Name of the element which should contain the missingElement
 * @param {String} schemaLoctation The location in the schema of the element
 */
function NoChildElement(errs, missingElement, parentElement, schemaLocation=null, errno=null) {
	errs.pushCode(errno?errno:"NC001", missingElement+" element not specified for "+parentElement+ (schemaLocation)?" in "+schemaLocation:"");
}

/**
 * Add an error message when the @href contains an invalid value
 *
 * @param {Object} errs Errors buffer
 * @param {String} value The invalid value for the href attribute
 * @param {String} src The element missing the @href
 * @param {String} loc The location of the element
 */
function InvalidHrefValue(errs, value, src, loc=null, errno=null) {
	errs.pushCode(errno?errno:"HV001", "invalid @"+tva.a_href+"=\""+value+"\" specified for "+src+(loc)?" in "+loc:"");
}

/**
 * Add an error message when the @href is not specified for an element
 *
 * @param {Object} errs Errors buffer
 * @param {String} src The element missing the @href
 * @param {String} loc The location of the element
 */
function NoHrefAttribute(errs, src, loc=null, errno=null) {
	errs.pushCode(errno?errno:"HA001","no @"+tva.a_href+" specified for "+src+((loc)?" in "+loc:""));
}

/**
 * Add an error message when the MediaLocator does not contain a MediaUri sub-element
 *
 * @param {Object} errs Errors buffer
 * @param {String} src The type of element with the <MediaLocator>
 * @param {String} loc The location of the element
 */
function NoAuxiliaryURI(errs, src, loc, errno=null) {
	NoChildElement(errs, "<"+tva.e_AuxiliaryUri+">", src+" <"+tva.e_MediaLocator+">", loc, errno?errno:"AU001")
}


/**TemplateAITPromotional Still Image
 *
 * @param {Object} RelatedMaterial   the <RelatedMaterial> element (a libxmls ojbect tree) to be checked
 * @param {Object} errs              The class where errors and warnings relating to the serivce list processing are stored 
 * @param {string} Location          The printable name used to indicate the location of the <RelatedMaterial> element being checked. used for error reporting
  */
function ValidateTemplateAIT(CG_SCHEMA, SCHEMA_PREFIX, RelatedMaterial, errs, Location) {
    var HowRelated=null, Format=null, MediaLocator=[];
    var c=0, elem;
    while (elem=RelatedMaterial.child(c++)) {
        if (elem.name()===tva.e_HowRelated)
            HowRelated=elem;
        else if (elem.name()===tva.e_MediaLocator)
            MediaLocator.push(elem);
    }

    if (!HowRelated) {
		NoChildElement(errs, "<"+tva.e_HowRelated+">", RelatedMaterial.name(), Location, "TA100");
		return;
    }
	var HRhref=HowRelated.attr(tva.a_href);
	
	if (HRhref) {
		if (HRhref.value()!=dvbi.TEMPLATE_AIT_URI) 
			errs.pushCode("TA001", HowRelated.name()+"@"+Hrhref.name()+"=\""+HRhref.value()+"\" does not designate a Template AIT");
		else {		
			if (MediaLocator.length!=0) 
				MediaLocator.forEach(ml => {
					var subElems=ml.childNodes(), hasAuxiliaryURI=false;
					if (subElems) subElems.forEach(child => {
						if (child.name()==tva.e_AuxiliaryURI) {
							hasAuxiliaryURI=true;
							if (!child.attr(tva.a_contentType)) 
								NoChildElement(errs, "@"+tva.a_contentType, "Template IT <"+child.name()+">", Location, "TA101");
							else {
								var contentType=child.attr(tva.a_contentType).value();
								if (contentType!=dvbi.XML_AIT_CONTENT_TYPE) 
									errs.pushCode("TA002", "invalid @"+child.attr(tva.a_contentType).name()+"=\""+contentType+"\" specified for <"+RelatedMaterial.name()+"><"+tva.e_MediaLocator+"> in "+Location);
							}
						}
					});	
					if (!hasAuxiliaryURI) 
						NoAuxiliaryURI(errs, "template AIT", Location, "TA003");
				});
			else 
				NoChildElement(errs, "<"+tva.e_MediaLocator+">", RelatedMaterial.name(), Location, "TA102");
		}
	}
	else 
		NoHrefAttribute(errs, RelatedMaterial.name()+"."+HowRelated.name(), Location);
}


/**
 * verifies if the specified RelatedMaterial contains a Promotional Still Image
 *
 * @param {Object} RelatedMaterial   the <RelatedMaterial> element (a libxmls ojbect tree) to be checked
 * @param {Object} errs              The class where errors and warnings relating to the serivce list processing are stored 
 * @param {string} Location          The printable name used to indicate the location of the <RelatedMaterial> element being checked. used for error reporting
 * @param {string} LocationType      The type of element containing the <RelatedMaterial> element. Different validation rules apply to different location types
 */
function ValidatePromotionalStillImage(CG_SCHEMA, SCHEMA_PREFIX, RelatedMaterial, errs, Location, LocationType) {
    var HowRelated=null, Format=null, MediaLocator=[];
    var c=0, elem;
    while (elem=RelatedMaterial.child(c++)) {
        if (elem.name()===tva.e_HowRelated)
            HowRelated=elem;
        else if (elem.name()===tva.e_Format)
            Format=elem;
        else if (elem.name()===tva.e_MediaLocator)
            MediaLocator.push(elem);
    }

    if (!HowRelated) {
		NochildElement(errs, "<"+tva.e_HowRelated+">", RelatedMaterial.name(), Location, "PS101");
		return;
    }
	var HRhref=HowRelated.attr(tva.a_href);
	if (HRhref) {
		if (HRhref.value()!=dvbi.PROMOTIONAL_STILL_IMAGE_URI) 
			errs.pushCode("PS001", HowRelated.name()+"@"+HRhref.name()+"=\""+HRhref.value()+"\" does not designate a Promotional Still Image");
		else {
			if (Format) {
				var subElems=Format.childNodes(), hasStillPictureFormat=false;
				if (subElems) subElems.forEach(child => {
					if (child.name()==tva.e_StillPictureFormat) {
						hasStillPictureFormat=true;
						
						checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, child, [tva.a_horizontalSize, tva.a_verticalSize, tva.a_href], [], errs, "PS102");
						
						if (child.attr(tva.a_href)) {
							var href=child.attr(tva.a_href).value();
							if (href!=JPEG_IMAGE_CS_VALUE && href!=PNG_IMAGE_CS_VALUE) 
								InvalidHrefValue(errs, href, RelatedMaterial.name()+"."+Format.name()+"."+child.name(), Location)
							if (href==JPEG_IMAGE_CS_VALUE) isJPEG=true;
							if (href==PNG_IMAGE_CS_VALUE) isPNG=true;
						}
					}
				});
				if (!hasStillPictureFormat) 
					NoChildElement(errs, "<"+tva.e_StillPictureFormat+">", Format.name(), Location, "PS104");
			}

			if (MediaLocator.length!=0) 
				MediaLocator.forEach(ml => {
					var subElems=ml.childNodes(), hasMediaURI=false;
					if (subElems) subElems.forEach(child => {
						if (child.name()==tva.e_MediaUri) {
							hasMediaURI=true;
							if (!child.attr(tva.a_contentType)) 
								NoChildElement(errs, "@"+tva.a_contentType, "logo <"+child.name()+">", Location, "PS104");
							else {
								var contentType=child.attr(tva.a_contentType).value();
								if (!isJPEGmime(contentType) && !isPNGmime(contentType)) 
									errs.pushCode("PS002", "invalid @"+child.attr(tva.a_contentType).name()+"=\""+contentType+"\" specified for <RelatedMaterial><MediaLocator> in "+Location);
								if (Format && ((isJPEGmime(contentType) && !isJPEG) || (isPNGmime(contentType) && !isPNG))) 
									errs.pushCode("PS003", "conflicting media types in <"+Format.name()+"> and <"+child.name()+"> for "+Location);
							}
						}
					});
					if (!hasMediaURI) 
						NoMediaLocator(errs, "logo", Location);
				});
			else 
				NoChildElement(errs, MediaLocator.name(), "<"+RelatedMaterial.name()+">", Location, "PS106");
		}
	}
	else 
		NoHrefAttribute(errs, RelatedMaterial.name()+"."+tva.e_HowRelated, Location);
}

/**
 * validate the <RelatedMaterial> elements specified in a Box Set List
 *
 * @param {string}  CG_SCHEMA           Used when constructing Xpath queries
 * @param {string}  SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object}  BasicDescription    the element whose children should be checked
 * @param {integer} minRMelements       the minimum number of RelatedMaterial elements
 * @param {integer} maxRMelements       the maximum number of RelatedMaterial elements
 * @param {Class}   errs                errors found in validaton
 */
function Validate_RelatedMaterialBoxSetList(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, errs, Location) {
	var countImage=0, countTemplateAIT=0, countPaginationFirst=0, countPaginationPrev=0, countPaginationNext=0, countPaginationLast=0;
	var rm=0, RelatedMaterial;
	while (RelatedMaterial=BasicDescription.child(rm++)) {
		if (RelatedMaterial.name()==tva.e_RelatedMaterial) {
			var HowRelated=RelatedMaterial.get(SCHEMA_PREFIX+":"+tva.e_HowRelated, CG_SCHEMA);
			if (!HowRelated) 
				NoChildElement(errs, "<"+tva.e_HowRelated+">", "<"+RelatedMaterial.name()+">")
			else {				
				if (!HowRelated.attr(tva.a_href)) 
					NoHrefAttribute(errs, "<"+HowRelated.name+">", "<"+RelatedMaterial.name()+">");
				else {
					var hrHref=HowRelated.attr(tva.a_href).value();
					switch (hrHref) {
						case dvbi.TEMPLATE_AIT_URI:
							countTemplateAIT++;
							ValidateTemplateAIT(CG_SCHEMA, SCHEMA_PREFIX, RelatedMaterial, errs, "<"+BasicDescription.name()+">")
							break;
						case dvbi.PAGINATION_FIRST_URI:
							countPaginationFirst++;
							break;
						case dvbi.PAGINATION_PREV_URI:
							countPaginationPrev++;
							break;
						case dvbi.PAGINATION_NEXT_URI:
							countPaginationNext++;
							break;
						case dvbi.PAGINATION_LAST_URI:
							countPaginationLast++;
							break;
						case dvbi.PROMOTIONAL_STILL_IMAGE_URI:  // promotional still image
							countImage++;
							ValidatePromotionalStillImage(CG_SCHEMA, SCHEMA_PREFIX, RelatedMaterial, errs, "<"+BasicDescription.name()+">");
							break;
						default:
							InvalidHrefValue(errs, +hrHref, "<"+HowRelated.name()+">", "<"+RelatedMaterial.name()+"> in Box Set List");
					}	
				}
			}
		}
	}
	if (countTemplateAIT==0)
		errs.pushCodeCode("MB001", "a <"+tva.e_RelatedMaterial+"> element signalling the Template XML AIT must be specified for a Box Set List");
	if (countTemplateAIT>1)
		errs.pushCodeCode("MB002", "only one <"+tva.e_RelatedMaterial+"> element signalling the Template XML AIT can be specified for a Box Set List");
	if (countImage>1)
		errs.pushCodeCode("MB003", "only one <"+tva.e_RelatedMaterial+"> element signalling the promotional still image can be specified for a Box Set List");
	var numPaginations=countPaginationFirst+countPaginationPrev+countPaginationNext+countPaginationLast;
	if (numPaginations!=0 && numPaginations!=2 && numPaginations!=4)
		errs.pushCodeCode("MB004", "only 0, 2 or 4 paginations links may be siganlled in <"+tva.e_RelatedMaterial+"> elements for a Box Ser List");
}


/**
 * validate the <Title> elements specified
 *
 * @param {string}  CG_SCHEMA           Used when constructing Xpath queries
 * @param {string}  SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object}  BasicDescription    the element whose children should be checked
 * @param {boolean} allowSecondary      indicates if  Title with @type="secondary" is permitted
 * @param {Class}   errs                errors found in validaton
 * @param {string}  parentLanguage	    the xml:lang of the parent element to ProgramInformation
 * @param {string}  errCode             error code prefix to be used in reports, if not present then use local codes
 */
function ValidateTitle(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, allowSecondary, errs, parentLanguage, errCode=null) {
	var mainSet=[], secondarySet=[];
	var t=0, Title;
	while (Title=BasicDescription.child(t++)) {
		if (Title.name()==tva.e_Title) {
			var titleType=Title.attr(tva.a_type) ? Title.attr(tva.a_type).value() : dvbi.DEFAULT_TITLE_TYPE; // MPEG7 default type is "main"
			var titleLang=GetLanguage(knownLanguages, errs, Title, parentLanguage);

			var titleStr=unEntity(Title.text());
			
			if (titleStr.length > dvbi.MAX_TITLE_LENGTH)
				errs.pushCode(errcode?errcode+"-1":"VT001", "<"+Title.name()+"> length exceeds "+dvbi.MAX_TITLE_LENGTH+" characters")
			if (titleType==dvbi.TITLE_MAIN_TYPE) {
				if (isIn(mainSet, titleLang))
					errs.pushCode(errcode?errcode+"-2":"VT002", "only a single language is permitted for @"+tva.a_type+"=\""+TITLE_MAIN_TYPE+"\"")
				else mainSet.push(titleLang);
			}
			else if (titleType=dvbi.TITLE_SECONDARY_TYPE) {
				if (allowSecondary) {
					if (isIn(secondarySet, titleLang))
						errs.pushCode(errcode?errcode+"-3":"VT003", "only a single language is permitted for @"+tva.a_type+"=\""+TITLE_SECONDARY_TYPE+"\"")
					else secondarySet.push(titleLang);
				}
				else 
					errs.pushCode(errcode?errcode+"-4":"VT004", Title.name()+"@"+tva.a_type+"=\""+TITLE_SECONDARY_TYPE+"\" is not permitted for this <"+BasicDescription.name()+">");
			}
			else
				errs.pushCode(errcode?errcode+"-5":"VT005", "@"+tva.a_type+"=\""+titleType+"\" is not permitted for <"+Title.name()+">");
			
			secondarySet.forEach(lang => {
				if (!isIn(mainSet, lang)) {
					var t=lang!=DEFAULT_LANGUAGE ? " for @xml:lang=\""+lang+"\"" : "";
					errs.pushCode(errcode?errcode+"-6":"VT006", "@"+tva.a_type+"=\""+TITLE_SECONDARY_TYPE+"\" specified without @type=\""+TITLE_MAIN_TYPE+"\""+t);
				}
			});
		}
	}	
	
}

/**
 * validate the <BasicDescription> element against the profile for the given request/response type
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} parentElement  	   the element whose children should be checked
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 * @param {string} parentLanguage	   the xml:lang of the parent element to parentElement
 * @param {object} categoryGroup       the GroupInformationElement that others must refer to through <MemberOf>
 */
function ValidateBasicDescription(CG_SCHEMA, SCHEMA_PREFIX, parentElement, requestType, errs, parentLanguage, categoryGroup) {

	// TODO: need to determine if Now/Next and Prev/Now/Next (windowed) is needed for these request types (see A177v2 6.10.16.2)
	// if (requestType==CG_REQUEST_SCHEDULE_NOWNEXT || requestType==CG_REQUEST_SCHEDULE_WINDOW)
	//	return;

	var isParentGroup=parentElement==categoryGroup;
	var BasicDescription=parentElement.get(SCHEMA_PREFIX+":"+tva.e_BasicDescription, CG_SCHEMA);

	if (!BasicDescription) 
		NoChildElement(errs, "<"+tva.e_BasicDescription+">", parentElement.name());
	else {
		var bdLang=GetLanguage(knownLanguages, errs, BasicDescription, parentLanguage);

		switch (parentElement.name()) {
			case tva.e_ProgramInformation:
				switch (requestType) {
					case CG_REQUEST_SCHEDULE_NOWNEXT:  //6.10.5.2
					case CG_REQUEST_SCHEDULE_WINDOW:
					case CG_REQUEST_SCHEDULE_TIME:
						checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [tva.e_Title, tva.e_Synopsis], [tva.e_Genre, tva.e_ParentalGuidance, tva.e_RelatedMaterial], errs, "BD010");	
						ValidateTitle(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, true, errs, bdLang);
						Validate_Synopsis(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [dvbi.SYNOPSIS_MEDIUM_LABEL], [dvbi.SYNOPSIS_SHORT_LABEL], requestType, errs, bdLang);
						ValidateGenre(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, 0, 1, errs);
						ValidateParentalGuidance(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, 0, 2, errs);
						Validate_RelatedMaterial(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription,  0, 1, errs);
						break;
					case CG_REQUEST_PROGRAM:	// 6.10.5.3
						checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [tva.e_Title, tva.e_Synopsis], [tva.e_Keyword, tva.e_Genre, tva.e_ParentalGuidance, tva.e_CreditsList, tva.e_RelatedMaterial], errs, "BD020");
						ValidateTitle(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, true, errs, bdLang);
						Validate_Synopsis(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [dvbi.SYNOPSIS_MEDIUM_LABEL], [dvbi.SYNOPSIS_SHORT_LABEL,dvbi.SYNOPSIS_LONG_LABEL], requestType, errs, bdLang);
						ValidateKeyword(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, 0, 20, errs, bdLang);
						ValidateGenre(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, 0, 1, errs);
						ValidateParentalGuidance(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, 0, 2, errs);	
						ValidateCreditsList(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription,  errs);	
						Validate_RelatedMaterial(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription,  0, 1, errs);						
						break;
					case CG_REQUEST_BS_CONTENTS:  // 6.10.5.4					
						checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [tva.e_Title], [tva.e_Synopsis, tva.e_ParentalGuidance, tva.e_RelatedMaterial], errs, "BD030");
						ValidateTitle(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, true, errs, bdLang);
						Validate_Synopsis(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [], [dvbi.SYNOPSIS_MEDIUM_LABEL], requestType, errs, bdLang);
						ValidateParentalGuidance(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, 0, 2, errs);
						Validate_RelatedMaterial(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription,  0, 1, errs);
						break;
					case CG_REQUEST_MORE_EPISODES:
						checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [tva.e_Title], [tva.e_RelatedMaterial], errs, "BD040");
						Validate_RelatedMaterialMoreEpisodes(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, errs);
						break;
				//	default:
				//		errs.pushCode("BD050", "ValidateBasicDescription() called with invalid requestType/element ("+requestType+"/"+parentElement.name()+")");
				}
				break;

			case tva.e_GroupInformation:
				switch (requestType) {
					case CG_REQUEST_SCHEDULE_NOWNEXT:  //6.10.17.3 - BasicDescription for NowNext should be empty
					case CG_REQUEST_SCHEDULE_WINDOW:
						checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [], [], errs, "BD060");
						break;
					case CG_REQUEST_BS_LISTS:	// 6.10.5.5
						if (isParentGroup) 
							checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [tva.e_Title], [], errs, "BD061");
						else
						checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [tva.e_Title, tva.e_Synopsis], [tva.e_Keyword, tva.e_RelatedMaterial], errs, "BD062");
						ValidateTitle(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, false, errs, bdLang);						
						if (!isParentGroup)
							Validate_Synopsis(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [dvbi.SYNOPSIS_MEDIUM_LABEL], [], requestType, errs, bdLang);
						else if (ElementFound(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, tva.e_Synopsis))
							errs.pushCode("BD063", "<"+tva.e_Synopsis+"> not permitted in \"category group\" for this request type");
						if (!isParentGroup)
							ValidateKeyword(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, 0, 20, errs, bdLang);
						else if (ElementFound(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, tva.e_Keyword))
							errs.pushCode("BD064", "<"+tva.e_Keyword+"> not permitted in \"category group\" for this request type");
						if (!isParentGroup)
							Validate_RelatedMaterialBoxSetList(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, errs);
						else if (ElementFound(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, tva.e_RelatedMaterial))
							errs.pushCode("BD1065", "<"+tva.e_RelatedMaterial+"> not permitted in \"category group\" for this request type");
				break;
					case CG_REQUEST_MORE_EPISODES:   // TODO:: not defined in spec
						checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [], [tva.e_RelatedMaterial], errs, "BD070");	
						Validate_RelatedMaterialMoreEpisodes(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, errs);
						break;
					case CG_REQUEST_BS_CATEGORIES:
						if (isParentGroup) 
							checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [tva.e_Title], [], errs, "BD080");	
						else 
							checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [tva.e_Title, tva.e_Synopsis], [tva.e_Genre, tva.e_RelatedMaterial], errs, "BD081");
						ValidateTitle(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, false, errs, bdLang);
						if (!isParentGroup)
							Validate_Synopsis(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [dvbi.SYNOPSIS_SHORT_LABEL], [], requestType, errs, bdLang);
						else if (ElementFound(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, tva.e_Synopsis))
							errs.pushCode("BD082", "<"+tva.e_Synopsis+"> not permitted in \"category group\" for this request type");
						ValidateGenre(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, 0, 1, errs);
						Validate_RelatedMaterial(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription,  0, 1, errs);
						break;
					// default:
					//	errs.pushCode("BD100", "ValidateBasicDescription() called with invalid requestType/element ("+requestType+"/"+parentElement.name()+")");
					}
				break;
			default:
				errs.pushCode("BD003", "ValidateBasicDescription() called with invalid element ("+parentElement.name()+")");		
		}
	}	
}


/**
 * validate the <ProgramInformation> element against the profile for the given request/response type
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} ProgramInformation  the element whose children should be checked
 * @param {string} parentLanguage	   the xml:lang of the parent element to ProgramInformation
 * @param {array}  programCRIDs        array to record CRIDs for later use 
 * @param {array}  groupCRIDs          array of CRIDs found in the GroupInformationTable (null if not used)
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 */
function ValidateProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramInformation, parentLanguage, programCRIDs, groupCRIDs, requestType, errs) {
	
	checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, ProgramInformation, [tva.e_BasicDescription], [tva.e_OtherIdentifier, tva.e_MemberOf, tva.e_EpisodeOf], errs, "PI001");
	checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, ProgramInformation, [tva.a_programId], [], errs, "PI002")
		
	if (ProgramInformation.attr(tva.a_programId)) {
		var programCRID=ProgramInformation.attr(tva.a_programId).value();
		if (!isCRIDURI(programCRID)) 
			errs.pushCode("PI011", ProgramInformation.name()+"@"+ProgramInformation.attr('programId').name()+" is not a valid CRID ("+programCRID+")");
		if (isIn(programCRIDs, programCRID))
			errs.pushCode("PI012", ProgramInformation.name()+"@"+ProgramInformation.attr('programId').name()+"=\""+programCRID+"\" is already used");
		else programCRIDs.push(programCRID);
	}
	
	var piLang=GetLanguage(knownLanguages, errs, ProgramInformation, parentLanguage);

	// <ProgramInformation><BasicDescription>
	ValidateBasicDescription(CG_SCHEMA, SCHEMA_PREFIX, ProgramInformation, requestType, errs, piLang, null);

	var c=0, child;
	while (child=ProgramInformation.child(c++)) {
		switch (child.name()) {
			case tva.e_OtherIdentifier:		// <ProgramInformation><OtherIdentifier>
				break;
			case tva.e_MemberOf:				// <ProgramInformation><MemberOf>
			case tva.e_EpisodeOf:				// <ProgramInformation><EpisodeOf>
				if (child.attr(tva.a_crid)) {
					var oCRID=child.attr(tva.a_crid).value();
					if (groupCRIDs && !isIn(groupCRIDs, oCRID)) 
						errs.pushCode("PI014", ProgramInformation.name()+"."+child.name()+"@"+child.attr(tva.a_crid).name()+"=\""+oCRID+"\" is not a defined Group CRID for <"+child.name()+">")
					else
						if (!isCRIDURI(oCRID))
							errs.pushCode("PI015", ProgramInformation.name()+"."+child.name()+"@"+child.attr(tva.a_crid).name()+"=\""+oCRID+"\" is not a valid CRID")
				}
				else errs.pushCode("PI013", ProgramInformation.name()+"."+child.name()+"@"+tva.a_crid+" is required for this request type")
				break;			
		}	
	}
}

/**
 * find and validate any <ProgramInformation> elements in the <ProgramInformationTable>
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} ProgramDescription  the element containing the <ProgramInformationTable>
 * @param {string} progDescrLang       XML language of the ProgramDescription element (or its parent(s))
 * @param {array}  programCRIDs        array to record CRIDs for later use 
 * @param {array}  groupCRIDs          array of CRIDs found in the GroupInformationTable (null if not used)
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 * @param {integer} o.childCount       the number of child elements to be present (to match GroupInformation@numOfItems)
 */
function CheckProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, programCRIDs, groupCRIDs, requestType, errs, o=null) { 
	if(!ProgramDescription) {
		errs.pushCode("PI000", "CheckProgramInformation() called with "+tva.e_ProgramDescription+"=null");
		return;
	}
		
	var ProgramInformationTable=ProgramDescription.get(SCHEMA_PREFIX+":"+tva.e_ProgramInformationTable, CG_SCHEMA);
	
	if (!ProgramInformationTable) {
		errs.pushCode("PI001", "<"+tva.e_ProgramInformationTable+"> not specified in <"+ProgramDescription.name()+">");
		return;
	}
	var pitLang=GetLanguage(knownLanguages, errs, ProgramInformationTable, progDescrLang);

	var pi=0, ProgramInformation, cnt=0;
	while (ProgramInformation=ProgramInformationTable.child(pi++)) 
		if (ProgramInformation.name()==tva.e_ProgramInformation) {
			ValidateProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramInformation, pitLang, programCRIDs, groupCRIDs, requestType, errs);
			cnt++;
		}
	if (o) {
		if (o.childCount != cnt)
			errs.pushCode("PI100", tva.e_GroupInformation+"@"+tva.a_numOfItems+" specified in \"category group\" ("+o.childCount+") does match the number of items ("+cnt+")");
	}
}


/**
 * validate the <GroupInformation> element for Box Set related requests
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} GroupInformation    the element whose children should be checked
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 * @param {string} parentLanguage	   the xml:lang of the parent element to GroupInformation
 * @param {object} categoryGroup       the GroupInformationElement that others must refer to through <MemberOf>
 * @param {array}  indexes			   an accumulation of the @index values found
 * @param {string} groupsFound         groupId values found (null if not needed)
 */
function ValidateGroupInformationBoxSets(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, requestType, errs, parentLanguage, categoryGroup, indexes, groupsFound) {
	
	if (GroupInformation.attr(tva.a_groupId)) {
		var groupId=GroupInformation.attr(tva.a_groupId).value();
		if (isCRIDURI(groupId)) {
			if (groupsFound) 
				groupsFound.push(groupId);				
		}
		else
			errs.pushCode("GIB002", GroupInformation.name()+"@"+GroupInformation.attr(tva.a_groupId).name()+" value \""+groupId+"\" is not a CRID")
	}
	else errs.pushCode("GIB003", GroupInformation.name()+"@"+tva.a_groupId+" attribute is mandatory");	
	
	var isCategoryGroup=GroupInformation==categoryGroup;
	var categoryCRID=(categoryGroup && categoryGroup.attr(tva.a_groupId)) ? categoryGroup.attr(tva.a_groupId).value() : "";

	if (requestType==CG_REQUEST_BS_LISTS || requestType==CG_REQUEST_BS_CATEGORIES) {
		if (!isCategoryGroup && GroupInformation.attr(tva.a_ordered)) 
			errs.pushCode("GI004", GroupInformation.name()+"@"+GroupInformation.attr(tva.a_ordered).name()+" is only permitted in the \"category group\"");
		if (isCategoryGroup && !GroupInformation.attr(tva.a_ordered)) 
			errs.pushCode("GI005", GroupInformation.name()+"@"+GroupInformation.attr(tva.a_ordered).name()+" is required for this request type")
		if (!isCategoryGroup && GroupInformation.attr(tva.a_numOfItems)) 
			errs.pushCode("GI006", GroupInformation.name()+"@"+GroupInformation.attr(tva.a_numOfItems).name()+" is only permitted in the \"category group\"");
		if (isCategoryGroup && !GroupInformation.attr(tva.a_numOfItems)) 
			errs.pushCode("GI007", GroupInformation.name()+"@"+GroupInformation.attr(tva.a_numOfItems).name()+" is required for this request type")
	}

	// @serviceIDRef is required for Box Set Lists and Box Set Contents
	if (GroupInformation.attr(tva.a_serviceIDRef) && requestType!=CG_REQUEST_BS_LISTS && requestType!=CG_REQUEST_BS_CONTENTS) 
		errs.pushCode("GI011", GroupInformation.name()+"@"+GroupInformation.attr(tva.a_serviceIDRef).name()+" is not permitted for this request type")

	if (!isCategoryGroup) {
		elem=GroupInformation.get(SCHEMA_PREFIX+":"+tva.e_MemberOf, CG_SCHEMA);
		if (elem) {
			if (elem.attr(tva.a_type)) {
				if (elem.attr(tva.a_type).value()!=tva.t_MemberOfType)
					errs.pushCode("GI020", GroupInformation.name()+"."+MemberOf.name()+"@xsi:"+tva.a_type+" is invalid (\""+elem.attr("type").value()+"\")");
			}
			else
				errs.pushCode("GI021", GroupInformation.name()+"."+MemberOf.name()+" requires @xsi:"+tva.a_type+"=\""+tva.t_MemberOfType+"\" attribute");
			
			if (elem.attr(tva.a_index)) {
				var index=valUnsignedInt(elem.attr(tva.a_index).value());
				if (index>=1) {
					if (indexes) {
						if (isIn(indexes, index)) 
							errs.pushCode("GI022", "duplicated "+GroupInformation.name()+"."+MemberOf.name()+"@"+elem.attr("index").name()+" values ("+index+")");
						else indexes.push(index);
					}
				}
				else 
					errs.pushCode("GI023", GroupInformation.name()+"."+MemberOf.name()+"@"+elem.attr("index").name()+" must be an integer >= 1 (parsed "+index+")")
			}
			else
				errs.pushCode("GI024", GroupInformation.name()+"."+MemberOf.name()+" requires @"+tva.a_index+" attribute");
			
			if (elem.attr(tva.a_crid)) {
				if (elem.attr(tva.a_crid).value()!=categoryCRID)
					errs.pushCode("GI025", GroupInformation.name()+"."+MemberOf.name()+"@"+elem.attr(tva.a_crid).name()+" ("+elem.attr(tva.a_crid).value()+") does not match the \"category group\" crid ("+categoryCRID+")");
			}
			else
				errs.pushCode("GI026", GroupInformation.name()+"."+MemberOf.name()+" requires @"+tva.a_crid+" attribute");
		}
		else
			errs.pushCode("GI027", GroupInformation.name()+" requires a <"+tva.e_MemberOf+"> element referring to the \"category group\" ("+categoryCRID+")");
	}
	
	// <GroupInformation><BasicDescription>
	ValidateBasicDescription(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, requestType, errs, parentLanguage, categoryGroup);
}

/**
 * validate the <GroupInformation> element for Schedules related requests
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} GroupInformation    the element whose children should be checked
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 * @param {string} parentLanguage	   the xml:lang of the parent element to GroupInformation
 * @param {object} categoryGroup       the GroupInformationElement that others must refer to through <MemberOf>
 * @param {array}  indexes			   an accumulation of the @index values found
 * @param {string} groupsFound         groupId values found (null if not needed)
 */
function ValidateGroupInformationSchedules(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, requestType, errs, parentLanguage, categoryGroup, indexes, groupsFound) {
	
	if (GroupInformation.attr(tva.a_groupId)) {
		var groupId=GroupInformation.attr(tva.a_groupId).value();
		if (requestType==CG_REQUEST_SCHEDULE_NOWNEXT || requestType==CG_REQUEST_SCHEDULE_WINDOW) {
			if (groupId!=dvbi.CRID_NOW && groupId!=dvbi.CRID_LATER && groupId!=dvbi.CRID_EARLIER )
				errs.pushCode("GIS001", GroupInformation.name()+"@"+GroupInformation.attr('groupId').name()+" value \""+groupId+"\" is valid for this request type")
		}
	}
	else errs.pushCode("GIS003", GroupInformation.name()+"@"+tva.a_groupId+" attribute is mandatory");

	if (requestType==CG_REQUEST_SCHEDULE_NOWNEXT || requestType==CG_REQUEST_SCHEDULE_WINDOW) {
		if (GroupInformation.attr(tva.a_ordered)) {
			if (GroupInformation.attr(tva.a_ordered).value()!="true")
				errs.pushCode("GI008", GroupInformation.name()+"@"+GroupInformation.attr(tva.a_ordered).name()+" must be \"true\" for this response type");
		}
		else errs.pushCode("GI009", GroupInformation.name()+"@"+tva.a_ordered+" is required for this response type");
		if (!GroupInformation.attr(tva.a_numOfItems)) 
			errs.pushCode("GI010", GroupInformation.name()+"@"+GroupInformation.attr(tva.a_numOfItems).name()+" is required for this request type")
	}

	// <GroupInformation><BasicDescription>
	ValidateBasicDescription(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, requestType, errs, parentLanguage, categoryGroup);	
}

/**
 * validate the <GroupInformation> element for More Episodes requests
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} GroupInformation    the element whose children should be checked
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 * @param {string} parentLanguage	   the xml:lang of the parent element to GroupInformation
 * @param {object} categoryGroup       the GroupInformationElement that others must refer to through <MemberOf>
 * @param {array}  indexes			   an accumulation of the @index values found
 * @param {string} groupsFound         groupId values found (null if not needed)
 */
function ValidateGroupInformationMoreEpisodes(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, requestType, errs, parentLanguage, categoryGroup, indexes, groupsFound) {
	
	if (categoryGroup) 
		errs.push("GIM001", "\"category group\" should not be specified for this request type")
	
	if (GroupInformation.attr(tva.a_groupId)) {
		var groupId=GroupInformation.attr(tva.a_groupId).value();
		if (!isCRIDURI(groupId)) {
			errs.pushCode("GIM002", GroupInformation.name()+"@"+GroupInformation.attr(tva.a_groupId).name()+" value \""+groupId+"\" is not a valid CRID")
		}
		else 
			groupsFound.push(groupId);
	}
	else errs.pushCode("GIM003", GroupInformation.name()+"@"+tva.a_groupId+" attribute is mandatory");	

	if (GroupInformation.attr(tva.a_ordered)) {
		if (GroupInformation.attr(tva.a_ordered).value()!="true")
			errs.pushCode("GIM004", GroupInformation.name()+"@"+GroupInformation.attr(tva.a_ordered).name()+" must be \"true\" for this request type");
	}
	else 
		errs.pushCode("GIM005", GroupInformation.name()+"@"+tva.a_ordered+" is required for this response type");
	
	if (!GroupInformation.attr(tva.a_numOfItems)) 
		errs.pushCode("GI010", GroupInformation.name()+"@"+tva.a_numOfItems+" is required for this request type")

	var elem=GroupInformation.get(SCHEMA_PREFIX+":"+tva.e_GroupType, CG_SCHEMA);
	if (elem) {
		if (!(elem.attr(tva.a_type) && elem.attr(tva.a_type).value()==tva.t_ProgramGroupTypeType)) 
			errs.pushCode("GIM012", elem.name()+"@xsi:"+tva.a_type+"=\""+tva.t_ProgramGroupTypeType+"\" is required");
		if (!(elem.attr(tva.a_value) && elem.attr(tva.a_value).value()=="otherCollection")) 
			errs.pushCode("GIM013", elem.name()+"@"+elem.attr(tva.a_value).name()+"=\"otherCollection\" is required");
	}
	else
		errs.pushCode("GIM014", "<"+tva.e_GroupType+"> is required in <"+GroupInformation.name()+">"); 

	// <GroupInformation><BasicDescription>
	ValidateBasicDescription(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, requestType, errs, parentLanguage, categoryGroup);
}


/**
 * validate the <GroupInformation> element against the profile for the given request/response type
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} GroupInformation    the element whose children should be checked
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 * @param {string} parentLanguage	   the xml:lang of the parent element to GroupInformation
 * @param {object} categoryGroup       the GroupInformationElement that others must refer to through <MemberOf>
 * @param {array}  indexes			   an accumulation of the @index values found
 * @param {string} groupsFound         groupId values found (null if not needed)
 */
function ValidateGroupInformation(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, requestType, errs, parentLanguage, categoryGroup, indexes, groupsFound) {

	if (!GroupInformation) {
		errs.push("GI000", "ValidateGroupInformation() called with GroupInformation==null");
		return;
	}

	var giLang=GetLanguage(knownLanguages, errs, GroupInformation, parentLanguage);
	
	switch (requestType) {
		case CG_REQUEST_SCHEDULE_NOWNEXT:
		case CG_REQUEST_SCHEDULE_WINDOW:
			ValidateGroupInformationSchedules(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, requestType, errs, giLang, categoryGroup, indexes, groupsFound);
			break;
		case CG_REQUEST_BS_CATEGORIES:
		case CG_REQUEST_BS_LISTS:
		case CG_REQUEST_BS_CONTENTS:
			ValidateGroupInformationBoxSets(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, requestType, errs, giLang, categoryGroup, indexes, groupsFound);
			break;		
		case CG_REQUEST_MORE_EPISODES:
			ValidateGroupInformationMoreEpisodes(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, requestType, errs, giLang, categoryGroup, indexes, groupsFound);
			break;				
	}

	var elem=GroupInformation.get(SCHEMA_PREFIX+":"+tva.e_GroupType, CG_SCHEMA);
	if (elem) {
		if (!(elem.attr(tva.a_type) && elem.attr(tva.a_type).value()==tva.t_ProgramGroupTypeType)) 
			errs.pushCode("GI012", elem.name()+"@xsi:"+tva.a_type+"=\""+tva.t_ProgramGroupTypeType+"\" is required");
		if (!(elem.attr(tva.a_value) && elem.attr(tva.a_value).value()=="otherCollection")) 
			errs.pushCode("GI013", elem.name()+"@"+elem.attr(tva.a_value).name()+"=\"otherCollection\" is required");
	}
	else
		errs.pushCode("GI014", "<"+tva.e_GroupType+"> is required in <"+GroupInformation.name()+">"); // this should be checked in valdidation against the schema
}

/**
 * find and validate any <GroupInformation> elements in the <GroupInformationTable>
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} ProgramDescription  the element containing the <ProgramInformationTable>
 * @param {string} progDescrLang       XML language of the ProgramDescription element (or its parent(s))
 * @param {string} requestType         the type of content guide request being checked
 * @param {array}  groupIds            buffer to recieve the group ids parsed (null if not needed)
 * @param {Class}  errs                errors found in validaton
 * @param {integer} o.childCount       the value from the @numItems attribute of the "category group"
 */
function CheckGroupInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, groupIds, errs, o) { 
	var gi=0, GroupInformation;
	var GroupInformationTable=ProgramDescription.get(SCHEMA_PREFIX+":"+tva.e_GroupInformationTable, CG_SCHEMA);
	
	if (!GroupInformationTable) {
		errs.pushCode("GI100", "<"+tva.e_GroupInformationTable+"> not specified in <"+ProgramDescription.name()+">");
		return;
	}
	var gitLang=GetLanguage(knownLanguages, errs, GroupInformationTable, progDescrLang);

	// find which GroupInformation element is the "category group"
	var categoryGroup=null;
	if (requestType==CG_REQUEST_BS_LISTS || requestType==CG_REQUEST_BS_CATEGORIES || requestType==CG_REQUEST_BS_CONTENTS) {
		while (GroupInformation=GroupInformationTable.child(gi++)) {
			var countMemberOf=0;
			// this GroupInformation element is the "category group" if it does not contain a <MemberOf> element
			var e=0, elem;
			while (elem=GroupInformation.child(e++)) {
				if (elem.name()==tva.e_MemberOf)
					countMemberOf++
			}
			if (countMemberOf==0) {
				// this GroupInformation element is not a member of another GroupInformation so it must be the "category group"
				if (categoryGroup)
					errs.pushCode("GI101", "only a single \"category group\" can be present in <"+GroupInformationTable.name()+">")
				else categoryGroup=GroupInformation;
			}
		}
		if (!categoryGroup)
			errs.pushCode("GI102", "a \"category group\" must be specified in <"+GroupInformationTable.name()+"> for this request type")
	}
	
	var indexes=[], giCount=0;
	gi=0;
	while (GroupInformation=GroupInformationTable.child(gi++)) {
		if (GroupInformation.name()==tva.e_GroupInformation) {
			ValidateGroupInformation(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, requestType, errs, gitLang, categoryGroup, indexes, groupIds);
			if (GroupInformation!=categoryGroup) 
				giCount++;
		}
	}
	if (categoryGroup) {
		var numOfItems=(categoryGroup.attr(tva.a_numOfItems) ? valUnsignedInt(categoryGroup.attr(tva.a_numOfItems).value()) : 0);
		if (requestType!=CG_REQUEST_BS_CONTENTS && numOfItems!=giCount)
			errs.pushCode("GI103", tva.e_GroupInformation+"@"+tva.a_numOfItems+" specified in \"category group\" ("+numOfItems+") does match the number of items ("+giCount+")");

		if (o) 
			o.childCount=numOfItems;
	}

	if (requestType==CG_REQUEST_MORE_EPISODES && giCount>1)
		errs.pushCode("GI104", "only one "+tva.e_GroupInformation+" element is premitted for this request type");
}


/**
 * validate the <GroupInformation> element against the profile for the given request/response type
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} GroupInformation    the element whose children should be checked
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 * @param {string} parentLanguage	   the xml:lang of the parent element to GroupInformation
 * @param {int}    numEarlier		   maximum number of <GroupInformation> elements that are earlier
 * @param {int}    numNow			   maximum number of <GroupInformation> elements that are now
 * @param {int}    numLater			   maximum number of <GroupInformation> elements that are later
 * @param {array}  groupCRIDsFound     list of structural crids already found in this response
 */
function ValidateGroupInformationNowNext(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, requestType, errs, parentLanguage, numEarlier, numNow, numLater, groupCRIDsFound) {

	function ValidValues(errs, numOfItems, numAllowed, grp) {
		if (numOfItems<=0)
			errs.pushCode("NN101", tva.e_GroupInformation+"@"+tva.a_numOfItems+" must be > 0 for \""+grp+"\"");			
		if (numOfItems>numAllowed)
			errs.pushCode("NN102", va.e_GroupInformation+"@"+tva.a_numOfItems+" must be <= "+numAllowed+" for \""+grp+"\"");
	}

	// NOWNEXT and WINDOW GroupInformationElements contains the same syntax as other GroupInformationElements
	ValidateGroupInformation(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, requestType, errs, parentLanguage, null, null, null );
	
	if (GroupInformation.attr(tva.a_groupId)) {
		var grp=GroupInformation.attr(tva.a_groupId).value();
		if ((grp==dvbi.CRID_EARLIER && numEarlier>0) || (grp==dvbi.CRID_NOW && numNow>0) || (grp==dvbi.CRID_LATER && numLater>0)) {
			var numOfItems=GroupInformation.attr(tva.a_numOfItems)? valUnsignedInt(GroupInformation.attr(tva.a_numOfItems).value()): -1;
			switch (grp) {
				case dvbi.CRID_EARLIER:
					ValidValues(errs, numOfItems, numEarlier, grp);
					break;
				case dvbi.CRID_NOW:
					ValidValues(errs, numOfItems, numNow, grp);
					break;
				case dvbi.CRID_LATER:
					ValidValues(errs, numOfItems, numLater, grp);
					break;
			}
			if (isIn(groupCRIDsFound, grp))
				errs.pushCode("NN001", "only a single "+grp+" structural CRID is premitted in this request");
			else 
				groupCRIDsFound.push(grp);
		}
		else 
			errs.pushCode("NN002", tva.e_GroupInformation+" for \""+grp+"\" is not permitted for this request type");
	}
}

/**
 * find and validate any <GroupInformation> elements used for now/next in the <GroupInformationTable>
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} ProgramDescription  the element containing the <ProgramInformationTable>
 * @param {string} progDescrLang       XML language of the ProgramDescription element (or its parent(s))
 * @param {array}  groupIds            array of GroupInformation@CRID values found
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 */
function CheckGroupInformationNowNext(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, groupIds, requestType, errs) { 
	
	var GroupInformationTable=ProgramDescription.get(SCHEMA_PREFIX+":"+tva.e_GroupInformationTable, CG_SCHEMA);
	
	if (!GroupInformationTable) {
		errs.pushCode("NN201", "<"+tva.e_GroupInformationTable+"> not specified in <"+ProgramDescription.name()+">");
		return;
	}
	var gitLang=GetLanguage(knownLanguages, errs, GroupInformationTable, progDescrLang);
	
	var gi=0, GroupInformation;
	while (GroupInformation=GroupInformationTable.child(gi++)) {
		if (GroupInformation.name()==tva.e_GroupInformation) {
			
			switch (requestType) {
				case CG_REQUEST_SCHEDULE_NOWNEXT:
					ValidateGroupInformationNowNext(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, requestType, errs, gitLang, null, 1, 1, groupIds);
					break;
				case CG_REQUEST_SCHEDULE_WINDOW:
					ValidateGroupInformationNowNext(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, requestType, errs, gitLang, 10, 1, 10, groupIds);
					break;
			}
		}
	}
}


function countElements(CG_SCHEMA, SCHEMA_PREFIX, node, elementName) {
	var count=0, elem;
	while (elem=node.get(SCHEMA_PREFIX+":"+elementName+"["+count+"]", CG_SCHEMA)) count++;
	return count;
}

/**
 * validate any <AVAttributes> elements in <InstanceDescription> elements
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} AVAttributes        the <AVAttributes> node to be checked
 * @param {string} parentLanguage      XML language of the parent element (expliclt or implicit from its parent(s))
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 */
function ValidateAVAttributes(CG_SCHEMA, SCHEMA_PREFIX, AVAttributes, parentLanguage, requestType, errs) {
	
	function isValidAudioMixType(mixType) {
		return mixType==dvbi.AUDIO_MIX_MONO || mixType==dvbi.AUDIO_MIX_STEREO || mixType==dvbi.AUDIO_MIX_5_1;
	}
	function isValidAudioLanguagePurpose(purpose) {
		return purpose==dvbi.AUDIO_PURPOSE_MAIN || purpose==dvbi.AUDIO_PURPOSE_DESCRIPTION;
	}
	
	checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, AVAttributes, [], [tva.e_AudioAttributes, tva.e_VideoAttributes, tva.e_CaptioningAttributes], errs, "AV000");

	// <AudioAttributes>
	var a=0, AudioAttributes, foundAttributes=[], audioCounts=[];
	while (AudioAttributes=AVAttributes.child(a++))
		if (AudioAttributes.name()=="AudioAttributes") {
			checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, AudioAttributes, [], [tva.e_MixType, tva.e_AudioLanguage], errs, "AA000");

			var MixType=AudioAttributes.get(SCHEMA_PREFIX+":"+tva.e_MixType, CG_SCHEMA);
			if (MixType) {
				if (MixType.attr(tva.a_href)) {
					if (!isValidAudioMixType(MixType.attr(tva.a_href).value()))
						errs.pushCode("AV001", AudioAttributes.name()+"."+MixType.name()+" is not valid");
				}
				else
					NoHrefAttribute(errs, MixType.name(), AudioAttributes.name());
			}
					
			var AudioLanguage=AudioAttributes.get(SCHEMA_PREFIX+":"+tva.e_AudioLanguage, CG_SCHEMA);
			if (AudioLanguage) {
				var validLanguage=false, validPurpose=false, audioLang=AudioLanguage.text();
				if (AudioLanguage.attr(tva.a_purpose)) {
					if (!(validPurpose=isValidAudioLanguagePurpose(AudioLanguage.attr(tva.a_purpose).value())))
						errs.pushCode("AV002", AudioLanguage.name()+"@"+AudioLanguage.attr(tva.a_purpose).name()+" is not valid");
				}
				validLanguage=CheckLanguage(knownLanguages, errs, audioLang, AudioAttributes.name()+"."+AudioLanguage.name(), "AV102");
				
				// TODO: check that only two elements exist per language, one with each of the @purpose values
				if (validLanguage && validPurpose) {	
				
					if (audioCounts[audioLang]===undefined)
						audioCounts[audioLang]=1
					else audioCounts[audioLang]++;

					var combo=audioLang+"!--!"+AudioLanguage.attr(tva.a_purpose).value();
					if (isIn(foundAttributes, combo))
						errs.pushCode("AV003", "audio @"+AudioLanguage.attr(tva.a_purpose).name()+" \""+AudioLanguage.attr(tva.a_purpose).value()+"\" already specified for language \""+audioLang+"\"");
					else
						foundAttributes.push(combo);
				}
			}
		}
	audioCounts.forEach(audioLang => {
		if (audioCounts[audioLang]>2)
			errs.pushCode("AV004", "more than 2 <"+tva.e_AudioAttributes+"> for language \""+audioLang+"\"");
	});
	
	// <VideoAttributes>
	var v=0, VideoAttributes;
	while (VideoAttributes=AVAttributes.child(v++))
		if (VideoAttributes.name()==tva.e_VideoAttributes) {
			checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, VideoAttributes, [], [tva.e_HorizontalSize, tva.e_VerticalSize, tva.e_AspectRatio], errs, "VA000");
			
			var HorizontalSize=VideoAttributes.get(SCHEMA_PREFIX+":"+tva.e_HorizontalSize, CG_SCHEMA);
			if (HorizontalSize) 
				if (valUnsignedInt(HorizontalSize.text()) > MAX_UNSIGNED_SHORT) 
					errs.pushCode("AV010", HorizontalSize.name()+" must be an unsigned short (0-"+MAX_UNSIGNED_SHORT+")");
			var VerticalSize=VideoAttributes.get(SCHEMA_PREFIX+":"+tva.e_VerticalSize, CG_SCHEMA);
			if (VerticalSize) 
				if (valUnsignedInt(VerticalSize.text()) > MAX_UNSIGNED_SHORT) 
					errs.pushCode("AV011", HorizontalSize.name()+" must be an unsigned short (0-"+MAX_UNSIGNED_SHORT+")");
			var AspectRatio=VideoAttributes.get(SCHEMA_PREFIX+":"+tva.e_AspectRatio, CG_SCHEMA);
			if (AspectRatio) 
				if (!isRatioType(AspectRatio.text()))
					errs.pushCode("AV012", AspectRatio.name()+" is not a valid aspect ratio");
		}

	
	// <CaptioningAttributes>
	var c=0, CaptioningAttributes;
	var CaptioningAttributes=AVAttributes.get(SCHEMA_PREFIX+":"+tva.e_CaptioningAttributes, CG_SCHEMA);
	if (CaptioningAttributes) {
		checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, CaptioningAttributes, [], [tva.e_Coding/*, tva.e_BitRate*/], errs, "CA000");
		
		var Coding=CaptioningAttributes.get(SCHEMA_PREFIX+":"+tva.e_Coding, CG_SCHEMA);
		if (Coding) {
			if (Coding.attr(tva.a_href)) {
				var codingHref=Coding.attr(tva.a_href).value();
				if (codingHref!=dvbi.DVB_BITMAP_SUBTITLES && codingHref!=DVB_CHARACTER_SUBTITLES 
				  && codingHref!=dvbi.EBU_TT_D)
					errs.pushCode("AV021", CaptioningAttributes.name()+"."+Coding.name()+"@"+Coding.attr(tva.a_href).name()+" is not valid - should be DVB (bitmap or character) or EBU TT-D")
			}
			else
				NoHrefAttribute(errs, Coding.name(), AVAttributes.name()+"."+CaptioningAttributes.name());			
		}
/*		
		var BitRate=CaptioningAttributes.get(SCHEMA_PREFIX+":"+tva.e_BitRate", CG_SCHEMA);
		if (BitRate) {
			//TODO: unsure if this is needed in DVB-I profile, see bug 2813 - https://bugzilla.dvb.org/show_bug.cgi?id=2813
		}
*/		
	}
}



/**
 * validate a <RelatedMaterial> element iconforms to the Restart Application Linking rules (A177v2 clause 6.5.5)
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} RelatedMaterial     the <RelatedMaterial> node to be checked
 * @param {Class}  errs                errors found in validaton
 */
 function ValidateRestartRelatedMaterial(CG_SCHEMA, SCHEMA_PREFIX, RelatedMaterial, errs){
	
	function isRestartLink(str) { return str==dvbi.RESTART_LINK; }

	checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, RelatedMaterial, [tva.e_HowRelated, tva.e_MediaLocator], [], errs, "RR000");
	
	var HowRelated=RelatedMaterial.get(SCHEMA_PREFIX+":"+tva.e_HowRelated, CG_SCHEMA);
	if (HowRelated) {
		if (HowRelated.attr(tva.a_href)) {
			if (!isRestartLink(HowRelated.attr(tva.a_href)))
				errs.pushCode("RR001", "invalid "+HowRelated.name()+"@"+tva.a_href+" for Restart Application Link");
		}
		else 
			NoHrefAttribute(errs, RelatedMaterial.name(), RelatedMaterial.parent()?RelatedMaterial.parent().name():null);
	}
	
	var MediaLocator=RelatedMaterial.get(SCHEMA_PREFIX+":"+tva.e_MediaLocator, CG_SCHEMA);
	if (MediaLocator) 
		checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, MediaLocator, [tva.e_MediaUri, tva.e_AuxiliaryUri], [], errs, "ML000");
}



/**
 * validate any <InstanceDescription> elements in the <ScheduleEvent> and <OnDemandProgram> elements
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {string} VerifyType		   the type of verification to perform (OnDemandProgram | ScheduleEvent)
 * @param {Object} InstanceDescription the <InstanceDescription> node to be checked
 * @param {string} parentLanguage      XML language of the parent element (expliclt or implicit from its parent(s))
 * @param {array}  programCRIDs        array to record CRIDs for later use 
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 */
function ValidateInstanceDescription(CG_SCHEMA, SCHEMA_PREFIX, VerifyType, InstanceDescription, parentLanguage, programCRIDs, requestType, errs) {

	function isRestartAvailability(str) { return str==dvbi.RESTART_AVAILABLE || str==dvbi.RESTART_CHECK || str==dvbi.RESTART_PENDING; }
	function isMediaAvailability(str) { return str==dvbi.MEDIA_AVAILABLE || str==dvbi.MEDIA_UNAVAILABLE; }
	function isEPGAvailability(str) { return str==dvbi.FORWARD_EPG_AVAILABLE || str==dvbi.FORWARD_EPG_UNAVAILABLE; }
	function isAvailability(str) { return isMediaAvailability(str) || isEPGAvailability(str); }
	function checkGenre(node, parentNode, hrefAttribute) {
		if (!node) return null;
		var GenreType=(node.attr(tva.a_type)?node.attr(tva.a_type).value():"other");
		if (GenreType!="other")
			errs.pushCode("ID001", parentNode.name()+"."+node.name()+"@"+tva.a_type+" must contain \"other\"");
		if (!node.attr('href'))
			NoHrefAttribute(errs, node.name(), parentNode.name());
		return (node.attr(tva.a_href)?node.attr(tva.a_href).value():null);
	}

	if (VerifyType=="OnDemandProgram") {
		checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, InstanceDescription, [tva.e_Genre], [tva.e_CaptionLanguage, tva.e_SignLanguage, tva.e_AVAttributes, tva.e_OtherIdentifier], errs, "IDO000");
	} else if (VerifyType=="ScheduleEvent") {
		checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, InstanceDescription, [], [tva.e_CaptionLanguage, tva.e_SignLanguage, tva.e_AVAttributes, tva.e_OtherIdentifier, tva.e_Genre, tva.e_RelatedMaterial], errs, "IDS000");	
	}
	else
		errs.pushCode("ID000", "--> ValidateInstanceDescription called with VerifyType="+VerifyType);
	
	var restartGenre=null, restartRelatedMaterial=null;
	
	// <Genre>
	if (VerifyType==tva.e_OnDemandProgram) {
		// A177ve Table 54 - must be 2 elements
		
		var Genre1=InstanceDescription.get(SCHEMA_PREFIX+":"+tva.e_Genre+"[1]", CG_SCHEMA);
		var Genre2=InstanceDescription.get(SCHEMA_PREFIX+":"+tva.e_Genre+"[2]", CG_SCHEMA);
		var Genre3=InstanceDescription.get(SCHEMA_PREFIX+":"+tva.e_Genre+"[3]", CG_SCHEMA);
			
		if (Genre3 || !Genre2 || !Genre1)
			errs.pushCode("ID010", "exactly 2 <"+InstanceDescription.name()+"."+tva.e_Genre+"> elements are required for "+VerifyType);

		var g1href=checkGenre(Genre1, InstanceDescription);
		if (Genre1 && !isAvailability(g1href))
			errs.pushCode("ID011", InstanceDescription.name()+"."+Genre1.name()+" 1 must contain a media or fepg availability indicator");

		var g2href=checkGenre(Genre2, InstanceDescription);		
		if (Genre2 && !isAvailability(g2href))
			errs.pushCode("ID012", InstanceDescription.name()+"."+Genre2.name()+" 2 must contain a media or fepg availability indicator");
		
		if (Genre1 && Genre2) {
			if ((isMediaAvailability(g1href) && isMediaAvailability(g2href))
			 || (isEPGAvailability(g1href) && isEPGAvailability(g2href)))
				errs.pushCode("ID013", InstanceDescripton.name()+"."+Genre1.name()+" elements must indicate different availabilities")
		}
	} else if (VerifyType==tva.e_ScheduleEvent) {
		var Genre=InstanceDescription.get(SCHEMA_PREFIX+":"+tva.e_Genre, CG_SCHEMA);
		if (Genre) {
			restartGenre=Genre;
			if (!Genre.attr(tva.a_href))
				NoHrefAttribute(errs, Genre.name(), InstanceDescription.name())
			else 
			if (!isRestartAvailability(Genre.attr(tva.a_href).value()))
				errs.pushCode("ID014", InstanceDescription.name()+"."+Genre.name()+" must contain a restart link indicator")
		}		
	}
	
	// <CaptionLanguage>
	var captionCount=countElements(CG_SCHEMA, SCHEMA_PREFIX, InstanceDescription, tva.e_CaptionLanguage);
	if (captionCount > 1)
		errs.pushCode("ID020", "only a single "+tva.e_CaptionLanguage+" element is permitted in "+InstanceDescription.name());
	var CaptionLanguage=InstanceDescription.get(SCHEMA_PREFIX+":"+tva.e_CaptionLanguage, CG_SCHEMA);
	if (CaptionLanguage) {
		CheckLanguage(knownLanguages, errs, CaptionLanguage.text(), InstanceDescription.name()+"."+CaptionLanguage.name(), "AV120");
		if (CaptionLanguage.attr(tva.a_closed) && CaptionLanguage.attr(tva.a_closed).value()!="true" && CaptionLanguage.attr(tva.a_closed).value()!="false")
			errs.pushCode("ID021", InstanceDescription.name()+"."+CaptionLanguage.name()+"@"+tva.a_closed+" must be \"true\" or \"false\"");
	}
	
	// <SignLanguage>
	var signCount=countElements(CG_SCHEMA, SCHEMA_PREFIX, InstanceDescription, tva.e_SignLanguage);
	if (signCount > 1)
		errs.pushCode("ID030", "only a single "+tva.e_SignLanguage+" element is premitted in "+InstanceDescription.name());
	var SignLanguage=InstanceDescription.get(SCHEMA_PREFIX+":"+tva.e_SignLanguage, CG_SCHEMA);
	if (SignLanguage) {
		CheckLanguage(knownLanguages, errs, SignLanguage.text(), InstanceDescription.name()+"."+SignLanguage.name(), "AV130");
		if (SignLanguage.attr(tva.a_closed) && SignLanguage.attr(tva.a_closed).value()!="false")
			errs.pushCode("ID031", InstanceDescription.name()+"."+SignLanguage.name()+"@"+tva.a_closed+" must be \"false\"");
		//TODO: need to consider language validation against ISO 639-3 [18].
	}
	
	// <AVAttributes>
	var AVAttributes=InstanceDescription.get(SCHEMA_PREFIX+":"+tva.e_AVAttributes, CG_SCHEMA);
	if (AVAttributes)
		ValidateAVAttributes(CG_SCHEMA, SCHEMA_PREFIX, AVAttributes, parentLanguage, requestType, errs);
	
	// <OtherIdentifier>
	var oi=0, OtherIdentifier;
	while (OtherIdentifier=InstanceDescription.child(oi++)){
		if (OtherIdentifier.name()==tva.e_OtherIdentifier) {
			if (OtherIdentifier.attr(tva.a_type)) {			
				var oiType=OtherIdentifier.attr(tva.a_type).value();
		
				if ((VerifyType==tva.e_ScheduleEvent
							  && (oiType=="CPSIndex" || oiType==dvbi.EIT_PROGRAMME_CRID_TYPE || oiType==dvbi.EIT_SERIES_CRID_TYPE))
				  || (VerifyType=="OnDemandProgram" && oiType=="CPSIndex")) {
						// all good
					}
					else 
						errs.pushCode("ID050", OtherIdentifier.name()+"@"+tva.a_type+"=\""+oiType+"\" is not valid for "+VerifyType+"."+InstanceDescription.name());				
					if (oiType=dvbi.EIT_PROGRAMME_CRID_TYPE || oiType==dvbi.EIT_SERIES_CRID_TYPE)
						if (!isCRIDURI(OtherIdentifier.text()))
							errs.pushCode("ID051", OtherIdentifier.name()+" must be a CRID for @"+tva.a_type+"=\""+oiType+"\"");
			}
			else 
				errs.pushCode("ID052", OtherIdentifier.name()+"@"+tva.a_type+" is required in "+VerifyType+"."+InstanceDescription.name())
		}
	}
	
	// <RelatedMaterial>
	if (VerifyType==tva.e_ScheduleEvent) {
		var RelatedMaterial=InstanceDescription.get(SCHEMA_PREFIX+":"+tva.e_RelatedMaterial, CG_SCHEMA);
		if (RelatedMaterial) {
			restartRelatedMaterial=RelatedMaterial;
			ValidateRestartRelatedMaterial(CG_SCHEMA, SCHEMA_PREFIX, RelatedMaterial, errs); 		
		}
	}
	
	if (VerifyType==tva.e_ScheduleEvent) {
		if ((restartGenre && !restartRelatedMaterial) || (restartRelatedMaterial && !restartGenre))
			errs.pushCode("ID060", "both <Genre> and <RelatedMaterial> are required together for "+VerifyType);	
	}
}


/**
 * validate an <OnDemandProgram> elements in the <ProgramLocationTable>
 *
 * @param {string} CG_SCHEMA         Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX     Used when constructing Xpath queries
 * @param {Object} node              the element node containing the an XML AIT reference
 * @param {Class}  errs              errors found in validaton
 */
function CheckTemplateAITApplication(CG_SCHEMA, SCHEMA_PREFIX, node, errs) {
	if (!node) return;
	
	if (node.attr(tva.a_contentType)) {
		if (node.attr(tva.a_contentType).value() != dvbi.XML_AIT_CONTENT_TYPE) 
			errs.pushCode("TA001", node.name()+"@"+node.attr(tva.a_contentType).name()+"=\""+node.attr(tva.a_contentType).value()+"\" is not valid for a template AIT")		
	}
	else
		errs.pushCode("TA001", "@"+tva.a_contentType+" attribute is required when signalling a template AIT in "+node.name());
}


/**
 * validate an <OnDemandProgram> elements in the <ProgramLocationTable>
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} OnDemandProgram     the node containing the <OnDemandProgram> being checked
 * @param {string} progDescrLang       XML language of the parent element (expliclt or implicit from its parent(s))
 * @param {array}  programCRIDs        array to record CRIDs for later use 
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 */
function ValidateOnDemandProgram(CG_SCHEMA, SCHEMA_PREFIX, OnDemandProgram, parentLanguage, programCRIDs, requestType, errs) {

	switch (requestType) {
		case CG_REQUEST_BS_CONTENTS:
			checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, OnDemandProgram, [tva.e_Program,tva.e_ProgramURL,tva.e_PublishedDuration,tva.e_StartOfAvailability,tva.e_EndOfAvailability,tva.e_Free], [tva.e_InstanceDescription,tva.e_AuxiliaryURL,tva.e_DeliveryMode], errs, "OD001a");
			break;
		case CG_REQUEST_MORE_EPISODES:
			checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, OnDemandProgram, [tva.e_Program,tva.e_ProgramURL,tva.e_PublishedDuration,tva.e_StartOfAvailability,tva.e_EndOfAvailability,tva.e_Free], [tva.e_AuxiliaryURL], errs, "OD001b");
			break;
		case CG_REQUEST_SCHEDULE_NOWNEXT:
		case CG_REQUEST_SCHEDULE_TIME:
		case CG_REQUEST_SCHEDULE_WINDOW:
		case CG_REQUEST_PROGRAM:
			checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, OnDemandProgram, [tva.e_Program,tva.e_ProgramURL,tva.e_InstanceDescription,tva.e_PublishedDuration,tva.e_StartOfAvailability,tva.e_EndOfAvailability,tva.e_DeliveryMode,tva.e_Free], [tva.e_AuxiliaryURL], errs, "OD001c");
			break;
		default:
			errs.puchCode("OD001z", "requestType="+requestType+" is not valid for "+OnDemandProgram.name())
	}
		
	checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, OnDemandProgram, [], [tva.a_serviceIDRef, tva.a_lang], errs, "OD002"); 

	var odpLang=GetLanguage(knownLanguages, errs, OnDemandProgram, parentLanguage);	
	
	// @serviceIDRef
	if (OnDemandProgram.attr(tva.a_serviceIDRef)) {
		if (!isTAGURI(OnDemandProgram.attr(tva.a_serviceIDRef).value()))
			errs.pushCodeW("OD003", OnDemandProgram.name()+"@"+OnDemandProgram.attr(tva.a_serviceIDRef).name()+" is not a TAG URI")
	}
	
	// <Program>
	var Program=OnDemandProgram.get(SCHEMA_PREFIX+":"+tva.e_Program, CG_SCHEMA);
	if (Program)
		if (Program.attr(tva.a_crid)) {
			var programCRID=Program.attr(tva.a_crid).value();
			if (!isCRIDURI(programCRID))
				errs.pushCode("OD010", OnDemandProgram.name()+"."+Program.name()+"@"+Program.attr(tva.a_crid).name()+" is not a CRID URI");
			else {
				if (!isIn(programCRIDs, programCRID))
					errs.pushCode("OD011", OnDemandProgram.name()+"."+Program.name()+"@"+Program.attr(tva.a_crid).name()+"=\""+programCRID+"\" does not refer to a program in the <"+tva.e_ProgramInformationTable+">");
			}
		}
		else
			errs.pushCode("OD012", OnDemandProgram.name()+"."+Program.name()+"@"+Program.attr(tva.a_crid).name()+" is a required attribute");
	
	// <ProgramURL>
	var ProgramURL=OnDemandProgram.get(SCHEMA_PREFIX+":"+tva.e_ProgramURL, CG_SCHEMA);
	if (ProgramURL)
		CheckTemplateAITApplication(CG_SCHEMA, SCHEMA_PREFIX, ProgramURL, errs);

	// <AuxiliaryURL>
	var AuxiliaryURL=OnDemandProgram.get(SCHEMA_PREFIX+":"+tva.e_AuxiliaryURL, CG_SCHEMA);
	if (AuxiliaryURL)
		CheckTemplateAITApplication(CG_SCHEMA, SCHEMA_PREFIX, AuxiliaryURL, errs);
	
	// <InstanceDescription>
	var InstanceDescription=OnDemandProgram.get(SCHEMA_PREFIX+":"+tva.e_InstanceDescription, CG_SCHEMA);
	if (InstanceDescription) 
		ValidateInstanceDescription(CG_SCHEMA, SCHEMA_PREFIX, OnDemandProgram.name(), InstanceDescription, odpLang, programCRIDs,requestType, errs);
	
	// <PublishedDuration>
	var PublishedDuration=OnDemandProgram.get(SCHEMA_PREFIX+":"+tva.e_PublishedDuration, CG_SCHEMA);
	if (PublishedDuration)
		if (!isISODuration(PublishedDuration.text()))
			errs.pushCode("OD050", OnDemandProgram.name()+"."+PublishedDuration.name()+" is not a valid ISO Duration (xs:duration)");
	
	// <StartOfAvailability> and <EndOfAvailability>
	var soa=OnDemandProgram.get(SCHEMA_PREFIX+":"+tva.e_StartOfAvailability, CG_SCHEMA),
	    eoa=OnDemandProgram.get(SCHEMA_PREFIX+":"+tva.e_EndOfAvailability, CG_SCHEMA);
	
	if (soa) 
		if (!isUTCDateTime(soa.text())) {
			errs.pushCode("OD060", soa.name()+" must be expressed in Zulu time");
			soa=null;
		}
	if (eoa) 
		if (!isUTCDateTime(eoa.text())) {
			errs.pushCode("OD061", eoa.name()+" must be expressed in Zulu time");
			eoa=null;
		}
	if (soa && eoa) {
		var fr=new Date(soa.text()), to=new Date(eoa.text());	
		if (to.getTime() < fr.getTime()) 
			errs.pushCode("OD062", soa.name()+" must be earlier than "+eoa.name());
	}
	
	// <DeliveryMode>
	var DeliveryMode=OnDemandProgram.get(SCHEMA_PREFIX+":"+DeliveryMode, CG_SCHEMA);
	if (DeliveryMode) { // existance check and report done previously
		if (DeliveryMode.text()!="streaming")
			errs.pushCode("OD070", OnDemandProgram.name()+"."+DeliveryMode.name()+" must be \"streaming\"");
	}
	
	// <Free>
	var Free=OnDemandProgram.get(SCHEMA_PREFIX+":"+tva.e_Free, CG_SCHEMA);
	if (Free) { // existance check and report done previously
		if (Free.attr(tva.a_value)) {
			if (Free.attr(tva.a_value).value()!="true")
				errs.pushCode("OD080", OnDemandProgram.name()+"."+Free.name()+"@"+Free.attr(tva.a_value).name()+" must be \"true\"");
		}
		else errs.pushCode("OD081", OnDemandProgram.name()+"."+Free.name()+"@"+tva.a_value+" is a required attribute");
	}
}	


/**
 * validate any <ScheduleEvent> elements in the <ProgramLocationTable.Schedule>
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} Schedule            the <Schedule> node containing the <ScheduleEvent> element to be checked
 * @param {string} parentLanguage      XML language of the parent element (expliclt or implicit from its parent(s))
 * @param {array}  programCRIDs        array to record CRIDs for later use 
 * @param {Date}   scheduleStart	   Date representation of Schedule@start
 * @param {Date}   scheduleEnd  	   Date representation of Schedule@end
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 */
function ValidateScheduleEvents(CG_SCHEMA, SCHEMA_PREFIX, Schedule, parentLanguage, programCRIDs, scheduleStart, scheduleEnd, requestType, errs) {

	var se=0, ScheduleEvent;
	while (ScheduleEvent=Schedule.child(se++)) 
		if (ScheduleEvent.name()==tva.e_ScheduleEvent) {
			var seLang=GetLanguage(knownLanguages, errs, ScheduleEvent, parentLanguage);
			
			checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, ScheduleEvent, [tva.e_Program, tva.e_PublishedStartTime, tva.e_PublishedDuration], [tva.e_ProgramURL, tva.e_InstanceDescription, tva.e_ActualStartTime, tva.e_FirstShowing, tva.e_Free], errs, "SE001");
			
			// <Program>
			var Program=ScheduleEvent.get(SCHEMA_PREFIX+":"+tva.e_Program, CG_SCHEMA);
			if (Program) {
				var ProgramCRID=Program.attr(tva.e_crid);
				if (ProgramCRID) {
					if (!isCRIDURI(ProgramCRID.value()))
						errs.pushCode("SE011", Program.name()+"@"+ProgramCRID.name()+" is not a valid CRID ("+ProgramCRID.value()+")");
					if (!isIn(programCRIDs, ProgramCRID.value()))
						errs.pushCode("SE012", Program.name()+"@"+ProgramCRID.name()+"=\""+ProgramCRID.value()+"\" does not refer to a program in the <"+tva.e_ProgramInformationTable+">")
				}
			}
			
			// <ProgramURL>
			var ProgramURL=ScheduleEvent.get(SCHEMA_PREFIX+":"+tva.e_ProgramURL, CG_SCHEMA);
			if (ProgramURL) 
				if (!isDVBLocator(ProgramURL.text()))
					errs.pushCode("SE021", tva.e_ScheduleEvent+"."+tva.e_ProgramURL+" ("+ProgramURL.text()+")is not a valid DVB locator");		
			
			// <InstanceDescription>
			var InstanceDescription=ScheduleEvent.get(SCHEMA_PREFIX+":"+tva.e_InstanceDescription, CG_SCHEMA);
			if (InstanceDescription) 
				ValidateInstanceDescription(CG_SCHEMA, SCHEMA_PREFIX, ScheduleEvent.name(), InstanceDescription, seLang, programCRIDs,requestType, errs);
			
			// <PublishedStartTime> and <PublishedDuration>
			var psdElem=ScheduleEvent.get(SCHEMA_PREFIX+":"+tva.e_PublishedStartTime, CG_SCHEMA);
			var PublishedStartTime=new Date(psdElem?psdElem.text():0);

			if (psdElem) {
				if (PublishedStartTime < scheduleStart) 
					errs.pushCode("SE041", tva.e_PublishedStartTime+" ("+PublishedStartTime+") is earlier than Schedule@start");
				if (PublishedStartTime > scheduleEnd) 
					errs.pushCode("SE042", tva.e_PublishedStartTime+" ("+PublishedStartTime+") is after Schedule@end");	

				var pdElem=ScheduleEvent.get(SCHEMA_PREFIX+":"+tva.e_PublishedDuration, CG_SCHEMA);
				if (pdElem) {
					var parsedPublishedDuration = parseISOduration(pdElem.text());
					if (parsedPublishedDuration.add(PublishedStartTime) > scheduleEnd) 
						errs.pushCode("SE043", "StartTime+Duration of event is after Schedule@end");
				}
			}
		}
}


/**
 * validate a <Schedule> elements in the <ProgramLocationTable>
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} Schedule            the node containing the <Schedule> being checked
 * @param {string} parentLanguage      XML language of the parent element (expliclt or implicit from its parent(s))
 * @param {array}  programCRIDs        array to record CRIDs for later use 
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 */
function ValidateSchedule(CG_SCHEMA, SCHEMA_PREFIX, Schedule, parentLanguage, programCRIDS, requestType, errs) {

	checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, Schedule, [], [tva.e_ScheduleEvent], errs, "VS001");
	checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, Schedule, [tva.a_serviceIDRef, tva.a_start, tva.a_end], [], errs, "VS002");
	
	var scheduleLang=GetLanguage(knownLanguages, errs, Schedule, parentLanguage);	
	
		// @serviceIDRef
	if (Schedule.attr(tva.a_serviceIDRef)) {
		if (!isTAGURI(Schedule.attr(tva.a_serviceIDRef).value()))
			errs.pushCodeW("VS002", Schedule.name()+"@"+Schedule.attr(tva.a_serviceIDRef).name()+" is not a TAG URI")
	}
	
	var startSchedule=Schedule.attr(tva.a_start), fr=null, endSchedule=Schedule.attr(tva.a_end), to=null;
	if (startSchedule)
		if (isUTCDateTime(startSchedule.value())) 
			fr=new Date(startSchedule.value());
		else {
			errs.pushCode("VS010", Schedule.name()+"@"+startSchedule.name()+" is not expressed in UTC format ("+startSchedule.value()+")");
			startSchedule=null;
		}

	if (endSchedule)
		if (isUTCDateTime(endSchedule.value())) 
			to=new Date(endSchedule.value());
		else {
			errs.pushCode("VS011", Schedule.name()+"@"+endSchedule.name()+" is not expressed in UTC format ("+endSchedule.value()+")");
			endSchedule=null;
		}
	if (startSchedule && endSchedule) {
		if (to.getTime() < fr.getTime()) 
			errs.pushCode("VS012", startSchedule.name()+" must be earlier than "+endSchedule.name());
	}
	
	ValidateScheduleEvents(CG_SCHEMA, SCHEMA_PREFIX, Schedule, scheduleLang, programCRIDS, fr, to, requestType, errs);
}


/**
 * find and validate any <ProgramLocation> elements in the <ProgramLocationTable>
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} ProgramDescription  the element containing the <ProgramInformationTable>
 * @param {string} progDescrLang       XML language of the ProgramDescription element (or its parent(s))
 * @param {array}  programCRIDs        array to record CRIDs for later use  
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 * @param {integer} o.childCount         the number of child elements to be present (to match GroupInformation@numOfItems)
 */
function CheckProgramLocation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, programCRIDs, requestType, errs, o=null) {

	var ProgramLocationTable=ProgramDescription.get(SCHEMA_PREFIX+":"+tva.e_ProgramLocationTable, CG_SCHEMA);
	if (!ProgramLocationTable) {
		errs.pushCode("PL000", "<"+tva.e_ProgramLocationTable+"> is not specified");
		return;
	}
	checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, ProgramLocationTable, [], [tva.e_Schedule, tva.e_OnDemandProgram], errs, "PL001");
	checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, ProgramLocationTable, [], [tva.a_lang], errs, "PL002");
	
	var pltLang=GetLanguage(knownLanguages, errs, ProgramLocationTable, progDescrLang);	
	
	var c=0, child, cnt=0;
	while (child=ProgramLocationTable.child(c++)) {		
		switch (child.name()) {
			case "OnDemandProgram":
				ValidateOnDemandProgram(CG_SCHEMA, SCHEMA_PREFIX, child, pltLang, programCRIDs, requestType, errs);
				cnt++;
				break;
			case "Schedule":
				ValidateSchedule(CG_SCHEMA, SCHEMA_PREFIX, child, pltLang, programCRIDs, requestType, errs);
				cnt++;
				break;
		}
	}
	if (o) {
		if (o.childCount != cnt++)
			errs.pushCode("PL100", tva.e_GroupInformation+"@"+tva.a_numOfItems+" specified in \"category group\" ("+o.childCount+") does match the number of items ("+cnt+")");
	}
}





/**
 * validate the content guide and record any errors
 *
 * @param {String} CGtext the service list text to be validated
 * @param {Class} errs errors found in validaton
 */
function validateContentGuide(CGtext, requestType, errs) {
	var CG=null;
	if (CGtext) try {
		CG=libxml.parseXmlString(CGtext);
	} catch (err) {
		errs.pushCode("CG001", "XML parsing failed: "+err.message);
	}
	if (!CG) return;

	// check the retrieved service list against the schema
	// https://syssgx.github.io/xml.js/

//TODO: look into why both of these validation approaches are failing
/*
	console.log(xmllint.validateXML({
		xml: SL.toString(),
		schema: [SLschema.toString(), 
				 TVAschema.toString(), 
				 MPEG7schema.toString(),
				 XMLschema.toString()]
	}));
*/
/*
	if (!SL.validate(SLschema)){
		SL.validationErrors.forEach(err => console.log("validation error:", err));
	};
*/
	if (CG.root().name()!==tva.e_TVAMain) {
		errs.pushCode("CG002", "Root element is not <"+tva.e_TVAMain+">");
	}
	else {
		var CG_SCHEMA={}, 
			SCHEMA_PREFIX=CG.root().namespace().prefix(), 
			SCHEMA_NAMESPACE=CG.root().namespace().href();
		CG_SCHEMA[SCHEMA_PREFIX]=SCHEMA_NAMESPACE;

		var tvaMainLang=GetLanguage(knownLanguages, errs, CG.root(), DEFAULT_LANGUAGE, true);
		
		var ProgramDescription=CG.get(SCHEMA_PREFIX+":"+tva.e_ProgramDescription, CG_SCHEMA);
		if (!ProgramDescription) {
			errs.pushCode("CG003", "No <ProgramDescription> element specified.");
			return;
		}
		var progDescrLang=GetLanguage(knownLanguages, errs, ProgramDescription, tvaMainLang);
		var programCRIDs=[], groupIds=[], o={childCount:0};
		
		switch (requestType) {
		case CG_REQUEST_SCHEDULE_TIME:
			// schedule response (6.5.4.1) has <ProgramLocationTable> and <ProgramInformationTable> elements 
			checkAllowedTopElements(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, [tva.e_ProgramLocationTable,tva.e_ProgramInformationTable], requestType, errs);
			
			CheckProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, programCRIDs, null, requestType, errs);
			CheckProgramLocation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, programCRIDs, requestType, errs);
			break;
		case CG_REQUEST_SCHEDULE_NOWNEXT:
			// schedule response (6.5.4.1) has <ProgramLocationTable> and <ProgramInformationTable> elements 
			checkAllowedTopElements(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, [tva.e_ProgramLocationTable,tva.e_ProgramInformationTable, tva.e_GroupInformationTable], requestType, errs);
			
			CheckGroupInformationNowNext(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, groupIds, requestType, errs);
			CheckProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, programCRIDs, groupIds, requestType, errs);
			CheckProgramLocation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, programCRIDs, requestType, errs);
			break;
		case CG_REQUEST_SCHEDULE_WINDOW:
			checkAllowedTopElements(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, [tva.e_ProgramLocationTable,tva.e_ProgramInformationTable, tva.e_GroupInformationTable], requestType, errs);
			
			CheckGroupInformationNowNext(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, groupIds, requestType, errs);
			CheckProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, programCRIDs, groupIds, requestType, errs);
			CheckProgramLocation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, programCRIDs, requestType, errs);
			break;
		case CG_REQUEST_PROGRAM:
			// program information response (6.6.2) has <ProgramLocationTable> and <ProgramInformationTable> elements
			checkAllowedTopElements(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, [tva.e_ProgramLocationTable,tva.e_ProgramInformationTable], requestType, errs);
			
			CheckProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, programCRIDs, null, requestType, errs);
			break;
		case CG_REQUEST_MORE_EPISODES:
			// more episodes response (6.7.3) has <ProgramInformationTable>, <GroupInformationTable> and <ProgramLocationTable> elements 
			checkAllowedTopElements(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, [tva.e_ProgramInformationTable,tva.e_GroupInformationTable,tva.e_ProgramLocationTable], requestType, errs);

			CheckGroupInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, groupIds, errs, o);
			CheckProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, programCRIDs, groupIds, requestType, errs, o);
			CheckProgramLocation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, programCRIDs, requestType, errs, o);
			break;
		case CG_REQUEST_BS_CATEGORIES:
			// box set categories response (6.8.2.3) has <GroupInformationTable> element
			checkAllowedTopElements(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, [tva.e_GroupInformationTable], requestType, errs);

			CheckGroupInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, null, errs, null);
			break;
		case CG_REQUEST_BS_LISTS:
			// box set lists response (6.8.3.3) has <GroupInformationTable> element
			checkAllowedTopElements(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, [tva.e_GroupInformationTable], requestType, errs);

			CheckGroupInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, null, errs, null);
			break;
		case CG_REQUEST_BS_CONTENTS:
			// box set contents response (6.8.4.3) has <ProgramInformationTable>, <GroupInformationTable> and <ProgramLocationTable> elements 
			checkAllowedTopElements(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, [tva.e_ProgramInformationTable,tva.e_GroupInformationTable,tva.e_ProgramLocationTable], requestType, errs);
			
			CheckGroupInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, groupIds, errs, o);
			CheckProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, programCRIDs, groupIds, requestType, errs, o);
			CheckProgramLocation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, programCRIDs, requestType, errs, o);
			break;
		}


	}	
}

function checkQuery(req) {
    if (req.query) {
        if (req.query.CGurl)
            return true;
        
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
    if (isEmpty(req.query)) 
        drawForm(true, res);    
    else if (!checkQuery(req)) {
        drawForm(true, res, req.query.CGurl, req.query.requestType, {error:"URL not specified"});
        res.status(400);
    }
    else {
        var CGxml=null;
        var errs=new ErrorList();
        try {
            CGxml=syncRequest("GET", req.query.CGurl);
        }
        catch (err) {
            errs.pushCode("PQ001", "retrieval of URL ("+req.query.CGurl+") failed");
        }
		if (CGxml) 
			validateContentGuide(CGxml.getBody().toString().replace(/(\r\n|\n|\r|\t)/gm,""), req.query.requestType, errs);

        drawForm(true, res, req.query.CGurl, req.query.requestType, {errors:errs});
    }
    res.end();
}


const fileUpload=require('express-fileupload');
//middleware
app.use(express.static(__dirname));
app.set('view engine', 'ejs');
app.use(fileUpload());


function checkFile(req) {
    if (req.files) {
        if (req.files.CGfile)
            return true;
        
        return false;
    }
    return true;
}
/**
 * Process the content guide specificed by a file name for errors and display them
 *
 * @param {Object} req The request from Express
 * @param {Object} res The HTTP response to be sent to the client
 */ 
function processFile(req,res) {
    if (isEmpty(req.query)) {
        drawForm(false, res);    
    } else if (!checkFile(req)) {
        drawForm(false, res, req.files.CGfile.name, req.body.requestType, {error:"File not specified"});
        res.status(400);
    }
    else {
        var CGxml=null;
        var errs=new ErrorList();
		var fname="***";
		if (req && req.files && req.files.CGfile) fname=req.files.CGfile.name;
        try {
            CGxml=req.files.CGfile.data;
        }
        catch (err) {
            errs.pushCode("PF001", "retrieval of FILE ("+fname+") failed");
        }
		if (CGxml) {
			validateContentGuide(CGxml.toString().replace(/(\r\n|\n|\r|\t)/gm,""), req.body.requestType, errs);
		}
		
        drawForm(false, res, fname, req.body.requestType, {errors:errs});
    }
    res.end();
}


function loadDataFiles(useURLs) {
	console.log("loading classification schemes...");
    allowedGenres=[];
	loadCS(allowedGenres, useURLs, TVA_ContentCSFilename, TVA_ContentCSURL);
	loadCS(allowedGenres, useURLs, TVA_FormatCSFilename, TVA_FormatCSURL);
	loadCS(allowedGenres, useURLs, DVBI_ContentSubjectFilename, DVBI_ContentSubjectURL);

	console.log("loading countries...");
	knownCountries.loadCountriesFromFile(ISO3166_Filename, true);
  
    console.log("loading languages...");
	knownLanguages.loadLanguagesFromFile(IANA_Subtag_Registry_Filename, true);
	//knownLanguages.loadLanguagesFromURL(IANA_Subtag_Registry_URL, true);
	
	console.log("loading CreditItem roles...");
	allowedCreditItemRoles=[];
	loadRoles(allowedCreditItemRoles, useURLs, DVBI_CreditsItemRolesFilename, DVBI_CreditsItemRolesURL);
	loadRoles(allowedCreditItemRoles, useURLs, DVBIv2_CreditsItemRolesFilename, DVBIv2_CreditsItemRolesURL);
}


// read in the validation data
loadDataFiles(false);

// initialize Express
app.use(express.urlencoded({ extended: true }));

// handle HTTP POST requests to /check
app.post("/check", function(req,res) {
    req.query.CGurl=req.body.CGurl;
    processQuery(req,res);
});

// handle HTTP GET requests to /check
app.get("/check", function(req,res){
    processQuery(req,res);
});

// handle HTTP POST requests to /checkFile
app.post("/checkFile", function(req,res) {
	req.query.CGfile=req.body.CGfile;
    processFile(req,res);
});

// handle HTTP GET requests to /checkFile
app.get("/checkFile", function(req,res){
    processFile(req,res);
});

// dont handle any other requests
app.get("*", function(req,res) {
    res.status(404).end();
});


// start the HTTP server
var http_server=app.listen(HTTP_SERVICE_PORT, function() {
    console.log("HTTP listening on port number", http_server.address().port);
});


// start the HTTPS server
// sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout ./selfsigned.key -out selfsigned.crt

function readmyfile(filename) {
    try {
        var stats=fs.statSync(filename);
        if (stats.isFile()) return fs.readFileSync(filename); 
    }
    catch (err) {console.log(err.code,err.path);}
    return null;
}

var https_options={
    key:readmyfile(keyFilename),
    cert:readmyfile(certFilename)
};

if (https_options.key && https_options.cert) {
    var https_server=https.createServer(https_options, app);
    https_server.listen(HTTPS_SERVICE_PORT, function(){
        console.log("HTTPS listening on port number", https_server.address().port);
    });
}