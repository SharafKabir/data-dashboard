// Authentication routes using OpenID Connect with AWS Cognito

import express from 'express';
import { generators } from 'openid-client';
import { initializeOIDCClient, getClient, redirectUris } from '../config/cognito-oidc.js';
import { query } from '../config/database.js';

const router = express.Router();

// Export the initialization function (called from server.js)
export { initializeOIDCClient };

// Login route - redirects to Cognito authorization endpoint
router.get('/login', async (req, res) => {
  const client = getClient();
  if (!client) {
    return res.status(500).json({ error: 'OIDC client not initialized' });
  }

  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);
  
  // Store code verifier in session
  req.session.codeVerifier = codeVerifier;
  req.session.returnTo = req.query.returnTo || '/';
  
  // Save session explicitly and wait for it before redirecting
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

    // Explicitly set redirect_uri to ensure it matches Cognito configuration
    const authUrl = client.authorizationUrl({
      scope: 'openid email profile',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      redirect_uri: redirectUris.login, // Explicitly set redirect URI
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

// Callback route - handles the OIDC callback from Cognito
router.get('/callback', async (req, res) => {
  const client = getClient();
  if (!client) {
    return res.status(500).json({ error: 'OIDC client not initialized' });
  }

  try {
    // Debug session and cookies
    console.log('\n=== Callback Debug ===');
    console.log('Session ID:', req.sessionID);
    console.log('Cookies received:', req.headers.cookie || 'No cookies');
    console.log('Session keys:', Object.keys(req.session));
    console.log('Code verifier in session:', !!req.session.codeVerifier);
    console.log('=====================\n');

    // Check for error in callback params (Cognito might return errors in query params)
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

    const tokenSet = await client.callback(
      redirectUris.login,
      params,
      {
        code_verifier: req.session.codeVerifier,
      }
    );

    // Store tokens in session
    req.session.tokens = tokenSet;
    
    // Debug: Log what we received
    console.log('TokenSet received:', {
      hasIdToken: !!tokenSet.id_token,
      hasAccessToken: !!tokenSet.access_token,
      hasRefreshToken: !!tokenSet.refresh_token,
      tokenKeys: Object.keys(tokenSet)
    });
    
    // Try to get claims from id_token, fallback to userinfo endpoint
    let claims;
    try {
      // First try to get claims from id_token
      claims = tokenSet.claims();
      console.log('✓ Got claims from id_token');
    } catch (idTokenError) {
      // If id_token is not present, use userinfo endpoint with access_token
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
        // Check if there's an error in the tokenSet
        if (tokenSet.error) {
          throw new Error(`Token error: ${tokenSet.error} - ${tokenSet.error_description || ''}`);
        }
        throw new Error('Neither id_token nor access_token available in token response');
      }
    }
    
    req.session.user = claims;

    // Extract user information from Cognito claims
    const cognitoSub = claims.sub; // Cognito's unique user identifier
    const email = claims.email || null;

    // Insert or update user in database
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
        // Don't fail the login if database insert fails, but log the error
      }
    } else {
      console.warn('Missing cognito_sub or email in token claims:', { cognitoSub, email });
    }

    // Redirect to frontend or returnTo URL
    const returnTo = req.session.returnTo || '/';
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}${returnTo}`);
  } catch (error) {
    console.error('OIDC callback error:', error);
    console.error('Error details:', {
      error: error.error,
      error_description: error.error_description,
      params: req.query
    });

    // Redirect to frontend with error message
    const errorMessage = error.error_description || error.error || 'Authentication failed';
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=${encodeURIComponent(errorMessage)}`);
  }
});

// Logout route - simple local logout (clears session)
router.get('/logout', (req, res) => {
  const logoutRedirectUri = redirectUris.logout;
  
  // Clear session
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
    } else {
      console.log('Session destroyed, user logged out');
    }
    // Redirect to frontend regardless of destroy result
    res.redirect(logoutRedirectUri);
  });
});

// Get current user info
router.get('/user', (req, res) => {
  if (req.session.user) {
    res.json({ user: req.session.user, authenticated: true });
  } else {
    res.status(401).json({ authenticated: false, message: 'Not authenticated' });
  }
});

// Middleware to check if user is authenticated
export function requireAuth(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    res.status(401).json({ error: 'Authentication required' });
  }
}

export default router;

