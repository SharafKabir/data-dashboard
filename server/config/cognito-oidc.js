// server/config/cognito-oidc.js
import { Issuer } from 'openid-client';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file BEFORE reading environment variables
config({ path: join(__dirname, '..', '.env') });

// AWS Cognito OIDC Configuration
// Replace MY-ID and MY-SECRET with your actual values from AWS Cognito
// Or use environment variables for security

const issuerUrl = 'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_xMStiMUKO';
const clientId = (process.env.AWS_CLIENT_ID || 'c0c1gj5lr4p2rb8751bt1lchf').trim(); // Replace MY-ID with your actual client ID
const clientSecret = (process.env.AWS_CLIENT_SECRET || 'client secret').trim(); // Replace MY-SECRET with your actual client secret
const redirectUri = (process.env.REDIRECT_URI || 'http://localhost:3001/auth/callback').trim();

let client = null;

// Initialize OpenID Client
export async function initializeOIDCClient() {
  try {
    const issuer = await Issuer.discover(issuerUrl);
    
    // Build client config
    const clientConfig = {
      client_id: clientId,
      redirect_uris: [redirectUri],
      response_types: ['code']
    };
    
    // Check if we have a valid client secret
    const hasSecret = clientSecret && 
                      clientSecret !== 'client secret' && 
                      clientSecret.trim().length > 0 &&
                      process.env.AWS_CLIENT_SECRET; // Make sure it came from env, not fallback
    
    if (hasSecret) {
      clientConfig.client_secret = clientSecret;
      console.log('✓ Client secret loaded (length:', clientSecret.length, ')');
    } else {
      // If no secret from env, this is an error for Cognito confidential clients
      console.error('❌ ERROR: AWS_CLIENT_SECRET is missing or invalid!');
      console.error('   Your Cognito app client requires a client secret.');
      console.error('   Please create a .env file in the server directory with:');
      console.error('   AWS_CLIENT_SECRET=your-secret-from-aws');
      console.error('');
      console.error('   Current value:', process.env.AWS_CLIENT_SECRET ? 'Set but invalid' : 'Not set');
      console.error('   Fallback value being used:', clientSecret);
      throw new Error('AWS_CLIENT_SECRET is required but not found in environment variables. Please set it in server/.env file.');
    }
    
    client = new issuer.Client(clientConfig);

    console.log('✓ OIDC client initialized successfully');
    console.log('  Redirect URI:', redirectUri);
    console.log('  Client ID:', clientId);
    return client;
  } catch (error) {
    console.error('Error initializing OIDC client:', error);
    throw error;
  }
}

// Export client getter for use in routes
export function getClient() {
  return client;
}

// Export redirect URI for use in routes
export const redirectUris = {
  login: redirectUri,
  logout: process.env.REDIRECT_URI_LOGOUT || 'http://localhost:3000',
};