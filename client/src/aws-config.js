// AWS Amplify Configuration
// Replace these values with your AWS Cognito User Pool settings

export const awsConfig = {
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_AWS_USER_POOL_ID || '',
      userPoolClientId: import.meta.env.VITE_AWS_USER_POOL_CLIENT_ID || '',
      region: import.meta.env.VITE_AWS_REGION || 'us-east-1',
    },
  },
};

// Note: You'll need to create a .env file in the client directory with:
// VITE_AWS_USER_POOL_ID=your-user-pool-id
// VITE_AWS_USER_POOL_CLIENT_ID=your-client-id
// VITE_AWS_REGION=your-region

