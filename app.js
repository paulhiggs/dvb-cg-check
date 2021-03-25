// node.js - https://nodejs.org/en/
// express framework - https://expressjs.com/en/4x/api.html
const express=require("express")

const phlib=require('./phlib/phlib')

const fs=require("fs"), path=require("path")

// command line arguments - https://github.com/75lb/command-line-args
const commandLineArgs=require('command-line-args')

// favourite icon - https://www.npmjs.com/package/serve-favicon
const favicon=require("serve-favicon")

const fetch=require("node-fetch")
 
const ErrorList=require("./dvb-common/ErrorList.js")
const dvbi=require("./dvb-common/DVB-I_definitions.js")
const tva=require("./dvb-common/TVA_definitions.js")
const mpeg7=require("./dvb-common/MPEG7_definitions.js")

const {isJPEGmime, isPNGmime}=require("./dvb-common/MIME_checks.js")
const {isCRIDURI, isTAGURI}=require("./dvb-common/URI_checks.js")
const {loadCS}=require("./dvb-common/CS_handler.js")

const patterns=require("./dvb-common/pattern_checks.js")

// libxmljs2 - github.com/marudor/libxmljs2
const libxml=require("libxmljs2")

// morgan - https://github.com/expressjs/morgan
const morgan=require("morgan")

// express-fileupload - https://github.com/richardgirges/express-fileupload#readme
const fileUpload=require('express-fileupload')

// https://github.com/alexei/sprintf.js
var sprintf=require("sprintf-js").sprintf,
    vsprintf=require("sprintf-js").vsprintf
	
const https=require("https")
const keyFilename=path.join(".","selfsigned.key"), certFilename=path.join(".","selfsigned.crt")


// convenience/readability values
const DEFAULT_LANGUAGE="***"
const CATEGORY_GROUP_NAME="\"category group\""
const PARENT_GROUP_NAME="\"parent group\""

const CG_REQUEST_SCHEDULE_TIME="Time"
const CG_REQUEST_SCHEDULE_NOWNEXT="NowNext"
const CG_REQUEST_SCHEDULE_WINDOW="Window"
const CG_REQUEST_PROGRAM="ProgInfo"
const CG_REQUEST_MORE_EPISODES="MoreEpisodes"
const CG_REQUEST_BS_CATEGORIES="bsCategories"
const CG_REQUEST_BS_LISTS="bsLists"
const CG_REQUEST_BS_CONTENTS="bsContents"

const MAX_UNSIGNED_SHORT=65535
const OTHER_ELEMENTS_OK="!!!"

const REPO_RAW="https://raw.githubusercontent.com/paulhiggs/dvb-cg-check/master/",
	  COMMON_REPO_RAW="https://raw.githubusercontent.com/paulhiggs/dvb-common/master/",
	  DVB_COMMON_DIR="dvb-common"

const TVA_ContentCSFilename=path.join(DVB_COMMON_DIR, "tva","ContentCS.xml"),
	  TVA_ContentCSURL=COMMON_REPO_RAW + "tva/" + "ContentCS.xml",

	  TVA_FormatCSFilename=path.join(DVB_COMMON_DIR, "tva","FormatCS.xml"),
      TVA_FormatCSURL=COMMON_REPO_RAW + "tva/" + "FormatCS.xml",

	  DVBI_ContentSubjectFilename=path.join(DVB_COMMON_DIR, "dvbi","DVBContentSubjectCS-2019.xml"),
      DVBI_ContentSubjectURL=COMMON_REPO_RAW + "dvbi/" + "DVBContentSubjectCS-2019.xml",

	  DVBI_CreditsItemRolesFilename=path.join(".","CreditsItem@role-values.txt"),
	  DVBI_CreditsItemRolesURL=REPO_RAW+"CreditsItem@role-values.txt",

	  DVBIv2_CreditsItemRolesFilename=path.join(".","CreditsItem@role-values-v2.txt"),
	  DVBIv2_CreditsItemRolesURL=REPO_RAW+"CreditsItem@role-values-v2.txt"
  
const TVAschemaFileName=path.join(".","tva_metadata_3-1.xsd")
var TVAschema

const IANAlanguages=require("./"+DVB_COMMON_DIR+"/IANAlanguages.js")

var allowedGenres=[], allowedCreditItemRoles=[]
var knownLanguages=new IANAlanguages()

const IANA_Subtag_Registry_Filename=path.join("./dvb-common", knownLanguages.LanguagesFileName),
      IANA_Subtag_Registry_URL=knownLanguages.LanguagesURL

/**
 * determines if a value is in a set of values 
 *
 * @param {String or Array} values The set of values to check existance in
 * @param {String} value The value to check for existance
 * @return {boolean} if value is in the set of values
 */
function isIn(values, value){
    if (typeof(values)=="string")
        return values==value;
   
    if (typeof(values)=="object") 	
		return values.includes(value)
    
    return false;
}


/**
 * determines if a value is in a set of values using a case insensitive comparison
 *
 * @param {String or Array} values The set of values to check existance in
 * @param {String} value The value to check for existance
 * @return {boolean} if value is in the set of values
 */
function isIni(values, value){
	let vlc=value.toLowerCase()
    if (typeof(values)=="string")
        return values.toLowerCase()==vlc
   
	if (typeof(values)=="object")
		return (values.find(element => element.toLowerCase()==vlc) != undefined)
    
    return false;
}


/**
 * replace ENTITY strings with a generic characterSet
 *
 * @param {string} str string containing HTML or XML entities (starts with & ends with ;)
 * @return {string} the string with entities replaced with a single character '*'
 */
function unEntity(str) {
	return str.replace(/(&.+;)/ig,"*");
}


/**
 * counts the number of named elements in the specificed node 
 * *
 * @param {Object} node the libxmljs node to check
 * @param {String} childElementName the name of the child element to count
 * @returns {integer} the number of named child elments 
 */
function CountChildElements(node, childElementName) {
	let r=0, childElems=node?node.childNodes():null
	if (childElems) childElems.forEach(elem => {
		if (elem.type()=='element' && elem.name()==childElementName)
			r++
	})
	return r
}


/** 
 * verify the language using a validation class
 *
 * @param {object} validator  the validation class to use
 * @param {Class}  errs       errors found in validaton
 * @param {string} lang 	  that should be displayed in HTML
 * @param {string} loc        (optional) "location" of the language being checked
 * @param {string} errno      (optional) error number to use instead of local values
 */
function CheckLanguage(validator, errs, lang, loc=null, errno=null ) {
	if (!validator) {
		errs.pushCode(errno?errno+"-1":"LA001", "cannot validate language "+lang.quote()+""+(loc?" for "+loc.elementize():""))
		return false;
	}
	if (!validator.isKnown(lang))  {
		errs.pushCode(errno?errno+"-2":"LA002", "language "+lang.quote()+" specified"+(loc?" for "+loc.elementize():"")+" is invalid")
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
 * @param {boolean} isRequired report an error if @lang is not explicitly stated
 * @param {string} errno      (optional) error number to use instead of local values
 * @returns {string} the @lang attribute of the node element of the parentLang if it does not exist of is not specified
 */
function GetLanguage(validator, errs, node, parentLang, isRequired=false, errno=null) {
	if (!node) 
		return parentLang;
	if (!node.attr(tva.a_lang) && isRequired) {
		errs.pushCode(errno?errno:"AC001", tva.a_lang.attribute()+" is required for "+node.name().quote());
		return parentLang;		
	}

	if (!node.attr(tva.a_lang))
		return parentLang;
	
	let localLang=node.attr(tva.a_lang).value()
	CheckLanguage(validator, errs, localLang, node.name(), errno);
	return localLang;
}

 
//---------------- CreditsItem@role LOADING ----------------

if (typeof(String.prototype.trim)==="undefined") {
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
	let lines=data.split('\n')
	lines.forEach(line => values.push(line.trim()))
}


/**
 * read the list of valid roles from a file 
 *
 * @param {Array} values         the linear list of values 
 * @param {String} rolesFilename the filename to load
 */
function loadRolesFromFile(values, rolesFilename) {
	console.log("reading Roles from", rolesFilename);
    fs.readFile(rolesFilename, {encoding: "utf-8"}, function(err,data) {
        if (!err) 
			addRoles(values, data);
        else 
            console.log(err);
    });
}


/**
 * read the list of valid roles from a network location referenced by a URL  
 *
 * @param {Array} values 	The linear list of values
 * @param {String} rolesURL URL to the load
 */
function loadRolesFromURL(values, rolesURL) { 
	console.log("retrieving Roles from", rolesURL, "using fetch()");

	function handleErrors(response) {
		if (!response.ok) {
			throw Error(response.statusText)
		}
		return response
	}
	
	fetch(rolesURL)
		.then(handleErrors)
		.then(response => response.text())
		.then(strCS => addRoles(values, strCS))
		.catch(error => console.log("error ("+error+") retrieving "+rolesURL))
} 	


/**
 * loads role values from either a local file or an URL based location
 *
 * @param {Array} values        The linear list of values within the classification scheme
 * @param {boolean} useURL      if true use the URL loading method else use the local file
 * @param {String} roleFilename the filename of the classification scheme
 * @param {String} roleURL      URL to the classification scheme
 */ 
function loadRoles(values, useURL, roleFilename, roleURL) {
	if (useURL)
		loadRolesFromURL(values,roleURL);
	else loadRolesFromFile(values, roleFilename);	
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
    catch (err) {console.log(err.code,err.path);}
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
 * converts a decimal representation of a string to a number
 *
 * @param {string} str    string contining the decimal value
 * @returns {integer}  the decimal representation of the string, or 0 is non-digits are included
 */
function valUnsignedInt(str) {
	const intRegex=/[\d]+/;
	let s=str.match(intRegex)
	return s[0]===str?parseInt(str, 10):0
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
 * constructs HTML output of the errors found in the content guide analysis
 *
 * @param {boolean} URLmode   if true ask for a URL to a content guide, if false ask for a file
 * @param {Object}  res       the Express result 
 * @param {string}  lastInput the url or file name previously used - used to keep the form intact
 * @param {string}  lastType  the previously request type - used to keep the form intact
 * @param {string}  error     a single error message to display on the form, generally related to loading the content to validate
 * @param {Object}  errors    the errors and warnings found during the content guide validation
 */
function drawForm(URLmode, res, lastInput=null, lastType=null, error=null, errors=null) {
	
	const TABLE_STYLE="<style>table {border-collapse: collapse;border: 1px solid black;} th, td {text-align: left; padding: 8px; }	tr:nth-child(even) {background-color: #f2f2f2;}	</style>"
	const FORM_TOP="<html><head>"+TABLE_STYLE+"<title>DVB-I Content Guide Validator</title></head><body>";
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
	const DETAIL_FORM_HEADER="<table><tr><th>code</th><th>%s</th></tr>"
	const FORM_BOTTOM="</body></html>";	
	
    res.write(FORM_TOP);    
    res.write(PAGE_HEADING);
    res.write(sprintf(URLmode?ENTRY_FORM_URL:ENTRY_FORM_FILE, lastInput ? lastInput : ""))

	res.write(ENTRY_FORM_REQUEST_TYPE_HEADER);
	
	if (!lastType) lastType=ENTRY_FORM_REQUEST_TYPES[0].value;
	ENTRY_FORM_REQUEST_TYPES.forEach(choice => {
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
		for (let i in errors.counts) {
			if (errors.counts[i]!=0) {
				if (!tableHeader) {
					res.write(SUMMARY_FORM_HEADER);
					tableHeader=true;
				}
				res.write("<tr><td>"+phlib.HTMLize(i)+"</td><td>"+errors.counts[i]+"</td></tr>");
				resultsShown=true;
			}
		}
		for (let i in errors.countsWarn) {
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
				res.write(sprintf(DETAIL_FORM_HEADER, "errors"))
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
				res.write(sprintf(DETAIL_FORM_HEADER, "warnings"));
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
 * constructs an XPath based on the provided arguments
 * 
 * @param {string} SCHEMA_PREFIX Used when constructing Xpath queries
 * @param {string} elementName the name of the element to be searched for
 * @param {int} index the instance of the named element to be searched for (if specified)
 * @returns {string} the XPath selector
 */
function xPath(SCHEMA_PREFIX, elementName, index=null) {
	return SCHEMA_PREFIX+":"+elementName+(index?"["+index+"]":"")
}


/**
 * constructs an XPath based on the provided arguments
 * 
 * @param {string} SCHEMA_PREFIX Used when constructing Xpath queries
 * @param {array} elementNames the name of the element to be searched for
 * @returns {string} the XPath selector
 */
function xPathM(SCHEMA_PREFIX, elementNames) {
	let t=""
	elementNames.forEach(elementName => {
		if (t.length) { t+="/"; first=false;}
		t+=(SCHEMA_PREFIX+":"+elementName)	
	});
	return t
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
	let i=0, elem
    while (elem=node.get(xPath(SCHEMA_PREFIX, tva.e_RelatedMaterial, ++i), CG_SCHEMA)) {
        let hr=elem.get(xPath(SCHEMA_PREFIX, tva.e_HowRelated), CG_SCHEMA)
		if (hr && validServiceApplication(hr)) 
			return true;			
    }
    return false;
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
 * @returns {boolean} true if no errors are found (all mandatory elements are present and no extra elements are specified)
 */
function checkTopElements(CG_SCHEMA, SCHEMA_PREFIX,  parentElement, mandatoryChildElements, optionalChildElements, errs, errCode=null) {
	if (!parentElement) {
		errs.pushCode(errCode?errCode+"-0":"TE000", "checkTopElements() called with a 'null' element to check");
		return false;
	}
	let rv=true, thisElem=phlib.elementize(parentElement.parent().name()+"."+parentElement.name())
	// check that each of the specifid childElements exists
	mandatoryChildElements.forEach(elem => {
		if (!parentElement.get(xPath(SCHEMA_PREFIX, elem), CG_SCHEMA)) {
			errs.pushCode(errCode?errCode+"-1":"TE010", "Mandatory element "+elem.elementize()+" not specified in "+thisElem)
			rv=false;
		}
	});
	
	// check that no additional child elements existance if the "Other Child Elements are OK" flag is not set
	if (!isIn(optionalChildElements, OTHER_ELEMENTS_OK)) {
		let c=0, child
		let children=parentElement.childNodes()
		if (children) children.forEach(child => {
			if (child.type()=='element') {
				let childName=child.name()
				if (!isIn(mandatoryChildElements, childName) && !isIn(optionalChildElements, childName)) {		
					errs.pushCode(errCode?errCode+"-2":"TE011", "Element "+childName.elementize()+" is not permitted in "+thisElem)
					rv=false;
				}
			}
		})

	}
	return rv;
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
	if (!requiredAttributes || !parentElement) {
		errs.pushCode("AT000", "checkAttributes() called with parentElement==null or requiredAttributes==null")
		return;
	}
	
	requiredAttributes.forEach(attributeName => {
		if (!parentElement.attr(attributeName))
			errs.pushCode(errCode?errCode+"-1":"AT001", attributeName.attribute((parentElement.parent()?parentElement.parent().name()+".":"")+parentElement.name())+" is a required attribute");	
	});
	
	parentElement.attrs().forEach(attr => {
		if (!isIn(requiredAttributes, attr.name()) && !isIn(optionalAttributes, attr.name()))
			errs.pushCode(errCode?errCode+"-2":"AT002", attr.name().attribute()+" is not permitted in "+phlib.elementize((parentElement.parent()?parentElement.parent().name()+".":"")+parentElement.name()));
	});
}


/**
 * check if the specificed element has the named child elemeny
 * 
 * @param {string} CG_SCHEMA       Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX   Used when constructing Xpath queries
 * @param {object} node            the node to check
 * @param {string} elementName     the name of the child element
 * @returns {boolean} true if an element named node.elementName exists, else false
 */
function hasElement(CG_SCHEMA, SCHEMA_PREFIX,  node, elementName) {
	if (!node) return false;
	return (node.get(xPath(SCHEMA_PREFIX, elementName), CG_SCHEMA)!=null);
}


/**
 * check that the serviceIdRef attribute is a TAG URI and report warnings
 * 
 * @param {Object} elem       the node containing the element being checked
 * @param {Class}  errs       errors found in validaton
 * @param {string} errCode    error code prefix to be used in reports, if not present then use local codes
 * @returns {string} the serviceIdRef, whether it is valid of not
 */
function checkTAGUri(elem, errs, errCode=null) {
	if (elem && elem.attr(tva.a_serviceIDRef)) {
		if (!isTAGURI(elem.attr(tva.a_serviceIDRef).value()))
			errs.pushCodeW(errCode?errCode:"UR001", tva.a_serviceIDRef.attribute(elem.name())+" is not a TAG URI")
		return elem.attr(tva.a_serviceIDRef).value();
	}
	return "";
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
function ValidateSynopsis(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, requiredLengths, optionalLengths, requestType, errs, parentLanguage, errCode=null) {
	
	function synopsisLengthError(label, length) {
		return "length of "+tva.a_length.attribute(tva.e_Synopsis)+"="+label.quote()+" exceeds "+length+" characters" }
	function singleLengthLangError(length, lang) {
		return "only a single "+tva.e_Synopsis.elementize()+" is permitted per length ("+length+") and language ("+lang+")" }
	function requiredSynopsisError(length) {
		return "a "+tva.e_Synopsis.elementize()+" with "+tva.a_length.attribute()+"="+length.quote()+" is required" }
	
	if (!BasicDescription) {
		errs.pushCode("SY000", "ValidateSynopsis() called with BasicDescription==null")
		return
	}
	let s=0, Synopsis, hasShort=false, hasMedium=false, hasLong=false
	let shortLangs=[], mediumLangs=[], longLangs=[]
	while (Synopsis=BasicDescription.get(xPath(SCHEMA_PREFIX,tva.e_Synopsis, ++s), CG_SCHEMA)) {
		
		checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, Synopsis, [tva.a_length], [tva.a_lang], errs, "SY001");

		let synopsisLang=GetLanguage(knownLanguages, errs, Synopsis, parentLanguage, false, "SY002")
		let synopsisLength=Synopsis.attr(tva.a_length)?Synopsis.attr(tva.a_length).value():null
		
		if (synopsisLength) {
			if (isIn(requiredLengths, synopsisLength) || isIn(optionalLengths, synopsisLength)) {
				switch (synopsisLength) {
				case tva.SYNOPSIS_SHORT_LABEL:
					if ((unEntity(Synopsis.text()).length) > tva.SYNOPSIS_SHORT_LENGTH)
						errs.pushCode(errCode?errCode+"-1":"SY011", synopsisLengthError(tva.SYNOPSIS_SHORT_LABEL, tva.SYNOPSIS_SHORT_LENGTH));
					hasShort=true;
					break;
				case tva.SYNOPSIS_MEDIUM_LABEL:
					if ((unEntity(Synopsis.text()).length) > tva.SYNOPSIS_MEDIUM_LENGTH)
						errs.pushCode(errCode?errCode+"-2":"SY012", synopsisLengthError(tva.SYNOPSIS_MEDIUM_LABEL, tva.SYNOPSIS_MEDIUM_LENGTH));
					hasMedium=true;
					break;
				case tva.SYNOPSIS_LONG_LABEL:
					if ((unEntity(Synopsis.text()).length) > tva.SYNOPSIS_LONG_LENGTH)
						errs.pushCode(errCode?errCode+"-3":"SY013", synopsisLengthError(tva.SYNOPSIS_LONG_LABEL, tva.SYNOPSIS_LONG_LENGTH));
					hasLong=true;
					hasLong=true;
					break;						
				}
			}
			else
				errs.pushCode(errCode?errCode+"-4":"SY014", tva.a_length.attribute()+"="+synopsisLength.quote()+" is not permitted for this request type");
		}
	
		if (synopsisLang && synopsisLength) {
			switch (synopsisLength) {
				case tva.SYNOPSIS_SHORT_LABEL:
					if (isIn(shortLangs, synopsisLang)) 
						errs.pushCode(errCode?errCode+"-6":"SY016",singleLengthLangError(synopsisLength, synopsisLang));
					else shortLangs.push(synopsisLang);
					break;
				case tva.SYNOPSIS_MEDIUM_LABEL:
					if (isIn(mediumLangs, synopsisLang)) 
						errs.pushCode(errCode?errCode+"-7":"SY017",singleLengthLangError(synopsisLength, synopsisLang));
					else mediumLangs.push(synopsisLang);
					break;
				case tva.SYNOPSIS_LONG_LABEL:
					if (isIn(longLangs, synopsisLang)) 
						errs.pushCode(errCode?errCode+"-8":"SY018",singleLengthLangError(synopsisLength, synopsisLang));
					else longLangs.push(synopsisLang);
					break;
			}
		}
	}
	
	if (isIn(requiredLengths, tva.SYNOPSIS_SHORT_LABEL) && !hasShort)
		errs.pushCode(errCode?errCode+"-9":"SY019",requiredSynopsisError(tva.SYNOPSIS_SHORT_LABEL));	
	if (isIn(requiredLengths, tva.SYNOPSIS_MEDIUM_LABEL) && !hasMedium)
		errs.pushCode(errCode?errCode+"-10":"SY020",requiredSynopsisError(tva.SYNOPSIS_MEDIUM_LABEL));	
	if (isIn(requiredLengths, tva.SYNOPSIS_LONG_LABEL) && !hasLong)
		errs.pushCode(errCode?errCode+"-11":"SY021",requiredSynopsisError(tva.SYNOPSIS_LONG_LABEL));	
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

	if (!BasicDescription) {
		errs.pushCode("KW000", "ValidateKeyword() called with BasicDescription=null")
		return
	}
	let k=0, Keyword, counts=[]
	while (Keyword=BasicDescription.get(xPath(SCHEMA_PREFIX, tva.e_Keyword, ++k), CG_SCHEMA)) {
		
		checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, Keyword, [], [tva.a_lang, tva.a_type], errs, "KW001");

		let keywordType=Keyword.attr(tva.a_type)?Keyword.attr(tva.a_type).value():dvbi.DEFAULT_KEYWORD_TYPE
		let keywordLang=GetLanguage(knownLanguages, errs, Keyword, parentLanguage, false, "KW002")

		if (counts[keywordLang]===undefined)
			counts[keywordLang]=1
		else counts[keywordLang]++;
		if (keywordType!=dvbi.KEYWORD_TYPE_MAIN && keywordType!=dvbi.KEYWORD_TYPE_OTHER)
			errs.pushCode(errCode?errCode+"-1":"KW011",tva.a_type.attribute()+"="+keywordType.quote()+" not permitted for "+tva.e_Keyword.elementize());
		if (unEntity(Keyword.text()).length > dvbi.MAX_KEYWORD_LENGTH)
			errs.pushCode(errCode?errCode+"-2":"KW012","length of "+tva.e_Keyword.elementize()+" is greater than "+dvbi.MAX_KEYWORD_LENGTH)
	}
	
	for (let i in counts) {
        if (counts[i]!=0 && counts[i]>maxKeywords) 
            errs.pushCode(errCode?errCode+"-3":"KW013","More than "+maxKeywords+" "+tva.e_Keyword.elementize()+" element"+(maxKeywords>1?"s":"")+" specified"+(i==DEFAULT_LANGUAGE?"":" for language "+i.quote()));
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

	if (!BasicDescription) {
		errs.pushCode("GE000", "ValidateGenre() called with BasicDescription=null")
		return
	}
	let g=0, Genre, count=0
	while (Genre=BasicDescription.get(xPath(SCHEMA_PREFIX, tva.e_Genre, ++g), CG_SCHEMA)) {
		count++;
		let genreType=Genre.attr(tva.a_type)?Genre.attr(tva.a_type).value():dvbi.DEFAULT_GENRE_TYPE
		if (genreType!=dvbi.GENRE_TYPE_MAIN)
			errs.pushCode(errCode?errCode+"-1":"GE001", tva.a_type.attribute()+"="+genreType.quote()+" not permitted for "+tva.e_Genre.elementize());
		
		let genreValue=Genre.attr(tva.a_href)?Genre.attr(tva.a_href).value():""
		if (!isIn(allowedGenres, genreValue))
			errs.pushCode(errCode?errCode+"-2":"GE002", "invalid "+tva.a_href.attribute()+" value "+genreValue.quote()+" for "+tva.e_Genre.elementize());
	}
	if (count>maxGenres)
		errs.pushCode(errCode?errCode+"-3":"GE003","More than "+maxGenres+" "+tva.e_Genre.elementize()+" element"+(maxGenres>1?"s":"")+" specified");
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

	if (!BasicDescription) {
		errs.pushCode("PG000", "ValidateParentalGuidance() called with BasicDescription=null")
		return
	}
	let pg=0, ParentalGuidance, countParentalGuidance=0
	while (ParentalGuidance=BasicDescription.get(xPath(SCHEMA_PREFIX, tva.e_ParentalGuidance, ++pg), CG_SCHEMA)) {
		countParentalGuidance++;
		
		let countExplanatoryText=0, children=ParentalGuidance.childNodes()
		if (children) children.forEach( pgChild => {
			if (pgChild.type()=='element') {
				switch (pgChild.name()) {
					case tva.e_MinimumAge:
					case tva.e_ParentalRating:
						if (countParentalGuidance==1 && pgChild.name()!=tva.e_MinimumAge)
							errs.pushCode(errCode?errCode+"-1":"PG011", "first "+tva.e_ParentalGuidance.elementize()+" element must contain "+phlib.elementize("mpeg7:"+tva.e_MinimumAge))
						
						if (pgChild.name()==tva.e_MinimumAge && countParentalGuidance!=1)
							errs.pushCode(errCode?errCode+"-2":"PG012", tva.e_MinimumAge.elementize()+" must be in the first "+tva.e_ParentalGuidance.elementize()+" element");
						
						if (pgChild.name()==tva.e_ParentalRating) {
							checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, pgChild, [tva.a_href], [], errs, errCode?errCode+"-3":"PG013")
						}
						break;		
					case tva.e_ExplanatoryText:
						countExplanatoryText++;
						checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, pgChild, [tva.a_length], [], errs, errCode?errCode+"-4":"PG004") 
						if (pgChild.attr(tva.a_length)) {
							if (pgChild.attr(tva.a_length).value()!=tva.v_lengthLong)
								errs.pushCode(errCode?errCode+"-3":"PG003", tva.a_length.attribute()+"="+pgChild.attr(tva.a_length).value().quote()+" is not allowed for "+tva.e_ExplanatoryText.elementize())
						}
						
						if (unEntity(pgChild.text()).length > dvbi.MAX_EXPLANATORY_TEXT_LENGTH)
							errs.pushCode(errCode?errCode+"-5":"PG005", "length of "+tva.e_ExplanatoryText.elementize()+" cannot exceed "+dvbi.MAX_EXPLANATORY_TEXT_LENGTH+" characters")
						break;
				}
			}
		}) 
		if (countExplanatoryText > 1)
			errs.pushCode(errCode?errCode+"-7":"PG006", "only a single "+tva.e_ExplanatoryText.elementize()+" element is premitted in "+tva.e_ParentalGuidance.elementize())
	}
	if (countParentalGuidance>maxPGelements)
		errs.pushCode(errCode?errCode+"-7":"PG007", "no more than "+maxPGelements+" "+tva.e_ParentalGuidance.elementize()+" elements are premitted");
}


/**
 * validate a name (either PersonName of Character) to ensure a single GivenName is present with a single optional FamilyName
 *
 * @param {string}  CG_SCHEMA        Used when constructing Xpath queries
 * @param {string}  SCHEMA_PREFIX    Used when constructing Xpath queries
 * @param {Object}  elem             the element whose children should be checked
 * @param {Class}   errs             errors found in validaton
 * @param {string}  errCode          error code prefix to be used in reports, if not present then use local codes
 */
function ValidateName(CG_SCHEMA, SCHEMA_PREFIX, elem, errs, errCode=null) {
	
	function checkNamePart(elem, errs, errCode=null) {
		if (unEntity(elem.text()).length > dvbi.MAX_NAME_PART_LENGTH)	
			errs.pushCode(errCode?errCode:"VN001", elem.name().elementize()+" in "+elem.parent().name().elementize()+" is longer than "+dvbi.MAX_NAME_PART_LENGTH+" characters")
	}
	
	if (!elem) {
		errs.pushCode("VN000", "ValidateName() called with elem==null")
		return
	}
	let familyNameCount=0, givenNameCount=0, otherElemCount=0, children=elem.childNodes()
	if (children) children.forEach(subElem => {
		if (subElem.type()=="element") 
			switch (subElem.name()) {
				case tva.e_GivenName:
					givenNameCount++;
					checkNamePart(subElem, errs, errCode?errCode+"-2":"VN002");
					break;
				case tva.e_FamilyName:
					familyNameCount++;
					checkNamePart(subElem, errs, errCode?errCode+"-3":"VN003");
					break;
				default:
					otherElemCount++;			
			}
	})
		
	if (givenNameCount==0)
		errs.pushCode("VN004", tva.e_GivenName.elementize()+" is mandatory in "+elem.name().elementize())
	if (familyNameCount>1)
		errs.pushCode("VN005", "only a single "+tva.e_FamilyName.elementize()+" is permitted in "+elem.name().elementize())
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
	
	if (!BasicDescription) {
		errs.pushCode("CL000", "ValidateCreditsList() called with BasicDescription==null")
		return
	}
	let CreditsList=BasicDescription.get(xPath(SCHEMA_PREFIX, tva.e_CreditsList), CG_SCHEMA)
	if (CreditsList) {
		let ci=0, CreditsItem
		while (CreditsItem=CreditsList.get(xPath(SCHEMA_PREFIX,tva.e_CreditsItem, ++ci), CG_SCHEMA)) {
			checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, CreditsItem, [tva.a_role], [], errs, errCode?errCode+"-2":"CL002") 
			if (CreditsItem.attr(tva.a_role)) {
				let CreditsItemRole=CreditsItem.attr(tva.a_role).value()
				if (!isIn(allowedCreditItemRoles, CreditsItemRole))
					errs.pushCode(errCode?errCode+"-1":"CL001", CreditsItemRole.quote()+" is not valid for "+tva.a_role.attribute(tva.e_CreditsItem))
			}
			
			let foundPersonName=0, foundCharacter=0, foundOrganizationName=0

			let children=CreditsItem.childNodes()
			if (children) children.forEach(elem => {
				if (elem.type()=="element") {
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
								errs.pushCode(errCode?errCode+"-3":"CL003", "length of "+tva.e_OrganizationName.elementize()+" in "+tva.e_CreditsItem.elementize()+" exceeds "+dvbi.MAX_ORGANIZATION_NAME_LENGTH+" characters")
							break;
						default:
							if (elem.name()!="text")
								errs.pushCode(errCode?errCode+"-4":"CL004", "extra element "+elem.name().elementize()+" found in "+tva.e_CreditsItem.elementize())
					}
					if (foundPersonName>1)
						errs.pushCode(errCode?errCode+"-5":"CL005", "only a single "+tva.e_PersonName.elementize()+" is permitted in "+tva.e_CreditsItem.elementize())
					if (foundCharacter>1)
						errs.pushCode(errCode?errCode+"-6":"CL006", "only a single "+tva.e_Character.elementize()+" is permitted in "+tva.e_CreditsItem.elementize())
					if (foundOrganizationName>1)
						errs.pushCode(errCode?errCode+"-7":"CL007", "only a single "+tva.e_OrganizationName.elementize()+" is permitted in "+tva.e_CreditsItem.elementize())
					if (foundCharacter>0 && foundPersonName==0)
						errs.pushCode(errCode?errCode+"-8":"CL008", tva.e_Character.elementize()+" in "+tva.e_CreditsItem.elementize()+" requires "+tva.e_PersonName.elementize())
					if (foundOrganizationName>0 && (foundPersonName>0 || foundCharacter>0))
						errs.pushCode(errCode?errCode+"-9":"CL009", tva.e_OrganizationName.elementize()+" can only be present when "+tva.e_PersonName.elementize()+" is absent in "+tva.e_CreditsItem.elementize())
				}	
			})
		
			if (foundPersonName>1)
				errs.pushCode(errCode?errCode+"-10":"CL010", "only a single "+tva.e_PersonName.elementize()+" is permitted in "+tva.e_CreditsItem.elementize())
			if (foundCharacter>1)
				errs.pushCode(errCode?errCode+"-11":"CL011", "only a single "+tva.e_Character.elementize()+" is permitted in "+tva.e_CreditsItem.elementize())
			if (foundOrganizationName>1)
				errs.pushCode(errCode?errCode+"-12":"CL012", "only a single "+tva.e_OrganizationName.elementize()+" is permitted in "+tva.e_CreditsItem.elementize())
		}
	}
}


/**
 * validate a <RelatedMaterial> if it is signalled as an carrying an image
 *
 * @param {string}  CG_SCHEMA         Used when constructing Xpath queries
 * @param {string}  SCHEMA_PREFIX     Used when constructing Xpath queries
 * @param {Object}  ReltedMaterial    the element whose children should be checked
 * @param {Class}   errs              errors found in validaton
 * @returns {boolean}  true if the RelatedMaterial element is evaluated here
 */
function CheckImageRelatedMaterial(CG_SCHEMA, SCHEMA_PREFIX, RelatedMaterial, errs) {

	if (!RelatedMaterial) {
		errs.pushCode("IRM000", "CheckImageRelatedMaterial() called with RelatedMaterial==null")
		return
	}
	let HowRelated=RelatedMaterial.get(xPath(SCHEMA_PREFIX, tva.e_HowRelated), CG_SCHEMA)
	if (!HowRelated || !HowRelated.attr(tva.a_href)) return false;

	if (HowRelated.attr(tva.a_href).value()==tva.cs_PromotionalStillImage) {
		// Promotional Still Image
		
		let MediaUri=RelatedMaterial.get(xPathM(SCHEMA_PREFIX, [tva.e_MediaLocator, tva.e_MediaUri]), CG_SCHEMA) 
		if (MediaUri) {
			checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, MediaUri, [tva.a_contentType], [], errs, "IRM002")
			if (MediaUri.attr(tva.a_contentType)) {
				let contentType=MediaUri.attr(tva.a_contentType).value()
				if (!isJPEGmime(contentType) && !isPNGmime(contentType)) 
					errs.pushCode("IRM003", tva.a_contentType.attribute(tva.e_MediaUri)+"="+contentType.quote()+" is not valid for a "+errLocation)
			}
			 
			if (!patterns.isHTTPURL(MediaUri.text()))
				errs.pushCode("IRM004", tva.e_MediaUri.elementize()+"="+MediaUri.text().quote()+" is not a valid Image URL", "invalid URL")
		}
		else errs.pushCode("IRM001", tva.e_MediaUri.elementize()+" not specified for Promotional Still Image ("+tva.a_href.attribute(tva.e_HowRelated)+"="+tva.cs_PromotionalStillImage+")")
		return true;
	}
	return false;
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
function ValidateRelatedMaterial(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, minRMelements, maxRMelements, errs) {
	
	if (!BasicDescription) {
		errs.pushCode("RM000", "ValidateRelatedMaterial() called with BasicDescription==null")
		return
	}	
	let rm=0, RelatedMaterial, countRelatedMaterial=0
	while (RelatedMaterial=BasicDescription.get(xPath(SCHEMA_PREFIX, tva.e_RelatedMaterial, ++rm), CG_SCHEMA)) {
		countRelatedMaterial++;
		
		let evaluated=CheckImageRelatedMaterial(CG_SCHEMA, SCHEMA_PREFIX, RelatedMaterial, errs)
	}
	if (countRelatedMaterial > maxRMelements)
		errs.pushCode("RM001", "a maximum of "+maxRMelements+" "+tva.e_RelatedMaterial.elementize()+" element"+(maxRMelements>1?"s are":" is")+" permitted")
}


/**
 * validate the <RelatedMaterial> elements containing pagination links 
 *
 * @param {string}  CG_SCHEMA           Used when constructing Xpath queries
 * @param {string}  SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object}  BasicDescription    the element whose children should be checked
 * @param {Class}   errs                errors found in validaton
 * @param {string}  Location			The location of the Basic Description element
 */
function ValidatePagination(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, errs, Location) {
	
	function checkLinkCount(errs, count, label, errno) {
		if (count>1) {
			errs.pushCode(errno, "more than 1 "+quote(label+" pagination")+" link is specified"); 
			return true;
		}
		return false;
	}
	
	if (!BasicDescription) {
		errs.pushCode("VP000", "ValidatePagination() called with BasicDescription==null")
		return
	}
	let countPaginationFirst=0, countPaginationPrev=0, countPaginationNext=0, countPaginationLast=0
	let rm=0, RelatedMaterial
	while (RelatedMaterial=BasicDescription.get(xPath(SCHEMA_PREFIX, tva.e_RelatedMaterial, ++rm), CG_SCHEMA)) {
		let HowRelated=RelatedMaterial.get(xPath(SCHEMA_PREFIX, tva.e_HowRelated), CG_SCHEMA)
		if (!HowRelated) 
			NoChildElement(errs, tva.e_HowRelated.elementize(), tva.e_RelatedMaterial.elementize(), "VP001")
		else {	
			checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, HowRelated, [tva.a_href], [], errs, "VP002")
			if (HowRelated.attr(tva.a_href))
				switch (HowRelated.attr(tva.a_href).value()) {
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
				}	
			let MediaURI=RelatedMaterial.get(xPathM(SCHEMA_PREFIX, [tva.e_MediaLocator, tva.e_MediaUri]), CG_SCHEMA)
			if (MediaURI) {
				if (!patterns.isHTTPURL(MediaURI.text()))
					errs.pushCode("VP011", tva.e_MediaUri.elementize()+"="+MediaUri.text().quote()+" is not a valid Pagination URL", "invalid URL")
			}
			else
				errs.pushCode("VP010", tva.e_MediaLocator.elementize()+tva.e_MediaUri.elementize()+" not specified for pagination link")
		}
	}

	let linkCountErrs=false
	if (checkLinkCount(errs, countPaginationFirst, "first", "VP011")) linkCountErrs=true;
	if (checkLinkCount(errs, countPaginationPrev, "previous", "VP012")) linkCountErrs=true;
	if (checkLinkCount(errs, countPaginationNext, "next", "VP013")) linkCountErrs=true;
	if (checkLinkCount(errs, countPaginationLast, "last", "VP014")) linkCountErrs=true;

	if (!linkCountErrs) {
		let numPaginations=countPaginationFirst+countPaginationPrev+countPaginationNext+countPaginationLastq
		if (numPaginations!=0 && numPaginations!=2 && numPaginations!=4)
			errs.pushCode("VP020", "only 0, 2 or 4 paginations links may be signalled in "+tva.e_RelatedMaterial.elementize()+" elements for "+Location)
		else if (numPaginations==2) {
			if (countPaginationPrev==1 && countPaginationLast==1) 
				errs.pushCode("VP021", "previous".quote()+" and "+"last".quote()+" links cannot be specified alone");
			if (countPaginationFirst==1 && countPaginationNext==1) 
				errs.pushCode("VP022", "first".quote()+" and "+"next".quote()+" links cannot be specified alone");
		}
	}
}


/**
 * validate the <RelatedMaterial> elements in  More Episodes response
 *
 * @param {string}  CG_SCHEMA           Used when constructing Xpath queries
 * @param {string}  SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object}  BasicDescription    the element whose children should be checked
 * @param {Class}   errs                errors found in validaton
 */
function ValidateRelatedMaterial_MoreEpisodes(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, errs) {
	
	if (!BasicDescription) {
		errs.pushCode("RMME000", "ValidateRelatedMaterial_MoreEpisodes() called with BasicDescription==null")
		return
	}
	switch (BasicDescription.parent().name()) {
		case tva.e_ProgramInformation:
			let rm=0, RelatedMaterial, countRelatedMaterial=0
			while (RelatedMaterial=BasicDescription.get(xPath(SCHEMA_PREFIX, tva.e_RelatedMaterial, ++rm), CG_SCHEMA)) {
				countRelatedMaterial++;
				ValidatePromotionalStillImage(CG_SCHEMA, SCHEMA_PREFIX, RelatedMaterial, errs, BasicDescription.name(), "More Episodes")
			}
			if (countRelatedMaterial > 1)
				errs.pushCode("RMME001", "a maximum of 1 "+tva.e_RelatedMaterial.elementize()+" element is permitted in "+BasicDescription.name().elementize()+" for this request type")	
			break;
		case tva.e_GroupInformation:
			ValidatePagination(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, errs, "More Episodes")
			break;
	}
}


//------------------------------- ERROR TEMPLATES -------------------------------
/**
 * Add an error message when the a required element is not present
 *
 * @param {Object} errs            Errors buffer
 * @param {string} missingElement  Name of the missing element
 * @param {string} parentElement   Name of the element which should contain the missingElement
 * @param {string} schemaLoctation The location in the schema of the element
 * @param {string} errno           The error number to show in the log
 */
function NoChildElement(errs, missingElement, parentElement, schemaLocation=null, errno=null) {
	errs.pushCode(errno?errno:"NC001", missingElement+" element not specified for "+parentElement+ (schemaLocation)?(") in "+schemaLocation):"")
}


/**
 * Add an error message when the @href contains an invalid value
 *
 * @param {Object} errs    Errors buffer
 * @param {string} value   The invalid value for the href attribute
 * @param {string} src     The element missing the @href
 * @param {string} loc     The location of the element
 * @param {string} errno   The error number to show in the log
 */
function InvalidHrefValue(errs, value, src, loc=null, errno=null) {
	errs.pushCode(errno?errno:"HV001", "invalid "+tva.a_href.attribute()+"="+value.quote()+" specified for "+src+(loc)?(" in "+loc):"")
}


/**
 * Add an error message when the MediaLocator does not contain a MediaUri sub-element
 *
 * @param {Object} errs Errors buffer
 * @param {String} src The type of element with the <MediaLocator>
 * @param {String} loc The location of the element
 */
function NoAuxiliaryURI(errs, src, loc, errno=null) {
	NoChildElement(errs, tva.e_AuxiliaryURI.elementize(), src+" "+tva.e_MediaLocator.elementize(), loc, errno?errno:"AU001")
}


/** TemplateAITPromotional Still Image
 *
 * @param {Object} RelatedMaterial   the <RelatedMaterial> element (a libxmls ojbect tree) to be checked
 * @param {Object} errs              The class where errors and warnings relating to the serivce list processing are stored 
 * @param {string} Location          The printable name used to indicate the location of the <RelatedMaterial> element being checked. used for error reporting
 */
function ValidateTemplateAIT(CG_SCHEMA, SCHEMA_PREFIX, RelatedMaterial, errs, Location) {
	
	if (!RelatedMaterial) {
		errs.pushCode("TA000", "ValidateTemplateAIT() called with RelatedMaterial==null")
		return
	}
    let HowRelated=null, Format=null, MediaLocator=[]

	let children=RelatedMaterial.childNodes()
	if (children) children.forEach(elem => {
		if (elem.type()=='element')
			switch (elem.name()) {
				case tva.e_HowRelated:
					HowRelated=elem
					break
				case tva.e_MediaLocator:
					MediaLocator.push(elem)
					break
			}
	})

    if (!HowRelated) {
		NoChildElement(errs, tva.e_HowRelated.elementize(), RelatedMaterial.name(), Location, "TA001")
		return;
    }
	
	checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, HowRelated, [tva.h_href], [], errs, "TA002")
	if (HowRelated.attr(tva.a_href)) {
		if (HowRelated.attr(tva.a_href).value()!=dvbi.TEMPLATE_AIT_URI) 
			errs.pushCode("TA003", tva.a_href.attribute(tva.e_HowRelated)+"="+HowRelated.attr(tva.a_href).value().quote()+" does not designate a Template AIT")
		else {		
			if (MediaLocator.length!=0) 
				MediaLocator.forEach(ml => {
					let subElems=ml.childNodes(), hasAuxiliaryURI=false
					if (subElems) subElems.forEach(child => {
						if (child.type()=='element' && child.name()==tva.e_AuxiliaryURI) {
							hasAuxiliaryURI=true;
							checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, child, [tva.a_contentType], [], errs, "TA010")
							if (child.attr(tva.a_contentType)) {
								let contentType=child.attr(tva.a_contentType).value()
								if (contentType!=dvbi.XML_AIT_CONTENT_TYPE) 
									errs.pushCode("TA011", "invalid "+tva.a_contentType.attribute()+"="+contentType.quote()+" specified for "+RelatedMaterial.name().elementize()+tva.e_MediaLocator.elementize()+" in "+Location)
							}
						}
					});	
					if (!hasAuxiliaryURI) 
						NoAuxiliaryURI(errs, "template AIT", Location, "TA012");
				});
			else 
				NoChildElement(errs, tva.e_MediaLocator.elementize(), RelatedMaterial.name(), Location, "TA013")
		}
	}
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
	
	if (!RelatedMaterial) {
		errs.pushCode("PS000", "ValidatePromotionalStillImage() called with RelatedMaterial==null")
		return
	}
    let HowRelated=null, Format=null, MediaLocator=[]
	let children=RelatedMaterial.childNodes()
	if (children) children.forEach(elem => {
		if (elem.type()=='element')
			switch (elem.name()) {
				case tva.e_HowRelated:
					HowRelated=elem;
					break;
				case tva.e_Format:
					Format=elem;
					break;
				case tva.e_MediaLocator:
					MediaLocator.push(elem);
					break;
			}

	})

    if (!HowRelated) {
		NochildElement(errs, tva.e_HowRelated.elementize(), RelatedMaterial.name(), Location, "PS001")
		return;
    }
	
	checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, HowRelated, [tva.a_href], [], errs, "PS002")
	if (HowRelated.attr(tva.a_href)) {
		if (HowRelated.attr(tva.a_href).value()!=dvbi.PROMOTIONAL_STILL_IMAGE_URI) 
			errs.pushCode("PS010", tva.a_href.attribute(tva.e_HowRelated)+"="+HowRelated.attr(tva.a_href).value().quote()+" does not designate a Promotional Still Image")
		else {
			if (Format) {
				let subElems=Format.childNodes(), hasStillPictureFormat=false
				if (subElems) subElems.forEach(child => {
					if (child.type()=='element' && child.name()==tva.e_StillPictureFormat) {
						hasStillPictureFormat=true;
						
						checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, child, [tva.a_horizontalSize, tva.a_verticalSize, tva.a_href], [], errs, "PS021");
						
						if (child.attr(tva.a_href)) {
							let href=child.attr(tva.a_href).value()
							if (href!=JPEG_IMAGE_CS_VALUE && href!=PNG_IMAGE_CS_VALUE) 
								InvalidHrefValue(errs, href, RelatedMaterial.name()+"."+tva.e_Format+"."+tva.e_StillPictureFormat, Location, "PS022")
							if (href==JPEG_IMAGE_CS_VALUE) isJPEG=true;
							if (href==PNG_IMAGE_CS_VALUE) isPNG=true;
						}
					}
				});
				if (!hasStillPictureFormat) 
					NoChildElement(errs, tva.e_StillPictureFormat.elementize(), tva.e_Format, Location, "PS023")
			}

			if (MediaLocator.length!=0) 
				MediaLocator.forEach(ml => {
					let subElems=ml.childNodes(), hasMediaURI=false
					if (subElems) subElems.forEach(child => {
						if (child.type()=='element' && child.name()==tva.e_MediaUri) {
							hasMediaURI=true;
							checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, child, [tva.a_contentTyoe], [], errs, "PS031")
							if (child.attr(tva.a_contentType)) {
								let contentType=child.attr(tva.a_contentType).value()
								if (!isJPEGmime(contentType) && !isPNGmime(contentType)) 
									errs.pushCode("PS032", "invalid "+tva.a_contentType.attribute(tva.e_MediaLocator)+"="+contentType.quote()+" specified for "+RelatedMaterial.name().elementize()+" in "+Location)
								if (Format && ((isJPEGmime(contentType) && !isJPEG) || (isPNGmime(contentType) && !isPNG))) 
									errs.pushCode("PS033", "conflicting media types in "+tva.e_Format.elementize()+" and "+tva.e_MediaUri.elementize()+" for "+Location)
							}
							if (!patterns.isHTTPURL(child.text()))
								errs.pushCode("PS034", tva.e_MediaUri.elementize()+"="+child.text().quote()+" is not a valid Image URL", "invalid URL")
						}
					});
					if (!hasMediaURI) 
						NoMediaLocator(errs, "logo", Location);
				});
			else 
				NoChildElement(errs, tva.e_MediaLocator, RelatedMaterial.name().elementize(), Location, "PS039")
		}
	}
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
function ValidateRelatedMaterial_BoxSetList(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, errs, Location) {
	
	if (!BasicDescription) {
		errs.pushCode("MB000", "ValidateRelatedMaterial_BoxSetList() called with BasicDescription==null")
		return
	}
	let countImage=0, countTemplateAIT=0, hasPagination=false
	let rm=0, RelatedMaterial
	while (RelatedMaterial=BasicDescription.get(xPath(SCHEMA_PREFIX, tva.e_RelatedMaterial, ++rm), CG_SCHEMA)) {
		let HowRelated=RelatedMaterial.get(xPath(SCHEMA_PREFIX, tva.e_HowRelated), CG_SCHEMA)
		if (!HowRelated) 
			NoChildElement(errs, tva.e_HowRelated.elementize(), tva.e_RelatedMaterial.elementize())
		else {		
			checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, HowRelated, [tva.a_href], [], errs, "MB010")
			if (HowRelated.attr(tva.a_href)) {
				let hrHref=HowRelated.attr(tva.a_href).value()
				switch (hrHref) {
					case dvbi.TEMPLATE_AIT_URI:
						countTemplateAIT++;
						ValidateTemplateAIT(CG_SCHEMA, SCHEMA_PREFIX, RelatedMaterial, errs, BasicDescription.name().elementize())
						break;
					case dvbi.PAGINATION_FIRST_URI:
					case dvbi.PAGINATION_PREV_URI:
					case dvbi.PAGINATION_NEXT_URI:
					case dvbi.PAGINATION_LAST_URI:
						// pagination links are allowed, but checked in ValidatePagination()
						hasPagination=true;
						break;
					case dvbi.PROMOTIONAL_STILL_IMAGE_URI:  // promotional still image
						countImage++;
						ValidatePromotionalStillImage(CG_SCHEMA, SCHEMA_PREFIX, RelatedMaterial, errs, BasicDescription.name().elementize())
						break;
					default:
						InvalidHrefValue(errs, hrHref, tva.e_HowRelated.elementize(), tva.e_RelatedMaterial.elementize()+" in Box Set List", "MB011")
				}	
			}
		}
	}
	if (countTemplateAIT==0)
		errs.pushCode("MB021", "a "+tva.e_RelatedMaterial.elementize()+" element signalling the Template XML AIT must be specified for a Box Set List")
	if (countTemplateAIT>1)
		errs.pushCode("MB022", "only one "+tva.e_RelatedMaterial.elementize()+" element signalling the Template XML AIT can be specified for a Box Set List")
	if (countImage>1)
		errs.pushCode("MB023", "only one "+tva.e_RelatedMaterial.elementize()+" element signalling the promotional still image can be specified for a Box Set List")
	
	if (hasPagination)
		ValidatePagination(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, errs, "Box Set List");
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
	
	if (!BasicDescription) {
		errs.pushCode("VT000", "ValidateTitle() called with BasicDescription==null")
		return
	}
	
	let mainSet=[], secondarySet=[]
	let t=0, Title
	while (Title=BasicDescription.get(xPath(SCHEMA_PREFIX, tva.e_Title, ++t), CG_SCHEMA)) {

		checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, Title, [tva.a_type], [tva.a_lang], errs, errCode?errCode+"-1":"VT001");
		
		let titleType=Title.attr(tva.a_type) ? Title.attr(tva.a_type).value() : "unspecified"
		let titleLang=GetLanguage(knownLanguages, errs, Title, parentLanguage, false, "VT002")
		let titleStr=unEntity(Title.text())
		
		if (titleStr.length > dvbi.MAX_TITLE_LENGTH)
			errs.pushCode(errCode?errCode+"-11":"VT011", tva.e_Title.elementize()+" length exceeds "+dvbi.MAX_TITLE_LENGTH+" characters")
			
		switch (titleType) {
			case dvbi.TITLE_MAIN_TYPE:
				if (isIn(mainSet, titleLang))
					errs.pushCode(errCode?errCode+"-12":"VT012", "only a single language ("+titleLang+") is permitted for "+tva.a_type.attribute(tva.e_Title)+"="+dvbi.TITLE_MAIN_TYPE.quote())
				else mainSet.push(titleLang)
				break
			case dvbi.TITLE_SECONDARY_TYPE:
				if (allowSecondary) {
					if (isIn(secondarySet, titleLang))
						errs.pushCode(errCode?errCode+"-13":"VT013", "only a single language ("+titleLang+") is permitted for "+tva.a_type.attribute(tva.e_Title)+"="+dvbi.TITLE_SECONDARY_TYPE.quote())
					else secondarySet.push(titleLang)
				}
				else 
					errs.pushCode(errCode?errCode+"-14":"VT014", tva.a_type.attribute(tva.e_Title)+"="+dvbi.TITLE_SECONDARY_TYPE.quote()+" is not permitted for this "+BasicDescription.name().elementize())
				break
			default:	
				errs.pushCode(errCode?errCode+"-15":"VT015", tva.a_type.attribute()+" must be "+dvbi.TITLE_MAIN_TYPE.quote()+" or "+dvbi.TITLE_SECONDARY_TYPE.quote()+" for "+tva.e_Title.elementize())
		}	
		
		
		secondarySet.forEach(lang => {
			if (!isIn(mainSet, lang)) {
				let tLoc= lang!=DEFAULT_LANGUAGE ? " for @xml:"+tva.a_lang+"="+lang.quote() : ""
				errs.pushCode(errCode?errCode+"-16":"VT016", tva.a_type.attribute()+"="+dvbi.TITLE_SECONDARY_TYPE.quote()+" specified without "+tva.a_type.attribute()+"="+dvbi.TITLE_MAIN_TYPE.quote()+tLloc)
			}
		});
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

	if (!parentElement) {
		errs.pushCode("BD000", "ValidateBasicDescription() called with parentElement==null")
		return;
	}

	let isParentGroup=parentElement==categoryGroup
	let BasicDescription=parentElement.get(xPath(SCHEMA_PREFIX, tva.e_BasicDescription), CG_SCHEMA)
	if (!BasicDescription) {
		NoChildElement(errs, tva.e_BasicDescription.elementize(), parentElement.name())
		return;
	}

	switch (parentElement.name()) {
		case tva.e_ProgramInformation:
			switch (requestType) {
				case CG_REQUEST_SCHEDULE_NOWNEXT:  //6.10.5.2
				case CG_REQUEST_SCHEDULE_WINDOW:
				case CG_REQUEST_SCHEDULE_TIME:
					checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [tva.e_Title, tva.e_Synopsis], [tva.e_Genre, tva.e_ParentalGuidance, tva.e_RelatedMaterial], errs, "BD010");	
					ValidateTitle(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, true, errs, parentLanguage);
					ValidateSynopsis(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [tva.SYNOPSIS_MEDIUM_LABEL], [tva.SYNOPSIS_SHORT_LABEL], requestType, errs, parentLanguage);
					ValidateGenre(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, 0, 1, errs);
					ValidateParentalGuidance(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, 0, 2, errs);
					ValidateRelatedMaterial(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription,  0, 1, errs);
					break;
				case CG_REQUEST_PROGRAM:	// 6.10.5.3
					checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [tva.e_Title, tva.e_Synopsis], [tva.e_Keyword, tva.e_Genre, tva.e_ParentalGuidance, tva.e_CreditsList, tva.e_RelatedMaterial], errs, "BD020");
					ValidateTitle(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, true, errs, parentLanguage);
					ValidateSynopsis(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [tva.SYNOPSIS_MEDIUM_LABEL], [tva.SYNOPSIS_SHORT_LABEL, tva.SYNOPSIS_LONG_LABEL], requestType, errs, parentLanguage);
					ValidateKeyword(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, 0, 20, errs, parentLanguage);
					ValidateGenre(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, 0, 1, errs);
					ValidateParentalGuidance(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, 0, 2, errs);	
					ValidateCreditsList(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription,  errs);	
					ValidateRelatedMaterial(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription,  0, 1, errs);						
					break;
				case CG_REQUEST_BS_CONTENTS:  // 6.10.5.4					
					checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [tva.e_Title], [tva.e_Synopsis, tva.e_ParentalGuidance, tva.e_RelatedMaterial], errs, "BD030");
					ValidateTitle(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, true, errs, parentLanguage);
					ValidateSynopsis(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [], [tva.SYNOPSIS_MEDIUM_LABEL], requestType, errs, parentLanguage);
					ValidateParentalGuidance(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, 0, 2, errs);
					ValidateRelatedMaterial(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription,  0, 1, errs);
					break;
				case CG_REQUEST_MORE_EPISODES:
					checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [tva.e_Title], [tva.e_RelatedMaterial], errs, "BD040");
					ValidateRelatedMaterial_MoreEpisodes(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, errs);
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
					else checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [tva.e_Title, tva.e_Synopsis], [tva.e_Keyword, tva.e_RelatedMaterial], errs, "BD062");
					
					ValidateTitle(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, false, errs, parentLanguage);						
					if (!isParentGroup) {
						ValidateSynopsis(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [tva.SYNOPSIS_MEDIUM_LABEL], [], requestType, errs, parentLanguage);
						ValidateKeyword(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, 0, 20, errs, parentLanguage);
						ValidateRelatedMaterial_BoxSetList(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, errs);
					}
			break;
				case CG_REQUEST_MORE_EPISODES: 
					checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [], [tva.e_RelatedMaterial], errs, "BD070");	
					ValidateRelatedMaterial_MoreEpisodes(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, errs);
					break;
				case CG_REQUEST_BS_CATEGORIES:
					if (isParentGroup) 
						checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [tva.e_Title], [], errs, "BD080");	
					else 
						checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [tva.e_Title, tva.e_Synopsis], [tva.e_Genre, tva.e_RelatedMaterial], errs, "BD081");
					ValidateTitle(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, false, errs, parentLanguage);
					if (!isParentGroup)
						ValidateSynopsis(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [tva.SYNOPSIS_SHORT_LABEL], [], requestType, errs, parentLanguage);
					ValidateGenre(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, 0, 1, errs);
					ValidateRelatedMaterial(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription,  0, 1, errs);
					break;
				// default:
				//	errs.pushCode("BD100", "ValidateBasicDescription() called with invalid requestType/element ("+requestType+"/"+parentElement.name()+")");
				}
			break;
		default:
			errs.pushCode("BD003", "ValidateBasicDescription() called with invalid element ("+parentElement.name()+")");		
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
 * @param {array}  indexes             array of @index values from other elements in the same table - for duplicate detection
 * @param {Class}  errs                errors found in validaton
 */
function ValidateProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramInformation, parentLanguage, programCRIDs, groupCRIDs, requestType, indexes, errs) {
	
	if (!ProgramInformation) {
		errs.pushCode("PI000", "ValidateProgramInformation() called with ProgramInformation==null")
		return null;
	}
	
	checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, ProgramInformation, [tva.e_BasicDescription], [tva.e_OtherIdentifier, tva.e_MemberOf, tva.e_EpisodeOf], errs, "PI001");
	
	checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, ProgramInformation, [tva.a_programId], [tva.a_lang], errs, "PI002")

	let piLang=GetLanguage(knownLanguages, errs, ProgramInformation, parentLanguage, false, "PI010")
	let isCurrentProgram=false, programCRID=null
	
	if (ProgramInformation.attr(tva.a_programId)) {
		programCRID=ProgramInformation.attr(tva.a_programId).value();
		if (!isCRIDURI(programCRID)) 
			errs.pushCode("PI011", tva.a_programId.attribute(ProgramInformation.name())+" is not a valid CRID ("+programCRID+")");
		if (isIni(programCRIDs, programCRID))
			errs.pushCode("PI012", tva.a_programId.attribute(ProgramInformation.name())+"="+programCRID.quote()+" is already used");
		else programCRIDs.push(programCRID);
	}

	// <ProgramInformation><BasicDescription>
	ValidateBasicDescription(CG_SCHEMA, SCHEMA_PREFIX, ProgramInformation, requestType, errs, piLang, null);

	let children=ProgramInformation.childNodes()
	if (children) children.forEach(child => {
		if (child.type()=="element") {
			switch (child.name()) {
				case tva.e_OtherIdentifier:		// <ProgramInformation><OtherIdentifier>
					if (requestType==CG_REQUEST_MORE_EPISODES)
						errs.pushCode("PI021", tva.e_OtherIdentifier.elementize()+" is not permitted in this request type")
					break;
				case tva.e_EpisodeOf:			// <ProgramInformation><EpisodeOf>
					checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, child, [tva.a_crid], [], errs, "PI031");
					
					// <ProgramInformation><EpisodeOf>@crid
					if (child.attr(tva.a_crid)) {
						let foundCRID=child.attr(tva.a_crid).value()
						if (groupCRIDs && !isIni(groupCRIDs, foundCRID)) 
							errs.pushCode("PI032", tva.a_crid.attribute(ProgramInformation.name()+"."+tva.e_EpisodeOf)+"="+foundCRID.quote()+" is not a defined Group CRID for "+tva.e_EpisodeOf.elementize())
						else
							if (!isCRIDURI(foundCRID))
								errs.pushCode("PI033", tva.a_crid.attribute(ProgramInformation.name()+"."+tva.e_EpisodeOf)+"="+foundCRID.quote()+" is not a valid CRID")
					}
					break;
				case tva.e_MemberOf:			// <ProgramInformation><MemberOf>
					switch (requestType) {
						case CG_REQUEST_SCHEDULE_NOWNEXT:  // xsi:type is optional for Now/Next
						case CG_REQUEST_SCHEDULE_WINDOW:
							checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, child, [tva.a_index, tva.a_crid], [tva.a_type], errs, "PI041");
							if (child.attr(tva.a_crid) && child.attr(tva.a_crid).value()==dvbi.CRID_NOW)
									isCurrentProgram=true
							break;
						default:
							checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, child, [tva.a_type, tva.a_index, tva.a_crid], [], errs, "PI042");
					}
							
					// <ProgramInformation><MemberOf>@xsi:type
					if (child.attr(tva.a_type) && child.attr(tva.a_type).value()!=tva.t_MemberOfType)
						errs.pushCode("PI043", attribute("xsi:"+tva.a_type)+" must be "+tva.t_MemberOfType.quote()+" for "+ProgramInformation.name()+"."+tva.e_MemberOf)
				
					// <ProgramInformation><MemberOf>@crid
					let foundCRID=null
					if (child.attr(tva.a_crid)) {
						foundCRID=child.attr(tva.a_crid).value();
						if (groupCRIDs && !isIni(groupCRIDs, foundCRID)) 
							errs.pushCode("PI044", tva.a_crid.attribute(ProgramInformation.name()+"."+tva.e_MemberOf)+"="+foundCRID.quote()+" is not a defined Group CRID for "+tva.e_MemberOf.elementize())
						else
							if (!isCRIDURI(foundCRID))
								errs.pushCode("PI045", tva.a_crid.attribute(ProgramInformation.name()+"."+tva.e_MemberOf)+"="+foundCRID.quote()+" is not a valid CRID")
					}
					
					// <ProgramInformation><MemberOf>@index
					if (child.attr(tva.a_index)) {
						let index=valUnsignedInt(child.attr(tva.a_index).value())
						let indexInCRID=(foundCRID?foundCRID:"noCRID")+"("+index+")"
						if (isIni(indexes, indexInCRID))
							errs.pushCode("PI046", tva.a_index.attribute(tva.e_MemberOf)+"="+index+" is in use by another "+ProgramInformation.name()+" element")
						else 
							indexes.push(indexInCRID);
					}
					break;			
			}	
		}
	})

	return isCurrentProgram?programCRID:null;
}


/**
 * find and validate any <ProgramInformation> elements in the <ProgramInformationTable>
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} ProgramDescription  the element containing the <ProgramInformationTable>
 * @param {string} parentLang          XML language of the parent element (or its parent(s))
 * @param {array}  programCRIDs        array to record CRIDs for later use 
 * @param {array}  groupCRIDs          array of CRIDs found in the GroupInformationTable (null if not used)
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 * @param {integer} o.childCount       the number of child elements to be present (to match GroupInformation@numOfItems)
 * @returns {string} the CRID of the currently airing program (that which is a member of the "now" structural crid)
 */
function CheckProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, parentLang, programCRIDs, groupCRIDs, requestType, errs, o=null) { 
	if (!ProgramDescription) {
		errs.pushCode("PI100", "CheckProgramInformation() called with ProgramDescription==null");
		return null;
	}
		
	let ProgramInformationTable=ProgramDescription.get(xPath(SCHEMA_PREFIX, tva.e_ProgramInformationTable), CG_SCHEMA)
	if (!ProgramInformationTable) {
		errs.pushCode("PI101", tva.e_ProgramInformationTable.elementize()+" not specified in "+ProgramDescription.name().elementize())
		return null;
	}
	checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, ProgramInformationTable, [], [tva.a_lang], errs, "PI102");
	let pitLang=GetLanguage(knownLanguages, errs, ProgramInformationTable, parentLang, false, "PI103")

	let pi=0, ProgramInformation, cnt=0, indexes=[], currentProgramCRID=null
	while (ProgramInformation=ProgramInformationTable.get(xPath(SCHEMA_PREFIX, tva.e_ProgramInformation, ++pi), CG_SCHEMA)) {
		let t=ValidateProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramInformation, pitLang, programCRIDs, groupCRIDs, requestType, indexes, errs)
		if (t) currentProgramCRID=t;
		cnt++; 
	}

	if (o && o.childCount!=0) {
		if (o.childCount!=cnt)
			errs.pushCode("PI110", "number of items ("+cnt+") in "+tva.e_ProgramInformationTable.elementize()+" does match "+tva.a_numOfItems.attribute(tva.e_GroupInformation)+" specified in "+CATEGORY_GROUP_NAME+" ("+o.childCount+")")
	}
	return currentProgramCRID;
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

	if (!GroupInformation) {
		errs.pushCode("GIB000", "ValidateGroupInformationBoxSets() called with GroupInformation==null")
		return;
	}
	let isParentGroup=GroupInformation==categoryGroup
	
	switch (requestType) {
		case CG_REQUEST_BS_CATEGORIES:
			if (isParentGroup) 
				checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, [tva.a_groupId], [tva.a_lang, tva.a_ordered, tva.a_numOfItems], errs, "GIB001")
			else checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, [tva.a_groupId], [tva.a_lang], errs, "GIB002")
			break;
		case CG_REQUEST_BS_LISTS:
			if (isParentGroup) 
				checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, [tva.a_groupId], [tva.a_lang, tva.a_ordered, tva.a_numOfItems], errs, "GIB003")
			else checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, [tva.a_groupId], [tva.a_lang, tva.a_serviceIDRef], errs, "GIB004")
			break;
		case CG_REQUEST_BS_CONTENTS:
			checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, [tva.a_groupId], [tva.a_lang, tva.a_ordered, tva.a_numOfItems, tva.a_serviceIDRef], errs, "GIB005")
			break;
	}

	if (GroupInformation.attr(tva.a_groupId)) {
		let groupId=GroupInformation.attr(tva.a_groupId).value()
		if (isCRIDURI(groupId)) {
			if (groupsFound) 
				groupsFound.push(groupId);				
		}
		else
			errs.pushCode("GIB006", tva.a_groupId.attribute(GroupInformation.name())+" value "+groupId.quote()+" is not a CRID")
	}

	let categoryCRID=(categoryGroup && categoryGroup.attr(tva.a_groupId)) ? categoryGroup.attr(tva.a_groupId).value() : ""

	if (requestType==CG_REQUEST_BS_LISTS || requestType==CG_REQUEST_BS_CATEGORIES) {
		if (!isParentGroup && GroupInformation.attr(tva.a_ordered)) 
			errs.pushCode("GIB010", tva.a_ordered.attribute(GroupInformation.name())+" is only permitted in the "+CATEGORY_GROUP_NAME);
		if (isParentGroup && !GroupInformation.attr(tva.a_ordered)) 
			errs.pushCode("GIB011", tva.a_ordered.attribute(GroupInformation.name())+" is required for this request type")
		if (!isParentGroup && GroupInformation.attr(tva.a_numOfItems)) 
			errs.pushCode("GIB012", tva.a_numOfItems.attribute(GroupInformation.name())+" is only permitted in the "+CATEGORY_GROUP_NAME);
		if (isParentGroup && !GroupInformation.attr(tva.a_numOfItems)) 
			errs.pushCode("GIB013", tva.a_numOfItems.attribute(GroupInformation.name())+" is required for this request type")
	}

	if (!isParentGroup) {
		let MemberOf=GroupInformation.get(xPath(SCHEMA_PREFIX, tva.e_MemberOf), CG_SCHEMA)
		if (MemberOf) {
			checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, MemberOf, [tva.a_type, tva.a_index, tva.a_crid], [], errs, "GIB020")
			if (MemberOf.attr(tva.a_type) && MemberOf.attr(tva.a_type).value()!=tva.t_MemberOfType)
				errs.pushCode("GIB021", GroupInformation.name()+"."+tva.e_MemberOf+"@xsi:"+tva.a_type+" is invalid ("+MemberOf.attr(tva.a_type).value().quote()+")")
			
			if (MemberOf.attr(tva.a_index)) {
				let index=valUnsignedInt(MemberOf.attr(tva.a_index).value())
				if (index>=1) {
					if (indexes) {
						if (isIn(indexes, index)) 
							errs.pushCode("GI022", "duplicated "+tva.a_index.attribute(GroupInformation.name()+"."+tva.e_MemberOf)+" values ("+index+")");
						else indexes.push(index);
					}
				}
				else 
					errs.pushCode("GIB023", tva.a_index.attribute(GroupInformation.name()+"."+tva.e_MemberOf)+" must be an integer >= 1 (parsed "+index+")")
			}

			if (MemberOf.attr(tva.a_crid) && MemberOf.attr(tva.a_crid).value()!=categoryCRID)
				errs.pushCode("GIB025", tva.a_crid.attribute(GroupInformation.name()+"."+tva.e_MemberOf)+" ("+MemberOf.attr(tva.a_crid).value()+") does not match the "+CATEGORY_GROUP_NAME+" crid ("+categoryCRID+")");
		}
		else
			errs.pushCode("GIB027", GroupInformation.name()+" requires a "+tva.e_MemberOf.elementize()+" element referring to the "+CATEGORY_GROUP_NAME+" ("+categoryCRID+")")
	}
	
	checkTAGUri(GroupInformation, errs, "GIB030");	
	
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

	if (!GroupInformation) {
		errs.pushCode("GIS000", "ValidateGroupInformationSchedules() called with GroupInformation==null")
		return;
	}
	checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, [tva.a_groupId, tva.a_ordered, tva.a_numOfItems], [tva.a_lang], errs, "GIS001")

	if (GroupInformation.attr(tva.a_groupId)) {
		let groupId=GroupInformation.attr(tva.a_groupId).value()
		if (requestType==CG_REQUEST_SCHEDULE_NOWNEXT || requestType==CG_REQUEST_SCHEDULE_WINDOW) {
			if (groupId!=dvbi.CRID_NOW && groupId!=dvbi.CRID_LATER && groupId!=dvbi.CRID_EARLIER )
				errs.pushCode("GIS011", tva.a_groupId.attribute(GroupInformation.name())+" value "+groupId.quote()+" is valid for this request type")
		}
	}

	if (requestType==CG_REQUEST_SCHEDULE_NOWNEXT || requestType==CG_REQUEST_SCHEDULE_WINDOW) {		
		TrueValue(GroupInformation, tva.a_ordered, "GIS013", errs)
		if (!GroupInformation.attr(tva.a_numOfItems)) 
			errs.pushCode("GIS015", tva.a_numOfItems.attribute(GroupInformation.name())+" is required for this request type")
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
	
	if (!GroupInformation) {
		errs.pushCode("GIM000", "ValidateGroupInformationMoreEpisodes() called with GroupInformation==null")
		return;
	}
	if (categoryGroup) 
		errs.pushCode("GIM001", CATEGORY_GROUP_NAME+" should not be specified for this request type")
	
	checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, [tva.a_groupId, tva.a_ordered, tva.a_numOfItems], [tva.a_lang], errs, "GIM002")
	
	if (GroupInformation.attr(tva.a_groupId)) {
		let groupId=GroupInformation.attr(tva.a_groupId).value()
		if (!isCRIDURI(groupId)) 
			errs.pushCode("GIM003", tva.a_groupId.attribute(GroupInformation.name())+" value "+groupId.quote()+" is not a valid CRID")
		else 
			groupsFound.push(groupId);
	}

	TrueValue(GroupInformation, tva.a_ordered, "GIM004", errs, false)
	
	let GroupType=GroupInformation.get(xPath(SCHEMA_PREFIX, tva.e_GroupType), CG_SCHEMA)
	if (GroupType) {
		checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, GroupType, [tva.a_type, tva.a_value], [], errs, "GIM011")
		
		if (GroupType.attr(tva.a_type) && GroupType.attr(tva.a_type).value()!=tva.t_ProgramGroupTypeType) 
			errs.pushCode("GIM012", tva.e_GroupType+"@xsi:"+tva.a_type+" must be "+tva.t_ProgramGroupTypeType.quote())
		if (GroupType.attr(tva.a_value) && GroupType.attr(tva.a_value).value()!="otherCollection") 
			errs.pushCode("GIM013", tva.a_value.attribute(tva.e_GroupType)+" must be "+"otherCollection".quote())
	}
	else
		errs.pushCode("GIM014", tva.e_GroupType.elementize()+" is required in "+GroupInformation.name().elementize())

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
		errs.pushCode("GI000", "ValidateGroupInformation() called with GroupInformation==null");
		return;
	}

	let giLang=GetLanguage(knownLanguages, errs, GroupInformation, parentLanguage, false, "GI001")
	
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

	let GroupType=GroupInformation.get(xPath(SCHEMA_PREFIX, tva.e_GroupType), CG_SCHEMA)
	if (GroupType) {
		if (!(GroupType.attr(tva.a_type) && GroupType.attr(tva.a_type).value()==tva.t_ProgramGroupTypeType)) 
			errs.pushCode("GI011", tva.e_GroupType+"@xsi:"+tva.a_type+"="+tva.t_ProgramGroupTypeType.quote()+" is required")
		if (!(GroupType.attr(tva.a_value) && GroupType.attr(tva.a_value).value()=="otherCollection")) 
			errs.pushCode("GI022", tva.a_value.attribute(tva.e_GroupType)+"="+"otherCollection".quote()+" is required")
	}
	else
		errs.pushCode("GI014", tva.e_GroupType.elementize()+" is required in "+GroupInformation.name().elementize());
}


/**
 * find and validate any <GroupInformation> elements in the <GroupInformationTable>
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} ProgramDescription  the element containing the <ProgramInformationTable>
 * @param {string} parentLang          XML language of the parent element (or its parent(s))
 * @param {string} requestType         the type of content guide request being checked
 * @param {array}  groupIds            buffer to recieve the group ids parsed (null if not needed)
 * @param {Class}  errs                errors found in validaton
 * @param {integer} o.childCount       the value from the @numItems attribute of the "category group"
 */
function CheckGroupInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, parentLang, requestType, groupIds, errs, o) { 
	
	if (!ProgramDescription) {
		errs.pushCode("GI100", "CheckGroupInformation() called with ProgramDescription==null")
		return
	}
	let gi, GroupInformation
	let GroupInformationTable=ProgramDescription.get(xPath(SCHEMA_PREFIX, tva.e_GroupInformationTable), CG_SCHEMA)
	
	if (!GroupInformationTable) {
		errs.pushCode("GI101", tva.e_GroupInformationTable.elementize()+" not specified in "+ProgramDescription.name().elementize())
		return;
	}
	let gitLang=GetLanguage(knownLanguages, errs, GroupInformationTable, parentLang, false, "GI102")

	// find which GroupInformation element is the "category group"
	let categoryGroup=null
	if (requestType==CG_REQUEST_BS_LISTS || requestType==CG_REQUEST_BS_CATEGORIES || requestType==CG_REQUEST_BS_CONTENTS) {
		gi=0;
		while (GroupInformation=GroupInformationTable.get(xPath(SCHEMA_PREFIX, tva.e_GroupInformation, ++gi), CG_SCHEMA)) {
			// this GroupInformation element is the "category group" if it does not contain a <MemberOf> element
			if (CountChildElements(GroupInformation, tva.e_MemberOf)==0) {
				// this GroupInformation element is not a member of another GroupInformation so it must be the "category group"
				if (categoryGroup)
					errs.pushCode("GI111", "only a single "+CATEGORY_GROUP_NAME+" can be present in "+tva.e_GroupInformationTable.elementize())
				else categoryGroup=GroupInformation;
			}
		}
		if (!categoryGroup)
			errs.pushCode("GI112", "a "+CATEGORY_GROUP_NAME+" must be specified in "+tva.e_GroupInformationTable.elementize()+" for this request type")
	}
	
	let indexes=[], giCount=0
	gi=0;
	while (GroupInformation=GroupInformationTable.get(xPath(SCHEMA_PREFIX, tva.e_GroupInformation, ++gi), CG_SCHEMA)) {
		ValidateGroupInformation(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, requestType, errs, gitLang, categoryGroup, indexes, groupIds);
		if (GroupInformation!=categoryGroup) 
			giCount++;
	}
	if (categoryGroup) {
		let numOfItems=(categoryGroup.attr(tva.a_numOfItems) ? valUnsignedInt(categoryGroup.attr(tva.a_numOfItems).value()) : 0)
		if (requestType!=CG_REQUEST_BS_CONTENTS && numOfItems!=giCount)
			errs.pushCode("GI113", tva.a_numOfItems.attribute(tva.e_GroupInformation)+" specified in "+CATEGORY_GROUP_NAME+" ("+numOfItems+") does match the number of items ("+giCount+")");

		if (o) 
			o.childCount=numOfItems;
	}

	if (requestType==CG_REQUEST_MORE_EPISODES && giCount>1)
		errs.pushCode("GI114", "only one "+tva.e_GroupInformation+" element is premitted for this request type");
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
			errs.pushCode("VNN101", tva.a_numOfItems.attribute(tva.e_GroupInformation)+" must be > 0 for "+grp.quote());			
		if (numOfItems>numAllowed)
			errs.pushCode("VNN102", tva.a_numOfItems.attribute(tva.e_GroupInformation)+" must be <= "+numAllowed+" for "+grp.quote());
	}
	
	if (!GroupInformation) {
		errs.pushCode("VNN000", "ValidateGroupInformationNowNext() called with GroupInformation==null");
		return
	}

	// NOWNEXT and WINDOW GroupInformationElements contains the same syntax as other GroupInformationElements
	ValidateGroupInformation(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, requestType, errs, parentLanguage, null, null, null );
	
	if (GroupInformation.attr(tva.a_groupId)) {
		let grp=GroupInformation.attr(tva.a_groupId).value()
		if ((grp==dvbi.CRID_EARLIER && numEarlier>0) || (grp==dvbi.CRID_NOW && numNow>0) || (grp==dvbi.CRID_LATER && numLater>0)) {
			let numOfItems=GroupInformation.attr(tva.a_numOfItems)?valUnsignedInt(GroupInformation.attr(tva.a_numOfItems).value()):-1
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
			if (isIni(groupCRIDsFound, grp))
				errs.pushCode("VNN001", "only a single "+grp.quote()+" structural CRID is premitted in this request")
			else 
				groupCRIDsFound.push(grp);
		}
		else 
			errs.pushCode("VNN002", tva.e_GroupInformation.elementize()+" for "+grp.quote()+" is not permitted for this request type")
	}
}


/**
 * find and validate any <GroupInformation> elements used for now/next in the <GroupInformationTable>
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} ProgramDescription  the element containing the <ProgramInformationTable>
 * @param {string} parentLang          XML language of the parent element (or its parent(s))
 * @param {array}  groupIds            array of GroupInformation@CRID values found
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 */
function CheckGroupInformationNowNext(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, parentLang, groupIds, requestType, errs) { 
	
	if (!ProgramDescription) {
		errs.pushCode("NN000", "CheckGroupInformationNowNext() called with ProgramDescription==null")
		return
	}
	
	let GroupInformationTable=ProgramDescription.get(xPath(SCHEMA_PREFIX, tva.e_GroupInformationTable), CG_SCHEMA)
	if (!GroupInformationTable) {
		errs.pushCode("NN001", tva.e_GroupInformationTable.elementize()+" not specified in "+ProgramDescription.name().elementize())
		return;
	}
	let gitLang=GetLanguage(knownLanguages, errs, GroupInformationTable, parentLang, false, "NN002")
	
	let gi=0, GroupInformation
	while (GroupInformation=GroupInformationTable.get(xPath(SCHEMA_PREFIX,tva.e_GroupInformation, ++gi), CG_SCHEMA)) {	
		switch (requestType) {
			case CG_REQUEST_SCHEDULE_NOWNEXT:
				ValidateGroupInformationNowNext(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, requestType, errs, gitLang, 0, 1, 1, groupIds);
				break;
			case CG_REQUEST_SCHEDULE_WINDOW:
				ValidateGroupInformationNowNext(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, requestType, errs, gitLang, 10, 1, 10, groupIds);
				break;
			default:
				errs.pushCode("NN003", tva.e_GroupInformation.elementize()+" not processed for this request type")
		}
	}
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
		return mixType==mpeg7.AUDIO_MIX_MONO || mixType==mpeg7.AUDIO_MIX_STEREO || mixType==mpeg7.AUDIO_MIX_5_1;
	}
	function isValidAudioLanguagePurpose(purpose) {
		return purpose==dvbi.AUDIO_PURPOSE_MAIN || purpose==dvbi.AUDIO_PURPOSE_DESCRIPTION;
	}
	
	if (!AVAttributes) {
		errs.pushCode("AV000", "ValidateAVAttributes() called with AVAttributes==null")
		return		
	}
	
	checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, AVAttributes, [], [tva.e_AudioAttributes, tva.e_VideoAttributes, tva.e_CaptioningAttributes], errs, "AV001");

	// <AudioAttributes>
	let aa=0, AudioAttributes, foundAttributes=[], audioCounts=[]
	while (AudioAttributes=AVAttributes.get(xPath(SCHEMA_PREFIX, tva.e_AudioAttributes, ++aa), CG_SCHEMA)) {
		checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, AudioAttributes, [], [tva.e_MixType, tva.e_AudioLanguage], errs, "AV010");

		let MixType=AudioAttributes.get(xPath(SCHEMA_PREFIX, tva.e_MixType), CG_SCHEMA)
		if (MixType) {
			checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, MixType, [tva.a_href], [], errs, "AV011"); 
			if (MixType.attr(tva.a_href) && !isValidAudioMixType(MixType.attr(tva.a_href).value()))
				errs.pushCode("AV012", tva.e_AudioAttributes+"."+tva.e_MixType+" is not valid");
		}
				
		let AudioLanguage=AudioAttributes.get(xPath(SCHEMA_PREFIX, tva.e_AudioLanguage), CG_SCHEMA)
		if (AudioLanguage) {
			checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, AudioLanguage, [tva.a_purpose], [], errs, "AV013" )
			let validLanguage=false, validPurpose=false, audioLang=AudioLanguage.text()
			if (AudioLanguage.attr(tva.a_purpose)) {
				if (!(validPurpose=isValidAudioLanguagePurpose(AudioLanguage.attr(tva.a_purpose).value())))
					errs.pushCode("AV014", tva.a_purpose.attribute(tva.e_AudioLanguage)+" is not valid");
			}
			validLanguage=CheckLanguage(knownLanguages, errs, audioLang, tva.e_AudioAttributes+"."+tva.e_AudioLanguage, "AV015");
			
			if (validLanguage && validPurpose) {	
				if (audioCounts[audioLang]===undefined)
					audioCounts[audioLang]=1
				else audioCounts[audioLang]++;

				let combo=audioLang+"!--!"+AudioLanguage.attr(tva.a_purpose).value()
				if (isIn(foundAttributes, combo))
					errs.pushCode("AV016", "audio "+tva.a_purpose.attribute()+" "+AudioLanguage.attr(tva.a_purpose).value().quote()+" already specified for language "+audioLang.quote())
				else
					foundAttributes.push(combo);
			}
		}
	}
	audioCounts.forEach(audioLang => {
		if (audioCounts[audioLang]>2)
			errs.pushCode("AV020", "more than 2 "+tva.e_AudioAttributes.elementize()+" elements for language "+audioLang.quote())
	});
	
	// <VideoAttributes>
	let va=0, VideoAttributes
	while (VideoAttributes=AVAttributes.get(xPath(SCHEMA_PREFIX, tva.e_VideoAttributes, ++va), CG_SCHEMA)) {
		checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, VideoAttributes, [], [tva.e_HorizontalSize, tva.e_VerticalSize, tva.e_AspectRatio], errs, "AV030");
		
		let HorizontalSize=VideoAttributes.get(xPath(SCHEMA_PREFIX, tva.e_HorizontalSize), CG_SCHEMA)
		if (HorizontalSize && valUnsignedInt(HorizontalSize.text()) > MAX_UNSIGNED_SHORT) 
			errs.pushCode("AV031", tva.e_HorizontalSize.elementize()+" must be an unsigned short (0-"+MAX_UNSIGNED_SHORT+")")
		
		let VerticalSize=VideoAttributes.get(xPath(SCHEMA_PREFIX, tva.e_VerticalSize), CG_SCHEMA)
		if (VerticalSize && valUnsignedInt(VerticalSize.text()) > MAX_UNSIGNED_SHORT) 
			errs.pushCode("AV032", tva.e_VerticalSize.elementize()+" must be an unsigned short (0-"+MAX_UNSIGNED_SHORT+")")
		
		let AspectRatio=VideoAttributes.get(xPath(SCHEMA_PREFIX,tva.e_AspectRatio), CG_SCHEMA)
		if (AspectRatio && !patterns.isRatioType(AspectRatio.text()))
			errs.pushCode("AV033", tva.e_AspectRatio.elementize()+" is not a valid aspect ratio")
	}

	// <CaptioningAttributes>
	let CaptioningAttributes=AVAttributes.get(xPath(SCHEMA_PREFIX, tva.e_CaptioningAttributes), CG_SCHEMA)
	if (CaptioningAttributes) {
		checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, CaptioningAttributes, [], [tva.e_Coding], errs, "AV040");
		
		let Coding=CaptioningAttributes.get(xPath(SCHEMA_PREFIX, tva.e_Coding), CG_SCHEMA)
		if (Coding) {
			checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, Coding, [tva.a_href], [], errs, "AV041")
			if (Coding.attr(tva.a_href)) {
				let codingHref=Coding.attr(tva.a_href).value()
				if (codingHref!=dvbi.DVB_BITMAP_SUBTITLES && codingHref!=DVB_CHARACTER_SUBTITLES 
				  && codingHref!=dvbi.EBU_TT_D)
					errs.pushCode("AV042", tva.a_href.attribute(tva.e_CaptioningAttributes+"."+tva.e_Coding)+" is not valid - should be DVB (bitmap or character) or EBU TT-D")
			}
		}		
	}
}


/**
 * validate a <RelatedMaterial> element iconforms to the Restart Application Linking rules (A177r1 clause 6.5.5)
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} RelatedMaterial     the <RelatedMaterial> node to be checked
 * @param {Class}  errs                errors found in validaton
 * @returns {boolean} true if this RelatedMaterial element contains a restart link (proper HowRelated@href and MediaLocator.MediaUri and MediaLocator.AuxiliaryURI)
 */
function ValidateRestartRelatedMaterial(CG_SCHEMA, SCHEMA_PREFIX, RelatedMaterial, errs) {
	
	function isRestartLink(str) { return str==dvbi.RESTART_LINK; }

	if (!RelatedMaterial) {
		errs.pushCode("RR000", "ValidateRestartRelatedMaterial() called with RelatedMaterial==null")
		return false;
	}

	let isRestart=checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, RelatedMaterial, [tva.e_HowRelated, tva.e_MediaLocator], [], errs, "RR001")
	
	let HowRelated=RelatedMaterial.get(xPath(SCHEMA_PREFIX, tva.e_HowRelated), CG_SCHEMA)
	if (HowRelated) {
		checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, HowRelated, [tva.a_href], [], errs, "RR002")
		if (HowRelated.attr(tva.a_href)) {
			if (!isRestartLink(HowRelated.attr(tva.a_href).value())) {
				errs.pushCode("RR003", "invalid "+tva.a_href.attribute(tva.e_HowRelated)+" ("+HowRelated.attr(tva.a_href).value()+") for Restart Application Link");
				isRestart=false;
			}
		}
	}
	
	let MediaLocator=RelatedMaterial.get(xPath(SCHEMA_PREFIX, tva.e_MediaLocator), CG_SCHEMA)
	if (MediaLocator) 
		if (!checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, MediaLocator, [tva.e_MediaUri, tva.e_AuxiliaryURI], [OTHER_ELEMENTS_OK], errs, "RR003"))
			isRestart=false;
	
	return isRestart;
}


/**
 * validate any <InstanceDescription> elements in the <ScheduleEvent> and <OnDemandProgram> elements
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {string} VerifyType		   the type of verification to perform (OnDemandProgram | ScheduleEvent)
 * @param {Object} InstanceDescription the <InstanceDescription> node to be checked
 * @param {boolean} isCurrentProgram   indicates if this <InstanceDescription> element is for the currently airing program
 * @param {string} parentLanguage      XML language of the parent element (expliclt or implicit from its parent(s))
 * @param {array}  programCRIDs        array to record CRIDs for later use 
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 */
function ValidateInstanceDescription(CG_SCHEMA, SCHEMA_PREFIX, VerifyType, InstanceDescription, isCurrentProgram, parentLanguage, programCRIDs, requestType, errs) {

	function countElements(CG_SCHEMA, SCHEMA_PREFIX, node, elementName) {
		let count=0, elem
		while (elem=node.get(xPath(SCHEMA_PREFIX, elementName, ++count), CG_SCHEMA));
		return count-1;
	}

	function isRestartAvailability(str) { return str==dvbi.RESTART_AVAILABLE || str==dvbi.RESTART_CHECK || str==dvbi.RESTART_PENDING; }
	function isMediaAvailability(str) { return str==dvbi.MEDIA_AVAILABLE || str==dvbi.MEDIA_UNAVAILABLE; }
	function isEPGAvailability(str) { return str==dvbi.FORWARD_EPG_AVAILABLE || str==dvbi.FORWARD_EPG_UNAVAILABLE; }
	function isAvailability(str) { return isMediaAvailability(str) || isEPGAvailability(str); }
	
	function checkGenre(node, CG_SCHEMA, SCHEMA_PREFIX, errs, errcode=null) {
		if (!node) return null;
		checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, node, [tva.a_href], [tva.a_type], errs, errcode?errcode+"-1":"ChG001")
		let GenreType=(node.attr(tva.a_type)?node.attr(tva.a_type).value():"other")
		if (GenreType!="other")
			errs.pushCode(errcode?errcode+"-2":"ChG002", tva.a_type.attribute(node.parent().name()+"."+node.name())+" must contain "+"other".quote())

		return (node.attr(tva.a_href)?node.attr(tva.a_href).value():null);
	}

	if (!InstanceDescription) {
		errs.pushCode("ID000", "ValidateInstanceDescription() called with InstanceDescription==null")
		return
	}
	switch (VerifyType) {
		case tva.e_OnDemandProgram:
			checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, InstanceDescription, [tva.e_Genre], [tva.e_CaptionLanguage, tva.e_SignLanguage, tva.e_AVAttributes, tva.e_OtherIdentifier], errs, "ID001")
			break
		case tva.e_ScheduleEvent:
			checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, InstanceDescription, [], [tva.e_CaptionLanguage, tva.e_SignLanguage, tva.e_AVAttributes, tva.e_OtherIdentifier, tva.e_Genre, tva.e_RelatedMaterial], errs, "ID002")
			break
		default:
			errs.pushCode("ID003", "--> ValidateInstanceDescription() called with VerifyType="+VerifyType)		
	}

	let restartGenre=null, restartRelatedMaterial=null
	
	// <Genre>
	switch (VerifyType) {
		case tva.e_OnDemandProgram:
			// A177r1 Table 54 - must be 2 elements
			
			let Genre1=InstanceDescription.get(xPath(SCHEMA_PREFIX, tva.e_Genre, 1), CG_SCHEMA),
				Genre2=InstanceDescription.get(xPath(SCHEMA_PREFIX, tva.e_Genre, 2), CG_SCHEMA),
				Genre3=InstanceDescription.get(xPath(SCHEMA_PREFIX, tva.e_Genre, 3), CG_SCHEMA)
				
			if (Genre3)
				errs.pushCode("ID010", "exactly 2 "+phlib.elementize(InstanceDescription.name()+"."+tva.e_Genre)+" elements are required for "+VerifyType);

			let g1href=checkGenre(Genre1, CG_SCHEMA, SCHEMA_PREFIX, errs, "ID011")
			if (g1href && !isAvailability(g1href))
				errs.pushCode("ID012", "first "+phlib.elementize(InstanceDescription.name()+"."+tva.e_Genre)+" must contain a media or fepg availability indicator");

			let g2href=checkGenre(Genre2, CG_SCHEMA, SCHEMA_PREFIX, errs, "ID013")	
			if (g2href && !isAvailability(g2href))
				errs.pushCode("ID014", "second "+phlib.elementize(InstanceDescription.name()+"."+tva.e_Genre)+" must contain a media or fepg availability indicator");
			
			if (Genre1 && Genre2) {
				if ((isMediaAvailability(g1href) && isMediaAvailability(g2href))
				 || (isEPGAvailability(g1href) && isEPGAvailability(g2href)))
					errs.pushCode("ID015", phlib.elementize(InstanceDescription.name()+"."+tva.e_Genre)+" elements must indicate different availabilities")
			}
			break
		case tva.e_ScheduleEvent:
			let Genre=InstanceDescription.get(xPath(SCHEMA_PREFIX, tva.e_Genre), CG_SCHEMA)
			if (Genre) {
				checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, Genre, [tva.a_href], [], errs, "ID016")
				if (Genre.attr(tva.a_href)) {
					if (isRestartAvailability(Genre.attr(tva.a_href).value())) 
						restartGenre=Genre;
					else 
						errs.pushCode("ID017", phlib.elementize(InstanceDescription.name()+"."+tva.e_Genre)+" must contain a restart link indicator")
				}
			}	
			break	
	}
	
	// <CaptionLanguage>
	let captionCount=countElements(CG_SCHEMA, SCHEMA_PREFIX, InstanceDescription, tva.e_CaptionLanguage)
	if (captionCount > 1)
		errs.pushCode("ID020", "only a single "+tva.e_CaptionLanguage.elementize()+" element is permitted in "+InstanceDescription.name().elementize())
	let CaptionLanguage=InstanceDescription.get(xPath(SCHEMA_PREFIX, tva.e_CaptionLanguage), CG_SCHEMA)
	if (CaptionLanguage) {
		CheckLanguage(knownLanguages, errs, CaptionLanguage.text(), InstanceDescription.name()+"."+tva.e_CaptionLanguage, "ID021");
		BooleanValue(CaptionLanguage, tva.a_closed, "ID022", errs)
	}
	
	// <SignLanguage>
	let signCount=countElements(CG_SCHEMA, SCHEMA_PREFIX, InstanceDescription, tva.e_SignLanguage)
	if (signCount > 1)
		errs.pushCode("ID030", "only a single "+tva.e_SignLanguage.elementize()+" element is premitted in "+InstanceDescription.name().elementize())
	let SignLanguage=InstanceDescription.get(xPath(SCHEMA_PREFIX, tva.e_SignLanguage), CG_SCHEMA)
	if (SignLanguage) {
		CheckLanguage(knownLanguages, errs, SignLanguage.text(), InstanceDescription.name()+"."+tva.e_SignLanguage, "ID-310");
		FalseValue(SignLanguage, tva.a_closed, "ID032", errs)
		// check value is "sgn" according to ISO 639-2 or a sign language listed in ISO 639-3
		if (SignLanguage.text()!="sgn" && !knownLanguages.isKnownSignLanguage(SignLanguage.text())) 
			errs.pushCode("ID033", "invalid "+tva.e_SignLanguage.elementize()+" "+SignLanguage.text().quote()+" in "+InstanceDescription.name().elementize())
	}
	
	// <AVAttributes>
	let AVAttributes=InstanceDescription.get(xPath(SCHEMA_PREFIX, tva.e_AVAttributes), CG_SCHEMA)
	if (AVAttributes)
		ValidateAVAttributes(CG_SCHEMA, SCHEMA_PREFIX, AVAttributes, parentLanguage, requestType, errs);
	
	// <OtherIdentifier>
	let oi=0, OtherIdentifier
	while (OtherIdentifier=InstanceDescription.get(xPath(SCHEMA_PREFIX, tva.e_OtherIdentifier, ++oi), CG_SCHEMA)) {
		checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, OtherIdentifier, [tva.a_type], [], errs, "VID052")
		if (OtherIdentifier.attr(tva.a_type)) {			
			let oiType=OtherIdentifier.attr(tva.a_type).value()
	
			if ((VerifyType==tva.e_ScheduleEvent
						  && (oiType=="CPSIndex" || oiType==dvbi.EIT_PROGRAMME_CRID_TYPE || oiType==dvbi.EIT_SERIES_CRID_TYPE))
			  || (VerifyType==tva.e_OnDemandProgram && oiType=="CPSIndex")) {
					// all good
				}
				else 
					errs.pushCode("ID050", tva.a_type.attribute(tva.e_OtherIdentifier)+"="+oiType.quote()+" is not valid for "+VerifyType+"."+InstanceDescription.name());				
				if (oiType==dvbi.EIT_PROGRAMME_CRID_TYPE || oiType==dvbi.EIT_SERIES_CRID_TYPE)
					if (!isCRIDURI(OtherIdentifier.text()))
						errs.pushCode("ID051", tva.e_OtherIdentifier+" must be a CRID for "+tva.a_type.attribute()+"="+oiType.quote());
		}
	}
	
	// <RelatedMaterial>
	switch (VerifyType) {
		case tva.e_ScheduleEvent:
			let RelatedMaterial=InstanceDescription.get(xPath(SCHEMA_PREFIX, tva.e_RelatedMaterial), CG_SCHEMA)
			if (RelatedMaterial) {
				if (ValidateRestartRelatedMaterial(CG_SCHEMA, SCHEMA_PREFIX, RelatedMaterial, errs))
					restartRelatedMaterial=RelatedMaterial; 		
			}
			break
		case tva.e_ScheduleEvent:
			// Genre and RelatedMaterial for restart capability should only be specified for the "current" (ie. 'now') program
			if (!isCurrentProgram && (restartGenre || restartRelatedMaterial))
				errs.pushCode("ID060", "restart "+tva.e_Genre.elementize()+" and "+tva.e_RelatedMaterial.elementize()+" are only permitted for the current ("+"now".quote()+") program")
			
			if ((restartGenre && !restartRelatedMaterial) || (restartRelatedMaterial && !restartGenre))
				errs.pushCode("ID061", "both "+tva.e_Genre.elementize()+" and "+tva.e_RelatedMaterial.elementize()+" are required together for "+VerifyType)		
			break
	}
}


/**
 * validate an <OnDemandProgram> elements in the <ProgramLocationTable>
 *
 * @param {Object} node              the element node containing the an XML AIT reference
 * @param {Class}  errs              errors found in validaton
 * @param {string} errcode           error code to be used with any errors founf
 */
function CheckTemplateAITApplication(node, errs, errcode=null) {

	if (!node)  {
		errs.pushCode(errcode?errcode+"-":"TA000", "CheckTemplateAITApplication() called with node==null")	
		return;
	}
	if (!node.attr(tva.a_contentType)) {
		errs.pushCode(errcode?errcode+"-1":"TA001", tva.a_contentType.attribute()+" attribute is required when signalling a template AIT in "+node.name().elementize())
		return
	}
	if (node.attr(tva.a_contentType).value()==dvbi.XML_AIT_CONTENT_TYPE) {
		if (!patterns.isHTTPURL(node.text()))
			errs.pushCode(errcode?errcode+"-2":"TA002", node.name().elementize()+"="+node.text().quote()+" is not a valid AIT URL", "invalid URL")
	}
	else
		errs.pushCode(errcode?errcode+"-3":"TA003", tva.a_contentType.attribute(node.name())+"="+node.attr(tva.a_contentType).value().quote()+" is not valid for a template AIT")
}


/**
 * validate an <OnDemandProgram> elements in the <ProgramLocationTable>
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} OnDemandProgram     the node containing the <OnDemandProgram> being checked
 * @param {string} parentLang          XML language of the parent element (expliclt or implicit from its parent(s))
 * @param {array}  programCRIDs        array of program crids defined in <ProgramInformationTable> 
 * @param {array}  plCRIDs        	   array of program crids defined in <ProgramLocationTable>
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 */
function ValidateOnDemandProgram(CG_SCHEMA, SCHEMA_PREFIX, OnDemandProgram, parentLanguage, programCRIDs, plCRIDs, requestType, errs) {

	if (!OnDemandProgram) {
		errs.pushCode("OD000", "ValidateOnDemandProgram() called with OnDemandProgram==null")
		return
	}
	let validRequest=true
	switch (requestType) {
		case CG_REQUEST_BS_CONTENTS:
			checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, OnDemandProgram, [tva.e_Program,tva.e_ProgramURL,tva.e_PublishedDuration,tva.e_StartOfAvailability,tva.e_EndOfAvailability,tva.e_Free], [tva.e_InstanceDescription,tva.e_AuxiliaryURL,tva.e_DeliveryMode], errs, "OD001");
			break;
		case CG_REQUEST_MORE_EPISODES:
			checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, OnDemandProgram, [tva.e_Program,tva.e_ProgramURL,tva.e_PublishedDuration,tva.e_StartOfAvailability,tva.e_EndOfAvailability,tva.e_Free], [tva.e_AuxiliaryURL], errs, "OD002");
			break;
		case CG_REQUEST_SCHEDULE_NOWNEXT:
		case CG_REQUEST_SCHEDULE_TIME:
		case CG_REQUEST_SCHEDULE_WINDOW:
		case CG_REQUEST_PROGRAM:
			checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, OnDemandProgram, [tva.e_Program,tva.e_ProgramURL,tva.e_InstanceDescription,tva.e_PublishedDuration,tva.e_StartOfAvailability,tva.e_EndOfAvailability,tva.e_DeliveryMode,tva.e_Free], [tva.e_AuxiliaryURL], errs, "OD003");
			break;
		default:
			errs.pushCode("OD004", "requestType="+requestType+" is not valid for "+OnDemandProgram.name())
			validRequest=false
	}
		
	checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, OnDemandProgram, [], [tva.a_serviceIDRef, tva.a_lang], errs, "OD005"); 
	let odpLang=GetLanguage(knownLanguages, errs, OnDemandProgram, parentLanguage, false, "OD006")
	checkTAGUri(OnDemandProgram, errs, "OD007");	
	
	// <Program>
	let prog=0, Program
	while (Program=OnDemandProgram.get(xPath(SCHEMA_PREFIX, tva.e_Program, ++prog), CG_SCHEMA)) {
		checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, Program, [tva.a_crid], [], errs, "OD012")
		if (Program.attr(tva.a_crid)) {
			let programCRID=Program.attr(tva.a_crid).value()
			if (!isCRIDURI(programCRID))
				errs.pushCode("OD010", tva.a_crid.attribute(OnDemandProgram.name()+"."+tva.e_Program)+" is not a CRID URI");
			else {
				if (!isIni(programCRIDs, programCRID))
					errs.pushCode("OD011", tva.a_crid.attribute(OnDemandProgram.name()+"."+tva.e_Program)+"="+programCRID.quote()+" does not refer to a program in the "+tva.e_ProgramInformationTable.elementize())
			}
			plCRIDs.push(programCRID)
		}	
	}
	if (--prog>1)
		errs.pushCode("OD013", "only a single "+tva.e_Program.elementize()+" is permitted in "+OnDemandProgram.name().elementize())

	// <ProgramURL>
	let pUrl=0, ProgramURL
	while (ProgramURL=OnDemandProgram.get(xPath(SCHEMA_PREFIX, tva.e_ProgramURL, ++pUrl), CG_SCHEMA)) 
		CheckTemplateAITApplication(ProgramURL, errs, "OD020");
	/* this is now checked through schema validation
	if (--pUrl>1)
		errs.pushCode("OD021", "only a single "+tva.e_ProgramURL.elementize()+" is permitted in "+OnDemandProgram.name().elementize())
	*/
	
	// <AuxiliaryURL>
	let aux=0, AuxiliaryURL
	while (AuxiliaryURL=OnDemandProgram.get(xPath(SCHEMA_PREFIX, tva.e_AuxiliaryURL, ++aux), CG_SCHEMA)) 
		CheckTemplateAITApplication(AuxiliaryURL, errs, "OD030");
	if (--aux>1)
		errs.pushCode("OD031", "only a single "+tva.e_AuxiliaryURL.elementize()+" is permitted in "+OnDemandProgram.name().elementize())
	
	// <InstanceDescription>
	let id=0, InstanceDescription
	if (validRequest)
		while (InstanceDescription=OnDemandProgram.get(xPath(SCHEMA_PREFIX, tva.e_InstanceDescription, ++id), CG_SCHEMA))
			ValidateInstanceDescription(CG_SCHEMA, SCHEMA_PREFIX, OnDemandProgram.name(), InstanceDescription, false, odpLang, programCRIDs, requestType, errs)
	if (--id>1)
		errs.pushCode("OD041", "only a single "+tva.e_InstanceDescription.elementize()+" is permitted in "+OnDemandProgram.name().elementize())
	
	// <PublishedDuration>
	let pd=0, PublishedDuration 
	while (PublishedDuration=OnDemandProgram.get(xPath(SCHEMA_PREFIX, tva.e_PublishedDuration, ++pd), CG_SCHEMA)) 
		if (!patterns.isISODuration(PublishedDuration.text()))
			errs.pushCode("OD050", OnDemandProgram.name()+"."+tva.e_PublishedDuration+" is not a valid ISO Duration (xs:duration)");
	if (--pd>1)
		errs.pushCode("OD051", "only a single "+tva.e_PublishedDuration.elementize()+" is permitted in "+OnDemandProgram.name().elementize())
	
	// <StartOfAvailability> and <EndOfAvailability>
	let soa=OnDemandProgram.get(xPath(SCHEMA_PREFIX, tva.e_StartOfAvailability), CG_SCHEMA),
	    eoa=OnDemandProgram.get(xPath(SCHEMA_PREFIX, tva.e_EndOfAvailability), CG_SCHEMA)
	
	if (soa) 
		if (!patterns.isUTCDateTime(soa.text())) {
			errs.pushCode("OD060", tva.e_StartOfAvailability.elementize()+" must be expressed in Zulu time")
			soa=null;
		}
	if (eoa) 
		if (!patterns.isUTCDateTime(eoa.text())) {
			errs.pushCode("OD061", tva.e_EndOfAvailability.elementize()+" must be expressed in Zulu time")
			eoa=null;
		}
	if (soa && eoa) {
		let fr=new Date(soa.text()), to=new Date(eoa.text())	
		if (to.getTime() < fr.getTime()) 
			errs.pushCode("OD062", tva.e_StartOfAvailability.elementize()+" must be earlier than "+tva.e_EndOfAvailability.elementize())
	}
	
	// <DeliveryMode>
	let dm=0, DeliveryMode
	while (DeliveryMode=OnDemandProgram.get(xPath(SCHEMA_PREFIX, tva.e_DeliveryMode, ++dm), CG_SCHEMA))
		if (DeliveryMode.text()!="streaming")
			errs.pushCode("OD070", OnDemandProgram.name()+"."+tva.e_DeliveryMode+" must be "+"streaming".quote())
	if (--dm>1)
		errs.pushCode("OD071", "only a single "+tva.e_DeliveryMode.elementize()+" is permitted in "+OnDemandProgram.name().elementize())
	
	// <Free>
	let fr=0, Free
	while (Free=OnDemandProgram.get(xPath(SCHEMA_PREFIX, tva.e_Free, ++fr), CG_SCHEMA))
		TrueValue(Free, tva.a_value, "OD080", errs)
	if (--fr>1)
		errs.pushCode("OD081", "only a single "+tva.e_Free.elementize()+" is permitted in "+OnDemandProgram.name().elementize())
}	


/** 
 * checks is the specified element (elem) has an attribute named attrName and that its value is on the given list)
 *
 * @param {Node}    elem       the XML element to be checked
 * @param {string}  attrName   the name of the attribute carrying the boolean value
 * @param {string}  errno      the error number used as a prefix for reporting errors
 * @param {Class}   errs       errors found in validaton
 * @param {array}   allowed    the set or permitted values
 * @param {boolean} isRequired true if the specificed attribued is required to be specified for the element
 */
function AllowedValue(elem, attrName, errno, errs, allowed, isRequired=true) {
	if (!elem) {
		errs.pushCode(errno+"-0", "AllowedValue() called with elem==null")
		return
	}

	if (elem.attr(attrName)) {
		if (!isIn(allowed, elem.attr(attrName).value())) {
			let str=""
			allowed.forEach(value => {str=str+((str.length!=0)?" or ":"")+value});
			errs.pushCode(errno+"-1", attrName.attribute(elem.parent().name+"."+elem.name())+" must be "+str);
		}
	}
	else 
		if (isRequired) errs.pushCode(errno+"-2", attrName.attribute()+" must be specified for "+elem.parent().name+"."+elem.name());
}


/** 
 * checks is the specified element (elem) has an attribute named attrName and that its value is "true" or "false"
 *
 * @param {Node}    elem       the XML element to be checked
 * @param {string}  attrName   the name of the attribute carrying the boolean value
 * @param {string}  errno      the error number used as a prefix for reporting errors
 * @param {Class}   errs       errors found in validaton
 * @param {boolean} isRequired true if the specificed attribued is required to be specified for the element
 */
function BooleanValue(elem, attrName, errno, errs, isRequired=true) {
	AllowedValue(elem, attrName, errno, errs, ["true", "false"], isRequired);
}


/** 
 * checks is the specified element (elem) has an attribute named attrName and that its value is "true"
 *
 * @param {Node}    elem       the XML element to be checked
 * @param {string}  attrName   the name of the attribute carrying the boolean value
 * @param {string}  errno      the error number used as a prefix for reporting errors
 * @param {Class}   errs       errors found in validaton
 * @param {boolean} isRequired true if the specificed attribued is required to be specified for the element
 */
function TrueValue(elem, attrName, errno, errs, isRequired=true) {
	AllowedValue(elem, attrName, errno, errs, ["true"], isRequired);
}

/** 
 * checks is the specified element (elem) has an attribute named attrName and that its value is "false"
 *
 * @param {Node}    elem       the XML element to be checked
 * @param {string}  attrName   the name of the attribute carrying the boolean value
 * @param {string}  errno      the error number used as a prefix for reporting errors
 * @param {Class}   errs       errors found in validaton
 * @param {boolean} isRequired true if the specificed attribued is required to be specified for the element
 */
function FalseValue(elem, attrName, errno, errs, isRequired=true) {
	AllowedValue(elem, attrName, errno, errs, ["false"], isRequired);
}
	

/**
 * validate any <ScheduleEvent> elements in the <ProgramLocationTable.Schedule>
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} Schedule            the <Schedule> node containing the <ScheduleEvent> element to be checked
 * @param {string} parentLanguage      XML language of the parent element (expliclt or implicit from its parent(s))
 * @param {array}  programCRIDs        array of program crids defined in <ProgramInformationTable> 
 * @param {array}  plCRIDs             array of program crids defined in <ProgramLocationTable>
 * @param {string} currentProgramCRID  CRID of the currently airing program
 * @param {Date}   scheduleStart	   Date representation of Schedule@start
 * @param {Date}   scheduleEnd  	   Date representation of Schedule@end
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 */
function ValidateScheduleEvents(CG_SCHEMA, SCHEMA_PREFIX, Schedule, parentLanguage, programCRIDs, plCRIDs, currentProgramCRID, scheduleStart, scheduleEnd, requestType, errs) {
	
	if (!Schedule) {
		errs.pushCode("SE000", "ValidateScheduleEvents() called with Schedule==null")
		return		
	}
	
	let isCurrentProgram=false
	let se=0, ScheduleEvent
	while (ScheduleEvent=Schedule.get(xPath(SCHEMA_PREFIX, tva.e_ScheduleEvent, ++se), CG_SCHEMA)) {
		let seLang=GetLanguage(knownLanguages, errs, ScheduleEvent, parentLanguage, false, "SE001")
		
		checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, ScheduleEvent, [tva.e_Program, tva.e_PublishedStartTime, tva.e_PublishedDuration], [tva.e_ProgramURL, tva.e_InstanceDescription, tva.e_ActualStartTime, tva.e_FirstShowing, tva.e_Free], errs, "SE002");
		
		// <Program>
		let Program=ScheduleEvent.get(xPath(SCHEMA_PREFIX, tva.e_Program), CG_SCHEMA)
		if (Program) {
			checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, Program, [tva.a_crid], [], errs, "SE010" )

			let ProgramCRID=Program.attr(tva.a_crid)
			if (ProgramCRID) {
				if (!isCRIDURI(ProgramCRID.value()))
					errs.pushCode("SE011", tva.a_crid.attribute(tva.e_Program)+" is not a valid CRID ("+ProgramCRID.value()+")");
				if (!isIni(programCRIDs, ProgramCRID.value()))
					errs.pushCode("SE012", tva.a_crid.attribute(tva.e_Program)+"="+ProgramCRID.value().quote()+" does not refer to a program in the "+tva.e_ProgramInformationTable.elementize())
				plCRIDs.push(ProgramCRID.value())
				isCurrentProgram=(ProgramCRID.value()==currentProgramCRID) 
			}
		}
			
		// <ProgramURL>
		let ProgramURL=ScheduleEvent.get(xPath(SCHEMA_PREFIX, tva.e_ProgramURL), CG_SCHEMA)
		if (ProgramURL) 
			if (!patterns.isDVBLocator(ProgramURL.text()))
				errs.pushCode("SE021", tva.e_ScheduleEvent+"."+tva.e_ProgramURL+" ("+ProgramURL.text()+") is not a valid DVB locator");		
		
		// <InstanceDescription>
		let InstanceDescription=ScheduleEvent.get(xPath(SCHEMA_PREFIX, tva.e_InstanceDescription), CG_SCHEMA)
		if (InstanceDescription) 
			ValidateInstanceDescription(CG_SCHEMA, SCHEMA_PREFIX, tva.e_ScheduleEvent, InstanceDescription, isCurrentProgram, seLang, programCRIDs,requestType, errs);
		
		// <PublishedStartTime> and <PublishedDuration>
		let pstElem=ScheduleEvent.get(xPath(SCHEMA_PREFIX, tva.e_PublishedStartTime), CG_SCHEMA)
		if (pstElem) {

			if (patterns.isUTCDateTime(pstElem.text())) {
				let PublishedStartTime=new Date(pstElem.text())
				
				if (scheduleStart && PublishedStartTime < scheduleStart) 
					errs.pushCode("SE041", tva.e_PublishedStartTime.elementize()+" ("+PublishedStartTime+") is earlier than "+tva.a_start.attribute(tva.e_Schedule))
				if (scheduleEnd && PublishedStartTime > scheduleEnd) 
					errs.pushCode("SE042", tva.e_PublishedStartTime.elementize()+" ("+PublishedStartTime+") is after "+tva.a_end.attribute(tva.e_Schedule))	

				let pdElem=ScheduleEvent.get(xPath(SCHEMA_PREFIX, tva.e_PublishedDuration), CG_SCHEMA)
				if (pdElem && scheduleEnd) {
					let parsedPublishedDuration = parseISOduration(pdElem.text())
					if (parsedPublishedDuration.add(PublishedStartTime) > scheduleEnd) 
						errs.pushCode("SE043", tva.e_PublishedStartTime+"+"+tva.e_PublishedDuration+" of event is after "+tva.a_end.attribute(tva.e_Schedule));
				}
			}
			else 
				errs.pushCode("SE049", tva.e_PublishedStartTime.elementize()+" is not expressed in UTC format ("+pstElem.text()+")");
		}
		
		// <ActualStartTime> 
		let astElem=ScheduleEvent.get(xPath(SCHEMA_PREFIX, tva.e_ActualStartTime), CG_SCHEMA)
		if (astElem && !patterns.isUTCDateTime(astElem.text())) 
			errs.pushCode("SE051", tva.e_ActualStartTime.elementize()+" is not expressed in UTC format ("+astElem.text()+")");

		// <FirstShowing>
		let FirstShowing=ScheduleEvent.get(xPath(SCHEMA_PREFIX, tva.e_FirstShowing), CG_SCHEMA)
		if (FirstShowing) 
			BooleanValue(FirstShowing, tva.a_value, "SE060", errs);
		
		// <Free>
		let Free=ScheduleEvent.get(xPath(SCHEMA_PREFIX, tva.e_Free), CG_SCHEMA)
		if (Free) 
			BooleanValue(Free, tva.a_value, "SE070", errs);
	}
}


/**
 * validate a <Schedule> elements in the <ProgramLocationTable>
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} Schedule            the node containing the <Schedule> being checked
 * @param {string} parentLanguage      XML language of the parent element (expliclt or implicit from its parent(s))
 * @param {array}  programCRIDs        array of program crids defined in <ProgramInformationTable> 
 * @param {array}  plCRIDs             array of program crids defined in <ProgramLocationTable>
 * @param {string} currentProgramCRID  CRID of the currently airing program
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 * @returns {string} the serviceIdRef for this <Schedule> element
 */
function ValidateSchedule(CG_SCHEMA, SCHEMA_PREFIX, Schedule, parentLanguage, programCRIDS, plCRIDs, currentProgramCRID, requestType, errs) {

	if (!Schedule) {
		errs.pushCode("VS000", "ValidateSchedule() called with Schedule==null")
		return
	}

	checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, Schedule, [], [tva.e_ScheduleEvent], errs, "VS001");
	checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, Schedule, [tva.a_serviceIDRef, tva.a_start, tva.a_end], [], errs, "VS002");
	
	let scheduleLang=GetLanguage(knownLanguages, errs, Schedule, parentLanguage, false, "VS003");	
	let serviceIdRef=checkTAGUri(Schedule, errs, "VS004");
	let startSchedule=Schedule.attr(tva.a_start), fr=null, endSchedule=Schedule.attr(tva.a_end), to=null;
	if (startSchedule)
		if (patterns.isUTCDateTime(startSchedule.value())) 
			fr=new Date(startSchedule.value());
		else {
			errs.pushCode("VS010", tva.a_start.attribute(Schedule.name())+" is not expressed in UTC format ("+startSchedule.value()+")");
			startSchedule=null;
		}

	if (endSchedule)
		if (patterns.isUTCDateTime(endSchedule.value())) 
			to=new Date(endSchedule.value());
		else {
			errs.pushCode("VS011", tva.a_end.attribute(Schedule.name())+" is not expressed in UTC format ("+endSchedule.value()+")");
			endSchedule=null;
		}

	if (startSchedule && endSchedule) 
		if (to.getTime() <= fr.getTime()) 
			errs.pushCode("VS012", tva.a_start.attribute(Schedule.name())+" must be earlier than "+tva.a_end.attribute());
	
	ValidateScheduleEvents(CG_SCHEMA, SCHEMA_PREFIX, Schedule, scheduleLang, programCRIDS, plCRIDs, currentProgramCRID, fr, to, requestType, errs);
	
	return serviceIdRef;
}


/**
 * find and validate any <ProgramLocation> elements in the <ProgramLocationTable>
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} ProgramDescription  the element containing the <ProgramInformationTable>
 * @param {string} parentLang          XML language of the parent element (or its parent(s))
 * @param {array}  programCRIDs        array to record CRIDs for later use  
 * @param {string} currentProgramCRID  CRID of the currently airing program
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 * @param {integer} o.childCount         the number of child elements to be present (to match GroupInformation@numOfItems)
 */
function CheckProgramLocation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, parentLang, programCRIDs, currentProgramCRID, requestType, errs, o=null) {

	if (!ProgramDescription) {
		errs.pushCode("PL000", "CheckProgramLocation() called with ProgramDescription==null")
		return
	}
	
	let ProgramLocationTable=ProgramDescription.get(xPath(SCHEMA_PREFIX, tva.e_ProgramLocationTable), CG_SCHEMA)
	if (!ProgramLocationTable) {
		errs.pushCode("PL001", tva.e_ProgramLocationTable.elementize()+" is not specified")
		return;
	}
	checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, ProgramLocationTable, [], [tva.e_Schedule, tva.e_OnDemandProgram], errs, "PL010");
	checkAttributes(CG_SCHEMA, SCHEMA_PREFIX, ProgramLocationTable, [], [tva.a_lang], errs, "PL011");
	
	let pltLang=GetLanguage(knownLanguages, errs, ProgramLocationTable, parentLang, false, "PL012")	
	
	let cnt=0, foundServiceIds=[], plCRIDs=[]

	let children=ProgramLocationTable.childNodes()
	if (children) children.forEach(child => {
		if (child.type()=="element") {		
			switch (child.name()) {
				case tva.e_OnDemandProgram:
					ValidateOnDemandProgram(CG_SCHEMA, SCHEMA_PREFIX, child, pltLang, programCRIDs, plCRIDs, requestType, errs);
					cnt++;
					break;
				case tva.e_Schedule:
					let thisServiceIdRef=ValidateSchedule(CG_SCHEMA, SCHEMA_PREFIX, child, pltLang, programCRIDs, plCRIDs, currentProgramCRID, requestType, errs)
					if (thisServiceIdRef.length)
						if (isIni(foundServiceIds, thisServiceIdRef))
							errs.pushCode("PL020", "A "+tva.e_Schedule.elementize()+" element with "+tva.a_serviceIDRef.attribute()+"="+thisServiceIdRef.quote()+" is already specified")
						else 
							foundServiceIds.push(thisServiceIdRef);
					cnt++;
					break;
			}
		}		
	})

	if (o && o.childCount!=0) {
		if (o.childCount!=cnt)
			errs.pushCode("PL021", "number of items ("+cnt+") in the "+tva.e_ProgramLocationTable.elementize()+" does match "+tva.a_numOfItems.attribute(tva.e_GroupInformation)+" specified in "+CATEGORY_GROUP_NAME+" ("+o.childCount+")")
	}

	programCRIDs.forEach(programCRID => {
		if (!isIni(plCRIDs, programCRID))
			errs.pushCode("PL022", "CRID "+programCRID.quote()+" specified in "+tva.e_ProgramInformationTable.elementize()+" is not specified in "+tva.e_ProgramLocationTable.elementize())
		
	})
}


/**
 * validate the content guide and record any errors
 *
 * @param {String} CGtext the service list text to be validated
 * @param {String} requestType the type of CG request/response (specified in the form/query as not possible to deduce from metadata)
 * @param {Class} errs errors found in validaton
 */
function doValidateContentGuide(CGtext, requestType, errs) {
	let CG=null

	if (CGtext) try {
		CG=libxml.parseXmlString(CGtext);
	} catch (err) {
		errs.pushCode("CG000", "XML parsing failed: "+err.message);
	}
	if (!CG) return;

	if (!CG.validate(TVAschema)) 
		CG.validationErrors.forEach(ve => {
			let s=ve.toString().split('\r')
			s.forEach(err => errs.pushCode("CG001", err)); 
		})

	if (CG.root().name()!=tva.e_TVAMain) {
		errs.pushCode("CG002", "Root element is not "+tva.e_TVAMain.elementize())
		return
	}
	let CG_SCHEMA={}, 
		SCHEMA_PREFIX=CG.root().namespace()?CG.root().namespace().prefix():"", 
		SCHEMA_NAMESPACE=CG.root().namespace()?CG.root().namespace().href():"";
	CG_SCHEMA[SCHEMA_PREFIX]=SCHEMA_NAMESPACE;

	let tvaMainLang=GetLanguage(knownLanguages, errs, CG.root(), DEFAULT_LANGUAGE, true, "CG003");
	let ProgramDescription=CG.get(xPath(SCHEMA_PREFIX, tva.e_ProgramDescription), CG_SCHEMA);
	if (!ProgramDescription) {
		errs.pushCode("CG004", "No "+tva.e_ProgramDescription.elementize()+" element specified.")
		return;
	}
	
	let programCRIDs=[], groupIds=[], o={childCount:0}
	
	switch (requestType) {
		case CG_REQUEST_SCHEDULE_TIME:
			// schedule response (6.5.4.1) has <ProgramLocationTable> and <ProgramInformationTable> elements 
			checkTopElements(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, [tva.e_ProgramLocationTable, tva.e_ProgramInformationTable], [], errs, "CG011"); 
			
			CheckProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, tvaMainLang, programCRIDs, null, requestType, errs);
			CheckProgramLocation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, tvaMainLang, programCRIDs, null, requestType, errs);
			break;
		case CG_REQUEST_SCHEDULE_NOWNEXT:
			// schedule response (6.5.4.1) has <ProgramLocationTable> and <ProgramInformationTable> elements 
			checkTopElements(CG_SCHEMA, SCHEMA_PREFIX,  ProgramDescription, [tva.e_ProgramLocationTable, tva.e_ProgramInformationTable, tva.e_GroupInformationTable], [], errs, "CG021"); 
		
			// <GroupInformation> may become optional for now/next, the program sequence should be determined by ScheduleEvent.PublishedStartTime
			if (hasElement(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, tva.e_GroupInformationTable))
				CheckGroupInformationNowNext(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, tvaMainLang, groupIds, requestType, errs);
			let currentProgramCRIDnn=CheckProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, tvaMainLang, programCRIDs, groupIds, requestType, errs);
			CheckProgramLocation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, tvaMainLang, programCRIDs, currentProgramCRIDnn, requestType, errs);
			break;
		case CG_REQUEST_SCHEDULE_WINDOW:
			checkTopElements(CG_SCHEMA, SCHEMA_PREFIX,  ProgramDescription, [tva.e_ProgramLocationTable, tva.e_ProgramInformationTable, tva.e_GroupInformationTable], [], errs, "CG031"); 

			// <GroupInformation> may become optional for now/next, the program sequence should be determined by ScheduleEvent.PublishedStartTime
			if (hasElement(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, tva.e_GroupInformationTable))
				CheckGroupInformationNowNext(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, tvaMainLang, groupIds, requestType, errs);
			let currentProgramCRIDsw=CheckProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, tvaMainLang, programCRIDs, groupIds, requestType, errs);
			CheckProgramLocation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, tvaMainLang, programCRIDs, currentProgramCRIDsw, requestType, errs);
			break;
		case CG_REQUEST_PROGRAM:
			// program information response (6.6.2) has <ProgramLocationTable> and <ProgramInformationTable> elements
			checkTopElements(CG_SCHEMA, SCHEMA_PREFIX,  ProgramDescription, [tva.e_ProgramLocationTable, tva.e_ProgramInformationTable], [], errs, "CG041"); 
		
			CheckProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, tvaMainLang, programCRIDs, null, requestType, errs);
			CheckProgramLocation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, tvaMainLang, programCRIDs, null, requestType, errs)
			break;
		case CG_REQUEST_MORE_EPISODES:
			// more episodes response (6.7.3) has <ProgramInformationTable>, <GroupInformationTable> and <ProgramLocationTable> elements 
			checkTopElements(CG_SCHEMA, SCHEMA_PREFIX,  ProgramDescription, [tva.e_ProgramLocationTable, tva.e_ProgramInformationTable, tva.e_GroupInformationTable], [], errs, "CG051"); 

			CheckGroupInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, tvaMainLang, requestType, groupIds, errs, o);
			CheckProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, tvaMainLang, programCRIDs, groupIds, requestType, errs, o);
			CheckProgramLocation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, tvaMainLang, programCRIDs, null, requestType, errs, o);
			break;
		case CG_REQUEST_BS_CATEGORIES:
			// box set categories response (6.8.2.3) has <GroupInformationTable> element
			checkTopElements(CG_SCHEMA, SCHEMA_PREFIX,  ProgramDescription, [tva.e_GroupInformationTable], [], errs, "CG061"); 

			CheckGroupInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, tvaMainLang, requestType, null, errs, null);
			break;
		case CG_REQUEST_BS_LISTS:
			// box set lists response (6.8.3.3) has <GroupInformationTable> element
			checkTopElements(CG_SCHEMA, SCHEMA_PREFIX,  ProgramDescription, [tva.e_GroupInformationTable], [], errs, "CG071"); 
			
			CheckGroupInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, tvaMainLang, requestType, null, errs, null);
			break;
		case CG_REQUEST_BS_CONTENTS:
			// box set contents response (6.8.4.3) has <ProgramInformationTable>, <GroupInformationTable> and <ProgramLocationTable> elements 
			checkTopElements(CG_SCHEMA, SCHEMA_PREFIX,  ProgramDescription, [tva.e_ProgramLocationTable,tva.e_ProgramInformationTable, tva.e_GroupInformationTable], [], errs, "CG081"); 
			
			CheckGroupInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, tvaMainLang, requestType, groupIds, errs, o);
			CheckProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, tvaMainLang, programCRIDs, groupIds, requestType, errs, o);
			CheckProgramLocation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, tvaMainLang, programCRIDs, null, requestType, errs, o);
			break;
	}
}


/**
 * validate the content guide and record any errors
 *
 * @param {String} CGtext the service list text to be validated
 * @param {String} requestType the type of CG request/response (specified in the form/query as not possible to deduce from metadata)
 * @returns {Class} errs errors found in validaton
 */
function validateContentGuide(CGtext, requestType)  {
	var errs=new ErrorList()
	doValidateContentGuide(CGtext, requestType, errs)

	return new Promise((resolve, reject) => {
		resolve(errs)
	})
}

/**
 * Load classification schemes and other configuration files
 *
 * @param {boolean} useURLs when true, load configuration files from network locations
 */ 
function loadDataFiles(useURLs) {
	console.log("loading classification schemes...");
    allowedGenres=[];
	loadCS(allowedGenres, useURLs, TVA_ContentCSFilename, TVA_ContentCSURL);
	loadCS(allowedGenres, useURLs, TVA_FormatCSFilename, TVA_FormatCSURL);
	loadCS(allowedGenres, useURLs, DVBI_ContentSubjectFilename, DVBI_ContentSubjectURL);
/*
	console.log("loading countries...")
	if (useURLs) 
		knownCountries.loadCountriesFromURL(ISO3166_URL, true)
	else knownCountries.loadCountriesFromFile(ISO3166_Filename, true)
*/  
    console.log("loading languages...");
	if (useURLs) 
		knownLanguages.loadLanguagesFromURL(IANA_Subtag_Registry_URL, true)
	else knownLanguages.loadLanguagesFromFile(IANA_Subtag_Registry_Filename, true)
	
	console.log("loading CreditItem roles...");
	allowedCreditItemRoles=[];
	loadRoles(allowedCreditItemRoles, useURLs, DVBI_CreditsItemRolesFilename, DVBI_CreditsItemRolesURL);
	loadRoles(allowedCreditItemRoles, useURLs, DVBIv2_CreditsItemRolesFilename, DVBIv2_CreditsItemRolesURL);

	console.log("loading Schemas...");
    TVAschema=libxml.parseXmlString(fs.readFileSync(TVAschemaFileName))
}


/**
 * Process the content guide specificed for errors and display them
 *
 * @param {Object} req The request from Express
 * @param {Object} res The HTTP response to be sent to the client
 */ 
function processQuery(req, res) {

	function checkQuery(req) {
		if (req.query) {
			if (req.query.CGurl)
				return true;
			
			return false;
		}
		return true;
	}
	
    if (isEmpty(req.query)) {
		drawForm(true, res)  
		res.end();
	}  
    else if (!checkQuery(req)) {
        drawForm(true, res, req.query.CGurl, req.body.requestType, "URL not specified");
        res.status(400);
		res.end();
    }
    else {
        var errs=new ErrorList();

		function handleErrors(response) {
			if (!response.ok) {
				throw Error(response.statusText)
			}
			return response
		}
		fetch(req.query.CGurl)
			.then(handleErrors)
			.then(response => response.text())
			.then(res=>validateContentGuide(res.replace(/(\r\n|\n|\r|\t)/gm,""), req.body.requestType))
			.then(errs=>drawForm(true, res, req.query.CGurl, req.body.requestType, null, errs))
			.then(res=>res.end())
			.catch(error => console.log("error ("+error+") handling "+req.query.CGurl))
    }
}


/**
 * Process the content guide specificed by a file name for errors and display them
 *
 * @param {Object} req The request from Express
 * @param {Object} res The HTTP response to be sent to the client
 */ 
function processFile(req,res) {
	
	function checkFile(req) {
		if (req.files) {
			if (req.files.CGfile)
				return true;
			
			return false;
		}
		return true;
	}
	
    if (isEmpty(req.query)) 
        drawForm(false, res);    
    else if (!checkFile(req)) {
        drawForm(false, res, req.files.CGfile.name, req.body.requestType, "File not specified");
        res.status(400);
    }
    else {
        let CGxml=null, errs=new ErrorList(), fname="***"
		if (req && req.files && req.files.CGfile) fname=req.files.CGfile.name;
        try {
            CGxml=req.files.CGfile.data;
        }
        catch (err) {
            errs.pushCode("PF001", "retrieval of FILE ("+fname+") failed");
        }
		if (CGxml) 
			doValidateContentGuide(CGxml.toString().replace(/(\r\n|\n|\r|\t)/gm,""), req.body.requestType, errs);
		
        drawForm(false, res, fname, req.body.requestType, null, errs);
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
loadDataFiles(options.urls)

//middleware
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

var app=express();
app.use(morgan(":remote-addr :protocol :method :url :status :res[content-length] - :response-time ms :agent :parseErr :cgLoc"));

app.use(express.static(__dirname));
app.set('view engine', 'ejs');
app.use(fileUpload());

// initialize Express
app.use(express.urlencoded({ extended: true }));

app.use(favicon(path.join('phlib','ph-icon.ico')))

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
var http_server=app.listen(options.port, function() {
    console.log("HTTP listening on port number", http_server.address().port);
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
        console.log("HTTPS listening on port number", https_server.address().port);
    });
}
