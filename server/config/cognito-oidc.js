// cognito oidc setup
import { Issuer } from 'openid-client';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// load env vars
config({ path: join(__dirname, '..', '.env') });

// cognito config, set these in .env

const issuerUrl = 'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_xMStiMUKO';
const clientId = (process.env.AWS_CLIENT_ID || 'c0c1gj5lr4p2rb8751bt1lchf').trim();
const clientSecret = (process.env.AWS_CLIENT_SECRET || 'client secret').trim();
const redirectUri = (process.env.REDIRECT_URI || 'http://localhost:3001/auth/callback').trim();

let client = null;

// initialize cognito client
export async function initializeOIDCClient() {
  try {
    const issuer = await Issuer.discover(issuerUrl);
    
    // build client config
    const clientConfig = {
      client_id: clientId,
      redirect_uris: [redirectUri],
      response_types: ['code']
    };
    
    // check we have actual secret, not placeholder
    const hasSecret = clientSecret && 
                      clientSecret !== 'client secret' && 
                      clientSecret.trim().length > 0 &&
                      process.env.AWS_CLIENT_SECRET;
    
    if (hasSecret) {
      clientConfig.client_secret = clientSecret;
      console.log('✓ Client secret loaded (length:', clientSecret.length, ')');
    } else {
      // no secret = can't login
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

// return the client
export function getClient() {
  return client;
}

// redirect uris for login/logout
export const redirectUris = {
  login: redirectUri,
  logout: process.env.REDIRECT_URI_LOGOUT || 'http://localhost:3000',
};