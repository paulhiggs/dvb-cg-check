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
1. Clone this repository `git clone https://github.com/paulhiggs/dvb-cg-check.git --recurse-submodules`
1. Install necessary libraries (express, libxmljs, morgan)  `npm install`
1. run it - `node app`

If you want to start an HTTPS server, make sure you have `selfsigned.crt` and `selfsigned.key` files in the same directory. These can be generated (on Linux) with `sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout ./selfsigned.key -out selfsigned.crt`

