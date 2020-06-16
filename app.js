// node.js - https://nodejs.org/en/
// express framework - https://expressjs.com/en/4x/api.html
const express=require("express");
var app=express();


const fs=require("fs"), path=require("path");

const ErrorList=require("./dvb-common/ErrorList.js");
const dvbi=require("./dvb-common/DVB-I_definitions.js");
const {isJPEGmime, isPNGmime}=require("./dvb-common/MIME_checks.js");
const {isCRIDURI}=require("./dvb-common/URI_checks.js");
const {loadCS}=require("./dvb-common/CS_handler.js");

const ISOcountries=require("./dvb-common/ISOcountries.js");

// curl from https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry
const IANA_Subtag_Registry_Filename=path.join("./dvb-common","language-subtag-registry");
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

const CG_REQUEST_SCHEDULE_TIME="schedInfo-time";
const CG_REQUEST_SCHEDULE_NOWNEXT="schedInfo-now";
const CG_REQUEST_SCHEDULE_WINDOW="schedInfo-window";
const CG_REQUEST_PROGRAM="progInfo";
const CG_REQUEST_EPISODES="moreEpisodes";
const CG_REQUEST_BS_CATEGORIES="bsCategories";
const CG_REQUEST_BS_LISTS="bsLists";
const CG_REQUEST_BS_CONTENTS="bsContents";

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
      

var allowedGenres=[], allowedCreditItemRoles=[];

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


/**
 * validate the language specified record any errors
 *
 * @param {object} validator  the validation class to use
 * @param {Class}  errs       errors found in validaton
 * @param {Object} node       the XML node whose @lang attribute should be checked
 * @param {string} parentLang the language of the XML element which is the parent of node
 * @returns {string} the @lang attribute of the node element of the parentLang if it does not exist of is not specified
 */
function GetLanguage(validator, errs, node, parentLang, isRequired) {
	if (!node) 
		return parentLang;
	if (!node.attr('lang') && isRequired) {
		errs.push("@lang is required for \""+node.name()+"\""));
		return parentLang;		
	}

	var localLang=node.attr('lang').value();
	if (!validator)
		errs.push("cannot validate language \""+localLang+"\" for \""+node.name()+"\"");
	else if (!validator.isKnown(localLang)) 
		errs.push("language \""+localLang+"\" specified for \""+node.name()+"\" is invalid");
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
 * read a the list of valid roles from a file 
 *
 * @param {Array} values         the linear list of values 
 * @param {String} rolesFilename the filename to load
 */
function loadRolesFromFile(values, rolesFilename) {
	console.log("reading CS from", rolesFilename);
    fs.readFile(rolesFilename, {encoding: "utf-8"}, function(err,data){
        if (!err) 
			addRoles(values, data);
        else 
            console.log(err);
    });
}

/**
 * read a the list of valid roles from a network location referenced by a REL  
 *
 * @param {Array} values 	The linear list of values
 * @param {String} rolesURL URL to the load
 */
function loadRolesFromURL(values, rolesURL) { 
	console.log("retrieving @roles from", rolesURL);
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
 * converts a decimal representation of a string to a number
 *
 * @param {string} str        string contining the decimal value
 * @returns {integer}  the decimal representation of the string, or 0 is non-digits are included
 * 
 */
function valUnsignedInt(str) {
	var intRegex=/[\d]+/g;
	var s=str.match(intRegex);
	return s[0]===str ? parseInt(str, 10) : 0;
}


/**
 * constructs HTML output of the errors found in the content guide analysis
 *
 * @param {boolean} URLmode if true ask for a URL to a content guide, if false ask for a file
 * @param {Object} res the Express result 
 * @param {string} lastURL the url of the content guide - used to keep the form intact
 * @param {Object} o the errors and warnings found during the content guide validation
 */
function drawForm(URLmode, res, lastInput, lastType, o) {
	
	const FORM_TOP="<html><head><title>DVB-I Content Guide Validator</title></head><body>";
	const PAGE_HEADING="<h1>DVB-I Content Guide Validator</h1>";
	const ENTRY_FORM_URL="<form method=\"post\"><p><i>URL:</i></p><input type=\"url\" name=\"CGurl\" value=\"%s\"><input type=\"submit\" value=\"submit\"></form>";

	const ENTRY_FORM_FILE="<form method=\"post\" encType=\"multipart/form-data\"><p><i>FILE:</i></p><input type=\"file\" name=\"CGfile\" value=\"%s\"><input type=\"submit\" value=\"submit\">";

	const ENTRY_FORM_REQUEST_TYPE_HEADER="<p><i>REQUEST TYPE:</i></p>";

	const ENTRY_FORM_REQUEST_TYPE_ID="requestType";
	const ENTRY_FORM_REQUEST_TYPES=[{"value":CG_REQUEST_SCHEDULE_TIME,"label":"Schedule Info (time stamp)"},
									{"value":CG_REQUEST_SCHEDULE_NOWNEXT,"label":"Schedule Info (now/next)"},
									{"value":CG_REQUEST_SCHEDULE_WINDOW,"label":"Schedule Info (window)"},
									{"value":CG_REQUEST_PROGRAM,"label":"Program Info"},
									{"value":CG_REQUEST_EPISODES,"label":"More Episodes"},
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
		if (lastType==choice.value) {
			res.write(" checked")
		}
		res.write(">"+choice.label+"</input>")
	});
	res.write(FORM_END);
	
    res.write(RESULT_WITH_INSTRUCTION);
    if (o) {
        if (o.error) {
            res.write("<p>"+o.error+"</p>");
        }
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
                    res.write("<table><tr><th>errors</th></tr>");
                    tableHeader=true;                    
                }
                var t=value.replace(/</g,"&lt").replace(/>/g,"&gt");
                res.write("<tr><td>"+HTMLize(value)+"</td></tr>");
                resultsShown=true;
            });
            if (tableHeader) res.write("</table>");
            
            tableHeader=false;
            o.errors.messagesWarn.forEach(function(value)
            {
                if (!tableHeader) {
                    res.write("<table><tr><th>warnings</th></tr>");
                    tableHeader=true;                    
                }
                res.write("<tr><td>"+HTMLize(value)+"</td></tr>");
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
    while (elem=node.get(SCHEMA_PREFIX+":RelatedMaterial[" + i++ + "]", CG_SCHEMA)) {
        var hr=elem.get(SCHEMA_PREFIX+":HowRelated", CG_SCHEMA);
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
			errs.push("Element <"+elem+"> not specified in <"+parentElement.name()+">");
	});
	
	// check that no additional child elements existance
	var c=0, child;
	while (child=parentElement.child(c++)) {
		if (!isIn(childElements, child.name())) {
			if (child.name()!='text')
				errs.push("Element <"+child.name()+"> not permitted");
		}
	}
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
 */
function ValidateSynopsis(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, requiredLengths, optionalLengths, requestType, errs, parentLanguage) {
	
	function synopsisLengthError(label, length) {
		return "length of <Synopsis length=\""+label+"\"> exceeds "+length+" characters"; }
	function singleLengthLangError(length, lang) {
		return "only a single Synopsis is permitted per length ("+length+") and language ("+lang+")"; }
	function requiredSynopsisError(length) {
		return "a synposis with @length=\""+length+"\" is required"; }
	
	var s=0, Synopsis, hasShort=false, hasMedium=false, hasLong=false;
	var shortLangs=[], mediumLangs=[], longLangs=[];
	while (Synopsis=BasicDescription.child(s++)) {
		if (Synopsis.name()=="Synopsis") {
			var synopsisLang=GetLanguage(knownLanguages, errs, Synopsis, parentLanguage);
			var synopsisLength=Synopsis.attr('length')?Synopsis.attr('length').value():null;
			
			if (synopsisLength) {
				if (isIn(requiredLengths, synopsisLength) || isIn(optionalLengths, synopsisLength)) {
					switch (synopsisLength) {
					case dvbi.SYNOPSIS_SHORT_LABEL:
						if ((unEntity(Synopsis.text()).length) > dvbi.SYNOPSIS_SHORT_LENGTH)
							errs.push(synopsisLengthError(dvbi.SYNOPSIS_SHORT_LABEL, dvbi.SYNOPSIS_SHORT_LENGTH));
						hasShort=true;
						break;
					case dvbi.SYNOPSIS_MEDIUM_LABEL:
						if ((unEntity(Synopsis.text()).length) > dvbi.SYNOPSIS_MEDIUM_LENGTH)
							errs.push(synopsisLengthError(dvbi.SYNOPSIS_MEDIUM_LABEL, dvbi.SYNOPSIS_MEDIUM_LENGTH));
						hasMedium=true;
						break;
					case dvbi.SYNOPSIS_LONG_LABEL:
						if ((unEntity(Synopsis.text()).length) > dvbi.SYNOPSIS_LONG_LENGTH)
							errs.push(synopsisLengthError(dvbi.SYNOPSIS_LONG_LABEL, dvbi.SYNOPSIS_LONG_LENGTH));
						hasLong=true;
						break;						
					}
				}
				else
					errs.push("@length=\""+synopsisLength+"\" is not permitted for this request type");
			}
			else 
				errs.push("@length attribute is required for <Synopsis>"); //!!!!
			
			if (synopsisLang && synopsisLength) {
				switch (synopsisLength) {
					case dvbi.SYNOPSIS_SHORT_LABEL:
						if (isIn(shortLangs, synopsisLang)) 
							errs.push(singleLengthLangError(synopsisLength, synopsisLang));
						else shortLangs.push(synopsisLang);
						break;
					case dvbi.SYNOPSIS_MEDIUM_LABEL:
						if (isIn(mediumLangs, synopsisLang)) 
							errs.push(singleLengthLangError(synopsisLength, synopsisLang));
						else mediumLangs.push(synopsisLang);
						break;
					case dvbi.SYNOPSIS_LONG_LABEL:
						if (isIn(longLangs, synopsisLang)) 
							errs.push(singleLengthLangError(synopsisLength, synopsisLang));
						else longLangs.push(synopsisLang);
						break;
				}
			}
		}
	}
	// note that current DVB-I specifiction only mandates "medium" length, but all three are checked here
	if (isIn(requiredLengths, dvbi.SYNOPSIS_SHORT_LABEL) && !hasShort)
		errs.push(requiredSynopsisError(dvbi.SYNOPSIS_SHORT_LABEL));	
	if (isIn(requiredLengths, dvbi.SYNOPSIS_MEDIUM_LABEL) && !hasMedium)
		errs.push(requiredSynopsisError(dvbi.SYNOPSIS_MEDIUM_LABEL));	
	if (isIn(requiredLengths, dvbi.SYNOPSIS_LONG_LABEL) && !hasLong)
		errs.push(requiredSynopsisError(dvbi.SYNOPSIS_LONG_LABEL));	
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
 */
function ValidateKeyword(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, minKeywords, maxKeywords, errs, parentLanguage) {
	var k=0, Keyword, counts=[];
	while (Keyword=BasicDescription.child(k++)) {
		if (Keyword.name()=="Keyword") {
			var keywordType=Keyword.attr('type') ? Keyword.attr('type').value() : "main";
			var keywordLang=GetLanguage(knownLanguages, errs, Keyword, parentLanguage);

			if (counts[keywordLang]===undefined)
				counts[keywordLang]=1
			else counts[keywordLang]++;
			if (keywordType!="main" && keywordType!="other")
				errs.push("@type=\""+keywordType+"\" not permitted for <Keyword>");
			if (unEntity(Keyword.text()).length > dvbi.MAX_KEYWORD_LENGTH)
				errs.push("<Keyword> length is greater than "+dvbi.MAX_KEYWORD_LENGTH);
		}
	}
	for (var i in counts) {
        if (counts[i]!=0 && counts[i]>maxKeywords) 
            errs.push("More than "+maxKeywords+" <Keyword> element"+(maxKeywords>1?"s":"")+" specified"+(i==DEFAULT_LANGUAGE?"":" for language \""+i+"\""));
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
 */
function ValidateGenre(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, minGenres, maxGenres, errs) {
	var g=0, Genre, count=0;
	while (Genre=BasicDescription.child(g++)) {
		if (Genre.name()=="Genre") {
			count++;
			var genreType=Genre.attr('type') ? Genre.attr('type').value() : "main";
			if (genreType!="main")
				errs.push("@type=\""+genreType+"\" not permitted for <Genre>");
			
			var genreValue=Genre.attr('href') ? Genre.attr('href').value() : "";
			if (!isIn(allowedGenres, genreValue))
				errs.push("invalid value \""+genreValue+"\" for <Genre>");
		}
	}
	if (count>maxGenres)
		errs.push("More than "+maxGenres+" <Genre> element"+(maxGenres>1?"s":"")+" specified");
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
 */
function ValidateParentalGuidance(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, minPGelements, maxPGelements, errs) {
	// first <ParentalGuidance> element must contain an <mpeg7:MinimumAge> element
	var pg=0, ParentalGuidance, countParentalGuidance=0;
	
	while (ParentalGuidance=BasicDescription.child(pg++)) {
		if (ParentalGuidance.name()=="ParentalGuidance") {
			countParentalGuidance++;
			
			var pgc=0, pgChild, countExplanatoryText=0;
			while (pgChild=ParentalGuidance.child(pgc++)) {
				
				if (pgChild.name()!="text") {
					
					if (pgChild.name()=="MinimumAge" || pgChild.name()=="ParentalRating") {
						if (countParentalGuidance==1 && pgChild.name()!="MinimumAge")
							errs.push("first <ParentalGuidance> element must contain <mpeg7:MinimumAge>");
						
						if (pgChild.name()=="MinimumAge" && countParentalGuidance!=1)
							errs.push("<MinimumAge> must be in the first <ParentalGuidance> element");
						
						if (pgChild.name()=="ParentalRating") {
							if (!pgChild.attr('href'))
								NoHrefAttribute(errs, "<ParentalRating>", "<ParentalGuidance>")
						}
					}
					if (pgChild.name()=="ExplanatoryText") {
						countExplanatoryText++;
						if (pgChild.attr('length')) {
							if (pgChild.attr('length').value()!="long")
								errs.push("@length=\""+pgChild.attr('length').value()+"\" is not allowed for <ExplanatoryText>")
						}
						else 
							errs.push("@length=\"long\" is required for <ExplanatoryText>");
						
						if (unEntity(pgChild.text()).length > dvbi.MAX_EXPLANATORY_TEXT_LENGTH)
							errs.push("length of <ExplanatoryText> cannot exceed "+dvbi.MAX_EXPLANATORY_TEXT_LENGTH+"");
					}
				}
			}
			if (countExplanatoryText > 1)
				errs.push("only a single <ExplanatoryText> element is premitted in <ParentalGuidance>")
		}
	}
	if (countParentalGuidance>maxPGelements)
		errs.push("no more than "+maxPGelements+"<ParentalGuidance> elements are premitted");
}


/**
 * validate a name (either PersonName of Character) to ensure a single GivenName is present with a single optional FamilyName
 *
 * @param {string}  CG_SCHEMA        Used when constructing Xpath queries
 * @param {string}  SCHEMA_PREFIX    Used when constructing Xpath queries
 * @param {Object}  elem             the element whose children should be checked
 * @param {Class}   errs             errors found in validaton
 */
function ValidateName(CG_SCHEMA, SCHEMA_PREFIX, elem, errs ) {
	
	function checkNamePart(elem, parentElem, errs) {
		if (unEntity(elem.text()).length > dvbi.MAX_NAME_PART_LENGTH)	
			errs.push("<"+elem.name()+"> in <"+parentElem.name()+"> is longer than "+dvbi.MAX_NAME_PART_LENGTH+" characters");
	}
	var se=0, subElem;
	var familyNameCount=0, givenNameCount=0, otherElemCount=0;
	while (subElem=elem.child(se++)) {
		switch (subElem.name()) {
			case "GivenName":
				givenNameCount++;
				checkNamePart(subElem, elem, errs);
			    break;
			case "FamilyName":
				familyNameCount++;
				checkNamePart(subElem, elem, errs);
			    break;
			default:
				otherElemCount++;			
		}
	}
	if (givenNameCount==0)
		errs.push("<GivenName> is mandatory in <"+elem.name()+">");
	if (familyNameCount>1)
		errs.push("only a single <FamilyName> is permitted in <"+elem.name()+">");
}

/**
 * validate the <CreditsList> elements specified
 *
 * @param {string}  CG_SCHEMA           Used when constructing Xpath queries
 * @param {string}  SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object}  BasicDescription    the element whose children should be checked
 * @param {Class}   errs                errors found in validaton
 */
function ValidateCreditsList(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, errs) {
	var CreditsList=BasicDescription.get(SCHEMA_PREFIX+":CreditsList", CG_SCHEMA);
	if (CreditsList) {
		var ci=0, CreditsItem;		
		while (CreditsItem=CreditsList.child(ci++)) {
			if (CreditsItem.name()=="CreditsItem") {
				if (CreditsItem.attr('role')) {
					var CreditsItemRole=CreditsItem.attr('role').value();
					if (!isIn(allowedCreditItemRoles, CreditsItemRole))
						errs.push("\""+CreditsItemRole+"\" is not valid for CreditsItem@role");
				}
				else 
					errs.push("CreditsItem@role not specified")
				var foundPersonName=0, foundCharacter=0, foundOrganizationName=0;
				var s=0, elem;
				while (elem=CreditsItem.child(s++)) {
					switch (elem.name()) {
						case "PersonName":
							foundPersonName++;
							// required to have a GivenName optionally have a FamilyName
							ValidateName(CG_SCHEMA, SCHEMA_PREFIX, elem, errs );
							break;
						case "Character":
							foundCharacter++;
							// required to have a GivenName optionally have a FamilyName
							ValidateName(CG_SCHEMA, SCHEMA_PREFIX, elem, errs );
							break;
						case "OrganizationName":
							foundOrganizationName++;
							if (unEntity(elem.text()).length > dvbi.MAX_ORGANIZATION_NAME_LENGTH)
								errs.push("length of <OrganizationName> in <CreditsItem> exceeds "+dvbi.MAX_ORGANIZATION_NAME_LENGTH+" characters")
							break;
						default:
							if (elem.name()!="text")
								errs.push("extra element <"+elem.name()+"> found in <CreditsItem>");
					}
					if (foundPersonName>1)
						errs.push("only a single <PersonName> is permitted in <CreditsItem>");
					if (foundCharacter>1)
						errs.push("only a single <Character> is permitted in <CreditsItem>");
					if (foundOrganizationName>1)
						errs.push("only a single <OrganizationName> is permitted in <CreditsItem>");
					if (foundCharacter>0 && foundPersonName==0)
						errs.push("<CharacterName> in <CreditsItem> requires <PersonName>");
					if (foundOrganizationName>0 && (foundPersonName>0 || foundCharacter>0))
						errs.push("<OrganizationName> can only be present when <PersonName> is absent in <CreditsItem>");
				}			
				if (foundPersonName>1)
					errs.push("only a single <PersonName> is permitted in <CreditsItem>")
				if (foundCharacter>1)
					errs.push("only a single <Character> is permitted in <CreditsItem>")
				if (foundOrganizationName>1)
					errs.push("only a single <Organization> is permitted in <CreditsItem>")
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
function ValidateRelatedMaterial(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, minRMelements, maxRMelements, errs) {
	var rm=0, RelatedMaterial, countRelatedMaterial=0;
	while (RelatedMaterial=BasicDescription.child(rm++)) {
		if (RelatedMaterial.name()=="RelatedMaterial") {
			countRelatedMaterial++;
			
			// no additional checks are needed - DVB-I client should be robust to any siganlled RelatedMaterial
		}
	}
	if (countRelatedMaterial > maxRMelements)
		errs.push("a maximum of "+maxRMelements+" <RelatedMaterial> are permitted")
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
function NoChildElement(errs, missingElement, parentElement, schemaLocation=null) {
	errs.push(missingElement+" element not specified for "+parentElem + (schemalocation)?" in "+schemalocation:"");
}

/**
 * Add an error message when the @href contains an invalid value
 *
 * @param {Object} errs Errors buffer
 * @param {String} value The invalid value for the href attribute
 * @param {String} src The element missing the @href
 * @param {String} loc The location of the element
 */
function InvalidHrefValue(errs, value, src, loc) {
	errs.push("invalid @href=\""+value+"\" specified for "+src+" in "+loc);
}

/**
 * Add an error message when the @href is not specified for an element
 *
 * @param {Object} errs Errors buffer
 * @param {String} src The element missing the @href
 * @param {String} loc The location of the element
 */
function NoHrefAttribute(errs, src, loc) {
	errs.push("no @href specified for "+src+" in "+loc);
}

/**
 * Add an error message when the MediaLocator does not contain a MediaUri sub-element
 *
 * @param {Object} errs Errors buffer
 * @param {String} src The type of element with the <MediaLocator>
 * @param {String} loc The location of the element
 */
function NoAuxiliaryURI(errs, src, loc) {
	NoChilsElement(errs, "<AuxiliaryURI>", src+" <MediaLocator>", loc )
}


/**TemplateAITPromotional Still Image
 *
 * @param {Object} RelatedMaterial   the <RelatedMaterial> element (a libxmls ojbect tree) to be checked
 * @param {Object} errs              The class where errors and warnings relating to the serivce list processing are stored 
 * @param {string} Location          The printable name used to indicate the location of the <RelatedMaterial> element being checked. used for error reporting
 * @param {string} LocationType      The type of element containing the <RelatedMaterial> element. Different validation rules apply to different location types
  */
function ValidateTemplateAIT(CG_SCHEMA, SCHEMA_PREFIX, RelatedMaterial, errs, Location, LocationType) {
    var HowRelated=null, Format=null, MediaLocator=[];
    var c=0, elem;
    while (elem=RelatedMaterial.child(c++)) {
        if (elem.name()==="HowRelated")
            HowRelated=elem;
        else if (elem.name()==="MediaLocator")
            MediaLocator.push(elem);
    }

    if (!HowRelated) {
		NoChildElement(errs, "<HowRelated>", "<RelatedMaterial>", Location);
		return;
    }
	var HRhref=HowRelated.attr("href");
	
	if (HRhref) {
		if (HRhref.value()!=dvbi.TEMPLATE_AIT_URI) 
			errs.push("HowRelated@href=\""+HRhref.value()+"\" does not designate a Template AIT");
		else {		
			if (MediaLocator.length!=0) 
				MediaLocator.forEach(ml => {
					var subElems=ml.childNodes(), hasAuxiliaryURI=false;
					if (subElems) subElems.forEach(child => {
						if (child.name()=="AuxiliaryURI") {
							hasAuxiliaryURI=true;
							if (!child.attr("contentType")) 
								NoChildElement(errs, "@contentType", "Template IT <AuxiliaryURI>", Location);
							else {
								var contentType=child.attr("contentType").value();
								if (contentType!=dvbi.XML_AIT_CONTENT_TYPE) 
									errs.push("invalid @contentType \""+contentType+"\" specified for <RelatedMaterial><MediaLocator> in "+Location);
							}
						}
					});	
					if (!hasAuxiliaryURI) 
						NoAuxiliaryURI(errs, "template AIT", Location);
				});
			else 
				NoChildElement(errs, "<MediaLocator>", "<RelatedMaterial>", Location);
		}
	}
	else 
		NoHrefAttribute(errs, "<RelatedMaterial><HowRelated>", Location);
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
        if (elem.name()==="HowRelated")
            HowRelated=elem;
        else if (elem.name()==="Format")
            Format=elem;
        else if (elem.name()==="MediaLocator")
            MediaLocator.push(elem);
    }

    if (!HowRelated) {
		NochildElement(errs, "<HowRelated>", "<RelatedMaterial>", Location);
		return;
    }
	var HRhref=HowRelated.attr("href");
	if (HRhref) {
		if (HRhref.value()!=dvbi.PROMOTIONAL_STILL_IMAGE_URI) 
			errs.push("HowRelated@href=\""+HRhref.value()+"\" does not designate a Promotional Still Image");
		else {
			if (Format) {
				var subElems=Format.childNodes(), hasStillPictureFormat=false;
				if (subElems) subElems.forEach(child => {
					if (child.name()=="StillPictureFormat") {
						hasStillPictureFormat=true;
						if (!child.attr("horizontalSize")) 
							NoChildElement(errs, "@horizontalSize", "<RelatedMaterial><Format><StillPictureFormat>", Location);
						if (!child.attr("verticalSize")) 
							NoChildElement(errs, "@verticalSize", "<RelatedMaterial><Format><StillPictureFormat>", Location);
						if (child.attr("href")) {
							var href=child.attr("href").value();
							if (href!=JPEG_IMAGE_CS_VALUE && href!=PNG_IMAGE_CS_VALUE) 
								InvalidHrefValue(errs, href, "<RelatedMaterial><Format><StillPictureFormat>", Location)
							if (href==JPEG_IMAGE_CS_VALUE) isJPEG=true;
							if (href==PNG_IMAGE_CS_VALUE) isPNG=true;
						}
						else 
							NoHrefAttribute(errs, "<RelatedMaterial><Format>", Location);
					}
				});
				if (!hasStillPictureFormat) 
					NoChildElement(errs, "<StillPictureFormat>", "<Format>",Location);
			}

			if (MediaLocator.length!=0) 
				MediaLocator.forEach(ml => {
					var subElems=ml.childNodes(), hasMediaURI=false;
					if (subElems) subElems.forEach(child => {
						if (child.name()=="MediaUri") {
							hasMediaURI=true;
							if (!child.attr("contentType")) 
								NoChildElement(errs, "@contentType", "logo <MediaURI>", Location);
							else {
								var contentType=child.attr("contentType").value();
								if (!isJPEGmime(contentType) && !isPNGmime(contentType)) 
									errs.push("invalid @contentType \""+contentType+"\" specified for <RelatedMaterial><MediaLocator> in "+Location);
								if (Format && ((isJPEGmime(contentType) && !isJPEG) || (isPNGmime(contentType) && !isPNG))) 
									errs.push("conflicting media types in <Format> and <MediaUri> for "+Location);
							}
						}
					});
					if (!hasMediaURI) 
						NoMediaLocator(errs, "logo", Location);
				});
			else 
				NoChildElement(errs, "<MediaLocator>", "<RelatedMaterial>", Location);
		}
	}
	else 
		NoHrefAttribute(errs, "<RelatedMaterial><HowRelated>", Location);
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
function ValidateRelatedMaterialBoxSetList(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, errs, Location) {
	var countImage=0, countTemplateAIT=0, countPaginationFirst=0, countPaginationPrev=0, countPaginationNext=0, countPaginationLast=0;
	var rm=0, RelatedMaterial;
	while (RelatedMaterial=BasicDescription.child(rm++)) {
		if (RelatedMaterial.name()=="RelatedMaterial") {
			var HowRelated=RelatedMaterial.get(SCHEMA_PREFIX+":HowRelated", CG_SCHEMA);
			if (!HowRelated) 
				NoChildElement(errs, "<HowRelated>", "<RelatedMaterial>")
			else {				
				if (!HowRelated.attr('href')) 
					NoHrefAttribute(errs, "<HowRelated>", "<RelatedMaterial>");
				else {
					var hrHref=HowRelated.attr('href').value();
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
							InvalidHrefValue(errs, +hrHref, "<HowRelated>", "<RelatedMaterial> in Box Set List");
					}	
				}
			}
		}
	}
	if (countTemplateAIT==0)
		errs.push("a <RelatedMaterial> element signalling the Template XML AIT must be specified for a Box Set List");
	if (countTemplateAIT>1)
		errs.push("only one <RelatedMaterial> element signalling the Template XML AIT can be specified for a Box Set List");
	if (countImage>1)
		errs.push("only one <RelatedMaterial> element signalling the promotional still image can be specified for a Box Set List");
	var numPaginations=countPaginationFirst+countPaginationPrev+countPaginationNext+countPaginationLast;
	if (numPaginations!=0 && numPaginations!=2 && numPaginations!=4)
		errs.push("only 0, 2 or 4 paginations links may be siganlled in <RelatedMaterial> elements for a Box Ser List");
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
 */
function ValidateTitle(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, allowSecondary, errs, parentLanguage) {
	var mainSet=[], secondarySet=[];
	var t=0, Title;
	while (Title=BasicDescription.child(t++)) {
		if (Title.name()=="Title") {
			var titleType=Title.attr('type') ? Title.attr('type').value() : "main"; // MPEG7 default type is "main"
			var titleLang=GetLanguage(knownLanguages, errs, Title, parentLanguage);

			var titleStr=unEntity(Title.text());
			
			if (titleStr.length > dvbi.MAX_TITLE_LENGTH)
				errs.push("<Title> length exceeds "+dvbi.MAX_TITLE_LENGTH+" characters")
			if (titleType=="main") {
				if (isIn(mainSet, titleLang))
					errs.push("only a single language is permitted for @type=\"main\"")
				else mainSet.push(titleLang);
			}
			else if (titleType="secondary") {
				if (allowSecondary) {
					if (isIn(secondarySet, titleLang))
						errs.push("only a single language is permitted for @type=\"secondary\"")
					else secondarySet.push(titleLang);
				}
				else 
					errs.push("Title@type=\"secondary\" is not permitted for this <"+BasicDescription.name()+">");
			}
			else
				errs.push("type=\""+titleType+"\" is not permitted for <Title>");
			
			secondarySet.forEach(lang => {
				if (!isIn(mainSet, lang)) {
					var t=lang!=DEFAULT_LANGUAGE ? " for @xml:lang=\""+lang+"\"" : "";
					errs.push("@type=\"secondary\" specified without @type=\"main\""+t);
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
	if (requestType==CG_REQUEST_SCHEDULE_NOWNEXT || requestType==CG_REQUEST_SCHEDULE_WINDOW)
		return;

	var isParentGroup=parentElement==categoryGroup;
	var BasicDescription=parentElement.get(SCHEMA_PREFIX+":BasicDescription", CG_SCHEMA);

	if (!BasicDescription) 
		NoChildElement(errs, "<BasicDescription>", parentElement.name());
	else {
		var bdLang=GetLanguage(knownLanguages, errs, BasicDescription, parentLanguage);

		// <Title> - 
		switch (requestType) {
			case CG_REQUEST_SCHEDULE_NOWNEXT:
			case CG_REQUEST_SCHEDULE_WINDOW:
				break;
			case CG_REQUEST_SCHEDULE_TIME:
			case CG_REQUEST_PROGRAM:
			case CG_REQUEST_BS_CONTENTS:
				// only 1..2 elements per language permitted with "main" and optional "secondary" 
				ValidateTitle(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, true, errs, bdLang);
				break;
			case CG_REQUEST_BS_LISTS:
				// only 1 elements per language permitted with "main" 
				ValidateTitle(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, false, errs, bdLang);
				break;
			default:
				// make sure <Title> elements are not in the Basic Description
				if (ElementFound(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, "Title")) 
					errs.push("<Title> not permitted in <BasicDescription> for this request type");
		}

		// <Synopsis> - validity depends on use
		switch (requestType) {
			case CG_REQUEST_SCHEDULE_NOWNEXT:
			case CG_REQUEST_SCHEDULE_WINDOW:
				break;
			case CG_REQUEST_SCHEDULE_TIME:
				// clause 6.10.5.2 -- 1..2 instances permitted - one each of @length="short"(90) and (required)"medium"(250)
				ValidateSynopsis(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [dvbi.SYNOPSIS_MEDIUM_LABEL], [dvbi.SYNOPSIS_SHORT_LABEL],requestType, errs, bdLang);
				break;
			case CG_REQUEST_PROGRAM:
				// clause 6.10.5.3 -- 1..3 instances permitted - one each of @length="short"(90), (required)"medium"(250) and "long"(1200)
				ValidateSynopsis(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [dvbi.SYNOPSIS_MEDIUM_LABEL], [dvbi.SYNOPSIS_SHORT_LABEL,dvbi.SYNOPSIS_LONG_LABEL], requestType, errs, bdLang);
				break;
			case CG_REQUEST_BS_LISTS:		// clause 6.10.5.5
				// only 1 instance permitted - @length="medium"(250)
				if (!isParentGroup)
					ValidateSynopsis(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [dvbi.SYNOPSIS_MEDIUM_LABEL], [], requestType, errs, bdLang);
				else if (ElementFound(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, "Synopsis"))
					errs.push("<Synopsis> not permitted in \"category group\" for this request type");
				break;
			case CG_REQUEST_BS_CONTENTS: 	// clause 6.10.5.4
				// only 1 instance permitted - @length="medium"(250)
				ValidateSynopsis(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [dvbi.SYNOPSIS_MEDIUM_LABEL], [], requestType, errs, bdLang);
				break;
			default:
				// make sure <Synopsis> elements are not in the Basic Description
				if (ElementFound(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, "Synopsis")) 
					errs.push("<Synopsis> not permitted in <BasicDescription> for this request type");
		}

		// <Keyword> - 
		switch (requestType) {
			case CG_REQUEST_PROGRAM:	// clause 6.10.5.3 -- 0..20 instances permitted
				ValidateKeyword(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, 0, 20, errs, bdLang);
				break;
			case CG_REQUEST_BS_LISTS:   // clause 6.10.5.5 -- 0..20 instances permitted		
				if (!isParentGroup)
					ValidateKeyword(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, 0, 20, errs, bdLang);
				else if (ElementFound(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, "Keyword"))
					errs.push("<Keyword> not permitted in \"category group\" for this request type");
				break;			
			default:
				// make sure <Keyword> elements are not in the Basic Description
				if (ElementFound(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, "Keyword")) 
					errs.push("<Keyword> not permitted in <BasicDescription> for this request type");
		}

		// <Genre> - 
		switch (requestType) {
			case CG_REQUEST_SCHEDULE_NOWNEXT:
			case CG_REQUEST_SCHEDULE_WINDOW:		 
				break;
			case CG_REQUEST_SCHEDULE_TIME:		// clause 6.10.5.2 -- 0..1 instances permitted
			case CG_REQUEST_PROGRAM:			// clause 6.10.5.3 -- 0..1 instances permitted 			
				ValidateGenre(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, 0, 1, errs);
				break;
			default:
				// make sure <Genre> elements are not in the Basic Description
				if (ElementFound(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, "Genre")) 
					errs.push("<Genre> not permitted in <BasicDescription> for this request type");
		}

		// <ParentalGuidance> - 
		switch (requestType) {
			case CG_REQUEST_SCHEDULE_NOWNEXT:
			case CG_REQUEST_SCHEDULE_WINDOW:
				break;
			case CG_REQUEST_SCHEDULE_TIME:		// clause 6.10.5.2 -- 0..2 instances permitted - first must contain age
			case CG_REQUEST_PROGRAM:			// clause 6.10.5.3 -- 0..2 instances permitted - first must contain age 		
			case CG_REQUEST_BS_CONTENTS:		// clause 6.10.5.4 -- 0..2 instances permitted - first must contain age	
				ValidateParentalGuidance(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, 0, 2, errs);
				break;
			default:
				// make sure <ParentalGuidance> elements are not in the Basic Description
				if (ElementFound(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, "ParentalGuidance")) 
					errs.push("<ParentalGuidance> not permitted in <BasicDescription> for this request type");
		}
		
		// <CreditsList> - 
		switch (requestType) {
			case CG_REQUEST_PROGRAM:
				// clause 6.10.5.3 -- 
				ValidateCreditsList(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription,  errs);
				break;
			default:
				// make sure <CreditsList> elements are not in the Basic Description
				if (ElementFound(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, "CreditsList")) 
					errs.push("<CreditsList> not permitted in <BasicDescription> for this request type");
		}		
		// <RelatedMaterial> - 
		switch (requestType) {
			case CG_REQUEST_SCHEDULE_NOWNEXT:
			case CG_REQUEST_SCHEDULE_WINDOW:
				break;
			case CG_REQUEST_SCHEDULE_TIME:
				// clause 6.10.5.2 -- 0..1 instances permitted 
				ValidateRelatedMaterial(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription,  0, 1, errs);
				break;
			case CG_REQUEST_PROGRAM:
				// clause 6.10.5.3 -- 0..1 instances permitted - first must contain age 
				ValidateRelatedMaterial(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription,  0, 1, errs);
				break;
			case CG_REQUEST_BS_CONTENTS:
				// clause 6.10.5.4 -- 0..1 instances permitted - first must contain age
				ValidateRelatedMaterial(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription,  0, 1, errs);
				break;
			case CG_REQUEST_BS_LISTS:			// clause 6.10.5.5 - three cases
				if (!isParentGroup)
					ValidateRelatedMaterialBoxSetList(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, errs);
				else if (ElementFound(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, "RelatedMterial"))
					errs.push("<RelatedMaterial> not permitted in \"category group\" for this request type");
				break;
			default:
				// make sure <RelatedMaterial> elements are not in the Basic Description
				if (ElementFound(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, "RelatedMaterial")) 
					errs.push("<RelatedMaterial> not permitted in <BasicDescription> for this request type");
		}
	}	
}


/**
 * validate the <ProgramInformation> element against the profile for the given request/response type
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} ProgramInformation  the element whose children should be checked
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 * @param {string} parentLanguage	   the xml:lang of the parent element to ProgramInformation
 */
function ValidateProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramInformation, requestType, errs, parentLanguage) {
	if (!ProgramInformation.attr('programId')) 
		NoChildElement(errs, "@progrsmId", "<ProgramInformation>")
	var piLang=GetLanguage(knownLanguages, errs, ProgramInformation, parentLanguage);

	// <ProgramInformation><BasicDescription>
	ValidateBasicDescription(CG_SCHEMA, SCHEMA_PREFIX, ProgramInformation, requestType, errs, piLang, null);

	
	// <ProgramInformation><OtherIdentifier>
	//TODO:

	// <ProgramInformation><MemberOf>
	//TODO:

	// <ProgramInformation><EpisodeOf>
	//TODO:
	
}

/**
 * find and validate any <ProgramInformation> elements in the <ProgramInformationTable>
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} ProgramDescription  the element containing the <ProgramInformationTable>
 * @param {string} progDescrLang       XML language of the ProgramDescription element (or its parent(s))
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 */
function CheckProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, errs) { 
	var pi=0, ProgramInformation;
	var ProgramInformationTable=ProgramDescription.get(SCHEMA_PREFIX+":ProgramInformationTable", CG_SCHEMA);
	
	if (!ProgramInformationTable) {
		errs.push("<ProgramInformationTable> not specified in <"+ProgramDescription.name()+">");
		return;
	}
	var pitLang=GetLanguage(knownLanguages, errs, ProgramInformationTable, progDescrLang);


/*	UURGH: this loop style is not working		
	while (ProgramInformation=ProgramInformationTable.get(SCHEMA_PREFIX+":ProgramInformation["+pi+"]", CG_SCHEMA)) {
		console.log("--ProgramInformation", pi);
		ValidateProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramInformation, requestType, errs, pitLang);
		pi++;
	}
*/
	while (ProgramInformation=ProgramInformationTable.child(pi++)) 
		if (ProgramInformation.name()=="ProgramInformation") 
			ValidateProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramInformation, requestType, errs, pitLang);
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
 */
function ValidateGroupInformation(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, requestType, errs, parentLanguage, categoryGroup, indexes) {
	var isCategoryGroup=GroupInformation==categoryGroup;
	var categoryCRID=(categoryGroup && categoryGroup.attr("groupId")) ? categoryGroup.attr("groupId").value() : "";
	var giLang=GetLanguage(knownLanguages, errs, GroupInformation, parentLanguage);

	if (GroupInformation.attr('groupId')) {
		var groupId=GroupInformation.attr('groupId').value();
		if (requestType==CG_REQUEST_SCHEDULE_NOWNEXT || requestType==CG_REQUEST_SCHEDULE_WINDOW) {
			if (groupId!=dvbi.CRID_NOW && groupId!=dvbi.CRID_LATER && groupId!=dvbi.CRID_EARLIER )
				errs.push("GroupInformation@groupId value \""+groupId+"\" is valid for this request type")
		}
		else {
		if (!isCRIDURI(groupId))
			errs.push("GroupInformation@groupId value \""+groupId+"\" is not a CRID")
		}
	}
	else errs.push("GroupInformation@groupId attribute is mandatory");

	if (requestType==CG_REQUEST_BS_LISTS || requestType==CG_REQUEST_BS_CONTENTS) {
		if (!isCategoryGroup && GroupInformation.attr("ordered")) 
			errs.push("GroupInformation@ordered is only permitted in the \"category group\"");
		if (isCategoryGroup && !GroupInformation.attr("ordered")) 
			errs.push("GroupInformation@ordered is required for this request type")
		if (!isCategoryGroup && GroupInformation.attr("numOfItems")) 
			errs.push("GroupInformation@numOfItems is only permitted in the \"category group\"");
		if (isCategoryGroup && !GroupInformation.attr("numOfItems")) 
			errs.push("GroupInformation@numOfItems is required for this request type")
	}
	if (requestType==CG_REQUEST_SCHEDULE_NOWNEXT || requestType==CG_REQUEST_SCHEDULE_WINDOW) {
		if (GroupInformation.attr("ordered")) {
			if (GroupInformation.attr("ordered").value()!="true")
					errs.push("GroupInformation@ordered must be \"true\" for this response type");
		}
		else errs.push("GroupInformation@ordered is required for this response type");
		if (!GroupInformation.attr("numOfItems")) 
			errs.push("GroupInformation@numOfItems is required for this request type")
	}
	
	// @serviceIDRef is required for Box Set Lists and Box Set Contents
	if (GroupInformation.attr('serviceIDRef') && requestType!=CG_REQUEST_BS_LISTS && requestType!=CG_REQUEST_BS_CONTENTS) 
		errs.push("GroupInformation@serviceIDRef is not permitted for this request type")
	
	var elem=GroupInformation.get(SCHEMA_PREFIX+":GroupType", CG_SCHEMA);
	if (elem) {
		if (!(elem.attr('type') && elem.attr('type').value()=="ProgramGroupTypeType")) 
			errs.push("GroupType@xsi:type=\"ProgramGroupTypeType\" is required");
		if (!(elem.attr('value') && elem.attr('value').value()=="otherCollection")) 
			errs.push("GroupType@value=\"otherCollection\" is required");
	}
	else
		errs.push("<GroupType> is required in <GroupInformation>"); // this should be checked in valdidation against the schema
	
	if (!isCategoryGroup && (requestType!=CG_REQUEST_SCHEDULE_NOWNEXT && requestType!=CG_REQUEST_SCHEDULE_WINDOW)) {
		elem=GroupInformation.get(SCHEMA_PREFIX+":MemberOf", CG_SCHEMA);
		elem=GroupInformation.get(SCHEMA_PREFIX+":MemberOf", CG_SCHEMA);
		if (elem) {
			if (elem.attr("type")) {
				if (elem.attr("type").value()!="MemberOfType")
					errs.push("GroupInformation.MemberOf@type is invalid (\""+elem.attr("type").value()+"\")");
			}
			else
				errs.push("GroupInformation.MemberOf requires @xsi:type=\"MemberOfType\" attribute");
			
			if (elem.attr("index")) {
				var index=valUnsignedInt(elem.attr("index").value());
				if (index>=1) {
					if (indexes) {
						if (isIn(indexes, index)) {
							errs.push("duplicated GroupInformation.MemberOf@index values ("+index+")");
						}
						else indexes.push(index);
					}
				}
				else 
					errs.push("GroupInformation.MemberOfType@index must be an integer >= 1 (parsed "+index+")")
			}
			else
				errs.push("GroupInformation.MemberOfType requires @index attribute");
			
			if (elem.attr("crid")) {
				if (elem.attr("crid").value()!=categoryCRID)
					errs.push("GroupInformation.Memberof@crid ("+elem.attr("crid").value()+") does not match the \"caregory group\" crid ("+categoryCRID+")");
			}
			else
				errs.push("GroupInformation.MemberOfType requires @crid attribute");
 		}
		else
			errs.push("<GroupInformation> requires a <MemberOf> element referring to the \"category group\" ("+categoryCRID+")");
	}
	
	// <GroupInformation><BasicDescription>
	ValidateBasicDescription(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, requestType, errs, giLang, categoryGroup);
}

/**
 * find and validate any <GroupInformation> elements in the <GroupInformationTable>
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} ProgramDescription  the element containing the <ProgramInformationTable>
 * @param {string} progDescrLang       XML language of the ProgramDescription element (or its parent(s))
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 */
function CheckGroupInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, errs) { 
	var gi=0, GroupInformation;
	var GroupInformationTable=ProgramDescription.get(SCHEMA_PREFIX+":GroupInformationTable", CG_SCHEMA);
	
	if (!GroupInformationTable) {
		errs.push("<GroupInformationTable> not specified in <"+ProgramDescription.name()+">");
		return;
	}
	var gitLang=GetLanguage(knownLanguages, errs, GroupInformationTable, progDescrLang);

	// find which GroupInformation element is the "category group"
	var categoryGroup=null;
	if (requestType==CG_REQUEST_BS_LISTS || requestType==CG_REQUEST_BS_CATEGORIES) {
		while (GroupInformation=GroupInformationTable.child(gi++)) {
			var countMemberOf=0;
			// this GroupInformation element is the "category group" if it does not contain a <MemberOf> element
			var e=0, elem;
			while (elem=GroupInformation.child(e++)) {
				if (elem.name()=="MemberOf")
					countMemberOf++
			}
			if (countMemberOf==0) {
				// this GroupInformation element is not a member of another GroupInformation so it must be the "category group"
				if (categoryGroup)
					errs.push("only a single \"category group\" can be present in <"+GroupInformationTable.name()+">")
				else categoryGroup=GroupInformation;
			}
		}
		if (!categoryGroup)
			errs.push("a \"category group\" must be specified in <"+GroupInformationTable.name()+"> for this request type")
	}
	
	var indexes=[], giCount=0;
	gi=0;
	while (GroupInformation=GroupInformationTable.child(gi++)) {
		if (GroupInformation.name()=="GroupInformation") {
			ValidateGroupInformation(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, requestType, errs, gitLang, categoryGroup, indexes);
			if (GroupInformation!=categoryGroup) 
				giCount++;
		}
	}
	if (categoryGroup) {
		var numOfItems=(categoryGroup.attr("numOfItems") ? valUnsignedInt(categoryGroup.attr("numOfItems").value()) : 0);
		if (numOfItems!=giCount)
			errs.push("GroupInformation@numOfItems specified in \"category group\" ("+numOfItems+") does match the number of items ("+giCount+")");		
	}
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
 * @param {array}  cridsFound          list of structural crids already found in this response
 */
function ValidateGroupInformationNowNext(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, requestType, errs, parentLanguage, numEarlier, numNow, numLater, cridsFound) {

	function ValidValues(errs, numOfItems, numAllowed, grp) {
		if (numOfItems<=0)
			errs.push("GroupInformation@numOfItems must be > 0 for \""+grp+"\"");			
		if (numOfItems>numAllowed)
			errs.push("GroupInformation@numOfItems must be <= "+numAllowed+" for \""+grp+"\"");
	}
	
	function notPermittedCRID(grp) {
		return "structural CRID \""+grp+"\" is not permitted in this request type"}

	// NOWNEXT and WINDOW GroupInformationElements contains the sme syntac as other GroupInformationElements
	ValidateGroupInformation(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, requestType, errs, parentLanguage, null, null );
	
	if (GroupInformation.attr('groupId')) {
		var grp=GroupInformation.attr('groupId').value();
		
		if ((grp==dvbi.CRID_EARLIER && numEarlier>0) || (grp==dvbi.CRID_NOW && numNow>0) || (grp==dvbi.CRID_LATER && numLater>0)) {

			var numOfItems=GroupInformation.attr('numOfItems')? valUnsignedInt(GroupInformation.attr('numOfItems').value()): -1;

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

			if (isIn(cridsFound, grp))
				errs.push("only a single "+grp+" structural CRID is premitted in this request");
			else 
				cridsFound.push(grp);

		}
		else 
			errs.push("GroupInformation for \""+grp+"\" is not permitted for this request type");
			
	}
}

/**
 * find and validate any <GroupInformation> elements used for now/next in the <GroupInformationTable>
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} ProgramDescription  the element containing the <ProgramInformationTable>
 * @param {string} progDescrLang       XML language of the ProgramDescription element (or its parent(s))
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 */
function CheckGroupInformationNowNext(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, errs) { 
	
	var GroupInformationTable=ProgramDescription.get(SCHEMA_PREFIX+":GroupInformationTable", CG_SCHEMA);
	
	if (!GroupInformationTable) {
		errs.push("<GroupInformationTable> not specified in <"+ProgramDescription.name()+">");
		return;
	}
	var gitLang=GetLanguage(knownLanguages, errs, GroupInformationTable, progDescrLang);
	
	var gi=0, GroupInformation, cridsFound=[];
	while (GroupInformation=GroupInformationTable.child(gi++)) {
		if (GroupInformation.name()=="GroupInformation") {
			
			switch (requestType) {
				case CG_REQUEST_SCHEDULE_NOWNEXT:
					ValidateGroupInformationNowNext(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, requestType, errs, gitLang, null, 1, 1, cridsFound);
					break;
				case CG_REQUEST_SCHEDULE_WINDOW:
					ValidateGroupInformationNowNext(CG_SCHEMA, SCHEMA_PREFIX, GroupInformation, requestType, errs, gitLang, 10, 1, 10, cridsFound);
					break;
			}
		}
	}
}


/**
 * find and validate any <ProgramLocation> elements in the <ProgramLocationTable>
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} ProgramDescription  the element containing the <ProgramInformationTable>
 * @param {string} progDescrLang       XML language of the ProgramDescription element (or its parent(s))
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class} errs errors found in validaton
 */
function CheckProgramLocation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, errs) { 
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
		errs.push("XML parsing failed: "+err.message);
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
	if (CG.root().name()!=="TVAMain") {
		errs.push("Root element is not <TVAMain>.");
	}
	else {
		var CG_SCHEMA={}, 
			SCHEMA_PREFIX=CG.root().namespace().prefix(), 
			SCHEMA_NAMESPACE=CG.root().namespace().href();
		CG_SCHEMA[SCHEMA_PREFIX]=SCHEMA_NAMESPACE;

		var tvaMainLang=GetLanguage(knownLanguages, errs, CG.root(), DEFAULT_LANGUAGE, true);
		
		var ProgramDescription=CG.get(SCHEMA_PREFIX+":ProgramDescription", CG_SCHEMA);
		if (!ProgramDescription) {
			errs.push("No <ProgramDescription> element specified.");
			return;
		}
		var progDescrLang=GetLanguage(knownLanguages, errs, ProgramDescription, tvaMainLang);

		switch (requestType) {
		case CG_REQUEST_SCHEDULE_TIME:
			// schedule response (6.5.4.1) has <ProgramLocationTable> and <ProgramInformationTable> elements 
			checkAllowedTopElements(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, ["ProgramLocationTable","ProgramInformationTable"], requestType, errs);
			
			CheckProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, errs);
			CheckProgramLocation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, errs);
			break;
		case CG_REQUEST_SCHEDULE_NOWNEXT:
			// schedule response (6.5.4.1) has <ProgramLocationTable> and <ProgramInformationTable> elements 
			checkAllowedTopElements(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, ["ProgramLocationTable","ProgramInformationTable", "GroupInformationTable"], requestType, errs);
			
			CheckGroupInformationNowNext(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, errs);
			CheckProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, errs);
			CheckProgramLocation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, errs);
			break;
		case CG_REQUEST_SCHEDULE_WINDOW:
			checkAllowedTopElements(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, ["ProgramLocationTable","ProgramInformationTable", "GroupInformationTable"], requestType, errs);
			
			CheckGroupInformationNowNext(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, errs);
			CheckProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, errs);
			CheckProgramLocation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, errs);
			break;
		case CG_REQUEST_PROGRAM:
			// program information response (6.6.2) has <ProgramLocationTable> and <ProgramInformationTable> elements
			checkAllowedTopElements(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, ["ProgramLocationTable","ProgramInformationTable"], requestType, errs);
			
			CheckProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, errs);
			break;
		case CG_REQUEST_EPISODES:
			// more episodes response (6/7/3) has <ProgramInformationTable>, <GroupInformationTable> and <ProgramLocationTable> elements 
			checkAllowedTopElements(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, ["ProgramInformationTable","GroupInformationTable"], requestType, errs);

			CheckProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, errs);
			CheckGroupInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, errs);
			break;
		case CG_REQUEST_BS_CATEGORIES:
			// box set categories response (6.8.2.3) has <GroupInformationTable> element
			checkAllowedTopElements(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, ["GroupInformationTable"], requestType, errs);

			CheckGroupInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, errs);
			break;
		case CG_REQUEST_BS_LISTS:
			// box set lists response (6.8.3.3) has <GroupInformationTable> element
			checkAllowedTopElements(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, ["GroupInformationTable"], requestType, errs);

			CheckGroupInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, errs);
			break;
		case CG_REQUEST_BS_CONTENTS:
			// box set contents response (6.8.4.3) has <ProgramInformationTable>, <GroupInformationTable> and <ProgramLocationTable> elements 
			checkAllowedTopElements(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, ["ProgramInformationTable","GroupInformationTable","ProgramLocationTable"], requestType, errs);
			
			CheckProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, errs);
			CheckGroupInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, errs);
			CheckProgramLocation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, errs);
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
function processQuery(req,res) {
    if (isEmpty(req.query)) {
        drawForm(true, res);    
    } else if (!checkQuery(req)) {
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
            errs.push("retrieval of URL ("+req.query.CGurl+") failed");
        }
		if (CGxml) {
			validateContentGuide(CGxml.getBody().toString().replace(/(\r\n|\n|\r|\t)/gm,""), req.query.requestType, errs);
		}

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
            errs.push("retrieval of FILE ("+fname+") failed");
        }
		if (CGxml) {
			validateContentGuide(CGxml.toString().replace(/(\r\n|\n|\r|\t)/gm,""), req.body.requestType, errs);
		}
		
        drawForm(false, res, fname, req.body.requestType, {errors:errs});
    }
    res.end();
}


var knownCountries=new ISOcountries(false, true);
var knownLanguanges=new IANAlanguages();

function loadDataFiles(useURLs) {
	console.log("loading classification schemes...");
    allowedGenres=[];
	loadCS(allowedGenres, useURLs, TVA_ContentCSFilename, TVA_ContentCSURL);
	loadCS(allowedGenres, useURLs, TVA_FormatCSFilename, TVA_FormatCSURL);
	loadCS(allowedGenres, useURLs, DVBI_ContentSubjectFilename, DVBI_ContentSubjectURL);

	console.log("loading countries...");
	knownCountries.loadCountriesFromFile(ISO3166_Filename, true);
  
    console.log("loading languages...");
	knownLanguanges.loadLanguagesFromFile(IANA_Subtag_Registry_Filename, true);
	
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