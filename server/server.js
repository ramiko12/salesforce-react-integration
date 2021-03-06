// Load .env configuration file
require('dotenv').config();

// 3rd party dependencies
const httpClient = require("request"),
  path = require('path'),
  express = require('express'),
  session = require('express-session'),
  SalesforceClient = require('salesforce-node-client');

// Instantiate Salesforce client with .env configuration
const sfdc = new SalesforceClient();

// Setup HTTP server
const app = express();
const port = process.env.PORT || 8080;
app.set('port', port);

// Enable server-side sessions
app.use(session({
  secret: process.env.sessionSecretKey,
  cookie: { secure: process.env.isHttps === 'true' },
  resave: false,
  saveUninitialized: false
}));

// Serve HTML pages under root directory
app.use('/', express.static(path.join(__dirname, '../public')));


/**
*  Attemps to retrieves the server session.
*  If there is no session, redirects with HTTP 401 and an error message
*/
function getSession(request, response) {
  const session = request.session;
  if (typeof session['sfdcAuth'] === 'undefined') {
    response.status(401).send('No active session');
    return null;
  }
  return session;
}


/**
* Login endpoint
*/
app.get("/auth/login", function(request, response) {
  // Redirect to Salesforce login/authorization page
  const uri = sfdc.auth.getAuthorizationUrl({scope: 'api'});
  return response.redirect(uri);
});


/**
* Login callback endpoint (only called by Force.com)
*/
app.get('/auth/callback', function(request, response) {
    if (!request.query.code) {
      response.status(500).send('Failed to get authorization code from server callback.');
      return;
    }

    // Authenticate with Force.com via OAuth
    sfdc.auth.authenticate({
        'code': request.query.code
    }, function(error, payload) {
        if (error) {
          console.log('Force.com authentication error: '+ JSON.stringify(error));
          response.status(500).json(error);
          return;
        }

		// Store oauth session data in server (never expose it directly to client)
		request.session.sfdcAuth = payload;
		// Redirect to app main page
		return response.redirect('/index.html');
    });
});


/**
* Logout endpoint
*/
app.get('/auth/logout', function(request, response) {
  const session = getSession(request, response);
  if (session == null)
    return;

  // Revoke OAuth token
  sfdc.auth.revoke({token: session.sfdcAuth.access_token}, function(error) {
    if (error) {
      console.error('Force.com OAuth revoke error: '+ JSON.stringify(error));
      response.status(500).json(error);
      return;
    }

    // Destroy server-side session
    session.destroy(function(error) {
      if (error)
        console.error('Force.com session destruction error: '+ JSON.stringify(error));
    });

    // Redirect to app main page
    return response.redirect('/index.html');
  });
});


/**
* Endpoint for retrieving currently connected user
*/
app.get('/auth/whoami', function(request, response) {
  const session = getSession(request, response);
  if (session == null)
    return;

  // Request user info from Force.com API
  sfdc.data.getLoggedUser(session.sfdcAuth, function (error, userData) {
    if (error) {
      console.log('Force.com identity API error: '+ JSON.stringify(error));
      response.status(500).json(error);
      return;
    }
    // Return user data
    response.send(userData);
    return;
  });
});


/**
* Endpoint for performing a SOQL query on Force.com
*/
app.get('/query', function(request, response) {
  const session = getSession(request, response);
  if (session == null)
    return;

  if (!request.query.q) {
    response.status(400).send('Missing query parameter.');
    return;
  }

  const query = encodeURI(request.query.q);
  const apiRequestOptions = sfdc.data.createDataRequest(session.sfdcAuth, 'query?q='+ query);

  httpClient.get(apiRequestOptions, function (error, payload) {
    if (error) {
      console.error('Force.com data API error: '+ JSON.stringify(error));
      response.status(500).json(error);
      return;
    }
    else {
      response.send(payload.body);
      return;
    }
  });
});


app.listen(app.get('port'), function() {
  console.log('Server started: http://localhost:' + app.get('port') + '/');
});
