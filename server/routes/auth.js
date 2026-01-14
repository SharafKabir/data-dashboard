// login stuff with cognito

import express from 'express';
import { generators } from 'openid-client';
import { initializeOIDCClient, getClient, redirectUris } from '../config/cognito-oidc.js';
import { query } from '../config/database.js';

const router = express.Router();

// export this for server.js
export { initializeOIDCClient };

// redirect them to cognito login page
router.get('/login', async (req, res) => {
  const client = getClient();
  if (!client) {
    return res.status(500).json({ error: 'OIDC client not initialized' });
  }

  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);
  
  // stash this in session for later
  req.session.codeVerifier = codeVerifier;
  req.session.returnTo = req.query.returnTo || '/';
  
  // gotta save session before redirecting
  try {
    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          console.error('Error saving session:', err);
          return reject(err);
        }
        console.log('✓ Session saved, code verifier stored');
        console.log('Session ID:', req.sessionID);
        console.log('Code verifier stored:', !!req.session.codeVerifier);
        console.log('Set-Cookie header will be sent with response');
        resolve();
      });
    });

    // build the cognito login url
    const authUrl = client.authorizationUrl({
      scope: 'openid email profile',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      redirect_uri: redirectUris.login,
    });

    console.log('Redirecting to Cognito with redirect_uri:', redirectUris.login);
    console.log('Authorization URL:', authUrl);
    console.log('Response headers before redirect:', Object.keys(res.getHeaders()));

    res.redirect(authUrl);
  } catch (error) {
    console.error('Error in login route:', error);
    res.status(500).json({ error: 'Failed to initiate login' });
  }
});

// cognito redirects back here after login
router.get('/callback', async (req, res) => {
  const client = getClient();
  if (!client) {
    return res.status(500).json({ error: 'OIDC client not initialized' });
  }

  try {
    // logging stuff to debug
    console.log('\n=== Callback Debug ===');
    console.log('Session ID:', req.sessionID);
    console.log('Cookies received:', req.headers.cookie || 'No cookies');
    console.log('Session keys:', Object.keys(req.session));
    console.log('Code verifier in session:', !!req.session.codeVerifier);
    console.log('=====================\n');

    // see if cognito errored
    if (req.query.error) {
      const errorMsg = req.query.error_description || req.query.error;
      console.error('Cognito returned error in callback:', req.query.error, errorMsg);
      throw new Error(`Authentication error: ${errorMsg}`);
    }

    const params = client.callbackParams(req);
    console.log('Callback params:', Object.keys(params));
    
    if (!req.session.codeVerifier) {
      console.error('Code verifier missing from session');
      console.error('Session data:', req.session);
      throw new Error('Session expired. Please try logging in again.');
    }

    // swap the code for actual tokens
    const tokenSet = await client.callback(
      redirectUris.login,
      params,
      {
        code_verifier: req.session.codeVerifier,
      }
    );

    // store tokens in session
    req.session.tokens = tokenSet;
    
    // log what tokens we got
    console.log('TokenSet received:', {
      hasIdToken: !!tokenSet.id_token,
      hasAccessToken: !!tokenSet.access_token,
      hasRefreshToken: !!tokenSet.refresh_token,
      tokenKeys: Object.keys(tokenSet)
    });
    
    // extract user info from token
    let claims;
    try {
      // try id token first
      claims = tokenSet.claims();
      console.log('✓ Got claims from id_token');
    } catch (idTokenError) {
      // if that fails, hit cognito's userinfo endpoint
      console.log('id_token not present, fetching user info from userinfo endpoint...');
      console.log('TokenSet access_token:', tokenSet.access_token ? 'present' : 'missing');
      console.log('TokenSet keys:', Object.keys(tokenSet));
      
      if (tokenSet.access_token) {
        try {
          const userInfo = await client.userinfo(tokenSet.access_token);
          claims = userInfo;
          console.log('✓ Got claims from userinfo endpoint');
        } catch (userInfoError) {
          console.error('Error fetching userinfo:', userInfoError);
          throw new Error(`Failed to get user info: ${userInfoError.message}`);
        }
      } else {
        // something broke
        if (tokenSet.error) {
          throw new Error(`Token error: ${tokenSet.error} - ${tokenSet.error_description || ''}`);
        }
        throw new Error('Neither id_token nor access_token available in token response');
      }
    }
    
    req.session.user = claims;

    // grab user id and email
    const cognitoSub = claims.sub;
    const email = claims.email || null;

    // stick them in the db
    if (cognitoSub && email) {
      try {
        await query(
          `INSERT INTO users (cognito_sub, email) 
           VALUES ($1, $2) 
           ON CONFLICT (cognito_sub) 
           DO UPDATE SET email = EXCLUDED.email`,
          [cognitoSub, email]
        );
        console.log(`✓ User inserted/updated in database: ${cognitoSub}`);
      } catch (dbError) {
        console.error('Error inserting user into database:', dbError);
        // don't die if db fails, just log it
      }
    } else {
      console.warn('Missing cognito_sub or email in token claims:', { cognitoSub, email });
    }

    // redirect back to frontend
    const returnTo = req.session.returnTo || '/';
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}${returnTo}`);
  } catch (error) {
    console.error('OIDC callback error:', error);
    console.error('Error details:', {
      error: error.error,
      error_description: error.error_description,
      params: req.query
    });

    // redirect with error message
    const errorMessage = error.error_description || error.error || 'Authentication failed';
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=${encodeURIComponent(errorMessage)}`);
  }
});

// logout, just clear the session
router.get('/logout', (req, res) => {
  const logoutRedirectUri = redirectUris.logout;
  
  // wipe their session
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
    } else {
      console.log('Session destroyed, user logged out');
    }
    // redirect them out
    res.redirect(logoutRedirectUri);
  });
});

// return who's logged in to frontend
router.get('/user', (req, res) => {
  if (req.session.user) {
    res.json({ user: req.session.user, authenticated: true });
  } else {
    res.status(401).json({ authenticated: false, message: 'Not authenticated' });
  }
});

// middleware to check if they're logged in
export function requireAuth(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    res.status(401).json({ error: 'Authentication required' });
  }
}

export default router;

