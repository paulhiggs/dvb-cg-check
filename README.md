# dvb-cg-check
DVB-I Content Guide validator

## Description
Validates the value space of the instance document, validation against the schema should be performed seperately (for now)

Checks performed:
* ensure only the permitted elements are present in &lt;ProgramDescription&gt;
* &lt;BasicDescription&gt; sub-elements (&lt;Title&gt;, &lt;Synopsis&gt;, &lt;Keyword&gt;, &lt;Genre&gt;, &lt;CreditsList&gt;, &lt;ParentalGuidance&gt;, &lt;RelatedMaterial&gt;) in &lt;ProgramInformation&gt;
  
## Use
### URL based validation  
&lt;server&gt;/check gives a basic/primitive UI. Enter the URL for a content guide query and the type of query/response from the endpoint. Press "Submit" button and await results!
### File based validation
&lt;server&gt;/checkFile gives a basic/primitive UI. Select the file containing a DVB-I content guide metadata fragment and the type of response from the endpoint. Press "Submit" button and await results!

## Installation
1. Clone this repository `git clone --recurse-submodules https://github.com/paulhiggs/dvb-cg-check.git`
1. Install necessary libraries (express, libxmljs, morgan)  `npm install`
1. run it - `node app`

If you want to start an HTTPS server, make sure you have `selfsigned.crt` and `selfsigned.key` files in the same directory. These can be generated (on Linux) with `sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout ./selfsigned.key -out selfsigned.crt`

### Command Line Arguments
* --urls [-u] forces the classification scheme, country and language values to be read from the internet. Default is to load values from local files.
* --port [-p] set the HTTP listening port (default: 3020)
* --sport [-s] set the HTTPS listening port (default: 3021)
