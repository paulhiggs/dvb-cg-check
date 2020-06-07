// node.js - https://nodejs.org/en/
// express framework - https://expressjs.com/en/4x/api.html
const express = require("express");
var app = express();

/* TODO:

 - also look for TODO in the code itself
*/



// libxmljs - https://github.com/libxmljs/libxmljs
const libxml = require("libxmljs");

//TODO: validation against schema
//const xmllint = require("xmllint");

// morgan - https://github.com/expressjs/morgan
const morgan = require("morgan")

const fs=require("fs"), path=require("path");

//const request = require("request");

// sync-request - https://github.com/ForbesLindesay/sync-request
const syncRequest = require("sync-request");
//var XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;

const https=require("https");
const HTTP_SERVICE_PORT = 3020;
const HTTPS_SERVICE_PORT=HTTP_SERVICE_PORT+1;
const keyFilename=path.join(".","selfsigned.key"), certFilename=path.join(".","selfsigned.crt");

const { parse } = require("querystring");

// https://github.com/alexei/sprintf.js
var sprintf = require("sprintf-js").sprintf,
    vsprintf = require("sprintf-js").vsprintf

// constraints from the DVB-I specification
const MAX_TITLE_LENGTH=80,
      MAX_KEYWORD_LENGTH=32;
const MAX_ORGANIZATION_NAME_LENGTH=32;
const MAX_NAME_PART_LENGTH=32;
const MAX_EXPLANATORY_TEXT_LENGTH=160;

const SYNOPSIS_SHORT_LENGTH = 90,
      SYNOPSIS_MEDIUM_LENGTH = 250, 
      SYNOPSIS_LONG_LENGTH = 1200; 
const SYNOPSIS_SHORT_LABEL = "short",
      SYNOPSIS_MEDIUM_LABEL = "medium", 
      SYNOPSIS_LONG_LABEL = "long"; 


// convenience/readability values
const DEFAULT_LANGUAGE="***";

const CG_REQUEST_SCHEDULE="schedInfo";
const CG_REQUEST_PROGRAM="progInfo";
const CG_REQUEST_EPISODES="moreEpisodes";
const CG_REQUEST_BS_CATEGORIES="bsCategories";
const CG_REQUEST_BS_LISTS="bsLists";
const CG_REQUEST_BS_CONTENTS="bsContents";

const dirCS = "cs",
      TVA_ContentCSFilename=path.join(dirCS,"ContentCS.xml"),
      TVA_FormatCSFilename=path.join(dirCS,"FormatCS.xml"),
      DVBI_ContentSubjectFilename=path.join(dirCS,"DVBContentSubjectCS-2019.xml"),
	  DVBI_CreditsItemRolesFilename=path.join(".","CreditsItem@role-values.txt");

const REPO_RAW = "https://raw.githubusercontent.com/paulhiggs/dvb-cg-check/master/",
      TVA_ContentCSURL=REPO_RAW + "cs/" + "ContentCS.xml",
      TVA_FormatCSURL=REPO_RAW + "cs/" + "FormatCS.xml",
      DVBI_ContentSubjectURL=REPO_RAW + "cs/" + "DVBContentSubjectCS-2019.xml",
	  DVBI_CreditsItemRolesURL=REPO_RAW+"CreditsItem@role-values.txt";

var allowedGenres=[], allowedCreditItemRoles=[];

class ErrorList {
/**
 * Manages errors and warnings for the application
 * 
 */
    counts=[]; messages=[]; countsWarn=[]; messagesWarn=[];
    
    increment(key) {
        if (this.counts[key]===undefined)
            this.set(key,1);
        else this.counts[key]++;
    }
    set(key,value) {
        this.counts[key]=value;
    }
    incrementW(key) {
        if (this.countsWarn[key]===undefined)
            this.setW(key,1);
        else this.countsWarn[key]++;
    }
    setW(key,value) {
        this.countsWarn[key]=value;
    }
    push(message) {
        this.messages.push(message);
    }
    pushW(message) {
        this.messagesWarn.push(message);
    }
}


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
    if (typeof(values) == "string")
        return values==value;
    
    if (typeof(values) == "object") {
        for (var x=0; x<values.length; x++) 
            if (values[x] == value)
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

//---------------- CLASSIFICATION SCHEME LOADING ---------------- 
/**
 * Constructs a linear list of terms from a heirarical clssification schemes which are read from an XML document and parsed by libxmljs
 *
 * @param {Array} values The array to push classification scheme values into
 * @param {String} CSuri The classification scheme domian
 * @param {Object} term The classification scheme term that may include nested subterms
 */
function addCSTerm(values,CSuri,term){
    if (term.name()==="Term") {
        values.push(CSuri+":"+term.attr("termID").value())
        var st=0, subTerm;
        while (subTerm=term.child(st)) {
            addCSTerm(values,CSuri,subTerm);
            st++;
        }
    }
}

/**
 * load the hierarical values from an XML classification scheme document into a linear list 
 *
 * @param {Array} values The linear list of values within the classification scheme
 * @param {String} xmlCS the XML document  of the classification scheme
 */
function loadClassificationScheme(values, xmlCS) {
	if (!xmlCS) return;
	var CSnamespace = xmlCS.root().attr("uri");
	if (!CSnamespace) return;
	var t=0, term;
	while (term=xmlCS.root().child(t)) {
		addCSTerm(values,CSnamespace.value(),term);
		t++;
	}
}

/**
 * read a classification scheme from a local file and load its hierarical values into a linear list 
 *
 * @param {Array} values The linear list of values within the classification scheme
 * @param {String} classificationScheme the filename of the classification scheme
 */
function loadCSfromFile(values, classificationScheme) {
	console.log("reading CS from", classificationScheme);
    fs.readFile(classificationScheme, {encoding: "utf-8"}, function(err,data){
        if (!err) {
			loadClassificationScheme(values, libxml.parseXmlString(data.replace(/(\r\n|\n|\r|\t)/gm,"")));
        } else {
            console.log(err);
        }
    });
}

/**
 * read a classification scheme from a URL and load its hierarical values into a linear list 
 *
 * @param {Array} values The linear list of values within the classification scheme
 * @param {String} csURL URL to the classification scheme
 */
function loadCSfromURL(values, csURL) { 
	console.log("retrieving CS from", csURL);
	var xhttp = new XmlHttpRequest();
	xhttp.onreadystatechange = function() {
		if (this.readyState == 4) {
			if (this.status == 200) {
				loadClassificationScheme(values, libxml.parseXmlString(xhttp.responseText));
			}
			else console.log("error ("+this.status+") retrieving "+csURL);	
		}
	};
	xhttp.open("GET", csURL, true);
	xhttp.send();
} 
 
/**
 * loads classification scheme values from either a local file or an URL based location
 *
 * @param {Array} values The linear list of values within the classification scheme
 * @param {boolean} useURL if true use the URL loading method else use the local file
 * @param {String} CSfilename the filename of the classification scheme
 * @param {String} CSurl URL to the classification scheme
 * 
 */ 
function loadCS(values, useURL, CSfilename, CSurl) {
	if (useURL)
		loadCSfromURL(values,CSurl);
	else loadCSfromFile(values, CSfilename);	
} 
//--------------------------------------------------------------- 
 
//---------------- CreditsItem@role LOADING ----------------

if(typeof(String.prototype.trim) === "undefined")
{
    String.prototype.trim = function() 
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
	var lines = data.split('\n');
	for (var line=0; line<lines.length; line++) {
		values.push(lines[line].trim());
	}	
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
        if (!err) {
			addRoles(values, data);
        } else {
            console.log(err);
        }
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
	var xhttp = new XmlHttpRequest();
	xhttp.onreadystatechange = function() {
		if (this.readyState == 4) {
			if (this.status == 200) {
				addRoles(values, xhttp.responseText);
			}
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



const FORM_TOP="<html><head><title>DVB-I Content Guide Validator</title></head><body>";

const PAGE_HEADING="<h1>DVB-I Content Guide Validator</h1>";
const ENTRY_FORM_URL="<form method=\"post\"><p><i>URL:</i></p><input type=\"url\" name=\"CGurl\" value=\"%s\"><input type=\"submit\" value=\"submit\"></form>";

const ENTRY_FORM_FILE="<form method=\"post\" encType=\"multipart/form-data\"><p><i>FILE:</i></p><input type=\"file\" name=\"CGfile\" value=\"%s\"><input type=\"submit\" value=\"submit\">";

const ENTRY_FORM_REQUEST_TYPE_HEADER="<p><i>REQUEST TYPE:</i></p>";

const ENTRY_FORM_REQUEST_TYPE_ID="requestType";
const ENTRY_FORM_REQUEST_TYPES = [{"value":CG_REQUEST_SCHEDULE,"label":"Schedule Info"},
	                              {"value":CG_REQUEST_PROGRAM,"label":"Program Info"},
	                              {"value":CG_REQUEST_EPISODES,"label":"More Episodes"},
	                              {"value":CG_REQUEST_BS_CATEGORIES,"label":"Box Set Categories"},
	                              {"value":CG_REQUEST_BS_LISTS,"label":"Box Set Lists"},
	                              {"value":CG_REQUEST_BS_CONTENTS,"label":"Box Set Contents"}];
const FORM_END="</form>";
								  
const RESULT_WITH_INSTRUCTION="<br><p><i>Results:</i></p>";
const SUMMARY_FORM_HEADER = "<table><tr><th>item</th><th>count</th></tr>";
const FORM_BOTTOM="</body></html>";

/**
 * constructs HTML output of the errors found in the content guide analysis
 *
 * @param {boolean} URLmode if true ask for a URL to a content guide, if false ask for a file
 * @param {Object} res the Express result 
 * @param {string} lastURL the url of the content guide - used to keep the form intact
 * @param {Object} o the errors and warnings found during the content guide validation
 */
function drawForm(URLmode, res, lastInput, lastType, o) {
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
                if (o.errors.counts[i] != 0) {
                    if (!tableHeader) {
                        res.write(SUMMARY_FORM_HEADER);
                        tableHeader=true;
                    }
                    res.write("<tr><td>"+HTMLize(i)+"</td><td>"+o.errors.counts[i]+"</td></tr>");
                    resultsShown=true;
                }
            }
            for (var i in o.errors.countsWarn) {
                if (o.errors.countsWarn[i] != 0) {
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
 * Add an error message when the @href is not specified for an element
 *
 * @param {Object} errs Errors buffer
 * @param {String} src The element missing the @href
 * @param {String} loc The location of the element
 */
function NoHrefAttribute(errs, src, loc) {
	errs.push("no @href specified for "+src+" in "+loc);
	errs.increment("no href");
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
    while (elem=node.get(SCHEMA_PREFIX+":RelatedMaterial["+i+"]", CG_SCHEMA)) {
        var hr=elem.get(SCHEMA_PREFIX+":HowRelated", CG_SCHEMA);
		if (hr && validServiceApplication(hr)) 
			return true;			
        i++;
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
		if (!parentElement.get(SCHEMA_PREFIX+":"+elem, CG_SCHEMA)) {
			errs.push("Element <"+elem+"> not specified in <"+parentElement.name()+">");
		} 
	});
	
	// check that no additional child elements existance
	var child, c=0;
	while (child = parentElement.child(c)) {
		if (!isIn(childElements, child.name())) {
			if (child.name() != 'text')
				errs.push("Element <"+child.name()+"> not permitted");
		}
		c++;
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
	var c=0, Child;
	while (Child=parentElement.child(c)) {
		if (Child.name() == childElement)
			return true;
		c++;
	}
	return false;
}

/**
 * validate the <Synopsis> elements 
 *
 * @param {string} CG_SCHEMA           Used when constructing Xpath queries
 * @param {string} SCHEMA_PREFIX       Used when constructing Xpath queries
 * @param {Object} BasicDescription    the element whose children should be checked
 * @param {array}  allowedLengths	   @length attributes permitted
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class}  errs                errors found in validaton
 * @param {string} parentLanguage	   the xml:lang of the parent element to ProgramInformation
 */
function ValidateSynopsis(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, allowedLengths, requestType, errs, parentLanguage) {
	var s=0, Synopsis, hasShort=false, hasMedium=false, hasLong=false;
	
	while (Synopsis=BasicDescription.child(s)) {
		if (Synopsis.name()=="Synopsis") {
			if (Synopsis.attr('length')) {
				var len = Synopsis.attr('length').value();
				if (isIn(allowedLengths, len)) {
					switch (len) {
					case SYNOPSIS_SHORT_LABEL:
						if ((unEntity(Synopsis.text()).length) > SYNOPSIS_SHORT_LENGTH)
							errs.push("length of <Synopsis length=\""+SYNOPSIS_SHORT_LABEL+"\"> exceeds "+SYNOPSIS_SHORT_LENGTH+" characters");
						if (hasShort)
							errs.push("only a single instance of <Synopsis length=\""+SYNOPSIS_SHORT_LABEL+"\"> is permitted");
						hasShort=true;
						break;
					case SYNOPSIS_MEDIUM_LABEL:
						if ((unEntity(Synopsis.text()).length) > SYNOPSIS_MEDIUM_LENGTH)
							errs.push("length of <Synopsis length=\""+SYNOPSIS_MEDIUM_LABEL+"\"> exceeds "+SYNOPSIS_MEDIUM_LENGTH+" characters");
						if (hasMedium)
							errs.push("only a single instance of <Synopsis length=\""+SYNOPSIS_MEDIUM_LABEL+"\"> is permitted");
						hasMedium=true;
						break;
					case SYNOPSIS_LONG_LABEL:
						if ((unEntity(Synopsis.text()).length) > SYNOPSIS_LONG_LENGTH)
							errs.push("length of <Synopsis length=\""+SYNOPSIS_LONG_LABEL+"\"> exceeds "+SYNOPSIS_LONG_LENGTH+" characters");
						if (hasLong)
							errs.push("only a single instance of <Synopsis length=\""+SYNOPSIS_LONG_LABEL+"\"> is permitted");
						hasLong=true;
						break;						
					}
				}
				else
					errs.push("@length=\""+len+"\" is not permitted for this request type");
			}
			else 
				errs.push("@length attribute is required for <Synopsis>");
		}
		s++;
	}
	
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
 */
function ValidateKeyword(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, minKeywords, maxKeywords, errs) {
	var k=0, Keyword, count=0;
	while (Keyword=BasicDescription.child(k)) {
		if (Keyword.name()=="Keyword") {
			count++;
			var keywordType = Keyword.attr('type') ? Keyword.attr('type').value() : "main";
			if (keywordType != "main" && keywordType != "other")
				errs.push("@type=\""+keywordType+"\" not permitted for <Keyword>");
			if (unEntity(Keyword.text()).length > MAX_KEYWORD_LENGTH)
				errs.push("<Keyword> length is greater than "+MAX_KEYWORD_LENGTH);
		}
		k++;
	}
	if (count > maxKeywords)
		errs.push("More than "+maxKeywords+" <Keyword> element"+(maxKeywords>1?"s":"")+" specified");
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
	while (Genre=BasicDescription.child(g)) {
		if (Genre.name()=="Genre") {
			count++;
			var genreType = Genre.attr('type') ? Genre.attr('type').value() : "main";
			if (genreType != "main")
				errs.push("@type=\""+genreType+"\" not permitted for <Genre>");
			
			var genreValue = Genre.attr('href') ? Genre.attr('href').value() : "";
			if (!isIn(allowedGenres, genreValue))
				errs.push("invalid value \""+genreValue+"\" for <Genre>");
		}
		g++;
	}
	if (count > maxGenres)
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
	
	while (ParentalGuidance=BasicDescription.child(pg)) {
		if (ParentalGuidance.name()=="ParentalGuidance") {
			countParentalGuidance++;
			
			var pgc=0, pgChild, countExplanatoryText=0;
			while (pgChild=ParentalGuidance.child(pgc)) {
				
				if (pgChild.name()!="text") {
					
					if (pgChild.name()=="MinimumAge" || pgChild.name()=="ParentalRating") {
						if (countParentalGuidance==1 && pgChild.name()!="MinimumAge")
							errs.push("first <ParentalGuidance> element must contain <mpeg7:MinimumAge>");
						
						if (pgChild.name()=="MinimumAge" && countParentalGuidance != 1)
							errs.push("<MinimumAge> must be in the first <ParentalGuidance> element");
						
						if (pgChild.name()=="ParentalRating") {
							if (!pgChild.attr('href'))
								errs.push("@href not specified in <ParentalRating>");
						}
					}
					if (pgChild.name()=="ExplanatoryText") {
						countExplanatoryText++;
						if (pgChild.attr("length")) {
							if (pgChild.attr("length").value()!="long")
								errs.push("@length=\""+pgChild.attr("length").value()+"\" is not allowed for <ExplanatoryText>")
						}
						else 
							errs.push("@length=\"long\" is required for <ExplanatoryText>");
						
						if (unEntity(pgChild.text()).length > MAX_EXPLANATORY_TEXT_LENGTH)
							errs.push("length of <ExplanatoryText> cannot exceed "+MAX_EXPLANATORY_TEXT_LENGTH+"");
					}
				}
				pgc++;
			}
			if (countExplanatoryText > 1)
				errs.push("only a single <ExplanatoryText> element is premitted in <ParentalGuidance>")
		}
		pg++;
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
		if (unEntity(elem.text()).length > MAX_NAME_PART_LENGTH)	
			errs.push("<"+elem.name()+"> in <"+parentElem.name()+"> is longer than "+MAX_NAME_PART_LENGTH+" characters");
	}
	var se=0, subElem;
	var familyNameCount=0, givenNameCount=0, otherElemCount=0;
	while (subElem=elem.child(se)) {
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
		se++;
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
		while (CreditsItem=CreditsList.child(ci)) {
			if (CreditsItem.name()=="CreditsItem") {
				if (CreditsItem.attr('role')) {
					var CreditsItemRole = CreditsItem.attr('role').value();
					if (!isIn(allowedCreditItemRoles, CreditsItemRole))
						errs.push("\""+CreditsItemRole+"\" is not valid for CreditsItem@role");
				}
				else 
					errs.push("CreditsItem@role not specified")
				var foundPersonName=0, foundCharacter=0, foundOrganizationName=0;
				var s=0, elem;
				while (elem=CreditsItem.child(s)) {
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
							if (unEntity(elem.text()).length > MAX_ORGANIZATION_NAME_LENGTH)
								errs.push("length of <OrganizationName> in <CreditsItem> exceeds "+MAX_ORGANIZATION_NAME_LENGTH+" characters")
							break;
						default:
							if (elem.name() != "text")
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
					s++;
				}			
				if (foundPersonName>1)
					errs.push("only a single <PersonName> is permitted in <CreditsItem>")
				if (foundCharacter>1)
					errs.push("only a single <Character> is permitted in <CreditsItem>")
				if (foundOrganizationName>1)
					errs.push("only a single <Organization> is permitted in <CreditsItem>")
			}
			ci++;
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
	var rm=0, RelatedMaterial, countRelatedMaterial++;
	while (RelatedMaterial=BasicDescription.child(rm)) {
		if (RelatedMaterial.name()=="RelatedMaterial") {
			countRelatedMaterial++;
			
			// no additional checks are needed - DVB-I client should be robust to any siganlled RelatedMaterial
		}
		
		rm++;
	}
	if (countRelatedMaterial > maxRMelements)
		errs.push("a maximum of "+maxRMelements+" <RelatedMaterial> are permitted")
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
	const ELEMENT_NAME="<ProgramInformation>";
	if (!ProgramInformation.attr('programId')) {
		errs.push("@programId not specified for "+ELEMENT_NAME);
	}
	var piLang=ProgramInformation.attr('lang') ? ProgramInformation.attr('lang').value() : parentLanguage;
	var BasicDescription=ProgramInformation.get(SCHEMA_PREFIX+":BasicDescription", CG_SCHEMA);
	if (!BasicDescription) {
		errs.push("<BasicDescription> not specified for "+ELEMENT_NAME)
	}
	else {
		var bdLang=BasicDescription.attr('lang') ? BasicDescription.attr('lang').value() : piLang;
		
		// <Title> - only 1..2 elements per language permitted with "main" and optional "secondary" 
		//           requirements are the same for Schedule, Program and Box Set Contents response
		var mainSet=[], secondarySet=[];
		var t=0, Title;
		while (Title=BasicDescription.child(t)) {
			if (Title.name()=="Title") {
				var TitleType=Title.attr('type') ? Title.attr('type').value() : "main"; // MPEG7 default type is "main"
				var TitleLang=Title.attr('lang') ? Title.attr('lang').value() : bdLang; // use parent elements language if not specified
				var titleStr=unEntity(Title.text());
				
				if (titleStr.length > MAX_TITLE_LENGTH)
					errs.push("<Title> length exceeds "+MAX_TITLE_LENGTH+" characters")
				if (TitleType=="main") {
					if (isIn(mainSet, TitleLang))
						errs.push("only a single language is permitted for @type=\"main\"")
					else mainSet.push(TitleLang);
				}
				else if (TitleType="secondary") {
					if (isIn(secondarySet, TitleLang))
						errs.push("only a single language is permitted for @type=\"secondary\"")
					else secondarySet.push(TitleLang);
				}
				else
					errs.push("type=\""+TitleType+"\" is not permitted for <Title>");
				
				secondarySet.forEach(lang => {
					if (!isIn(mainSet, lang)) {
						var t = lang != DEFAULT_LANGUAGE ? " for @xml:lang=\""+lang+"\"" : "";
						errs.push("@type=\"secondary\" specified without @type=\"main\"" + t);
					}
				})
				
			}
			t++;
		}

		// <Synopsis> - validity depends on use
		switch (requestType) {
		case CG_REQUEST_SCHEDULE:
			// clause 6.10.5.2 -- 1..2 instances permitted - one each of @length="short"(90) and "medium"(250)
			ValidateSynopsis(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [SYNOPSIS_SHORT_LABEL,SYNOPSIS_MEDIUM_LABEL], requestType, errs, bdLang);
			break;
		case CG_REQUEST_PROGRAM:
			// clause 6.10.5.3 -- 1..3 instances permitted - one each of @length="short"(90), "medium"(250) and "long"(1200)
			ValidateSynopsis(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [SYNOPSIS_SHORT_LABEL,SYNOPSIS_MEDIUM_LABEL,SYNOPSIS_LONG_LABEL], requestType, errs, bdLang);
			break;
		case CG_REQUEST_BS_CONTENTS:
			// clause 6.10.5.4 -- only 1 instance permitted - @length="medium"(250)
			ValidateSynopsis(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, [SYNOPSIS_MEDIUM_LABEL], requestType, errs, bdLang);
			break;
		default:
			// make sure <Synopsis> elements are not in the Basic Description
			if (ElementFound(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, "Synopsis")) {
				errs.push("<Synopsis> not permitted in <BasicDescription> for this request type");
			}
		}

		// <Keyword> - 
		switch (requestType) {
		case CG_REQUEST_PROGRAM:
			// clause 6.10.5.3 -- 0..20 instances permitted 
			ValidateKeyword(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, 0, 20, errs);
			break;
		default:
			// make sure <Keyword> elements are not in the Basic Description
			if (ElementFound(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, "Keyword")) {
				errs.push("<Keyword> not permitted in <BasicDescription> for this request type");
			}
		}

		// <Genre> - 
		switch (requestType) {
		case CG_REQUEST_SCHEDULE:
			// clause 6.10.5.2 -- 0..1 instances permitted 
		case CG_REQUEST_PROGRAM:
			// clause 6.10.5.3 -- 0..1 instances permitted 
			ValidateGenre(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, 0, 1, errs);
			break;
		default:
			// make sure <Genre> elements are not in the Basic Description
			if (ElementFound(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, "Genre")) {
				errs.push("<Genre> not permitted in <BasicDescription> for this request type");
			}
		}

		// <ParentalGuidance> - 
		switch (requestType) {
		case CG_REQUEST_SCHEDULE:
			// clause 6.10.5.2 -- 0..2 instances permitted - first must contain age 
		case CG_REQUEST_PROGRAM:
			// clause 6.10.5.3 -- 0..2 instances permitted - first must contain age 
		case CG_REQUEST_BS_CONTENTS:
			// clause 6.10.5.4 -- 0..2 instances permitted - first must contain age
			ValidateParentalGuidance(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, 0, 2, errs);
			break;
		default:
			// make sure <ParentalGuidance> elements are not in the Basic Description
			if (ElementFound(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, "ParentalGuidance")) {
				errs.push("<ParentalGuidance> not permitted in <BasicDescription> for this request type");
			}
		}
		
		// <CreditsList> - 
		switch (requestType) {
		case CG_REQUEST_PROGRAM:
			// clause 6.10.5.3 -- 
			ValidateCreditsList(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription,  errs);
			break;
		default:
			// make sure <CreditsList> elements are not in the Basic Description
			if (ElementFound(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, "CreditsList")) {
				errs.push("<CreditsList> not permitted in <BasicDescription> for this request type");
			}
		}
		
		// <RelatedMaterial> - 
		switch (requestType) {
		case CG_REQUEST_SCHEDULE:
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
		default:
			// make sure <RelatedMaterial> elements are not in the Basic Description
			if (ElementFound(CG_SCHEMA, SCHEMA_PREFIX, BasicDescription, "RelatedMaterial")) {
				errs.push("<RelatedMaterial> not permitted in <BasicDescription> for this request type");
			}
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
 * @param {string} requestType         the type of content guide request being checked
 * @param {Class} errs errors found in validaton
 */
function CheckProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, errs) { 
	var pi=0, ProgramInformation;
	var ProgramInformationTable=ProgramDescription.get(SCHEMA_PREFIX+":ProgramInformationTable", CG_SCHEMA);
	
	if (!ProgramInformationTable) {
		errs.push("<ProgramInformationTable> not specified in <"+ProgramDescription.name()+">");
		return;
	}
	var progInfTabLang=ProgramInformationTable.attr("lang") ? ProgramInformationTable.attr("lang").value() : progDescrLang;
/*	UURGH: this loop style is not working		
	while (ProgramInformation = ProgramInformationTable.get(SCHEMA_PREFIX+":ProgramInformation["+pi+"]", CG_SCHEMA)) {
		console.log("--ProgramInformation", pi);
		ValidateProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramInformation, requestType, errs, progInfTabLang);
		pi++;
	}
*/
	while (ProgramInformation=ProgramInformationTable.child(pi)) {
		if (ProgramInformation.name()=="ProgramInformation") {
			ValidateProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramInformation, requestType, errs, progInfTabLang);
		}
		pi++;
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
		CG = libxml.parseXmlString(CGtext);
	} catch (err) {
		errs.push("XML parsing failed: "+err.message);
		errs.increment("malformed XML");
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
	if (CG.root().name() !== "TVAMain") {
		errs.push("Root element is not <TVAMain>.");
	}
	else {
		var CG_SCHEMA = {}, 
			SCHEMA_PREFIX=CG.root().namespace().prefix(), 
			SCHEMA_NAMESPACE=CG.root().namespace().href();
		CG_SCHEMA[SCHEMA_PREFIX]=SCHEMA_NAMESPACE;

		var tvaMainLang=CG.root().attr("lang") ? CG.root().attr("lang").value() : DEFAULT_LANGUAGE;
		
		var ProgramDescription=CG.get(SCHEMA_PREFIX+":ProgramDescription", CG_SCHEMA);
		if (!ProgramDescription) {
			errs.push("No <ProgramDescription> element specified.");
			return;
		}
		var progDescrLang=ProgramDescription.attr("lang") ? ProgramDescription.attr("lang").value() : tvaMainLang;

		switch (requestType) {
		case CG_REQUEST_SCHEDULE:
			// schedule response (6.5.4.1) has <ProgramLocationTable> and <ProgramInformationTable> elements 
			checkAllowedTopElements(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, ["ProgramLocationTable","ProgramInformationTable"], requestType, errs);
			
			CheckProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, errs);
			break;
		case CG_REQUEST_PROGRAM:
			// program information response (6.6.2) has <ProgramLocationTable> and <ProgramInformationTable> elements
			checkAllowedTopElements(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, ["ProgramLocationTable","ProgramInformationTable"], requestType, errs);
			
			CheckProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, errs);
			break;
		case CG_REQUEST_EPISODES:
			// more episodes response (6/7/3) has <ProgramInformationTable>, <GroupInformationTable> and <ProgramLocationTable> elements 
			checkAllowedTopElements(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, ["ProgramInformationTable","GroupInformationTable"], requestType, errs);
			break;
		case CG_REQUEST_BS_CATEGORIES:
			// box set categories response (6.8.2.3) has <GroupInformationTable> element
			checkAllowedTopElements(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, ["GroupInformationTable"], requestType, errs);
			break;
		case CG_REQUEST_BS_LISTS:
			// box set lists response (6.8.3.3) has <GroupInformationTable> element
			checkAllowedTopElements(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, ["GroupInformationTable"], requestType, errs);
			break;
		case CG_REQUEST_BS_CONTENTS:
			// box set contents response (6.8.4.3) has <ProgramInformationTable>, <GroupInformationTable> and <ProgramLocationTable> elements 
			checkAllowedTopElements(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, ["ProgramInformationTable","GroupInformationTable","ProgramLocationTable"], requestType, errs);
			
			CheckProgramInformation(CG_SCHEMA, SCHEMA_PREFIX, ProgramDescription, progDescrLang, requestType, errs);
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
            CGxml = syncRequest("GET", req.query.CGurl);
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


const fileUpload = require('express-fileupload');
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
            CGxml = req.files.CGfile.data;
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




function loadDataFiles(useURLs) {
	console.log("loading classification schemes...");
    allowedGenres=[];
	loadCS(allowedGenres, useURLs, TVA_ContentCSFilename, TVA_ContentCSURL);
	loadCS(allowedGenres, useURLs, TVA_FormatCSFilename, TVA_FormatCSURL);
	loadCS(allowedGenres, useURLs, DVBI_ContentSubjectFilename, DVBI_ContentSubjectURL);
  
	console.log("loading CreditItem roles...");
	allowedCreditItemRoles=[];
	loadRoles(allowedCreditItemRoles, useURLs, DVBI_CreditsItemRolesFilename, DVBI_CreditsItemRolesURL);
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

var http_server = app.listen(HTTP_SERVICE_PORT, function() {
    console.log("HTTP listening on port number", http_server.address().port);
});


// start the HTTPS server
// sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout ./selfsigned.key -out selfsigned.crt

function readmyfile(filename) {
    try {
        var stats=fs.statSync(filename);
        if (stats.isFile()) return fs.readFileSync(filename); 
    }
    catch (err) {console.log(err);}
    return null;
}

var https_options = {
    key:readmyfile(keyFilename),
    cert:readmyfile(certFilename)
};

if (https_options.key && https_options.cert) {
    var https_server = https.createServer(https_options, app);
    https_server.listen(HTTPS_SERVICE_PORT, function(){
        console.log("HTTPS listening on port number", https_server.address().port);
    });
}