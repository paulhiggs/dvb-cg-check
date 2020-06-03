# dvb-gc-check
DVB-I Content Guide validator

## Description
Validates the value space of the instance document, validation against the schema should be performed seperately (for now)


Checks performed:

  
## Use
### URL based validation  
&lt;server&gt;/check gives a basic/primitive UI. Enter the URL for a content guide query and press "Submit" button. Await results!
### File based validation
&lt;server&gt;/checkFile gives a basic/primitive UI. Select the file containing a DVB-I content guide metadata fragment and press "Submit" button. Await results!

## Installation
1. Clone this repository `git clone https://github.com/paulhiggs/dvb-gc-check.git`
1. Install necessary libraries (express, libxmljs, morgan)  `npm install`
1. run it - `node app`

If you want to start an HTTPS server, make sure you have `selfsigned.crt` and `selfsigned.key` files in the same directory. These can be generated (on Linux) with `sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout ./selfsigned.key -out selfsigned.crt`

